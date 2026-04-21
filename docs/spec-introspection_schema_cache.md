# Introspection Schema Cache

## Overview

Separate from — but complementary to — [`docs/spec-cross_page_introspection_query_state.md`](/Users/riordenweber/projects/compare.vue/docs/spec-cross_page_introspection_query_state.md), which covers cross-page **filter state** sharing.

This spec covers the other half: sharing the **raw, cleaned introspected type definitions** (the data that ends up in `filters.value[]` / `sorts.value[]` / `columns.value[]`) across pages and across refreshes.

Two concrete wins:

1. **Refresh survives.** Apollo's `InMemoryCache` is in-memory; a hard refresh re-introspects every type. A persisted schema cache means the introspection tree is ready before the first network call.
2. **Page-to-page sharing.** When `tools` introspects `BrandFilter` and `toolMetrics` later needs the same type (either directly or via FK traversal through `tool.brand.*`), we read it from the shared dictionary instead of asking Apollo (whose cache dedupes network fetches but does **not** dedupe the strip/filter/decorate work our `fetchType()` does on each call).

Scope: filters, sorts, AND columns. Unlike the cross-page state spec which scoped down to filters only, the schema cache is easy to do in one go because it's keyed purely on type shape — no UI semantics involved.

---

## Non-goals

- Sharing per-page UI state (`on`, `value`, drag order). That's the other spec.
- Server-side caching or CDN.
- Detecting schema changes across deploys. We rely on the server's introspection being correct; stale cache handling is addressed only at a basic level (see Open questions).
- Cross-session / cross-device / cross-tab sharing. LocalStorage-per-origin is sufficient.
- Shape-based content dedup (the "Case B" mitigation). Called out here but implemented only if Case A proves insufficient.

---

## Glossary

- **Pristine type entry**: the cleaned introspected type object — `stripTypename` applied, envelope fields dropped — but WITHOUT any UI decoration (`on`, `value`, `displayField`, etc.). Safe to share across pages.
- **Decorated type entry**: a per-component clone of a pristine entry, with UI fields added. Lives only in the component's `filters.value[]` / `sorts.value[]` / `columns.value[]`.
- **Schema cache**: the Pinia-backed dictionary of pristine type entries, keyed by GraphQL type name and persisted to localStorage.
- **Case A** vs **Case B**: see Architecture below.

---

## Architecture

### Two-layer model

```
                +------------------------------------+
                |  Schema Cache (Pinia, persisted)   |
                |  - pristine INPUT_OBJECT entries   |
                |  - pristine OBJECT entries         |
                |  - per-ROOT boot metadata          |
                +------------------+-----------------+
                                   |  deep clone + decorate on read
                                   v
                +------------------------------------+
                |  Component-local stores (per mount)|
                |  - filters.value[] (decorated)     |
                |  - sorts.value[]   (decorated)     |
                |  - columns.value[] (decorated)     |
                +------------------------------------+
```

Pristine entries are shape-only. Decorated entries add `on` / `value` / `displayField` / `resolvedTypeName` / `resolvedTypeKind` / `isConnection` / `nodeType` etc.

Decoration is cheap and pure; doing it per-mount keeps cross-page state isolation simple (no "did we forget to reset this flag" bugs).

### Store shape (Pinia)

