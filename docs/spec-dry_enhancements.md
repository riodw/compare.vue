# Home3.vue — Function And Variable Inventory

Inventory of top-level functions and variables in `src/components/Home3.vue`, excluding in-function locals. Intended as a reference for upcoming consolidation, readability, and DRY changes.

## Constants

```ts
ROOT                // "tools" — GraphQL root query field
NON_MODEL_ARGS      // ["filter","first","last","before","after","offset","orderBy","and","or","not"]
CONNECTION_FIELDS   // ["edges","node","pageInfo","cursor","count","counts"]
```

## State refs

### Global UI

```ts
search              // search box text (lowercased)
show_filters        // expand/collapse controls card
page_size           // results per page
```

### Schema Introspection

```ts
fields              // discovered model fields (currently unused in template)
```

### Filters

```ts
filter_root         // root filter INPUT_OBJECT type name
filters             // flat store of filter INPUT_OBJECT types
search_fields       // "Add Filter" dropdown search text
```

### Sorts

```ts
sort_root           // root sort INPUT_OBJECT type name
sort_var_type       // full GraphQL variable type (e.g. "[ToolOrder!]")
sorts               // flat store of sort INPUT_OBJECT types
search_sorts        // "Add Sort" dropdown search text
sort_path_order     // user-managed sort priority (path keys)
drag_sort_idx       // drag source row index (sort)
drag_over_sort_idx  // drag hover target row index (sort)
```

### Columns

```ts
column_root         // root OBJECT (node) type name
columns             // flat store of OBJECT types
column_order        // user column order (field names)
search_columns      // "Add Column" dropdown search text
drag_col_idx        // drag source column index
drag_over_col_idx   // drag hover target column index
```

### Pagination

```ts
paginationOffset    // zero-based offset, pagination source of truth
```

## GraphQL query builders / documents

```ts
fields_query        // introspection query for Query type
input_query         // reusable introspection for any INPUT_OBJECT
columns_query       // reusable introspection for any OBJECT
q                   // mutable live-query skeleton (for json-to-graphql-query)
queryDoc            // compiled GraphQL document ref
queryVariables      // variables object ref
```

## Apollo `useQuery` refs

### Introspection query

```ts
q_r                 // result
q_l                 // loading
q_e                 // error
```

### Live data query

```ts
a_r                 // result
a_l                 // loading
a_e                 // error
a_get               // refetch (unused)
```

### Apollo client handle

```ts
resolveClient       // from useApolloClient()
```

## Computed properties

```ts
activeFilterPaths   // paths through active filter branches
activeSortPaths     // paths through active sort branches
filterGrid          // 2D grid with rowspans for filter UI
orderedSortPaths    // sort paths reordered by sort_path_order
activeColumns       // root-level columns with on === true
orderedColumns      // active columns reordered by column_order
current_page        // derived from paginationOffset + page_size
```

## Helper functions

```ts
stripTypename(obj)            // strip Apollo __typename recursively
unwrapType(t)                 // peel NON_NULL/LIST → {varType, innerName, innerKind}
camel(s)                      // camelCase → "camel Case"
```

## Introspection functions

```ts
introspect(typeName, mode)                          // walk INPUT_OBJECT graph (filters/sorts)
resolveConnectionNodeType(connectionTypeName)       // Connection → Edge → Node type name
introspectColumns(typeName, visited)                // walk OBJECT graph for columns
```

## Filter/Sort UI functions

```ts
enable(inputField, mode)              // turn field on + cascade first child
topLevel(mode)                        // root-level inputFields for dropdown
searchFieldsFn(mode)                  // filter dropdown options by search text
activePaths(mode)                     // collect active branches as paths
changeNode(level, event, mode)        // swap selected option at a depth
addNext(level, mode)                  // enable next unused sibling
deletePath(path)                      // turn off nodes backwards along a path
sortPathKey(path)                     // stable identity string (e.g. "brand.name")
onSortDrop(idx)                       // handle sort row drop
```

## Column UI functions

```ts
enableColumn(field)                   // turn column on + get()
disableColumn(field)                  // turn column off + get()
moveColumn(fromIndex, toIndex)        // reorder + get()
availableColumns()                    // inactive root columns for dropdown
getSubFields(col)                     // scalar sub-fields of FK's related type
onColumnDrop(idx)                     // handle column row drop
```

