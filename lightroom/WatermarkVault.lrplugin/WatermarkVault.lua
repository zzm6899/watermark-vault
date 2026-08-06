-- Watermark Vault Lightroom Classic bridge.
-- Install as a folder plug-in via File > Plug-in Manager > Add.
local LrApplication = import "LrApplication"
local LrBinding = import "LrBinding"
local LrDialogs = import "LrDialogs"
local LrExportSession = import "LrExportSession"
local LrFileUtils = import "LrFileUtils"
local LrFunctionContext = import "LrFunctionContext"
local LrHttp = import "LrHttp"
local LrPathUtils = import "LrPathUtils"
local LrPrefs = import "LrPrefs"
local LrTasks = import "LrTasks"
local LrView = import "LrView"

local M = {}
local prefs = LrPrefs.prefsForPlugin()

-- Lightroom Classic's SDK does not ship LrJson in every version. This decoder
-- handles the API response shape without requiring a third-party module.
local function jsonDecode(input)
  local position, length = 1, #input
  local function skipWhitespace()
    while position <= length and input:sub(position, position):match("%s") do position = position + 1 end
  end
  local parseValue
  local function parseString()
    position = position + 1
    local output = {}
    while position <= length do
      local character = input:sub(position, position)
      if character == '"' then position = position + 1; return table.concat(output) end
      if character == "\\" then
        position = position + 1
        local escaped = input:sub(position, position)
        local replacements = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
        if escaped == "u" then
          local code = tonumber(input:sub(position + 1, position + 4), 16)
          if code and code < 128 then table.insert(output, string.char(code)) end
          position = position + 4
        else table.insert(output, replacements[escaped] or escaped) end
      else table.insert(output, character) end
      position = position + 1
    end
    error("Unterminated JSON string")
  end
  local function parseArray()
    position = position + 1; skipWhitespace()
    local output = {}
    if input:sub(position, position) == "]" then position = position + 1; return output end
    while true do
      table.insert(output, parseValue()); skipWhitespace()
      local character = input:sub(position, position)
      if character == "]" then position = position + 1; return output end
      if character ~= "," then error("Invalid JSON array") end
      position = position + 1; skipWhitespace()
    end
  end
  local function parseObject()
    position = position + 1; skipWhitespace()
    local output = {}
    if input:sub(position, position) == "}" then position = position + 1; return output end
    while true do
      if input:sub(position, position) ~= '"' then error("Invalid JSON object key") end
      local key = parseString(); skipWhitespace()
      if input:sub(position, position) ~= ":" then error("Invalid JSON object") end
      position = position + 1; skipWhitespace(); output[key] = parseValue(); skipWhitespace()
      local character = input:sub(position, position)
      if character == "}" then position = position + 1; return output end
      if character ~= "," then error("Invalid JSON object") end
      position = position + 1; skipWhitespace()
    end
  end
  parseValue = function()
    skipWhitespace()
    local character = input:sub(position, position)
    if character == '"' then return parseString() end
    if character == "{" then return parseObject() end
    if character == "[" then return parseArray() end
    if input:sub(position, position + 3) == "true" then position = position + 4; return true end
    if input:sub(position, position + 4) == "false" then position = position + 5; return false end
    if input:sub(position, position + 3) == "null" then position = position + 4; return nil end
    local token = input:sub(position):match("^-?%d+%.?%d*[eE]?[-+]?%d*")
    if token then position = position + #token; return tonumber(token) end
    error("Invalid JSON value")
  end
  local result = parseValue(); skipWhitespace()
  if position <= length then error("Unexpected trailing JSON") end
  return result
end

