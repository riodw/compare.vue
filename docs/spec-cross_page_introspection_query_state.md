# Cross-Page Introspection Query State

## Overview

The `Home3.vue` component is a schema-driven data explorer. Filters, sorts, and columns are introspected from the GraphQL schema per ROOT (e.g. `tools`, `toolMetrics`). Today, if a user sets `category = "Cordless Drill"` on the Tools page and navigates to the ToolMetrics page, the filter is lost even though the same logical filter applies.

**Goal:** hold user-set filter state in a shared store so it **(a)** survives navigation between pages, **(b)** survives a full page refresh, and **(c)** auto-applies to every page whose introspected filter tree contains a compatible field path.

This spec covers **filters only** for the initial iteration. The architecture must not preclude adding sorts and columns later, but scope creep into those now is explicitly out.

---

## Non-goals (this iteration)

- Sorts and columns — architecture should accommodate but implementation is deferred.
- URL query-param mirroring.
- Compound logical operators (`and` / `or` / `not`).
- Operator synonym matching (we rely on the schema generator producing consistent operator names — confirmed: same schema across pages).
- Cross-session / cross-device / cross-tab persistence. Page refresh in the same tab is sufficient.
- Any kind of "preset" / "saved filter" UX — the store holds the single current set.

---

## Glossary

- **Canonical filter**: the storable, page-agnostic representation of one user-set filter. Field-name anchored, not type-name anchored.
- **Local filter tree**: a single page's introspected filter `INPUT_OBJECT` graph (currently `filters.value[]` in `Home3.vue`).
- **Reconciliation**: the process of taking stored canonical filters and activating the equivalent paths in a new page's local filter tree.

---

## Architecture

### Canonical filter shape

```ts
type CanonicalFilter = {
  path: string[]; // field names, root-to-leaf, e.g. ["category", "eq"]
  value: any; // leaf value, e.g. "Cordless Drill" or true
};
```

Design note: **only field names appear in the path** — no type names. The schema generator produces per-entity filter types with different names (`ToolCategoryFilter` vs `ToolMetricCategoryFilter`) but the field names (`category`, `eq`, `year`, `icontains`) are stable across pages. Field names are the reconciliation anchor.

### Reconciliation algorithm

Given a stored canonical filter with `path = [a, b, c]` and a target page's local filter tree rooted at `filter_root`:

1. **Exact prefix match**: does the local tree have a path starting at `filter_root` that exactly equals `[a, b, c]`? If yes, use it.
2. **Suffix match**: if no exact match, walk the local tree looking for any root-to-leaf path whose trailing segments equal `[a, b, c]`. Example: stored `["category", "eq"]` matches local `["tool", "category", "eq"]` on the ToolMetrics page (FK traversal). Of all matches, **pick the shortest**.
3. **No match**: silently drop this filter for this page. Keep it stored — it may apply on some other page.

The walker must NOT rely on `activePaths` (which only returns ALREADY-ACTIVE paths). It needs a separate function that walks the full flat store as a tree, descending through `INPUT_OBJECT` fields, tracking field-name paths.

### Reapplication

Once a local path is found for a stored filter, activate it:

- For each segment in the path, set `field.on = true` on the corresponding field in `filters.value[]`.
- Also set `on = true` on each intermediate `INPUT_OBJECT` type (mirroring what `enable()` does today).
- On the leaf, also set `field.value = storedFilter.value`.
- This differs from the existing `enable()` in that it follows a **specific** path instead of cascading to the first child.

### Store shape (Pinia)

Single flat list, not per-root. The canonical form makes per-root segregation unnecessary.

```ts
// src/stores/queryState.ts
export const useQueryStateStore = defineStore("queryState", {
  state: () => ({
    filters: [] as CanonicalFilter[],
  }),
  actions: {
    setFilter(f: CanonicalFilter) { /* upsert by path */ },
    removeFilter(path: string[]) { /* remove by path match */ },
    clearFilters() { this.filters = []; },
  },
  persist: true, // via pinia-plugin-persistedstate → localStorage
});
```