## Query rebuild / pagination

```ts
get()                                 // central rebuild: edges.node + filter/sort/search/pagination
goToPage(n)                           // set offset + patch queryVariables.offset
```

## Watchers (anonymous, top-level)

```ts
watch(q_r, ...)                       // boot sequence after root introspection
watch(activeSortPaths, ...)           // sync sort_path_order
watch(activeColumns, ...)             // sync column_order
```
## DRY Consolidation Plan

> **HARD CONSTRAINT — ALL CODE STAYS IN `src/components/Home3.vue`.**
> No new files. No extracted child components (`.vue` or otherwise). No external composables or helper modules. Every refactor below must be expressible as plain functions, refs, computeds, and template blocks living inside the single `Home3.vue` file. Where this plan previously suggested a sub-component or composable, read it as "a local function / config object inside this file."

The code has three parallel domains — filters, sorts, columns — that were grown independently and now duplicate significant structure. The mode-keyed `{ filters, sorts }[mode]` pattern handles two of the three; columns live outside it. The biggest wins come from (a) folding columns into a shared "list manager" abstraction with filters/sorts, and (b) collapsing the repeated drag/order/search-dropdown scaffolding into shared local helpers and config-driven template loops.

Items are ordered by rough impact-to-risk ratio — earliest items are the cleanest wins.

> **Note on line references:** Line numbers cited below reflect the file state *before* the `TODO(DRY #N)` comments were inserted. The TODOs themselves are the canonical anchors going forward — grep `TODO(DRY #N)` in `Home3.vue` to locate the exact current line for any item.

### 1. Extract a generic ordered-list helper

**Duplication:** `orderedSortPaths` and `orderedColumns` run the same algorithm — map items by key, walk the order array, append newcomers. Their sync watchers (`watch(activeSortPaths)` and `watch(activeColumns)`) also do the same "remove stale keys, append new ones" logic.

**Proposed:** Two plain local functions inside `Home3.vue` — `applyOrder(items, order, keyFn)` and `syncOrder(activeItems, orderRef, keyFn)` — called from existing computeds and watchers. No composable, no new file. Collapses two computeds and two watchers into one shared primitive used for sorts, columns, and any future list.

**Touches:** [Home3.vue:638–672](src/components/Home3.vue:638), [Home3.vue:699–726](src/components/Home3.vue:699).

### 2. Extract a generic drag-reorder helper

**Duplication:** `drag_sort_idx`/`drag_over_sort_idx`/`onSortDrop` and `drag_col_idx`/`drag_over_col_idx`/`onColumnDrop` are structurally identical — two refs plus a splice-and-reinsert drop handler.

**Proposed:** A local factory function inside `Home3.vue` — `makeDragReorder(orderRef, onChange)` — returning `{ dragIdx, dragOverIdx, onDrop }`. Call it twice (once for sorts, once for columns). For the template, expose a computed `dragAttrs(reorder, rIdx)` that returns the full attribute bag (`draggable`, `@dragstart`, etc.) for `v-bind`, so each `<tr>` spreads it instead of repeating nine inline handlers. No sub-component.

**Touches:** refs at [Home3.vue:44–45](src/components/Home3.vue:44) and [Home3.vue:52–53](src/components/Home3.vue:52); handlers at [Home3.vue:678–690](src/components/Home3.vue:678) and [Home3.vue:768–774](src/components/Home3.vue:768); template at [Home3.vue:1230–1250](src/components/Home3.vue:1230) and [Home3.vue:1389–1408](src/components/Home3.vue:1389).

### 3. Unify "Add X" dropdown markup (in-file only)

**Duplication:** The Add Filter, Add Sort, and Add Column dropdowns share identical structure — primary button, `search_* = ''; nextTick(...focus)` click handler, search input, and a list of dropdown-items. Only the search ref, placeholder source, and item-selection callback differ.

**Proposed:** Since we cannot extract a sub-component, centralize the *behavior* instead of the markup: one local helper `openAddDropdown(searchRef, event)` that resets the ref and focuses the input (replacing three inline copies of the click handler). Optionally define a `panels` computed (array of `{ label, searchRef, items, onSelect }`) and keep the template duplication narrow — or accept the ~60 lines of parallel markup as the cost of single-file layout and DRY only the inline JS.

