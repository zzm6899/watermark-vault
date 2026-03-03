/**
 * Capacitor plugin for reading photos from a USB-connected camera (Nikon Z6III etc.)
 * using Android's MTP (Media Transfer Protocol) API.
 *
 * SETUP: Copy this file to your Android project at:
 *   android/app/src/main/java/app/lovable/camerausb/CameraUsbPlugin.kt
 *
 * Then register it in MainActivity:
 *   override fun onCreate(savedInstanceState: Bundle?) {
 *       registerPlugin(CameraUsbPlugin::class.java)
 *       super.onCreate(savedInstanceState)
 *   }
 *
 * Required AndroidManifest.xml:
 *   <uses-feature android:name="android.hardware.usb.host" android:required="true" />
 *   <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
 *       android:maxSdkVersion="28" />
 */
package app.lovable.camerausb

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.mtp.MtpConstants
import android.mtp.MtpDevice
import android.mtp.MtpObjectInfo
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import android.util.Base64
import java.io.File
import java.io.FileOutputStream

private const val ACTION_USB_PERMISSION = "app.lovable.camerausb.USB_PERMISSION"

@CapacitorPlugin(name = "CameraUsb")
class CameraUsbPlugin : Plugin() {

    // ── Single shared MTP connection, protected by a dedicated background thread ──
    // ALL MTP calls must go through mtpHandler to avoid thread-safety crashes.
    private val mtpThread = HandlerThread("MtpWorker").also { it.start() }
    private val mtpHandler = Handler(mtpThread.looper)
    private val mainHandler = Handler(Looper.getMainLooper())

    private var mtpDevice: MtpDevice? = null
    private var currentUsbDevice: UsbDevice? = null
    private var watchRunnable: Runnable? = null
    private var lastKnownHandles = mutableSetOf<Int>()
    private var permissionReceiver: BroadcastReceiver? = null

    private val usbManager: UsbManager
        get() = context.getSystemService(Context.USB_SERVICE) as UsbManager

    // ── Run a block on the MTP worker thread, resolve/reject on main thread ──
    private fun runOnMtp(call: PluginCall, block: () -> JSObject) {
        mtpHandler.post {
            try {
                val result = block()
                mainHandler.post { call.resolve(result) }
            } catch (e: Exception) {
                mainHandler.post { call.reject(e.message ?: "Unknown MTP error") }
            }
        }
    }

    // ── Find connected camera (any imaging class or Nikon VID) ──
    private fun findCamera(): UsbDevice? {
        for ((_, device) in usbManager.deviceList) {
            for (i in 0 until device.interfaceCount) {
                if (device.getInterface(i).interfaceClass == 6 /* Still Imaging */) return device
            }
            if (device.vendorId == 0x04B0 /* Nikon */) return device
        }
        return null
    }

    // ── Get or open MTP connection — reuses existing if same device ──
    // MUST be called from mtpHandler thread only.
    private fun getOrOpenMtp(): MtpDevice {
        val camera = findCamera() ?: throw IllegalStateException("No camera connected")

        // Reuse existing connection if it's the same device and still alive
        val existing = mtpDevice
        if (existing != null && currentUsbDevice?.deviceId == camera.deviceId) {
            // Verify connection is still alive with a cheap call
            try {
                existing.storageIds // throws if disconnected
                return existing
            } catch (_: Exception) {
                // Connection died — close and reopen
                try { existing.close() } catch (_: Exception) {}
                mtpDevice = null
                currentUsbDevice = null
            }
        }

        // Close any stale connection
        try { mtpDevice?.close() } catch (_: Exception) {}

        if (!usbManager.hasPermission(camera)) {
            throw SecurityException("USB permission not granted — call requestPermission first")
        }

        val connection = usbManager.openDevice(camera)
            ?: throw IllegalStateException("Failed to open USB device — is camera in MTP/PTP mode?")

        val mtp = MtpDevice(camera)
        if (!mtp.open(connection)) {
            connection.close()
            throw IllegalStateException("Failed to open MTP session — try disconnecting and reconnecting")
        }

        mtpDevice = mtp
        currentUsbDevice = camera
        return mtp
    }

