# Home3.vue — Full Behavior Reference

This document describes how [`src/components/Home3.vue`](/Users/riordenweber/projects/compare.vue/src/components/Home3.vue:1) works today. It covers the full execution path: schema introspection, state initialization, dynamic query generation, filters, sorts, columns, table rendering, and pagination.

---

## What This Component Is

`Home3.vue` is a schema-driven GraphQL data explorer for a single root query field:

- `ROOT = "tools"`

Rather than hardcoding filter fields, sort fields, and table columns, the component introspects the GraphQL schema at runtime and builds the UI from that schema.

At a high level it does this:

1. Introspect the `Query` type to find the `tools` field.
2. Discover the `tools` field's filter and sort input types.
3. Discover the `tools` field's return node type by unwrapping the Relay connection shape.
4. Recursively introspect those input and object types.
5. Build filter, sort, and column UIs from the introspected type trees.
6. Rebuild the live GraphQL query whenever the user changes search, filters, sorts, columns, or pagination.

---

## Runtime Dependencies

`Home3.vue` assumes the following runtime setup:

- Apollo is provided at app bootstrap in [`src/main.ts`](/Users/riordenweber/projects/compare.vue/src/main.ts:15).
- `useQuery` is auto-imported by Vite from `@vue/apollo-composable` via [`vite.config.ts`](/Users/riordenweber/projects/compare.vue/vite.config.ts:10).
- The API base URL is resolved before app mount in [`src/ping_check.ts`](/Users/riordenweber/projects/compare.vue/src/ping_check.ts:1), then Apollo points to `${base}/graphql/`.

---

## Core Constants And State

### Constants

- `ROOT`
  The GraphQL root query field name. All introspection, data access, and rendering are built around this constant.

- `NON_MODEL_ARGS`
  Envelope/query-control args that should not be treated as model fields:
  `filter`, `first`, `last`, `before`, `after`, `offset`, `orderBy`, `and`, `or`, `not`.

- `CONNECTION_FIELDS`
  Relay envelope fields stripped during column object introspection:
  `edges`, `node`, `pageInfo`, `cursor`, `count`, `counts`.

### Main Refs

- `search`
  Global text search value. The search box lowercases user input before storing it.

- `show_filters`
  Controls whether the filters/sorts/columns card is expanded or collapsed.

- `page_size`
  Page size used for `first`.

- `fields`
  Stores discovered root query args that are considered model fields after filtering out envelope args and `ID` args. This is populated during introspection but is not currently rendered in the template.

- `filter_root`, `filters`, `search_fields`
  Filter root type name, flat filter type store, and dropdown search state.

- `sort_root`, `sort_var_type`, `sorts`, `search_sorts`
  Sort root type name, full GraphQL variable type string for `orderBy`, flat sort type store, and dropdown search state.

- `sort_path_order`, `drag_sort_idx`, `drag_over_sort_idx`
  Sort drag-and-drop ordering state.

- `column_root`, `columns`, `column_order`, `search_columns`
  Root node object type, flat object-type store for columns, user column order, and column dropdown search state.

- `drag_col_idx`, `drag_over_col_idx`
  Column drag-and-drop ordering state.

- `paginationOffset`
  Zero-based offset used for pagination.

---

## Helper Functions

### `stripTypename(obj)`

Recursively removes `__typename` keys from Apollo results before the component stores or transforms them.

Why it exists:

- Apollo cache normalization may inject `__typename`.
- The component uses introspection results as mutable UI state objects.
- Removing `__typename` avoids carrying Apollo metadata through the filter/sort/column state trees.

### `unwrapType(t)`

Recursively unwraps nested `NON_NULL` and `LIST` wrappers and returns:

- `varType`
  The full GraphQL variable type string, such as `String!` or `[ToolOrder!]`.
- `innerName`
  The innermost named type.
- `innerKind`
  The innermost GraphQL kind.

This is used in three places:

- getting the real `orderBy` input type
- getting the root connection type returned by `ROOT`
- resolving field types during column introspection

### `camel(s)`

Formats camelCase names for display by inserting spaces before capital letters.

Example:

- `brandName` -> `brand Name`

---

## Phase 1: Root Query Introspection

