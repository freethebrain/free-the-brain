/* Capacitor configuration — the Android (later iOS) wrap of the client.
   appId is PERMANENT once the first build is uploaded to Google Play: change it before that, never after
   (see docs/android-release.md, step 2). */
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.freethebrain.registry",
  appName: "Free the Brain",
  webDir: "dist",
  server: {
    /* https so the WebView origin is a secure context: service worker, clipboard, and a stable
       localStorage origin (https://localhost) for the pending store. */
    androidScheme: "https",
  },
  android: {
    /* The WebView is allowed to talk to the Registry Service over https only. */
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      /* Brand periwinkle field, brain mark centred; the app hides it itself after the first render. */
      launchAutoHide: false,
      backgroundColor: "#8e9dfa",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      /* Paper background; the adapter switches it to the dark variant with the theme. */
      backgroundColor: "#fbfaf8",
      style: "LIGHT",
      overlaysWebView: false,
    },
    LocalNotifications: {
      smallIcon: "ic_stat_notify",
      iconColor: "#8e9dfa",
    },
  },
};

export default config;
