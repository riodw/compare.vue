<script setup lang="ts">
import gql from "graphql-tag";
import {
  jsonToGraphQLQuery as jtg,
  VariableType,
} from "json-to-graphql-query";
import { ref, watch, computed, nextTick, type Ref } from "vue";
import { useApolloClient } from "@vue/apollo-composable";
import { useQueryStateStore } from "@/stores/queryState";
import { findLocalPath, activateLocalPath } from "@/utils/reconcileFilters";

// ================================================================
// CONSTANTS
// ================================================================

// The GraphQL root query field name — change this to point at a different model
const ROOT = "toolMetrics";

// Args that belong to the query envelope (pagination, filtering, sorting, logical operators)
// rather than the model's own scalar fields. Used to separate model fields from control args.
const NON_MODEL_ARGS = [
  "filter",
  "first",
  "last",
  "before",
  "after",
  "offset",
  "orderBy",
  "and",
  "or",
  "not",
];

// Relay envelope fields stripped during column object introspection.
const CONNECTION_FIELDS = [
  "edges",
  "node",
  "pageInfo",
  "cursor",
  "count",
  "counts",
];

// ================================================================
// STATE
//    All top-level refs grouped by domain. The drag destructures
//    rely on `makeDragReorder` (defined in §2a) and `get` (§3c)
//    being reachable via function-declaration hoisting.
// ================================================================

// ---- Global State ----
const search = ref(""); // global search input
const show_filters = ref(true); // toggle the filters/sorts panel
const page_size = ref(100); // results per page
const paginationOffset = ref(0); // zero-based offset into the result set (pagination source of truth)

// Single search input for whichever Add dropdown (filter/sort/column) is currently open.
// Only one dropdown is ever visible at a time, so one shared ref is enough.
const search_dropdown = ref("");

// ---- Filters ----
const filter_root = ref(""); // root INPUT_OBJECT type name (e.g. "ToolFilter")
const filters = ref<any[]>([]); // flat store of all introspected filter INPUT_OBJECT types

// ---- Sorts ----
const sort_root = ref(""); // root INPUT_OBJECT type name (e.g. "ToolOrder")
const sort_var_type = ref(""); // full GraphQL variable type string e.g. "[ToolOrder!]"
const sorts = ref<any[]>([]); // flat store of all introspected sort INPUT_OBJECT types
const sort_path_order = ref<string[]>([]); // user's drag-and-drop sort priority (path keys)
const {
  dragIdx: drag_sort_idx,
  dragOverIdx: drag_over_sort_idx,
  onDrop: onSortDrop,
  reset: resetSortDrag,
} = makeDragReorder(sort_path_order, get);

// ---- Columns ----
const column_root = ref(""); // root OBJECT type name (e.g. "ToolNode")
const columns = ref<any[]>([]); // flat store of introspected OBJECT types
const column_order = ref<string[]>([]); // user's drag-and-drop column order (field names)
const {
  dragIdx: drag_col_idx,
  dragOverIdx: drag_over_col_idx,
  onDrop: onColumnDrop,
  reset: resetColumnDrag,
} = makeDragReorder(column_order, get);

// ---- Shared Cross-Page Query State ----
// Pinia store holding canonical filters that persist across pages + refresh.
// See docs/spec-cross_page_introspection_query_state.md.
const queryState = useQueryStateStore();
// Guard flag: suppress store writes while reconciliation is actively setting
// local filter state from the store (avoids feedback loops).
let isReconciling = false;

// ================================================================
// 1. DATA LOGIC — SCHEMA INTROSPECTION
//    Discovers the ROOT query's filter, sort, and column types via
//    __type introspection. Runs once on mount via watch(q_r) (§1f).
// ================================================================

// ----------------------------------------------------------------
// 1a. Logic helpers
// ----------------------------------------------------------------

/** Recursively strip __typename fields injected by Apollo cache */
const stripTypename = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(stripTypename);
  if (obj && typeof obj === "object") {
    const { __typename, ...rest } = obj;
    for (const key in rest) rest[key] = stripTypename(rest[key]);
    return rest;
  }
  return obj;
};

/** Recursively peel NON_NULL and LIST wrappers to find the inner type name and kind. */
function unwrapType(t: any): {
  varType: string;
  innerName: string;
  innerKind: string;
} {
  if (!t) return { varType: "", innerName: "", innerKind: "" };
  if (t.kind === "NON_NULL") {
    const inner = unwrapType(t.ofType);
    return {
      varType: inner.varType + "!",
      innerName: inner.innerName,
      innerKind: inner.innerKind,
    };
  }
  if (t.kind === "LIST") {
    const inner = unwrapType(t.ofType);
    return {
      varType: `[${inner.varType}]`,
      innerName: inner.innerName,
      innerKind: inner.innerKind,
    };
  }
  return {
    varType: t.name || "",
    innerName: t.name || "",
    innerKind: t.kind || "",
  };
}

// Shared type-ref fragments for introspection queries.
// typeRef2 covers LIST(NON_NULL(Type)) — enough for INPUT_OBJECT field types.
// typeRef3 adds one more level of nesting for NON_NULL(LIST(NON_NULL(Type))) — used by OBJECT fields/args.
const typeRef2 = {
  kind: true,
  name: true,
  ofType: { kind: true, name: true },
};
const typeRef3 = { kind: true, name: true, ofType: typeRef2 };

/** Build an introspection query envelope for `__type(name: $name)` with a custom selection set. */
function makeTypeQuery(selection: any) {
  return {
    query: {
      __variables: { name: "String!" },
      __type: {
        __args: { name: new VariableType("name") },
        name: true,
        kind: true,
        ...selection,
      },
    },
  };
}

// ----------------------------------------------------------------
// 1b. Queries + Apollo infra
// ----------------------------------------------------------------

// Introspect the top-level Query type to find all args for ROOT.
// ofType is nested 2 deep to handle LIST(NON_NULL(Type)) wrappers.
const fields_query = {
  query: {
    __type: {
      __args: { name: "Query" },
      name: true,
      kind: true,
      fields: {
        name: true,
        description: true,
        args: {
          name: true,
          description: true,
          defaultValue: true,
          type: {
            kind: true,
            name: true,
            description: true,
            ofType: {
              kind: true,
              name: true,
              ofType: {
                kind: true,
                name: true,
              },
            },
          },
        },
        // Return type of each field — needed by column introspection to discover
        // the ROOT field's Connection type and ultimately the node OBJECT type.
        type: {
          kind: true,
          name: true,
          ofType: {
            kind: true,
            name: true,
            ofType: {
              kind: true,
              name: true,
            },
          },
        },
      },
    },
  },
};

const {
  result: q_r,
  loading: q_l,
  error: q_e,
} = useQuery(gql(jtg(fields_query)));

/** True while the schema introspection is loading or errored — gates the Add buttons. */
const introspecting = computed(() => !!(q_l.value || q_e.value));

// Reusable introspection query — fetches inputFields for any named INPUT_OBJECT type.
// Used by introspect() via separate lazy query instances for filters and sorts.
const input_query = makeTypeQuery({
  inputFields: {
    name: true,
    type: typeRef2,
  },
});

