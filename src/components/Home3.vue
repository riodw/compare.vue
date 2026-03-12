<script setup lang="ts">
import gql from "graphql-tag";
import {
  jsonToGraphQLQuery as jtg,
  VariableType,
} from "json-to-graphql-query";
import { ref, watch, computed, nextTick } from "vue";

// root object config
const ROOT = "toolMetrics";
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

// State
const search = ref("");
const show_filters = ref(true);
const search_fields = ref("");
const fields = ref<any[]>([]); // root level generic graphql args
const tool_root = ref("");
const filters = ref<any[]>([]); // dynamically nested schema filter options
const sorts = ref([]);

// Modals / Refs
const searchFilters = ref<any>(null);

// Strip __typename recursively
const stripTypename = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(stripTypename);
  if (obj && typeof obj === "object") {
    const { __typename, ...rest } = obj;
    for (const key in rest) {
      rest[key] = stripTypename(rest[key]);
    }
    return rest;
  }
  return obj;
};

// ----------------------------------------------------
// 1. DYNAMIC GRAPHQL SCHEMA INTROSPECTION
// ----------------------------------------------------

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

// WATCH - SCHEMA LOAD (Top level query args)
watch(q_r, (value) => {
  let f;
  try {
    f = value?.__type?.fields?.find((field: any) => field.name === ROOT)?.args;
  } catch (error) {
    console.error(error);
    fields.value = [];
  }

  f = stripTypename(f) || [];

  // Separate non-relational root model queries
  fields.value = f
    .filter((arg: any) => !NON_MODEL_ARGS.includes(arg.name))
    .filter((arg: any) => arg.type?.name !== "ID");

  // Locate the nested 'filter' argument graph object
  const filterArg = f.find((o: any) => o.name === "filter");
  if (filterArg?.type?.name) {
    tool_root.value = filterArg.type.name;
    getFilters(filterArg.type.name);
  }
});

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

const {
  result: f_r,
  load: f_l,
  error: f_err,
  refetch: f_get,
} = useLazyQuery(gql(jtg(input_query)));

// Recursively build up memory list of all nested filter object types
async function getFilters(typeName: string) {
  let data;
  if (f_r.value === undefined) {
    data = await f_l(null, { name: typeName });
  } else {
    const response = await f_get({ name: typeName });
    data = response?.data;
  }

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

  const existingIndex = filters.value.findIndex(
    (f: any) => f.name === inf.name
  );
  if (existingIndex !== -1) {
    Object.assign(filters.value[existingIndex], inf);
  } else {
    filters.value.push(inf);
  }

  for (const o of inf.inputFields) {
    if (o.type.kind === "INPUT_OBJECT") {
      await getFilters(o.type.name);
    }
  }
}

// ----------------------------------------------------
// 2. FILTER UI LOGIC
// ----------------------------------------------------

// Enable a top level filter and cascade open its children
function enableFilter(inputField: any) {
  inputField.on = true;

  if (inputField.type?.name) {
    const filterObj = filters.value.find(
      (f: any) => f.name === inputField.type.name
    );

    if (filterObj) {
      filterObj.on = true;

      // Unroll first child layer if nothing is currently selected
      if (
        filterObj.inputFields &&
        filterObj.inputFields.length > 0 &&
        !filterObj.inputFields[0].on
      ) {
        enableFilter(filterObj.inputFields[0]);
      }
    }
  }

  // Re-fetch grapqhl payload reactively
  get();
}

function camel(s: string) {
  return s.replace(/([A-Z])/g, " $1").trim();
}

// Helper to grab options available for "Add Filter" dropdown menu
function topLevelFilters() {
  const rootObj = filters.value.find((o: any) => o.name === tool_root.value);
  return rootObj?.inputFields || [];
}

// Filter dropdown box items array
function searchFields() {
  const searchStr = search_fields.value.toLowerCase();
  return topLevelFilters().filter(
    (arg: any) => arg.name.toLowerCase().includes(searchStr) && !arg.on
  );
}

// Compute an array of linear paths representing active filter sequences
const activeFilterPaths = computed(() => {
  const paths: any[][] = [];
  const rootObj = filters.value.find((o: any) => o.name === tool_root.value);
  if (!rootObj || !rootObj.inputFields) return paths;

  function traverse(currentObj: any, currentPath: any[]) {
    if (!currentObj.inputFields) {
      if (currentPath.length > 0) paths.push(currentPath);
      return;
    }

    const activeFields = currentObj.inputFields.filter((f: any) => f.on);

    if (activeFields.length === 0) {
      if (currentPath.length > 0) paths.push(currentPath);
      return;
    }

    for (const field of activeFields) {
      const isLeaf =
        field.type?.kind === "SCALAR" ||
        ["String", "Boolean", "Int", "Float", "Decimal", "ID"].includes(
          field.type?.name
        );

      const levelNode = {
        selected: field,
        options: currentObj.inputFields,
        isLeaf: isLeaf,
        fieldType: field.type?.name || "String",
      };

      const newPath = [...currentPath, levelNode];

      if (isLeaf) {
        paths.push(newPath);
      } else {
        const nextObj = filters.value.find(
          (f: any) => f.name === field.type?.name
        );
        if (nextObj) {
          traverse(nextObj, newPath);
        } else {
          paths.push(newPath);
        }
      }
    }
  }

  traverse(rootObj, []);
  return paths;
});

