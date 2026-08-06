# Watermark Vault for Lightroom Classic

Install `WatermarkVault.lrplugin` from Lightroom Classic's **File → Plug-in Manager → Add**.

1. In Watermark Vault, create an album for the client/time slot (for example `Animaga 2026 — Sat 10:00 — Alice`).
2. In the plug-in, choose **Configure connection** and enter the server URL, admin username/password, and proof cache folder. Use HTTPS for any non-local server.
3. Select source images in Lightroom and choose **Publish selected proofs**. Enter the Watermark Vault album ID.
4. After the client submits picks, choose **Sync client picks**. The plug-in downloads selected proof JPEGs, finds matching RAW files already in the Lightroom catalog, creates a per-client collection, adds `Watermark Vault > Client > Selected`, and optionally rates them five stars.
5. Select completed images and choose **Upload selected finals**. Each exported JPEG is matched back to its proof and becomes the gallery's delivered rendition; the original proof is retained for audit/re-proofing.

The first release does not import un-catalogued RAWs: import the shoot's top-level folder into Lightroom first, with **Include Subfolders** enabled. The sync report separates unmatched and ambiguous filenames so no RAW is tagged incorrectly.

`/api/lightroom/albums/:albumId/picks` is the stable manifest contract. It includes the event/session fields, selected status, original filename, proof ID and proof URL so a later plug-in version can add richer time-slot selection and batch final upload without changing photo identity.