Placeholder names — bikeshed during implementation. Sorts and columns will eventually slot in alongside `filters` with parallel shapes.

### Write flow (page → store)

Triggered from the existing mutation points in `Home3.vue`:

- Filter leaf value change (boolean dropdown, text/number input commit) → derive canonical form from the path, `store.setFilter(canonical)`.
- Filter delete (`deletePath`) → `store.removeFilter(canonical.path)`.
- On branch swap (`changeNode`) → remove the old leaf path, add the new one.

The canonical path is derived by walking the active path and collecting `selected.name` at each level.

### Read flow (store → page)

Runs **after** the filter tree finishes introspecting on a page, and again **on every route change**. The trigger:

1. Await the filter tree finishing introspection.
2. Read `store.filters`.
3. For each stored filter, run reconciliation → if found, activate the local path with the stored value.
4. Call `get()` once after all reconciliations apply (don't trigger `get()` per filter; batch).

Because `initFiltersFrom` is currently fire-and-forget, this requires a small change: either make it awaitable, or add a one-shot watcher on `filters.value` that fires when the store first becomes non-empty. **Recommendation: one-shot watcher** — keeps the initial query fast; filters appear a tick after the table.

---

## Implementation phases

### Phase 0 — Install Pinia

1. `npm install pinia pinia-plugin-persistedstate`
2. In `src/main.ts`:
   - `import { createPinia } from "pinia"`
   - `import piniaPluginPersistedstate from "pinia-plugin-persistedstate"`
   - `const pinia = createPinia(); pinia.use(piniaPluginPersistedstate); app.use(pinia);`
3. Confirm `npm run dev` and `npm run build` still pass.

### Phase 1 — Query state store

1. Create `src/stores/queryState.ts` with the store sketched above.
2. Use `persist: true` (localStorage, default key).
3. Expose `setFilter`, `removeFilter`, `clearFilters`.
4. No UI yet; verify the store is readable/writable from a Vue devtools console or a throwaway button.

### Phase 2 — Reconciliation helpers (pure functions, testable)

Add to `Home3.vue` (or a small utility file if preferred) two helpers:

- `findLocalPath(store, rootTypeName, targetPath): string[] | null` — returns the shortest local field-name path whose suffix equals `targetPath`, or `null` if no match.
- `activateLocalPath(store, rootTypeName, localPath, leafValue): void` — walks the path, setting `on = true` on each segment's field AND the intermediate type objects, and `value` on the leaf.

Both are plain functions that take the `filters` store as a parameter — no Vue reactivity tricks, easy to unit-test by feeding them mock flat-store arrays.

### Phase 3 — Wire Home3.vue to the store

1. **Write path**: in `changeNode`, `deletePath`, and the leaf-value `@change` / `@keyup.enter` handlers, emit to `store.setFilter` / `store.removeFilter`. The canonical form is built by mapping the active path to `{ path, value }`.
2. **Read path**: after `initFiltersFrom` completes its introspection, call a new `reconcileFromStore()` that:
   - Reads `store.filters`
   - For each filter, runs `findLocalPath` → `activateLocalPath`
   - Calls `get()` once at the end if any filter was applied
3. Trigger reconciliation both on initial page load AND on route change (navigation from Tools → ToolMetrics).

### Phase 4 — Duplicate the page for ToolMetrics

1. Either:
   - **Option A (simplest for POC):** copy `Home3.vue` → `Home3ToolMetrics.vue`, change `const ROOT = "toolMetrics"`.
   - **Option B (cleaner, larger scope):** refactor `Home3.vue` to accept `root` as a prop; router passes it.
2. Add a route for each. Simple nav links at the top of the layout.
3. For this iteration, **Option A** is fine — we're testing the store, not the routing architecture.

### Phase 5 — Route-change reconciliation

Vue Router emits route changes. The target page's `watch(q_r)` boot runs on first mount; on subsequent navigations to a page already mounted, or on in-place view changes, we need to re-reconcile.

- If each page is a separate component that unmounts/remounts, the existing `watch(q_r)` firing on mount handles it — the cached Apollo introspection should make it fast. Just ensure `reconcileFromStore()` is called after introspect resolves.
- If the page persists (e.g. `keep-alive`), add a `useRoute()` watcher that calls `reconcileFromStore()` on change.

### Phase 6 — Acceptance tests (manual, this iteration)

1. **Basic set + navigate**: On `/tools`, set `category = "Cordless Drill"`. Navigate to `/tool-metrics`. Filter is active there, same value.
2. **Edit on one, see on other**: On `/tool-metrics`, change to `category = "Drill Press"`. Navigate back to `/tools`. Filter now shows `Drill Press`.
3. **Partial match**: On `/tools`, add a filter that exists only on Tools (e.g. `manufactureYear.eq = 2025`). Navigate to `/tool-metrics`. That filter is not visible. Navigate back — it's still there.
4. **Delete**: On `/tools`, delete the `category` filter. Navigate to `/tool-metrics`. Filter is gone there too.
5. **Refresh**: With `category = "Cordless Drill"` active, hard-refresh the browser. Filter re-appears from localStorage hydration.
6. **FK traversal** (if the schema has it): Tools `category.eq` ↔ ToolMetrics `tool.category.eq`. If schema has the nested path, suffix match should find it.

---

## Open questions

1. **Path-disambiguation policy on multiple suffix matches.** Spec says "shortest wins". Is there ever a case where two same-length matches are possible and the wrong one would be picked? Low risk in practice; revisit if it happens.
2. **Where do reconciliation helpers live?** Inline in `Home3.vue`, or extract to `src/utils/reconcileFilters.ts`? Probably extract for testability; decide during implementation.
3. **Operator normalization.** User confirmed same schema generator → operator names are stable. If we ever add a second backend, a synonym table may be needed.
4. **Introspection-tree sharing.** Independent optimization: both pages fetch the same leaf types (`StringFilter`, `IntFilter`, etc.). Apollo's cache-first policy already dedupes network fetches. Pinia-based sharing of the decorated flat store is a possible later win but out of scope here.
5. **Store-write race on initial load.** During reconciliation, activating paths may also fire `get()` write-backs. Suppress store writes while reconciling (e.g. an `isReconciling` flag) to avoid feedback loops.
6. **Should `clearFilters()` be exposed as a single-click UI action?** Not in this spec — future UX decision.

---

## Files touched (estimate)

- `package.json` — add `pinia`, `pinia-plugin-persistedstate`
- `src/main.ts` — mount Pinia
- `src/stores/queryState.ts` — new
- `src/utils/reconcileFilters.ts` — new (or inline in `Home3.vue` if preferred)
- `src/components/Home3.vue` — wire reads/writes; add `reconcileFromStore()`
- `src/components/Home3ToolMetrics.vue` — new (duplicate of Home3 with `ROOT = "toolMetrics"`)
- `src/router/index.ts` (or wherever routing lives) — add the second route

---

## Success criteria

Manual test cases 1–5 in Phase 6 all pass. Test 6 (FK traversal) passes if the schema exposes the nested path; otherwise graceful drop is acceptable for this iteration.

---

## Relationship to other specs

- [`docs/spec-introspection_schema_cache.md`](/Users/riordenweber/projects/compare.vue/docs/spec-introspection_schema_cache.md) — sharing the raw **introspected type definitions** (filter/sort/column trees themselves) across pages and across refresh. Uses a different Pinia store (`schemaCache`). That spec decides *what filters exist on this page*; this spec decides *which of them are turned on and what value they carry*. The two are orthogonal but composable — the combined effect is that refreshing a page restores both the menus and the active selections without any server fetches.
