#!/usr/bin/env bash
# Pull a new revision of BB's tasks plugin onto the `upstream-tasks` vendor
# branch, then merge it into your working branch.
#
# The vendor branch holds nothing but pristine upstream source, so merging it
# gives you a real 3-way merge: conflicts appear only in files your features
# actually touch.
#
# Usage: scripts/sync-upstream.sh <ref>        e.g. desktop-v0.36.0
set -euo pipefail

REF="${1:?usage: sync-upstream.sh <upstream-ref>}"
REPO="https://github.com/ymichael/bb.git"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${BB_UPSTREAM_CACHE:-$ROOT/../.bb-upstream-cache}"

# Upstream moved tasks from official-plugins/ to plugins/ after v0.35.x, so try
# both rather than pinning to whichever layout was current when this was written.
CANDIDATES=("official-plugins/tasks" "plugins/tasks")

if [ ! -d "$CACHE/.git" ]; then
  git clone --filter=blob:none --sparse "$REPO" "$CACHE"
fi
git -C "$CACHE" fetch --depth 1 origin "$REF"
git -C "$CACHE" checkout -q FETCH_HEAD

SRC=""
for candidate in "${CANDIDATES[@]}"; do
  git -C "$CACHE" sparse-checkout set "$candidate" >/dev/null 2>&1 || continue
  if [ -d "$CACHE/$candidate" ]; then SRC="$candidate"; break; fi
done
[ -n "$SRC" ] || { echo "could not find the tasks plugin at $REF" >&2; exit 1; }

BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
COMMIT="$(git -C "$CACHE" rev-parse HEAD)"

git -C "$ROOT" checkout upstream-tasks
rm -rf "$ROOT/upstream"
mkdir -p "$ROOT/upstream"
rsync -a --exclude '.git' "$CACHE/$SRC/" "$ROOT/upstream/"
printf 'repo: %s\ntag: %s\npath: %s\ncommit: %s\n' "$REPO" "$REF" "$SRC" "$COMMIT" > "$ROOT/.upstream-ref"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "vendor: upstream $SRC @ $REF" || echo "vendor branch already at $REF"

git -C "$ROOT" checkout "$BRANCH"
echo
echo "Vendor branch updated. Now merge and rebuild:"
echo "  git merge upstream-tasks"
echo "  # bump the @bb registry tag in components.json to $REF, then:"
echo "  npx shadcn@latest add \$(ls components/ui | sed 's/\\.tsx\\?\$//' | sed 's|^|@bb/|' | tr '\\n' ' ') --yes --overwrite"
echo "  npm run build"