// Introspection query for OBJECT types — fetches fields (not inputFields) and
// includes args on each field to discover filter/orderBy types on connections.
const columns_query = makeTypeQuery({
  fields: {
    name: true,
    args: {
      name: true,
      type: typeRef3,
    },
    type: typeRef3,
  },
});

const { resolveClient } = useApolloClient();

/**
 * Shared introspection preamble — the truly identical prefix of both walkers:
 *   1. Run `query` with { name: typeName } (cache-first)
 *   2. Bail (return null) if the result lacks the expected `[fieldsKey]` list
 *   3. Strip __typename recursively
 *   4. Drop envelope fields whose names are in `envelopeNames`
 *
 * Returns the decorated type object ready for per-walker field decoration + store upsert,
 * or null if the type isn't found or has no fields of the expected shape.
 */
async function fetchType(
  typeName: string,
  query: any,
  fieldsKey: "inputFields" | "fields",
  envelopeNames: string[]
): Promise<any | null> {
  const client = resolveClient();
  const { data } = await client.query({
    query: gql(jtg(query)),
    variables: { name: typeName },
    fetchPolicy: "cache-first",
  });
  if (!data?.__type?.[fieldsKey]) return null;

  const typeObj = stripTypename(data.__type);
  typeObj[fieldsKey] = typeObj[fieldsKey].filter(
    (f: any) => !envelopeNames.includes(f.name)
  );
  return typeObj;
}

/**
 * Walk an INPUT_OBJECT type graph, storing each type in the mode's store.
 * Each type and its inputFields get `on`/`value` UI state.
 * "filters" = filter introspection, "sorts" = order introspection.
 * All sibling branches at each level are fetched in parallel via Promise.all.
 * A shared `visited` set prevents infinite recursion on cyclic graphs
 * (e.g. ToolFilter -> BrandFilter -> ToolFilter).
 */
async function introspect(
  typeName: string,
  mode: "filters" | "sorts",
  visited = new Set<string>()
) {
  if (visited.has(typeName)) return;
  visited.add(typeName);
  const inf = await fetchType(
    typeName,
    input_query,
    "inputFields",
    NON_MODEL_ARGS
  );
  if (!inf) return;

  const store = { filters, sorts }[mode];

  // Initialize UI toggle state on the type and each field
  inf.on = false;
  inf.value = "";
  inf.inputFields.forEach((o: any) => {
    o.on = false;
    o.value = "";
  });

  // Upsert into the flat store (avoid duplicates on re-fetch)
  const existingIndex = store.value.findIndex((f: any) => f.name === inf.name);
  if (existingIndex !== -1) Object.assign(store.value[existingIndex], inf);
  else store.value.push(inf);

  // Recurse into all INPUT_OBJECT children in parallel, sharing the visited set
  await Promise.all(
    inf.inputFields
      .filter((o: any) => o.type.kind === "INPUT_OBJECT")
      .map((o: any) => introspect(o.type.name, mode, visited))
  );
}

// ----------------------------------------------------------------
// 1c. Filters
// ----------------------------------------------------------------

/** Kick off filter-tree introspection from the ROOT query's `filter` arg. Fire-and-forget. */
function initFiltersFrom(args: any[]) {
  const filterArg = args.find((o: any) => o.name === "filter");
  if (!filterArg?.type?.name) return;
  filter_root.value = filterArg.type.name;
  introspect(filterArg.type.name, "filters");
}

// ----------------------------------------------------------------
// 1d. Sorts
// ----------------------------------------------------------------

/** Kick off sort-tree introspection from the ROOT query's `orderBy` arg. Fire-and-forget. */
function initSortsFrom(args: any[]) {
  const orderByArg = args.find((o: any) => o.name === "orderBy");
  if (!orderByArg) return;
  const { varType, innerName } = unwrapType(orderByArg.type);
  if (!innerName) return;
  sort_root.value = innerName;
  sort_var_type.value = varType;
  introspect(innerName, "sorts");
}

// ----------------------------------------------------------------
// 1e. Columns
// ----------------------------------------------------------------

/**
 * Resolve a Relay Connection type to its inner node type name.
 * Follows: ConnectionType → edges field → EdgeType → node field → NodeType
 */
async function resolveConnectionNodeType(
  connectionTypeName: string
): Promise<string | null> {
  const client = resolveClient();

  // Step 1: Introspect the Connection type to find its "edges" field
  const { data } = await client.query({
    query: gql(jtg(columns_query)),
    variables: { name: connectionTypeName },
    fetchPolicy: "cache-first",
  });
  if (!data?.__type?.fields) return null;

  const edgesField = stripTypename(data.__type.fields).find(
    (f: any) => f.name === "edges"
  );
  if (!edgesField) return null;

  // Step 2: Introspect the Edge type to find its "node" field
  const edgesTypeName = unwrapType(edgesField.type).innerName;
  if (!edgesTypeName) return null;

  const { data: edgeData } = await client.query({
    query: gql(jtg(columns_query)),
    variables: { name: edgesTypeName },
    fetchPolicy: "cache-first",
  });
  if (!edgeData?.__type?.fields) return null;

  // Step 3: Return the node's inner type name (e.g. "ToolMetricNode")
  const nodeField = stripTypename(edgeData.__type.fields).find(
    (f: any) => f.name === "node"
  );
  if (!nodeField) return null;

  return unwrapType(nodeField.type).innerName;
}

/**
 * Walk an OBJECT type graph, storing each type in `columns`.
 * Detects Relay connection patterns and unwraps them transparently.
 * Uses a visited set to prevent infinite loops on circular type references.
 */
async function introspectColumns(
  typeName: string,
  visited = new Set<string>()
) {
  if (visited.has(typeName)) return;
  visited.add(typeName);

  const typeObj = await fetchType(
    typeName,
    columns_query,
    "fields",
    CONNECTION_FIELDS
  );
  if (!typeObj) return;

  // Process each field: resolve types, detect connections, extract metadata
  for (const field of typeObj.fields) {
    const { innerName, innerKind } = unwrapType(field.type);
    field.resolvedTypeName = innerName;
    field.resolvedTypeKind = innerKind;

    field.isConnection = false;
    field.nodeType = null;
    field.displayField = null; // for FK OBJECTs: which sub-field to show (e.g. "name")

    // Connection detection: if the resolved type ends with "Connection",
    // this is a backward/many relationship using Relay's connection pattern.
    // Resolve the inner node type so the user sees the real type, not the envelope.
    if (innerKind === "OBJECT" && innerName?.endsWith("Connection")) {
      field.isConnection = true;

      // Resolve Connection → Edge → Node to get the actual node type name
      const nodeTypeName = await resolveConnectionNodeType(innerName);
      if (nodeTypeName) field.nodeType = nodeTypeName;
    }

    field.on = false; // all fields start inactive; watcher initializes defaults
  }

  // Upsert into the flat store
  const existingIndex = columns.value.findIndex(
    (c: any) => c.name === typeObj.name
  );
  if (existingIndex !== -1)
    Object.assign(columns.value[existingIndex], typeObj);
  else columns.value.push(typeObj);

  // Recurse into OBJECT children in parallel
  await Promise.all(
    typeObj.fields
      .filter((f: any) => f.resolvedTypeKind === "OBJECT")
      .map((f: any) => {
        const target = f.isConnection ? f.nodeType : f.resolvedTypeName;
        return target ? introspectColumns(target, visited) : Promise.resolve();
      })
  );
}

