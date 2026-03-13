# Home3.vue — Order of Operations

This document details the complete execution chain for the dynamic GraphQL query builder page, from page load through user interactions.

---

## Constants

| Name | Purpose |
|------|---------|
| `ROOT` | The GraphQL root query field name (e.g. `"tools"`). Every query, introspection lookup, and data accessor is built around this single constant. |
| `NON_MODEL_ARGS` | Envelope args (`filter`, `orderBy`, `first`, `offset`, `and`, `or`, `not`, etc.) that are stripped from model field lists so only real model fields remain. |

---

## Phase 1 — Page Load & Schema Introspection

### 1.1 `fields_query` fires automatically

On mount, `useQuery(fields_query)` sends an introspection query to discover the `Query` type's fields. Specifically it finds the `ROOT` field and extracts all of its `args` — each arg has a `name`, `type.kind`, `type.name`, and nested `ofType` (2 levels deep to handle `LIST(NON_NULL(...))` wrappers).

### 1.2 `watch(q_r, ...)` — process introspection result

When the introspection response arrives, the watcher fires and does three things in sequence:

#### a) Extract model fields → `fields`

```
args → stripTypename() → exclude NON_MODEL_ARGS → exclude ID types → fields.value
```

`stripTypename()` recursively removes `__typename` fields injected by Apollo's cache normalization. The remaining args represent the model's own queryable fields (name, brand, category, etc.).

#### b) Discover the filter type → kick off `introspect(typeName, "F")`

Finds the arg named `"filter"`. Its `type.name` (e.g. `"ToolFilter"`) becomes `tool_root` — the root INPUT_OBJECT for the filter type tree. Calls `introspect()` in filter mode to recursively walk it.

#### c) Discover the orderBy type → kick off `introspect(typeName, "O")`

Finds the arg named `"orderBy"`. Because orderBy is typically wrapped in `LIST` and/or `NON_NULL`, the inline `unwrapType()` helper recursively peels off wrappers to recover:
- `innerName` — the actual INPUT_OBJECT name (e.g. `"ToolOrder"`) → stored in `sort_root`
- `varType` — the full GraphQL variable type string (e.g. `"[ToolOrder!]"`) → stored in `sort_var_type`

Then calls `introspect()` in order mode to recursively walk the sort type tree.

### 1.3 `introspect(typeName, mode)` — recursive INPUT_OBJECT discovery

This is the shared workhorse for both filter and sort type trees. It:

1. **Selects the right lazy query and store** based on mode:
   - `"F"` → uses `f_r` / `f_l` / `f_get` lazy query instance → writes to `filters` ref
   - `"O"` → uses `s_r` / `s_l` / `s_get` lazy query instance → writes to `sort_types` ref

   Separate lazy query instances prevent filter and sort introspections from interfering with each other.

2. **Fetches the type** using `input_query` — a `__type(name: $name)` query that returns `inputFields` with their types.

3. **Strips envelope args** from inputFields (same `NON_MODEL_ARGS` exclusion).

4. **Initializes UI state** — sets `on: false` and `value: ""` on the type object and each inputField. These are the reactive properties the template binds to.

5. **Upserts into the flat store** — if a type with the same name already exists, it's updated in place (avoids duplicates on re-fetch). Otherwise it's appended.

6. **Recurses** into any inputField whose `type.kind === "INPUT_OBJECT"`, depth-first.

**Result:** `filters` contains a flat list of every INPUT_OBJECT type in the filter tree. `sort_types` contains the same for the sort tree. Each has `inputFields` decorated with `on`/`value` state.

---

## Phase 2 — Initial Data Query

### 2.1 `q` — the mutable query skeleton

A plain JS object representing the GraphQL query shape. Its `__variables` and `__args` are emptied and rebuilt on every `get()` call. The `edges.node` section defines which fields are fetched (currently hardcoded: `name`, `brand.name`, `category.name`, `toolMetrics.edges.node.{value, metric.name}`).

### 2.2 `useQuery(queryDoc, queryVariables)` — reactive data query

Apollo's `useQuery` watches both `queryDoc` (a compiled GQL document) and `queryVariables` (a ref of variable values). Whenever either changes, Apollo re-executes the query. Returns `a_r` (result), `a_l` (loading), `a_e` (error).

### 2.3 `get(resetPage?)` — rebuild and execute

The central function. Called by every user interaction that should refresh data. Steps:

1. **Reset pagination** — unless `resetPage = false` (used by `goToPage()`), resets `current_page` to 1.

2. **Clear query args** — empties `q.query.__variables` and `q.query[ROOT].__args`.

3. **Build filter payload** — walks `activeFilterPaths` and nests each path into a deeply nested object:
   ```
   [brand → name → icontains:"dewalt"] → { brand: { name: { icontains: "dewalt" } } }
   ```
   Skips leaf nodes with empty values (no point querying `contains: ""`).

