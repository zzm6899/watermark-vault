# Watermark Vault for Lightroom Classic (v0.3)

Install `WatermarkVault.lrplugin` from Lightroom Classic's **File → Plug-in Manager → Add**.

The current plug-in defaults to `https://book.zacmclients.photos`, validates every
server response, and keeps album IDs URL-safe when browsing, proofing, or
uploading finals. Use the **Admin → APK → Lightroom Classic plugin** card to
download the current package.

1. In Watermark Vault, create an album for the client/time slot (for example `Animaga 2026 — Sat 10:00 — Alice`).
2. In the plug-in, choose **Configure connection** and enter the server URL, admin username/password, and proof cache folder. Use HTTPS for any non-local server.
3. Choose **Browse albums and download picks** to see all server albums in a Lightroom menu. Each entry shows its client, time slot, photo count and proofing state. Selecting one downloads client-picked proof JPEGs to the configured cache folder.
4. Select source images in Lightroom and choose **Publish selected proofs**. Choose the destination album from the same menu.
5. After the client submits picks, choose **Sync client picks from folder**, then choose the shoot's top-level folder and album. The plug-in searches only catalogued RAW files in that folder and its subfolders, downloads selected proof JPEGs, creates a per-client collection, adds `Watermark Vault > Client > Selected`, and optionally rates them five stars.
5. Select completed images and choose **Upload selected finals**. Each exported JPEG is matched back to its proof and becomes the gallery's delivered rendition; the original proof is retained for audit/re-proofing.

Watermark Vault's server applies its watermark to the proof-gallery rendition. The Lightroom plug-in does not create or change Lightroom-native watermark presets; any native preset remains managed in Lightroom. Final uploads are the Lightroom-rendered JPEGs, and the plug-in does not alter source photos.

Before uploading finals, the plug-in requires a one-to-one match between a selected Lightroom filename stem and one Watermark Vault original filename stem. It lists each stable album asset ID and marks existing finals that will be replaced. Duplicate, missing, or invalid matches are skipped and reported; the server keeps the proof source when replacing a final. Each render or upload failure is reported per photo, successful uploads remain successful, and canceling stops later uploads without retrying an uncertain request.

Client-pick sync searches the chosen folder and subfolders for catalogued and un-catalogued RAWs, then imports only uniquely matched client picks. It does not import the whole shoot. The sync report separates unmatched and ambiguous filenames so no RAW is tagged incorrectly. Lightroom's native **Synchronize Folder…** only rescans the disk; use the Watermark Vault menu command to retrieve client selections.

`/api/lightroom/albums/:albumId/picks` is the stable manifest contract. The plug-in uses its stable asset IDs and original filenames to sync picks and map final JPEGs without changing photo identity.

## Lightroom Classic acceptance checklist

Lua 5.1 syntax parsing, source-contract tests, and seven isolated mock-SDK scenarios passed. The mock harness does not include Lightroom Classic. Before relying on a release, test in a disposable catalog and non-production Watermark Vault album:

- Preflight one unique filename match, one unmatched filename, duplicate stems among selected Lightroom photos, duplicate stems in the album manifest, and a target missing `assetId`. Confirm only the unique match can proceed and its exact asset ID is shown.
- Include an asset with an existing final. Confirm the prompt marks it for replacement and that the proof JPEG remains available after the final upload.
- Publish multiple proofs and verify Lightroom's chosen export watermark behavior, and that Watermark Vault displays its configured proof watermark.
- Cause one render failure and one rejected upload in a test album. Confirm other photos continue, each failure appears in the summary, and no request is retried automatically.
- Cancel during a multi-photo upload. Confirm the current in-flight request is reported by its actual response and later photos are reported as not uploaded.