**Touches:** [Home3.vue:1016–1052](src/components/Home3.vue:1016), [Home3.vue:1178–1217](src/components/Home3.vue:1178), [Home3.vue:1341–1378](src/components/Home3.vue:1341).

### 4. Merge `searchFieldsFn` and `availableColumns`

**Duplication:** Both filter a root list by lowercased search text and exclude already-active items — just wired to different stores.

**Proposed:** One local helper `filterAvailable(items, searchStr)` used by all three panels. Removes `availableColumns` entirely and removes the mode branching inside `searchFieldsFn`. Stays inside `Home3.vue`.

**Touches:** [Home3.vue:472–479](src/components/Home3.vue:472) and [Home3.vue:751–758](src/components/Home3.vue:751).

### 5. Collapse the mode-dispatch pattern into a registry

**Duplication:** Five functions (`enable`, `topLevel`, `searchFieldsFn`, `activePaths`, `addNext`) start by looking up `{ filters, sorts }[mode]` and the matching `filter_root`/`sort_root` ref. The indirection is repeated in every function body.

**Proposed:** One local `const MODES = { filters: { store: filters, root: filter_root, ... }, sorts: { ... } }` registry at the top of the `<script setup>` block, passed into each function (or each function takes the resolved `{ store, root }` directly). Removes five repeated destructuring lookups and makes it trivial to add a third mode. All in-file.

**Touches:** [Home3.vue:438–537](src/components/Home3.vue:438), [Home3.vue:605–612](src/components/Home3.vue:605).

### 6. Bring columns into the same "list manager" abstraction

**Observation:** Columns already parallel sorts structurally (active set → ordered set → drag-reordered array → sync watcher → add/remove via dropdown). They differ only in leaf shape (single field vs. path) and payload builder. Items 1–5 already eliminate the shared scaffolding; step 6 is the conceptual payoff — treating all three as instances of one pattern with different node shapes.

**Proposed:** A local factory function inside `Home3.vue` — `makeListManager({ items, activeSelector, keyFn, initialOrder })` — returning `{ active, ordered, order, dragHandlers, availableForAdd, add, remove, moveTo }`. Filters, sorts, and columns each call it once with their own item shapes. Not a composable in a separate module — just a function declared above the three `const filterManager = makeListManager(...)` / `sortManager` / `columnManager` call sites.

