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
local function encodePathSegment(value)
  return tostring(value or ""):gsub("([^%w%._~-])", function(character)
    return string.format("%%%02X", character:byte())
  end)
end
local function baseName(name) return (LrPathUtils.removeExtension(LrPathUtils.leafName(name or "")) or ""):lower() end
local function fileNumber(name) return baseName(name):match("(%d+)[^%d]*$") end
local function isRaw(path)
  local ext = (LrPathUtils.extension(path) or ""):lower()
  return ext == "nef" or ext == "cr2" or ext == "cr3" or ext == "arw" or ext == "raf" or ext == "orf" or ext == "rw2" or ext == "dng"
end

local function authHeaders()
  local username, password = trim(prefs.username), trim(prefs.password)
  if username == "" or password == "" then return nil end
  -- LrHttp requires an array of { field, value } records. A string-keyed Lua
  -- table is silently ignored, which makes the request fail on some versions.
  return {
    { field = "Authorization", value = "Basic " .. base64Encode(username .. ":" .. password) },
    { field = "Accept", value = "application/json" },
  }
end

local function serverUrl(path)
  local root = trim(prefs.serverUrl):gsub("/+$", "")
  if not root:match("^https?://") then root = "https://" .. root end
  return root .. path
end

local function defaultProofCacheFolder()
  local documents = LrPathUtils.getStandardFilePath("documents")
  if not documents or trim(documents) == "" then
    error("Lightroom could not find your Documents folder. Set a download folder in Configure Watermark Vault connection.")
  end
  return LrPathUtils.child(documents, "WatermarkVaultProofs")
end

local function proofCacheFolder()
  local folder = trim(prefs.proofCacheFolder)
  if folder == "" then return defaultProofCacheFolder() end
  -- Never put proof downloads straight in the root of a drive. It is very
  -- easy to lose track of them there, and album folders then appear under C:.
  local parent = tostring(LrPathUtils.parent(folder) or ""):gsub("\\", "/"):lower()
  local normalisedFolder = tostring(folder):gsub("\\", "/"):lower()
  if parent == normalisedFolder then
    error("The proof download folder cannot be a drive root. Choose a folder such as Documents\\WatermarkVaultProofs in Configure Watermark Vault connection.")
  end
  return folder
end

local function requireConfig()
  if trim(prefs.serverUrl) == "" or not authHeaders() then
    LrDialogs.message("Watermark Vault", "Configure the server URL, username and password first.", "warning")
    return false
  end
  return true
end

local function jsonGet(path)
  local body, headers = LrHttp.get(serverUrl(path), authHeaders(), 20)
  if not body then
    local networkError = headers and headers.error or nil
    local reason = networkError and (networkError.name or networkError.errorCode or tostring(networkError)) or "unknown network error"
    error("Could not reach " .. serverUrl(path) .. " (" .. reason .. ")")
  end
  if headers and headers.status and (headers.status < 200 or headers.status >= 300) then
    error("Watermark Vault returned HTTP " .. tostring(headers.status) .. ": " .. tostring(body):sub(1, 240))
  end
  if body == "" then error("Watermark Vault returned an empty response") end
  local data = jsonDecode(body)
  if not data.ok then error(data.error or "Watermark Vault request failed") end
  return data
end

local function albumLabel(album)
  local client = trim(album.clientName)
  local timing = trim((album.sessionDate or "") .. " " .. (album.startTime or ""))
  local details = {}
  if client ~= "" then table.insert(details, client) end
  if timing ~= "" then table.insert(details, timing) end
  table.insert(details, tostring(album.photoCount or 0) .. " photos")
  table.insert(details, album.proofingStage or "not started")
  return (album.title or album.id) .. "  —  " .. table.concat(details, " · ")
end