### `fields_query`

The component starts with a GraphQL introspection query against `__type(name: "Query")`.

It requests:

- every query field name
- field args and their nested type metadata
- field return type metadata

This gives the component enough information to find the `tools` query field and inspect both:

- its input args
- its return type

### `useQuery(gql(jtg(fields_query)))`

This introspection query runs automatically when the component is created.

Returned refs:

- `q_r`
  introspection result
- `q_l`
  introspection loading state
- `q_e`
  introspection error state

`q_l` and `q_e` are later used to disable parts of the UI and gate rendering of the controls card.

### `watch(q_r, ...)`

When the root introspection result arrives, the watcher performs the main boot sequence.

#### Step 1: Extract root query args into `fields`

The watcher:

1. finds the field whose name matches `ROOT`
2. reads its `args`
3. strips `__typename`
4. excludes names in `NON_MODEL_ARGS`
5. excludes args whose type name is `ID`

The result is assigned to `fields.value`.

Important note:

- `fields` is currently populated but not used by the template.

#### Step 2: Discover the filter root type

The watcher finds the `filter` arg on the `tools` field.

If present:

- `filter_root.value = filterArg.type.name`
- `introspect(filterArg.type.name, "filters")`

This kicks off recursive discovery of the filter input-object tree.

#### Step 3: Discover the sort root type

The watcher finds the `orderBy` arg on the `tools` field.

Because `orderBy` is often wrapped in `LIST` and `NON_NULL`, the watcher uses `unwrapType()` to recover:

- the full variable type string, stored in `sort_var_type`
- the inner input-object type name, stored in `sort_root`

If found:

- `introspect(innerName, "sorts")`

#### Step 4: Discover the root node type for columns

The watcher reads the return type of the `tools` query field.

Because `tools` returns a Relay-style connection rather than the row/node type directly, the watcher:

1. unwraps the return type to get the connection type name
2. calls `resolveConnectionNodeType(connectionName)`
3. stores the result in `column_root`
4. calls `introspectColumns(nodeTypeName)`

#### Step 5: Initialize default columns

After `introspectColumns()` finishes, the watcher sets default column state on the root node type:

- all root scalar fields are turned on
- each forward object relation gets a default `displayField`
  - this is the first scalar field found on the related object type
- `column_order` is initialized from the active root scalar fields

#### Step 6: Trigger the initial data query

Once the default columns are ready, the watcher calls `get()`.

This is the first live data fetch for the table.

Important sequencing detail:

- the filter and sort introspection calls are started but not awaited
- the initial table fetch waits on column introspection, not on the filter/sort trees

That means the initial results table can load even if the filter/sort trees are still filling in.

---

## Phase 2: Recursive Filter And Sort Type Introspection

### `input_query`

`input_query` is a reusable introspection query for any named GraphQL `INPUT_OBJECT` type.

It requests:

- the type's name and kind
- its `inputFields`
- each field's nested type metadata

### `introspect(typeName, mode)`

This function recursively walks an input-object graph and stores every discovered type in a flat reactive store.

Parameters:

- `typeName`
  The GraphQL input-object type to load.
- `mode`
  Either `"filters"` or `"sorts"`.

Behavior:

1. Resolve the active Apollo client with `useApolloClient()`.
2. Pick the correct store:
   - `filters` for filter mode
   - `sorts` for sort mode
3. Run `client.query(...)` with:
   - `query: gql(jtg(input_query))`
   - `variables: { name: typeName }`
   - `fetchPolicy: "cache-first"`
4. Strip `__typename`.
5. Remove any `inputFields` whose names are in `NON_MODEL_ARGS`.
6. Initialize UI state on the type object and every field:
   - `on = false`
   - `value = ""`
7. Upsert the type into the flat store by name.
8. Recursively load child `INPUT_OBJECT` fields in parallel using `Promise.all`.

Important implementation detail:

- The stores are flat arrays of types keyed by `name`, not nested trees.
- Traversal between parent and child types happens by looking up `field.type.name` in the store later.

Result:

- `filters.value` becomes a flat registry of the entire filter type graph.
- `sorts.value` becomes a flat registry of the entire sort type graph.

---

