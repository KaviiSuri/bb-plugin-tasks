#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const manifest = await readJson("package.json");
const expectedPluginId = manifest.name.replace(/^@[^/]+\//, "").replace(/^bb-plugin-/, "");
const failures = [];

for (const artifact of ["dist/server.meta.json", "dist/app.meta.json"]) {
  const metadata = await readJson(artifact);
  if (metadata.pluginId !== expectedPluginId) {
    failures.push(`${artifact}: pluginId ${metadata.pluginId} != ${expectedPluginId}`);
  }
  if (metadata.pluginVersion !== manifest.version) {
    failures.push(
      `${artifact}: pluginVersion ${metadata.pluginVersion} != ${manifest.version}`,
    );
  }
  if (metadata.artifactFormatVersion !== 1) {
    failures.push(`${artifact}: unsupported artifactFormatVersion`);
  }
  if (!metadata.builtWith?.bbVersion || !metadata.builtWith?.pluginSdkVersion) {
    failures.push(`${artifact}: missing builtWith provenance`);
  }
}

if (manifest.private !== true) {
  failures.push("package.json: git-only plugin must remain private");
}
if (!manifest.engines?.bb || !manifest.engines?.bbPluginSdk) {
  failures.push("package.json: engines.bb and engines.bbPluginSdk are required");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`release artifacts verified for ${expectedPluginId}@${manifest.version}`);
