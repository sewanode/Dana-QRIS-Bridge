package com.danaqris.bridge

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var cardTosAndPermissions: LinearLayout
    private lateinit var cardServerConnection: LinearLayout
    private lateinit var cbAgreeTos: CheckBox

    private lateinit var tvPermNotifListenerStatus: TextView
    private lateinit var tvPermBackgroundStatus: TextView
    private lateinit var tvPermBootStatus: TextView
    private lateinit var tvPermBatteryStatus: TextView

    private lateinit var etDeviceName: EditText
    private lateinit var etServerIp: EditText
    private lateinit var etServerPort: EditText
    private lateinit var tvConnectionBadge: TextView
    private lateinit var tvPairCode: TextView
    private lateinit var tvLogs: TextView
    private lateinit var etTestAmount: EditText

    private val stateListener: () -> Unit = {
        refreshConnectionUi()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val tvDeviceSubtitle = findViewById<TextView>(R.id.tvDeviceSubtitle)
        tvDeviceSubtitle.text = "Terminal ID: ${BridgePrefs.getDeviceId(this)}"

        cardTosAndPermissions = findViewById(R.id.cardTosAndPermissions)
        cardServerConnection = findViewById(R.id.cardServerConnection)
        cbAgreeTos = findViewById(R.id.cbAgreeTos)

        tvPermNotifListenerStatus = findViewById(R.id.tvPermNotifListenerStatus)
        tvPermBackgroundStatus = findViewById(R.id.tvPermBackgroundStatus)
        tvPermBootStatus = findViewById(R.id.tvPermBootStatus)
        tvPermBatteryStatus = findViewById(R.id.tvPermBatteryStatus)

        etDeviceName = findViewById(R.id.etDeviceName)
        etServerIp = findViewById(R.id.etServerIp)
        etServerPort = findViewById(R.id.etServerPort)
        tvConnectionBadge = findViewById(R.id.tvConnectionBadge)
        tvPairCode = findViewById(R.id.tvPairCode)
        tvLogs = findViewById(R.id.tvLogs)
        etTestAmount = findViewById(R.id.etTestAmount)

        // Load saved preferences (sanitized)
        cbAgreeTos.isChecked = BridgePrefs.isTosAccepted(this)
        etDeviceName.setText(BridgePrefs.getDeviceName(this))
        etServerIp.setText(BridgePrefs.getServerIp(this))
        etServerPort.setText(BridgePrefs.getServerPort(this).toString())

        BridgeState.currentPairCode = BridgePrefs.getPairCode(this)
        BridgeState.isPaired = BridgePrefs.isPaired(this)

        // Show ToS & Permissions card first if not yet completed
        if (BridgePrefs.isTosAccepted(this) && areCorePermissionsGranted()) {
            cardTosAndPermissions.visibility = View.GONE
        } else {
            cardTosAndPermissions.visibility = View.VISIBLE
        }

        findViewById<Button>(R.id.btnTogglePermissionsView).setOnClickListener {
            if (cardTosAndPermissions.visibility == View.VISIBLE) {
                cardTosAndPermissions.visibility = View.GONE
            } else {
                cardTosAndPermissions.visibility = View.VISIBLE
            }
            refreshPermissionsUi()
        }

        // Permission 1: Read Notifications
        findViewById<Button>(R.id.btnPermNotifListener).setOnClickListener {
            try {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            } catch (_: Exception) {
                Toast.makeText(this, "Buka Pengaturan -> Akses Notifikasi", Toast.LENGTH_LONG).show()
            }
        }

        // Permission 2: Run in Background & Post Notifications
        findViewById<Button>(R.id.btnPermBackground).setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    1001
                )
            } else {
                Toast.makeText(this, "Izin Latar Belakang sudah aktif!", Toast.LENGTH_SHORT).show()
                refreshPermissionsUi()
            }
        }

        // Permission 3: Run After Boot
        findViewById<Button>(R.id.btnPermBoot).setOnClickListener {
            BridgePrefs.setBootConfirmed(this, true)
            refreshPermissionsUi()
            Toast.makeText(this, "Auto-Run Saat Boot diaktifkan!", Toast.LENGTH_SHORT).show()
        }

        // Permission 4: Ignore Battery Optimizations
        findViewById<Button>(R.id.btnPermBattery).setOnClickListener {
            requestIgnoreBatteryOptimization()
        }

        // Save ToS & Continue
        findViewById<Button>(R.id.btnContinueToSetup).setOnClickListener {
            if (!cbAgreeTos.isChecked) {
                Toast.makeText(
                    this,
                    "Harap centang persetujuan Ketentuan Layanan terlebih dahulu",
                    Toast.LENGTH_LONG
                ).show()
                return@setOnClickListener
            }
            BridgePrefs.setTosAccepted(this, true)
            BridgePrefs.setBootConfirmed(this, true)
            cardTosAndPermissions.visibility = View.GONE
            Toast.makeText(
                this,
                "Persetujuan disimpan. Silakan hubungkan ke IP Server Anda.",
                Toast.LENGTH_SHORT
            ).show()
        }

        // Connect to Server & Show Pair Code
        findViewById<Button>(R.id.btnConnectServer).setOnClickListener {
            if (!BridgePrefs.isTosAccepted(this) && !cbAgreeTos.isChecked) {
                cardTosAndPermissions.visibility = View.VISIBLE
                Toast.makeText(
                    this,
                    "Harap setujui Ketentuan Layanan terlebih dahulu",
                    Toast.LENGTH_LONG
                ).show()
                return@setOnClickListener
            }
            BridgePrefs.setTosAccepted(this, true)

            val devName = etDeviceName.text.toString().trim().ifBlank { "HP Kasir" }
            val rawIp = etServerIp.text.toString().trim()
            val cleanIp = BridgePrefs.sanitizeHost(rawIp)
            val portStr = etServerPort.text.toString().trim()
            val port = BridgePrefs.sanitizePort(portStr.toIntOrNull() ?: 2020)

            if (cleanIp.isBlank()) {
                Toast.makeText(this, "Masukkan IP Server terlebih dahulu!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            etServerIp.setText(cleanIp)
            etServerPort.setText(port.toString())

            BridgePrefs.setDeviceName(this, devName)
            BridgePrefs.setServerIp(this, cleanIp)
            BridgePrefs.setServerPort(this, port)

            BridgeForegroundService.forceReconnectNow(this)
            refreshConnectionUi()
            Toast.makeText(
                this,
                "Menghubungkan ke $cleanIp:$port • Code Pair: ${BridgePrefs.getPairCode(this)}",
                Toast.LENGTH_SHORT
            ).show()
        }

        // Send Simulated DANA Notification
        findViewById<Button>(R.id.btnSendTestNotif).setOnClickListener {
            val rawAmt = etTestAmount.text.toString().trim().ifBlank { "1000232" }
            val cleanAmt = rawAmt.replace(".", "").replace(",", "")
            val formattedDots = try {
                String.format("%,d", cleanAmt.toLong()).replace(',', '.')
            } catch (_: Exception) {
                cleanAmt
            }
            val title = "Pembayaran Masuk"
            val text = "Rp$formattedDots diterima DANA Bisnis"

            BridgeState.appendLog("[Uji] Mengirim: $title - $text")
            BridgeForegroundService.dispatchDanaNotification(
                context = this,
                pkg = "id.dana",
                title = title,
                text = text,
                amount = cleanAmt
            )
        }

        if (BridgePrefs.isTosAccepted(this) && BridgePrefs.getServerIp(this).isNotBlank()) {
            BridgeForegroundService.startOrReconnect(this)
        }
    }

    override fun onResume() {
        super.onResume()
        BridgeState.addListener(stateListener)
        refreshPermissionsUi()
        refreshConnectionUi()
    }

    override fun onPause() {
        BridgeState.removeListener(stateListener)
        super.onPause()
    }

    private fun refreshPermissionsUi() {
        val notifGranted = isNotificationListenerEnabled(this)
        tvPermNotifListenerStatus.text =
            if (notifGranted) "✓ Diizinkan (Aktif)" else "Belum Diizinkan (Wajib)"
        tvPermNotifListenerStatus.setTextColor(
            if (notifGranted) Color.parseColor("#059669") else Color.parseColor("#D97706")
        )

        val bgGranted = isPostNotificationsGranted()
        tvPermBackgroundStatus.text =
            if (bgGranted) "✓ Diizinkan (Layanan 24/7)" else "Perlu Izin Notifikasi"
        tvPermBackgroundStatus.setTextColor(
            if (bgGranted) Color.parseColor("#059669") else Color.parseColor("#D97706")
        )

        val bootConfirmed = BridgePrefs.isBootConfirmed(this) || BridgePrefs.isTosAccepted(this)
        tvPermBootStatus.text =
            if (bootConfirmed) "✓ Aktif (Auto-Start Saat Boot)" else "Klik Aktifkan"
        tvPermBootStatus.setTextColor(
            if (bootConfirmed) Color.parseColor("#059669") else Color.parseColor("#D97706")
        )

        val batteryIgnored = isIgnoringBatteryOptimizations(this)
        tvPermBatteryStatus.text =
            if (batteryIgnored) "✓ Bebas Batasan Baterai" else "Masih Dibatasi Penghemat Baterai"
        tvPermBatteryStatus.setTextColor(
            if (batteryIgnored) Color.parseColor("#059669") else Color.parseColor("#D97706")
        )
    }

    private fun refreshConnectionUi() {
        val code = BridgeState.currentPairCode.ifBlank { BridgePrefs.getPairCode(this) }
        tvPairCode.text = code
        tvConnectionBadge.text = BridgeState.statusText

        when {
            BridgeState.isPaired && BridgeState.isConnectedToServer -> {
                tvConnectionBadge.setTextColor(Color.parseColor("#059669"))
            }
            BridgeState.isConnectedToServer -> {
                tvConnectionBadge.setTextColor(Color.parseColor("#0A66C2"))
            }
            else -> {
                tvConnectionBadge.setTextColor(Color.parseColor("#D97706"))
            }
        }

        tvLogs.text = BridgeState.getLogsText()
    }

    private fun areCorePermissionsGranted(): Boolean {
        return isNotificationListenerEnabled(this) && isIgnoringBatteryOptimizations(this)
    }

    private fun isNotificationListenerEnabled(context: Context): Boolean {
        val cn = ComponentName(context, DanaNotificationListenerService::class.java)
        val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
        return flat != null && flat.contains(cn.flattenToString())
    }

    private fun isPostNotificationsGranted(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    private fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            pm.isIgnoringBatteryOptimizations(context.packageName)
        } else {
            true
        }
    }

    private fun requestIgnoreBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
            } catch (_: Exception) {
                try {
                    startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                } catch (_: Exception) {
                }
            }
        }
    }
}