/**
 * Resolve ROOT's Connection node type and introspect its object graph, then
 * enable default columns (all scalars + first scalar of each forward FK) and run
 * the initial data query. Awaited so `get()` fires with columns populated.
 */
async function initColumnsFrom(rootField: any) {
  if (!rootField?.type) return;
  const { innerName: connectionName } = unwrapType(rootField.type);
  if (!connectionName) return;
  const nodeTypeName = await resolveConnectionNodeType(connectionName);
  if (!nodeTypeName) return;
  column_root.value = nodeTypeName;
  await introspectColumns(nodeTypeName);

  // Default: turn on all scalar fields of the root node type
  const rootType = columns.value.find((c: any) => c.name === nodeTypeName);
  if (rootType?.fields) {
    for (const field of rootType.fields) {
      if (field.resolvedTypeKind === "SCALAR") field.on = true;
      // Default displayField for FK columns to the first scalar child
      if (
        field.resolvedTypeKind === "OBJECT" &&
        !field.isConnection &&
        field.resolvedTypeName
      ) {
        const related = columns.value.find(
          (c: any) => c.name === field.resolvedTypeName
        );
        const firstScalar = related?.fields?.find(
          (rf: any) => rf.resolvedTypeKind === "SCALAR"
        );
        if (firstScalar) field.displayField = firstScalar.name;
      }
    }
    column_order.value = rootType.fields
      .filter((f: any) => f.on)
      .map((f: any) => f.name);
  }
  get();
}

// ----------------------------------------------------------------
// 1f. Boot watcher
// ----------------------------------------------------------------

// When the schema introspection returns, discover the filter, sort, and column types.
// Filters and sorts are fire-and-forget; columns must finish before get() so the initial
// query has an accurate edges.node selection.
watch(
  q_r,
  (value) => {
    const rootField = value?.__type?.fields?.find(
      (field: any) => field.name === ROOT
    );
    const args = stripTypename(rootField?.args) || [];

    initFiltersFrom(args);
    initSortsFrom(args);
    initColumnsFrom(rootField);
  },
  // `immediate: true` handles the component-remount case: on a second
  // mount of any page, Apollo's cache-first delivery may populate `q_r`
  // synchronously during setup — before this watcher is registered —
  // so the normal "on change" trigger never fires. Immediate makes the
  // callback run once at registration with whatever value `q_r` has.
  { immediate: true }
);

// ================================================================
// 2. UI LOGIC — Panel Builders
//    Filter / Sort / Column panel behavior. Shared registry + path
//    operations live in 2a; per-domain state/computeds in 2b–2d;
//    sync watchers in 2e; panels config in 2f.
// ================================================================

// ----------------------------------------------------------------
// 2a. Helpers (UI + Logic + shared panel registry + path operations)
// ----------------------------------------------------------------

// ---- UI helpers ----

/** Convert camelCase to spaced words for display: "brandName" → "brand Name" */
function camel(s: string) {
  return s.replace(/([A-Z])/g, " $1").trim();
}

/** HTML input type for a GraphQL scalar field type — numeric types use number inputs. */
function inputTypeFor(fieldType: string): "number" | "text" {
  return ["Int", "Decimal", "Float"].includes(fieldType) ? "number" : "text";
}

/**
 * Reset the shared dropdown search text and focus the dropdown's input once Vue flushes.
 * Called from every "Add X" button — the three dropdowns share one search ref.
 */
function focusDropdownInput(ev: Event) {
  search_dropdown.value = "";
  const trigger = ev.currentTarget as HTMLElement | null;
  nextTick(() =>
    trigger?.nextElementSibling
      ?.querySelector<HTMLInputElement>("input")
      ?.focus()
  );
}

/** Drag-and-drop reorder state + onDrop handler for a list whose order lives in `orderRef`. */
function makeDragReorder(orderRef: Ref<string[]>, onChange?: () => void) {
  const dragIdx = ref<number | null>(null);
  const dragOverIdx = ref<number | null>(null);
  function reset() {
    dragIdx.value = null;
    dragOverIdx.value = null;
  }
  function onDrop(idx: number) {
    const from = dragIdx.value;
    if (from === null || from === idx) return reset();
    const order = [...orderRef.value];
    const [moved] = order.splice(from, 1);
    if (moved !== undefined) order.splice(idx, 0, moved);
    orderRef.value = order;
    reset();
    onChange?.();
  }
  return { dragIdx, dragOverIdx, onDrop, reset };
}

// ---- Logic helpers ----

/** Reorder items by keyFn against an order array; items whose keys aren't in order are appended. */
function applyOrder<T>(
  items: T[],
  order: string[],
  keyFn: (x: T) => string
): T[] {
  const byKey = new Map(items.map((x) => [keyFn(x), x]));
  const result: T[] = [];
  for (const key of order) {
    const x = byKey.get(key);
    if (x) {
      result.push(x);
      byKey.delete(key);
    }
  }
  for (const x of byKey.values()) result.push(x);
  return result;
}

/** Keep orderRef in sync with items: drop stale keys, append any new ones. */
function syncOrder<T>(
  items: T[],
  orderRef: Ref<string[]>,
  keyFn: (x: T) => string
) {
  const currentKeys = new Set(items.map(keyFn));
  orderRef.value = orderRef.value.filter((k) => currentKeys.has(k));
  for (const item of items) {
    const key = keyFn(item);
    if (!orderRef.value.includes(key)) orderRef.value.push(key);
  }
}

// ---- Shared panel registry + path operations (used by all three panels) ----

// Registry of the three UI panels (filter tree / sort tree / column list).
// `fieldsKey` differs because filter/sort root types are INPUT_OBJECTs (`inputFields`)
// while the column root type is an OBJECT (`fields`).
// `PanelKind` covers all three; `Mode` is the narrower path-based subset used by
// enable / activePaths / addNext / changeNode.
const MODES = {
  filters: {
    store: filters,
    root: filter_root,
    fieldsKey: "inputFields" as const,
  },
  sorts: { store: sorts, root: sort_root, fieldsKey: "inputFields" as const },
  columns: { store: columns, root: column_root, fieldsKey: "fields" as const },
};
type PanelKind = keyof typeof MODES;
type Mode = "filters" | "sorts";

/** Root-level fields of a panel's root type. Uses `inputFields` for filter/sort, `fields` for columns. */
function topLevel(kind: PanelKind) {
  const { store, root, fieldsKey } = MODES[kind];
  return (
    store.value.find((o: any) => o.name === root.value)?.[fieldsKey] || []
  );
}

/** Filter a list of {name, on} items to those not active whose name matches search. */
function filterAvailable(items: any[], searchStr: string) {
  const q = searchStr.toLowerCase().trim();
  return items.filter((x: any) => !x.on && x.name.toLowerCase().includes(q));
}

