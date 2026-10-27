package com.danaqris.bridge

import android.os.Handler
import android.os.Looper
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

object BridgeState {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    private val logLines = CopyOnWriteArrayList<String>()

    @Volatile
    var isConnectedToServer: Boolean = false

    @Volatile
    var isPaired: Boolean = false

    @Volatile
    var currentPairCode: String = "------"

    @Volatile
    var statusText: String = "BELUM TERHUBUNG KE SERVER"

    fun addListener(listener: () -> Unit) {
        if (!listeners.contains(listener)) {
            listeners.add(listener)
        }
    }

    fun removeListener(listener: () -> Unit) {
        listeners.remove(listener)
    }

    fun appendLog(msg: String) {
        val time = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        logLines.add(0, "[$time] $msg")
        while (logLines.size > 40) {
            logLines.removeAt(logLines.size - 1)
        }
        notifyUi()
    }

    fun getLogsText(): String {
        if (logLines.isEmpty()) {
            return "[System] Menunggu aktivitas koneksi & notifikasi DANA..."
        }
        return logLines.joinToString("\n")
    }

    fun notifyUi() {
        mainHandler.post {
            for (l in listeners) {
                try {
                    l.invoke()
                } catch (_: Exception) {
                }
            }
        }
    }
}