    // ── Collect image handles from all storages ──
    private fun collectImageHandles(mtp: MtpDevice, includeRaw: Boolean): List<Pair<Int, MtpObjectInfo>> {
        val storageIds = mtp.storageIds ?: return emptyList()
        val results = mutableListOf<Pair<Int, MtpObjectInfo>>()

        for (storageId in storageIds) {
            // JPEG
            val jpegHandles = mtp.getObjectHandles(storageId, MtpConstants.FORMAT_EXIF_JPEG, 0) ?: continue
            for (handle in jpegHandles) {
                val info = mtp.getObjectInfo(handle) ?: continue
                results.add(handle to info)
            }
            // RAW/NEF (Nikon uses 0x3800 for raw, 0x3801 for TIFF-based raw)
            if (includeRaw) {
                for (rawFormat in intArrayOf(0x3800, 0x3801, 0x3802)) {
                    val rawHandles = mtp.getObjectHandles(storageId, rawFormat, 0) ?: continue
                    for (handle in rawHandles) {
                        val info = mtp.getObjectInfo(handle) ?: continue
                        results.add(handle to info)
                    }
                }
            }
        }
        return results
    }

    // ── isConnected ──────────────────────────────────────────────────────────
    @PluginMethod
    fun isConnected(call: PluginCall) {
        // This is a fast device-list check — safe on main thread
        val camera = findCamera()
        call.resolve(JSObject().apply {
            put("connected", camera != null)
            put("deviceName", camera?.productName ?: "")
        })
    }

