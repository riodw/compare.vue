# Home3.vue — Explain Like I'm 5

This is the short, friendly version of [`docs/Home.md`](/Users/riordenweber/projects/compare.vue/docs/Home.md). It walks through what the page does, from the moment you open it to the moment you click around.

The real function names are kept in the **Glossary** at the bottom. In the story below they use nicknames so you can focus on *what* is happening and not on *what it is called*.

---

## The Big Picture

```
                     ┌──────────────────────────────┐
                     │       Page opens 🎬          │
                     └──────────────┬───────────────┘
                                    │
                                    ▼
                ┌──────────────────────────────────────┐
                │   Ask server: "what's in the menu?"  │
                │            (AskTheSchema)            │
                └──────────────────┬───────────────────┘
                                   │
                                   ▼
                ┌──────────────────────────────────────┐
                │   Server replies with all the types  │
                │             (WhenMenuArrives)        │
                └──────────────────┬───────────────────┘
                                   │
              ┌────────────────────┼─────────────────────┐
              │                    │                     │
              ▼                    ▼                     ▼
   ┌────────────────┐   ┌────────────────┐   ┌──────────────────┐
   │  LearnFilters  │   │   LearnSorts   │   │   LearnColumns   │
   │ (background 🏃) │   │ (background 🏃) │   │ (we wait ⏳ here)│
   └────────┬───────┘   └────────┬───────┘   └─────────┬────────┘
            │                    │                     │
            ▼                    ▼                     ▼
    filter menu               sort menu         table columns ready
            │                    │                     │
            └────────────────────┼─────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │         RebuildAndFetch 🔨           │
              │ "turn the UI into a real query and   │
              │  send it to the server"              │
              └──────────────────┬───────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │   First rows show up in the table    │
              └──────────────────┬───────────────────┘
                                 │
            ─────────── now the user can play ───────────
                                 │
     ┌───────────────┬───────────┼──────────────┬────────────────┐
     ▼               ▼           ▼              ▼                ▼
  Search box    Add/remove    Add/remove    Drag rows to     Click a
  typing        a filter      a sort/col    reorder sorts    page number
                                            or columns
     │               │           │              │                │
     └───────────────┴───────────┼──────────────┘                │
                                 ▼                               │
                         RebuildAndFetch 🔨                      │
                                                                 ▼
                                                         JumpToPage 🏁
                                                       (patches offset,
                                                        no rebuild)
```

---

## Scene 1 — The Page Wakes Up

When the page loads it doesn't know anything. It doesn't know what "tools" look like, what you can filter by, what you can sort by, or what columns exist.

So the first thing it does is **AskTheSchema**. That is basically: "Hey GraphQL, tell me everything you know about the `tools` query."

While it waits, the screen shows nothing yet.

---

## Scene 2 — Reading The Menu

When the answer arrives, the page runs **WhenMenuArrives** one time. It looks at the reply and says three things:

1. "I see there's a `filter` thing — let's **LearnFilters**."
2. "I see there's an `orderBy` thing — let's **LearnSorts**."
3. "I see there's a return shape — let's **LearnColumns**."

`LearnFilters` and `LearnSorts` run in the background. The page does **not** wait for them. They keep chewing on the menu while the rest of the page keeps going.

`LearnColumns` is awaited, because we can't build a table without knowing the columns.

---

## Scene 3 — Learning The Menus

### LearnFilters / LearnSorts

Both of these use the same helper called **DigIntoTree**. It takes a type name and recursively asks the server about it, then about its children, then about *their* children, and so on.

Each time it finds a new type, it puts it into a flat list (filters go in one box, sorts go in another). Those lists become the "add filter" and "add sort" menus.

### LearnColumns

Columns are a little different because `tools` actually returns a Relay connection, which is like a box with a label saying "the real thing is inside". So the page calls **FindRealRowType** which opens:

```
Connection  →  Edge  →  Node  (← that's the real thing)
```

