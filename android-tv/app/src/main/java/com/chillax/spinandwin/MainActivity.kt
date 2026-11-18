package com.chillax.spinandwin

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
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
    private val mainHandler = Handler(Looper.getMainLooper())
    private var retryRunnable: Runnable? = null
    private var lastRequestedUrl: String = DEFAULT_SERVER_URL
    private var activeConfigDialog: AlertDialog? = null

    companion object {
        private const val PREFS_NAME = "ChillaxTvPrefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val DEFAULT_SERVER_URL = "http://192.168.3.64:3000/tv"
        private const val RETRY_DELAY_MS = 5000L
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep screen on during gaming venue hours
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#050a18"))
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
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
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (url != null && !url.startsWith("data:") && !url.startsWith("about:")) {
                    cancelRetry()
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    val desc = error?.description?.toString() ?: "Server unreachable"
                    showReconnectingScreen(desc)
                    scheduleRetry()
                }
            }

            @Deprecated("Deprecated in Java")
            override fun onReceivedError(
                view: WebView?,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                @Suppress("DEPRECATION")
                super.onReceivedError(view, errorCode, description, failingUrl)
                if (failingUrl == null || failingUrl == lastRequestedUrl) {
                    showReconnectingScreen(description ?: "Server unreachable")
                    scheduleRetry()
                }
            }
        }

        webView.webChromeClient = WebChromeClient()
    }

    private fun normalizeTvUrl(rawUrl: String): String {
        val trimmed = rawUrl.trim()
        val withScheme = if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
            "http://$trimmed"
        } else {
            trimmed
        }

        return try {
            val parsed = Uri.parse(withScheme)
            val path = (parsed.path ?: "").trimEnd('/')
            val builder = parsed.buildUpon()
            when {
                path.isEmpty() -> builder.path("/tv")
                path.endsWith("/tv") -> builder.path(path)
                else -> builder.path("$path/tv")
            }
            builder.build().toString()
        } catch (_: Exception) {
            val noTrailing = withScheme.trimEnd('/')
            if (noTrailing.endsWith("/tv") || noTrailing.contains("/tv?")) noTrailing else "$noTrailing/tv"
        }
    }

    private fun loadTvPage(url: String) {
        cancelRetry()
        val targetUrl = normalizeTvUrl(url)
        lastRequestedUrl = targetUrl
        webView.loadUrl(targetUrl)
    }

    private fun scheduleRetry() {
        cancelRetry()
        val runnable = Runnable {
            if (!isFinishing && !isDestroyed) {
                webView.loadUrl(lastRequestedUrl)
            }
        }
        retryRunnable = runnable
        mainHandler.postDelayed(runnable, RETRY_DELAY_MS)
    }

    private fun cancelRetry() {
        retryRunnable?.let { mainHandler.removeCallbacks(it) }
        retryRunnable = null
    }

    private fun showReconnectingScreen(reason: String) {
        val safeTarget = lastRequestedUrl
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        val safeReason = reason
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        val html = """
            <!DOCTYPE html>
            <html>
              <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
                <style>
                  body {
                    margin: 0; height: 100vh; background: radial-gradient(circle at top, #132245, #050a18);
                    color: #f8fafc; font-family: sans-serif; display: flex; align-items: center; justify-content: center;
                  }
                  .card {
                    background: rgba(15, 23, 42, 0.92); border: 2px solid rgba(0, 242, 254, 0.45);
                    border-radius: 22px; padding: 36px 48px; text-align: center; max-width: 680px;
                    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
                  }
                  h1 { margin: 0 0 8px; font-size: 30px; color: #00f2fe; letter-spacing: 2px; }
                  .sub { color: #fde047; font-size: 16px; font-weight: 700; margin-bottom: 20px; }
                  .url { font-family: monospace; background: #050a18; padding: 10px 16px; border-radius: 10px; color: #7dd3fc; display: inline-block; margin-bottom: 16px; }
                  .msg { color: #cbd5e1; font-size: 15px; line-height: 1.5; }
                  .hint { margin-top: 20px; color: #94a3b8; font-size: 13px; }
                </style>
              </head>
              <body>
                <div class="card">
                  <h1>CHILLAX SPIN &amp; WIN</h1>
                  <div class="sub">⏳ CONNECTING TO VENUE SERVER...</div>
                  <div class="url">$safeTarget</div>
                  <div class="msg">Waiting for the venue PC server to come online ($safeReason). Retrying automatically every 5 seconds...</div>
                  <div class="hint">Press <b>MENU</b>, <b>0</b>, or hold <b>OK</b> on your TV remote to change the server IP.</div>
                </div>
              </body>
            </html>
        """.trimIndent()
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    // On-screen dialog to set or update venue server IP via TV remote control
    private fun showServerConfigDialog(isFirstRun: Boolean = false) {
        if (activeConfigDialog?.isShowing == true) return
        val currentUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL)

        val input = EditText(this).apply {
            setText(currentUrl)
            hint = "e.g. 192.168.3.64:3000 or http://192.168.3.64:3000/tv"
            setPadding(40, 30, 40, 30)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0f172a"))
        }

        activeConfigDialog = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
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
                loadTvPage(prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL)
            }
            .setOnDismissListener {
                activeConfigDialog = null
                hideSystemUI()
            }
            .show()
    }

    // Capture remote control Menu, Settings, 0, Back, or Long-Press OK to open configuration
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (
            keyCode == KeyEvent.KEYCODE_MENU ||
            keyCode == KeyEvent.KEYCODE_SETTINGS ||
            keyCode == KeyEvent.KEYCODE_0 ||
            keyCode == KeyEvent.KEYCODE_BACK
        ) {
            showServerConfigDialog()
            return true
        }
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) {
            event?.startTracking()
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyLongPress(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) {
            Toast.makeText(this, "Opening Chillax Server Setup", Toast.LENGTH_SHORT).show()
            showServerConfigDialog()
            return true
        }
        return super.onKeyLongPress(keyCode, event)
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

    override fun onDestroy() {
        cancelRetry()
        activeConfigDialog?.dismiss()
        super.onDestroy()
    }
}