/** Dropdown items for an "Add X" panel: available (non-active) root fields matching the shared search. */
function searchFieldsFn(kind: PanelKind) {
  return filterAvailable(topLevel(kind), search_dropdown.value);
}

/**
 * Toggle a field on and cascade-open the first child at each level.
 * "filters" = filter mode (recurses into any named type).
 * "sorts" = order mode (only recurses into INPUT_OBJECT; leaf defaults to "ASC").
 * Only mutates state — callers in the template call get() explicitly when user input warrants a refetch.
 */
function enable(inputField: any, mode: Mode) {
  inputField.on = true;

  if (mode === "sorts" && inputField.type?.kind !== "INPUT_OBJECT") {
    // Sort leaf (ENUM direction) — default to ascending
    if (!inputField.value) inputField.value = "ASC";
  } else if (inputField.type?.name) {
    const obj = MODES[mode].store.value.find(
      (f: any) => f.name === inputField.type.name
    );
    if (obj) {
      obj.on = true;
      // Auto-expand the first child if nothing is selected yet
      if (obj.inputFields?.length > 0 && !obj.inputFields[0].on)
        enable(obj.inputFields[0], mode);
    }
  }
}

/**
 * Walk a type tree and collect every active branch as a linear path.
 * Each path is an array of { selected, options, isLeaf, fieldType } nodes
 * representing one row in the grid UI.
 * "filters" = filter (leaf = SCALAR or known primitive).
 * "sorts"  = order  (leaf = anything that isn't INPUT_OBJECT, typically ENUM).
 */
function activePaths(mode: Mode) {
  const { store, root } = MODES[mode];
  const paths: any[][] = [];
  const rootObj = store.value.find((o: any) => o.name === root.value);
  if (!rootObj?.inputFields) return paths;

  function isLeaf(field: any) {
    if (mode === "sorts") return field.type?.kind !== "INPUT_OBJECT";
    return (
      field.type?.kind === "SCALAR" ||
      ["String", "Boolean", "Int", "Float", "Decimal", "ID"].includes(
        field.type?.name
      )
    );
  }

  function traverse(currentObj: any, currentPath: any[]) {
    const activeFields = currentObj.inputFields?.filter((f: any) => f.on);

    if (!activeFields?.length) {
      if (currentPath.length > 0) paths.push(currentPath);
      return;
    }

    for (const field of activeFields) {
      const leaf = isLeaf(field);
      const levelNode = {
        selected: field,
        options: currentObj.inputFields,
        isLeaf: leaf,
        fieldType: field.type?.name || "String",
      };

      const newPath = [...currentPath, levelNode];

      if (leaf) paths.push(newPath);
      else {
        const nextObj = store.value.find(
          (f: any) => f.name === field.type?.name
        );
        if (nextObj) traverse(nextObj, newPath);
        else paths.push(newPath);
      }
    }
  }

  traverse(rootObj, []);
  return paths;
}

/** Swap the selected node at a given level to a different option (via select change) and refetch. */
function changeNode(level: any, event: Event, mode: Mode) {
  const target = event.target as HTMLSelectElement;
  if (!target) return;
  const newOptionName = target.value;
  if (level.selected.name === newOptionName) return;

  // Deactivate old branch, activate new one
  level.selected.on = false;
  const newOption = level.options.find((o: any) => o.name === newOptionName);
  if (newOption) enable(newOption, mode);
  get();
}

/**
 * Expand the next unused sibling field within a branch.
 * For sorts: the new leaf defaults to "ASC" and is immediately queryable, so refetch.
 * For filters: the new leaf is blank and doesn't affect the query until the user types — no refetch.
 */
function addNext(level: any, mode: Mode) {
  if (!level.selected.type?.name) return;
  const obj = MODES[mode].store.value.find(
    (f: any) => f.name === level.selected.type.name
  );
  const nextField = obj?.inputFields?.find((f: any) => !f.on);
  if (nextField) enable(nextField, mode);
  if (mode === "sorts") get();
}

/** Walk backwards along a path turning off nodes; stop when a sibling is still active. Triggers a refetch. */
function deletePath(path: any[]) {
  for (let i = path.length - 1; i >= 0; i--) {
    const level = path[i];
    level.selected.on = false;
    if (level.options.some((opt: any) => opt.on)) break;
  }
  get();
}

// ----------------------------------------------------------------
// 2b. Filters
// ----------------------------------------------------------------

const activeFilterPaths = computed(() => activePaths("filters"));

/**
 * Transform flat paths into a 2D grid with merged cells (rowspans).
 * Shared ancestor nodes across adjacent rows get a single cell spanning multiple rows.
 */
const filterGrid = computed(() => {
  const paths = activeFilterPaths.value;
  const grid: any[][] = paths.map(() => []);

  for (let row = 0; row < paths.length; row++) {
    for (let col = 0; col < paths[row].length; col++) {
      if (grid[row]?.[col]?.isSpanned) continue;

      const level = paths[row][col];
      if (!level) continue;

      // Count how many consecutive rows below share the same ancestor chain up to this column
      let span = 1;
      for (let r = row + 1; r < paths.length; r++) {
        let isMatch = true;
        for (let c = 0; c <= col; c++)
          if (
            !paths[r]?.[c] ||
            paths[r][c]?.selected?.name !== paths[row][c]?.selected?.name
          ) {
            isMatch = false;
            break;
          }
        if (isMatch) span++;
        else break;
      }

      grid[row][col] = {
        level,
        rowSpan: span,
        colIdx: col,
        rowIdx: row,
      };

      // Mark spanned cells so they're skipped during rendering
      for (let r = row + 1; r < row + span; r++) {
        if (!grid[r]) grid[r] = [];
        grid[r][col] = { isSpanned: true };
      }
    }
  }

  return grid;
});

/** Canonical field-name path from an active filter path (for store read/write). */
function canonicalOfPath(path: any[]): string[] {
  return path.map((p: any) => p.selected.name);
}

/**
 * Mirror this page's active filters into the shared query-state store.
 * - Upserts each active filter with a non-empty leaf value.
 * - Removes any stored entry that has a local equivalent here but is no
 *   longer active — that's a filter the user just cleared on this page.
 * - Leaves untouched any stored entry without a local equivalent (belongs
 *   to another page's ROOT).
 * Skips the whole sync while reconciliation is actively writing local state.
 */
function syncFiltersToStore() {
  if (isReconciling) return;
  if (!filter_root.value || filters.value.length === 0) return;

  // Collect currently-active filter paths that have a value.
  const activeLocalKeys = new Set<string>();
  for (const path of activeFilterPaths.value) {
    const leaf = path[path.length - 1]?.selected;
    if (!leaf || leaf.value === "" || leaf.value === undefined) continue;
    const canonical = canonicalOfPath(path);
    activeLocalKeys.add(canonical.join("."));
    queryState.setFilter({ path: canonical, value: leaf.value });
  }

  // Drop stored entries that resolve to a local path not in the active set.
  queryState.filters = queryState.filters.filter((entry) => {
    const localPath = findLocalPath(
      filters.value,
      filter_root.value,
      entry.path
    );
    if (!localPath) return true; // no local match — belongs to another page
    return activeLocalKeys.has(localPath.join("."));
  });
}

