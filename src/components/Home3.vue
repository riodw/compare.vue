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
    getFilters(filterArg.type.name);
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
      getSortTypes(innerName);
    }
  }
});

// Reusable introspection query — fetches inputFields for any named INPUT_OBJECT type.
// Used by both getFilters() and getSortTypes() via separate lazy query instances.
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
 * Walk the filter type graph depth-first, storing each INPUT_OBJECT in `filters`.
 * Each type gets `on`/`value` UI state. Recurses into nested INPUT_OBJECT children.
 */
async function getFilters(typeName: string) {
  let data;
  if (f_r.value === undefined) data = await f_l(null, { name: typeName });
  else data = (await f_get({ name: typeName }))?.data;

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

  // Upsert into the flat filters list (avoid duplicates on re-fetch)
  const existingIndex = filters.value.findIndex(
    (f: any) => f.name === inf.name
  );
  if (existingIndex !== -1) Object.assign(filters.value[existingIndex], inf);
  else filters.value.push(inf);

  // Recurse into any nested INPUT_OBJECT children
  for (const o of inf.inputFields)
    if (o.type.kind === "INPUT_OBJECT") await getFilters(o.type.name);
}

/**
 * Same as getFilters but for sort types — walks the orderBy INPUT_OBJECT tree.
 * Stores each discovered type in `sort_types` with `on`/`value` UI state.
 */
async function getSortTypes(typeName: string) {
  let data;
  if (s_r.value === undefined) data = await s_l(null, { name: typeName });
  else data = (await s_get({ name: typeName }))?.data;

  if (!data?.__type?.inputFields) return;

  let inf = stripTypename(data.__type);
  inf.inputFields = inf.inputFields.filter(
    (o: any) => !NON_MODEL_ARGS.includes(o.name)
  );

  inf.on = false;
  inf.value = "";
  inf.inputFields.map((o: any) => {
    o.on = false;
    o.value = "";
  });

  const existingIndex = sort_types.value.findIndex(
    (f: any) => f.name === inf.name
  );
  if (existingIndex !== -1)
    Object.assign(sort_types.value[existingIndex], inf);
  else sort_types.value.push(inf);

  for (const o of inf.inputFields)
    if (o.type.kind === "INPUT_OBJECT") await getSortTypes(o.type.name);
}

// ================================================================
// 2. FILTER UI LOGIC
//    Manages the interactive filter builder: enabling/disabling
//    filter branches, computing active paths through the type tree,
//    and laying them out as a grid with merged rowspans.
// ================================================================

/**
 * Toggle a filter field on and cascade-open the first child at each level.
 * Triggers a query rebuild after activation.
 */
function enableFilter(inputField: any) {
  inputField.on = true;

  if (inputField.type?.name) {
    const filterObj = filters.value.find(
      (f: any) => f.name === inputField.type.name
    );
    if (filterObj) {
      filterObj.on = true;
      // Auto-expand the first child if nothing is selected yet
      if (filterObj.inputFields?.length > 0 && !filterObj.inputFields[0].on)
        enableFilter(filterObj.inputFields[0]);
    }
  }

  // Rebuild the GraphQL query with the new filter state
  get();
}

/** Convert camelCase to spaced words for display: "brandName" → "brand Name" */
function camel(s: string) {
  return s.replace(/([A-Z])/g, " $1").trim();
}

/** Get the root-level filter inputFields (the top-level options in the "Add Filter" dropdown) */
function topLevelFilters() {
  return (
    filters.value.find((o: any) => o.name === tool_root.value)?.inputFields ||
    []
  );
}

/** Filter the dropdown items by the search text, excluding already-active fields */
function searchFields() {
  const searchStr = search_fields.value.toLowerCase();
  return topLevelFilters().filter(
    (arg: any) => arg.name.toLowerCase().includes(searchStr) && !arg.on
  );
}

/**
 * Walk the filter type tree and collect every active branch as a linear path.
 * Each path is an array of { selected, options, isLeaf, fieldType } nodes
 * representing one row in the filter grid UI.
 */
