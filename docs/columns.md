# Plan: Column Introspection — Data Fetching, Storage & Query Rebuilding

## Context

Home3.vue has a dynamic GraphQL query builder with filter and sort introspection. Both use `introspect()` to recursively walk INPUT_OBJECT trees, store results in flat refs, and rebuild the query in `get()`. The `edges.node` selection set is currently hardcoded. This plan adds a parallel columns system that introspects OBJECT types (return types), stores them in the same flat-store pattern, and rebuilds `edges.node` dynamically from an ordered active-columns array. Logic only — no HTML/template changes.

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
const columns = ref<any[]>([]);            // flat store of introspected OBJECT types
const column_root = ref("");               // root node type name (e.g., "ToolNode")
const columns_active = ref<string[]>([]);  // ordered active column field names
```

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
5. On completion: initialize `columns_active` with all scalar fields, then call `get()`

All three trees (filters, sorts, columns) fire in parallel from the watcher. `cache-first` handles overlap.

---

## Step 8 — Modify `get()` to rebuild `edges.node` from `columns_active`

Insert at the start of `get()`, before variables reset. Walk `columns_active`, look up each field in the `columns` store, and build the node object:

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
function addColumn(fieldName: string, position?: number)  // insert into columns_active, call get()
function removeColumn(fieldName: string)                   // remove from columns_active, call get()
function moveColumn(fromIndex: number, toIndex: number)    // reorder columns_active, call get()
function availableColumns()                                // fields NOT in columns_active
function getColumnMeta(fieldName: string)                  // look up full field metadata by name
```

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
                 └→ columns_active initialized
                 └→ get()  ← rebuilds edges.node + recompiles query
```

## Column Store Shape

```ts
columns.value = [
  {
    name: "ToolNode",
    fields: [
      { name: "name",  resolvedTypeKind: "SCALAR",  isConnection: false },
      { name: "brand", resolvedTypeKind: "OBJECT",  isConnection: false, resolvedTypeName: "BrandNode" },
      { name: "toolMetrics", resolvedTypeKind: "OBJECT", isConnection: true,
        nodeType: "ToolMetricNode",
        filterType: "ToolMetricNodeToolMetricFilterFilterInputType",
        orderByType: "ToolMetricNodeToolMetricOrderOrderInputType" },
    ]
  },
  { name: "BrandNode", fields: [...] },
  { name: "ToolMetricNode", fields: [...] },
]
```

## Verification

1. Page load → network tab shows column introspection queries firing in parallel with filter/sort introspection
2. `columns.value` populated with OBJECT types, connection fields flagged correctly
3. `columns_active.value` initialized with scalar field names
4. `q.query[ROOT].edges.node` rebuilt from active columns in `get()`
5. Table renders dynamically (existing template already reads from `Object.keys(q.query[ROOT].edges.node)`)
6. `addColumn` / `removeColumn` / `moveColumn` trigger `get()` and table updates
7. Connection fields (e.g., `toolMetrics`) have `filterType` and `orderByType` stored for future lazy-loading