Then it recursively walks the real row type with **DigIntoColumns**. For every field it figures out:

- is this a plain value? (scalar)
- is this a link to another row? (FK)
- is this a list of other rows? (connection)

Once it knows all the columns, the page turns on every "plain value" column by default and picks a default display field for every FK column.

Finally it calls **RebuildAndFetch**.

---

## Scene 4 — Building And Sending The Query

**RebuildAndFetch** is the beating heart of the page. It runs every time anything important changes.

Here is what it does, step by step:

1. **Go back to page 1.** Any rebuild means we start from the top again.
2. **Ask the columns what they want.** Scalars go straight in. FKs ask for one sub-field. Connections ask for `edges.node.(all scalars)`.
3. **Walk the filter tree.** For each active filter branch, **NestAlongPath** turns a branch like `brand → name → icontains = "dewalt"` into a little nested object.
4. **Walk the sort tree.** Same helper, but each sort becomes its own entry in a list so the order of the list becomes the sort priority.
5. **Add the search word** if you typed one.
6. **Always add `first` and `offset`**, even on page 1, so that **JumpToPage** can change only the offset later.
7. **Compile** the whole thing into a real GraphQL document and hand it to Apollo.

Apollo notices the change and fetches.

---

## Scene 5 — You Start Playing

Now the page is alive. Most of the things you do follow the same recipe: *change some state, then call RebuildAndFetch*.

### Typing in the search box

Every keystroke lowercases what you typed and calls RebuildAndFetch. Fast feedback.

### Adding a filter

You click "Add Filter", the menu opens, **FocusMenuInput** puts the cursor in the search box. You pick something. **TurnOnField** cascades down, opening the first child, then the first grandchild, until it hits a leaf.

Leaves stay empty until you type in them. Text/number filters only send on **Enter** (no spamming the server). Boolean filters send on change.

### Changing a filter's branch

If you swap out one sibling for another in a dropdown, **SwapBranch** turns off the old one and turns on the new one.

### Removing a filter

**DeleteBranch** walks backwards from the leaf turning things off, but stops the moment it sees another active sibling so it doesn't nuke anything that's still in use.

### Adding a sort

Same idea as a filter, but the leaf is **ASC** by default, so sorts take effect right away.

### Reordering sorts or columns

Rows are draggable. The drag handlers come from **MakeDragHandler**, which is reused for both sorts and columns. When you drop, it rewrites the order array and calls RebuildAndFetch.

### Adding or removing a column

**TurnOnColumn** / **TurnOffColumn**. Both rebuild and fetch.

Forward-relation columns also let you pick which sub-field to show. Changing that also rebuilds and fetches.

### Clicking a page number

This one is special. It does **not** go through RebuildAndFetch, because that would reset you back to page 1. Instead **JumpToPage** just patches the `offset` variable in place. Apollo sees the change and fetches. That's why the rebuild always includes both `first` and `offset` — so `$offset` exists in the document for JumpToPage to use.

### Changing the page size

Coerce to a positive integer (minimum 1), then RebuildAndFetch. This takes you back to page 1 on purpose.

---

## Scene 6 — Showing The Table

While the query is in flight, the table shows **Loading…**.

If the query errors, the table shows the error.

If there are rows, the page:

- builds the header from the active columns (with `> displayField` next to FK columns)
- renders each row, using **ShowCell** for scalar and FK cells, and **ShowManyCells** for connection cells (one line per edge)

If there are zero rows, it shows **No Results**.

Below the table, the footer shows "Showing X–Y of Z", a pagination button row, and a page size input.

---

## Scene 7 — The Card Can Collapse

If you click the little collapse button, the whole filter/sort/column card folds up into a tiny summary that just shows the three counts. Click again to expand.

---

## The Whole Life In One Paragraph

