package com.chillax.spinandwin

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var prefs: SharedPreferences

    companion object {
        private const val PREFS_NAME = "ChillaxTvPrefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val DEFAULT_SERVER_URL = "http://192.168.3.64:3000/tv"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep screen on during gaming venue hours
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#070d1e"))
            layoutParams = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT
            )
        }
        setContentView(webView)
        hideSystemUI()

        configureWebView()

        // Check if server URL is configured, defaulting to active server URL
        val serverUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        loadTvPage(serverUrl)
    }

    private fun configureWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false // Autoplay web audio sounds
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView?,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                super.onReceivedError(view, errorCode, description, failingUrl)
                Toast.makeText(
                    this@MainActivity,
                    "Connecting to venue server: $description (Press Menu to configure IP)",
                    Toast.LENGTH_LONG
                ).show()
            }
        }

        webView.webChromeClient = WebChromeClient()
    }

    private fun loadTvPage(url: String) {
        val cleanUrl = if (!url.startsWith("http://") && !url.startsWith("https://")) {
            "http://$url"
        } else {
            url
        }
        val targetUrl = if (!cleanUrl.endsWith("/tv")) {
            "$cleanUrl/tv"
        } else {
            cleanUrl
        }
        webView.loadUrl(targetUrl)
    }

    // On-screen dialog to set or update venue server IP via TV remote control
    private fun showServerConfigDialog(isFirstRun: Boolean = false) {
        val currentUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL)

        val input = EditText(this).apply {
            setText(currentUrl)
            hint = "e.g. 192.168.1.100:3000 or http://192.168.1.100:3000/tv"
            setPadding(40, 30, 40, 30)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0f172a"))
        }

        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("🎮 Chillax TV Server Setup")
            .setMessage("Enter the local IP address of the machine running the Chillax game server:")
            .setView(input)
            .setPositiveButton("Connect") { _, _ ->
                val newUrl = input.text.toString().trim()
                if (newUrl.isNotEmpty()) {
                    prefs.edit().putString(KEY_SERVER_URL, newUrl).apply()
                    loadTvPage(newUrl)
                }
            }
            .setNegativeButton("Cancel") { dialog, _ ->
                if (isFirstRun) {
                    loadTvPage(DEFAULT_SERVER_URL)
                }
                dialog.dismiss()
            }
            .setNeutralButton("Reload") { _, _ ->
                webView.reload()
            }
            .show()
    }

    // Capture remote control Menu or Long-Press to open configuration
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) {
            showServerConfigDialog()
            return true
        }
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // Confirm exit or configure
            showServerConfigDialog()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun hideSystemUI() {
        try {
            val windowInsetsController = WindowCompat.getInsetsController(window, window.decorView)
            windowInsetsController.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            windowInsetsController.hide(WindowInsetsCompat.Type.systemBars())
        } catch (_: Exception) {
            // Graceful fallback for non-standard TV OS variants
            try {
                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                )
            } catch (_: Exception) {}
        }
    }

    override fun onResume() {
        super.onResume()
        hideSystemUI()
    }
}
