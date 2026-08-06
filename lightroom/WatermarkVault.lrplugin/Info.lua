return {
  LrSdkVersion = 6.0,
  LrSdkMinimumVersion = 6.0,
  LrToolkitIdentifier = "com.watermarkvault.lightroomclassic",
  LrPluginName = "Watermark Vault",
  LrPluginInfoUrl = "https://watermark-vault.local/lightroom",
  LrLibraryMenuItems = {
    { title = "Watermark Vault: Configure connection", file = "Configure.lua" },
    { title = "Watermark Vault: Publish selected proofs", file = "PublishProofs.lua" },
    { title = "Watermark Vault: Sync client picks from folder", file = "SyncPicks.lua" },
    { title = "Watermark Vault: Upload selected finals", file = "UploadFinals.lua" },
  },
  VERSION = { major = 0, minor = 1, revision = 0, build = 1 },
}
