### Compile and Hot-Reload for Development

```sh
pnpm dev
```

## Project Setup

```sh
pnpm install
```

### Type-Check, Compile and Minify for Production

```sh
pnpm build
```

## Formatting:

```sh
pnpm format
pnpm exec prettier --write .
```

### Lint with [ESLint](https://eslint.org/)

```sh
pnpm lint
```

## Testing: clearing the cache

The app keeps two layers of state outside of Apollo's in-memory cache:

- **`schemaCache`** (localStorage) — pristine introspection results so warm mounts skip network introspection.
- **`queryState`** (localStorage) — user-set filters that persist across pages + refresh.

Chrome's refresh variants do NOT clear localStorage, so for a true cold boot you have to clear it explicitly.

### From the refresh button menu

- **Normal Reload** — uses everything cached (HTTP, localStorage, Apollo in-memory).
- **Hard Reload** — revalidates HTTP cache but keeps localStorage and Apollo in-memory cache.
- **Empty Cache and Hard Reload** — same as Hard Reload but also drops HTTP cache. localStorage still intact.

### Clearing localStorage (schema / query state)

Quickest per-key from DevTools → Application → Local Storage → your origin: right-click `schemaCache` or `queryState` → Delete → reload.

Or from the console:

```js
// Clear just the schema cache
localStorage.removeItem("schemaCache");
location.reload();

// Clear just the user's filter state
localStorage.removeItem("queryState");
location.reload();

// Clear both at once
localStorage.removeItem("schemaCache");
localStorage.removeItem("queryState");
location.reload();

// Nuke everything for this origin (incl. unrelated keys)
localStorage.clear();
location.reload();
```

### Full reset (closest to a first-time visit)

DevTools → Application → Storage → **Clear site data**.
Clears HTTP cache + localStorage + cookies + Apollo in-memory cache in one click. Reload.

### What to use when

- **Verify warm schema cache works** — Normal Reload. Expect no `__type(...)` introspection queries in the Network tab; filters/sorts/columns appear instantly from localStorage.
- **Verify cold introspection still works** — Clear site data (or `removeItem("schemaCache")`) then reload. Expect introspection queries to fire and the cache to refill.
- **Test cross-page filter state persistence** — Normal Reload with `queryState` intact. Clear just `queryState` to test the empty case.
- **Isolated clean session** — open the app in an Incognito / Private window. Fresh localStorage, torn down on window close.