    // ── requestPermission ────────────────────────────────────────────────────
    @PluginMethod
    fun requestPermission(call: PluginCall) {
        val camera = findCamera()
        if (camera == null) {
            call.resolve(JSObject().apply { put("granted", false) })
            return
        }
        if (usbManager.hasPermission(camera)) {
            call.resolve(JSObject().apply { put("granted", true) })
            return
        }

        // Unregister any stale receiver from a previous call
        permissionReceiver?.let {
            try { context.unregisterReceiver(it) } catch (_: Exception) {}
        }

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                try { context.unregisterReceiver(this) } catch (_: Exception) {}
                permissionReceiver = null
                val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                call.resolve(JSObject().apply { put("granted", granted) })
            }
        }
        permissionReceiver = receiver

        // Android 14+ (API 34) forbids FLAG_MUTABLE with implicit intents — must use FLAG_IMMUTABLE
        val flags = PendingIntent.FLAG_IMMUTABLE
        val pi = PendingIntent.getBroadcast(context, 0, Intent(ACTION_USB_PERMISSION), flags)

        if (Build.VERSION.SDK_INT >= 33) {
            context.registerReceiver(receiver, IntentFilter(ACTION_USB_PERMISSION), Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(receiver, IntentFilter(ACTION_USB_PERMISSION))
        }

        usbManager.requestPermission(camera, pi)
    }

    // ── listFiles ────────────────────────────────────────────────────────────
    @PluginMethod
    fun listFiles(call: PluginCall) {
        val limit = call.getInt("limit", 50) ?: 50
        val includeRaw = call.getBoolean("includeRaw", false) ?: false

        runOnMtp(call) {
            val mtp = getOrOpenMtp()
            val storageIds = mtp.storageIds
            if (storageIds == null || storageIds.isEmpty()) {
                throw IllegalStateException("No storage found on camera — make sure camera is on and in MTP mode")
            }

            val allFiles = collectImageHandles(mtp, includeRaw)
            allFiles.sortedByDescending { it.second.dateModified }

            val filesArray = JSArray()
            for ((handle, info) in allFiles.take(limit)) {
                filesArray.put(JSObject().apply {
                    put("handle", handle)
                    put("name", info.name ?: "photo_$handle.jpg")
                    put("mimeType", when (info.format) {
                        MtpConstants.FORMAT_EXIF_JPEG -> "image/jpeg"
                        0x3800, 0x3801 -> "image/x-nikon-nef"
                        else -> "image/jpeg"
                    })
                    put("size", info.compressedSize)
                    put("dateModified", info.dateModified * 1000L)
                })
            }

            JSObject().apply { put("files", filesArray) }
        }
    }

    // ── importFile ───────────────────────────────────────────────────────────
    @PluginMethod
    fun importFile(call: PluginCall) {
        val handle = call.getInt("handle") ?: run { call.reject("Missing handle"); return }
        val fileName = call.getString("fileName") ?: "photo_${System.currentTimeMillis()}.jpg"

        runOnMtp(call) {
            val mtp = getOrOpenMtp()
            val outFile = getOutputFile(fileName)

            // FIX: getObject second param is the SIZE to read, not 0 — use objectInfo.compressedSize
            val info = mtp.getObjectInfo(handle)
                ?: throw IllegalStateException("Could not get object info for handle $handle")
            val data = mtp.getObject(handle, info.compressedSize)
                ?: throw IllegalStateException("Camera returned null data for handle $handle")
            if (data.isEmpty()) throw IllegalStateException("Camera returned empty data — file may still be writing")

            FileOutputStream(outFile).use { it.write(data) }

            JSObject().apply {
                put("uri", "file://${outFile.absolutePath}")
                put("localPath", outFile.absolutePath)
                put("base64", Base64.encodeToString(data, Base64.NO_WRAP))
                put("mimeType", "image/jpeg")
            }
        }
    }

    // ── importFiles ──────────────────────────────────────────────────────────
    @PluginMethod
    fun importFiles(call: PluginCall) {
        val handlesArray = call.getArray("handles") ?: run { call.reject("Missing handles"); return }
        val handles = (0 until handlesArray.length()).mapNotNull {
            try { handlesArray.getInt(it) } catch (_: Exception) { null }
        }

        runOnMtp(call) {
            val mtp = getOrOpenMtp()
            val results = JSArray()
            val errors = mutableListOf<String>()

            for (handle in handles) {
                try {
                    val info = mtp.getObjectInfo(handle)
                        ?: throw IllegalStateException("No object info for handle $handle")
                    val fileName = info.name?.takeIf { it.isNotBlank() }
                        ?: "photo_${handle}_${System.currentTimeMillis()}.jpg"
                    val outFile = getOutputFile(fileName)

                    // FIX: Must pass actual file size, not 0
                    val data = mtp.getObject(handle, info.compressedSize)
                    if (data == null || data.isEmpty()) {
                        errors.add("Empty data for $fileName — skipped")
                        continue
                    }

                    FileOutputStream(outFile).use { it.write(data) }

                    results.put(JSObject().apply {
                        put("handle", handle)
                        put("uri", "file://${outFile.absolutePath}")
                        put("localPath", outFile.absolutePath)
                        put("base64", Base64.encodeToString(data, Base64.NO_WRAP))
                        put("mimeType", "image/jpeg")
                    })
                } catch (e: Exception) {
                    errors.add("handle $handle: ${e.message}")
                    // Continue importing remaining files
                }
            }

            if (errors.isNotEmpty()) {
                android.util.Log.w("CameraUsb", "Import warnings: ${errors.joinToString("; ")}")
            }

            JSObject().apply { put("files", results) }
        }
    }

    // ── startWatching ────────────────────────────────────────────────────────
    @PluginMethod
    fun startWatching(call: PluginCall) {
        val intervalMs = call.getInt("intervalMs", 3000)?.toLong() ?: 3000L

        runOnMtp(call) {
            stopWatchingInternal()

            val mtp = getOrOpenMtp()
            val storageIds = mtp.storageIds
                ?: throw IllegalStateException("No storage on camera")

            // Snapshot current handles so we only report NEW files
            lastKnownHandles.clear()
            for (storageId in storageIds) {
                val handles = mtp.getObjectHandles(storageId, MtpConstants.FORMAT_EXIF_JPEG, 0)
                if (handles != null) lastKnownHandles.addAll(handles.toList())
            }

            // Schedule polling on MTP thread (safe — same thread as all MTP calls)
            val runnable = object : Runnable {
                override fun run() {
                    checkForNewFiles()
                    mtpHandler.postDelayed(this, intervalMs)
                }
            }
            watchRunnable = runnable
            mtpHandler.postDelayed(runnable, intervalMs)

            JSObject()
        }
    }

    // ── stopWatching ─────────────────────────────────────────────────────────
    @PluginMethod
    fun stopWatching(call: PluginCall) {
        // Can call from any thread
        mtpHandler.post {
            stopWatchingInternal()
            mainHandler.post { call.resolve() }
        }
    }

    private fun stopWatchingInternal() {
        watchRunnable?.let { mtpHandler.removeCallbacks(it) }
        watchRunnable = null
    }

    // ── Poll for new files (always runs on mtpHandler thread) ────────────────
    private fun checkForNewFiles() {
        try {
            val mtp = mtpDevice ?: return // camera not open, skip silently
            val storageIds = mtp.storageIds ?: return

            val currentHandles = mutableSetOf<Int>()
            val newFiles = mutableListOf<JSObject>()

            for (storageId in storageIds) {
                val handles = mtp.getObjectHandles(storageId, MtpConstants.FORMAT_EXIF_JPEG, 0) ?: continue
                for (handle in handles) {
                    currentHandles.add(handle)
                    if (!lastKnownHandles.contains(handle)) {
                        val info = mtp.getObjectInfo(handle) ?: continue
                        newFiles.add(JSObject().apply {
                            put("handle", handle)
                            put("name", info.name ?: "photo_$handle.jpg")
                            put("mimeType", "image/jpeg")
                            put("size", info.compressedSize)
                            put("dateModified", info.dateModified * 1000L)
                        })
                    }
                }
            }

            lastKnownHandles = currentHandles

            if (newFiles.isNotEmpty()) {
                val filesArray = JSArray().also { arr -> newFiles.forEach { arr.put(it) } }
                val event = JSObject().apply { put("files", filesArray) }
                mainHandler.post { notifyListeners("newFiles", event) }
            }
        } catch (e: Exception) {
            android.util.Log.w("CameraUsb", "checkForNewFiles error (camera disconnected?): ${e.message}")
            val wasConnected = mtpDevice != null
            try { mtpDevice?.close() } catch (_: Exception) {}
            mtpDevice = null
            currentUsbDevice = null
            if (wasConnected) {
                mainHandler.post { notifyListeners("cameraDisconnected", JSObject()) }
            }
        }
    }

    // ── Output directory helper ───────────────────────────────────────────────
    private fun getOutputFile(fileName: String): File {
        val dir = if (Build.VERSION.SDK_INT >= 29) {
            // Android 10+ — use app-specific external storage (no permission needed)
            File(context.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "CameraCapture")
        } else {
            File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "CameraCapture")
        }
        dir.mkdirs()
        // Avoid overwriting existing files
        var outFile = File(dir, fileName)
        if (outFile.exists()) {
            val base = fileName.substringBeforeLast(".")
            val ext = fileName.substringAfterLast(".", "jpg")
            outFile = File(dir, "${base}_${System.currentTimeMillis()}.$ext")
        }
        return outFile
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    private var usbDetachReceiver: BroadcastReceiver? = null

    override fun handleOnStart() {
        super.handleOnStart()
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                if (intent.action != UsbManager.ACTION_USB_DEVICE_DETACHED) return
                val detached = intent.getParcelableExtra<UsbDevice>(UsbManager.EXTRA_DEVICE) ?: return
                if (currentUsbDevice?.deviceId != detached.deviceId) return
                android.util.Log.i("CameraUsb", "Camera unplugged: ${detached.deviceName}")
                mtpHandler.post {
                    stopWatchingInternal()
                    try { mtpDevice?.close() } catch (_: Exception) {}
                    mtpDevice = null
                    currentUsbDevice = null
                }
                mainHandler.post { notifyListeners("cameraDisconnected", JSObject()) }
            }
        }
        context.registerReceiver(receiver, IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED))
        usbDetachReceiver = receiver
    }

    override fun handleOnDestroy() {
        mtpHandler.post {
            stopWatchingInternal()
            try { mtpDevice?.close() } catch (_: Exception) {}
            mtpDevice = null
            currentUsbDevice = null
        }
        permissionReceiver?.let {
            try { context.unregisterReceiver(it) } catch (_: Exception) {}
            permissionReceiver = null
        }
        usbDetachReceiver?.let {
            try { context.unregisterReceiver(it) } catch (_: Exception) {}
            usbDetachReceiver = null
        }
        super.handleOnDestroy()
    }
}
