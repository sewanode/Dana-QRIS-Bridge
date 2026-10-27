package com.danaqris.bridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootCompletedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (
            action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_LOCKED_BOOT_COMPLETED ||
            action == "android.intent.action.QUICKBOOT_POWERON" ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            if (BridgePrefs.isTosAccepted(context) && BridgePrefs.getServerIp(context).isNotBlank()) {
                BridgeState.appendLog("[Boot] Perangkat menyala, menjalankan ulang layanan Bridge...")
                BridgeForegroundService.startOrReconnect(context)
            }
        }
    }
}