```ts
// src/stores/schemaCache.ts
type PristineInputType = {
  name: string;
  kind: "INPUT_OBJECT";
  inputFields: Array<{ name: string; type: any }>;
};

type PristineObjectType = {
  name: string;
  kind: "OBJECT";
  fields: Array<{ name: string; type: any; args?: any[] }>;
};

type RootMeta = {
  filterRoot: string;      // e.g. "ToolFilter"
  sortRoot: string;        // e.g. "ToolOrder"
  sortVarType: string;     // e.g. "[ToolOrder!]"
  columnRoot: string;      // e.g. "ToolNode"
};

export const useSchemaCacheStore = defineStore("schemaCache", {
  state: () => ({
    inputObjectTypes: {} as Record<string, PristineInputType>,
    objectTypes:      {} as Record<string, PristineObjectType>,
    roots:            {} as Record<string, RootMeta>, // keyed by ROOT, e.g. "tools"
  }),
  actions: {
    upsertInputType(t: PristineInputType)  { this.inputObjectTypes[t.name] = t; },
    upsertObjectType(t: PristineObjectType) { this.objectTypes[t.name]      = t; },
    setRootMeta(root: string, m: RootMeta)  { this.roots[root]              = m; },
    clear() {
      this.inputObjectTypes = {};
      this.objectTypes      = {};
      this.roots            = {};
    },
  },
  persist: true, // localStorage via pinia-plugin-persistedstate
});
```

### Read flow (cache → page)

On mount, before calling `initFiltersFrom` / `initSortsFrom` / `initColumnsFrom`:

1. Look up `schemaCache.roots[ROOT]`. If absent → fall through to introspection (current code path).
2. If present:
   - Set `filter_root.value`, `sort_root.value`, `sort_var_type.value`, `column_root.value` from the cached `RootMeta`.
   - Walk the type graphs starting from the cached roots, **cloning and decorating** each reachable pristine entry into `filters.value[]` / `sorts.value[]` / `columns.value[]`.
   - Skip every network call. Call `get()` once at the end (same contract as the existing watcher).

Cloning uses `structuredClone` (or a JSON round-trip fallback) to guarantee decorations on the local copy can't mutate the pristine cache entry.

### Write flow (introspection → cache)

Tweak `fetchType()` so that after the `stripTypename` + envelope-filter pass produces a cleaned type:

1. Upsert it into the schema cache (`upsertInputType` or `upsertObjectType` depending on `fieldsKey`).
2. Continue returning it to the caller so local decoration proceeds as today.

Also: at the end of the root `watch(q_r)` boot sequence, once `filter_root` / `sort_root` / `sort_var_type` / `column_root` are known, call `setRootMeta(ROOT, {...})`. Next mount of any page with the same ROOT skips all introspection.

### Per-page isolation

- Deep clone on read → local mutations can't reach the cache.
- Cache never holds UI state → no cross-page UI leakage.
- Cache entries are additive only in the normal flow; `clear()` is a manual lever (devtools button, later).

### Case A vs Case B: the "will my inputFields match across pages" question

This is the crux of whether name-keying is sufficient. It depends on the GraphQL schema generator.

**Case A — shared leaf/mid types by name (the happy path).**
Both `tools.brand` and `toolMetrics.tool.brand` resolve to a field typed `BrandFilter` — one type, reused everywhere. Likewise `StringFilter`, `IntFilter`, etc. Name-keyed cache works perfectly: one entry per real type.

**Case B — per-entity type names (the explosion path).**
Generator emits `ToolBrandFilter` and `ToolMetricBrandFilter` with identical shapes but different names. Name-keyed cache stores both. Apollo does the same thing at the network layer, so we're no worse off than today — just not benefiting from the "same filter appears on two pages" insight.

**How to tell which you're in**, practically: after the Tools page has loaded, open Apollo DevTools → Cache. Look for entries that end in `Filter`. If you see one `BrandFilter`, you're Case A. If you see `ToolBrandFilter` AND `ToolMetricBrandFilter` side by side, you're Case B.

**Implementation decision**: assume Case A. Name-keyed cache. Simple and correct if the schema is consistent.

**Case B mitigation path (deferred)**: shape-based content addressing.

1. Compute a stable hash from the type's `inputFields` / `fields` (names + nested type names, sorted).
2. Store pristine entries by hash.
3. Maintain a `typeName → hash` lookup alongside.
4. Two distinct names pointing at the same shape resolve to one entry.

Trade-offs if we ever need this:

