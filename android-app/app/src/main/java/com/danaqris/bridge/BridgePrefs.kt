package com.danaqris.bridge

import android.content.Context
import android.os.Build
import android.provider.Settings
import java.util.UUID
import kotlin.random.Random

object BridgePrefs {
    private const val PREF_NAME = "dana_qris_bridge_prefs"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

    /**
     * Clean any accidental scheme (http://, ws://), path, or port (:8080) from the IP/Host field
     * so OkHttp never throws IllegalArgumentException: Invalid URL port: "8080:2020"
     */
    fun sanitizeHost(rawInput: String?): String {
        if (rawInput.isNullOrBlank()) return ""
        var s = rawInput.trim()
        s = s.replace(Regex("^(https?|wss?)://", RegexOption.IGNORE_CASE), "")
        s = s.substringBefore("/")
        s = s.substringBefore("?")
        if (s.contains(":")) {
            s = s.substringBefore(":")
        }
        return s.trim()
    }

    fun sanitizePort(port: Int): Int {
        return if (port in 1..65535) port else 2020
    }

    fun isTosAccepted(context: Context): Boolean =
        prefs(context).getBoolean("tos_accepted", false)

    fun setTosAccepted(context: Context, accepted: Boolean) {
        prefs(context).edit().putBoolean("tos_accepted", accepted).apply()
    }

    fun isBootConfirmed(context: Context): Boolean =
        prefs(context).getBoolean("boot_confirmed", false)

    fun setBootConfirmed(context: Context, confirmed: Boolean) {
        prefs(context).edit().putBoolean("boot_confirmed", confirmed).apply()
    }

    fun getDeviceId(context: Context): String {
        val existing = prefs(context).getString("device_id", null)
        if (!existing.isNullOrBlank()) return existing

        val androidId = try {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: ""
        } catch (_: Exception) {
            ""
        }
        val shortRand = UUID.randomUUID().toString().substring(0, 6)
        val generated = "hp_${androidId.take(8)}_$shortRand"
        prefs(context).edit().putString("device_id", generated).apply()
        return generated
    }

    fun getDeviceName(context: Context): String {
        val defaultName = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
        return prefs(context).getString("device_name", defaultName) ?: defaultName
    }

    fun setDeviceName(context: Context, name: String) {
        prefs(context).edit().putString("device_name", name.trim()).apply()
    }

    fun getServerIp(context: Context): String {
        val raw = prefs(context).getString("server_ip", "") ?: ""
        return sanitizeHost(raw)
    }

    fun setServerIp(context: Context, ip: String) {
        prefs(context).edit().putString("server_ip", sanitizeHost(ip)).apply()
    }

    fun getServerPort(context: Context): Int {
        val p = prefs(context).getInt("server_port", 2020)
        return sanitizePort(p)
    }

    fun setServerPort(context: Context, port: Int) {
        prefs(context).edit().putInt("server_port", sanitizePort(port)).apply()
    }

    fun getPairCode(context: Context): String {
        val saved = prefs(context).getString("pair_code", null)
        if (!saved.isNullOrBlank()) return saved
        val generated = Random.nextInt(100000, 999999).toString()
        prefs(context).edit().putString("pair_code", generated).apply()
        return generated
    }

    fun setPairCode(context: Context, code: String) {
        prefs(context).edit().putString("pair_code", code.trim()).apply()
    }

    fun isPaired(context: Context): Boolean =
        prefs(context).getBoolean("is_paired", false)

    fun setPaired(context: Context, paired: Boolean) {
        prefs(context).edit().putBoolean("is_paired", paired).apply()
    }
}
