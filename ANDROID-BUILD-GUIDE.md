# Pamusika — Build the Android app (sideload, no Play Store)

This turns the web app into an installable Android app (.apk) you put directly on
your team's phones. It does NOT go through the Play Store. You do this on a computer.

You only build the .apk once (and again whenever you want to ship an update).

---

## What you need on the computer (one-time setup)
1. **Node.js** — https://nodejs.org (the "LTS" version). Installs `npm`.
2. **Android Studio** — https://developer.android.com/studio (big download, ~1GB).
   During install, let it install the "Android SDK" when it offers.
3. Your project folder (the `stockflow-app` folder with all the files).

---

## One-time project setup
Open a terminal/command prompt **inside the project folder** and run these one at a time:

```
npm install
npm run build
npx cap add android
```

- `npm install` downloads everything (including Capacitor).
- `npm run build` turns the React app into the `dist` folder.
- `npx cap add android` creates an `android` folder — the native Android project.

---

## Every time you change the app and want a new .apk
```
npm run build
npx cap sync
npx cap open android
```

- `npm run build` rebuilds the web app.
- `npx cap sync` copies it into the Android project.
- `npx cap open android` launches Android Studio with the project.

---

## Make the .apk in Android Studio
1. Wait for Android Studio to finish loading/"Gradle sync" (first time is slow).
2. Top menu: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
3. When it finishes, a small popup appears bottom-right — click **locate** to find the file.
   It's usually at: `android/app/build/outputs/apk/debug/app-debug.apk`
4. That `app-debug.apk` file is your app.

---

## Install on the team's phones
1. Send the `app-debug.apk` to each phone (WhatsApp, email, USB cable, or a download link).
2. On the phone, open the file. Android will warn "install from unknown sources" —
   allow it for your browser/file app (Settings → Install unknown apps).
3. Tap install. The Pamusika icon appears like a normal app.

---

## Important notes
- **Internet:** the app still talks to your Supabase database online. Offline sales are
  saved on the phone and sync when back online (built in).
- **Updates:** when you change the app, rebuild the .apk and reinstall on phones. (Sideloaded
  apps don't auto-update — that's a Play Store feature for later.)
- **"debug" apk** is fine for your own team. For the Play Store later you'd build a signed
  "release" version — we can do that when you're ready.
- The app icon/name come from `capacitor.config.json` (appName "Pamusika"). Custom icon art
  can be added in Android Studio later.