## Phase 3: Column Type Introspection

Columns use a separate introspection path because they operate on GraphQL object types rather than input-object types.

### `columns_query`

`columns_query` introspects any named object type and requests:

- the type name and kind
- its fields
- each field's args
- each field's nested return type metadata

This extra `args` data matters for connection fields because the component records any nested `filter` and `orderBy` arg types found on those connections.

### `resolveConnectionNodeType(connectionTypeName)`

This helper resolves the node type hidden inside a Relay connection.

It follows this path:

1. introspect the connection type
2. find its `edges` field
3. unwrap the edge type name
4. introspect the edge type
5. find its `node` field
6. unwrap and return the node type name

This function is used:

- once for the root `tools` return type
- again for any object field whose type name ends with `Connection`

### `introspectColumns(typeName, visited = new Set())`

This recursively walks object types used for table columns.

Behavior:

1. Bail out if the type name has already been visited.
2. Introspect the object type with `columns_query`.
3. Strip `__typename`.
4. Remove Relay envelope fields listed in `CONNECTION_FIELDS`.
5. For each field:
   - resolve its innermost type name and kind with `unwrapType()`
   - store them as `resolvedTypeName` and `resolvedTypeKind`
   - initialize column UI metadata:
     - `isConnection`
     - `nodeType`
     - `filterType`
     - `orderByType`
     - `displayMode`
     - `pivotField`
     - `valueField`
     - `displayField`
     - `on`
6. If the field is an object type whose name ends with `Connection`:
   - mark `isConnection = true`
   - capture nested `filter` and `orderBy` input type names from field args if present
   - resolve the connection's node type with `resolveConnectionNodeType()`
7. Upsert the object type into `columns.value`.
8. Recurse into child object types in parallel:
   - for plain objects, recurse into `resolvedTypeName`
   - for connections, recurse into `nodeType`

Important note:

- `filterType`, `orderByType`, `displayMode`, `pivotField`, and `valueField` are stored but not currently used by the template.
- `displayField` is used for forward object relations in the columns UI and table renderer.

Result:

- `columns.value` becomes a flat registry of every object type reachable from the root node type.

---

## Phase 4: Filter UI Model

The filter UI is path-based. A filter is not stored as a single flat row; it is stored as a branch through the introspected input-object graph.

### `topLevel("filters")`

Looks up `filter_root` in `filters.value` and returns its `inputFields`.

This powers the "Add Filter" dropdown.

### `searchFieldsFn("filters")`

Filters the top-level filter options by `search_fields` and excludes fields whose `on` flag is already true.

### `enable(inputField, "filters")`

Activates a field and recursively opens the first child branch until a leaf is reached.

For filters:

- leaves do not get default values
- leaf values stay `""` until the user enters something

This function mutates state only. It does not automatically fetch.

### `activePaths("filters")`

Walks the flat filter type store as if it were a tree and collects every active branch as a path array.

Each path node contains:

- `selected`
  the active field at that level
- `options`
  the full list of sibling options at that level
- `isLeaf`
  whether the selected field is a leaf
- `fieldType`
  GraphQL type name used by the template to choose the input control

In filter mode, a field is treated as a leaf when:

- `field.type.kind === "SCALAR"`
- or `field.type.name` is one of:
  `String`, `Boolean`, `Int`, `Float`, `Decimal`, `ID`

### `activeFilterPaths`

Computed wrapper around `activePaths("filters")`.

This is the main source for:

- building the filter payload in `get()`
- rendering the filter UI grid

### `filterGrid`

Transforms `activeFilterPaths` into a 2D grid with rowspans so shared ancestor branches are visually merged in the table-like filter UI.

For each visible cell it calculates how many consecutive rows below share the same branch prefix and stores:

- `level`
- `rowSpan`
- `colIdx`
- `rowIdx`

Cells hidden by a rowspan are marked as:

- `{ isSpanned: true }`

### `changeNode(level, event, "filters")`

Replaces the selected field at a given depth:

1. deactivate old field
2. activate new field
3. cascade into first child if needed

The template calls `get()` after this change because the active branch set changed.

### `addNext(level, "filters")`

Finds the first inactive sibling under the selected branch's child type and enables it.

