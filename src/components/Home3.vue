<script setup lang="ts">
import gql from "graphql-tag";
import {
  jsonToGraphQLQuery as jtg,
  VariableType,
} from "json-to-graphql-query";
import { ref, watch, computed, nextTick } from "vue";
import { useApolloClient } from "@vue/apollo-composable";

// The GraphQL root query field name — change this to point at a different model
const ROOT = "tools";

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

// ---- Global State ----
const search = ref("");          // global search input
const show_filters = ref(true);  // toggle the filters/sorts panel
const page_size = ref(100);      // results per page

// ---- Filters ----
const filter_root = ref("");     // root INPUT_OBJECT type name (e.g. "ToolFilter")
const filters = ref<any[]>([]);  // flat store of all introspected filter INPUT_OBJECT types
const search_fields = ref("");   // search text inside the "Add Filter" dropdown

// ---- Sorts ----
const sort_root = ref("");           // root INPUT_OBJECT type name (e.g. "ToolOrder")
const sort_var_type = ref("");       // full GraphQL variable type string e.g. "[ToolOrder!]"
const sorts = ref<any[]>([]);        // flat store of all introspected sort INPUT_OBJECT types
const search_sorts = ref("");        // search text inside the "Add Sort" dropdown
const sort_path_order = ref<string[]>([]);       // user's drag-and-drop sort priority (path keys)
// TODO(DRY #2): drag_* refs (here and in Columns block below) + onSortDrop/onColumnDrop → one makeDragReorder(orderRef, onChange) factory. OK.
const drag_sort_idx = ref<number | null>(null);  // drag source row index
const drag_over_sort_idx = ref<number | null>(null); // drag hover target row index

// ---- Columns ----
const column_root = ref("");              // root OBJECT type name (e.g. "ToolNode")
const columns = ref<any[]>([]);           // flat store of introspected OBJECT types
const column_order = ref<string[]>([]);   // user's drag-and-drop column order (field names)
const search_columns = ref("");           // search text inside the "Add Column" dropdown
const drag_col_idx = ref<number | null>(null);       // drag source column index
const drag_over_col_idx = ref<number | null>(null);  // drag hover target column index

// Connection envelope fields to strip during column introspection
const CONNECTION_FIELDS = ["edges", "node", "pageInfo", "cursor", "count", "counts"];

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

// ================================================================
// 1. DYNAMIC GRAPHQL SCHEMA INTROSPECTION
//    Uses __type introspection to discover the ROOT query's args,
//    then recursively walks INPUT_OBJECT types to build up the
//    filter and sort type trees used by the UI.
// ================================================================

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

/** Recursively peel NON_NULL and LIST wrappers to find the inner type name and kind. */
function unwrapType(t: any): { varType: string; innerName: string; innerKind: string } {
  if (!t) return { varType: "", innerName: "", innerKind: "" };
  if (t.kind === "NON_NULL") {
    const inner = unwrapType(t.ofType);
    return { varType: inner.varType + "!", innerName: inner.innerName, innerKind: inner.innerKind };
  }
  if (t.kind === "LIST") {
    const inner = unwrapType(t.ofType);
    return { varType: `[${inner.varType}]`, innerName: inner.innerName, innerKind: inner.innerKind };
  }
  return { varType: t.name || "", innerName: t.name || "", innerKind: t.kind || "" };
}