4. **Attach filter variable** — if the payload is non-empty, declares `$filter` in `__variables` and sets `filter:` in `__args`.

5. **Build sort payload** — walks `orderedSortPaths` (the user-ordered version). Each sort path becomes its **own object** in an array, so array position (not JS object key order) determines sort priority:
   ```
   [name → ASC, brand → name → DESC] → [{ name: "ASC" }, { brand: { name: "DESC" } }]
   ```

6. **Attach orderBy variable** — if any sort objects exist, declares `$orderBy` in `__variables`. Wraps in an array if `sort_var_type` starts with `"["`.

7. **Attach pagination variables** — declares `$first` and `$offset` with current `page_size` and computed `paginationOffset`.

8. **Recompile and swap** — `gql(jtg(q))` compiles the skeleton into a GQL document. Setting `queryDoc.value` and `queryVariables.value` triggers Apollo's reactive refetch.

### 2.4 `getEdges()` — convenience accessor

Returns `a_r.value?.[ROOT]` — the root field of the current query result. Used throughout the template to access `.edges`, `.count`, and `.counts`.

### 2.5 `commitFilterValue()`

A thin proxy around `get()` so template `@keyup.enter` and `@change` handlers read more clearly.

---

## Phase 3 — UI Helpers (Shared by Filters & Sorts)

These functions are parameterized by `mode: "F" | "O"` to serve both filter and sort UIs from a single implementation.

### 3.1 `camel(s)` — display formatter

Converts camelCase to spaced words: `"brandName"` → `"brand Name"`. Used on all field name labels.

### 3.2 `topLevel(mode)` — root-level dropdown options

Returns the `inputFields` array from the root type of the given mode:
- `"F"` → looks up `tool_root` in `filters`
- `"O"` → looks up `sort_root` in `sort_types`

These are the top-level options shown in the "Add Filter" / "Add Sort" dropdowns.

### 3.3 `searchFieldsFn(mode)` — filtered dropdown items

Filters `topLevel(mode)` by the corresponding search text ref (`search_fields` for filters, `search_sort_fields` for sorts), excluding fields that are already active (`on === true`).

### 3.4 `enable(inputField, mode)` — activate a field and cascade

Turns a field `on` and recursively opens the first child at each level until a leaf is reached.

- **Filter mode (`"F"`)**: recurses into any named type. Leaf fields start with `value: ""` (user must type a value before it affects the query).
- **Order mode (`"O"`)**: only recurses into `INPUT_OBJECT` children. Non-INPUT_OBJECT leaves (typically ENUM) default to `"ASC"`.

**Does NOT call `get()`** — callers decide when to re-query. This prevents unnecessary fetches when adding a new filter that has no value yet.

### 3.5 `activePaths(mode)` — compute active branch paths

Walks the type tree and collects every active branch as a linear array of level nodes. Each level node contains:
- `selected` — the active field at this depth (has `on`, `value`, `type`)
- `options` — all sibling fields at this depth (for the swap dropdown)
- `isLeaf` — whether this is the terminal node
- `fieldType` — the GraphQL type name (for choosing input widget)

Leaf detection differs by mode:
- **Filter**: leaf = `SCALAR` kind or known primitive name (`String`, `Boolean`, `Int`, `Float`, `Decimal`, `ID`)
- **Order**: leaf = anything that isn't `INPUT_OBJECT` (catches ENUM sort directions)

Used by two computeds:
- `activeFilterPaths = computed(() => activePaths("F"))`
- `activeSortPaths = computed(() => activePaths("O"))`

### 3.6 `filterGrid` (computed) — rowspan-merged 2D grid

Transforms the flat `activeFilterPaths` into a 2D grid where shared ancestor nodes across adjacent rows get a single cell spanning multiple rows. For each cell, computes how many consecutive rows below share the same ancestor chain up to that column, then marks spanned cells with `{ isSpanned: true }` so the template skips them.

### 3.7 `changeNode(level, event, mode)` — swap a selected field

When the user changes a `<select>` dropdown at a given depth:
1. Turns the old field `off`
2. Finds the new field by name
3. Calls `enable()` on it (cascading children)
4. Calls `get()` — the old field was deactivated, so the query must update even if the new field has no value yet

### 3.8 `addNext(level, mode)` — expand next sibling

Finds the first inactive sibling within the same parent INPUT_OBJECT and calls `enable()` on it. Does NOT call `get()` — in filter mode the new field has no value; in sort mode the template adds `; get()` inline.

### 3.9 `deletePath(path)` — remove a path

Walks backwards along the path turning off each node. Stops early if a sibling at the same depth is still active (preserving shared ancestor state). Always calls `get()` since removing a path changes the query.

---

## Phase 4 — Sort-Specific Logic (Drag-and-Drop Reordering)

