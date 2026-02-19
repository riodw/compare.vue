<script setup lang="ts">
import gql from "graphql-tag";
import {
  jsonToGraphQLQuery as jtg,
  VariableType,
} from "json-to-graphql-query";

const search = ref("");
const show_filters = ref(true);
const fields = ref([]);
const search_fields = ref("");
const filters = ref<{ [key: string]: any }>({});
const sorts = ref([]);

const fields_query = {
  query: {
    __type: {
      __args: { name: "Query" },
      fields: {
        __args: { includeDeprecated: true },
        name: true,
        args: {
          name: true,
          type: {
            name: true,
            kind: true,
            inputFields: {
              name: true,
              type: {
                name: true,
                kind: true,
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
  console.log(value);
  let f = [];
  try {
    const allToolsField = value?.__type?.fields?.find(
      (field: any) => field.name === "allTools"
    );
    f =
      allToolsField?.args?.find((arg: any) => arg.name === "filter")?.type
        ?.inputFields || [];
  } catch (error) {
    console.error(error);
    return [];
  }

  f = f.filter((o: any) => !["and", "or", "not"].includes(o.name));

  console.log("field_schema", f);
  fields.value = f;
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

// ADD FILTER
function addFilter(f: any) {
  const new_field = {
    selected: f.type.inputFields[0],
    value: "",
  };

  // check if already added
  if (filters.value[f.name])
    return filters.value[f.name].fields.push(new_field);

  // add new filter
  filters.value[f.name] = {
    ...f,
    fields: [new_field],
  };
}

function name(name: string) {
  return name.match(/(?<!\p{L}\p{M}*)\p{L}/gu)?.join("");
}

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
                  <!-- {{ filters.length }}  -->
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
                      type="email"
                      :placeholder="fields.length + ' Filters...'"
                    />
                  </li>
                  <!-- <li v-for="f in searchFields()" :key="f.name">
                        <button
                          class="dropdown-item text-capitalize"
                          @click="addFilter(f)"
                        >
                          {{ camel(f.name) }}
                        </button>
                      </li> -->
                </ul>
              </div>
              <!-- <button class="btn btn-outline-danger btn-sm">Remove All</button> -->
            </div>
            <!-- active -->
            <div class="d-flex border-top flex-wrap pt-1 mt-2">
              <div v-for="(f, k) in filters" :key="k" class="d-flex m-1">
                <div>
                  <button
                    class="btn btn-outline-primary btn-sm h-100 text-capitalize rounded-start-pill"
                    @click="addFilter(f)"
                  >
                    {{ camel(k.toString()) }}
                  </button>
                </div>
                <div class="d-flex flex-column">
                  <!-- TODO: problem with overlapping keys -->
                  <div
                    v-for="(ff, index) in f.fields"
                    :key="index"
                    class="input-group flex-nowrap text-nowrap w-auto mw-100"
                  >
                    <select
                      v-model="ff.selected"
                      class="btn btn-outline-secondary btn-sm text-capitalize rounded-0 border-start-0"
                    >
                      <option
                        v-for="o in f.type.inputFields"
                        :key="o.name"
                        :value="o"
                      >
                        {{ camel(o.name) }}
                      </option>
                    </select>
                    <input
                      v-if="ff.selected.type.name === 'String'"
                      v-model="ff.value"
                      :placeholder="camel(ff.selected.type.name) + '...'"
                      class="form-control border-secondary d-inline-flex flex-grow-0 lh-1"
                      style="min-width: 110px; font-size: 0.875rem"
                    />
                    <!-- @keyup.enter="get(f)" -->
                    <select
                      v-else-if="ff.selected.type.name === 'Boolean'"
                      v-model="ff.value"
                      class="btn btn-outline-secondary btn-sm"
                    >
                      <!-- @change="get(f)" -->
                      <option disabled value="">
                        {{ camel(ff.selected.type.name) }}...
                      </option>
                      <option :value="true">True</option>
                      <option :value="false">False</option>
                    </select>
                    <button
                      class="btn btn-outline-danger btn-sm rounded-end-pill ps-1"
                      @click="
                        f.fields.length === 1
                          ? delete filters[k]
                          : f.fields.splice(index, 1)
                      "
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
