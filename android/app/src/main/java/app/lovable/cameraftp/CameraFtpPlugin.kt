package app.lovable.cameraftp

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.LinkAddress
import android.net.LinkProperties
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.webkit.MimeTypeMap
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ThreadLocalRandom
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

private const val TAG = "CameraFtp"
private const val FTP_TRANSFER_BUFFER_SIZE = 256 * 1024

@CapacitorPlugin(name = "CameraFtp")
class CameraFtpPlugin : Plugin() {
    private val running = AtomicBoolean(false)
    private val paused = AtomicBoolean(false)
    private val acceptExecutor = Executors.newSingleThreadExecutor()
    private val clientExecutor = Executors.newCachedThreadPool()
    private val receivedCount = AtomicInteger(0)

    @Volatile private var serverSocket: ServerSocket? = null
    @Volatile private var serverPort: Int = 2121
    @Volatile private var username: String = "camera"
    @Volatile private var password: String = "camera"
    private val clientsLock = Any()
    private val recentClients = LinkedHashMap<String, ClientSnapshot>()

    @PluginMethod
    fun start(call: PluginCall) {
        val requestedPort = call.getInt("port", 2121) ?: 2121
        val requestedUsername = call.getString("username") ?: call.getString("user") ?: "camera"
        val requestedPassword = call.getString("password") ?: call.getString("pass") ?: "camera"

        if (running.get()) {
            val unchanged = requestedPort == serverPort && requestedUsername == username && requestedPassword == password
            if (unchanged) {
                call.resolve(statusObject())
                return
            }
            stopServer()
        }

        serverPort = requestedPort
        username = requestedUsername
        password = requestedPassword
        paused.set(false)

        try {
            val socket = ServerSocket()
            socket.reuseAddress = true
            socket.receiveBufferSize = FTP_TRANSFER_BUFFER_SIZE
            socket.bind(InetSocketAddress(serverPort))
            serverSocket = socket
            running.set(true)
            CameraFtpService.start(context, serverPort)
            acceptExecutor.execute { acceptLoop(socket) }
            call.resolve(statusObject())
        } catch (e: Exception) {
            running.set(false)
            serverSocket = null
            CameraFtpService.stop(context)
            call.reject("Failed to start FTP receiver: ${e.message}")
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        stopServer()
        call.resolve(statusObject())
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        paused.set(true)
        call.resolve(statusObject())
    }

    @PluginMethod
    fun resume(call: PluginCall) {
        paused.set(false)
        call.resolve(statusObject())
    }

    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(statusObject())
    }

    @PluginMethod
    fun getNetworkInfo(call: PluginCall) {
        call.resolve(networkInfoObject())
    }

    @PluginMethod
    fun scanNetwork(call: PluginCall) {
        val timeoutMs = call.getInt("timeoutMs", 3500) ?: 3500
        clientExecutor.execute {
            try {
                val result = scanNetworkForCameras(timeoutMs.coerceIn(1000, 12000))
                activity.runOnUiThread { call.resolve(result) }
            } catch (e: Exception) {
                activity.runOnUiThread { call.reject("Failed to scan network: ${e.message}") }
            }
        }
    }

