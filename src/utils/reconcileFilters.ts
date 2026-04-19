/**
 * Reconciliation helpers for the Cross-Page Introspection Query State feature.
 * See docs/spec-cross_page_introspection_query_state.md.
 *
 * Two pure functions that bridge a stored CanonicalFilter path to a page's
 * local introspected filter tree:
 *
 *   findLocalPath      — given a target path (field-name sequence), find the
 *                        shortest root-to-leaf local path whose trailing
 *                        segments match the target. Handles FK traversal
 *                        (e.g. stored ["category","eq"] matches local
 *                        ["tool","category","eq"] on a nested-entity page).
 *
 *   activateLocalPath  — walk a local path setting .on = true on each field
 *                        and intermediate INPUT_OBJECT type, then assign the
 *                        leaf value. Does not cascade to first-child like
 *                        enable() — follows the exact path given.
 *
 * Both take the flat `filters` store array as a parameter (same shape as
 * Home3.vue's `filters.value`), so they're trivial to unit-test with mock data.
 */

/** Do the trailing `target.length` segments of `path` equal `target`? */
function endsWith(path: string[], target: string[]): boolean {
  if (target.length > path.length) return false;
  const offset = path.length - target.length;
  for (let i = 0; i < target.length; i++) {
    if (path[offset + i] !== target[i]) return false;
  }
  return true;
}

/**
 * Search the flat filter store (rooted at `rootTypeName`) for the shortest
 * root-to-leaf path whose suffix equals `targetPath`. Returns that full local
 * path (array of field names), or null if no match.
 *
 * Exact-match is just the special case where the local path === targetPath.
 */
export function findLocalPath(
  store: any[],
  rootTypeName: string,
  targetPath: string[],
): string[] | null {
  if (!rootTypeName || targetPath.length === 0) return null;

  const candidates: string[][] = [];
  const visited = new Set<string>();

  function walk(typeName: string, currentPath: string[]) {
    if (visited.has(typeName)) return;
    visited.add(typeName);
    const typeObj = store.find((t: any) => t?.name === typeName);
    if (!typeObj?.inputFields) return;

    for (const field of typeObj.inputFields) {
      const newPath = [...currentPath, field.name];
      if (endsWith(newPath, targetPath)) candidates.push(newPath);
      if (field.type?.kind === "INPUT_OBJECT" && field.type?.name) {
        walk(field.type.name, newPath);
      }
    }
  }

  walk(rootTypeName, []);
  if (candidates.length === 0) return null;

  // Shortest path wins — prefers direct over FK-nested matches.
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0] ?? null;
}

/**
 * Walk `localPath` from `rootTypeName`, setting `on = true` on each selected
 * field and on each intermediate INPUT_OBJECT type. At the leaf, assign
 * `leafValue` to the field's `.value`.
 *
 * No-op if any step in the path can't be resolved against the store.
 */
export function activateLocalPath(
  store: any[],
  rootTypeName: string,
  localPath: string[],
  leafValue: any,
): void {
  let currentTypeName: string | undefined = rootTypeName;
  for (let i = 0; i < localPath.length; i++) {
    if (!currentTypeName) return;
    const typeObj = store.find((t: any) => t?.name === currentTypeName);
    if (!typeObj?.inputFields) return;
    typeObj.on = true;
    const field = typeObj.inputFields.find(
      (f: any) => f?.name === localPath[i],
    );
    if (!field) return;
    field.on = true;
    if (i === localPath.length - 1) {
      field.value = leafValue;
    } else {
      currentTypeName = field.type?.name;
    }
  }
}
