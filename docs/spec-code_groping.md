# Home3.vue — Code Grouping Spec

Proposed reorganization of `src/components/Home3.vue` into clearly-labeled sections. The top-level split is **DATA LOGIC** (schema introspection + live query) vs **UI LOGIC** (panel builders + data-table rendering), plus short isolated sections for pagination.

Within each section:
- **Helpers come first**, split into **UI helpers** and **Logic helpers** sub-lists.
- **Per-domain blocks** (Filters / Sorts / Columns) follow, each containing only what's specific to that domain.
- **Watchers are grouped at the end** of the section that owns their inputs.

Shared code (code used by more than one domain) lives in the section's helpers block (`Xa`), **never duplicated across domain blocks**.

---

## File layout (top to bottom)

```
<script setup lang="ts">
  imports
  CONSTANTS
  STATE
  1. DATA LOGIC — SCHEMA INTROSPECTION
  2. UI LOGIC — PANEL BUILDERS
  3. MAIN DATA QUERY
  4. DATA TABLE UI
  5. PAGINATION
</script>

<template> ... </template>
<style> ... </style>
```

---

## CONSTANTS

```
ROOT                // "tools" — GraphQL root query field
NON_MODEL_ARGS      // envelope args to strip from introspected input types
CONNECTION_FIELDS   // Relay envelope fields to strip from column introspection
```

---

## STATE

All top-level refs grouped by domain. No logic here — just ref declarations.

```
// Global UI
search              // main search box text
show_filters        // expand/collapse controls card
page_size           // results per page
paginationOffset    // zero-based offset (pagination source of truth)

// Shared dropdown search
search_dropdown     // single ref for all three Add-X dropdowns

// Filters
filter_root         // root INPUT_OBJECT type name
filters             // flat store of introspected filter types

// Sorts
sort_root           // root INPUT_OBJECT type name
sort_var_type       // full GraphQL variable type (e.g. "[ToolOrder!]")
sorts               // flat store of introspected sort types
sort_path_order     // user drag-and-drop priority (path keys)
{ drag_sort_idx, drag_over_sort_idx, onSortDrop, resetSortDrag }
  = makeDragReorder(sort_path_order, get)

// Columns
column_root         // root OBJECT type name (node type)
columns             // flat store of introspected OBJECT types
column_order        // user drag-and-drop column order
{ drag_col_idx, drag_over_col_idx, onColumnDrop, resetColumnDrag }
  = makeDragReorder(column_order, get)
```

> **Ordering note:** the two `makeDragReorder(..., get)` destructures reference a function and a ref declared later in the file. Works at runtime because `makeDragReorder` is a hoisted `function` declaration and `get` is read at drag-drop time (not at setup-time). If either ever becomes a `const` arrow, move the destructures into section 2a after their definitions.

---

## 1. DATA LOGIC — Schema Introspection

Discovers the ROOT query's filter, sort, and column types via `__type` introspection. Runs once on mount.

### 1a. Logic helpers

Logic helpers (pure utilities used by the queries and walkers):

```
stripTypename(obj)                   // recursively strip Apollo __typename keys
unwrapType(t)                        // peel NON_NULL/LIST → { varType, innerName, innerKind }
typeRef2, typeRef3                   // shared GraphQL "ofType" fragments (2-deep / 3-deep)
makeTypeQuery(selection)             // builds __type(name: $name) introspection envelope
```

### 1b. Queries + Apollo infra

```
fields_query                         // introspection of the Query type (finds ROOT's args)
useQuery(gql(jtg(fields_query)))
  → q_r, q_l, q_e                    // result / loading / error
introspecting                        // computed: !!(q_l || q_e) — gates Add buttons

input_query = makeTypeQuery({...})   // reusable INPUT_OBJECT introspection
columns_query = makeTypeQuery({...}) // reusable OBJECT introspection

resolveClient                        // from useApolloClient()

introspect(typeName, mode)           // INPUT_OBJECT walker (used by filters + sorts)
```

### 1c. Filters

```
initFiltersFrom(args)                // finds the `filter` arg, kicks off introspect()
```

