<script setup lang="ts">
import gql from "graphql-tag";
import {
  jsonToGraphQLQuery as jtg,
  VariableType,
} from "json-to-graphql-query";
import { ref, watch, computed, nextTick } from "vue";

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

// ---- State ----
const search = ref("");
const show_filters = ref(true);
const search_fields = ref(""); // search text inside the "Add Filter" dropdown
const fields = ref<any[]>([]); // root-level model args (non-envelope)
const tool_root = ref(""); // introspected INPUT_OBJECT name for the filter type
const filters = ref<any[]>([]); // flat list of all introspected filter INPUT_OBJECT types
const sort_root = ref(""); // introspected INPUT_OBJECT name for the sort type
const sort_var_type = ref(""); // full GraphQL variable type string e.g. "[ToolOrder!]"
const sort_types = ref<any[]>([]); // flat list of all introspected sort INPUT_OBJECT types
const search_sort_fields = ref(""); // search text inside the "Add Sort" dropdown
const sort_path_order = ref<string[]>([]); // user's desired sort priority order (path keys)
const drag_sort_idx = ref<number | null>(null); // index of the row currently being dragged
const drag_over_sort_idx = ref<number | null>(null); // index of the row being hovered over
const page_size = ref(100); // number of results per page
const current_page = ref(1); // 1-indexed current page

// ---- Template Refs ----
const searchFilters = ref<any>(null);
const searchSortFilters = ref<any>(null);

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
      },
    },
  },
};

const {
  result: q_r,
  loading: q_l,
  error: q_e,
} = useQuery(gql(jtg(fields_query)));

// When the schema introspection returns, extract model fields, filter type, and sort type
watch(q_r, (value) => {
  let f;
  try {
    f = value?.__type?.fields?.find((field: any) => field.name === ROOT)?.args;
  } catch (error) {
    console.error(error);
    fields.value = [];
  }

  f = stripTypename(f) || [];

  // Keep only actual model fields (exclude envelope args like filter, orderBy, pagination)
  fields.value = f
    .filter((arg: any) => !NON_MODEL_ARGS.includes(arg.name))
    .filter((arg: any) => arg.type?.name !== "ID");

  // Kick off recursive introspection of the filter INPUT_OBJECT tree
  const filterArg = f.find((o: any) => o.name === "filter");
  if (filterArg?.type?.name) {
    tool_root.value = filterArg.type.name;
    introspect(filterArg.type.name, "F");
  }

  // Kick off recursive introspection of the orderBy INPUT_OBJECT tree.
  // The orderBy arg is often wrapped in LIST/NON_NULL, so we recursively
  // unwrap to recover both the full variable type string and the inner type name.
  const orderByArg = f.find((o: any) => o.name === "orderBy");
  if (orderByArg) {
    function unwrapType(t: any): { varType: string; innerName: string } {
      if (!t) return { varType: "", innerName: "" };
      if (t.kind === "NON_NULL") {
        const inner = unwrapType(t.ofType);
        return { varType: inner.varType + "!", innerName: inner.innerName };
      }
      if (t.kind === "LIST") {
        const inner = unwrapType(t.ofType);
        return { varType: `[${inner.varType}]`, innerName: inner.innerName };
      }
      return { varType: t.name || "", innerName: t.name || "" };
    }
    const { varType, innerName } = unwrapType(orderByArg.type);
    if (innerName) {
      sort_root.value = innerName;
      sort_var_type.value = varType;
      introspect(innerName, "O");
    }
  }
});

// Reusable introspection query — fetches inputFields for any named INPUT_OBJECT type.
// Used by introspect() via separate lazy query instances for filters and sorts.
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

// Separate lazy query instances so filter and sort introspection don't interfere
const {
  result: f_r,
  load: f_l,
  error: f_err,
  refetch: f_get,
} = useLazyQuery(gql(jtg(input_query)));

const {
  result: s_r,
  load: s_l,
  error: s_err,
  refetch: s_get,
} = useLazyQuery(gql(jtg(input_query)));

/**
 * Walk an INPUT_OBJECT type graph depth-first, storing each type in `store`.
 * Each type and its inputFields get `on`/`value` UI state.
 * "F" = filter introspection, "O" = order introspection.
 */