- Saves storage (probably not much — type entries are small JSON).
- Does NOT save network fetches. We must still fetch each unique name at least once to see its shape; we can only dedupe after we've seen it.
- Adds real complexity (hashing, double lookup, invalidation). Only worth it if storage or clone cost becomes a measurable problem.

Do not implement shape-keying until we actually observe bloat.

---

## Implementation phases

### Phase 0 — Schema audit

Before writing any code, load the app, hit both Tools and ToolMetrics, and inspect Apollo cache entries for filter types. Document whether we're in Case A or Case B. This gates the rest of the work only insofar as it sets expectations — the name-keyed implementation is correct either way; it just delivers more value in Case A.

### Phase 1 — Pinia store

1. Create `src/stores/schemaCache.ts` with the state/actions sketched above.
2. Enable `persist: true`. Confirm entries survive refresh via Vue devtools.
3. No wiring yet — verify the store is readable/writable in isolation.

### Phase 2 — Write side: upsert from fetchType

1. In `Home3.vue` (and the ToolMetrics copy), modify `fetchType()` to call `schemaCache.upsertInputType(...)` / `upsertObjectType(...)` after cleaning but before returning.
2. In the `watch(q_r)` boot sequence, once all three roots are known, call `schemaCache.setRootMeta(ROOT, ...)`.
3. Load the app, confirm the store fills up. No behaviour change should be visible yet.

### Phase 3 — Read side: skip introspection on cache hit

1. Add a helper `hydrateFromCache(ROOT): boolean` that:
   - Reads `schemaCache.roots[ROOT]`.
   - If absent, returns `false`.
   - If present: sets `filter_root` / `sort_root` / `sort_var_type` / `column_root`, walks the cached type graphs starting from each root, deep-clones + decorates into local `filters.value[]` / `sorts.value[]` / `columns.value[]`, returns `true`.
2. In `watch(q_r)`, before calling `initFiltersFrom` / `initSortsFrom` / `initColumnsFrom`:
   - If `hydrateFromCache(ROOT)` → call `get()` and return.
   - Else → fall through to introspection as today.
3. Verify: refresh the Tools page with cache warm → no network calls for introspection. Navigate to ToolMetrics → no network calls for any type already cached (Case A) or only for the ToolMetrics-exclusive types (Case B).

### Phase 4 — Decoration helpers

Extract the "decorate a pristine entry" logic from the existing `introspect()` / `introspectColumns()` bodies into small functions:

- `decorateInputType(pristine): DecoratedInputType` — adds `on`, `value`, per-field `on`/`value`.
- `decorateObjectType(pristine): DecoratedObjectType` — adds `resolvedTypeName`, `resolvedTypeKind`, `isConnection`, `nodeType`, `displayField`, `on`.

