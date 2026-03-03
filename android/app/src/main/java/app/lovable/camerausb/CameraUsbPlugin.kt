/**
 * Capacitor plugin for reading photos from a USB-connected camera (Nikon Z6III etc.)
 * using Android's MTP (Media Transfer Protocol) API.
 *
 * SETUP: Copy this file to your Android project at:
 *   android/app/src/main/java/app/lovable/camerausb/CameraUsbPlugin.kt
 *
 * Then register it in your MainActivity.java:
 *   public void onCreate(Bundle savedInstanceState) {
 *       registerPlugin(CameraUsbPlugin.class);
 *       super.onCreate(savedInstanceState);
 *   }
 *
 * Required AndroidManifest.xml additions:
 *   <uses-feature android:name="android.hardware.usb.host" android:required="true" />
 *   <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
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
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.util.Timer
import java.util.TimerTask

private const val ACTION_USB_PERMISSION = "app.lovable.camerausb.USB_PERMISSION"

@CapacitorPlugin(name = "CameraUsb")
class CameraUsbPlugin : Plugin() {

    private var mtpDevice: MtpDevice? = null
    private var usbDevice: UsbDevice? = null
    private var watchTimer: Timer? = null
    private var lastKnownHandles = mutableSetOf<Int>()

    private val usbManager: UsbManager
        get() = context.getSystemService(Context.USB_SERVICE) as UsbManager

    // ── Find connected camera ──
    private fun findCamera(): UsbDevice? {
        val devices = usbManager.deviceList
        for ((_, device) in devices) {
            // Nikon vendor ID = 0x04B0, but accept any imaging class device
            if ((device.interfaceCount > 0 && device.getInterface(0).interfaceClass == 6 /* Imaging */)
                || device.vendorId == 0x04B0 /* Nikon */
            ) {
                return device
            }
        }
        return null
    }

    private fun openMtpDevice(device: UsbDevice): MtpDevice? {
        val connection = usbManager.openDevice(device) ?: return null
        val mtp = MtpDevice(device)
        return if (mtp.open(connection)) mtp else null
    }

    // ── Plugin Methods ──

    @PluginMethod
    fun isConnected(call: PluginCall) {
        val camera = findCamera()
        val ret = JSObject()
        ret.put("connected", camera != null)
        ret.put("deviceName", camera?.productName ?: "")
        call.resolve(ret)
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        val camera = findCamera()
        if (camera == null) {
            val ret = JSObject()
            ret.put("granted", false)
            call.resolve(ret)
            return
        }

        if (usbManager.hasPermission(camera)) {
            val ret = JSObject()
            ret.put("granted", true)
            call.resolve(ret)
            return
        }

        val permissionIntent = PendingIntent.getBroadcast(
            context, 0,
            Intent(ACTION_USB_PERMISSION),
            if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
        )

        val filter = IntentFilter(ACTION_USB_PERMISSION)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                context.unregisterReceiver(this)
                val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                val ret = JSObject()
                ret.put("granted", granted)
                call.resolve(ret)
            }
        }

        if (Build.VERSION.SDK_INT >= 33) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }

        usbManager.requestPermission(camera, permissionIntent)
    }

    @PluginMethod
    fun listFiles(call: PluginCall) {
        val limit = call.getInt("limit", 50) ?: 50

        val camera = findCamera()
        if (camera == null) {
            call.reject("No camera connected")
            return
        }

        if (!usbManager.hasPermission(camera)) {
            call.reject("USB permission not granted")
            return
        }

        try {
            val mtp = openMtpDevice(camera)
            if (mtp == null) {
                call.reject("Failed to open MTP device")
                return
            }

            mtpDevice = mtp
            usbDevice = camera

            val storageIds = mtp.storageIds
            if (storageIds == null || storageIds.isEmpty()) {
                call.reject("No storage found on camera")
                mtp.close()
                return
            }

            // Collect all image files across storages
            data class MtpFile(val handle: Int, val info: MtpObjectInfo)
            val allFiles = mutableListOf<MtpFile>()

            for (storageId in storageIds) {
                val handles = mtp.getObjectHandles(storageId, MtpConstants.FORMAT_EXIF_JPEG, 0)
                    ?: continue
                for (handle in handles) {
                    val info = mtp.getObjectInfo(handle) ?: continue
                    allFiles.add(MtpFile(handle, info))
                }
                // Also get NEF/RAW files
                val rawHandles = mtp.getObjectHandles(storageId, 0x3801 /* TIFF */, 0)
                    ?: continue
                for (handle in rawHandles) {
                    val info = mtp.getObjectInfo(handle) ?: continue
                    allFiles.add(MtpFile(handle, info))
                }
            }

            // Sort by date modified descending (newest first)
            allFiles.sortByDescending { it.info.dateModified }

            val filesArray = JSArray()
            for (file in allFiles.take(limit)) {
                val obj = JSObject()
                obj.put("handle", file.handle)
                obj.put("name", file.info.name)
                obj.put("mimeType", when (file.info.format) {
                    MtpConstants.FORMAT_EXIF_JPEG -> "image/jpeg"
                    0x3801 -> "image/x-nikon-nef"
                    else -> "image/jpeg"
                })
                obj.put("size", file.info.compressedSize)
                obj.put("dateModified", file.info.dateModified * 1000L)
                filesArray.put(obj)
            }

            val ret = JSObject()
            ret.put("files", filesArray)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Error listing files: ${e.message}")
        }
    }

    @PluginMethod
    fun importFile(call: PluginCall) {
        val handle = call.getInt("handle")
        val fileName = call.getString("fileName") ?: "photo_${System.currentTimeMillis()}.jpg"

        if (handle == null) {
            call.reject("Missing handle")
            return
        }

        try {
            val mtp = mtpDevice ?: run {
                val camera = findCamera() ?: run { call.reject("No camera"); return }
                openMtpDevice(camera) ?: run { call.reject("Failed to open device"); return }
            }

            val dir = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                "CameraCapture"
            )
            dir.mkdirs()

            val outFile = File(dir, fileName)
            val data = mtp.getObject(handle, 0) ?: run {
                call.reject("Failed to read file from camera")
                return
            }

            FileOutputStream(outFile).use { it.write(data) }

            val ret = JSObject()
            ret.put("uri", "file://${outFile.absolutePath}")
            ret.put("localPath", outFile.absolutePath)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Import error: ${e.message}")
        }
    }

    @PluginMethod
    fun importFiles(call: PluginCall) {
        val handlesArray = call.getArray("handles") ?: run {
            call.reject("Missing handles")
            return
        }

        val handles = (0 until handlesArray.length()).map { handlesArray.getInt(it) }
        val results = JSArray()

        val mtp = mtpDevice ?: run {
            val camera = findCamera() ?: run { call.reject("No camera"); return }
            openMtpDevice(camera) ?: run { call.reject("Failed to open device"); return }
        }

        val dir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
            "CameraCapture"
        )
        dir.mkdirs()

        for (handle in handles) {
            try {
                val info = mtp.getObjectInfo(handle)
                val fileName = info?.name ?: "photo_${handle}_${System.currentTimeMillis()}.jpg"
                val outFile = File(dir, fileName)
                val data = mtp.getObject(handle, 0) ?: continue

                FileOutputStream(outFile).use { it.write(data) }

                val obj = JSObject()
                obj.put("handle", handle)
                obj.put("uri", "file://${outFile.absolutePath}")
                obj.put("localPath", outFile.absolutePath)
                results.put(obj)
            } catch (e: Exception) {
                // Skip failed files, continue importing
            }
        }

        val ret = JSObject()
        ret.put("files", results)
        call.resolve(ret)
    }

    @PluginMethod
    fun startWatching(call: PluginCall) {
        val intervalMs = call.getInt("intervalMs", 3000)?.toLong() ?: 3000L

        stopWatchingInternal()

        // Snapshot current handles
        try {
            val camera = findCamera() ?: run { call.reject("No camera"); return }
            val mtp = mtpDevice ?: openMtpDevice(camera) ?: run { call.reject("Failed to open"); return }
            mtpDevice = mtp

            val storageIds = mtp.storageIds ?: run { call.reject("No storage"); return }
            lastKnownHandles.clear()
            for (storageId in storageIds) {
                val handles = mtp.getObjectHandles(storageId, MtpConstants.FORMAT_EXIF_JPEG, 0)
                if (handles != null) lastKnownHandles.addAll(handles.toList())
            }
        } catch (e: Exception) {
            call.reject("Error starting watch: ${e.message}")
            return
        }

        watchTimer = Timer()
        watchTimer?.schedule(object : TimerTask() {
            override fun run() {
                checkForNewFiles()
            }
        }, intervalMs, intervalMs)

        call.resolve()
    }

    @PluginMethod
    fun stopWatching(call: PluginCall) {
        stopWatchingInternal()
        call.resolve()
    }

    private fun stopWatchingInternal() {
        watchTimer?.cancel()
        watchTimer = null
    }

    private fun checkForNewFiles() {
        try {
            val mtp = mtpDevice ?: return
            val storageIds = mtp.storageIds ?: return

            val currentHandles = mutableSetOf<Int>()
            val newFiles = mutableListOf<JSObject>()

            for (storageId in storageIds) {
                val handles = mtp.getObjectHandles(storageId, MtpConstants.FORMAT_EXIF_JPEG, 0)
                    ?: continue
                for (handle in handles) {
                    currentHandles.add(handle)
                    if (!lastKnownHandles.contains(handle)) {
                        val info = mtp.getObjectInfo(handle) ?: continue
                        val obj = JSObject()
                        obj.put("handle", handle)
                        obj.put("name", info.name)
                        obj.put("mimeType", "image/jpeg")
                        obj.put("size", info.compressedSize)
                        obj.put("dateModified", info.dateModified * 1000L)
                        newFiles.add(obj)
                    }
                }
            }

            lastKnownHandles = currentHandles

            if (newFiles.isNotEmpty()) {
                val event = JSObject()
                val filesArray = JSArray()
                newFiles.forEach { filesArray.put(it) }
                event.put("files", filesArray)
                notifyListeners("newFiles", event)
            }
        } catch (e: Exception) {
            // Camera may have been disconnected
        }
    }

    override fun handleOnDestroy() {
        stopWatchingInternal()
        mtpDevice?.close()
        mtpDevice = null
        super.handleOnDestroy()
    }
}