async function introspect(typeName: string, mode: "F" | "O") {
  const [r, l, g, store] =
    mode === "F"
      ? [f_r, f_l, f_get, filters]
      : [s_r, s_l, s_get, sort_types];

  let data;
  if (r.value === undefined) data = await l(null, { name: typeName });
  else data = (await g({ name: typeName }))?.data;

  if (!data?.__type?.inputFields) return;

  let inf = stripTypename(data.__type);
  // Strip envelope args from the inputFields list
  inf.inputFields = inf.inputFields.filter(
    (o: any) => !NON_MODEL_ARGS.includes(o.name)
  );

  // Initialize UI toggle state on the type and each field
  inf.on = false;
  inf.value = "";
  inf.inputFields.map((o: any) => {
    o.on = false;
    o.value = "";
  });

  // Upsert into the flat store (avoid duplicates on re-fetch)
  const existingIndex = store.value.findIndex(
    (f: any) => f.name === inf.name
  );
  if (existingIndex !== -1) Object.assign(store.value[existingIndex], inf);
  else store.value.push(inf);

  // Recurse into any nested INPUT_OBJECT children
  for (const o of inf.inputFields)
    if (o.type.kind === "INPUT_OBJECT") await introspect(o.type.name, mode);
}

// ================================================================
// 2. FILTER UI LOGIC
//    Manages the interactive filter builder: enabling/disabling
//    filter branches, computing active paths through the type tree,
//    and laying them out as a grid with merged rowspans.
// ================================================================

/**
 * Toggle a field on and cascade-open the first child at each level.
 * "F" = filter mode (recurses into any named type).
 * "O" = order mode (only recurses into INPUT_OBJECT; leaf defaults to "ASC").
 * Does NOT call get() — callers decide when to re-query.
 */
