package com.danaqris.bridge

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.regex.Pattern

class DanaNotificationListenerService : NotificationListenerService() {

    private val rpPattern = Pattern.compile("Rp\\s*([0-9][0-9.]*)(?:,[0-9]{1,2})?", Pattern.CASE_INSENSITIVE)

    override fun onListenerConnected() {
        super.onListenerConnected()
        BridgeState.appendLog("[NotifListener] Layanan pembaca notifikasi DANA terhubung.")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val pkg = sbn.packageName ?: return

        // Listen to DANA app (id.dana) or any package containing "dana"
        if (!pkg.equals("id.dana", ignoreCase = true) && !pkg.contains("dana", ignoreCase = true)) {
            return
        }

        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim() ?: ""
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim() ?: ""

        val effectiveText = if (bigText.isNotBlank()) bigText else text
        val combined = "$title $effectiveText"

        val matcher = rpPattern.matcher(combined)
        if (!matcher.find()) {
            return
        }

        val rawNominal = matcher.group(1) ?: return
        val cleanAmount = rawNominal.replace(".", "").trim()
        if (cleanAmount.isBlank()) return

        BridgeState.appendLog("[DANA] Terdeteksi: \"$title\" | \"$effectiveText\" (Rp$cleanAmount)")
        BridgeForegroundService.dispatchDanaNotification(
            context = applicationContext,
            pkg = pkg,
            title = title.ifBlank { "Pembayaran Masuk" },
            text = effectiveText,
            amount = cleanAmount
        )
    }
}
