/* The native adapter — everything the Capacitor shell adds, behind one import. Every function here
   is a no-op on the plain web, so main.ts calls them unconditionally. */
export { isNative, platform } from "./platform";
export { tapFeedback, successFeedback } from "./haptics";
export { consumeSharedText, onSharedText, shareToCaptureText } from "./share";
export { getToken, setToken, clearToken } from "./token";
export { applyStatusBar, watchTheme, hideSplash } from "./statusbar";
export {
  planDeadlineNotifications,
  rescheduleDeadlineNotifications,
  notificationId,
  zonedInstant,
  shiftDate,
  isHardDeadline,
  REMINDER_DAYS,
  REMINDER_HOUR,
  REMINDER_TZ,
} from "./notifications";
