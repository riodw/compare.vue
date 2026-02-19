<script setup lang="ts">
import gql from "graphql-tag";
import {
  jsonToGraphQLQuery as jtg,
  VariableType,
} from "json-to-graphql-query";

const NON_MODEL_ARGS = [
  "first",
  "last",
  "before",
  "after",
  "offset",
  "orderBy",
];

const search = ref("");
const show_filters = ref(true);
const fields = ref([]);
const search_fields = ref("");
// const filters = ref<{ [key: string]: any }>({});
const filters = ref([]);
const sorts = ref([]);

const fields_query = {
  query: {
    __type: {
      __args: { name: "Query" },
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
            inputFields: {
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
      },
    },
  },
};

const {
  result: f_r,
  loading: f_l,
  error: f_e,
} = useQuery(gql(jtg(fields_query)));

// WATCH - FILTERS LOAD
watch(f_r, (value) => {
  let f = [];
  try {
    f = value?.__type?.fields?.find(
      (field: any) => field.name === "allTools"
    ).args;
  } catch (error) {
    console.error(error);
    fields.value = [];
  }

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

  f = stripTypename(f);

  // top level args
  fields.value = f?.filter((arg: any) => !NON_MODEL_ARGS.includes(arg.name));
  console.dir(fields.value);
  // console.log("topLevelArgs", topLevelArgs);

  // clean array
  // let cleanArgs = [];
  // // let cleanArgs: String[] = topLevelArgs?.map((arg: any) => arg.name) || [];
  // // console.log("cleanArgs", cleanArgs);
  // topLevelArgs.forEach((arg: any) => {
  //   let name = arg.name.split("_");
  //   // is first?
  //   if (name[1] === undefined) {
  //     // let fixed_filter_name = name[0].replace(/([A-Z])/g, " $1").trim();
  //     // arg.fixed_name = "is";
  //     cleanArgs.push({
  //       name: name[0],
  //       // fixed_name: fixed_filter_name,
  //       options: [arg],
  //     });
  //   } else {
  //     // arg.fixed_name = name[1];
  //     // find existing
  //     let existing = cleanArgs.find((o: any) => o.name === name[0]);
  //     if (existing) existing.options.push(arg);
  //   }
  // });
  // console.log(cleanArgs);
});

//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
// Find top level filters
function topLevelFilters() {
  return fields.value.filter((arg: any) => !arg.name.includes("_"));
}

// FILTERED FIELDS
function searchFields() {
  const search = search_fields.value.toLowerCase();
  return topLevelFilters()
    .filter((arg: any) => arg.name.toLowerCase().includes(search))
    .filter(
      (arg: any) => !filters.value.some((f: any) => f.name === arg.name)
    );
}

// ADD FILTER
function addFilter(f: any) {
  filters.value.push({
    ...f,
    select: "",
  });
}

function addNextFilter(k_name: String = "") {
  if (!Object.keys(groupedFilters()).includes("is"))
    return addFilter(findField([k_name, "is"]));
  // const options = Object.keys(groupedFilters(fields.value));
  // console.log("options", options);
  // const next_option = fields.value.find(

  // )
  // addFilter(f);
}

// Grouped filters by name, with options
function groupedFilters(list = filters.value) {
  const grouped: { [key: string]: any } = {};
  list.forEach((arg: any) => {
    const name = arg.name.split("_");
    if (!grouped[name[0]]) grouped[name[0]] = {};
    if (!name[1]) name[1] = "is";

    let start_value: any = "";
    if (arg.select) start_value = arg.select;
    else if (arg.type.name === "Boolean") start_value = true;
    grouped[name[0]][name[1]] = start_value;
  });
  return grouped;
}

function translateFilterName(k_name) {
  if (k_name[1] === "is") return k_name[0];
  return k_name.join("_");
}

function findField(k_name) {
  k_name = translateFilterName(k_name);
  // console.log("findField", k_name);
  return fields.value.find((arg: any) => arg.name === k_name);
}

function findFilter(k_name) {
  k_name = translateFilterName(k_name);
  // console.log("findFilter", k_name);
  return filters.value.find((arg: any) => arg.name === k_name);
}

function findFieldType(k_name) {
  if (k_name[1] === "is") return "String";
  return findField(k_name)?.type?.name;
}

function findAddFilter(k_name) {
  const f = findField(k_name);
  k_name = translateFilterName(k_name);
  // console.log("addFilter", k_name);
  if (filters.value.filter((f: any) => f.name === k_name).length) return;
  addFilter(f);
}