    @PluginMethod
    fun openHotspotSettings(call: PluginCall) {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_WIRELESS_SETTINGS)
        } else {
            Intent(Settings.ACTION_SETTINGS)
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun deleteLocalFiles(call: PluginCall) {
        val pathsArray = call.getArray("paths") ?: run {
            call.reject("Missing paths")
            return
        }

        var deleted = 0
        for (i in 0 until pathsArray.length()) {
            val path = try { pathsArray.getString(i) } catch (_: Exception) { null } ?: continue
            val file = safeLocalFile(path) ?: continue
            if (file.exists() && file.isFile && file.delete()) deleted++
        }
        call.resolve(JSObject().apply { put("deleted", deleted) })
    }

    @PluginMethod
    fun importFiles(call: PluginCall) {
        val pathsArray = call.getArray("paths") ?: run {
            call.reject("Missing paths")
            return
        }

        clientExecutor.execute {
            try {
                val files = JSArray()
                for (i in 0 until pathsArray.length()) {
                    val path = try { pathsArray.getString(i) } catch (_: Exception) { null } ?: continue
                    val file = safeLocalFile(path) ?: continue
                    if (!file.exists() || !file.isFile) continue

                    files.put(JSObject().apply {
                        put("localPath", file.absolutePath)
                        put("name", file.name)
                        put("base64", encodeFileBase64(file))
                        put("mimeType", mimeTypeFor(file.name))
                        put("size", file.length())
                        put("dateModified", file.lastModified())
                    })
                }
                activity.runOnUiThread {
                    call.resolve(JSObject().apply { put("files", files) })
                }
            } catch (e: Exception) {
                activity.runOnUiThread { call.reject("Failed to import FTP files: ${e.message}") }
            }
        }
    }

    private fun acceptLoop(socket: ServerSocket) {
        while (running.get()) {
            try {
                val client = socket.accept()
                clientExecutor.execute { handleClient(client) }
            } catch (_: SocketTimeoutException) {
                continue
            } catch (_: Exception) {
                if (running.get()) stopServer()
            }
        }
    }

    private fun handleClient(socket: Socket) {
        var authed = false
        var pendingUser: String? = null
        var cwd = "/"
        var pasvSocket: ServerSocket? = null
        val clientIp = socket.inetAddress?.hostAddress ?: socket.remoteSocketAddress?.toString() ?: "unknown"
        Log.i(TAG, "FTP client connected: $clientIp")
        rememberClient(clientIp, emit = true) {
            connected = true
            authState = "connected"
            lastCommand = "CONNECT"
            lastError = null
        }

        socket.use { control ->
            control.soTimeout = 0
            val reader = BufferedReader(InputStreamReader(control.getInputStream(), StandardCharsets.US_ASCII))
            val writer = PrintWriter(control.getOutputStream(), true)
            writer.reply(220, "CameraFtp ready")

            while (running.get()) {
                val line = reader.readLine() ?: break
                val space = line.indexOf(' ')
                val command = if (space >= 0) line.substring(0, space) else line
                val arg = if (space >= 0) line.substring(space + 1).trim() else ""
                val upperCommand = command.uppercase(Locale.US)
                rememberClient(clientIp) {
                    connected = true
                    lastCommand = upperCommand
                }

                when (upperCommand) {
                    "USER" -> {
                        pendingUser = arg
                        rememberClient(clientIp, emit = true) {
                            authState = "user"
                            usernameAttempt = arg
                            lastError = null
                        }
                        writer.reply(331, "Password required")
                    }
                    "PASS" -> {
                        authed = pendingUser == username && arg == password
                        Log.i(TAG, "FTP login ${if (authed) "accepted" else "rejected"} for $clientIp user=${pendingUser ?: ""}")
                        rememberClient(clientIp, emit = true) {
                            authState = if (authed) "logged-in" else "login-failed"
                            lastError = if (authed) null else "Login failed for user ${pendingUser ?: ""}"
                        }
                        writer.reply(if (authed) 230 else 530, if (authed) "Login successful" else "Login incorrect")
                    }
                    "SYST" -> writer.reply(215, "UNIX Type: L8")
                    "FEAT" -> {
                        writer.print("211-Features\r\n")
                        writer.print(" PASV\r\n")
                        writer.print(" EPSV\r\n")
                        writer.print(" UTF8\r\n")
                        writer.print(" SIZE\r\n")
                        writer.print(" MDTM\r\n")
                        writer.print(" MLST type*;size*;modify*;\r\n")
                        writer.print("211 End\r\n")
                        writer.flush()
                    }
                    "PWD" -> ifAuthed(authed, writer) { writer.reply(257, "\"$cwd\"") }
                    "CWD" -> ifAuthed(authed, writer) {
                        cwd = normalizeFtpPath(cwd, arg)
                        writer.reply(250, "Directory changed")
                    }
                    "CDUP" -> ifAuthed(authed, writer) {
                        cwd = normalizeFtpPath(cwd, "..")
                        writer.reply(250, "Directory changed")
                    }
                    "TYPE" -> ifAuthed(authed, writer) { writer.reply(200, "Type set") }
                    "STRU" -> ifAuthed(authed, writer) { writer.reply(200, "Structure set") }
                    "MODE" -> ifAuthed(authed, writer) { writer.reply(200, "Mode set") }
                    "OPTS" -> ifAuthed(authed, writer) { writer.reply(200, "Options accepted") }
                    "ALLO" -> ifAuthed(authed, writer) { writer.reply(200, "Allocation accepted") }
                    "REST" -> ifAuthed(authed, writer) { writer.reply(350, "Restart position accepted") }
                    "MKD" -> ifAuthed(authed, writer) {
                        val dir = outputFileFor(cwd, arg)
                        dir.mkdirs()
                        writer.reply(257, "\"${normalizeFtpPath(cwd, arg)}\" created")
                    }
                    "SIZE" -> ifAuthed(authed, writer) {
                        val file = outputFileFor(cwd, arg)
                        if (file.exists() && file.isFile) writer.reply(213, file.length().toString())
                        else writer.reply(550, "File not found")
                    }
                    "MDTM" -> ifAuthed(authed, writer) {
                        val file = outputFileFor(cwd, arg)
                        if (file.exists() && file.isFile) writer.reply(213, "19700101000000")
                        else writer.reply(550, "File not found")
                    }
                    "NOOP" -> writer.reply(200, "OK")
                    "PASV" -> ifAuthed(authed, writer) {
                        pasvSocket?.closeQuietly()
                        pasvSocket = openPassiveSocketInRange()
                        val dataPort = pasvSocket!!.localPort
                        val host = (control.localAddress as? Inet4Address)?.hostAddress
                            ?: networkInfoObject().getString("hotspotLikelyAddress")
                            ?: bestLocalIpv4()
                        val parts = host.split(".").map { it.toIntOrNull() ?: 0 }
                        writer.reply(227, "Entering Passive Mode (${parts[0]},${parts[1]},${parts[2]},${parts[3]},${dataPort / 256},${dataPort % 256})")
                    }
                    "EPSV" -> ifAuthed(authed, writer) {
                        pasvSocket?.closeQuietly()
                        pasvSocket = openPassiveSocketInRange()
                        writer.reply(229, "Entering Extended Passive Mode (|||${pasvSocket!!.localPort}|)")
                    }
                    "LIST", "NLST", "MLSD" -> ifAuthed(authed, writer) {
                        val dataServer = pasvSocket
                        if (dataServer == null) {
                            writer.reply(425, "Use PASV first")
                            return@ifAuthed
                        }
                        writer.reply(150, "Opening data connection")
                        try {
                            sendDirectoryList(dataServer, command.uppercase(Locale.US))
                            writer.reply(226, "Directory send OK")
                        } catch (_: Exception) {
                            writer.reply(451, "Directory send failed")
                        } finally {
                            pasvSocket?.closeQuietly()
                            pasvSocket = null
                        }
                    }
                    "PORT", "EPRT" -> ifAuthed(authed, writer) {
                        rememberClient(clientIp, emit = true) {
                            lastError = "Camera requested active FTP. Enable PASV mode on the camera."
                        }
                        writer.reply(502, "Active mode not supported; enable PASV on camera")
                    }
                    "STOR" -> ifAuthed(authed, writer) {
                        if (paused.get()) {
                            rememberClient(clientIp, emit = true) {
                                lastError = "Receiver paused"
                            }
                            writer.reply(450, "Receiver paused")
                            return@ifAuthed
                        }
                        val dataServer = pasvSocket
                        if (dataServer == null) {
                            rememberClient(clientIp, emit = true) {
                                lastError = "Camera tried to send without PASV"
                            }
                            writer.reply(425, "Use PASV first")
                            return@ifAuthed
                        }
                        val target = outputFileFor(cwd, arg)
                        rememberClient(clientIp, emit = true) {
                            authState = "transferring"
                            lastTransferName = target.name
                            lastError = null
                        }
                        writer.reply(150, "Opening data connection")
                        try {
                            receiveFile(dataServer, target)
                            val fileEvent = fileObject(target)
                            receivedCount.incrementAndGet()
                            activity.runOnUiThread {
                                notifyListeners("newFiles", JSObject().apply {
                                    put("files", JSArray().apply { put(fileEvent) })
                                })
                            }
                            Log.i(TAG, "Stored ${target.name} from $clientIp (${target.length()} bytes)")
                            rememberClient(clientIp, emit = true) {
                                authState = "logged-in"
                                filesReceived += 1
                                lastTransferName = target.name
                                lastTransferBytes = target.length()
                                lastTransferAt = System.currentTimeMillis()
                                lastError = null
                            }
                            writer.reply(226, "Transfer complete")
                        } catch (e: Exception) {
                            target.delete()
                            Log.w(TAG, "Transfer failed from $clientIp: ${e.message}")
                            rememberClient(clientIp, emit = true) {
                                authState = if (authed) "logged-in" else authState
                                lastError = "Transfer failed: ${e.message ?: "unknown error"}"
                            }
                            writer.reply(451, "Transfer failed")
                        } finally {
                            pasvSocket?.closeQuietly()
                            pasvSocket = null
                        }
                    }
                    "QUIT" -> {
                        writer.reply(221, "Goodbye")
                        break
                    }
                    else -> writer.reply(502, "Command not implemented")
                }
            }
        }
        Log.i(TAG, "FTP client disconnected: $clientIp")
        rememberClient(clientIp, emit = true) {
            connected = false
            lastCommand = "DISCONNECT"
        }
        pasvSocket?.closeQuietly()
    }

    private fun ifAuthed(authed: Boolean, writer: PrintWriter, block: () -> Unit) {
        if (!authed) {
            writer.reply(530, "Not logged in")
            return
        }
        block()
    }

    private fun receiveFile(dataServer: ServerSocket, target: File) {
        dataServer.soTimeout = 60000
        target.parentFile?.mkdirs()
        dataServer.accept().use { dataSocket ->
            dataSocket.tcpNoDelay = true
            dataSocket.receiveBufferSize = FTP_TRANSFER_BUFFER_SIZE
            BufferedInputStream(dataSocket.getInputStream(), FTP_TRANSFER_BUFFER_SIZE).use { input ->
                BufferedOutputStream(FileOutputStream(target), FTP_TRANSFER_BUFFER_SIZE).use { output ->
                    val buffer = ByteArray(FTP_TRANSFER_BUFFER_SIZE)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                    }
                }
            }
        }
    }

    private fun sendDirectoryList(dataServer: ServerSocket, command: String) {
        dataServer.soTimeout = 30000
        dataServer.accept().use { dataSocket ->
            dataSocket.tcpNoDelay = true
            BufferedOutputStream(dataSocket.getOutputStream(), FTP_TRANSFER_BUFFER_SIZE).use { output ->
                val listing = when (command) {
                    "MLSD" -> ""
                    "NLST" -> ""
                    else -> ""
                }
                output.write(listing.toByteArray(StandardCharsets.UTF_8))
                output.flush()
            }
        }
    }

    private fun openPassiveSocketInRange(): ServerSocket {
        repeat(24) {
            val port = ThreadLocalRandom.current().nextInt(32768, 61001)
            try {
                val socket = ServerSocket()
                socket.reuseAddress = true
                socket.receiveBufferSize = FTP_TRANSFER_BUFFER_SIZE
                socket.bind(InetSocketAddress(port))
                return socket
            } catch (_: Exception) {
                // Try another Nikon-friendly passive port.
            }
        }
        return ServerSocket().apply {
            reuseAddress = true
            receiveBufferSize = FTP_TRANSFER_BUFFER_SIZE
            bind(InetSocketAddress(0))
        }
    }

    private fun statusObject(): JSObject {
        val networkInfo = networkInfoObject()
        val preferredIp = networkInfo.getString("hotspotLikelyAddress")
            ?: networkInfo.getString("ipAddress")
            ?: bestLocalIpv4()
        val clients = clientSnapshots()
        val latestClient = clients.firstOrNull()
        return JSObject().apply {
            put("running", running.get())
            put("paused", paused.get())
            put("host", preferredIp)
            put("ipAddress", preferredIp)
            put("port", serverPort)
            put("username", username)
            put("password", password)
            put("receivedCount", receivedCount.get())
            put("root", ftpRoot().absolutePath)
            put("network", networkInfo)
            put("activeClientCount", clients.count { it.connected })
            put("clients", JSArray().apply { clients.forEach { put(it.toJson()) } })
            if (latestClient != null) {
                put("lastClientAddress", latestClient.ipAddress)
                put("lastClientStatus", latestClient.authState)
                put("lastCommand", latestClient.lastCommand)
                if (latestClient.lastError != null) put("lastError", latestClient.lastError)
            }
        }
    }

    private fun networkInfoObject(): JSObject {
        val addresses = localIpv4Addresses()
        val hotspotIp = addresses.firstOrNull { it.interfaceName.startsWith("wlan") && it.address.startsWith("10.") }
            ?: addresses.firstOrNull { it.interfaceName.startsWith("swlan") || it.interfaceName.startsWith("ap") }
            ?: addresses.firstOrNull { it.address.startsWith("192.168.43.") || it.address.startsWith("172.20.10.") || it.address.startsWith("10.") }
        val activeIp = bestLocalIpv4()
        val ip = hotspotIp?.address ?: activeIp
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork
        val caps = if (network != null) cm.getNetworkCapabilities(network) else null
        return JSObject().apply {
            put("ipAddress", ip)
            put("activeIpAddress", activeIp)
            if (hotspotIp != null) put("hotspotLikelyAddress", hotspotIp.address)
            put("addresses", JSArray().apply {
                val ordered = addresses.sortedWith(compareByDescending<Ipv4Candidate> { it.address == ip }
                    .thenByDescending { it.address.startsWith("10.") }
                    .thenBy { it.interfaceName })
                ordered.forEach { put(it.address) }
            })
            put("interfaces", JSArray().apply {
                addresses.forEach { candidate ->
                    put(JSObject().apply {
                        put("name", candidate.interfaceName)
                        put("address", candidate.address)
                    })
                }
            })
            put("port", serverPort)
            put("ftpUrl", "ftp://$ip:$serverPort/")
            put("isWifi", caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true)
            put("isCellular", caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true)
            put("isEthernet", caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true)
        }
    }

    private fun bestLocalIpv4(): String {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val active = cm.activeNetwork
        val linkProperties: LinkProperties? = if (active != null) cm.getLinkProperties(active) else null
        val activeAddress = linkProperties?.linkAddresses?.firstIpv4()
        if (activeAddress != null) return activeAddress

        val interfaces = NetworkInterface.getNetworkInterfaces()
        for (networkInterface in interfaces) {
            if (!networkInterface.isUp || networkInterface.isLoopback) continue
            val addresses = networkInterface.inetAddresses
            for (address in addresses) {
                if (address is Inet4Address && !address.isLoopbackAddress) return address.hostAddress ?: "0.0.0.0"
            }
        }
        return "0.0.0.0"
    }

    private data class Ipv4Candidate(val interfaceName: String, val address: String)

    private fun scanNetworkForCameras(timeoutMs: Int): JSObject {
        val networkInfo = networkInfoObject()
        val serverHost = networkInfo.getString("hotspotLikelyAddress")
            ?: networkInfo.getString("ipAddress")
            ?: bestLocalIpv4()
        val local = localIpv4Addresses().firstOrNull { it.address == serverHost }
            ?: localIpv4Addresses().firstOrNull()
        val prefix = serverHost.substringBeforeLast('.', missingDelimiterValue = "")
        val discovered = ConcurrentHashMap<String, ArpCandidate>()
        recentClientCandidates(prefix).forEach { discovered[it.ipAddress] = it }
        if (local != null && prefix.isNotBlank()) {
            val networkInterface = try {
                NetworkInterface.getByInetAddress(InetAddress.getByName(local.address))
            } catch (_: Exception) {
                null
            }
            val probePool = Executors.newFixedThreadPool(32)
            for (host in 1..254) {
                val ip = "$prefix.$host"
                if (ip == local.address) continue
                probePool.execute {
                    try {
                        if (InetAddress.getByName(ip).isReachable(networkInterface, 64, 220)) {
                            discovered[ip] = ArpCandidate(ip, "", local.interfaceName)
                        }
                    } catch (_: Exception) {
                        // Ignore unreachable hosts; a completed probe is enough to refresh ARP.
                    }
                }
            }
            probePool.shutdown()
            probePool.awaitTermination(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            probePool.shutdownNow()
        }

        readArpCandidates(prefix).forEach { discovered[it.ipAddress] = it }
        val candidates = discovered.values.sortedBy { it.ipAddress }
        return JSObject().apply {
            put("serverHost", serverHost)
            put("serverPort", serverPort)
            put("subnet", if (prefix.isNotBlank()) "$prefix.0/24" else "")
            put("candidates", JSArray().apply {
                candidates.forEach { candidate ->
                    put(JSObject().apply {
                        put("ipAddress", candidate.ipAddress)
                        put("macAddress", candidate.macAddress)
                        put("interfaceName", candidate.interfaceName)
                        put("label", "Camera or network device")
                    })
                }
            })
        }
    }

    private data class ArpCandidate(val ipAddress: String, val macAddress: String, val interfaceName: String)

    private fun readArpCandidates(prefix: String): List<ArpCandidate> {
        return try {
            File("/proc/net/arp").readLines()
                .drop(1)
                .mapNotNull { line ->
                    val parts = line.trim().split(Regex("\\s+"))
                    if (parts.size < 6) return@mapNotNull null
                    val ip = parts[0]
                    val mac = parts[3]
                    val iface = parts[5]
                    if (prefix.isNotBlank() && !ip.startsWith("$prefix.")) return@mapNotNull null
                    if (mac == "00:00:00:00:00:00") return@mapNotNull null
                    ArpCandidate(ip, mac, iface)
                }
                .distinctBy { it.ipAddress }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private data class ClientSnapshot(
        val ipAddress: String,
        val firstSeen: Long,
        var lastSeen: Long,
        var connected: Boolean = false,
        var authState: String = "connected",
        var usernameAttempt: String? = null,
        var lastCommand: String? = null,
        var lastError: String? = null,
        var filesReceived: Int = 0,
        var lastTransferName: String? = null,
        var lastTransferBytes: Long? = null,
        var lastTransferAt: Long? = null
    ) {
        fun toJson(): JSObject {
            return JSObject().apply {
                put("ipAddress", ipAddress)
                put("firstSeen", firstSeen)
                put("lastSeen", lastSeen)
                put("connected", connected)
                put("authState", authState)
                if (usernameAttempt != null) put("usernameAttempt", usernameAttempt)
                if (lastCommand != null) put("lastCommand", lastCommand)
                if (lastError != null) put("lastError", lastError)
                put("filesReceived", filesReceived)
                if (lastTransferName != null) put("lastTransferName", lastTransferName)
                if (lastTransferBytes != null) put("lastTransferBytes", lastTransferBytes)
                if (lastTransferAt != null) put("lastTransferAt", lastTransferAt)
            }
        }
    }

    private fun rememberClient(ipAddress: String, emit: Boolean = false, update: ClientSnapshot.() -> Unit = {}) {
        if (ipAddress.isBlank() || ipAddress == "unknown") return
        val now = System.currentTimeMillis()
        synchronized(clientsLock) {
            val snapshot = recentClients[ipAddress] ?: ClientSnapshot(
                ipAddress = ipAddress,
                firstSeen = now,
                lastSeen = now
            ).also { recentClients[ipAddress] = it }
            snapshot.lastSeen = now
            snapshot.update()
            while (recentClients.size > 12) {
                val oldest = recentClients.entries.minByOrNull { it.value.lastSeen }?.key ?: break
                recentClients.remove(oldest)
            }
        }
        if (emit) emitStatusChanged()
    }

    private fun clientSnapshots(): List<ClientSnapshot> {
        return synchronized(clientsLock) {
            recentClients.values
                .map { it.copy() }
                .sortedWith(compareByDescending<ClientSnapshot> { it.connected }.thenByDescending { it.lastSeen })
        }
    }

    private fun emitStatusChanged() {
        try {
            activity.runOnUiThread {
                notifyListeners("statusChanged", statusObject())
            }
        } catch (_: Exception) {
            // Status updates are best-effort diagnostics.
        }
    }

    private fun recentClientCandidates(prefix: String): List<ArpCandidate> {
        return clientSnapshots()
            .filter { prefix.isBlank() || it.ipAddress.startsWith("$prefix.") }
            .map { ArpCandidate(it.ipAddress, "", "ftp") }
    }

    private fun localIpv4Addresses(): List<Ipv4Candidate> {
        val result = mutableListOf<Ipv4Candidate>()
        val interfaces = NetworkInterface.getNetworkInterfaces()
        for (networkInterface in interfaces) {
            if (!networkInterface.isUp || networkInterface.isLoopback) continue
            val addresses = networkInterface.inetAddresses
            for (address in addresses) {
                if (address is Inet4Address && !address.isLoopbackAddress) {
                    val host = address.hostAddress ?: continue
                    result.add(Ipv4Candidate(networkInterface.name, host))
                }
            }
        }
        return result.distinctBy { it.address }
    }

    private fun List<LinkAddress>.firstIpv4(): String? {
        for (address in this) {
            val inet = address.address
            if (inet is Inet4Address && !inet.isLoopbackAddress) return inet.hostAddress
        }
        return null
    }

    private fun ftpRoot(): File {
        return File(context.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "CameraFtp").apply {
            mkdirs()
        }
    }

    private fun outputFileFor(cwd: String, remoteName: String): File {
        val relative = normalizeFtpPath(cwd, remoteName).trimStart('/')
        val sanitized = relative
            .split("/")
            .filter { it.isNotBlank() && it != "." && it != ".." }
            .joinToString(File.separator) { sanitizeName(it) }
            .ifBlank { "upload_${System.currentTimeMillis()}" }
        var outFile = File(ftpRoot(), sanitized).canonicalFile
        val root = ftpRoot().canonicalFile
        if (!outFile.path.startsWith(root.path + File.separator) && outFile.path != root.path) {
            outFile = File(root, sanitizeName(File(remoteName).name)).canonicalFile
        }
        if (outFile.exists()) {
            val name = outFile.name
            val dot = name.lastIndexOf('.')
            val base = if (dot > 0) name.substring(0, dot) else name
            val ext = if (dot > 0) name.substring(dot) else ""
            outFile = File(outFile.parentFile, "${base}_${System.currentTimeMillis()}$ext")
        }
        return outFile
    }

    private fun safeLocalFile(path: String): File? {
        val root = ftpRoot().canonicalFile
        val file = File(path).canonicalFile
        return if (file.path == root.path || file.path.startsWith(root.path + File.separator)) file else null
    }

    private fun normalizeFtpPath(cwd: String, arg: String): String {
        val raw = if (arg.startsWith("/")) arg else "$cwd/$arg"
        val parts = ArrayDeque<String>()
        for (part in raw.split("/")) {
            when {
                part.isBlank() || part == "." -> Unit
                part == ".." -> if (parts.isNotEmpty()) parts.removeLast()
                else -> parts.addLast(part)
            }
        }
        return "/" + parts.joinToString("/")
    }

    private fun sanitizeName(name: String): String {
        return name.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]"), "_")
    }

    private fun fileObject(file: File): JSObject {
        return JSObject().apply {
            put("localPath", file.absolutePath)
            put("path", file.absolutePath)
            put("name", file.name)
            put("mimeType", mimeTypeFor(file.name))
            put("size", file.length())
            put("dateModified", file.lastModified())
        }
    }

    private fun mimeTypeFor(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase(Locale.US)
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
            ?: when (ext) {
                "jpg", "jpeg" -> "image/jpeg"
                "nef" -> "image/x-nikon-nef"
                "cr2" -> "image/x-canon-cr2"
                "cr3" -> "image/x-canon-cr3"
                "arw" -> "image/x-sony-arw"
                "dng" -> "image/dng"
                else -> "application/octet-stream"
            }
    }

    private fun encodeFileBase64(file: File): String {
        ByteArrayOutputStream().use { output ->
            FileInputStream(file).use { input ->
                android.util.Base64OutputStream(output, Base64.NO_WRAP).use { b64 ->
                    val buffer = ByteArray(FTP_TRANSFER_BUFFER_SIZE)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        b64.write(buffer, 0, read)
                    }
                }
            }
            return output.toString("US-ASCII")
        }
    }

    private fun PrintWriter.reply(code: Int, message: String) {
        print("$code $message\r\n")
        flush()
    }

    private fun ServerSocket.closeQuietly() {
        try { close() } catch (_: Exception) {}
    }

    private fun stopServer() {
        running.set(false)
        paused.set(false)
        serverSocket?.closeQuietly()
        serverSocket = null
        CameraFtpService.stop(context)
    }

    override fun handleOnDestroy() {
        stopServer()
        clientExecutor.shutdownNow()
        acceptExecutor.shutdownNow()
        super.handleOnDestroy()
    }
}
