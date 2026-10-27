package com.danaqris.bridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class BridgeForegroundService : Service() {

    companion object {
        private const val CHANNEL_ID = "dana_qris_bridge_channel"
        private const val NOTIF_ID = 2020

        @Volatile
        private var instance: BridgeForegroundService? = null

        fun startOrReconnect(context: Context) {
            try {
                val intent = Intent(context.applicationContext, BridgeForegroundService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.applicationContext.startForegroundService(intent)
                } else {
                    context.applicationContext.startService(intent)
                }
            } catch (t: Throwable) {
                BridgeState.appendLog("[System] Gagal memulai service: ${t.message}")
            }
        }

        fun forceReconnectNow(context: Context) {
            val svc = instance
            if (svc != null) {
                svc.reconnectImmediately()
            } else {
                startOrReconnect(context)
            }
        }

        fun dispatchDanaNotification(
            context: Context,
            pkg: String,
            title: String,
            text: String,
            amount: String
        ) {
            val svc = instance
            if (svc != null) {
                svc.sendPaymentNotification(pkg, title, text, amount)
            } else {
                startOrReconnect(context)
                Executors.newSingleThreadExecutor().execute {
                    sendHttpNotificationFallback(context, pkg, title, text, amount)
                }
            }
        }

        private fun sendHttpNotificationFallback(
            context: Context,
            pkg: String,
            title: String,
            text: String,
            amount: String
        ) {
            val ip = BridgePrefs.getServerIp(context)
            val port = BridgePrefs.getServerPort(context)
            if (ip.isBlank()) return

            try {
                val client = OkHttpClient.Builder()
                    .connectTimeout(6, TimeUnit.SECONDS)
                    .readTimeout(6, TimeUnit.SECONDS)
                    .build()

                val json = JSONObject().apply {
                    put("deviceId", BridgePrefs.getDeviceId(context))
                    put("pairCode", BridgePrefs.getPairCode(context))
                    put("pkg", pkg)
                    put("title", title)
                    put("text", text)
                    put("amount", amount)
                }

                val req = Request.Builder()
                    .url("http://$ip:$port/notify")
                    .post(json.toString().toRequestBody("application/json".toMediaType()))
                    .build()

                client.newCall(req).execute().use { resp ->
                    val bodyStr = resp.body?.string() ?: ""
                    BridgeState.appendLog("[HTTP] Notifikasi terkirim (Rp$amount) -> HTTP ${resp.code}")
                    if (bodyStr.isNotBlank()) {
                        val obj = JSONObject(bodyStr)
                        val msg = obj.optString("message", "")
                        if (msg.isNotBlank()) BridgeState.appendLog("[Server] $msg")
                    }
                }
            } catch (t: Throwable) {
                BridgeState.appendLog("[Info] Menunggu koneksi server ($ip:$port): ${t.message}")
            }
        }
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(15, TimeUnit.SECONDS)
        .build()

    private val ioExecutor = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private var webSocket: WebSocket? = null

    @Volatile
    private var isConnecting = false

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            try {
                val ws = webSocket
                if (ws != null && BridgeState.isConnectedToServer) {
                    val ping = JSONObject().apply {
                        put("type", "PING")
                        put("deviceId", BridgePrefs.getDeviceId(this@BridgeForegroundService))
                    }
                    ws.send(ping.toString())
                } else {
                    connectWebSocket()
                }
            } catch (_: Throwable) {
            }
            handler.postDelayed(this, 8000L)
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        startForegroundCompat("Terminal DANA QRIS Bridge siap")
        handler.postDelayed(heartbeatRunnable, 5000L)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        instance = this
        try {
            BridgeState.currentPairCode = BridgePrefs.getPairCode(this)
            BridgeState.isPaired = BridgePrefs.isPaired(this)
            BridgeState.notifyUi()
            connectWebSocket()
        } catch (t: Throwable) {
            BridgeState.appendLog("[Error] ${t.message}")
        }
        return START_STICKY
    }

    override fun onDestroy() {
        instance = null
        handler.removeCallbacksAndMessages(null)
        try {
            webSocket?.close(1000, "Service destroyed")
        } catch (_: Throwable) {
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    fun reconnectImmediately() {
        isConnecting = false
        try {
            webSocket?.cancel()
        } catch (_: Throwable) {
        }
        connectWebSocket()
    }

    private fun connectWebSocket() {
        val ip = BridgePrefs.getServerIp(this)
        val port = BridgePrefs.getServerPort(this)
        if (ip.isBlank()) {
            BridgeState.statusText = "MASUKKAN IP SERVER"
            BridgeState.notifyUi()
            return
        }
        if (isConnecting) return
        isConnecting = true

        try {
            webSocket?.cancel()
        } catch (_: Throwable) {
        }

        val wsUrl = "ws://$ip:$port"
        BridgeState.statusText = "MENGHUBUNGKAN KE $ip:$port..."
        BridgeState.notifyUi()

        val request = try {
            Request.Builder().url(wsUrl).build()
        } catch (t: Throwable) {
            isConnecting = false
            BridgeState.statusText = "FORMAT IP/PORT TIDAK VALID"
            BridgeState.appendLog("[Error] Alamat server '$ip:$port' tidak valid: ${t.message}")
            BridgeState.notifyUi()
            return
        }

        try {
            webSocket = client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    isConnecting = false
                    BridgeState.isConnectedToServer = true
                    try {
                        val hello = JSONObject().apply {
                            put("type", "HELLO")
                            put("deviceId", BridgePrefs.getDeviceId(this@BridgeForegroundService))
                            put("deviceName", BridgePrefs.getDeviceName(this@BridgeForegroundService))
                            put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
                            put("androidVersion", Build.VERSION.RELEASE ?: "13")
                            put("pairCode", BridgePrefs.getPairCode(this@BridgeForegroundService))
                        }
                        webSocket.send(hello.toString())
                        BridgeState.appendLog("[OK] Terhubung ke Server $ip:$port")
                    } catch (_: Throwable) {
                    }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    try {
                        val msg = JSONObject(text)
                        val type = msg.optString("type", "")
                        if (type == "PAIR_CODE") {
                            val code = msg.optString("pairCode", BridgePrefs.getPairCode(this@BridgeForegroundService))
                            BridgePrefs.setPairCode(this@BridgeForegroundService, code)
                            BridgePrefs.setPaired(this@BridgeForegroundService, false)
                            BridgeState.currentPairCode = code
                            BridgeState.isPaired = false
                            BridgeState.statusText = "MENUNGGU INPUT PAIR DI WEB"
                            updateForegroundNotification("Menunggu Pair di Web • Code: $code")
                            BridgeState.appendLog("[Pair] Masukkan Code Pair $code di Web Dashboard")
                            BridgeState.notifyUi()
                        } else if (type == "PAIRED") {
                            val code = msg.optString("pairCode", BridgePrefs.getPairCode(this@BridgeForegroundService))
                            val merchant = msg.optString("merchantName", "DANA Bisnis")
                            BridgePrefs.setPairCode(this@BridgeForegroundService, code)
                            BridgePrefs.setPaired(this@BridgeForegroundService, true)
                            BridgeState.currentPairCode = code
                            BridgeState.isPaired = true
                            BridgeState.statusText = "TERHUBUNG & AKTIF ($merchant)"
                            updateForegroundNotification("Aktif Memantau DANA • $merchant ($ip:$port)")
                            BridgeState.appendLog("[Aktif] Perangkat terhubung penuh dengan $merchant!")
                            BridgeState.notifyUi()
                        } else if (type == "NOTIFICATION_ACK") {
                            val ackMsg = msg.optString("message", "Notifikasi diterima server")
                            BridgeState.appendLog("[Server] $ackMsg")
                        }
                    } catch (_: Throwable) {
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    isConnecting = false
                    BridgeState.isConnectedToServer = false
                    val code = BridgePrefs.getPairCode(this@BridgeForegroundService)
                    BridgeState.currentPairCode = code
                    BridgeState.statusText = "MENUNGGU SERVER ($ip:$port)"
                    updateForegroundNotification("Menunggu koneksi Server $ip:$port • Code: $code")
                    BridgeState.notifyUi()
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    isConnecting = false
                    BridgeState.isConnectedToServer = false
                    BridgeState.statusText = "TERPUTUS DARI SERVER"
                    BridgeState.notifyUi()
                }
            })
        } catch (t: Throwable) {
            isConnecting = false
            BridgeState.appendLog("[Error] Gagal membuat koneksi WebSocket: ${t.message}")
            BridgeState.notifyUi()
        }
    }

    fun sendPaymentNotification(pkg: String, title: String, text: String, amount: String) {
        val ws = webSocket
        if (ws != null && BridgeState.isConnectedToServer) {
            try {
                val payload = JSONObject().apply {
                    put("type", "NOTIFICATION")
                    put("deviceId", BridgePrefs.getDeviceId(this@BridgeForegroundService))
                    put("pairCode", BridgePrefs.getPairCode(this@BridgeForegroundService))
                    put("pkg", pkg)
                    put("title", title)
                    put("text", text)
                    put("amount", amount)
                    put("timestamp", System.currentTimeMillis())
                }
                val sent = ws.send(payload.toString())
                if (sent) {
                    BridgeState.appendLog("[DANA] Terkirim: $title | $text (Rp$amount)")
                    return
                }
            } catch (_: Throwable) {
            }
        }

        ioExecutor.execute {
            sendHttpNotificationFallback(this, pkg, title, text, amount)
        }
    }

    private fun startForegroundCompat(contentText: String) {
        try {
            val notif = buildNotification(contentText)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(NOTIF_ID, notif)
            }
        } catch (_: Throwable) {
        }
    }

    private fun updateForegroundNotification(contentText: String) {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIF_ID, buildNotification(contentText))
        } catch (_: Throwable) {
        }
    }

    private fun buildNotification(contentText: String): Notification {
        val openIntent = Intent(this, MainActivity::class.java)
        val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getActivity(this, 0, openIntent, pendingFlags)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("DANA QRIS Bridge")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "DANA QRIS Bridge Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Menjaga koneksi terminal notifikasi QRIS DANA tetap berjalan 24/7"
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }
}
