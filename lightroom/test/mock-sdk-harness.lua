local scenario, posts, messages, preflights, renditionFailures
local lastProgress, sessionCount, confirmCount
local prefs = { serverUrl = "https://test.invalid", username = "test", password = "test" }

local function encodeJson(value)
  local kind = type(value)
  if kind == "string" then
    return '"' .. value:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r") .. '"'
  elseif kind == "number" or kind == "boolean" then
    return tostring(value)
  elseif kind ~= "table" then
    return "null"
  end
  local isArray = #value > 0
  local parts = {}
  if isArray then
    for index, item in ipairs(value) do parts[index] = encodeJson(item) end
    return "[" .. table.concat(parts, ",") .. "]"
  end
  for key, item in pairs(value) do
    if item ~= nil then table.insert(parts, encodeJson(tostring(key)) .. ":" .. encodeJson(item)) end
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

local function photo(path)
  return { getRawMetadata = function(_, key) if key == "path" then return path end end }
end

local LrPathUtils = {
  leafName = function(path)
    local normalised = tostring(path or ""):gsub("\\", "/")
    return normalised:match("([^/]+)$") or normalised
  end,
  removeExtension = function(name) return tostring(name or ""):gsub("%.[^.]*$", "") end,
}

local LrDialogs = {
  message = function(title, message, kind) table.insert(messages, { title = title, message = message, kind = kind }) end,
  presentModalDialog = function() return "ok" end,
  confirm = function(_, details)
    confirmCount = confirmCount + 1
    table.insert(preflights, details)
    return scenario.confirmResult or "ok"
  end,
}

local LrHttp = {
  get = function(url)
    if url:match("/picks$") then
      return encodeJson({ ok = true, album = { id = "album-1", title = "Test", clientName = "Test" }, assets = scenario.assets or {} }), { status = 200 }
    end
    return encodeJson({ ok = true, albums = { { id = "album-1", title = "Test", photoCount = 1 } } }), { status = 200 }
  end,
  postMultipart = function(_, fields)
    local targetId
    for _, field in ipairs(fields) do if field.name == "assetId" then targetId = field.value end end
    table.insert(posts, { assetId = targetId })
    local callIndex = #posts
    if scenario.cancelAfter == callIndex and lastProgress then lastProgress:cancel() end
    if scenario.serverResults and scenario.serverResults[callIndex] == false then
      return encodeJson({ ok = false, error = "server rejected photo" }), { status = 200 }
    end
    return encodeJson({ ok = true, assetId = targetId }), { status = 200 }
  end,
}

local LrFunctionContext = {
  callWithContext = function(_, callback) return callback({}) end,
}

local LrProgressScope = setmetatable({}, { __call = function(_, params)
  local scope = { title = params.title, canceled = false, portion = 0, caption = "" }
  function scope:attachToFunctionContext() self.attached = true end
  function scope:setCancelable(value) self.cancelable = value end
  function scope:cancel() self.canceled = true end
  function scope:isCanceled() return self.canceled end
  function scope:setCaption(value) self.caption = value end
  function scope:setPortionComplete(value) self.portion = value end
  function scope:done() self.doneCalled = true end
  lastProgress = scope
  return scope
end })

local LrExportSession = setmetatable({}, { __call = function(_, params)
  sessionCount = sessionCount + 1
  local session = {}
  function session:countRenditions() return #params.photosToExport end
  function session:renditions(iteratorParams)
    local index = 0
    return function()
      if iteratorParams.progressScope:isCanceled() then return nil end
      index = index + 1
      local selected = params.photosToExport[index]
      if not selected then return nil end
      local rendition = { photo = selected }
      function rendition:waitForRender()
        local path = selected:getRawMetadata("path")
        local reason = scenario.renderFailures and scenario.renderFailures[path]
        if reason then return false, reason end
        return true, "temporary/" .. LrPathUtils.leafName(path)
      end
      function rendition:uploadFailed(reason)
        table.insert(renditionFailures, { name = LrPathUtils.leafName(selected:getRawMetadata("path")), reason = reason })
      end
      return index, rendition
    end
  end
  return session
end })

local LrTasks = {
  pcall = pcall,
  startAsyncTask = function(callback) return callback() end,
}

local LrApplication = {
  activeCatalog = function()
    return { getTargetPhotos = function() return scenario.photos or {} end }
  end,
}

local LrView = {
  osFactory = function()
    return setmetatable({ control_spacing = function() return 0 end }, { __index = function() return function() return {} end end })
  end,
  bind = function(key) return key end,
}

local LrBinding = { makePropertyTable = function() return {} end }
local LrPrefs = { prefsForPlugin = function() return prefs end }
local modules = {
  LrApplication = LrApplication, LrBinding = LrBinding, LrDialogs = LrDialogs,
  LrExportSession = LrExportSession, LrFileUtils = {}, LrFunctionContext = LrFunctionContext,
  LrHttp = LrHttp, LrPathUtils = LrPathUtils, LrPrefs = LrPrefs,
  LrProgressScope = LrProgressScope, LrTasks = LrTasks, LrView = LrView,
}
function import(name) return assert(modules[name], "unexpected SDK module: " .. name) end

local plugin = dofile("lightroom/WatermarkVault.lrplugin/WatermarkVault.lua")

local function reset(nextScenario)
  scenario, posts, messages, preflights, renditionFailures = nextScenario, {}, {}, {}, {}
  lastProgress, sessionCount, confirmCount = nil, 0, 0