### 4.1 `sortPathKey(path)` — stable identity

Generates a dot-separated key from a path's field names (e.g. `"brand.name"`). Used to track user-defined ordering across reactive recomputes.

### 4.2 `orderedSortPaths` (computed) — user-ordered sort paths

Takes `activeSortPaths` and reorders them according to `sort_path_order` (an array of path keys). Paths in `sort_path_order` come first (in that order), then any newly added paths are appended.

### 4.3 `watch(activeSortPaths, ...)` — keep ordering in sync

Whenever sort paths change (added/removed), syncs `sort_path_order`:
- Removes keys for paths that no longer exist
- Appends keys for newly added paths

### 4.4 `onSortDragStart(idx)` — begin drag

Stores the dragged row index in `drag_sort_idx`. Used by the template's `:style` binding to reduce the row's opacity.

### 4.5 `onSortDrop(idx)` — complete drag

Splices the dragged entry out of `sort_path_order` and re-inserts it at the drop target index. Clears drag state. Calls `get()` to refetch with the new sort priority — because each sort is a separate object in the `orderBy` array, reordering produces a genuinely different payload that Apollo detects.

---

## Phase 5 — Pagination

### 5.1 `totalPages` (computed)

`Math.ceil(count / page_size)`, minimum 1. `count` comes from the GraphQL response (total matching results across all pages).

### 5.2 `paginationOffset` (computed)

`(current_page - 1) * page_size` — the zero-based offset passed to the `$offset` variable.

### 5.3 `goToPage(n)`

Clamps `n` between 1 and `totalPages`, sets `current_page`, and calls `get(false)` — the `false` flag prevents `get()` from resetting the page back to 1.

### 5.4 `changePageSize(val)`

Clamps to minimum 1, resets to page 1, and calls `get()`.

---

## Interaction Flows

### User adds a filter

```
click "Filter" dropdown
  → searchFieldsFn("F") populates dropdown (filtered by search_fields, excluding active)
  → user clicks a field
  → enable(field, "F")
    → field.on = true
    → recurse into first child until leaf
    → leaf starts with value: ""
  → NO get() — query unchanged (no value to filter on)
  → user types a value in the leaf input
  → @keyup.enter → commitFilterValue() → get()
    → activeFilterPaths recomputes (now includes the valued leaf)
    → filter payload built → query recompiled → Apollo refetches
```

### User adds a sort

```
click "Sort" dropdown
  → searchFieldsFn("O") populates dropdown
  → user clicks a field
  → enable(field, "O") + get()  [both called inline in template]
    → field.on = true
    → recurse into first child until leaf
    → leaf defaults to "ASC"
  → get() fires
    → orderedSortPaths recomputes
    → sort payload built: [{ field: "ASC" }]
    → query recompiled → Apollo refetches
```

### User reorders sorts (drag-and-drop)

```
dragstart → onSortDragStart(fromIdx)
  → drag_sort_idx = fromIdx (row goes translucent)
dragover.prevent → drag_over_sort_idx = hoverIdx (drop target highlighted)
drop → onSortDrop(toIdx)
  → splice sort_path_order: remove from fromIdx, insert at toIdx
  → clear drag state
  → get()
    → orderedSortPaths recomputes in new order
    → sort payload array order changes → Apollo refetches
dragend → clear drag state (fallback if drop doesn't fire)
```

### User changes a filter/sort node

```
changeNode(level, event, mode)
  → old field.on = false
  → find new field by name
  → enable(newField, mode) — cascade children
  → get() — always re-queries (old field was removed)
```

### User deletes a filter/sort path

```
deletePath(path)
  → walk backwards: turn off each level's selected field
  → stop when a sibling is still active
  → get() — path removed, query must update
```

### User changes page

```
goToPage(n)
  → current_page = n (clamped)
  → get(false) — resetPage=false preserves current_page
    → paginationOffset recomputes
    → $offset variable changes → Apollo refetches
```

---

## Reactive Dependency Graph

```
fields_query (auto)
  └→ watch(q_r)
       ├→ fields
       ├→ introspect("F") → filters
       └→ introspect("O") → sort_types

filters + sort_types
  ├→ topLevel(mode)
  ├→ searchFieldsFn(mode)
  ├→ activePaths("F") → activeFilterPaths → filterGrid
  └→ activePaths("O") → activeSortPaths
                           ├→ watch → sort_path_order (sync)
                           └→ orderedSortPaths (user-ordered)

get()
  ├← activeFilterPaths  (reads)
  ├← orderedSortPaths   (reads)
  ├← paginationOffset   (reads)
  ├→ queryDoc            (writes → triggers useQuery)
  └→ queryVariables      (writes → triggers useQuery)

useQuery(queryDoc, queryVariables)
  └→ a_r → getEdges() → template rendering
```
