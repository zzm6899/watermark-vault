import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const plugin = await readFile(new URL("../WatermarkVault.lrplugin/WatermarkVault.lua", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

function luaBlock(start, end) {
  const from = plugin.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = plugin.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing block boundary ${end}`);
  return plugin.slice(from, to);
}

test("final upload preflight rejects filename collisions and requires stable asset IDs", () => {
  const plan = luaBlock("local function finalUploadPlan(", "local function finalPreflightText(");
  assert.match(plan, /baseName\(asset\.originalName\)/);
  assert.match(plan, /#candidates > 1 or photosByName\[key\] > 1/);
  assert.match(plan, /trim\(candidates\[1\]\.assetId\) == ""/);
  assert.match(plan, /assetsById\[trim\(candidates\[1\]\.assetId\)\] > 1/);
  assert.match(plan, /assetsByPhotoPath\[normalisedPath\(photo:getRawMetadata\("path"\)\)\] = candidates\[1\]/);
  assert.doesNotMatch(plan, /proofId/);
});

test("final preflight names exact replacement targets and skips unsafe matches", () => {
  const preflight = luaBlock("local function finalPreflightText(", "local function showFinalPreflightIssues(");
  const finals = luaBlock("function M.uploadFinals()", "function M.browseAlbums()");
  assert.match(preflight, /asset\.assetId/);
  assert.match(preflight, /REPLACE EXISTING FINAL/);
  assert.match(finals, /if #plan\.matches == 0 then showFinalPreflightIssues\(plan\); return end/);
  assert.match(finals, /LrDialogs\.confirm\("Confirm Watermark Vault final upload"/);
  assert.match(finals, /\{ name = "assetId", value = asset\.assetId \}/);
  assert.equal((finals.match(/postMultipart\(/g) || []).length, 1, "each rendition uses one upload request without retry");
});

test("an upload counts as successful only when the server confirms ok", () => {
  const upload = luaBlock("local function postMultipart(", "local function photoLabel(");
  assert.match(upload, /type\(result\) ~= "table" or result\.ok ~= true/);
  assert.match(upload, /Upload did not return a success response/);
});

test("rendition processing has cancel-aware progress, cleanup, and per-photo failures", () => {
  const uploads = luaBlock("local function processPhotoUploads(", "local function appendNames(");
  const failure = luaBlock("local function failRendition(", "local function processPhotoUploads(");
  assert.match(uploads, /progress:attachToFunctionContext\(context\)/);
  assert.match(uploads, /progress:setCancelable\(true\)/);
  assert.match(uploads, /progressScope = progress/);
  assert.match(uploads, /stopIfCanceled = true/);
  assert.match(uploads, /progress:setCaption\(string\.format\("Uploading/);
  assert.match(uploads, /rendition:waitForRender\(\)/);
  assert.match(failure, /rendition:uploadFailed\(message\)/);
  assert.match(uploads, /LrTasks\.pcall\(function\(\) upload\(rendition, renderedPath\) end\)/);
  assert.match(uploads, /result\.failures/);
  assert.match(uploads, /result\.cancelled = result\.total - result\.uploaded - #result\.failures/);
});

test("proof watermark ownership is documented without overriding Lightroom export settings", () => {
  const publish = luaBlock("function M.publishProofs()", "function M.uploadFinals()");
  const finals = luaBlock("function M.uploadFinals()", "function M.browseAlbums()");
  assert.doesNotMatch(publish, /LR_useWatermark\s*=/);
  assert.doesNotMatch(finals, /LR_useWatermark\s*=/);
  assert.match(readme, /Watermark Vault's server applies its watermark to the proof-gallery rendition/);
  assert.match(readme, /does not create or change Lightroom-native watermark presets/);
  assert.match(readme, /Lightroom Classic acceptance checklist/);
});
