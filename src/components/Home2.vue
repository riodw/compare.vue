<script setup lang="ts">
import gql from "graphql-tag";
import {
  jsonToGraphQLQuery as jtg,
  VariableType,
} from "json-to-graphql-query";

// root object
const ROOT = "tools";

const NON_MODEL_ARGS = [
  "filter",
  //
  "first",
  "last",
  "before",
  "after",
  "offset",
  "orderBy",
  //
  "and",
  "or",
  "not",
];

const tool_root = ref({});
const filters = ref<any[]>([]);
// const filters = ref<{ [key: string]: any }>({});
const fields = ref([]);
// const filters_used = ref<string[]>([]);
const f_selected = ref("");

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

// WATCH - FILTERS LOAD
watch(q_r, (value) => {
  let f = value?.__type?.fields?.find(
    (field: any) => field.name === ROOT
  ).args;

  f = stripTypename(f);

  console.log("schema", f);
  // top level args

  f = f.find((o: any) => o.name === "filter");
  console.log("filter arg", f);

  tool_root.value = f.type.name;
  getFilters(f.type.name);
});

const input_query = {
  query: {
    // Define the variable at the top level
    __variables: {
      name: "String!",
    },
    __type: {
      // Use the variable here
      __args: { name: new VariableType("name") },
      name: true,
      kind: true,
      inputFields: {
        name: true,
        type: {
          kind: true,
          name: true,
          // Include ofType to catch List/NonNull wrappers
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
  error: f_e,
  refetch: f_get,
} = useLazyQuery(gql(jtg(input_query)));

async function getFilters(typeName: string) {
  let data;

  // Use load for the very first call, refetch for everything else
  if (f_r.value === undefined) {
    data = await f_l(null, { name: typeName });
  } else {
    // refetch returns a promise with the data directly
    const response = await f_get({ name: typeName });
    data = response?.data;
  }

  if (!data?.__type?.inputFields)
    return console.warn(`No inputFields found for type ${typeName}`);

  let inf = stripTypename(data.__type);
  inf.inputFields = inf.inputFields.filter(
    (o: any) => !NON_MODEL_ARGS.includes(o.name)
  );
  console.log(typeName, inf);

  // setup for UI
  inf.on = false;
  inf.value = "";
  inf.inputFields.map((o: any) => {
    o.on = false;
    o.value = "";
  });
  // TODO add type for HTML input element based on inf.inputFields.type

  // Add filter option
  const existingIndex = filters.value.findIndex(
    (f: any) => f.name === inf.name
  );
  if (existingIndex !== -1) {
    // Replace all key:values if in the filters.value object array
    Object.assign(filters.value[existingIndex], inf);
  } else {
    filters.value.push(inf);
  }

  // Recursively build filters object
  // get filters for nested input objects
  for (const o of inf.inputFields) {
    if (o.type.kind === "INPUT_OBJECT") {
      await getFilters(o.type.name);
    }
  }
}
// BUILD FILTERS

// Generic lookup to find a filter object, its parent field, and human-readable name
function getFilterMatch(typeName: string) {
  const filterObj = filters.value.find((f) => f.name === typeName) || null;

  let parentField = null;
  for (const filter of filters.value) {
    if (filter.inputFields) {
      const foundField = filter.inputFields.find(
        (field: any) => field.type?.name === typeName
      );
      if (foundField) {
        parentField = foundField;
        break;
      }
    }
  }

  return {
    filterObj,
    parentField,
    name: parentField
      ? parentField.name
      : typeName === tool_root.value
        ? "Root"
        : typeName,
  };
}

// Toggle filter and auto-expand its first nested field
function enableFilter(inputField: any) {
  inputField.on = true;

  if (inputField.type?.name) {
    const { filterObj } = getFilterMatch(inputField.type.name);

    if (filterObj) {
      filterObj.on = true;

      // Target the first nested inputField inside the proper filter object
      if (
        filterObj.inputFields &&
        filterObj.inputFields.length > 0 &&
        !filterObj.inputFields[0].on
      ) {
        // Recursively unroll the first option to prevent empty states
        enableFilter(filterObj.inputFields[0]);
      }
    }
  }
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

    // End of active branch
    if (activeFields.length === 0) {
      if (currentPath.length > 0) paths.push(currentPath);
      return;
    }

    // Branch out for each active field
    for (const field of activeFields) {
      // Determine if it is a Scalar/End-node leaf
      const isLeaf =
        field.type?.kind === "SCALAR" ||
        ["String", "Boolean", "Int", "Float", "Decimal", "ID"].includes(
          field.type?.name
        );

      const levelNode = {
        selected: field,
        options: currentObj.inputFields,
        isLeaf: isLeaf,
      };

      const newPath = [...currentPath, levelNode];

      if (isLeaf) {
        paths.push(newPath); // Completed row ending in leaf
      } else {
        const nextObj = filters.value.find(
          (f: any) => f.name === field.type?.name
        );
        if (nextObj) {
          traverse(nextObj, newPath); // Continue recursion
        } else {
          paths.push(newPath); // Failsafe stop
        }
      }
    }
  }

  // Start from the active fields on the root filter
  traverse(rootObj, []);
  return paths;
});

// Used when a path's specific dropdown option is changed to another
function changeNode(level: any, event: Event) {
  const target = event.target as HTMLSelectElement;
  if (!target) return;

  const newOptionName = target.value;
  if (level.selected.name === newOptionName) return;

  // Turn off old option
  level.selected.on = false;

  // Turn on new option and cascade it open
  const newOption = level.options.find((o: any) => o.name === newOptionName);
  if (newOption) {
    enableFilter(newOption);
  }
}

// Rolls up the path turning off the nested components recursively backwards
function deletePath(path: any[]) {
  for (let i = path.length - 1; i >= 0; i--) {
    const level = path[i];
    level.selected.on = false;

    // Check if there are siblings acting on the same level still
    // If yes, we must stop deletion cascade to preserve the siblings
    const siblingsActive = level.options.some((opt: any) => opt.on);
    if (siblingsActive) break;
  }
}
</script>

<template>
  <div id="content" class="col">
    <div class="mx-auto" style="max-width: 1400px">
      <select v-model="f_selected">
        <option
          v-for="f in filters.find((o) => o.name === tool_root)?.inputFields ||
          []"
          :key="f.name"
          :value="f"
        >
          {{ f.name }}
        </option>
      </select>
      <button @click="enableFilter(f_selected)">Add</button>
      <hr />
      <!-- Render dynamic linear paths as dropdown sequences -->
      <div
        v-for="(path, pIdx) in activeFilterPaths"
        :key="'path-' + pIdx"
        style="
          display: flex;
          gap: 8px;
          align-items: center;
          margin-bottom: 8px;
        "
      >
        <span
          v-for="(level, lIdx) in path"
          :key="'level-' + lIdx"
          style="display: flex; gap: 8px; align-items: center"
        >
          <!-- Show options available at this depth level  -->
          <select
            :value="level.selected.name"
            @change="changeNode(level, $event)"
          >
            <option
              v-for="opt in level.options"
              :key="opt.name"
              :value="opt.name"
            >
              {{ opt.name }}
            </option>
          </select>

          <!-- Conditionally drop the input box if we hit the data-type end -->
          <input
            v-if="level.isLeaf"
            type="text"
            v-model="level.selected.value"
            placeholder="Type value..."
          />
        </span>

        <button @click="deletePath(path)">Del</button>
      </div>
      <hr />
      <pre>
        {{ filters }}
       </pre
      >
    </div>
  </div>
</template>