**Benefit:** Enables drag-reorder for filters (currently sorts and columns both have drag-reorder; filters don't) essentially for free.

### 7. Break the `watch(q_r, ...)` boot into named steps

**Quirk:** The watcher at [Home3.vue:145–207](src/components/Home3.vue:145) mixes four separate initializations (fields, filters, sorts, columns) plus default-column setup plus the initial `get()` call, making ordering constraints implicit.

**Proposed:** Pull each step into a named helper — `initFiltersFrom(args)`, `initSortsFrom(args)`, `initColumnsFrom(rootField).then(initDefaultColumns)` — and have the watcher call them. Makes the "columns must finish before `get()`; filters/sorts need not be awaited" sequencing explicit. No behavior change.

### 8. Share the filter-payload / sort-payload path walker

**Duplication:** The payload builders in `get()` ([Home3.vue:856–871](src/components/Home3.vue:856) and [Home3.vue:884–899](src/components/Home3.vue:884)) both walk a path array and write deeply nested objects keyed by `node.name`, differing only in (a) per-path root object (single payload vs. array element) and (b) leaf emptiness skip rule.

**Proposed:** `function buildNestedFromPath(path, leafGuard)` → returns the nested object (or null if skipped). Filter side collects into one object; sort side pushes each result into an array.

### 9. Unify the two introspection queries

**Duplication:** `input_query` and `columns_query` share the `__variables`/`__type(name: $name)` envelope and the 3-deep `ofType` nesting. They differ only in requesting `inputFields` vs `fields` (and the extra `args` block on fields).

**Proposed:** A local helper `buildIntrospectionQuery(selectionSet)` inside `Home3.vue` that injects the envelope. Or simply declare a shared `const ofTypeFragment = { kind: true, name: true, ofType: { ... } }` object and spread it into both query literals. Mostly cosmetic but makes future schema-shape tweaks one-touch. In-file.

**Touches:** [Home3.vue:211–274](src/components/Home3.vue:211).

### 10. Simplify the filter-leaf input in-place

**Duplication:** The boolean/numeric/text branch at [Home3.vue:1117–1150](src/components/Home3.vue:1117) is a tight three-way conditional.

**Proposed:** Since we cannot extract a sub-component, the only available DRYing is (a) a small local helper `inputTypeFor(fieldType)` → `"number" | "text"` that replaces the inline `['Int','Decimal','Float'].includes(...) ? 'number' : 'text'`, and (b) a single `@change`/`@keyup.enter` wiring if the template is restructured. The three-branch template itself stays.

### 11. Simplify the data-table cell rendering in-place

**Duplication:** Three `<template v-if>` branches at [Home3.vue:1530–1544](src/components/Home3.vue:1530) for scalar / forward FK / connection rendering.

**Proposed:** Again, no sub-component — instead extract a local helper `renderCellValue(col, row)` that returns the string (or array of strings, for connections) to display, and have the template just call it. Collapses three `<template>` branches into one `{{ renderCellValue(col, h.node) }}` expression (or one `v-for` for the connection case). Keeps the single-file layout.

### 12. Remove dead state and unused bindings

**Verified dead in current file:**

- `a_get` — destructured from `useQuery` at [Home3.vue:808](src/components/Home3.vue:808) but never called.

**NOT present in current file (listed in docs/Home.md §Current Implementation Notes but verified absent by grep):**

- `fields` ref — no `const fields = ref(...)` declaration exists.
- Duplicate `Columns` count row — the three panel headers render their correct counts (`activeFilterPaths.length`, `activeSortPaths.length`, `orderedColumns.length`); no stray row.
- Connection metadata props (`filterType`, `orderByType`, `displayMode`, `pivotField`, `valueField`) — not set in `introspectColumns` or anywhere else.

`docs/Home.md` appears stale on these four items; worth a separate pass to update it.

**Proposed:** Delete `a_get` (it's the only real dead binding). Everything else under item 12 is a documentation-sync task, not a code change.

### Suggested sequencing

A natural order that minimizes rework:

1. Items **1, 2, 4, 12** are pure local extractions with no cross-cutting effects — do these first. (Item 12 is now just "delete `a_get`" per the verification above.)
2. Items **3, 10, 11** are in-file template/helper simplifications — do after #1–2 since they reuse those helpers.
3. Items **5, 7, 8, 9** are internal refactors that should land together as "normalize the mode dispatch".
4. Item **6** is the capstone and only makes sense once 1–5 are in place.

**Reminder:** every step above modifies only `src/components/Home3.vue`. If a step seems to require a new file or a child component to complete, stop and rescope it — the constraint is hard.


-----
-----

Done (11 of 12 items):

#9 Shared typeRef2/typeRef3 + makeTypeQuery() → input_query and columns_query collapsed to 5-line factory calls.
#12 Removed unused a_get destructuring.
#4 filterAvailable(items, searchStr) helper; searchFieldsFn and availableColumns now each 2 lines.
#1 applyOrder() + syncOrder() helpers; sorts and columns each reduced to one-line computed + one-line watcher.
#2 makeDragReorder(orderRef, onChange) factory; destructures into existing drag_*_idx / on*Drop names so template is unchanged. Deleted moveColumn.
#3 focusDropdownInput($event) helper; three 10-line inline handlers became one-liners.
#5 MODES = { filters, sorts } registry; enable/topLevel/searchFieldsFn/activePaths/changeNode/addNext all swapped to MODES[mode] lookup. Added type Mode.
#8 buildNestedFromPath(path, target?) helper; get()'s filter and sort payload builders collapse to short for-loops.
#7 Boot watcher split into initFiltersFrom, initSortsFrom, and async initColumnsFrom; explicit ordering.
#10 inputTypeFor(fieldType) helper; 8-line template expression → one-liner.
#11 cellText() + cellConnectionLines() helpers; three <template v-if> branches collapsed to two.
Skipped:

#6 (capstone makeListManager): with items 1/2/5 in place, each domain is already 3 lines. Wrapping them would add indirection without meaningful DRY gain; filters also can't cleanly participate since they use filterGrid, not an ordered flat list.
Stats:

Home3.vue: 254 insertions / 321 deletions → net −67 lines.
Type-check: 11 pre-existing errors in Home3.vue → 6 remaining (all in the untouched filterGrid); refactor introduced zero new errors.
npm run build: clean.