The filter template does not call `get()` after `addNext()` because the new leaf starts blank and does not affect the query yet.

### `deletePath(path)`

Walks backward through a selected path and turns fields off.

It stops when a sibling at that same level is still active so that shared ancestors remain active for other paths.

The template calls `get()` after deletion.

---

## Phase 5: Sort UI Model

Sorts reuse most of the filter path logic, but the leaf behavior is different.

### `topLevel("sorts")`

Looks up `sort_root` in `sorts.value` and returns its `inputFields`.

### `searchFieldsFn("sorts")`

Filters top-level sort options by `search_sorts` and excludes active options.

### `enable(inputField, "sorts")`

For sorts:

- recursion continues only through `INPUT_OBJECT` fields
- non-`INPUT_OBJECT` leaves default to `value = "ASC"`

This is why a newly added sort becomes queryable immediately.

### `activePaths("sorts")`

In sort mode, a field is treated as a leaf when its type kind is anything other than `INPUT_OBJECT`.

That usually means the terminal sort direction enum.

### `activeSortPaths`

Computed wrapper around `activePaths("sorts")`.

### `sortPathKey(path)`

Builds a stable dot-separated identity string for a sort path.

Example:

- `brand.name`

### `orderedSortPaths`

Reorders `activeSortPaths` using the user-managed `sort_path_order` array.

Behavior:

- paths listed in `sort_path_order` come first in that stored order
- newly added paths not yet seen are appended afterward

### `watch(activeSortPaths, ...)`

Keeps `sort_path_order` synchronized with the actual active sort paths:

- remove stale keys
- append new keys

### Drag And Drop

Sort row drag-and-drop is implemented directly in the template using:

- `drag_sort_idx`
- `drag_over_sort_idx`
- `onSortDrop(idx)`

`onSortDrop(idx)`:

1. removes the dragged key from `sort_path_order`
2. inserts it at the target position
3. clears drag state
4. calls `get()`

Because sort priority is represented by array position in `orderBy`, drag reorder changes the query payload.

---

## Phase 6: Column UI Model

Columns are based on the introspected root node object type, not on the filter/sort input types.

### Default State

After root column introspection finishes:

- all root scalar fields are enabled
- all root forward object relations get a default `displayField`
- `column_order` starts with the enabled root scalar field names

### `activeColumns`

Computed list of active root-level fields:

- find the root object type in `columns.value`
- return fields where `field.on === true`

### `orderedColumns`

Reorders `activeColumns` according to `column_order`.

Any active column not yet present in `column_order` is appended.

### `watch(activeColumns, ...)`

Keeps `column_order` in sync:

- removes names for inactive columns
- appends names for newly activated columns

### `availableColumns()`

Returns root-level columns that are currently inactive and match `search_columns`.

This powers the "Add Column" dropdown.

### `enableColumn(field)`

- sets `field.on = true`
- calls `get()`

### `disableColumn(field)`

- sets `field.on = false`
- calls `get()`

### `moveColumn(fromIndex, toIndex)`

- reorders `column_order`
- calls `get()`

### `getSubFields(col)`

For a forward object relation, finds the related object type in `columns.value` and returns only its scalar fields.

This drives the display-field selector in the columns panel.

### Column Drag And Drop

Column row drag-and-drop uses:

- `drag_col_idx`
- `drag_over_col_idx`
- `onColumnDrop(idx)`

`onColumnDrop(idx)` delegates to `moveColumn(from, idx)`, which both updates order and triggers `get()`.

### Supported Column Types

The column system currently supports three render/query patterns:

1. Scalar field
   - query: request the field directly
   - render: show the scalar value directly

2. Forward object relation
   - query: request only the selected `displayField`
   - render: show `row[field][displayField]`

3. Connection relation
   - query: request `edges.node` plus every scalar field on the connection node type
   - render: flatten each returned edge node into a comma-separated string

Important limitation:

- the columns UI only manages root-level fields of the root node type
- it does not expose nested child columns beyond choosing a single `displayField` for forward relations

---

## Phase 7: Live Data Query

### Query Skeleton: `q`

`q` is a mutable JavaScript object in the format expected by `json-to-graphql-query`.