function enable(inputField: any, mode: "F" | "O") {
  inputField.on = true;
  const store = mode === "F" ? filters : sort_types;

  if (mode === "O" && inputField.type?.kind !== "INPUT_OBJECT") {
    // Sort leaf (ENUM direction) — default to ascending
    if (!inputField.value) inputField.value = "ASC";
  } else if (inputField.type?.name) {
    const obj = store.value.find(
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
function topLevel(mode: "F" | "O") {
  const [store, root] =
    mode === "F" ? [filters, tool_root] : [sort_types, sort_root];
  return store.value.find((o: any) => o.name === root.value)?.inputFields || [];
}

/** Filter the dropdown items by the search text, excluding already-active fields */
function searchFieldsFn(mode: "F" | "O") {
  const searchStr = (mode === "F" ? search_fields : search_sort_fields).value.toLowerCase();
  return topLevel(mode).filter(
    (arg: any) => arg.name.toLowerCase().includes(searchStr) && !arg.on
  );
}

/**
 * Walk a type tree and collect every active branch as a linear path.
 * Each path is an array of { selected, options, isLeaf, fieldType } nodes
 * representing one row in the grid UI.
 * "F" = filter (leaf = SCALAR or known primitive).
 * "O" = order  (leaf = anything that isn't INPUT_OBJECT, typically ENUM).
 */
function activePaths(mode: "F" | "O") {
  const [store, root] =
    mode === "F" ? [filters, tool_root] : [sort_types, sort_root];
  const paths: any[][] = [];
  const rootObj = store.value.find((o: any) => o.name === root.value);
  if (!rootObj?.inputFields) return paths;

  function isLeaf(field: any) {
    if (mode === "O") return field.type?.kind !== "INPUT_OBJECT";
    return (
      field.type?.kind === "SCALAR" ||
      ["String", "Boolean", "Int", "Float", "Decimal", "ID"].includes(
        field.type?.name
      )
    );
  }

  function traverse(currentObj: any, currentPath: any[]) {
    // Terminal: no further fields to recurse into
    if (!currentObj.inputFields) {
      if (currentPath.length > 0) paths.push(currentPath);
      return;
    }

    const activeFields = currentObj.inputFields.filter((f: any) => f.on);

    // No active children — emit the path so far (if non-empty)
    if (!activeFields.length) {
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

const activeFilterPaths = computed(() => activePaths("F"));
const activeSortPaths = computed(() => activePaths("O"));

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
function changeNode(level: any, event: Event, mode: "F" | "O") {
  const target = event.target as HTMLSelectElement;
  if (!target) return;
  const newOptionName = target.value;
  if (level.selected.name === newOptionName) return;

  // Deactivate old branch, activate new one
  level.selected.on = false;
  const newOption = level.options.find((o: any) => o.name === newOptionName);
  if (newOption) enable(newOption, mode);
  get(); // Always re-query: old node was deactivated
}

/** Expand the next unused sibling field within a branch */
function addNext(level: any, mode: "F" | "O") {
  if (!level.selected.type?.name) return;
  const store = mode === "F" ? filters : sort_types;
  const obj = store.value.find(
    (f: any) => f.name === level.selected.type.name
  );
  const nextField = obj?.inputFields?.find((f: any) => !f.on);
  if (nextField) enable(nextField, mode);
}

/** Walk backwards along a path turning off nodes; stop when a sibling is still active */
function deletePath(path: any[]) {
  for (let i = path.length - 1; i >= 0; i--) {
    const level = path[i];
    level.selected.on = false;
    if (level.options.some((opt: any) => opt.on)) break;
  }
  get();
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
    if (!sort_path_order.value.includes(key))
      sort_path_order.value.push(key);
  }
});

/** Begin dragging a sort row */
function onSortDragStart(idx: number) {
  drag_sort_idx.value = idx;
}

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
  nextTick(() => get());
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
    __variables: {} as any,
    [ROOT]: {
      __args: {} as any,
      edges: {
        node: {
          name: true,
          brand: { name: true },
          category: { name: true },
          toolMetrics: {
            edges: {
              node: {
                value: true,
                metric: { name: true },
              },
            },
          },
        },
      },
      count: true,
      counts: true,
    },
  },
};

const queryDoc = ref(gql(jtg(q)));
const queryVariables = ref<any>({});

const {
  result: a_r,
  loading: a_l,
  error: a_e,
  refetch: a_get,
} = useQuery(queryDoc, queryVariables);

/**
 * Rebuild and execute the query from the current filter + sort UI state.
 * Walks active paths to construct deeply nested filter/sort payloads,
 * then recompiles the GraphQL document and swaps variables to trigger Apollo's reactive refetch.
 */
function get(resetPage = true) {
  if (resetPage) current_page.value = 1;

  q.query.__variables = {};
  q.query[ROOT].__args = {};
  const newVariables: any = {};

  // --- Build filter payload ---
  // Walk each active filter path and nest values into a deeply nested object
  // e.g. paths [brand → name → icontains:"x"] becomes { brand: { name: { icontains: "x" } } }
  let filterPayload: any = {};

  activeFilterPaths.value.forEach((path) => {
    let currentLevel = filterPayload;

    for (let i = 0; i < path.length; i++) {
      const node = path[i].selected;

      if (i === path.length - 1) {
        // Leaf: assign the value (skip blanks to avoid querying `contains: ""`)
        if (node.value !== "" && node.value !== undefined)
          currentLevel[node.name] = node.value;
      } else {
        // Branch: ensure nested object exists and descend
        currentLevel[node.name] ??= {};
        currentLevel = currentLevel[node.name];
      }
    }
  });

  // Attach filter variable if any filters have values
  if (Object.keys(filterPayload).length > 0 && tool_root.value !== "") {
    q.query.__variables["filter"] = tool_root.value;
    q.query[ROOT].__args["filter"] = new VariableType("filter");
    newVariables["filter"] = filterPayload;
  }

  // --- Build sort payload ---
  // Same nesting logic as filters, but leaf values are "ASC"/"DESC" instead of user input
  // e.g. paths [brand → name → ASC, name → DESC] becomes { brand: { name: "ASC" }, name: "DESC" }
  let sortPayload: any = {};
  orderedSortPaths.value.forEach((path) => {
    let currentLevel = sortPayload;
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
  });

  // Attach orderBy variable. Wrap in array if the schema type is a LIST.
  if (Object.keys(sortPayload).length > 0 && sort_var_type.value !== "") {
    q.query.__variables["orderBy"] = sort_var_type.value;
    q.query[ROOT].__args["orderBy"] = new VariableType("orderBy");
    newVariables["orderBy"] = sort_var_type.value.startsWith("[")
      ? [sortPayload]
      : sortPayload;
  }

  // --- Attach pagination variables ---
  q.query.__variables["first"] = "Int";
  q.query.__variables["offset"] = "Int";
  q.query[ROOT].__args["first"] = new VariableType("first");
  q.query[ROOT].__args["offset"] = new VariableType("offset");
  newVariables["first"] = page_size.value;
  newVariables["offset"] = paginationOffset.value;

  // Recompile the query document and swap variables to trigger Apollo's reactive refetch
  queryDoc.value = gql(jtg(q));
  queryVariables.value = newVariables;
}

/** Proxy so template @keyup.enter and @change handlers read clearly */
function commitFilterValue() {
  get();
}

/** Convenience accessor for the current query result's root field */
function getEdges() {
  return a_r.value?.[ROOT];
}

// ================================================================
// 5. PAGINATION
//    Offset-based pagination using first/offset variables.
// ================================================================

/** Total number of pages based on result count and page size */
const totalPages = computed(() => {
  const count = getEdges()?.count || 0;
  return Math.max(1, Math.ceil(count / page_size.value));
});

/** Zero-based offset for the current page */
const paginationOffset = computed(() => (current_page.value - 1) * page_size.value);

/**
 * Navigate to a specific page and refetch.
 * Unlike filter/sort changes, this does NOT reset current_page to 1.
 */
function goToPage(n: number) {
  current_page.value = Math.max(1, Math.min(n, totalPages.value));
  get(false);
}

/**
 * Handle page size changes from the input field.
 * Clamps to a minimum of 1, resets to page 1, and refetches.
 */
function changePageSize(val: number) {
  page_size.value = Math.max(1, val || 1);
  current_page.value = 1;
  get();
}
</script>

<template>
  <div id="content" class="col">
    <div class="mx-auto" style="max-width: 1400px">
      <!-- BREADCRUMBS -->
      <nav class="mb-2" aria-label="breadcrumb">
        <ol class="breadcrumb m-0">
          <li class="breadcrumb-item"><a href="#">Home</a></li>
          <li class="breadcrumb-item active" aria-current="page">
            Properties
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
            v-model="search"
            class="form-control bg-secondary-subtle border-0"
            placeholder="Search (Name, Address)"
            style="height: 3rem"
            type="text"
            @keyup.enter="get()"
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
          <li class="list-group-item">
            <!-- Filter topbar: count + "Add Filter" dropdown -->
            <div
              class="d-flex align-items-center justify-content-between mb-2"
            >
              <h5 class="m-0">
                <b>{{ activeFilterPaths.length }} Filters</b>
              </h5>
              <div class="dropdown">
                <button
                  class="btn btn-primary btn-sm"
                  data-bs-toggle="dropdown"
                  aria-expanded="false"
                  :disabled="!!(q_l || q_e)"
                  @click="
                    nextTick(() => {
                      search_fields = '';
                      searchFilters?.focus();
                    })
                  "
                >
                  <i class="bi bi-plus-lg"></i>
                  Filter
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
                  <li class="mx-2 mb-1">
                    <input
                      ref="searchFilters"
                      v-model="search_fields"
                      class="form-control py-1"
                      type="text"
                      :placeholder="topLevel('F').length + ' Filters...'"
                    />
                  </li>
                  <li v-for="f in searchFieldsFn('F')" :key="f.name">
                    <button
                      class="dropdown-item text-capitalize"
                      @click="enable(f, 'F')"
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
              <table>
                <tbody>
                  <tr
                    v-for="(rowCells, rIdx) in filterGrid"
                    :key="'row-' + rIdx"
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
                            style="min-height: 31px"
                            @click="addNext(cell.level, 'F')"
                          >
                            {{ camel(cell.level.selected.name) }}
                          </button>
                        </td>
                        <!-- Col > 0: dropdown to swap between sibling options at this depth -->
                        <td v-else :rowspan="cell.rowSpan" style="height: 1px">
                          <select
                            :value="cell.level.selected.name"
                            @change="changeNode(cell.level, $event, 'F')"
                            class="btn btn-outline-secondary btn-sm text-capitalize border-secondary text-center rounded-0 h-100 w-100"
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
                            @change="commitFilterValue"
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
                            @keyup.enter="commitFilterValue"
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
                        class="btn btn-outline-danger btn-sm rounded-end-pill"
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
          </li>

          <!-- Sort topbar + grid (mirrors filter UI but leaf is ASC/DESC dropdown) -->
          <li class="list-group-item">
            <div
              class="d-flex align-items-center justify-content-between mb-2"
            >
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
                    nextTick(() => {
                      search_sort_fields = '';
                      searchSortFilters?.focus();
                    })
                  "
                >
                  <i class="bi bi-plus-lg"></i>
                  Sort
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
                  <li class="mx-2 mb-1">
                    <input
                      ref="searchSortFilters"
                      v-model="search_sort_fields"
                      class="form-control py-1"
                      type="text"
                      :placeholder="topLevel('O').length + ' Sorts...'"
                    />
                  </li>
                  <li v-for="f in searchFieldsFn('O')" :key="f.name">
                    <button
                      class="dropdown-item text-capitalize"
                      @click="enable(f, 'O'); get()"
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
              <table>
                <tbody>
                  <tr
                    v-for="(path, rIdx) in orderedSortPaths"
                    :key="'sort-row-' + rIdx"
                    draggable="true"
                    @dragstart="onSortDragStart(rIdx)"
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
                    }"
                    style="cursor: grab"
                  >
                    <!-- Drag handle -->
                    <td class="pe-0" style="height: 1px; width: 1px">
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
                          @click="addNext(level, 'O'); get()"
                        >
                          {{ camel(level.selected.name) }}
                        </button>
                      </td>
                      <!-- Col > 0: dropdown to swap between sibling options -->
                      <td v-else style="height: 1px">
                        <select
                          :value="level.selected.name"
                          @change="changeNode(level, $event, 'O')"
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
                        class="btn btn-outline-danger btn-sm rounded-end-pill"
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
          </li>

          <!-- Collapse toggle -->
          <li
            class="list-group-item d-flex align-items-center justify-content-center text-center p-0"
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
            <button class="btn btn-link btn-sm" @click="show_filters = true">
              <i class="bi bi-chevron-down"></i>
              expand
              <i class="bi bi-chevron-down"></i>
            </button>
            <b>{{ activeSortPaths.length }} Sorts</b>
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
        <div v-else-if="getEdges()?.count" class="table-responsive">
          <table class="table table-hover m-0">
            <thead>
              <tr class="table-secondary">
                <th>Name</th>
                <th>Brand</th>
                <th>Category</th>
                <th>Metrics</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in getEdges()?.edges" :key="h.node.name">
                <td>{{ h.node.name }}</td>
                <td>{{ h.node.brand?.name }}</td>
                <td>{{ h.node.category?.name }}</td>
                <td>
                  <div
                    v-for="(m, i) in h.node.toolMetrics?.edges"
                    :key="i"
                  >
                    {{ m.node.metric?.name }}: {{ m.node.value }}<span v-if="i < h.node.toolMetrics.edges.length - 1">, </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <h5 v-else class="alert alert-warning text-center m-0">No Results</h5>
      </div>

      <!-- PAGINATION -->
      <div
        v-if="getEdges()?.count"
        class="d-flex align-items-center justify-content-between my-3 flex-wrap gap-2"
      >
        <!-- Showing X–Y of Z using count (total) and counts (this page) -->
        <span class="text-muted small">
          Showing
          {{ paginationOffset + 1 }}–{{
            paginationOffset + (getEdges()?.counts || 0)
          }}
          of {{ getEdges()?.count }}
        </span>

        <!-- Page number buttons -->
        <div class="d-flex flex-wrap gap-1">
          <button
            v-for="p in totalPages"
            :key="p"
            class="btn btn-sm"
            :class="
              p === current_page
                ? 'btn-primary'
                : 'btn-outline-secondary'
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
            @change="changePageSize(+($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Highlight the drop target row with a top border during drag */
.sort-drop-target td {
  border-top: 2px solid var(--bs-primary) !important;
}
</style>
