import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const manifest = JSON.parse(readFileSync("dist/.vite/manifest.json", "utf8"));
const initial = new Set();
function visit(key) {
  if (initial.has(key)) return;
  initial.add(key);
  for (const dependency of manifest[key].imports || []) visit(dependency);
}
visit("index.html");
visit("src/pages/Admin.tsx");
for (const feature of ["InvoicesView", "PlatformView"]) {
  const key = `src/pages/admin/${feature}.tsx`;
  assert.ok(manifest[key], `${feature} must have its own chunk`);
  assert.ok(!initial.has(key), `${feature} must not load with the admin dashboard`);
}
const admin = readFileSync(`dist/${manifest["src/pages/Admin.tsx"].file}`);
assert.ok(admin.length < 500_000, `Admin chunk exceeds 500 kB: ${admin.length} bytes`);
const files = new Set([...initial].map(key => manifest[key].file).filter(file => file.endsWith(".js")));
let bytes = 0;
let gzip = 0;
for (const file of files) {
  const content = readFileSync(`dist/${file}`);
  bytes += content.length;
  gzip += gzipSync(content).length;
}
assert.ok(bytes < 1_250_000, `Initial admin JavaScript exceeds 1.25 MB: ${bytes} bytes`);
console.log(`Admin: ${(admin.length / 1000).toFixed(1)} kB. Initial JS including shared dependencies: ${(bytes / 1000).toFixed(1)} kB (${(gzip / 1000).toFixed(1)} kB gzip). Invoice and platform chunks are deferred.`);