Initial shape:

- `query.__name = "MyQuery"`
- `query.__variables` starts with `first` and `offset`
- `query[ROOT].__args` starts with `first` and `offset`
- `query[ROOT].edges.node` starts as `{ id: true }`
- `query[ROOT].count = true`
- `query[ROOT].counts = true`

That initial shape is only a starting point. `get()` rebuilds the variable and arg sections every time.

### `queryDoc` And `queryVariables`

- `queryDoc`
  compiled GraphQL document
- `queryVariables`
  variables object for Apollo

Both are refs.

### `useQuery(queryDoc, queryVariables)`

This is the live data query for the table.

Returned refs:

- `a_r`
  table result data
- `a_l`
  table loading state
- `a_e`
  table error state
- `a_get`
  Apollo refetch function

Important note:

- `a_get` is currently destructured but not used.

### `get()`

`get()` is the central query-rebuild function.

It is called after most user actions that change query shape or variables.

#### Step 1: Reset pagination

`paginationOffset.value = 0`

This means any call to `get()` returns the user to page 1.

That is intentional for:

- new search text
- changed filters
- changed sorts
- changed columns
- changed page size

It is not used for direct page navigation, which bypasses `get()` and patches `queryVariables` directly.

#### Step 2: Rebuild `edges.node` from `orderedColumns`

If there are active columns, `get()` constructs a fresh `newNode` selection object.

Per column type:

- scalar
  - `newNode[col.name] = true`

- forward object relation
  - if `displayField` exists:
    - `newNode[col.name] = { [displayField]: true }`
  - otherwise fallback:
    - `newNode[col.name] = { id: true }`

- connection relation
  - find the connection node type in `columns.value`
  - collect all scalar fields on that node type
  - build:
    - `{ edges: { node: innerNode } }`
  - if no scalar fields are found, fallback to `{ id: true }`

Then:

- `q.query[ROOT].edges.node = newNode`

Important note:

- if `orderedColumns` is empty, `get()` does not overwrite `edges.node`
- in normal use this is avoided because the watcher enables all root scalar fields by default, but it is still the current code path

#### Step 3: Clear variable and arg declarations

`get()` resets:

- `q.query.__variables = {}`
- `q.query[ROOT].__args = {}`

Then it builds a fresh `newVariables` object.

#### Step 4: Build filter payload

`get()` walks `activeFilterPaths`.

Each path becomes nested objects inside a single `filterPayload`.

Example:

```text
[brand -> name -> icontains:"dewalt"]
```

becomes:

```json
{
  "brand": {
    "name": {
      "icontains": "dewalt"
    }
  }
}
```

Filter paths whose leaf value is `""` or `undefined` are skipped entirely.

If the final payload is non-empty:

- `q.query[ROOT].__args.filter = new VariableType("filter")`
- `q.query.__variables.filter = filter_root.value`
- `newVariables.filter = filterPayload`

#### Step 5: Build sort payload

`get()` walks `orderedSortPaths`.

Each sort path becomes its own nested object.

Example:

```text
[name -> ASC, brand -> name -> DESC]
```

becomes:

```json
[
  { "name": "ASC" },
  { "brand": { "name": "DESC" } }
]
```

If any sort objects exist:

- `q.query[ROOT].__args.orderBy = new VariableType("orderBy")`
- `q.query.__variables.orderBy = sort_var_type.value`
- `newVariables.orderBy = sortPayloads` if the type starts with `[`
- otherwise `newVariables.orderBy = sortPayloads[0]`

#### Step 6: Attach search variable

If `search.value` is truthy:

- `q.query[ROOT].__args.search = new VariableType("search")`
- `q.query.__variables.search = "String"`
- `newVariables.search = search.value`

The search input lowercases text before assigning it, so the outgoing search string is always lowercase.

#### Step 7: Attach pagination variables

If `page_size.value` is truthy, `get()` always declares both:

- `first`
- `offset`

and always includes both values in `newVariables`.

This matters because `goToPage()` later patches only `queryVariables.offset`, and that only works if `$offset` is present in the compiled query document.

This is a correction from older documentation:

- current code does include `offset: 0` on page 1

