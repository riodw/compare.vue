# Plan: Column Introspection — Data Fetching, Storage & Query Rebuilding

## Context

Home3.vue has a dynamic GraphQL query builder with filter and sort introspection. Both use `introspect()` to recursively walk INPUT_OBJECT trees, store results in flat refs, and rebuild the query in `get()`. The `edges.node` selection set was previously hardcoded. This plan adds a parallel columns system that introspects OBJECT types (return types), stores them in the same flat-store pattern, and rebuilds `edges.node` dynamically. Columns use the same `.on` pattern as filters/sorts — no separate "active" array. A `column_order` ref (mirroring `sort_path_order`) tracks left-to-right display order. The table and a management panel are driven by `orderedColumns`.

## Critical File

`/Users/riordenweber/projects/compare.vue/src/components/Home3.vue`

---

## Step 1 — Extend `fields_query` to include return types (line 70)

Add `type` as a sibling to `args` inside `fields`. This gives us the ROOT field's return type (e.g., `ToolNodeConnection`) in the existing introspection response — no new network request.

```
fields: {
  name: true,
  args: { ... },       // existing, unchanged
  type: {              // NEW
    kind: true, name: true,
    ofType: { kind: true, name: true, ofType: { kind: true, name: true } }
  }
}
```

---

## Step 2 — New state refs (after line 42)

```ts
// ---- Columns ----
const column_root = ref("");              // root OBJECT type name (e.g. "ToolNode")
const columns = ref<any[]>([]);           // flat store of introspected OBJECT types
const column_order = ref<string[]>([]);   // user's drag-and-drop column order (field names)
const search_columns = ref("");           // search text inside the "Add Column" dropdown
const drag_col_idx = ref<number | null>(null);       // drag source column index
const drag_over_col_idx = ref<number | null>(null);  // drag hover target column index
```

No `columns_active` array. Which columns are shown is determined by `.on` on each field in the `columns` store (same pattern as filters/sorts). The `column_order` ref tracks left-to-right display order (same pattern as `sort_path_order` tracks sort priority). The `search_columns` and drag refs support the management panel UI.

And a constant for connection envelope fields to strip during column introspection:

```ts
const CONNECTION_FIELDS = ["edges", "node", "pageInfo", "cursor", "count", "counts"];
```

---

## Step 3 — Extract `unwrapType` to top-level utility (from inline at line 131)

The inline `unwrapType` inside `watch(q_r)` is needed by column introspection too. Extract it as a standalone function before the watcher. Add `innerKind` to the return value:

```ts
function unwrapType(t: any): { varType: string; innerName: string; innerKind: string }
```

Replace the inline version at line 131 with a call to this shared function.

---

## Step 4 — New `columns_query` (after `input_query`, ~line 174)

Like `input_query` but fetches `fields` instead of `inputFields`, and includes `args` on each field (to discover filter/orderBy types on connections):

```ts
const columns_query = {
  query: {
    __variables: { name: "String!" },
    __type: {
      __args: { name: new VariableType("name") },
      name: true, kind: true,
      fields: {
        name: true,
        args: { name: true, type: { kind, name, ofType: { kind, name, ofType: { kind, name } } } },
        type: { kind, name, ofType: { kind, name, ofType: { kind, name } } },
      },
    },
  },
};
```

---

## Step 5 — `resolveConnectionNodeType(connectionTypeName)` helper

Takes a Connection type name → introspects it → follows `edges` → `node` → returns the inner node type name. Two `client.query()` calls, both `cache-first`.

```
ToolMetricNodeConnection → edges → ToolMetricNodeEdge → node → "ToolMetricNode"
```

---

## Step 6 — `introspectColumns(typeName, visited?)` function

The column-specific counterpart to `introspect()`. Key differences from the existing function:

| Aspect | `introspect()` | `introspectColumns()` |
|--------|---------------|----------------------|
| Query | `input_query` (`inputFields`) | `columns_query` (`fields` + `args`) |
| Strip list | `NON_MODEL_ARGS` | `CONNECTION_FIELDS` |
| Recurse kind | `INPUT_OBJECT` | `OBJECT` |
| Connection detection | N/A | Check `endsWith("Connection")` + structural `edges` check |
| Extra metadata | None | `isConnection`, `nodeType`, `filterType`, `orderByType` |
| Cycle protection | Not needed (INPUT trees are acyclic) | `visited: Set<string>` param to prevent loops |

Per-field processing during introspection:
1. `unwrapType(field.type)` → store `resolvedTypeName`, `resolvedTypeKind`
2. If OBJECT + connection detected → `isConnection: true`, extract `filterType`/`orderByType` from `field.args`, set `displayMode: "collapsed"`, `pivotField: null`, `valueField: null`
3. If connection → call `resolveConnectionNodeType` to get `nodeType`, recurse into that
4. If plain OBJECT → recurse directly
5. Init UI state: `field.on = false`

