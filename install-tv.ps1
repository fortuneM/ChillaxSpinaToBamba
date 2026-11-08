param(
    [string]$TvIp = "192.168.3.31",
    [int]$Port = 5555
)

$apkPath = Join-Path $PSScriptRoot "Chillax-Spin-And-Win-TV.apk"
if (-not (Test-Path $apkPath)) {
    $apkPath = Join-Path $PSScriptRoot "android-tv\app\build\outputs\apk\debug\app-debug.apk"
}

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "📺 Connecting to Chillax Android TV at ${TvIp}:${Port}..." -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

adb connect "${TvIp}:${Port}"
Start-Sleep -Seconds 2

Write-Host "📦 Installing Chillax Spin & Win TV APK..." -ForegroundColor Yellow
adb -s "${TvIp}:${Port}" install -r "$apkPath"

if ($LASTEXITCODE -eq 0) {
    Write-Host "🚀 Launching Chillax Spin & Win TV..." -ForegroundColor Green
    adb -s "${TvIp}:${Port}" shell am start -n com.chillax.spinandwin/.MainActivity
    Write-Host "✅ Done! App is now running on TV ($TvIp)." -ForegroundColor Green
} else {
    Write-Host "❌ Could not install via ADB. Make sure USB/Network Debugging is ON in TV Settings -> Developer Options, and click 'Allow' on the TV screen." -ForegroundColor Red
    Write-Host "💡 Or open http://192.168.3.64:3000/tv.apk directly in your TV's browser / Downloader app." -ForegroundColor Yellow
}