-- Lightroom Classic's Lua runtime has no LrBase64 namespace on all supported
-- versions. Keep this small encoder here for the HTTP Basic authorization
-- header rather than relying on an optional SDK module.
local base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function base64Encode(value)
  local bits = (tostring(value):gsub(".", function(character)
    local byte, output = character:byte(), ""
    for index = 8, 1, -1 do
      output = output .. (byte % 2 ^ index - byte % 2 ^ (index - 1) > 0 and "1" or "0")
    end
    return output
  end) .. "0000")
  return (bits:gsub("%d%d%d?%d?%d?%d?", function(chunk)
    if #chunk < 6 then return "" end
    local number = 0
    for index = 1, 6 do
      if chunk:sub(index, index) == "1" then number = number + 2 ^ (6 - index) end
    end
    return base64Alphabet:sub(number + 1, number + 1)
  end) .. ({ "", "==", "=" })[#tostring(value) % 3 + 1])
end

local function trim(value) return (tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", "")) end
local function baseName(name) return (LrPathUtils.removeExtension(LrPathUtils.leafName(name or "")) or ""):lower() end
local function isRaw(path)
  local ext = (LrPathUtils.extension(path) or ""):lower()
  return ext == "nef" or ext == "cr2" or ext == "cr3" or ext == "arw" or ext == "raf" or ext == "orf" or ext == "rw2" or ext == "dng"
end

local function authHeaders()
  local username, password = trim(prefs.username), trim(prefs.password)
  if username == "" or password == "" then return nil end
  return { Authorization = "Basic " .. base64Encode(username .. ":" .. password) }
end

local function serverUrl(path)
  local root = trim(prefs.serverUrl):gsub("/+$", "")
  return root .. path
end

local function requireConfig()
  if trim(prefs.serverUrl) == "" or not authHeaders() then
    LrDialogs.message("Watermark Vault", "Configure the server URL, username and password first.", "warning")
    return false
  end
  return true
end

local function jsonGet(path)
  local body, headers = LrHttp.get(serverUrl(path), authHeaders())
  if not body or body == "" then error("No response from Watermark Vault") end
  local data = jsonDecode(body)
  if not data.ok then error(data.error or "Watermark Vault request failed") end
  return data
end

local function promptAlbumId(title)
  local albumId
  LrFunctionContext.callWithContext("watermarkVaultAlbumPrompt", function(context)
    local f = LrView.osFactory()
    local props = LrBinding.makePropertyTable(context)
    props.albumId = prefs.lastAlbumId or ""
    local answer = LrDialogs.presentModalDialog {
      title = title,
      contents = f:column { spacing = f:control_spacing(),
        f:static_text { title = "Watermark Vault album ID" },
        f:edit_field { value = LrView.bind "albumId", width_in_chars = 38 },
        f:static_text { title = "The Album editor URL or Watermark Vault admin lists this ID." },
      },
    }
    if answer == "ok" and trim(props.albumId) ~= "" then albumId = trim(props.albumId) end
  end)
  if not albumId then return nil end
  prefs.lastAlbumId = albumId
  return albumId
end

local function downloadProof(asset, cacheFolder)
  if not asset.proofUrl or asset.proofUrl == "" then return nil end
  LrFileUtils.createAllDirectories(cacheFolder)
  local name = (asset.assetId or asset.proofId or "proof") .. ".jpg"
  local destination = LrPathUtils.child(cacheFolder, name)
  if LrFileUtils.exists(destination) then return destination end
  local body = LrHttp.get(asset.proofUrl, authHeaders())
  if body and body ~= "" then
    local file = assert(io.open(destination, "wb"))
    file:write(body)
    file:close()
    return destination
  end
  return nil
end

local function normalisedPath(value)
  return tostring(value or ""):gsub("\\", "/"):lower()
end

local function chooseSourceFolder()
  local folders = LrDialogs.runOpenPanel {
    title = "Choose the shoot folder containing RAW files",
    canChooseFiles = false,
    canChooseDirectories = true,
    allowsMultipleSelection = false,
  }
  return folders and folders[1] or nil
end

local function photoLookup(catalog, sourceFolder)
  local lookup = {}
  local root = normalisedPath(sourceFolder)
  if root ~= "" and root:sub(-1) ~= "/" then root = root .. "/" end
  for _, photo in ipairs(catalog:getAllPhotos()) do
    local path = photo:getRawMetadata("path")
    local normalisedPhotoPath = normalisedPath(path)
    if path and isRaw(path) and (root == "" or normalisedPhotoPath:sub(1, #root) == root) then
      local key = baseName(path)
      lookup[key] = lookup[key] or {}
      table.insert(lookup[key], photo)
    end
  end
  return lookup
end

local function selectedKeyword(catalog, clientName)
  local root = catalog:createKeyword("Watermark Vault", {}, true)
  local client = catalog:createKeyword(clientName or "Client", {}, true, root)
  return catalog:createKeyword("Selected", {}, true, client)
end

local function collectionFor(catalog, albumTitle, clientName)
  local root = catalog:createCollectionSet("Watermark Vault", nil, true)
  local album = catalog:createCollectionSet(albumTitle or "Album", root, true)
  return catalog:createCollection((clientName or "Client") .. " — Client Picks", album, true)
end

function M.configure()
  LrTasks.startAsyncTask(function()
    LrFunctionContext.callWithContext("watermarkVaultConfigure", function(context)
      local f = LrView.osFactory()
      local props = LrBinding.makePropertyTable(context)
      props.serverUrl = prefs.serverUrl or ""
      props.username = prefs.username or ""
      props.password = prefs.password or ""
      props.proofCacheFolder = prefs.proofCacheFolder or ""
      props.applyFiveStars = prefs.applyFiveStars ~= false
      local result = LrDialogs.presentModalDialog {
        title = "Watermark Vault connection",
        actionVerb = "Save & Test connection",
        contents = f:column { spacing = f:control_spacing(),
          f:static_text { title = "Watermark Vault server URL (for example: https://book.yourdomain.com)" },
          f:edit_field { value = LrView.bind "serverUrl", width_in_chars = 56 },
          f:static_text { title = "Watermark Vault admin username" },
          f:edit_field { value = LrView.bind "username", width_in_chars = 36 },
          f:static_text { title = "Watermark Vault admin password" },
          f:password_field { value = LrView.bind "password", width_in_chars = 56 },
          f:static_text { title = "Folder for downloaded proof JPEGs (optional; leave empty for Documents\\WatermarkVaultProofs)" },
          f:edit_field { value = LrView.bind "proofCacheFolder", width_in_chars = 56 },
          f:checkbox { title = "Apply five-star rating to selected photos", value = LrView.bind "applyFiveStars" },
          f:static_text { title = "Credentials are used only for the local Lightroom-to-server HTTPS connection." },
        },
      }
      if result ~= "ok" then return end
      prefs.serverUrl = trim(props.serverUrl)
      prefs.username = trim(props.username)
      prefs.password = props.password or ""
      prefs.proofCacheFolder = trim(props.proofCacheFolder)
      prefs.applyFiveStars = props.applyFiveStars == true
      local ok, response = pcall(function() return jsonGet("/api/lightroom/albums") end)
      if ok then
        LrDialogs.message("Watermark Vault", string.format("Connected successfully. %d album(s) are available.", #(response.albums or {})))
      else
        LrDialogs.message("Watermark Vault connection failed", tostring(response), "critical")
      end
    end)
  end)
end

function M.syncPicks()
  if not requireConfig() then return end
  local sourceFolder = chooseSourceFolder()
  if not sourceFolder then return end
  local albumId = promptAlbumId("Sync Watermark Vault client picks")
  if not albumId then return end
  LrTasks.startAsyncTask(function()
    local ok, message = pcall(function()
      local manifest = jsonGet("/api/lightroom/albums/" .. albumId .. "/picks")
      local catalog = LrApplication.activeCatalog()
      local lookup = photoLookup(catalog, sourceFolder)
      local selected, unmatched, ambiguous = {}, {}, {}
      local cache = trim(prefs.proofCacheFolder)
      if cache == "" then cache = LrPathUtils.child(LrPathUtils.getStandardFilePath("documents"), "WatermarkVaultProofs") end
      for _, asset in ipairs(manifest.assets or {}) do
        if asset.selected then
          downloadProof(asset, LrPathUtils.child(cache, albumId))
          local candidates = lookup[baseName(asset.originalName or asset.proofId)] or {}
          if #candidates == 1 then table.insert(selected, candidates[1])
          elseif #candidates == 0 then table.insert(unmatched, asset.originalName or asset.proofId)
          else table.insert(ambiguous, asset.originalName or asset.proofId) end
        end
      end
      catalog:withWriteAccessDo("Watermark Vault sync picks", function()
        local keyword = selectedKeyword(catalog, manifest.album.clientName)
        local collection = collectionFor(catalog, manifest.album.title, manifest.album.clientName)
        collection:addPhotos(selected)
        for _, photo in ipairs(selected) do
          photo:addKeyword(keyword)
          if prefs.applyFiveStars ~= false then photo:setRawMetadata("rating", 5) end
        end
      end)
      LrDialogs.message("Watermark Vault", string.format("Synced %d picks from %s. %d unmatched, %d ambiguous. Proof JPEGs are cached in %s.", #selected, sourceFolder, #unmatched, #ambiguous, cache))
    end)
    if not ok then LrDialogs.message("Watermark Vault sync failed", tostring(message), "critical") end
  end)
end

local function postMultipart(path, fields)
  local body, headers = LrHttp.postMultipart(serverUrl(path), fields, authHeaders())
  local result = jsonDecode(body or "{}")
  if not result.ok and not result.files then error(result.error or "Upload failed") end
  return result
end

function M.publishProofs()
  if not requireConfig() then return end
  local albumId = promptAlbumId("Publish selected proof JPEGs")
  if not albumId then return end
  local catalog, photos = LrApplication.activeCatalog(), LrApplication.activeCatalog():getTargetPhotos()
  if #photos == 0 then LrDialogs.message("Watermark Vault", "Select photos first.", "warning"); return end
  LrTasks.startAsyncTask(function()
    local ok, message = pcall(function()
      local session = LrExportSession { photosToExport = photos, exportSettings = { LR_format = "JPEG", LR_jpeg_quality = 75, LR_size_doConstrain = true, LR_size_maxWidth = 2000, LR_size_maxHeight = 2000, LR_export_destinationType = "specificFolder", LR_collisionHandling = "overwrite" } }
      local uploaded = 0
      for _, rendition in session:renditions { stopIfCanceled = true } do
        local success, renderedPath = rendition:waitForRender()
        if success then
          postMultipart("/api/upload?albumId=" .. albumId, { { name = "photos", filePath = renderedPath } })
          uploaded = uploaded + 1
        end
      end
      LrDialogs.message("Watermark Vault", "Published " .. uploaded .. " proof JPEGs.")
    end)
    if not ok then LrDialogs.message("Watermark Vault publish failed", tostring(message), "critical") end
  end)
end

function M.uploadFinals()
  if not requireConfig() then return end
  local albumId = promptAlbumId("Upload selected final JPEGs")
  if not albumId then return end
  local catalog, photos = LrApplication.activeCatalog(), LrApplication.activeCatalog():getTargetPhotos()
  if #photos == 0 then LrDialogs.message("Watermark Vault", "Select the edited photos to upload first.", "warning"); return end
  LrTasks.startAsyncTask(function()
    local ok, message = pcall(function()
      local manifest = jsonGet("/api/lightroom/albums/" .. albumId .. "/picks")
      local assetsByName = {}
      for _, asset in ipairs(manifest.assets or {}) do assetsByName[baseName(asset.originalName or asset.proofId)] = asset end
      local session = LrExportSession { photosToExport = photos, exportSettings = { LR_format = "JPEG", LR_jpeg_quality = 90, LR_size_doConstrain = false, LR_export_destinationType = "specificFolder", LR_collisionHandling = "overwrite" } }
      local uploaded, unmatched = 0, 0
      for _, rendition in session:renditions { stopIfCanceled = true } do
        local sourcePath = rendition.photo:getRawMetadata("path")
        local asset = assetsByName[baseName(sourcePath)]
        local success, renderedPath = rendition:waitForRender()
        if success and asset then
          postMultipart("/api/lightroom/albums/" .. albumId .. "/finals", {
            { name = "assetId", value = asset.assetId },
            { name = "final", filePath = renderedPath },
          })
          uploaded = uploaded + 1
        elseif success then
          unmatched = unmatched + 1
        end
      end
      LrDialogs.message("Watermark Vault", string.format("Uploaded %d finals. %d selected Lightroom photos did not match an album proof.", uploaded, unmatched))
    end)
    if not ok then LrDialogs.message("Watermark Vault final upload failed", tostring(message), "critical") end
  end)
end

return M