### 1d. Sorts

```
initSortsFrom(args)                  // finds the `orderBy` arg, unwraps it, kicks off introspect()
```

### 1e. Columns

```
resolveConnectionNodeType(connName)  // Connection → Edge → Node (column-specific)
introspectColumns(typeName, visited) // OBJECT walker (column-specific)
initColumnsFrom(rootField)           // resolves ROOT's Connection, introspects, sets default columns, calls get()
```

### 1f. Watch

```
watch(q_r, (value) => {
  // 1. strip typename
  // 2. initFiltersFrom(args)  — fire-and-forget
  // 3. initSortsFrom(args)    — fire-and-forget
  // 4. initColumnsFrom(rootField) — awaits introspectColumns, then get()
})
```

---

## 2. UI LOGIC — Panel Builders

Filter / Sort / Column panel behavior: shared registry, per-domain computeds, sync watchers, and the `panels[]` config that drives the `v-for` in the template.

### 2a. Helpers

**UI helpers:**

```
camel(s)                             // "brandName" → "brand Name"
inputTypeFor(fieldType)              // "Int"|"Decimal"|"Float" → "number"; else "text"
focusDropdownInput(ev)               // resets search_dropdown + focuses the dropdown input
makeDragReorder(orderRef, onChange)  // factory: { dragIdx, dragOverIdx, onDrop, reset }
```

**Logic helpers:**

```
applyOrder(items, order, keyFn)      // reorder items by key array; non-ordered items appended
syncOrder(items, orderRef, keyFn)    // keep orderRef in sync: drop stale keys, append new
```

**Shared panel registry + path operations** (used by filter + sort; MODES used by all three):

```
MODES = {
  filters: { store: filters, root: filter_root, fieldsKey: "inputFields" },
  sorts:   { store: sorts,   root: sort_root,   fieldsKey: "inputFields" },
  columns: { store: columns, root: column_root, fieldsKey: "fields" },
}
type PanelKind = keyof typeof MODES          // filters | sorts | columns
type Mode = "filters" | "sorts"              // narrower — path-based only

topLevel(kind)                               // root-level fields of a panel's root type
filterAvailable(items, searchStr)            // non-active items matching search
searchFieldsFn(kind)                         // filterAvailable(topLevel(kind), search_dropdown)

enable(inputField, mode)                     // toggle field on + cascade first child (filter + sort)
activePaths(mode)                            // walk tree, collect active branches as paths
changeNode(level, event, mode)               // swap selected at a depth + get()
addNext(level, mode)                         // enable first inactive sibling; get() for sorts
deletePath(path)                             // turn off nodes backwards; get()
```

### 2b. Filters

```
activeFilterPaths                    // computed: activePaths("filters")
filterGrid                           // computed: 2D grid with rowspans from activeFilterPaths
```

### 2c. Sorts

```
sortPathKey(path)                    // stable identity key (e.g. "brand.name")
activeSortPaths                      // computed: activePaths("sorts")
orderedSortPaths                     // computed: applyOrder(activeSortPaths, sort_path_order, sortPathKey)
```

### 2d. Columns

```
activeColumns                        // computed: root node type fields where on === true
columnKey = (c) => c.name            // key function for orderedColumns + syncOrder
orderedColumns                       // computed: applyOrder(activeColumns, column_order, columnKey)

enableColumn(field)                  // field.on = true; get()
disableColumn(field)                 // field.on = false; get()
setDisplayField(col, value)          // update FK display sub-field; get()
getSubFields(col)                    // scalar sub-fields of an FK's related type
```

### 2e. Watchers

```
watch(activeSortPaths, paths => syncOrder(paths, sort_path_order, sortPathKey))
watch(activeColumns,  cols  => syncOrder(cols,  column_order,    columnKey))
```

### 2f. Panels config

