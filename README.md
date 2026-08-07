# bb-plugin-tasks-kv

A customisable build of BB's Tasks plugin, built **outside** the BB monorepo.

Upstream source is vendored byte-for-byte and compiled against shadcn components
pulled from BB's own component registry. No monorepo checkout, no fork of `bb`.

Planned changes on top of upstream:

1. Optional "show subtasks" in the task list and board (upstream hardcodes
   `parentTaskId: null` in `upstream/views/list/data.ts` and filters client-side
   in `upstream/views/board/index.tsx`).
2. A board view of subtasks inside a task detail page (upstream renders a flat
   list in `upstream/views/detail/index.tsx`).

## Layout

| path | what it is |
|---|---|
| `upstream/` | pristine upstream plugin source — **only edit for your features** |
| `components/`, `lib/`, `hooks/` | shadcn components vendored from the `@bb` registry |
| `shims/shared-ui/` | generated: maps `@bb/shared-ui/*` onto the vendored components |
| `shims/plugin-sdk/` | build-time `defineRpcContract` for the app bundle (see the file) |
| `scripts/` | shim generator + upstream sync |
| `.upstream-ref` | which upstream revision `upstream/` came from |

### Why the shims

Upstream imports `@bb/shared-ui/*`, which only resolves inside the BB monorepo.
tsconfig `paths` can't redirect it here because upstream ships its own
`tsconfig.json` and esbuild honours the nearest one — so the redirect happens at
module-resolution level instead, via `file:` dependencies. That is what keeps
`upstream/` unmodified, which in turn is what makes upstream merges clean.

## Develop

```sh
npm install
npm run build          # regenerates the shim, then bb plugin build
bb plugin dev .        # hot-reload while iterating
```

## Install

The plugin id `tasks` is reserved for the bundled plugin, so this installs
alongside it as a separate plugin with **its own data directory**. To take over
from the builtin you must migrate data and disable it:

```sh
cp -R ~/.bb/plugins/tasks/ ~/.bb/plugins/tasks-kv/    # verify on a copy first
bb plugin install .
bb plugin disable tasks
```

## Sync with upstream

```sh
scripts/sync-upstream.sh desktop-v0.37.0
git merge upstream-tasks
```

`upstream-tasks` is a vendor branch holding only pristine upstream source, so
merging gives a real 3-way merge — conflicts show up only in files your features
touch. After a BB upgrade, also bump the `@bb` registry tag in `components.json`
and re-run `shadcn add --overwrite` so the vendored components stay version-matched.
