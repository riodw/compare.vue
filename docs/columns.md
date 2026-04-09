# Plan: Column Introspection — Data Fetching, Storage & Query Rebuilding

## Context

Home3.vue has a dynamic GraphQL query builder with filter and sort introspection. Both use `introspect()` to recursively walk INPUT_OBJECT trees, store results in flat refs, and rebuild the query in `get()`. The `edges.node` selection set is currently hardcoded. This plan adds a parallel columns system that introspects OBJECT types (return types), stores them in the same flat-store pattern, and rebuilds `edges.node` dynamically. Columns use the same `.on` pattern as filters/sorts — no separate "active" array. A `column_order` ref (mirroring `sort_path_order`) tracks left-to-right display order. Logic only — no HTML/template changes.

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
```

No `columns_active` array. Which columns are shown is determined by `.on` on each field in the `columns` store (same pattern as filters/sorts). The `column_order` ref tracks left-to-right display order (same pattern as `sort_path_order` tracks sort priority).

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
2. If OBJECT + connection detected → `isConnection: true`, extract `filterType`/`orderByType` from `field.args`
3. If connection → call `resolveConnectionNodeType` to get `nodeType`, recurse into that
4. If plain OBJECT → recurse directly
5. Init UI state: `field.on = false`

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
- **Connection** → `node[name] = { edges: { node: { scalarChild: true, ... } } }` (inject envelope + fetch scalar children of node type)

Then: `q.query[ROOT].edges.node = newNode`

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
function enableColumn(field: any)    // field.on = true; get()  — or reuse enable() with "columns" mode
function disableColumn(field: any)   // field.on = false; get()
function moveColumn(from: number, to: number)  // reorder column_order, call get()
function availableColumns()          // root type fields where .on === false
```

`enableColumn` / `disableColumn` toggle `.on` on the field object directly (same objects in the `columns` store). If `enable()` is extended to support `"columns"` mode, `enableColumn` can just call `enable(field, "columns")`. For flat scalars no cascading is needed; for OBJECT/connection columns, `enable()` can cascade into the first child of the related type.

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
      { name: "name",  resolvedTypeKind: "SCALAR",  isConnection: false, on: true },
      { name: "brand", resolvedTypeKind: "OBJECT",  isConnection: false, resolvedTypeName: "BrandNode", on: false },
      { name: "toolMetrics", resolvedTypeKind: "OBJECT", isConnection: true,
        nodeType: "ToolMetricNode",
        filterType: "ToolMetricNodeToolMetricFilterFilterInputType",
        orderByType: "ToolMetricNodeToolMetricOrderOrderInputType",
        on: false },
    ]
  },
  { name: "BrandNode", fields: [...] },
  { name: "ToolMetricNode", fields: [...] },
]

// column_order mirrors sort_path_order:
column_order.value = ["name", "weight", "price", ...]  // only .on fields, user-reorderable
```

## Verification

1. Page load → network tab shows column introspection queries firing in parallel with filter/sort introspection
2. `columns.value` populated with OBJECT types, connection fields flagged correctly
3. Scalar fields have `.on = true` by default; `column_order` initialized with their names
4. `orderedColumns` computed returns active fields in user's drag order
5. `q.query[ROOT].edges.node` rebuilt from `orderedColumns` in `get()`
6. Table renders dynamically (existing template already reads from `Object.keys(q.query[ROOT].edges.node)`)
7. Toggling `.on` on a field + calling `get()` adds/removes it from the query and table
8. Reordering `column_order` + calling `get()` changes column left-to-right display order
9. Connection fields (e.g., `toolMetrics`) have `filterType` and `orderByType` stored for future lazy-loading