#### Step 8: Recompile and trigger Apollo

Finally:

- `queryDoc.value = gql(jtg(q))`
- `queryVariables.value = newVariables`

Apollo reacts to either change and re-runs the query.

---

## Phase 8: Pagination

### `paginationOffset`

True pagination source of truth.

### `current_page`

Computed as:

```ts
Math.floor(paginationOffset.value / page_size.value) + 1
```

This is display-only.

### `goToPage(n)`

When the user clicks a page button:

1. `paginationOffset.value = (n - 1) * page_size.value`
2. `queryVariables.value = { ...queryVariables.value, offset: paginationOffset.value }`

This does not call `get()`, because `get()` would reset offset to page 1.

### Page Size Input

The page size control is implemented inline in the template.

On change:

1. read the input value
2. coerce to number
3. apply `Math.abs(...)`
4. assign to `page_size`
5. call `get()`

This resets pagination back to page 1 and recompiles the query using the new `first`.

Potential edge case:

- `Math.abs(0)` is `0`
- if `page_size` becomes `0`, `get()` will skip adding `first` and `offset`, and pagination math becomes problematic
- this is current behavior; the input only has `min="1"` at the HTML level

---

## Phase 9: Template Behavior

### Header Area

The top of the page renders:

- breadcrumb with `Home` and `camel(ROOT)`
- title showing `a_r?.[ROOT]?.count || "--"` and `camel(ROOT)`

### Search Box

The search box:

- stores lowercase text into `search`
- calls `get()` on every input event
- shows a clear button when `search` is non-empty and the root introspection query is not loading
- clearing the button resets `search` and calls `get()`

Important note:

- the clear button is gated by `!q_l`, not `!a_l`

### Controls Card

The card only renders when `!q_e`.

When expanded, it contains:

1. filter builder
2. a standalone list item labeled `Columns` that displays `activeSortPaths.length`
3. sort builder
4. the actual column manager
5. collapse control

That standalone `Columns` count row is present in the current template and is separate from the actual columns panel below it.

### Filter Builder Rendering

The filter section uses `filterGrid` to render a merged-cell table UI.

Leaf value controls:

- `Boolean` -> `<select>` with blank / true / false
- `Int`, `Decimal`, `Float` -> `<input type="number">`
- everything else -> `<input type="text">`

Trigger behavior:

- boolean filters call `get()` on `change`
- number/text filters call `get()` only on Enter
- changing a branch selector calls `changeNode(...); get()`
- deleting a path calls `deletePath(...); get()`

### Sort Builder Rendering

The sort section renders one draggable row per path in `orderedSortPaths`.

Each row contains:

- drag handle
- branch controls
- leaf `ASC` / `DESC` selector
- delete button

Trigger behavior:

- adding a sort calls `enable(...); get()`
- changing a branch selector calls `changeNode(...); get()`
- changing sort direction calls `get()`
- deleting a path calls `deletePath(...); get()`
- dropping a row calls `onSortDrop(...)`

### Column Manager Rendering

The actual columns panel renders one draggable row per item in `orderedColumns`.

Each row contains:

- drag handle
- column name
- optional display-field selector for forward object relations
- delete button

Trigger behavior:

- adding a column calls `enableColumn(...)`
- deleting a column calls `disableColumn(...)`
- changing a forward relation `displayField` calls `get()`
- dropping a row calls `onColumnDrop(...)`

### Collapse And Summary Mode

When `show_filters` is false, the card collapses to a summary row showing:

- number of active filter paths
- number of ordered columns
- number of active sort paths

### Data Table Rendering

If `a_l` is true:

- show `Loading...`

Else if `a_e` exists:

- show the error

Else if `a_r?.[ROOT]?.count` is truthy:

- render the table

Else:

- show `No Results`

Table headers use:

- `camel(col.name)`
- and append ` > ${camel(col.displayField)}` when a forward relation display field is selected

Table body rendering per column type:

1. Scalar field
   - render `h.node[col.name]`

2. Forward object relation
   - render `h.node[col.name]?.[col.displayField]`

3. Connection relation
   - iterate `h.node[col.name]?.edges`
   - flatten `edge.node` values
   - if a nested value is itself an object, join its values with `": "`
   - join top-level values with `", "`