Both should be pure (return a new object, don't mutate input). `fetchType()` continues to upsert the pristine form; `introspect()` and `introspectColumns()` call the decorators on their way to the local store. `hydrateFromCache` also uses the same decorators.

This keeps the "what does a decorated field look like" definition in one place, which will matter if we ever extend the decoration (Open question 3).

### Phase 5 — Column connection resolution

`introspectColumns()` today calls `resolveConnectionNodeType()` — which itself issues two sequential `client.query` calls per connection field. That wiring already goes through `fetchType()` only for the outer loop; the nested `resolveConnectionNodeType` uses `client.query` directly.

For the schema cache to fully eliminate fetches on a warm cache, `resolveConnectionNodeType` needs to check the cache first before firing. Two options:

- **A**: keep `resolveConnectionNodeType` as-is; on cache hit, `hydrateFromCache` already has every reachable connection's node name resolved on pristine OBJECT entries, so this path only matters on cache miss.
- **B**: route `resolveConnectionNodeType`'s two queries through `fetchType()` / the cache too. Slightly more code; guarantees the connection walk also benefits on partial cache hits (one page warms, another navigates).

Recommendation: **B**, for consistency. Small change, big win on partial hits.

### Phase 6 — Acceptance tests (manual)

1. **Cold load**: clear localStorage, load Tools. Introspection queries fire. Schema cache fills up. Everything works.
2. **Warm refresh**: refresh Tools. No introspection queries in network tab (only the data query). Filters/sorts/columns appear from cache.
3. **Cross-page warm**: after warming Tools, navigate to ToolMetrics. In Case A: no new introspection queries for shared types (BrandFilter, StringFilter, etc.); only ToolMetrics-specific types fetch. In Case B: ToolMetrics-specific names all fetch.
4. **Cross-page clone isolation**: on Tools, enable `brand.name.icontains = "dewalt"`. Navigate to ToolMetrics. ToolMetrics' `filters.value[]` entry for `BrandFilter` (if it's Case A) shows `on = false` / `value = ""` everywhere — the decoration on Tools' clone did not leak.
5. **Cache interaction with cross-page state spec**: combined with the existing filter-state store, refreshing Tools with `category = "Cordless Drill"` active restores both the filter tree (from schema cache) AND the active filter value (from query-state store).
6. **Manual invalidation**: clear the schema cache in devtools. Next page action re-introspects.

---

## Open questions

1. **Clone cost.** `structuredClone` is fast but for deeply nested filter graphs with hundreds of types, the per-mount clone of the reachable subtree might be measurable. Profile before optimizing.
2. **Schema version drift.** If the server deploys a new schema between visits, the cached types are stale. Options: (a) include a schema version (`__schema.description` or a custom tag) and invalidate on change; (b) leave it and accept that stale cache = confused UI until user clears localStorage. For now: (b). Revisit if it bites.
3. **Cache size.** Realistic cap in localStorage is ~5–10MB per origin. Even 500 typical filter types is ~250KB. Not a near-term concern; no eviction policy yet.
4. **Interaction with the cross-page state reconciliation watcher.** The `watch(() => filters.value.length, ...)` one-shot reconciler in `Home3.vue` fires on filter-tree readiness. With cache hydration, `filters.value.length` becomes non-zero earlier (synchronously, potentially). Needs a smoke test that reconciliation still fires exactly once per mount.
5. **Pruning logic.** If we ever add LRU, track last-accessed-at per entry and drop the oldest when total size exceeds a threshold. Not in this spec.
6. **Shape-based content addressing.** See Case B in Architecture. Deferred until storage bloat actually shows up.

---

## Files touched (estimate)

- `src/stores/schemaCache.ts` — new
- `src/components/Home3.vue` — wire `fetchType` writes, add `hydrateFromCache` read, extract decorators
- `src/components/Home3ToolMetrics.vue` — mirror changes (or: extract shared logic to a composable now, if we're tired of parallel edits — consider doing this concurrently since this is the third time the same changes hit both files)
- `package.json` / `src/main.ts` — already have Pinia + persistedstate from the cross-page state spec; no new deps

---

## Success criteria

- Phase 6 test cases 1, 2, 3, 4, 5 all pass.
- Network tab confirms a warm refresh fires **no** `__type(...)` introspection queries.
- Filters, sorts, and columns on both pages look identical to the pre-cache behaviour (no regressions in UI state).
- In Case A: navigating Tools ↔ ToolMetrics issues introspection only for types unique to the destination. In Case B: accept the extra fetches and revisit shape-keying only if bloat is measurable.

---

## Relationship to other specs

- [`docs/spec-cross_page_introspection_query_state.md`](/Users/riordenweber/projects/compare.vue/docs/spec-cross_page_introspection_query_state.md) — sharing user-set **filter state** across pages. Uses a different Pinia store (`queryState`), different shape, different semantics. The two specs are orthogonal but composable: the schema cache decides *what filters exist on this page*; the query-state store decides *which of them are turned on and what value they carry*. Both feed `get()`.
