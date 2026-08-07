/**
 * Generates a local `@bb/shared-ui` package that re-exports the shadcn
 * components vendored from the BB registry.
 *
 * Upstream plugin source imports `@bb/shared-ui/*`, which only resolves inside
 * the BB monorepo. tsconfig `paths` can't fix that here because upstream ships
 * its own tsconfig.json and esbuild honours the nearest one, so the shim works
 * at module-resolution level instead: npm links it via a `file:` dependency and
 * upstream source stays byte-for-byte pristine.
 *
 * Re-run after `shadcn add` pulls new components, or after an upstream sync
 * introduces a new `@bb/shared-ui/*` import.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shim = join(root, "shims", "shared-ui");

/** Walk upstream/ and collect every distinct `@bb/shared-ui/<spec>` import. */
function collectSpecifiers(dir, found = new Set()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") collectSpecifiers(path, found);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const source = readFileSync(path, "utf8");
    for (const [, spec] of source.matchAll(/@bb\/shared-ui\/([a-zA-Z0-9/_-]+)/g)) {
      found.add(spec);
    }
  }
  return found;
}
import { readFileSync } from "node:fs";

/** Vendored components live in a few different roots depending on their kind. */
function resolveVendored(spec) {
  const candidates = spec.startsWith("lib/")
    ? [`${spec}`]
    : spec.startsWith("hooks/")
      ? [`components/ui/${spec}`, `${spec}`]
      : [`components/ui/${spec}`];
  for (const candidate of candidates) {
    for (const ext of [".tsx", ".ts"]) {
      if (existsSync(join(root, candidate + ext))) return candidate + ext;
    }
  }
  return null;
}

rmSync(shim, { recursive: true, force: true });
mkdirSync(shim, { recursive: true });

const specifiers = [...collectSpecifiers(join(root, "upstream"))].sort();
const exportsMap = {};
const missing = [];

for (const spec of specifiers) {
  const vendored = resolveVendored(spec);
  if (!vendored) {
    missing.push(spec);
    continue;
  }
  const file = join(shim, `${spec}.tsx`);
  mkdirSync(dirname(file), { recursive: true });
  const target = relative(dirname(file), join(root, vendored)).replace(/\\/g, "/");
  writeFileSync(file, `export * from "${target}";\n`);
  exportsMap[`./${spec}`] = `./${spec}.tsx`;
}

writeFileSync(
  join(shim, "package.json"),
  JSON.stringify(
    { name: "@bb/shared-ui", version: "0.0.0", private: true, type: "module", exports: exportsMap },
    null,
    2,
  ) + "\n",
);

console.log(`shim: ${Object.keys(exportsMap).length} specifiers ->`, Object.keys(exportsMap).join(" "));
if (missing.length) {
  console.error(`\nMISSING ${missing.length} — vendor them first:`);
  for (const spec of missing) console.error(`  npx shadcn add @bb/${spec.replace(/^.*\//, "")}   (${spec})`);
  process.exit(1);
}
