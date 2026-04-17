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
## Remediation Plan — Notable Quirks