const activeFilterPaths = computed(() => {
  const paths: any[][] = [];
  const rootObj = filters.value.find((o: any) => o.name === tool_root.value);
  if (!rootObj?.inputFields) return paths;

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
      // Leaf = scalar type or known primitive — these get an input/select in the UI
      const isLeaf =
        field.type?.kind === "SCALAR" ||
        ["String", "Boolean", "Int", "Float", "Decimal", "ID"].includes(
          field.type?.name
        );

      const levelNode = {
        selected: field,
        options: currentObj.inputFields,
        isLeaf,
        fieldType: field.type?.name || "String",
      };

      const newPath = [...currentPath, levelNode];

      if (isLeaf) paths.push(newPath);
      else {
        // Recurse deeper into the nested INPUT_OBJECT
        const nextObj = filters.value.find(
          (f: any) => f.name === field.type?.name
        );
        if (nextObj) traverse(nextObj, newPath);
        else paths.push(newPath);
      }
    }
  }

  traverse(rootObj, []);
  return paths;
});

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
function changeNode(level: any, event: Event) {
  const target = event.target as HTMLSelectElement;
  if (!target) return;
  const newOptionName = target.value;
  if (level.selected.name === newOptionName) return;

  // Deactivate old branch, activate new one
  level.selected.on = false;
  const newOption = level.options.find((o: any) => o.name === newOptionName);
  if (newOption) enableFilter(newOption);
}