```
panels = [
  { kind: "filters", label: "Filter", labelPlural: "Filters",
    count: () => activeFilterPaths.length, add: (f) => enable(f, "filters") },
  { kind: "sorts",   label: "Sort",   labelPlural: "Sorts",
    count: () => activeSortPaths.length,  add: (f) => { enable(f, "sorts"); get(); } },
  { kind: "columns", label: "Column", labelPlural: "Columns",
    count: () => orderedColumns.length,   add: (f) => enableColumn(f) },
]
```

---

## 3. MAIN DATA QUERY

Rebuilds the GraphQL document + variables from the current UI state and triggers a reactive refetch.

### 3a. Logic helpers

```
buildNestedFromPath(path, target)    // walk a path, write nested keys; used by get() for filter + sort payloads
```

### 3b. Query skeleton + Apollo

```
q                                    // mutable json-to-graphql-query skeleton
queryDoc                             // compiled gql document ref
queryVariables                       // variables ref

useQuery(queryDoc, queryVariables)
  → a_r, a_l, a_e                    // result / loading / error
```

### 3c. Query builder

```
get()                                // rebuild edges.node + filter/sort/search/pagination; swap queryDoc + queryVariables
```

---

## 4. DATA TABLE UI

Script-side helpers for rendering row cells in the main data table (the `<tbody>` in the template).

**UI helpers:**

```
cellText(col, row)                   // scalar or forward-FK → string
cellConnectionLines(col, row)        // connection → string[] (one line per edge)
```

---

## 5. PAGINATION

(`paginationOffset` lives in the STATE block.)

```
current_page                         // computed: floor(offset / page_size) + 1
goToPage(n)                          // set offset; patch queryVariables.offset (bypasses get())
```

---

## Placement rules (summary)

- A function used by **exactly one domain** lives in that domain's block (2b/2c/2d or 1c/1d/1e).
- A function used by **two or more domains** lives in the section's **`Xa. Helpers`** block — never duplicated.
- **UI vs Logic** helpers live under the same `Xa` but in separate sub-lists, so readers can find either quickly.
- **Watchers** are grouped at the end of the section that owns their inputs (`1f`, `2e`).
- **Config arrays** that drive the template (`panels[]`) come at the end of their section (`2f`).

---

## Where every function/var ends up

Quick lookup table for every top-level symbol:

| Symbol                          | Section |
| ------------------------------- | ------- |
| ROOT, NON_MODEL_ARGS, CONNECTION_FIELDS | CONSTANTS |
| search, show_filters, page_size, paginationOffset, search_dropdown | STATE |
| filter_root, filters            | STATE (Filters) |
| sort_root, sort_var_type, sorts, sort_path_order, sortDrag destructure | STATE (Sorts) |
| column_root, columns, column_order, columnDrag destructure | STATE (Columns) |
| stripTypename, unwrapType       | 1a |
| typeRef2, typeRef3, makeTypeQuery | 1a |
| fields_query, q_r, q_l, q_e, introspecting | 1b |
| input_query, columns_query      | 1b |
| resolveClient                   | 1b |
| introspect                      | 1b |
| initFiltersFrom                 | 1c |
| initSortsFrom                   | 1d |
| resolveConnectionNodeType, introspectColumns, initColumnsFrom | 1e |
| watch(q_r, ...)                 | 1f |
| camel, inputTypeFor, focusDropdownInput, makeDragReorder | 2a (UI helpers) |
| applyOrder, syncOrder           | 2a (Logic helpers) |
| MODES, PanelKind, Mode          | 2a |
| topLevel, filterAvailable, searchFieldsFn | 2a |
| enable, activePaths, changeNode, addNext, deletePath | 2a |
| activeFilterPaths, filterGrid   | 2b |
| sortPathKey, activeSortPaths, orderedSortPaths | 2c |
| activeColumns, columnKey, orderedColumns | 2d |
| enableColumn, disableColumn, setDisplayField, getSubFields | 2d |
| watch(activeSortPaths), watch(activeColumns) | 2e |
| panels                          | 2f |
| buildNestedFromPath             | 3a |
| q, queryDoc, queryVariables, a_r, a_l, a_e | 3b |
| get                             | 3c |
| cellText, cellConnectionLines   | 4 |
| current_page, goToPage          | 5 |