The page asks the server what it can do. It uses the answer to build a filter menu, a sort menu, and a column list. It turns on sensible defaults. It builds a query from those defaults and fetches. From then on, every click or keystroke either changes a little piece of state and calls "rebuild and send it again", or (for pagination) just tweaks the offset in place.

---

## Appendix — Glossary Of Nicknames

The left column is the friendly name used in this doc. The right column is the real symbol in [`src/components/Home3.vue`](/Users/riordenweber/projects/compare.vue/src/components/Home3.vue:1).

### Boot / Introspection

- **AskTheSchema** → the `useQuery(gql(jtg(fields_query)))` call against `__type(name: "Query")`
- **WhenMenuArrives** → `watch(q_r, (value) => { ... })`
- **LearnFilters** → `initFiltersFrom(args)`
- **LearnSorts** → `initSortsFrom(args)`
- **LearnColumns** → `initColumnsFrom(rootField)`
- **DigIntoTree** → `introspect(typeName, mode)` (shared by filters and sorts)
- **DigIntoColumns** → `introspectColumns(typeName, visited)`
- **FindRealRowType** → `resolveConnectionNodeType(connectionTypeName)`
- **PeelTypeWrappers** → `unwrapType(t)` (handles `NON_NULL` / `LIST`)
- **CleanApolloJunk** → `stripTypename(obj)`
- **BuildTypeQuery** → `makeTypeQuery(selection)`

### Path / Tree UI

- **TurnOnField** → `enable(inputField, mode)`
- **SwapBranch** → `changeNode(level, event, mode)`
- **AddSibling** → `addNext(level, mode)`
- **DeleteBranch** → `deletePath(path)`
- **FindActiveBranches** → `activePaths(mode)` and its computed wrappers `activeFilterPaths` / `activeSortPaths`
- **BuildMergedGrid** → `filterGrid`
- **NestAlongPath** → `buildNestedFromPath(path, target?)`
- **TopOfMenu** → `topLevel(mode)`
- **SearchMenu** → `searchFieldsFn(mode)` + the shared `filterAvailable(items, searchStr)` helper
- **CamelToWords** → `camel(s)`
- **PickInputKind** → `inputTypeFor(fieldType)`

### Columns

- **TurnOnColumn** → `enableColumn(field)`
- **TurnOffColumn** → `disableColumn(field)`
- **ListAvailableColumns** → `availableColumns()`
- **GetFKSubFields** → `getSubFields(col)`
- **ActiveColumns** → `activeColumns`
- **OrderedColumns** → `orderedColumns`
- **ShowCell** → `cellText(col, row)`
- **ShowManyCells** → `cellConnectionLines(col, row)`

### Shared Ordering / Drag / UI Helpers

- **MakeDragHandler** → `makeDragReorder(orderRef, onChange?)` (used by both sort and column rows)
- **ReorderByList** → `applyOrder(items, order, keyFn)`
- **KeepOrderInSync** → `syncOrder(items, orderRef, keyFn)`
- **FocusMenuInput** → `focusDropdownInput(ev)`
- **SortIdentity** → `sortPathKey(path)`
- **ColumnIdentity** → `columnKey` (the `c => c.name` passed to `applyOrder` and `syncOrder`)

### Query Life

- **RebuildAndFetch** → `get()`
- **QuerySkeleton** → `q` (the mutable object passed through `jtg(...)`)
- **CompiledDoc / LiveVariables** → `queryDoc` and `queryVariables` refs
- **LiveData** → `useQuery(queryDoc, queryVariables)` and its `a_r`, `a_l`, `a_e` refs

### Pagination

- **PageOffset** → `paginationOffset`
- **CurrentPage** → `current_page` computed
- **JumpToPage** → `goToPage(n)` (patches `queryVariables.offset` in place, skips RebuildAndFetch on purpose)
- **PageSizeInput** → the inline handler on the "Per page" input in the template

### Mode Registry

- **ModeRegistry** → the `MODES = { filters: { store, root, search }, sorts: { store, root, search } }` lookup table used by the shared path UI functions