/** Expand the next unused sibling field within a filter branch */
function addNextFilter(level: any) {
  if (!level.selected.type?.name) return;
  const filterObj = filters.value.find(
    (f: any) => f.name === level.selected.type.name
  );
  const nextField = filterObj?.inputFields?.find((f: any) => !f.on);
  if (nextField) enableFilter(nextField);
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

/** Get the root-level sort inputFields for the "Add Sort" dropdown */
function topLevelSorts() {
  return (
    sort_types.value.find((o: any) => o.name === sort_root.value)
      ?.inputFields || []
  );
}

/** Filter sort dropdown items by search text, excluding already-active fields */
function searchSortFieldsFn() {
  const searchStr = search_sort_fields.value.toLowerCase();
  return topLevelSorts().filter(
    (arg: any) => arg.name.toLowerCase().includes(searchStr) && !arg.on
  );
}

/**
 * Toggle a sort field on and cascade-open children.
 * Leaf nodes (ENUM direction) default to "ASC". Triggers a query rebuild.
 */
function enableSort(inputField: any) {
  inputField.on = true;

  if (inputField.type?.kind === "INPUT_OBJECT" && inputField.type?.name) {
    const sortObj = sort_types.value.find(
      (f: any) => f.name === inputField.type.name
    );
    if (sortObj) {
      sortObj.on = true;
      if (sortObj.inputFields?.length > 0 && !sortObj.inputFields[0].on)
        enableSort(sortObj.inputFields[0]);
    }
  } else if (!inputField.value)
    // Leaf node (ENUM direction) — default to ascending
    inputField.value = "ASC";

  get();
}

/**
 * Collect active sort branches as linear paths (same traversal pattern as filters).
 * Leaf detection uses kind !== INPUT_OBJECT to catch ENUM sort directions.
 */
const activeSortPaths = computed(() => {
  const paths: any[][] = [];
  const rootObj = sort_types.value.find(
    (o: any) => o.name === sort_root.value
  );
  if (!rootObj?.inputFields) return paths;

  function traverse(currentObj: any, currentPath: any[]) {
    if (!currentObj.inputFields) {
      if (currentPath.length > 0) paths.push(currentPath);
      return;
    }

    const activeFields = currentObj.inputFields.filter((f: any) => f.on);

    if (!activeFields.length)
      if (currentPath.length > 0) return paths.push(currentPath);

    for (const field of activeFields) {
      // For sorts, anything that isn't INPUT_OBJECT is a leaf (typically ENUM: ASC/DESC)
      const isLeaf = field.type?.kind !== "INPUT_OBJECT";

      const levelNode = {
        selected: field,
        options: currentObj.inputFields,
        isLeaf,
        fieldType: field.type?.name || "String",
      };

      const newPath = [...currentPath, levelNode];

      if (isLeaf) paths.push(newPath);
      else {
        const nextObj = sort_types.value.find(
          (f: any) => f.name === field.type?.name
        );
        if (nextObj) traverse(nextObj, newPath);
        else paths.push(newPath);
      }
    }
  }

  traverse(rootObj, []);
  return paths;
});

/** Build the sort grid with merged rowspans (same algorithm as filterGrid) */
const sortGrid = computed(() => {
  const paths = activeSortPaths.value;
  const grid: any[][] = paths.map(() => []);

  for (let row = 0; row < paths.length; row++) {
    for (let col = 0; col < paths[row].length; col++) {
      if (grid[row]?.[col]?.isSpanned) continue;

      const level = paths[row][col];
      if (!level) continue;

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

      for (let r = row + 1; r < row + span; r++) {
        if (!grid[r]) grid[r] = [];
        grid[r][col] = { isSpanned: true };
      }
    }
  }

  return grid;
});

/** Swap a sort node to a different option (same pattern as changeNode for filters) */
function changeSortNode(level: any, event: Event) {
  const target = event.target as HTMLSelectElement;
  if (!target) return;
  const newOptionName = target.value;
  if (level.selected.name === newOptionName) return;

  level.selected.on = false;
  const newOption = level.options.find((o: any) => o.name === newOptionName);
  if (newOption) enableSort(newOption);
}

/** Expand the next unused sibling field within a sort branch */
function addNextSort(level: any) {
  if (!level.selected.type?.name) return;
  const sortObj = sort_types.value.find(
    (f: any) => f.name === level.selected.type.name
  );
  const nextField = sortObj?.inputFields?.find((f: any) => !f.on);
  if (nextField) enableSort(nextField);
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
          id: true,
          // value: true,
          name: true,
          brand: { name: true },
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
function get() {
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
  activeSortPaths.value.forEach((path) => {
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
                      :placeholder="topLevelFilters().length + ' Filters...'"
                    />
                  </li>
                  <li v-for="f in searchFields()" :key="f.name">
                    <button
                      class="dropdown-item text-capitalize"
                      @click="enableFilter(f)"
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
                            @click="addNextFilter(cell.level)"
                          >
                            {{ camel(cell.level.selected.name) }}
                          </button>
                        </td>
                        <!-- Col > 0: dropdown to swap between sibling options at this depth -->
                        <td v-else :rowspan="cell.rowSpan" style="height: 1px">
                          <select
                            :value="cell.level.selected.name"
                            @change="changeNode(cell.level, $event)"
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
                      :placeholder="topLevelSorts().length + ' Sorts...'"
                    />
                  </li>
                  <li v-for="f in searchSortFieldsFn()" :key="f.name">
                    <button
                      class="dropdown-item text-capitalize"
                      @click="enableSort(f)"
                    >
                      {{ camel(f.name) }}
                    </button>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Sort grid layout -->
            <div
              v-if="sortGrid.length"
              class="border-top pt-2 mt-2 overflow-x-auto"
            >
              <table>
                <tbody>
                  <tr
                    v-for="(rowCells, rIdx) in sortGrid"
                    :key="'sort-row-' + rIdx"
                  >
                    <template
                      v-for="(cell, cIdx) in rowCells"
                      :key="'sort-cell-' + cIdx"
                    >
                      <template v-if="!cell.isSpanned">
                        <td
                          v-if="cIdx === 0"
                          :rowspan="cell.rowSpan"
                          style="height: 1px"
                        >
                          <button
                            class="btn btn-outline-primary btn-sm text-capitalize w-100 rounded-start-pill px-3 h-100"
                            style="min-height: 31px"
                            @click="addNextSort(cell.level)"
                          >
                            {{ camel(cell.level.selected.name) }}
                          </button>
                        </td>
                        <td v-else :rowspan="cell.rowSpan" style="height: 1px">
                          <select
                            :value="cell.level.selected.name"
                            @change="changeSortNode(cell.level, $event)"
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

                        <!-- Sort direction: ASC / DESC -->
                        <td
                          v-if="cell.level.isLeaf"
                          :rowspan="cell.rowSpan"
                          style="height: 1px"
                        >
                          <select
                            v-model="cell.level.selected.value"
                            class="btn btn-outline-secondary btn-sm border-secondary rounded-0 h-100 w-100"
                            style="min-height: 31px"
                            @change="get()"
                          >
                            <option value="ASC">ASC</option>
                            <option value="DESC">DESC</option>
                          </select>
                        </td>
                      </template>
                    </template>
                    <!-- Delete: removes this sort path -->
                    <td>
                      <button
                        class="btn btn-outline-danger btn-sm rounded-end-pill"
                        style="height: 100%; min-height: 31px"
                        @click="deletePath(activeSortPaths[rIdx] || [])"
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
                <th>&nbsp;</th>
                <th>Name</th>
                <th>Price</th>
                <th class="text-end"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in getEdges()?.edges" :key="h.node.id">
                <td class="text-end ps-0">
                  <div
                    class="text-center overflow-hidden rounded-4 bg-warning text-uppercase ms-auto"
                    style="width: 3rem; height: 3rem; line-height: 3rem"
                  >
                    --
                  </div>
                </td>
                <td>
                  <b>{{ h.node.name }}</b>
                </td>
                <td class="d-none d-sm-table-cell">
                  <i>{{ h.node.brand?.name || "No Brand" }}</i>
                </td>
                <td class="text-end d-none d-md-table-cell">
                  <button class="btn btn-secondary btn-sm">
                    <i class="bi bi-pencil-fill"></i>
                    &nbsp;Edit
                  </button>
                  <button class="btn btn-danger btn-sm ms-1">
                    <i class="bi bi-trash3-fill"></i>
                    &nbsp;Remove
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <h5 v-else class="alert alert-warning text-center m-0">No Results</h5>
      </div>
    </div>
  </div>
</template>