end

local function messageText()
  local output = {}
  for _, message in ipairs(messages) do table.insert(output, message.message) end
  return table.concat(output, "\n")
end

local function run(name, nextScenario, check)
  reset(nextScenario)
  plugin.uploadFinals()
  check()
  print("PASS " .. name)
end

run("duplicate basenames on both sides leave only the unique pair uploadable", {
  photos = { photo("C:/Shoot/DSC_100.NEF"), photo("D:/Alt/DSC_100.CR3"), photo("C:/Shoot/DSC_101.NEF") },
  assets = {
    { originalName = "DSC_100.jpg", assetId = "ambiguous-1" },
    { originalName = "DSC_100.jpeg", assetId = "ambiguous-2" },
    { originalName = "DSC_101.jpg", assetId = "safe-101" },
  },
}, function()
  assert(#posts == 1 and posts[1].assetId == "safe-101", "only the unique target should upload")
  assert(preflights[1]:find("Ambiguous basename", 1, true), "preflight should disclose ambiguous photos")
  assert(messageText():find("Ambiguous basename", 1, true), "summary should repeat skipped collisions")
end)

run("duplicate asset IDs are rejected", {
  photos = { photo("C:/Shoot/DSC_201.NEF"), photo("C:/Shoot/DSC_202.NEF") },
  assets = {
    { originalName = "DSC_201.jpg", assetId = "duplicate-id" },
    { originalName = "DSC_202.jpg", assetId = "duplicate-id" },
  },
}, function()
  assert(#posts == 0 and sessionCount == 0, "duplicate IDs must not render or upload")
  assert(messageText():find("duplicated", 1, true), "invalid target reason should be reported")
end)

run("missing asset IDs are skipped while valid pairs continue", {
  photos = { photo("C:/Shoot/DSC_301.NEF"), photo("C:/Shoot/DSC_302.NEF") },
  assets = {
    { originalName = "DSC_301.jpg" },
    { originalName = "DSC_302.jpg", assetId = "valid-302" },
  },
}, function()
  assert(#posts == 1 and posts[1].assetId == "valid-302", "only the valid asset ID should upload")
  assert(preflights[1]:find("missing assetId", 1, true), "preflight should report missing IDs")
end)

run("partial server acknowledgement records one success and one failure without retry", {
  photos = { photo("C:/Shoot/DSC_401.NEF"), photo("C:/Shoot/DSC_402.NEF") },
  assets = {
    { originalName = "DSC_401.jpg", assetId = "asset-401" },
    { originalName = "DSC_402.jpg", assetId = "asset-402" },
  },
  serverResults = { true, false },
}, function()
  assert(#posts == 2, "each rendition should make one request, with no retry")
  assert(messageText():find("Uploaded 1 of 2", 1, true), "summary should count the acknowledged success")
  assert(messageText():find("server rejected photo", 1, true), "summary should show the server rejection")
  assert(#renditionFailures == 1 and renditionFailures[1].name == "DSC_402.NEF", "Lightroom should receive one per-photo upload failure")
end)

run("render failure is reported while the following photo uploads", {
  photos = { photo("C:/Shoot/DSC_501.NEF"), photo("C:/Shoot/DSC_502.NEF") },
  assets = {
    { originalName = "DSC_501.jpg", assetId = "asset-501" },
    { originalName = "DSC_502.jpg", assetId = "asset-502" },
  },
  renderFailures = { ["C:/Shoot/DSC_501.NEF"] = "mock render failed" },
}, function()
  assert(#posts == 1 and posts[1].assetId == "asset-502", "later renderable photo should still upload")
  assert(messageText():find("Uploaded 1 of 2", 1, true), "summary should count render failure as incomplete")
  assert(messageText():find("mock render failed", 1, true), "render failure should be visible")
  assert(#renditionFailures == 1 and renditionFailures[1].name == "DSC_501.NEF", "failed render should notify Lightroom")
end)

run("cancel after the first acknowledged upload prevents later requests", {
  photos = { photo("C:/Shoot/DSC_601.NEF"), photo("C:/Shoot/DSC_602.NEF"), photo("C:/Shoot/DSC_603.NEF") },
  assets = {
    { originalName = "DSC_601.jpg", assetId = "asset-601" },
    { originalName = "DSC_602.jpg", assetId = "asset-602" },
    { originalName = "DSC_603.jpg", assetId = "asset-603" },
  },
  cancelAfter = 1,
}, function()
  assert(#posts == 1 and posts[1].assetId == "asset-601", "no later photo should be posted after cancel")
  assert(messageText():find("Canceled; 2 matched photo(s) were not uploaded", 1, true), "cancel summary should name the remainder count")
  assert(lastProgress.cancelable and lastProgress.attached, "cancel scope should be cancelable and context-owned")
end)

run("none matched produces a preflight issue and no export or upload", {
  photos = { photo("C:/Shoot/NO_MATCH.NEF") },
  assets = { { originalName = "OTHER.jpg", assetId = "other-1" } },
}, function()
  assert(#posts == 0 and sessionCount == 0 and confirmCount == 0, "no-match path must stop before confirmation or export")
  assert(messageText():find("No safe final uploads are available", 1, true), "no-match message should be clear")
  assert(messageText():find("NO_MATCH.NEF", 1, true), "no-match report should name the selected photo")
end)

print("7 mock SDK scenarios passed; no Lightroom runtime, catalog, network, or server used")