`displayMode`/`pivotField`/`valueField` are defaults set during introspection. They are changed later by user interaction (e.g. switching a connection column from collapsed to pivot and selecting which fields to pivot on).

---

## Step 7 — Extend `watch(q_r)` to kick off column introspection (after line 149)

After existing filter/sort discovery, add a third branch:

1. Read ROOT field's `type` from introspection result (available from Step 1)
2. `unwrapType()` to get Connection type name
3. `resolveConnectionNodeType()` to get node type name → store in `column_root`
4. `introspectColumns(nodeTypeName)` to walk the OBJECT tree
5. On completion: set `.on = true` on all scalar fields of the root node type (default visible), initialize `column_order` with those field names, then call `get()`

All three trees (filters, sorts, columns) fire in parallel from the watcher. `cache-first` handles overlap.

### Step 7b — Computed + watcher for column ordering (mirrors sort ordering pattern)

Same pattern as `orderedSortPaths` / `watch(activeSortPaths)`:

```ts
// Collect active columns from the store (fields with .on === true)
const activeColumns = computed(() => {
  const rootType = columns.value.find((c: any) => c.name === column_root.value);
  if (!rootType?.fields) return [];
  return rootType.fields.filter((f: any) => f.on);
});

// Reorder active columns per user's drag order
const orderedColumns = computed(() => {
  const cols = activeColumns.value;
  const order = column_order.value;
  const byName = new Map(cols.map((c: any) => [c.name, c]));
  const result: any[] = [];
  for (const name of order) {
    const c = byName.get(name);
    if (c) { result.push(c); byName.delete(name); }
  }
  for (const c of byName.values()) result.push(c);
  return result;
});

// Keep column_order in sync when columns toggle on/off
watch(activeColumns, (cols) => {
  const currentNames = new Set(cols.map((c: any) => c.name));
  column_order.value = column_order.value.filter((n) => currentNames.has(n));
  for (const c of cols) {
    if (!column_order.value.includes(c.name)) column_order.value.push(c.name);
  }
});
```

---

## Step 8 — Modify `get()` to rebuild `edges.node` from `orderedColumns`

Insert at the start of `get()`, before variables reset. Walk `orderedColumns` (the computed that respects `.on` + `column_order`), and build the node object:

- **SCALAR field** → `node[name] = true`
- **OBJECT (FK)** → `node[name] = { scalarChild: true, ... }` (fetch all scalar children of related type)
- **Connection** → `node[name] = { edges: { node: { scalarChild: true, ... } } }` (inject envelope + fetch scalar children of node type). The query shape is the same regardless of `displayMode` — collapsed and pivoted both need the full edge data.

Then: `q.query[ROOT].edges.node = newNode`

**Merging**: multiple active columns from the same parent (e.g., `"brand.name"` and `"brand.id"` in the future) must merge into a single `brand: { name: true, id: true }` rather than duplicate the key.

---

## Step 9 — Replace hardcoded `edges.node` in initial `q` (lines 507-516)

Replace the 8 hardcoded fields with a minimal fallback:

```ts
node: { id: true }
```

The real fields are populated by `get()` once column introspection completes. The initial `useQuery` fires with just `id` — the loading state covers the brief gap.

---

## Step 10 — Column management helpers

```ts
function enableColumn(field: any)    // field.on = true; get()
function disableColumn(field: any)   // field.on = false; get()
function moveColumn(from: number, to: number)  // reorder column_order, call get()
function availableColumns()          // root type fields where .on === false, filtered by search_columns
function onColumnDrop(idx: number)   // handle drag-drop: calls moveColumn, clears drag state
```

`enableColumn` / `disableColumn` toggle `.on` on the field object directly (same objects in the `columns` store). `availableColumns` also filters by the `search_columns` ref so the "Add Column" dropdown is searchable. `onColumnDrop` mirrors `onSortDrop` — reads `drag_col_idx`, delegates to `moveColumn`, clears drag state.

---

## Edge Display Modes

Connection columns (backward relationships like `toolMetrics`) have two display modes. The **GraphQL query is identical** for both — the difference is entirely in how the template renders the fetched data.

### Collapsed — entire collection in one cell

```
| Metrics                              |
|--------------------------------------|
| Weight: 5, Noise: 80, Price: 100     |
| Weight: 3, Noise: 90                 |
```

One `column_order` entry = one `<th>` = one `<td>` with a `v-for` loop inside. Simple, no data-dependency for column count.

### Pivoted — a field's values become column headers

```
| Weight | Noise Level | Price | Vibration |
|--------|-------------|-------|-----------|
| 5      | 80          | 100   | —         |
| 3      | 90          | —     | 12        |
| 7      | —           | 200   | 8         |
```