// When the schema introspection returns, discover the filter, sort, and column types
// TODO(DRY #7): split boot into initFiltersFrom/initSortsFrom/initColumnsFrom helpers to make "columns must finish before get()" sequencing explicit. OK, no behavior change.
watch(q_r, (value) => {
  let f;
  try {
    f = value?.__type?.fields?.find((field: any) => field.name === ROOT)?.args;
  } catch (error) {
    console.error(error);
  }

  f = stripTypename(f) || [];

  // Kick off recursive introspection of the filter INPUT_OBJECT tree
  const filterArg = f.find((o: any) => o.name === "filter");
  if (filterArg?.type?.name) {
    filter_root.value = filterArg.type.name;
    introspect(filterArg.type.name, "filters");
  }

  // Kick off recursive introspection of the orderBy INPUT_OBJECT tree.
  // The orderBy arg is often wrapped in LIST/NON_NULL, so unwrapType
  // recovers both the full variable type string and the inner type name.
  const orderByArg = f.find((o: any) => o.name === "orderBy");
  if (orderByArg) {
    const { varType, innerName } = unwrapType(orderByArg.type);
    if (innerName) {
      sort_root.value = innerName;
      sort_var_type.value = varType;
      introspect(innerName, "sorts");
    }
  }

  // Kick off column introspection — discover the return type of ROOT,
  // resolve through the Connection envelope to find the node type, then walk it.
  const rootField = value?.__type?.fields?.find((field: any) => field.name === ROOT);
  if (rootField?.type) {
    const { innerName: connectionName } = unwrapType(rootField.type);
    if (connectionName) {
      resolveConnectionNodeType(connectionName).then((nodeTypeName) => {
        if (nodeTypeName) {
          column_root.value = nodeTypeName;
          introspectColumns(nodeTypeName).then(() => {
            // Default: turn on all scalar fields of the root node type
            const rootType = columns.value.find((c: any) => c.name === nodeTypeName);
            if (rootType?.fields) {
              rootType.fields.forEach((f: any) => {
                if (f.resolvedTypeKind === "SCALAR") f.on = true;
                // Default displayField for FK columns to the first scalar child
                if (f.resolvedTypeKind === "OBJECT" && !f.isConnection && f.resolvedTypeName) {
                  const related = columns.value.find((c: any) => c.name === f.resolvedTypeName);
                  const firstScalar = related?.fields?.find((rf: any) => rf.resolvedTypeKind === "SCALAR");
                  if (firstScalar) f.displayField = firstScalar.name;
                }
              });
              column_order.value = rootType.fields
                .filter((f: any) => f.on)
                .map((f: any) => f.name);
            }
            get();
          });
        }
      });
    }
  }
});

