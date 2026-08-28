# Watermark Vault for Lightroom Classic (v0.2)

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

The first release does not import un-catalogued RAWs: import the shoot's top-level folder into Lightroom first, with **Include Subfolders** enabled. The sync report separates unmatched and ambiguous filenames so no RAW is tagged incorrectly. Lightroom's native **Synchronize Folder…** only rescans the disk; use the Watermark Vault menu command to retrieve client selections.

`/api/lightroom/albums/:albumId/picks` is the stable manifest contract. It includes the event/session fields, selected status, original filename, proof ID and proof URL so a later plug-in version can add richer time-slot selection and batch final upload without changing photo identity.
