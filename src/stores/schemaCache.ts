/**
 * Persistent shared introspection schema cache.
 *
 * See docs/spec-introspection_schema_cache.md.
 *
 * Holds the *pristine* (stripped of __typename + envelope fields, but NOT UI-decorated)
 * introspection results for filter/sort INPUT_OBJECT types and column OBJECT types,
 * keyed by GraphQL type name. Also caches the Relay Connection → Node type mapping
 * and per-ROOT boot metadata so a second mount (same page OR sibling page) can
 * rebuild its filter/sort/column trees without any introspection network calls.
 *
 * Persisted to localStorage via pinia-plugin-persistedstate.
 */
import { defineStore } from "pinia";

/** Pristine filter/sort INPUT_OBJECT — `inputFields` already had NON_MODEL_ARGS dropped. */
export type PristineInputType = {
  name: string;
  kind: string; // "INPUT_OBJECT"
  inputFields: any[];
};

/** Pristine column OBJECT — `fields` already had CONNECTION_FIELDS dropped. */
export type PristineObjectType = {
  name: string;
  kind: string; // "OBJECT"
  fields: any[];
};

/** Per-ROOT boot metadata — enough for a warm mount to skip introspection. */
export type RootMeta = {
  filterRoot: string; // e.g. "ToolFilter"
  sortRoot: string; // e.g. "ToolOrder"
  sortVarType: string; // e.g. "[ToolOrder!]"
  columnRoot: string; // e.g. "ToolNode"
};

export const useSchemaCacheStore = defineStore("schemaCache", {
  state: () => ({
    /** Filter + sort INPUT_OBJECT types, keyed by name. */
    inputObjectTypes: {} as Record<string, PristineInputType>,
    /** Column OBJECT types (node types only; connection/edge stepping stones live in connectionNodeMap). */
    objectTypes: {} as Record<string, PristineObjectType>,
    /**
     * Cached resolution for Relay connections:
     *   "ToolConnection" -> "ToolNode"
     * Lets resolveConnectionNodeType skip its two client.query calls on warm cache.
     */
    connectionNodeMap: {} as Record<string, string>,
    /** Per-ROOT entry-point metadata, keyed by the ROOT query field name (e.g. "tools"). */
    roots: {} as Record<string, RootMeta>,
  }),
  actions: {
    upsertInputType(t: PristineInputType) {
      this.inputObjectTypes[t.name] = t;
    },
    upsertObjectType(t: PristineObjectType) {
      this.objectTypes[t.name] = t;
    },
    setConnectionNode(connectionName: string, nodeName: string) {
      this.connectionNodeMap[connectionName] = nodeName;
    },
    setRootMeta(root: string, meta: RootMeta) {
      this.roots[root] = meta;
    },
    /** Manual reset — useful from devtools if the server schema changes. */
    clear() {
      this.inputObjectTypes = {};
      this.objectTypes = {};
      this.connectionNodeMap = {};
      this.roots = {};
    },
  },
  persist: true, // localStorage, default key "schemaCache"
});
