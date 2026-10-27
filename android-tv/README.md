# 📺 Chillax Spin & Win — Android TV APK Guide

This directory contains the native **Android TV Kiosk Wrapper** for **Chillax Spin & Win**.

---

## 🎯 How It Works

- **Native Leanback Launcher**: Appears directly on your Android TV home screen with the official Chillax arcade banner.
- **Kiosk Mode**: Automatically runs full-screen landscape, hiding browser address bars, navigation buttons, and status bars.
- **Screen Wake Lock**: Prevents the TV from going into standby, sleep, or screensaver mode during gaming center operational hours.
- **Hardware Accelerated**: Runs smoothly at 60 FPS with full Web Audio API synthesizer support.
- **Remote Control Friendly**:
  - Automatically loads the configured venue server URL (`http://<server-ip>:3000/tv`).
  - Press the remote control **Menu** button or **Back** button at any time to open the on-screen IP setup dialog to change or reload the venue server address.

---

## 🚀 Building the APK

### Option 1: Open in Android Studio
1. Open **Android Studio**.
2. Select **Open** and choose the `android-tv` folder.
3. Click **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
4. Locate the generated file at:
   `android-tv/app/build/outputs/apk/debug/app-debug.apk`.

### Option 2: Command Line (Gradle)
```bash
cd android-tv
./gradlew assembleDebug
```
The APK is saved to:
`app/build/outputs/apk/debug/app-debug.apk`.

---

## 📲 How to Install the APK on Your Android TV

You can install (`sideload`) the `.apk` on your Android TV using any of these 3 easy methods:

### Method A: Send Files to TV (Easiest - Wireless)
1. Install the free **Send Files to TV** app from the Google Play Store on both your Android phone/computer and your Android TV.
2. Install a file manager (like **File Commander** or **AnExplorer**) on your TV.
3. Send `app-debug.apk` from your phone/PC to the TV.
4. Open the APK on the TV to install it.

### Method B: USB Flash Drive
1. Copy `app-debug.apk` onto a USB flash drive.
2. Plug the USB flash drive into the Android TV port.
3. Open any file manager on your TV (e.g. *File Commander*), select the USB drive, and click the APK to install.

### Method C: ADB (Over Wi-Fi)
1. Enable **Developer Options** and **Network Debugging** on the Android TV (`Settings > Device Preferences > About > click Build 7 times`).
2. Run:
   ```bash
   adb connect <TV-IP-ADDRESS>:5555
   adb install -r app-debug.apk
   ```

---

## 🌐 Alternative: Zero-Install TV Browser Mode
If you prefer not to install an APK:
1. Open any TV web browser on your Android TV (such as **TV Bro**, **Puffin TV Browser**, or **Chrome**).
2. Enter:
   `http://<venue-server-ip>:3000/tv`
3. Enter fullscreen mode. It works identically!