One `column_order` entry expands into N visual columns. The headers come from the **data** (unique values of `pivotField`), not the schema — so they're only known after the first query returns.

**Critical: column alignment.** Not every row will have the same set of pivot values. Tool A might have metrics `[Weight, Noise, Price]`, Tool B might have `[Weight, Noise, Vibration]`. The visual columns must be the **union of all unique pivot values across ALL rows in the result**. Each row renders its matching values and `—` (or empty) for pivot values it doesn't have. Without this, columns misalign — row 1 would have 3 cells, row 2 would have 3 different cells, and the table breaks.

This means:
1. After each query returns, scan the **entire result set** to collect all unique pivot values for each active pivot column
2. The resulting set becomes the `<th>` headers — stable across all rows
3. For each `<td>`, look up the specific edge whose `pivotField` matches that header — if no match, render empty
4. If the result set changes (new page, new filters), the pivot column set may change too — headers are reactive to `a_r`

### Column descriptor for connections

Connection fields in the store carry extra config:

```ts
{
  name: "toolMetrics",
  isConnection: true,
  nodeType: "ToolMetricNode",
  displayMode: "collapsed" | "pivot",   // default: "collapsed"
  pivotField: null | "metric.name",     // which field's values become headers
  valueField: null | "value",           // which field fills cells
}
```

### How pivot interacts with the query and table

1. **Query layer** — unchanged. `get()` always fetches the full edge structure: `toolMetrics { edges { node { metric { name } value } } }`. The display mode doesn't affect what data is fetched. This means **switching displayMode does not require calling `get()`** — the data is already there, only the rendering changes.

2. **Table headers** — for pivot columns, headers are derived from the query **result** (`a_r`), not from `orderedColumns` alone. A computed scans the result data to extract unique pivot values (e.g., all unique `metric.name` values across all rows). This computed must update reactively when `a_r` changes (new page, new filters, etc.).

3. **Table cells** — for a pivot column, the cell renderer looks up the edge whose `pivotField` matches the column header and displays its `valueField`. Missing matches render as empty.

4. **Ordering** — a pivot column occupies one slot in `column_order` (e.g., `"toolMetrics"`). The N visual sub-columns it expands into are ordered by the pivot values discovered in the data. Users can reorder the pivot group as a whole relative to other columns, but the internal ordering of pivot sub-columns is data-driven.

### Implications for `column_order`

`column_order` remains a flat string array. Each entry is either:
- A scalar/FK path: `"name"`, `"brand.name"` → always 1 visual column
- A connection path: `"toolMetrics"` → 1 visual column (collapsed) or N visual columns (pivot)

The total visual column count is:
```
Σ(scalar/FK entries × 1) + Σ(collapsed edges × 1) + Σ(pivot edges × unique_pivot_values)
```

Where `unique_pivot_values` is only known after the query returns. The table must reactively recompute its columns when query results change.

---

## Execution Flow After Implementation

```
fields_query (auto)
  └→ watch(q_r)
       ├→ fields
       ├→ introspect(filterType, "filters")      ─┐
       ├→ introspect(sortType, "sorts")           ├─ all parallel
       └→ resolveConnectionNodeType(returnType)   ─┘
            └→ introspectColumns(nodeType)
                 └→ set .on = true on scalar fields
                 └→ initialize column_order
                 └→ get()  ← rebuilds edges.node from orderedColumns
```

## Column Store Shape

```ts
columns.value = [
  {
    name: "ToolNode",
    fields: [
      { name: "name",  resolvedTypeKind: "SCALAR", isConnection: false, on: true },
      { name: "brand", resolvedTypeKind: "OBJECT", isConnection: false, resolvedTypeName: "BrandNode", on: false },
      { name: "toolMetrics", resolvedTypeKind: "OBJECT", isConnection: true,
        nodeType: "ToolMetricNode",
        filterType: "ToolMetricNodeToolMetricFilterFilterInputType",
        orderByType: "ToolMetricNodeToolMetricOrderOrderInputType",
        displayMode: "collapsed",    // "collapsed" | "pivot"
        pivotField: null,            // e.g. "metric.name" when pivoted
        valueField: null,            // e.g. "value" when pivoted
        on: false },
    ]
  },
  { name: "BrandNode", fields: [...] },
  { name: "ToolMetricNode", fields: [...] },
]

// column_order mirrors sort_path_order:
column_order.value = ["name", "weight", "price", ...]  // only .on fields, user-reorderable
// "toolMetrics" occupies one slot — expands to N visual columns if pivoted
```

## Verification

### Logic
1. Page load → network tab shows column introspection queries firing in parallel with filter/sort introspection
2. `columns.value` populated with OBJECT types, connection fields flagged correctly
3. Scalar fields have `.on = true` by default; `column_order` initialized with their names
4. `orderedColumns` computed returns active fields in user's drag order
5. `q.query[ROOT].edges.node` rebuilt from `orderedColumns` in `get()`
6. Connection fields store `filterType`, `orderByType`, `displayMode`, `pivotField`, `valueField`