local function chooseAlbum(title)
  local response = jsonGet("/api/lightroom/albums")
  local albums = response.albums or {}
  if #albums == 0 then error("No Watermark Vault albums are available") end
  table.sort(albums, function(a, b) return albumLabel(a):lower() < albumLabel(b):lower() end)
  local items, selectedId = {}, prefs.lastAlbumId
  for _, album in ipairs(albums) do
    table.insert(items, { title = albumLabel(album), value = album.id })
    if not selectedId then selectedId = album.id end
  end
  local selected
  LrFunctionContext.callWithContext("watermarkVaultAlbumPrompt", function(context)
    local f = LrView.osFactory()
    local props = LrBinding.makePropertyTable(context)
    props.albumId = selectedId
    local answer = LrDialogs.presentModalDialog {
      title = title,
      contents = f:column { bind_to_object = props, spacing = f:control_spacing(),
        f:static_text { title = "Choose a proofing album" },
        f:popup_menu { items = items, value = LrView.bind "albumId", width_in_chars = 72 },
        f:static_text { title = "The menu includes client, time slot, photo count and proofing state." },
      },
    }
    if answer == "ok" and trim(props.albumId) ~= "" then selected = trim(props.albumId) end
  end)
  if not selected then return nil end
  prefs.lastAlbumId = selected
  return selected
end

