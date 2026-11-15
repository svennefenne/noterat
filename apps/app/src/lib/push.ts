import { Capacitor, registerPlugin } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import type { PushConfig, SignedInApi } from "./api";

/**
 * Push on the phone (decision 12). The APK has no Firebase project built in: the server hands out the
 * household's own (an admin pasted it in), our small native plugin starts Firebase with it (and keeps it,
 * so a push that wakes the app finds Firebase ready), and then Capacitor's push plugin asks for
 * permission and gets the token, which goes to the server tied to this session.
 */

interface FirebaseInitPlugin {
  /** Start Firebase with these settings (kept for the next start). `restart`: another project was running. */
  initialize(o: NonNullable<PushConfig["android"]>): Promise<{ restart?: boolean }>;
}
const FirebaseInit = registerPlugin<FirebaseInitPlugin>("FirebaseInit");

export const canPush = Capacitor.getPlatform() === "android";

/** The channel pushes arrive in (the server names it in every message). */
const CHANNEL = { id: "noterat", name: "Noterat", importance: 4 as const, visibility: 0 as const };

/**
 * Start push on this phone, if the server has it set up: returns a function that stops listening.
 * `open` is where a tapped notification leads (a path in the app).
 */
export async function startPush(api: SignedInApi, lang: string, open: (path: string) => void): Promise<() => void> {
  if (!canPush) return () => {};
  const config = await api.pushConfig();
  if (!config.enabled || !config.android) return () => {};
  await FirebaseInit.initialize(config.android);
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return () => {};
  await PushNotifications.createChannel(CHANNEL);
  const handles = await Promise.all([
    PushNotifications.addListener("registration", (t) => void api.registerPush(t.value, lang).catch(() => {})),
    PushNotifications.addListener("registrationError", (e) => console.warn("push:", e.error)),
    PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
      const path: unknown = a.notification.data?.url;
      if (typeof path === "string" && path.startsWith("/")) open(path);
    }),
  ]);
  await PushNotifications.register();
  return () => handles.forEach((h) => void h.remove());
}