// Calculate spans and duplicates mapping flat paths into a smart 2D array representation
const filterGrid = computed(() => {
  const paths = activeFilterPaths.value;
  const grid: any[][] = paths.map(() => []);

  for (let row = 0; row < paths.length; row++) {
    for (let col = 0; col < paths[row].length; col++) {
      if (grid[row]?.[col]?.isSpanned) continue;

      const level = paths[row][col];
      if (!level) continue;

      let span = 1;

      for (let r = row + 1; r < paths.length; r++) {
        let isMatch = true;
        for (let c = 0; c <= col; c++) {
          if (
            !paths[r]?.[c] ||
            paths[r][c]?.selected?.name !== paths[row][c]?.selected?.name
          ) {
            isMatch = false;
            break;
          }
        }
        if (isMatch) {
          span++;
        } else {
          break;
        }
      }

      grid[row][col] = {
        level: level,
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

// Update the current node target, hide the old branch, expand the newly targeted nested branch
function changeNode(level: any, event: Event) {
  const target = event.target as HTMLSelectElement;
  if (!target) return;
  const newOptionName = target.value;
  if (level.selected.name === newOptionName) return;

  level.selected.on = false;
  const newOption = level.options.find((o: any) => o.name === newOptionName);
  if (newOption) {
    enableFilter(newOption);
  }
}

function addNextFilter(level: any) {
  if (level.selected.type?.name) {
    const filterObj = filters.value.find(
      (f: any) => f.name === level.selected.type.name
    );
    if (filterObj && filterObj.inputFields) {
      const nextField = filterObj.inputFields.find((f: any) => !f.on);
      if (nextField) {
        enableFilter(nextField);
      }
    }
  }
}

// Un-check the tree backwards to delete a row dynamically
function deletePath(path: any[]) {
  for (let i = path.length - 1; i >= 0; i--) {
    const level = path[i];
    level.selected.on = false;
    const siblingsActive = level.options.some((opt: any) => opt.on);
    if (siblingsActive) break;
  }
  get();
}

// ----------------------------------------------------
// 3. MAIN LIVE DATA QUERY
// ----------------------------------------------------

const q = {
  query: {
    __name: "MyQuery",
    __variables: {} as any,
    [ROOT]: {
      __args: {} as any,
      edges: {
        node: {
          id: true,
          value: true,
          // name: true,
          // brand: { name: true },
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

// Execute search using populated filter parameters
function get() {
  q.query.__variables = {};
  q.query[ROOT].__args = {};
  const newVariables: any = {};

  let filterPayload: any = {};

  // Compute a deeply nested object out of the flat visual paths
  activeFilterPaths.value.forEach((path) => {
    let currentLevel = filterPayload;

    for (let i = 0; i < path.length; i++) {
      const node = path[i].selected;

      // We skip evaluating blank payload inputs so as not to query `contains: ""` universally
      if (i === path.length - 1) {
        if (node.value !== "" && node.value !== undefined) {
          currentLevel[node.name] = node.value;
        }
      } else {
        if (!currentLevel[node.name]) {
          currentLevel[node.name] = {};
        }
        currentLevel = currentLevel[node.name];
      }
    }
  });

  // Attach recursive nested JSON schema to standard variable wrapper
  if (Object.keys(filterPayload).length > 0 && tool_root.value !== "") {
    q.query.__variables["filter"] = tool_root.value;
    q.query[ROOT].__args["filter"] = new VariableType("filter");
    newVariables["filter"] = filterPayload;
  }

  queryDoc.value = gql(jtg(q));
  queryVariables.value = newVariables;
}

// Ensure "ENTER" typed into leaf input blocks sends query refresh
function commitFilterValue() {
  get();
}

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

      <!-- FILTERS PANEL -->
      <div v-if="!q_e" class="card mb-4">
        <ul v-if="show_filters" class="list-group list-group-flush">
          <li class="list-group-item">
            <!-- Add new filter topbar -->
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
                  <!-- Show list of active root options -->
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

            <!-- Flattened Dynamic Pathways Layout  -->
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
                        <td
                          v-if="cIdx === 0"
                          :rowspan="cell.rowSpan"
                          style="height: 1px"
                        >
                          <!-- Level 0: Add new filter branch button -->
                          <button
                            class="btn btn-outline-primary btn-sm text-capitalize w-100 rounded-start-pill px-3 h-100 w-100"
                            style="min-height: 31px"
                            @click="addNextFilter(cell.level)"
                          >
                            {{ camel(cell.level.selected.name) }}
                          </button>
                        </td>
                        <!-- Level > 0: Show options available at this depth level  -->
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

                        <!-- Conditionally drop the input box based on types  -->
                        <td
                          v-if="cell.level.isLeaf"
                          :rowspan="cell.rowSpan"
                          style="height: 1px"
                        >
                          <!-- Boolean Type: Show Dropdown -->
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

                          <!-- Standard Datatypes: Show Text Box -->
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
                    <!-- Delete Button for the path -->
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
          <!-- Sorts Block -->
          <li class="list-group-item">
            <div class="d-flex align-items-center justify-content-between">
              <h5 class="m-0">
                <b>{{ sorts.length }} Sorts</b>
              </h5>
            </div>
          </li>
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
            <b>{{ sorts.length }} Sorts</b>
          </li>
        </ul>
      </div>

      <!-- DATA OVERVIEW -->
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