// Reusable introspection query — fetches inputFields for any named INPUT_OBJECT type.
// Used by introspect() via separate lazy query instances for filters and sorts.
// TODO(DRY #9): shares __variables/__type envelope and 3-deep ofType nesting with columns_query below — extract ofTypeFragment (or buildIntrospectionQuery). OK.
const input_query = {
  query: {
    __variables: { name: "String!" },
    __type: {
      __args: { name: new VariableType("name") },
      name: true,
      kind: true,
      inputFields: {
        name: true,
        type: {
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
};

// Introspection query for OBJECT types — fetches fields (not inputFields) and
// includes args on each field to discover filter/orderBy types on connections.
const columns_query = {
  query: {
    __variables: { name: "String!" },
    __type: {
      __args: { name: new VariableType("name") },
      name: true,
      kind: true,
      fields: {
        name: true,
        args: {
          name: true,
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

const { resolveClient } = useApolloClient();

/**
 * Walk an INPUT_OBJECT type graph, storing each type in the mode's store.
 * Each type and its inputFields get `on`/`value` UI state.
 * "filters" = filter introspection, "sorts" = order introspection.
 * All sibling branches at each level are fetched in parallel via Promise.all.
 */
async function introspect(typeName: string, mode: "filters" | "sorts") {
  const client = resolveClient();
  const store = { filters, sorts }[mode];

  const { data } = await client.query({
    query: gql(jtg(input_query)),
    variables: { name: typeName },
    fetchPolicy: "cache-first",
  });

  if (!data?.__type?.inputFields) return;

  let inf = stripTypename(data.__type);
  // Strip envelope args from the inputFields list
  inf.inputFields = inf.inputFields.filter(
    (o: any) => !NON_MODEL_ARGS.includes(o.name)
  );

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

  // Recurse into all INPUT_OBJECT children in parallel
  await Promise.all(
    inf.inputFields
      .filter((o: any) => o.type.kind === "INPUT_OBJECT")
      .map((o: any) => introspect(o.type.name, mode))
  );
}

/**
 * Resolve a Relay Connection type to its inner node type name.
 * Follows: ConnectionType → edges field → EdgeType → node field → NodeType
 */
async function resolveConnectionNodeType(connectionTypeName: string): Promise<string | null> {
  const client = resolveClient();

  // Step 1: Introspect the Connection type to find its "edges" field
  const { data } = await client.query({
    query: gql(jtg(columns_query)),
    variables: { name: connectionTypeName },
    fetchPolicy: "cache-first",
  });
  if (!data?.__type?.fields) return null;

  const edgesField = stripTypename(data.__type.fields).find((f: any) => f.name === "edges");
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
  const nodeField = stripTypename(edgeData.__type.fields).find((f: any) => f.name === "node");
  if (!nodeField) return null;

  return unwrapType(nodeField.type).innerName;
}

/**
 * Walk an OBJECT type graph, storing each type in `columns`.
 * Detects Relay connection patterns and unwraps them transparently.
 * Uses a visited set to prevent infinite loops on circular type references.
 */
async function introspectColumns(typeName: string, visited = new Set<string>()) {
  if (visited.has(typeName)) return;
  visited.add(typeName);

  const client = resolveClient();

  const { data } = await client.query({
    query: gql(jtg(columns_query)),
    variables: { name: typeName },
    fetchPolicy: "cache-first",
  });

  if (!data?.__type?.fields) return;

  let typeObj = stripTypename(data.__type);

  // Strip connection envelope fields
  typeObj.fields = typeObj.fields.filter(
    (f: any) => !CONNECTION_FIELDS.includes(f.name)
  );

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
  const existingIndex = columns.value.findIndex((c: any) => c.name === typeObj.name);
  if (existingIndex !== -1) Object.assign(columns.value[existingIndex], typeObj);
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

// ================================================================
// 2. FILTER UI LOGIC
//    Manages the interactive filter builder: enabling/disabling
//    filter branches, computing active paths through the type tree,
//    and laying them out as a grid with merged rowspans.
// ================================================================

// TODO(DRY #5): enable/topLevel/searchFieldsFn/activePaths/addNext all do { filters, sorts }[mode] lookup — collapse via a MODES registry (declare after filter_root/sort_root/filters/sorts refs). OK.
/**
 * Toggle a field on and cascade-open the first child at each level.
 * "filters" = filter mode (recurses into any named type).
 * "sorts" = order mode (only recurses into INPUT_OBJECT; leaf defaults to "ASC").
 * Only mutates state — callers in the template call get() explicitly when user input warrants a refetch.
 */
function enable(inputField: any, mode: "filters" | "sorts") {
  inputField.on = true;

  if (mode === "sorts" && inputField.type?.kind !== "INPUT_OBJECT") {
    // Sort leaf (ENUM direction) — default to ascending
    if (!inputField.value) inputField.value = "ASC";
  } else if (inputField.type?.name) {
    const obj = { filters, sorts }[mode].value.find(
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

/** Convert camelCase to spaced words for display: "brandName" → "brand Name" */
function camel(s: string) {
  return s.replace(/([A-Z])/g, " $1").trim();
}

/** Get the root-level inputFields for a given mode's "Add" dropdown */
function topLevel(mode: "filters" | "sorts") {
  const root = { filters: filter_root, sorts: sort_root }[mode];
  return (
    { filters, sorts }[mode].value.find((o: any) => o.name === root.value)
      ?.inputFields || []
  );
}

// TODO(DRY #4): merge with availableColumns() below into one filterAvailable(items, searchStr) helper. OK.
/** Filter the dropdown items by the search text, excluding already-active fields */
function searchFieldsFn(mode: "filters" | "sorts") {
  const searchStr = { filters: search_fields, sorts: search_sorts }[
    mode
  ].value.toLowerCase();
  return topLevel(mode).filter(
    (arg: any) => arg.name.toLowerCase().includes(searchStr) && !arg.on
  );
}

/**
 * Walk a type tree and collect every active branch as a linear path.
 * Each path is an array of { selected, options, isLeaf, fieldType } nodes
 * representing one row in the grid UI.
 * "filters" = filter (leaf = SCALAR or known primitive).
 * "sorts"  = order  (leaf = anything that isn't INPUT_OBJECT, typically ENUM).
 */
function activePaths(mode: "filters" | "sorts") {
  const store = { filters, sorts }[mode];
  const root = { filters: filter_root, sorts: sort_root }[mode];
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

const activeFilterPaths = computed(() => activePaths("filters"));
const activeSortPaths = computed(() => activePaths("sorts"));

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

/** Swap the selected node at a given level to a different option (via select change) */
function changeNode(level: any, event: Event, mode: "filters" | "sorts") {
  const target = event.target as HTMLSelectElement;
  if (!target) return;
  const newOptionName = target.value;
  if (level.selected.name === newOptionName) return;

  // Deactivate old branch, activate new one — callers in the template call get() explicitly
  level.selected.on = false;
  const newOption = level.options.find((o: any) => o.name === newOptionName);
  if (newOption) enable(newOption, mode);
}

/** Expand the next unused sibling field within a branch */
function addNext(level: any, mode: "filters" | "sorts") {
  if (!level.selected.type?.name) return;
  const obj = { filters, sorts }[mode].value.find(
    (f: any) => f.name === level.selected.type.name
  );
  const nextField = obj?.inputFields?.find((f: any) => !f.on);
  if (nextField) enable(nextField, mode);
}

/** Walk backwards along a path turning off nodes; stop when a sibling is still active. Pure state mutation. */
function deletePath(path: any[]) {
  for (let i = path.length - 1; i >= 0; i--) {
    const level = path[i];
    level.selected.on = false;
    if (level.options.some((opt: any) => opt.on)) break;
  }
}

// ================================================================
// 2b. SORT UI LOGIC
//     Mirrors the filter UI but for orderBy. Leaf nodes are
//     ENUM (ASC/DESC) instead of scalar input values.
// ================================================================

/** Generate a stable identity key for a sort path (e.g. "brand.name" or "category.name") */
function sortPathKey(path: any[]) {
  return path.map((p) => p.selected.name).join(".");
}

// TODO(DRY #1): same map+append shape as orderedColumns + watchers below — extract applyOrder(items, order, keyFn) + syncOrder(activeItems, orderRef, keyFn). OK.
/**
 * Reorder activeSortPaths according to the user's drag-and-drop ordering.
 * Paths present in sort_path_order come first (in that order), then any newly added paths.
 */
const orderedSortPaths = computed(() => {
  const paths = activeSortPaths.value;
  const order = sort_path_order.value;

  // Build a map of key → path for quick lookup
  const byKey = new Map<string, any[]>();
  for (const p of paths) byKey.set(sortPathKey(p), p);

  // Collect ordered paths: first those in sort_path_order, then any new ones
  const result: any[][] = [];
  for (const key of order) {
    const p = byKey.get(key);
    if (p) {
      result.push(p);
      byKey.delete(key);
    }
  }
  // Append any paths not yet in the order (newly added sorts)
  for (const p of byKey.values()) result.push(p);

  return result;
});

// Keep sort_path_order in sync when paths are added or removed
watch(activeSortPaths, (paths) => {
  const currentKeys = new Set(paths.map(sortPathKey));
  // Remove stale keys, then append any new ones
  sort_path_order.value = sort_path_order.value.filter((k) =>
    currentKeys.has(k)
  );
  for (const p of paths) {
    const key = sortPathKey(p);
    if (!sort_path_order.value.includes(key)) sort_path_order.value.push(key);
  }
});

/**
 * Handle dropping a sort row onto a new position.
 * Splices the dragged entry out of sort_path_order and re-inserts it at the target index.
 */
function onSortDrop(idx: number) {
  const from = drag_sort_idx.value;
  if (from === null || from === idx) return;

  const order = [...sort_path_order.value];
  const [moved] = order.splice(from, 1);
  order.splice(idx, 0, moved);
  sort_path_order.value = order;

  drag_sort_idx.value = null;
  drag_over_sort_idx.value = null;
  get();
}

// ================================================================
// 2c. COLUMN ORDERING LOGIC
//     Mirrors sort ordering: .on determines active, column_order
//     determines left-to-right display order.
// ================================================================

// TODO(DRY #6): capstone — filters/sorts/columns share active→ordered→drag→sync; extract makeListManager({ items, keyFn, ... }) factory. OK; do items 1–5 first. Also enables drag reorder for filters.
/** Collect active columns from the root node type (fields with .on === true) */
const activeColumns = computed(() => {
  const rootType = columns.value.find((c: any) => c.name === column_root.value);
  if (!rootType?.fields) return [];
  return rootType.fields.filter((f: any) => f.on);
});

/** Reorder active columns per user's drag order */
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

/** Keep column_order in sync when columns toggle on/off */
watch(activeColumns, (cols) => {
  const currentNames = new Set(cols.map((c: any) => c.name));
  column_order.value = column_order.value.filter((n) => currentNames.has(n));
  for (const c of cols) {
    if (!column_order.value.includes(c.name)) column_order.value.push(c.name);
  }
});

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

/** Move a column from one position to another (drag-and-drop reordering) */
function moveColumn(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return;
  const order = [...column_order.value];
  const [moved] = order.splice(fromIndex, 1);
  order.splice(toIndex, 0, moved);
  column_order.value = order;
  get();
}

/** Get all available (non-active) columns for the "Add Column" dropdown, filtered by search */
function availableColumns() {
  const rootType = columns.value.find((c: any) => c.name === column_root.value);
  if (!rootType?.fields) return [];
  const searchStr = search_columns.value.toLowerCase();
  return rootType.fields.filter(
    (f: any) => !f.on && f.name.toLowerCase().includes(searchStr)
  );
}

/** Get the scalar sub-fields of an FK column's related type (for the display field dropdown) */
function getSubFields(col: any) {
  const related = columns.value.find((c: any) => c.name === col.resolvedTypeName);
  if (!related?.fields) return [];
  return related.fields.filter((f: any) => f.resolvedTypeKind === "SCALAR");
}

/** Handle dropping a column onto a new position */
function onColumnDrop(idx: number) {
  const from = drag_col_idx.value;
  if (from === null || from === idx) return;
  moveColumn(from, idx);
  drag_col_idx.value = null;
  drag_over_col_idx.value = null;
}

// ================================================================
// 3. MAIN LIVE DATA QUERY
//    Rebuilds the GraphQL document and variables from the current
//    filter/sort state, then triggers a reactive refetch.
// ================================================================

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

// TODO(DRY #12): only a_get below is actually dead in current code. Other dead-code items in docs/Home.md (fields ref, duplicate Columns count row, connection metadata props) are not present in this file. Partial feasibility.
const {
  result: a_r,
  loading: a_l,
  error: a_e,
  refetch: a_get, // TODO(DRY #12): unused — remove.
} = useQuery(queryDoc, queryVariables);

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
        const nodeType = columns.value.find((c: any) => c.name === col.nodeType);
        const innerNode: any = {};
        if (nodeType?.fields) {
          nodeType.fields
            .filter((f: any) => f.resolvedTypeKind === "SCALAR")
            .forEach((f: any) => { innerNode[f.name] = true; });
        }
        newNode[col.name] = { edges: { node: Object.keys(innerNode).length ? innerNode : { id: true } } };
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
  // Walk each active filter path and nest values into a deeply nested object
  // e.g. paths [brand → name → icontains:"x"] becomes { brand: { name: { icontains: "x" } } }
  // TODO(DRY #8): same nested-write loop runs in the sort payload below — extract buildNestedFromPath(path, leafGuard). OK.
  let filterPayload: any = {};

  activeFilterPaths.value.forEach((path) => {
    // Skip entire path if the leaf has no value — avoids empty nested objects like { brand: { name: {} } }
    const leaf = path[path.length - 1]?.selected;
    if (!leaf || leaf.value === "" || leaf.value === undefined) return;

    let currentLevel = filterPayload;
    for (let i = 0; i < path.length; i++) {
      const node = path[i].selected;
      if (i === path.length - 1) currentLevel[node.name] = node.value;
      else {
        currentLevel[node.name] ??= {};
        currentLevel = currentLevel[node.name];
      }
    }
  });

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
  let sortPayloads: any[] = [];
  orderedSortPaths.value.forEach((path) => {
    let sortObj: any = {};
    let currentLevel = sortObj;
    for (let i = 0; i < path.length; i++) {
      const node = path[i].selected;
      if (i === path.length - 1) {
        if (node.value !== "" && node.value !== undefined)
          currentLevel[node.name] = node.value;
      } else {
        currentLevel[node.name] ??= {};
        currentLevel = currentLevel[node.name];
      }
    }
    if (Object.keys(sortObj).length > 0) sortPayloads.push(sortObj);
  });

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
}

// ================================================================
// 5. PAGINATION
//    Offset-based pagination using first/offset variables.
// ================================================================

/** Zero-based offset into the result set — the true pagination source of truth */
const paginationOffset = ref(0);

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
          <!-- Filters -->
          <li class="list-group-item">
            <!-- Filter topbar: count + "Add Filter" dropdown -->
            <div class="d-flex align-items-center justify-content-between">
              <h5 class="m-0">
                <b>{{ activeFilterPaths.length }} Filters</b>
              </h5>
              <!-- TODO(DRY #3): same click pattern repeats on Sort/Column dropdowns below — extract openAddDropdown(searchRef, $event). JS feasible; markup stays (no child components). -->
              <div class="dropdown">
                <button
                  class="btn btn-primary btn-sm"
                  data-bs-toggle="dropdown"
                  aria-expanded="false"
                  :disabled="!!(q_l || q_e)"
                  @click="
                    search_fields = '';
                    nextTick(() =>
                      $event.currentTarget.nextElementSibling
                        ?.querySelector('input')
                        ?.focus()
                    );
                  "
                >
                  <i class="bi bi-plus-lg"></i>
                  Filter
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
                  <li class="mx-2 mb-1">
                    <input
                      v-model="search_fields"
                      class="form-control py-1"
                      type="text"
                      :placeholder="topLevel('filters').length + ' Filters...'"
                    />
                  </li>
                  <li v-for="f in searchFieldsFn('filters')" :key="f.name">
                    <button
                      class="dropdown-item text-capitalize"
                      @click="enable(f, 'filters')"
                    >
                      {{ camel(f.name) }}
                    </button>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Filter grid: each row is one active filter path -->
            <div
              v-if="filterGrid.length"
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
                            @change="
                              changeNode(cell.level, $event, 'filters');
                              get();
                            "
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

                        <!-- TODO(DRY #10): move the Int/Decimal/Float check into an inputTypeFor(fieldType) script helper. OK; branched template itself stays. -->
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
                            :type="
                              ['Int', 'Decimal', 'Float'].includes(
                                cell.level.fieldType
                              )
                                ? 'number'
                                : 'text'
                            "
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
                        @click="
                          deletePath(activeFilterPaths[rIdx] || []);
                          get();
                        "
                      >
                        <i class="bi bi-trash3"></i>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </li>

          <!-- Sorts -->
          <li class="list-group-item">
            <div class="d-flex align-items-center justify-content-between">
              <h5 class="m-0">
                <b>{{ activeSortPaths.length }} Sorts</b>
              </h5>
              <div class="dropdown">
                <button
                  class="btn btn-primary btn-sm"
                  data-bs-toggle="dropdown"
                  aria-expanded="false"
                  :disabled="!!(q_l || q_e)"
                  @click="
                    search_sorts = '';
                    nextTick(() =>
                      $event.currentTarget.nextElementSibling
                        ?.querySelector('input')
                        ?.focus()
                    );
                  "
                >
                  <i class="bi bi-plus-lg"></i>
                  Sort
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
                  <li class="mx-2 mb-1">
                    <input
                      v-model="search_sorts"
                      class="form-control py-1"
                      type="text"
                      :placeholder="topLevel('sorts').length + ' Sorts...'"
                    />
                  </li>
                  <li v-for="f in searchFieldsFn('sorts')" :key="f.name">
                    <button
                      class="dropdown-item text-capitalize"
                      @click="
                        enable(f, 'sorts');
                        get();
                      "
                    >
                      {{ camel(f.name) }}
                    </button>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Sort rows: each row is a self-contained draggable path -->
            <div
              v-if="orderedSortPaths.length"
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
                    @dragend="
                      drag_sort_idx = null;
                      drag_over_sort_idx = null;
                    "
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
                          @click="
                            addNext(level, 'sorts');
                            get();
                          "
                        >
                          {{ camel(level.selected.name) }}
                        </button>
                      </td>
                      <!-- Col > 0: dropdown to swap between sibling options -->
                      <td v-else style="height: 1px">
                        <select
                          :value="level.selected.name"
                          @change="
                            changeNode(level, $event, 'sorts');
                            get();
                          "
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
                        @click="
                          deletePath(path);
                          get();
                        "
                      >
                        <i class="bi bi-trash3"></i>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </li>

          <!-- Columns panel: add/remove/reorder visible table columns -->
          <li class="list-group-item">
            <div
              class="d-flex align-items-center justify-content-between mb-2"
            >
              <h5 class="m-0">
                <b>{{ orderedColumns.length }} Columns</b>
              </h5>
              <div class="dropdown">
                <button
                  class="btn btn-primary btn-sm"
                  data-bs-toggle="dropdown"
                  aria-expanded="false"
                  :disabled="!!(q_l || q_e)"
                  @click="
                    search_columns = '';
                    nextTick(() =>
                      $event.currentTarget.nextElementSibling
                        ?.querySelector('input')
                        ?.focus()
                    );
                  "
                >
                  <i class="bi bi-plus-lg"></i>
                  Column
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
                  <li class="mx-2 mb-1">
                    <input
                      v-model="search_columns"
                      class="form-control py-1"
                      type="text"
                      :placeholder="availableColumns().length + ' Columns...'"
                    />
                  </li>
                  <li v-for="f in availableColumns()" :key="f.name">
                    <button
                      class="dropdown-item text-capitalize"
                      @click="enableColumn(f)"
                    >
                      {{ camel(f.name) }}
                    </button>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Column rows: each row is a draggable column entry -->
            <div
              v-if="orderedColumns.length"
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
                    @dragend="
                      drag_col_idx = null;
                      drag_over_col_idx = null;
                    "
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
                      v-if="col.resolvedTypeKind === 'OBJECT' && !col.isConnection"
                      style="height: 1px"
                    >
                      <select
                        :value="col.displayField"
                        @change="
                          col.displayField = ($event.target as HTMLSelectElement).value;
                          get();
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
            <b>{{ activeFilterPaths.length }} Filters</b>
            <b>{{ orderedColumns.length }} Columns</b>
            <b>{{ activeSortPaths.length }} Sorts</b>
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
                  {{ camel(col.name) }}{{ col.displayField ? ' > ' + camel(col.displayField) : '' }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in a_r?.[ROOT]?.edges" :key="h.node.id">
                <td
                  v-for="col in orderedColumns"
                  :key="col.name"
                >
                  <!-- TODO(DRY #11): extract renderCellValue(col, row) for scalar/FK. Connection still needs v-for in template (multi-line). Partial. -->
                  <!-- Scalar: render value directly -->
                  <template v-if="col.resolvedTypeKind === 'SCALAR'">
                    {{ h.node[col.name] }}
                  </template>
                  <!-- FK (forward relation): render the selected displayField -->
                  <template v-else-if="col.resolvedTypeKind === 'OBJECT' && !col.isConnection">
                    {{ h.node[col.name]?.[col.displayField] }}
                  </template>
                  <!-- Connection (backward relation): collapsed mode — loop over edges -->
                  <template v-else-if="col.isConnection">
                    <div v-for="(edge, i) in h.node[col.name]?.edges" :key="i">
                      {{ Object.values(edge.node || {}).map(v => typeof v === 'object' ? Object.values(v).join(': ') : v).join(', ') }}
                    </div>
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
              page_size = Math.max(1, Math.floor(Math.abs(+($event.target as HTMLInputElement).value)) || 1);
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