### Table UI
7. `<th>` headers iterate `orderedColumns` with `camel(col.name)`
8. `<td>` cells render correctly per type: scalar (direct value), FK (joined children), connection (collapsed v-for)
9. Adding/removing columns via panel updates both the query and the table

### Columns Panel
10. "Add Column" dropdown shows `availableColumns()`, filtered by search input
11. Active columns shown as draggable badge chips with close buttons
12. Drag-and-drop reorders `column_order` → table columns shift left-to-right
13. Collapsed summary shows correct column count from `orderedColumns.length`
14. Close buttons hidden on print (`d-print-none`)

### Future (not yet implemented)
15. Pivoted edge → N `<th>`s derived from query result data, cells looked up by pivot match
16. Switching `displayMode` on a connection does NOT trigger `get()` — same data, different rendering

---

## Open Questions (for future phases)

1. **FK dot-paths and `.on` scope** — for flat scalars, `.on` on the root type's field works fine. When FK columns like `"brand.name"` are added, the `.on` flag needs to live on the full path, not just the leaf — otherwise enabling `brand.name` and `category.name` would conflict (both have a `name` field). `column_order` resolves display ordering via dot-paths, but the store's `.on` state may need to be path-aware rather than field-aware.

2. **Pivot sub-column ordering** — pivot headers are data-driven and change when the result set changes. Should the user be able to reorder sub-columns within a pivot group? If so, a `pivotOrder` array (like `column_order` but scoped to the pivot group) would be needed.

3. **Pivot + pagination** — different pages may surface different pivot values. Page 1 might have metrics `[Weight, Noise]`, page 2 adds `[Vibration]`. Should the pivot headers be computed from the current page only, or accumulated across all seen pages? Current plan: current page only (headers reactive to `a_r`).

---

## Implementation Order

1. **State & constants** — `column_root`, `columns`, `column_order`, `CONNECTION_FIELDS`
2. **Extend `fields_query`** — add `type` to `fields` so we get return type info
3. **Extract `unwrapType`** — pull it out of the watcher into a top-level utility, add `innerKind`
4. **`columns_query`** — the OBJECT type introspection query (`fields` + `args`)
5. **`resolveConnectionNodeType`** — helper to unwrap Connection → Edge → Node
6. **`introspectColumns`** — the OBJECT tree walker with connection detection
7. **Extend `watch(q_r)`** — kick off column introspection, init `.on` + `column_order`
8. **Computeds + watcher** — `activeColumns`, `orderedColumns`, `watch(activeColumns)` sync
9. **Modify `get()`** — rebuild `edges.node` from `orderedColumns`
10. **Column helpers** — `enableColumn`, `disableColumn`, `moveColumn`, `availableColumns`
11. **Columns UI** — add/remove/reorder dropdown (same pattern as filters/sorts panel)
12. **Table UI** — headers + cells driven by `orderedColumns`, pivot expansion from `a_r`

Steps 1–4 are pure setup with zero risk to existing behavior. Steps 5–6 are new functions that nothing calls yet. Step 7 is the first thing that actually fires on page load. Step 9 is where the hardcoded `edges.node` gets replaced.

---

## UI Implementation (Steps 11–12)

### Phase A — Table reads from `orderedColumns` ✅

Both `<thead>` and `<tbody>` iterate `orderedColumns` instead of `Object.keys(q.query[ROOT].edges.node)`:

- `<th>` → `v-for="col in orderedColumns"` with `camel(col.name)` for display
- `<td>` → conditional rendering based on `col.resolvedTypeKind`:
  - **SCALAR** → `h.node[col.name]` directly
  - **OBJECT (FK)** → `Object.values(h.node[col.name]).join(', ')` — shows all scalar children
  - **Connection (collapsed)** → `v-for` over `h.node[col.name]?.edges`, joining each node's values

### Phase B — Columns management panel ✅

New `<li>` section in the filters/sorts card, between sorts and the collapse toggle:

- **Header** — "N Columns" count + "Add Column" dropdown button
- **"Add Column" dropdown** — searchable via `search_columns` ref, lists `availableColumns()`, click calls `enableColumn(field)`
- **Active column chips** — draggable `<span>` badges for each column in `orderedColumns`:
  - Drag-and-drop reordering via `drag_col_idx`/`drag_over_col_idx`/`onColumnDrop()`
  - Close button (`btn-close`) calls `disableColumn(field)`, hidden on print (`d-print-none`)
  - Visual feedback: opacity on drag source, outline on drop target
- **Collapsed summary** — shows `orderedColumns.length` for column count