/**
 * Pull stored filters into this page's local filter tree. For each stored
 * canonical filter, find the shortest matching local path and activate it
 * with the stored value. Filters with no local match are silently skipped
 * (they belong to other pages). Triggers a refetch at the end.
 */
function reconcileFromStore() {
  if (!filter_root.value || filters.value.length === 0) return;
  isReconciling = true;
  try {
    for (const entry of queryState.filters) {
      const localPath = findLocalPath(
        filters.value,
        filter_root.value,
        entry.path
      );
      if (localPath) {
        activateLocalPath(
          filters.value,
          filter_root.value,
          localPath,
          entry.value
        );
      }
    }
  } finally {
    isReconciling = false;
  }
  get();
}

// ----------------------------------------------------------------
// 2c. Sorts
// ----------------------------------------------------------------

/** Generate a stable identity key for a sort path (e.g. "brand.name" or "category.name") */
function sortPathKey(path: any[]) {
  return path.map((p) => p.selected.name).join(".");
}

const activeSortPaths = computed(() => activePaths("sorts"));

/** Active sort paths reordered by the user's drag-and-drop priority. */
const orderedSortPaths = computed(() =>
  applyOrder(activeSortPaths.value, sort_path_order.value, sortPathKey)
);

// ----------------------------------------------------------------
// 2d. Columns
// ----------------------------------------------------------------

/** Collect active columns from the root node type (fields with .on === true) */
const activeColumns = computed(() => {
  const rootType = columns.value.find(
    (c: any) => c.name === column_root.value
  );
  if (!rootType?.fields) return [];
  return rootType.fields.filter((f: any) => f.on);
});

/** Active columns reordered by the user's drag-and-drop order. */
const orderedColumns = computed(() =>
  applyOrder(activeColumns.value, column_order.value, (c: any) => c.name)
);

/** Enable a column and trigger a refetch */
function enableColumn(field: any) {
  field.on = true;
  get();
}

/** Disable a column and trigger a refetch */
function disableColumn(field: any) {
  field.on = false;
  get();
}

/** Update an FK column's selected display sub-field and refetch. */
function setDisplayField(col: any, value: string) {
  col.displayField = value;
  get();
}

/** Get the scalar sub-fields of an FK column's related type (for the display field dropdown) */
function getSubFields(col: any) {
  const related = columns.value.find(
    (c: any) => c.name === col.resolvedTypeName
  );
  if (!related?.fields) return [];
  return related.fields.filter((f: any) => f.resolvedTypeKind === "SCALAR");
}

// ----------------------------------------------------------------
// 2e. Watchers — sync *_order refs with their active computeds
// ----------------------------------------------------------------

// One-shot reconciliation: pull stored filters into the local tree the first
// time filter introspection finishes. Applies to initial mount AND to any
// remount (e.g. when nav switches between Tools/ToolMetrics pages).
const unwatchFiltersReady = watch(
  () => filters.value.length,
  (len) => {
    if (len > 0 && filter_root.value) {
      reconcileFromStore();
      unwatchFiltersReady();
    }
  },
  { immediate: true }
);

watch(activeSortPaths, (paths) =>
  syncOrder(paths, sort_path_order, sortPathKey)
);
watch(activeColumns, (cols) =>
  syncOrder(cols, column_order, (c: any) => c.name)
);

// ----------------------------------------------------------------
// 2f. Panels config — drives the three panels' v-for in the template
// ----------------------------------------------------------------

const panels: Array<{
  kind: PanelKind;
  label: string;
  labelPlural: string;
  count: () => number;
  add: (f: any) => void;
}> = [
  {
    kind: "filters",
    label: "Filter",
    labelPlural: "Filters",
    count: () => activeFilterPaths.value.length,
    add: (f) => enable(f, "filters"),
  },
  {
    kind: "sorts",
    label: "Sort",
    labelPlural: "Sorts",
    count: () => activeSortPaths.value.length,
    add: (f) => {
      enable(f, "sorts");
      get();
    },
  },
  {
    kind: "columns",
    label: "Column",
    labelPlural: "Columns",
    count: () => orderedColumns.value.length,
    add: (f) => enableColumn(f),
  },
];

// ================================================================
// 3. MAIN DATA QUERY
//    Rebuilds the GraphQL document and variables from the current
//    filter/sort state, then triggers a reactive refetch.
// ================================================================

// ----------------------------------------------------------------
// 3a. Logic helpers
// ----------------------------------------------------------------

/**
 * Walk a path [{selected: {name, value}}, ...] writing each segment's name as a key
 * on `target`, descending at every non-leaf level and assigning the leaf's value at the bottom.
 * Returns `target` if written to, or null if the leaf value is empty/undefined.
 * Used by `get()` to build both filter and sort payloads from their active paths.
 */
function buildNestedFromPath(path: any[], target: any = {}): any | null {
  const leaf = path[path.length - 1]?.selected;
  if (!leaf || leaf.value === "" || leaf.value === undefined) return null;
  let cur = target;
  for (let i = 0; i < path.length; i++) {
    const node = path[i].selected;
    if (i === path.length - 1) cur[node.name] = node.value;
    else {
      cur[node.name] ??= {};
      cur = cur[node.name];
    }
  }
  return target;
}

// ----------------------------------------------------------------
// 3b. Query skeleton + Apollo
// ----------------------------------------------------------------

// Mutable query skeleton — __variables and __args are rebuilt on every get() call
const q = {
  query: {
    __name: "MyQuery",
    __variables: { first: "Int", offset: "Int" } as any,
    [ROOT]: {
      __args: {
        first: new VariableType("first"),
        offset: new VariableType("offset"),
      } as any,
      edges: {
        node: { id: true } as any, // rebuilt dynamically by get() from orderedColumns
      },
      count: true,
      counts: true,
    },
  },
};

const queryDoc = ref(gql(jtg(q)));
const queryVariables = ref<any>({ first: page_size.value, offset: 0 });

const {
  result: a_r,
  loading: a_l,
  error: a_e,
} = useQuery(queryDoc, queryVariables);

// ----------------------------------------------------------------
// 3c. Query builder
// ----------------------------------------------------------------

/**
 * Rebuild and execute the query from the current column, filter, and sort UI state.
 * 1. Rebuilds edges.node from orderedColumns (scalar/FK/connection field selection)
 * 2. Walks active filter/sort paths to construct deeply nested payloads
 * 3. Recompiles the GraphQL document and swaps variables to trigger Apollo's reactive refetch
 */
