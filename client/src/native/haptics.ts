/* Haptics — a light tap on every judgment (U/I square, status chip, done circle, date mode, date
   type) and a success pulse when a batch lands. Removable in one word if it gets in the way
   (production plan §3.4, pass 3). No-op on the web. */
import { isNative, quietly } from "./platform";

export function tapFeedback(): void {
  if (!isNative()) return;
  void quietly(async () => {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  }, "haptic tap");
}

export function successFeedback(): void {
  if (!isNative()) return;
  void quietly(async () => {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Success });
  }, "haptic success");
}