function removeFilter(k_name) {
  k_name = translateFilterName(k_name);
  // console.log("removeFilter", k_name);
  filters.value = filters.value.filter((f: any) => f.name !== k_name);
}

// function name(name: string) {
//   return name.match(/(?<!\p{L}\p{M}*)\p{L}/gu)?.join("");
// }

function camel(s: string) {
  return s.replace(/([A-Z])/g, " $1").trim();
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
        <h1 class="m-0">
          <!-- {{ a_r?.houses.count || "--" }} -->
          -- Properties
        </h1>
        <div>
          <button
            data-bs-toggle="modal"
            data-bs-target="#exampleModal"
            class="btn btn-primary"
          >
            <i class="bi bi-plus-lg me-1"></i>
            <span class="d-none d-sm-inline">New</span>
            Property
          </button>
        </div>
      </div>
      <!-- SEARCH -->
      <div class="d-flex align-items-center my-3">
        <div class="input-group">
          <!-- :disabled="s_l" -->
          <input
            v-model="search"
            class="form-control bg-secondary-subtle border-0"
            placeholder="Search (Name, Address)"
            style="height: 3rem"
            type="text"
          />
          <button
            v-if="search && !f_l"
            class="btn bg-secondary-subtle text-secondary"
            @click="search = ''"
          >
            <i class="bi bi-x-circle-fill"></i>
          </button>
        </div>
      </div>
      <!-- <pre>{{ filters }}</pre> -->
      <!-- FILTERS -->
      <div v-if="!f_e" class="card mb-3">
        <ul v-if="show_filters" class="list-group list-group-flush">
          <!-- Filters -->
          <li class="list-group-item">
            <!-- add -->
            <div class="d-flex align-items-center justify-content-between">
              <h5 class="m-0">
                <b>
                  {{ filters.length }}
                  Filters
                </b>
              </h5>
              <div class="dropdown">
                <button
                  class="btn btn-primary btn-sm"
                  data-bs-toggle="dropdown"
                  aria-expanded="false"
                  :disabled="f_l || f_e ? true : false"
                  @click="
                    nextTick(() => {
                      search_fields = '';
                      $refs.searchFilters.focus();
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
                      @click="addFilter(f)"
                    >
                      {{ camel(f.name) }}
                    </button>
                  </li>
                </ul>
              </div>
              <!-- <button class="btn btn-outline-danger btn-sm">Remove All</button> -->
            </div>
            <!-- active -->
            <div class="d-flex border-top flex-wrap pt-1 mt-2">
              <div
                v-for="(v, k) in groupedFilters()"
                :key="k"
                class="d-flex m-1"
              >
                <div>
                  <button
                    class="btn btn-outline-primary btn-sm h-100 text-capitalize rounded-start-pill"
                    @click="addNextFilter(k)"
                  >
                    {{ camel(k) }}
                  </button>
                </div>
                <div class="d-flex flex-column">
                  <!-- TODO: problem with overlapping keys -->
                  <div
                    v-for="(vv, kk) in v"
                    :key="kk"
                    class="input-group flex-nowrap text-nowrap w-auto mw-100 h-100"
                  >
                    <select
                      @change="
                        findAddFilter([k, $event.target.value]);
                        removeFilter([k, kk]);
                      "
                      class="btn btn-outline-secondary btn-sm text-capitalize rounded-0 border-start-0"
                    >
                      <option
                        v-for="(gfv, gfk) in groupedFilters(fields)[k]"
                        :key="gfk"
                        :value="gfk"
                        :selected="kk === gfk"
                      >
                        {{ camel(gfk) }}
                      </option>
                    </select>
                    <input
                      v-if="findFieldType([k, kk]) === 'String'"
                      :placeholder="findFieldType([k, kk]) + '...'"
                      v-model="findFilter([k, kk]).select"
                      class="form-control border-secondary d-inline-flex flex-grow-0 lh-1 w-auto"
                      type="text"
                      style="min-width: 110px; font-size: 0.875rem"
                    />
                    <!-- @keyup.enter="get(f)"
                    <select
                      v-else-if="ff.selected.type.name === 'Boolean'"
                      v-model="ff.value"
                      class="btn btn-outline-secondary btn-sm"
                    >
                      @change="get(f)"
                      <option disabled value="">
                        {{ camel(ff.selected.type.name) }}...
                      </option>
                      <option :value="true">True</option>
                      <option :value="false">False</option>
                    </select> -->
                    <button
                      class="btn btn-outline-danger btn-sm rounded-end-pill ps-1"
                      @click="removeFilter([k, kk])"
                    >
                      <i class="bi bi-trash3"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </li>
          <!-- Sorts -->
          <li class="list-group-item">
            <!-- add -->
            <div class="d-flex align-items-center justify-content-between">
              <h5 class="m-0">
                <b>{{ sorts.length }} Sorts</b>
              </h5>
            </div>
          </li>
          <!-- Hide -->
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
        <!-- Collapsed -->
        <ul v-else class="list-group list-group-flush">
          <li
            class="list-group-item d-flex align-items-center justify-content-between"
          >
            <b>Filters</b>

            <button class="btn btn-link btn-sm" @click="show_filters = true">
              <i class="bi bi-chevron-down"></i>
              expand
              <i class="bi bi-chevron-down"></i>
            </button>
            <b>{{ sorts.length }} Sorts</b>
          </li>
        </ul>
      </div>
      <!-- DATA -->
      <pre>
        {{ groupedFilters() }}
       </pre
      >
      <pre>
        {{ filters }}
       </pre
      >
      <div>
        <!-- <template v-if="a_l">
              <h5 class="alert alert-primary text-center m-0">Loading...</h5>
            </template>
            <h5 v-else-if="a_e" class="alert alert-danger text-center m-0">
              {{ a_e }}
            </h5> -->
        <div v-if="true" class="table-responsive">
          <table class="table table-hover m-0">
            <!-- <thead>
          <tr class="table-secondary">
            <th>&nbsp;</th>
            <th>Name</th>
            <th>Last Stay</th>
            <th class="text-end"></th>
          </tr>
        </thead> -->
            <tbody>
              <!-- <tr v-for="h in a_r?.houses?.edges" :key="h.node.id">
                    <td class="text-end ps-0">
                      <div
                        class="text-center overflow-hidden rounded-4 bg-warning text-uppercase ms-auto"
                        style="width: 3rem; height: 3rem; line-height: 3rem"
                      >
                        {{ name(h.node.name) }}
                      </div>
                    </td>
                    <td>
                      <b>
                        {{ h.node.name }}
                      </b>
                      <div class="text-secondary">
                        {{ h.node.address.street }}, {{ h.node.address.city }},
                        {{ h.node.address.state }}
                        {{ h.node.address.zip }}
                      </div>
                    </td>
                    <td class="d-none d-sm-table-cell">
                      <i>
                        Wed. Jun 12, 2015
                        <div class="text-secondary">Thu. Jun 22, 2015</div>
                      </i>
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
                  </tr> -->
              <!-- <tr>
            <td class="text-end">
              <div
                class="text-center overflow-hidden rounded-4 bg-warning ms-auto"
                style="width: 3rem; height: 3rem; line-height: 3rem"
              >
                SS
              </div>
            </td>
            <td>
              <b>Sandy Shores</b>
              <div class="text-secondary">
                3726 Bayberry Drive, Danielsville, PA 18038
              </div>
            </td>
            <td class="d-none d-sm-table-cell">
              <i>
                Wed. Jun 12, 2015
                <div class="text-secondary">Thu. Jun 22, 2015</div>
              </i>
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
          </tr> -->
            </tbody>
          </table>
        </div>
        <h5 v-else class="alert alert-warning text-center m-0">No Results</h5>
      </div>
      <!-- PAGINATION -->
      <!-- <nav
    v-if="a_r?.houses.count > 0"
    class="d-print-none mt-3"
  >
    <ul class="pagination">
      <li class="page-item">
        <button
          :disabled="a_l"
          class="page-link active"
        >
          1
        </button>
      </li>
      <li class="page-item">
        <button
          :disabled="a_l"
          class="page-link"
        >
          2
        </button>
      </li>
    </ul>
  </nav> -->

      <!-- MODALS -->
      <!-- MODALS -->
      <!-- MODALS -->

      <div
        id="exampleModal"
        class="modal fade"
        tabindex="-1"
        aria-labelledby="exampleModalLabel"
        aria-hidden="true"
      >
        <div class="modal-dialog modal-fullscreen-sm-down">
          <div class="modal-content">
            <div class="modal-header">
              <h1 class="modal-title fs-5">Modal title</h1>
              <button
                class="btn-close"
                data-bs-dismiss="modal"
                aria-label="Close"
              ></button>
            </div>
            <div class="modal-body">...</div>
            <div class="modal-footer">
              <button class="btn btn-secondary" data-bs-dismiss="modal">
                Close
              </button>
              <button class="btn btn-primary">Save changes</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