function get() {
  paginationOffset.value = 0;

  // --- Rebuild edges.node from active columns ---
  if (orderedColumns.value.length > 0) {
    const newNode: any = {};
    orderedColumns.value.forEach((col: any) => {
      if (col.resolvedTypeKind === "SCALAR") {
        newNode[col.name] = true;
      } else if (col.isConnection && col.nodeType) {
        // Connection: inject edges/node envelope, fetch scalar children of node type
        const nodeType = columns.value.find(
          (c: any) => c.name === col.nodeType
        );
        const innerNode: any = {};
        if (nodeType?.fields) {
          nodeType.fields
            .filter((f: any) => f.resolvedTypeKind === "SCALAR")
            .forEach((f: any) => {
              innerNode[f.name] = true;
            });
        }
        newNode[col.name] = {
          edges: {
            node: Object.keys(innerNode).length ? innerNode : { id: true },
          },
        };
      } else if (col.resolvedTypeKind === "OBJECT" && col.resolvedTypeName) {
        // Forward FK: fetch only the selected displayField
        if (col.displayField) {
          newNode[col.name] = { [col.displayField]: true };
        } else {
          newNode[col.name] = { id: true }; // fallback
        }
      }
    });
    q.query[ROOT].edges.node = newNode;
  }

  q.query.__variables = {};
  q.query[ROOT].__args = {};
  const newVariables: any = {};

  // --- Build filter payload ---
  // Walk each active filter path and merge its nested value into a shared object
  // e.g. paths [brand → name → icontains:"x"] becomes { brand: { name: { icontains: "x" } } }
  const filterPayload: any = {};
  for (const path of activeFilterPaths.value) {
    buildNestedFromPath(path, filterPayload);
  }

  // Attach filter variable if any filters have values
  if (Object.keys(filterPayload).length > 0 && filter_root.value !== "") {
    q.query[ROOT].__args["filter"] = new VariableType("filter");
    q.query.__variables["filter"] = filter_root.value;
    newVariables["filter"] = filterPayload;
  }

  // --- Build sort payload ---
  // Each sort path becomes its own object in the orderBy array so that
  // array position (not JS object key order) determines sort priority.
  // e.g. paths [name → ASC, brand → name → DESC] becomes [{ name: "ASC" }, { brand: { name: "DESC" } }]
  const sortPayloads: any[] = [];
  for (const path of orderedSortPaths.value) {
    const obj = buildNestedFromPath(path);
    if (obj) sortPayloads.push(obj);
  }

  // Attach orderBy variable
  if (sortPayloads.length > 0 && sort_var_type.value !== "") {
    q.query[ROOT].__args["orderBy"] = new VariableType("orderBy");
    q.query.__variables["orderBy"] = sort_var_type.value;
    newVariables["orderBy"] = sort_var_type.value.startsWith("[")
      ? sortPayloads
      : sortPayloads[0];
  }

  // --- Attach search variable ---
  if (search.value) {
    q.query[ROOT].__args["search"] = new VariableType("search");
    q.query.__variables["search"] = "String";
    newVariables["search"] = search.value;
  }

  // Attach pagination variables — always included together since goToPage
  // patches queryVariables directly and needs $offset in the compiled doc.
  if (page_size.value) {
    q.query[ROOT].__args["first"] = new VariableType("first");
    q.query.__variables["first"] = "Int";
    newVariables["first"] = page_size.value;
    q.query[ROOT].__args["offset"] = new VariableType("offset");
    q.query.__variables["offset"] = "Int";
    newVariables["offset"] = paginationOffset.value;
  }

  // Recompile the query document and swap variables to trigger Apollo's reactive refetch
  queryDoc.value = gql(jtg(q));
  queryVariables.value = newVariables;

  // Mirror the current active filter set into the shared cross-page store.
  syncFiltersToStore();
}

// ================================================================
// 4. DATA TABLE UI
//    Script-side helpers used by the main data table's <tbody> rows.
// ================================================================

/** Render a scalar or forward-FK column as a single string; empty string if missing. */
function cellText(col: any, row: any): string {
  if (col.resolvedTypeKind === "SCALAR") return row[col.name] ?? "";
  if (col.resolvedTypeKind === "OBJECT" && !col.isConnection) {
    return row[col.name]?.[col.displayField] ?? "";
  }
  return "";
}

/** Render a connection column as one line per edge — each line is a comma-joined flattening of the edge's node values. */
function cellConnectionLines(col: any, row: any): string[] {
  const edges: any[] = row[col.name]?.edges || [];
  return edges.map((edge: any) =>
    Object.values(edge.node || {})
      .map((v) =>
        typeof v === "object" ? Object.values(v as any).join(": ") : v
      )
      .join(", ")
  );
}

// ================================================================
// 5. PAGINATION
//    Offset-based pagination using first/offset variables.
//    `paginationOffset` lives in the state block at the top of the file.
// ================================================================

/** Current page derived from offset — UI display only */
const current_page = computed(
  () => Math.floor(paginationOffset.value / page_size.value) + 1
);

/** Set the current page and update the offset variable to trigger a refetch. */
function goToPage(n: number) {
  paginationOffset.value = (n - 1) * page_size.value;
  queryVariables.value = {
    ...queryVariables.value,
    offset: paginationOffset.value,
  };
}
</script>

