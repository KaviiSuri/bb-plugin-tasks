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

## Relationship graph layout

The task relationship graph uses `react-force-graph-2d`, an HTML canvas renderer
backed by `d3-force` physics. Nodes remain draggable and the simulation combines
charge, link-distance, centering, and label-collision forces so task keys do not
collapse into a vertical stack. Full task cards appear on hover or keyboard
focus. Its default scope recursively follows every upstream blocker while
excluding unrelated downstream branches. The local graph does not drop nodes at
an arbitrary visual budget; the expanded Atlas keeps a 150-node safety limit.

BB's offline plugin builder emits one always-transferred frontend artifact. An
isolated production bundle measurement put React Force Graph at about 63 KB gzip,
far below the rejected ELK prototype's roughly 571 KB gzip addition.

## Install

Install the latest compatible tagged release. BB records the immutable tag and
commit, and `bb plugin update tasks-kv` advances within the selected range:

```sh
bb plugin install git:https://github.com/KaviiSuri/bb-plugin-tasks.git@^0.1.1
```

Use `@main` only when testing unreleased changes. The plugin id `tasks` is
reserved for the bundled plugin, so this installs alongside it as `tasks-kv`
with its own data directory. To take over from the builtin, migrate a verified
copy of its data and disable it:

```sh
cp -R ~/.bb/plugins/tasks/ ~/.bb/plugins/tasks-kv/
bb plugin disable tasks
```

## Releasing

Releases are immutable annotated `vX.Y.Z` tags. The release commit contains the
matching `package.json`, lockfile, generated SDK declarations, and BB build
metadata in `dist/`. CI runs the
graph tests, builds with the exact pinned `bb-app`, verifies artifact identity
and version, and audits production dependencies.

Run a local dry release without pushing:

```sh
npm run release -- patch
npm run release -- 1.2.0
```

Add `--push` to atomically push the release commit and tag:

```sh
npm run release -- minor --push
```

The preferred remote flow is the on-demand **Release** GitHub workflow. Choose
`patch`, `minor`, `major`, or an exact custom version. It validates the plugin,
builds versioned artifacts, atomically publishes `main` and the tag, then creates
a GitHub release with generated notes:

```sh
gh workflow run release.yml -f bump=patch
```

Never move or recreate a published tag. Cut a new patch release instead.

## Sync with upstream

```sh
scripts/sync-upstream.sh desktop-v0.37.0
git merge upstream-tasks
```

`upstream-tasks` is a vendor branch holding only pristine upstream source, so
merging gives a real 3-way merge — conflicts show up only in files your features
touch. After a BB upgrade, also bump the `@bb` registry tag in `components.json`
and re-run `shadcn add --overwrite` so the vendored components stay version-matched.
