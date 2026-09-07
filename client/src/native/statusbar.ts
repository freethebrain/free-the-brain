/* Status bar and splash. Capacitor 8 on Android 15/16 is edge-to-edge: the status bar is transparent
   and the page paints its own background beneath it (styles.css pads the top by the safe-area inset),
   so "status bar colour" is the page's --bg — paper in light, the dark variant in dark. What the
   plugin still controls is the icon style, which must flip with the theme; setBackgroundColor is kept
   for pre-15 devices, where it still applies. No-op on the web. */
import { isNative, quietly } from "./platform";

export const PAPER = "#fbfaf8";
export const PAPER_DARK = "#14130f";

export function prefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyStatusBar(dark: boolean = prefersDark()): void {
  if (!isNative()) return;
  void quietly(async () => {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    try {
      await StatusBar.setBackgroundColor({ color: dark ? PAPER_DARK : PAPER });
    } catch {
      /* Android 15+: no-op by design */
    }
  }, "status bar");
}

/** Keep the status bar icons readable when the system theme flips while the app is open. */
export function watchTheme(): void {
  if (!isNative() || typeof matchMedia !== "function") return;
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => applyStatusBar(mq.matches);
  if (mq.addEventListener) mq.addEventListener("change", onChange);
}

/** Hide the launch splash once the first render is on screen (launchAutoHide is off in the config). */
export function hideSplash(): void {
  if (!isNative()) return;
  void quietly(async () => {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 150 });
  }, "hide splash");
}