This connection rendering is intentionally generic and not schema-specific.

### Pagination Footer

When `a_r?.[ROOT]?.count` is truthy, the footer shows:

- "Showing X-Y of Z"
  - X = `paginationOffset + 1`
  - Y = `paginationOffset + (a_r?.[ROOT]?.counts || 0)`
  - Z = `a_r?.[ROOT]?.count`
- page number buttons for:
  - `Math.ceil((a_r?.[ROOT]?.count || 0) / page_size)`
- page size input

---

## Interaction Flows

### Initial Load

```text
component setup
  -> fields_query starts
  -> watch(q_r) waits for root introspection

root introspection resolves
  -> populate fields
  -> start filter input-type introspection
  -> start sort input-type introspection
  -> resolve root connection node type
  -> introspect root object graph for columns
  -> enable all root scalar columns
  -> assign default displayField for root forward relations
  -> initialize column_order
  -> get()
  -> Apollo live data query runs
```

### User Adds A Filter

```text
open Filter dropdown
  -> reset search_fields
  -> focus dropdown search input
  -> choose top-level field
  -> enable(field, "filters")
  -> cascade to first child until filter leaf
  -> leaf value remains blank

enter text/number and press Enter
  -> get()
  -> rebuild filter payload
  -> recompile query
  -> Apollo refetch
```

### User Adds A Boolean Filter

```text
enable filter path
  -> leaf is Boolean
  -> choose true/false in select
  -> get() on change
```

### User Adds A Sort

```text
open Sort dropdown
  -> reset search_sorts
  -> focus dropdown search input
  -> choose top-level field
  -> enable(field, "sorts")
  -> cascade until enum leaf
  -> default leaf value = ASC
  -> get()
  -> build orderBy payload
  -> Apollo refetch
```

### User Reorders Sorts

```text
drag row
  -> drag_sort_idx set
drop row
  -> onSortDrop(targetIndex)
  -> reorder sort_path_order
  -> clear drag state
  -> get()
```

### User Adds Or Removes Columns

```text
add column
  -> enableColumn(field)
  -> field.on = true
  -> get()

remove column
  -> disableColumn(field)
  -> field.on = false
  -> get()
```

### User Changes Page

```text
click page button
  -> goToPage(n)
  -> update paginationOffset
  -> patch queryVariables.offset
  -> Apollo refetch
```

### User Changes Page Size

```text
change page size input
  -> coerce to absolute number
  -> assign page_size
  -> get()
  -> reset to page 1
  -> Apollo refetch
```

---

## Reactive Dependency Map

```text
fields_query
  -> q_r
  -> watch(q_r)
       -> fields
       -> filter_root + introspect(..., "filters")
       -> sort_root + sort_var_type + introspect(..., "sorts")
       -> column_root + introspectColumns(...)
       -> default root columns
       -> get()

filters store
  -> topLevel("filters")
  -> searchFieldsFn("filters")
  -> activeFilterPaths
  -> filterGrid

sorts store
  -> topLevel("sorts")
  -> searchFieldsFn("sorts")
  -> activeSortPaths
  -> watch(activeSortPaths)
  -> orderedSortPaths

columns store
  -> activeColumns
  -> orderedColumns
  -> availableColumns()
  -> getSubFields()

get()
  -> orderedColumns
  -> activeFilterPaths
  -> orderedSortPaths
  -> search
  -> page_size
  -> paginationOffset
  -> queryDoc
  -> queryVariables

queryDoc + queryVariables
  -> useQuery(...)
  -> a_r / a_l / a_e
  -> template
```

---

## Current Implementation Notes

- `fields.value` is populated but currently unused in the template.
- `a_get` is destructured from Apollo's live query but not currently used.
- Several connection-field metadata properties are stored on columns but not yet surfaced in the UI.
- The expanded controls card includes an extra standalone `Columns` count row that currently displays `activeSortPaths.length`.
- Filter text/number inputs fetch on Enter, not on every keystroke.
- Search input does fetch on every keystroke.
- `get()` always resets pagination to page 1.

This document is intended to match the current implementation, including behavior that may later be refactored.