local function downloadProof(asset, cacheFolder)
  if not asset.proofUrl or asset.proofUrl == "" then return nil end
  LrFileUtils.createAllDirectories(cacheFolder)
  -- Preserve the photographer's filename: RAW matching is deliberately based
  -- on this name without its extension (e.g. DSC_1234.jpg → DSC_1234.NEF).
  local name = LrPathUtils.leafName(asset.originalName or "")
  name = name:gsub("[\\/:*?\"<>|]", "_")
  if name == "" then name = (asset.proofId or asset.assetId or "proof") .. ".jpg" end
  if (LrPathUtils.extension(name) or "") == "" then name = name .. ".jpg" end
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
  local function addCandidate(key, candidate)
    if not key or key == "" then return end
    lookup[key] = lookup[key] or {}
    table.insert(lookup[key], candidate)
  end
  local root = normalisedPath(sourceFolder)
  if root ~= "" and root:sub(-1) ~= "/" then root = root .. "/" end
  for _, photo in ipairs(catalog:getAllPhotos()) do
    local path = photo:getRawMetadata("path")
    local normalisedPhotoPath = normalisedPath(path)
    if path and isRaw(path) and (root == "" or normalisedPhotoPath:sub(1, #root) == root) then
      local candidate = { photo = photo, path = path }
      addCandidate(baseName(path), candidate)
      local number = fileNumber(path)
      if number then addCandidate("#" .. number, candidate) end
    end
  end
  -- The RAWs do not have to be imported before synchronising. Search the
  -- selected folder and every subfolder, then import only the files that a
  -- client actually selected. This is much safer than importing a whole shoot.
  for path in LrFileUtils.recursiveFiles(sourceFolder) do
    if isRaw(path) then
      local key = baseName(path)
      local candidates = lookup[key] or {}
      local alreadyKnown = false
      for _, candidate in ipairs(candidates) do
        if normalisedPath(candidate.path) == normalisedPath(path) then alreadyKnown = true; break end
      end
      if not alreadyKnown then
        local candidate = { path = path }
        addCandidate(key, candidate)
        local number = fileNumber(path)
        if number then addCandidate("#" .. number, candidate) end
      end
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

local function downloadedProofCollectionFor(catalog, albumTitle)
  local root = catalog:createCollectionSet("Watermark Vault", nil, true)
  local album = catalog:createCollectionSet(albumTitle or "Album", root, true)
  return catalog:createCollection("Downloaded proof JPEGs", album, true)
end

function M.configure()
  LrTasks.startAsyncTask(function()
    local saved = false
    LrFunctionContext.callWithContext("watermarkVaultConfigure", function(context)
      local f = LrView.osFactory()
      local props = LrBinding.makePropertyTable(context)
      props.serverUrl = prefs.serverUrl or "https://book.zacmclients.photos"
      props.username = prefs.username or ""
      props.password = prefs.password or ""
      props.proofCacheFolder = prefs.proofCacheFolder or ""
      props.applyFiveStars = prefs.applyFiveStars ~= false
      local result = LrDialogs.presentModalDialog {
        title = "Watermark Vault connection",
        actionVerb = "Save & Test connection",
        contents = f:column { bind_to_object = props, spacing = f:control_spacing(),
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
      prefs.serverUrl = trim(props.serverUrl):gsub("/+$", "")
      if prefs.serverUrl ~= "" and not prefs.serverUrl:match("^https?://") then prefs.serverUrl = "https://" .. prefs.serverUrl end
      prefs.username = trim(props.username)
      prefs.password = props.password or ""
      prefs.proofCacheFolder = trim(props.proofCacheFolder)
      prefs.applyFiveStars = props.applyFiveStars == true
      saved = true
    end)
    -- LrHttp yields while it waits for the response. It must run after the
    -- modal dialog's C callback has returned, otherwise Lightroom reports
    -- "Yielding is not allowed within a C or metamethod call".
    if not saved then return end
    local ok, response = LrTasks.pcall(function() return jsonGet("/api/lightroom/albums") end)
    if ok then
      LrDialogs.message("Watermark Vault", string.format("Connected successfully. %d album(s) are available.", #(response.albums or {})))
    else
      LrDialogs.message("Watermark Vault connection failed", tostring(response), "critical")
    end
  end)
end

function M.syncPicks()
  if not requireConfig() then return end
  local sourceFolder = chooseSourceFolder()
  if not sourceFolder then return end
  LrTasks.startAsyncTask(function()
    local ok, message = LrTasks.pcall(function()
      local albumId = chooseAlbum("Sync Watermark Vault client picks")
      if not albumId then return end
      local manifest = jsonGet("/api/lightroom/albums/" .. encodePathSegment(albumId) .. "/picks")
      local catalog = LrApplication.activeCatalog()
      local lookup = photoLookup(catalog, sourceFolder)
      local selected, toImport, unmatched, ambiguous = {}, {}, {}, {}
      local cache = proofCacheFolder()
      for _, asset in ipairs(manifest.assets or {}) do
        if asset.selected then
          downloadProof(asset, LrPathUtils.child(cache, albumId))
          local candidates = lookup[baseName(asset.originalName or asset.proofId)] or {}
          -- Some export presets add text to JPEG names. When that happens,
          -- use the camera file number only if it points to one RAW exactly.
          if #candidates == 0 and asset.originalFileNumber then
            candidates = lookup["#" .. tostring(asset.originalFileNumber)] or {}
          end
          if #candidates == 1 then
            if candidates[1].photo then table.insert(selected, candidates[1].photo)
            else table.insert(toImport, candidates[1]) end
          elseif #candidates == 0 then table.insert(unmatched, asset.originalName or asset.proofId)
          else table.insert(ambiguous, asset.originalName or asset.proofId) end
        end
      end
      catalog:withWriteAccessDo("Watermark Vault sync picks", function()
        for _, candidate in ipairs(toImport) do
          local imported = catalog:addPhoto(candidate.path)
          if imported then table.insert(selected, imported) end
        end
        local keyword = selectedKeyword(catalog, manifest.album.clientName)
        local collection = collectionFor(catalog, manifest.album.title, manifest.album.clientName)
        collection:addPhotos(selected)
        for _, photo in ipairs(selected) do
          photo:addKeyword(keyword)
          if prefs.applyFiveStars ~= false then photo:setRawMetadata("rating", 5) end
        end
      end)
      LrDialogs.message("Watermark Vault", string.format("Synced %d pick(s), including %d newly imported RAW(s), from %s. %d unmatched, %d ambiguous. Matching uses the original filename without its extension; proof JPEGs are cached in %s.", #selected, #toImport, sourceFolder, #unmatched, #ambiguous, cache))
    end)
    if not ok then LrDialogs.message("Watermark Vault sync failed", tostring(message), "critical") end
  end)
end

local function postMultipart(path, fields)
  local body, headers = LrHttp.postMultipart(serverUrl(path), fields, authHeaders(), 60)
  if not body or body == "" then
    local status = headers and headers.status and ("HTTP " .. tostring(headers.status)) or "no response"
    error("Watermark Vault upload returned " .. status)
  end
  if headers and headers.status and (headers.status < 200 or headers.status >= 300) then
    error("Watermark Vault upload returned HTTP " .. tostring(headers.status) .. ": " .. tostring(body):sub(1, 240))
  end
  local result = jsonDecode(body)
  if not result.ok and not result.files then error(result.error or "Upload failed") end
  return result
end

function M.publishProofs()
  if not requireConfig() then return end
  local catalog, photos = LrApplication.activeCatalog(), LrApplication.activeCatalog():getTargetPhotos()
  if #photos == 0 then LrDialogs.message("Watermark Vault", "Select photos first.", "warning"); return end
  LrTasks.startAsyncTask(function()
    local ok, message = LrTasks.pcall(function()
      local albumId = chooseAlbum("Publish selected proof JPEGs")
      if not albumId then return end
      local session = LrExportSession { photosToExport = photos, exportSettings = { LR_format = "JPEG", LR_jpeg_quality = 75, LR_size_doConstrain = true, LR_size_maxWidth = 2000, LR_size_maxHeight = 2000, LR_export_destinationType = "specificFolder", LR_collisionHandling = "overwrite" } }
      local uploaded = 0
      for _, rendition in session:renditions { stopIfCanceled = true } do
        local success, renderedPath = rendition:waitForRender()
        if success then
          postMultipart("/api/upload?albumId=" .. encodePathSegment(albumId), { { name = "photos", filePath = renderedPath } })
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
  local catalog, photos = LrApplication.activeCatalog(), LrApplication.activeCatalog():getTargetPhotos()
  if #photos == 0 then LrDialogs.message("Watermark Vault", "Select the edited photos to upload first.", "warning"); return end
  LrTasks.startAsyncTask(function()
    local ok, message = LrTasks.pcall(function()
      local albumId = chooseAlbum("Upload selected final JPEGs")
      if not albumId then return end
      local manifest = jsonGet("/api/lightroom/albums/" .. encodePathSegment(albumId) .. "/picks")
      local assetsByName = {}
      for _, asset in ipairs(manifest.assets or {}) do assetsByName[baseName(asset.originalName or asset.proofId)] = asset end
      local session = LrExportSession { photosToExport = photos, exportSettings = { LR_format = "JPEG", LR_jpeg_quality = 90, LR_size_doConstrain = false, LR_export_destinationType = "specificFolder", LR_collisionHandling = "overwrite" } }
      local uploaded, unmatched = 0, 0
      for _, rendition in session:renditions { stopIfCanceled = true } do
        local sourcePath = rendition.photo:getRawMetadata("path")
        local asset = assetsByName[baseName(sourcePath)]
        local success, renderedPath = rendition:waitForRender()
        if success and asset then
          postMultipart("/api/lightroom/albums/" .. encodePathSegment(albumId) .. "/finals", {
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

function M.browseAlbums()
  if not requireConfig() then return end
  LrTasks.startAsyncTask(function()
    local ok, message = LrTasks.pcall(function()
      local albumId = chooseAlbum("Browse Watermark Vault albums")
      if not albumId then return end
      local manifest = jsonGet("/api/lightroom/albums/" .. encodePathSegment(albumId) .. "/picks")
      local cache = proofCacheFolder()
      local downloaded, picked = 0, 0
      local paths = {}
      for _, asset in ipairs(manifest.assets or {}) do
        if asset.selected then
          picked = picked + 1
          local proofPath = downloadProof(asset, LrPathUtils.child(cache, albumId))
          if proofPath then
            downloaded = downloaded + 1
            table.insert(paths, proofPath)
          end
        end
      end
      local catalog = LrApplication.activeCatalog()
      local knownByPath, proofPhotos = {}, {}
      for _, photo in ipairs(catalog:getAllPhotos()) do knownByPath[normalisedPath(photo:getRawMetadata("path"))] = photo end
      local collection
      catalog:withWriteAccessDo("Watermark Vault downloaded proofs", function()
        collection = downloadedProofCollectionFor(catalog, manifest.album.title)
        for _, proofPath in ipairs(paths) do
          local photo = knownByPath[normalisedPath(proofPath)]
          if not photo then photo = catalog:addPhoto(proofPath) end
          if photo then table.insert(proofPhotos, photo) end
        end
        collection:addPhotos(proofPhotos)
      end)
      if collection and #proofPhotos > 0 then
        catalog:setActiveSources({ collection })
        catalog:setSelectedPhotos(proofPhotos[1], proofPhotos)
      end
      LrDialogs.message("Watermark Vault", string.format("%s has %d client pick(s). Added %d downloaded proof JPEG(s) to Lightroom collection: Watermark Vault > %s > Downloaded proof JPEGs.", manifest.album.title, picked, #proofPhotos, manifest.album.title))
    end)
    if not ok then LrDialogs.message("Watermark Vault album browser failed", tostring(message), "critical") end
  end)
end

return M