<template>
  <div id="content" class="col">
    <div class="mx-auto" style="max-width: 1400px">
      <!-- BREADCRUMBS -->
      <nav class="mb-2" aria-label="breadcrumb">
        <ol class="breadcrumb m-0">
          <li class="breadcrumb-item"><a href="#">Home</a></li>
          <li
            class="breadcrumb-item active text-capitalize"
            aria-current="page"
          >
            {{ camel(ROOT) }}
          </li>
        </ol>
      </nav>

      <!-- TITLE -->
      <div class="d-flex align-items-end justify-content-between mb-3">
        <h1 class="text-capitalize m-0">
          {{ a_r?.[ROOT]?.count || "--" }} {{ camel(ROOT) }}
        </h1>
      </div>

      <!-- SEARCH BOX -->
      <div class="d-flex align-items-center my-3">
        <div class="input-group">
          <input
            :value="search"
            class="form-control bg-secondary-subtle border-0"
            placeholder="Search..."
            style="height: 3rem"
            type="text"
            @input="
              search = ($event.target as HTMLInputElement).value.toLowerCase();
              get();
            "
          />
          <button
            v-if="search && !q_l"
            class="btn bg-secondary-subtle text-secondary"
            @click="
              search = '';
              get();
            "
          >
            <i class="bi bi-x-circle-fill"></i>
          </button>
        </div>
      </div>

      <!-- FILTERS & SORTS PANEL -->
      <div v-if="!q_e" class="card mb-4">
        <ul v-if="show_filters" class="list-group list-group-flush">
          <!-- Filter / Sort / Column panels: one <li> per entry in panels[] -->
          <li
            v-for="panel in panels"
            :key="panel.kind"
            class="list-group-item"
          >
            <!-- Shared header: count + "Add X" dropdown -->
            <div
              class="d-flex align-items-center justify-content-between"
              :class="{ 'mb-2': panel.kind === 'columns' }"
            >
              <h5 class="m-0">
                <b>{{ panel.count() }} {{ panel.labelPlural }}</b>
              </h5>
              <div class="dropdown">
                <button
                  class="btn btn-primary btn-sm"
                  data-bs-toggle="dropdown"
                  aria-expanded="false"
                  :disabled="introspecting"
                  @click="focusDropdownInput($event)"
                >
                  <i class="bi bi-plus-lg"></i>
                  {{ panel.label }}
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
                  <li class="mx-2 mb-1">
                    <input
                      v-model="search_dropdown"
                      class="form-control py-1"
                      type="text"
                      :placeholder="
                        topLevel(panel.kind).length +
                        ' ' +
                        panel.labelPlural +
                        '...'
                      "
                    />
                  </li>
                  <li v-for="f in searchFieldsFn(panel.kind)" :key="f.name">
                    <button
                      class="dropdown-item text-capitalize"
                      @click="panel.add(f)"
                    >
                      {{ camel(f.name) }}
                    </button>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Filter grid: each row is one active filter path -->
            <div
              v-if="panel.kind === 'filters' && filterGrid.length"
              class="border-top pt-2 mt-2 overflow-x-auto"
            >
              <table cellpadding="0" cellspacing="0">
                <tbody>
                  <tr
                    v-for="(rowCells, rIdx) in filterGrid"
                    :key="'row-' + rIdx"
                    :class="
                      rIdx > 0 && !rowCells[0]?.isSpanned
                        ? 'table-row-group'
                        : ''
                    "
                  >
                    <template
                      v-for="(cell, cIdx) in rowCells"
                      :key="'cell-' + cIdx"
                    >
                      <template v-if="!cell.isSpanned">
                        <!-- Col 0: clickable branch label that expands the next sibling -->
                        <td
                          v-if="cIdx === 0"
                          :rowspan="cell.rowSpan"
                          style="height: 1px"
                        >
                          <button
                            class="btn btn-outline-primary btn-sm text-capitalize w-100 rounded-start-pill px-3 h-100 w-100"
                            @click="addNext(cell.level, 'filters')"
                          >
                            {{ camel(cell.level.selected.name) }}
                          </button>
                        </td>
                        <!-- Col > 0: dropdown to swap between sibling options at this depth -->
                        <td v-else :rowspan="cell.rowSpan" style="height: 1px">
                          <select
                            :value="cell.level.selected.name"
                            @change="changeNode(cell.level, $event, 'filters')"
                            class="btn btn-outline-secondary btn-sm text-capitalize border-secondary text-center rounded-0 h-100 w-100 d-print-none"
                            style="min-height: 31px"
                          >
                            <option
                              v-for="opt in cell.level.options"
                              :key="opt.name"
                              :value="opt.name"
                            >
                              {{ camel(opt.name) }}
                            </option>
                          </select>
                          <div
                            class="d-none d-print-block btn btn-outline-secondary btn-sm text-capitalize text-nowrap rounded-0 w-100"
                          >
                            {{ camel(cell.level.selected.name) }}
                          </div>
                        </td>

                        <!-- Leaf cell: value input, type depends on the field's GraphQL type -->
                        <td
                          v-if="cell.level.isLeaf"
                          :rowspan="cell.rowSpan"
                          style="height: 1px"
                        >
                          <!-- Boolean: true/false dropdown -->
                          <select
                            v-if="cell.level.fieldType === 'Boolean'"
                            v-model="cell.level.selected.value"
                            class="btn btn-outline-secondary btn-sm border-secondary rounded-0 h-100 pe-3 w-100"
                            @change="get()"
                            style="min-height: 31px"
                          >
                            <option value="">Select...</option>
                            <option :value="true">True</option>
                            <option :value="false">False</option>
                          </select>

                          <!-- Numeric / text input -->
                          <input
                            v-else
                            :type="inputTypeFor(cell.level.fieldType)"
                            v-model="cell.level.selected.value"
                            @keyup.enter="get()"
                            :placeholder="cell.level.fieldType + '...'"
                            class="form-control form-control-sm border-secondary rounded-0 h-100 px-3 w-100"
                            style="min-width: 140px; min-height: 31px"
                          />
                        </td>
                      </template>
                    </template>
                    <!-- Delete: removes this filter path -->
                    <td>
                      <button
                        class="btn btn-outline-danger btn-sm rounded-end-pill d-print-none"
                        style="height: 100%; min-height: 31px"
                        @click="deletePath(activeFilterPaths[rIdx] || [])"
                      >
                        <i class="bi bi-trash3"></i>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Sort rows: each row is a self-contained draggable path -->
            <div
              v-else-if="panel.kind === 'sorts' && orderedSortPaths.length"
              class="border-top pt-2 mt-2 overflow-x-auto"
            >
              <table cellpadding="0" cellspacing="0">
                <tbody>
                  <tr
                    v-for="(path, rIdx) in orderedSortPaths"
                    :key="'sort-row-' + rIdx"
                    draggable="true"
                    @dragstart="drag_sort_idx = rIdx"
                    @dragover.prevent="drag_over_sort_idx = rIdx"
                    @dragleave="drag_over_sort_idx = null"
                    @drop="onSortDrop(rIdx)"
                    @dragend="resetSortDrag()"
                    :style="{
                      opacity: drag_sort_idx === rIdx ? 0.3 : 1,
                    }"
                    :class="{
                      'sort-drop-target':
                        drag_over_sort_idx === rIdx &&
                        drag_sort_idx !== null &&
                        drag_sort_idx !== rIdx,
                      'table-row-group': rIdx > 0,
                    }"
                    style="cursor: grab"
                  >
                    <!-- Drag handle -->
                    <td
                      class="pe-0 d-print-none"
                      style="height: 1px; width: 1px"
                    >
                      <div
                        class="d-flex align-items-center justify-content-center h-100 text-muted"
                        style="min-height: 31px"
                      >
                        <i class="bi bi-grip-vertical"></i>
                      </div>
                    </td>
                    <!-- Path segments -->
                    <template
                      v-for="(level, cIdx) in path"
                      :key="'sort-seg-' + cIdx"
                    >
                      <!-- Col 0: clickable label that expands the next sibling -->
                      <td v-if="cIdx === 0" style="height: 1px">
                        <button
                          class="btn btn-outline-primary btn-sm text-capitalize w-100 rounded-start-pill px-3 h-100"
                          style="min-height: 31px"
                          @click="addNext(level, 'sorts')"
                        >
                          {{ camel(level.selected.name) }}
                        </button>
                      </td>
                      <!-- Col > 0: dropdown to swap between sibling options -->
                      <td v-else style="height: 1px">
                        <select
                          :value="level.selected.name"
                          @change="changeNode(level, $event, 'sorts')"
                          class="btn btn-outline-secondary btn-sm text-capitalize border-secondary text-center rounded-0 h-100 w-100"
                          style="min-height: 31px"
                        >
                          <option
                            v-for="opt in level.options"
                            :key="opt.name"
                            :value="opt.name"
                          >
                            {{ camel(opt.name) }}
                          </option>
                        </select>
                      </td>
                      <!-- Sort direction: ASC / DESC (only on leaf nodes) -->
                      <td v-if="level.isLeaf" style="height: 1px">
                        <select
                          v-model="level.selected.value"
                          class="btn btn-outline-secondary btn-sm border-secondary rounded-0 h-100 w-100"
                          style="min-height: 31px"
                          @change="get()"
                        >
                          <option value="ASC">ASC</option>
                          <option value="DESC">DESC</option>
                        </select>
                      </td>
                    </template>
                    <!-- Delete: removes this sort path -->
                    <td>
                      <button
                        class="btn btn-outline-danger btn-sm rounded-end-pill d-print-none"
                        style="height: 100%; min-height: 31px"
                        @click="deletePath(path)"
                      >
                        <i class="bi bi-trash3"></i>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Column rows: each row is a draggable column entry -->
            <div
              v-else-if="panel.kind === 'columns' && orderedColumns.length"
              class="border-top pt-2 mt-2 overflow-x-auto"
            >
              <table cellpadding="0" cellspacing="0">
                <tbody>
                  <tr
                    v-for="(col, rIdx) in orderedColumns"
                    :key="'col-row-' + rIdx"
                    draggable="true"
                    @dragstart="drag_col_idx = rIdx"
                    @dragover.prevent="drag_over_col_idx = rIdx"
                    @dragleave="drag_over_col_idx = null"
                    @drop="onColumnDrop(rIdx)"
                    @dragend="resetColumnDrag()"
                    :style="{
                      opacity: drag_col_idx === rIdx ? 0.3 : 1,
                    }"
                    :class="{
                      'sort-drop-target':
                        drag_over_col_idx === rIdx &&
                        drag_col_idx !== null &&
                        drag_col_idx !== rIdx,
                    }"
                    style="cursor: grab"
                  >
                    <!-- Drag handle -->
                    <td
                      class="pe-0 d-print-none"
                      style="height: 1px; width: 1px"
                    >
                      <div
                        class="d-flex align-items-center justify-content-center h-100 text-muted"
                        style="min-height: 31px"
                      >
                        <i class="bi bi-grip-vertical"></i>
                      </div>
                    </td>
                    <!-- Column name -->
                    <td style="height: 1px">
                      <button
                        class="btn btn-outline-primary btn-sm text-capitalize w-100 rounded-start-pill px-3 h-100"
                        style="min-height: 31px"
                        disabled
                      >
                        {{ camel(col.name) }}
                      </button>
                    </td>
                    <!-- Sub-field selector: only shown for FK columns -->
                    <td
                      v-if="
                        col.resolvedTypeKind === 'OBJECT' && !col.isConnection
                      "
                      style="height: 1px"
                    >
                      <select
                        :value="col.displayField"
                        @change="
                          setDisplayField(
                            col,
                            ($event.target as HTMLSelectElement).value
                          )
                        "
                        class="btn btn-outline-secondary btn-sm text-capitalize border-secondary text-center rounded-0 h-100 w-100"
                        style="min-height: 31px"
                      >
                        <option
                          v-for="sub in getSubFields(col)"
                          :key="sub.name"
                          :value="sub.name"
                        >
                          {{ camel(sub.name) }}
                        </option>
                      </select>
                    </td>
                    <!-- Delete: removes this column -->
                    <td>
                      <button
                        class="btn btn-outline-danger btn-sm rounded-end-pill d-print-none"
                        style="height: 100%; min-height: 31px"
                        @click="disableColumn(col)"
                      >
                        <i class="bi bi-trash3"></i>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </li>

          <!-- Show/Hide -->
          <li
            class="list-group-item d-flex align-items-center justify-content-center text-center p-0 d-print-none"
          >
            <button class="btn btn-link btn-sm" @click="show_filters = false">
              <i class="bi bi-chevron-up"></i>
              collapse
              <i class="bi bi-chevron-up"></i>
            </button>
          </li>
        </ul>

        <!-- Collapsed summary -->
        <ul v-else class="list-group list-group-flush">
          <li
            class="list-group-item d-flex align-items-center justify-content-between"
          >
            <b v-for="panel in panels" :key="panel.kind">
              {{ panel.count() }} {{ panel.labelPlural }}
            </b>
          </li>
          <li
            class="list-group-item d-flex align-items-center justify-content-center text-center p-0 d-print-none"
          >
            <button class="btn btn-link btn-sm" @click="show_filters = true">
              <i class="bi bi-chevron-down"></i>
              expand
              <i class="bi bi-chevron-down"></i>
            </button>
          </li>
        </ul>
      </div>

      <!-- DATA TABLE -->
      <div>
        <template v-if="a_l">
          <h5 class="alert alert-primary text-center m-0">Loading...</h5>
        </template>
        <h5 v-else-if="a_e" class="alert alert-danger text-center m-0">
          {{ a_e }}
        </h5>
        <div v-else-if="a_r?.[ROOT]?.count" class="table-responsive">
          <table class="table table-hover m-0">
            <thead>
              <tr class="table-secondary">
                <th
                  v-for="col in orderedColumns"
                  :key="col.name"
                  class="text-capitalize"
                >
                  {{ camel(col.name)
                  }}{{
                    col.displayField ? " > " + camel(col.displayField) : ""
                  }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in a_r?.[ROOT]?.edges" :key="h.node.id">
                <td v-for="col in orderedColumns" :key="col.name">
                  <template v-if="col.isConnection">
                    <div
                      v-for="(line, i) in cellConnectionLines(col, h.node)"
                      :key="i"
                    >
                      {{ line }}
                    </div>
                  </template>
                  <template v-else>
                    {{ cellText(col, h.node) }}
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <h5 v-else class="alert alert-warning text-center m-0">No Results</h5>
      </div>

      <!-- PAGINATION -->
      <div
        v-if="a_r?.[ROOT]?.count"
        class="d-flex align-items-center justify-content-between my-3 flex-wrap gap-2"
      >
        <!-- Showing X–Y of Z using count (total) and counts (this page) -->
        <span class="text-muted small">
          Showing
          {{ paginationOffset + 1 }}-{{
            paginationOffset + (a_r?.[ROOT]?.counts || 0)
          }}
          of {{ a_r?.[ROOT]?.count }}
        </span>

        <!-- Page number buttons -->
        <div class="d-flex flex-wrap gap-1">
          <button
            v-for="p in Math.ceil((a_r?.[ROOT]?.count || 0) / page_size)"
            :key="p"
            class="btn btn-sm"
            :class="
              p === current_page ? 'btn-primary' : 'btn-outline-secondary'
            "
            style="min-width: 2.2rem"
            @click="goToPage(p)"
          >
            {{ p }}
          </button>
        </div>

        <!-- Page size input -->
        <div class="d-flex align-items-center gap-1">
          <label class="text-muted small mb-0">Per page:</label>
          <input
            type="number"
            class="form-control form-control-sm text-center"
            style="width: 5rem"
            :value="page_size"
            min="1"
            @change="
              page_size = Math.max(
                1,
                Math.floor(
                  Math.abs(+($event.target as HTMLInputElement).value)
                ) || 1
              );
              get();
            "
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@media print {
  .overflow-x-auto {
    overflow: visible !important;
  }
}

/* Highlight the drop target row with a top border during drag */
.sort-drop-target td {
  border-top: 2px solid var(--bs-primary) !important;
}
.table-row-group td {
  padding-top: 0.25rem;
}
</style>
