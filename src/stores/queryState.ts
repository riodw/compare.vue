/**
 * Cross-page introspection query state — shared filter state across pages.
 *
 * See docs/spec-cross_page_introspection_query_state.md.
 *
 * Holds user-set filters in a page-agnostic canonical form ({ path, value })
 * so a filter set on one ROOT (e.g. "tools") auto-applies to another ROOT
 * (e.g. "toolMetrics") wherever the field-name path matches (direct or suffix).
 *
 * Persisted to localStorage via pinia-plugin-persistedstate.
 */
import { defineStore } from "pinia";

/**
 * Canonical filter: a field-name path from the root filter type down to the
 * leaf operator, plus the leaf value. Type names never appear here; only
 * field names, because field names are stable across ROOTs when the schema
 * comes from the same generator.
 */
export type CanonicalFilter = {
  path: string[]; // e.g. ["category", "eq"]
  value: any; // e.g. "Cordless Drill" or true
};

/** Do two paths have the exact same segments in the same order? */
function samePath(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const useQueryStateStore = defineStore("queryState", {
  state: () => ({
    filters: [] as CanonicalFilter[],
  }),
  actions: {
    /** Upsert a filter by path (same path replaces; new path appends). */
    setFilter(f: CanonicalFilter) {
      const idx = this.filters.findIndex((x) => samePath(x.path, f.path));
      if (idx === -1) this.filters.push({ path: [...f.path], value: f.value });
      else this.filters[idx] = { path: [...f.path], value: f.value };
    },
    /** Remove a filter matching the given path, if present. */
    removeFilter(path: string[]) {
      this.filters = this.filters.filter((x) => !samePath(x.path, path));
    },
    /** Drop all stored filters. */
    clearFilters() {
      this.filters = [];
    },
  },
  persist: true, // localStorage, default key "queryState"
});
