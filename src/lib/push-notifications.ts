import type { MessagePayload, Messaging } from "firebase/messaging";
import { supabase } from "@/integrations/supabase/client";
import { getFirebaseWebConfig } from "@/lib/firebase-config.functions";

const installationKey = (userId: string) => `ripple-push-installation:${userId}`;

type FirebaseConfig = Awaited<ReturnType<typeof getFirebaseWebConfig>>;
let configPromise: Promise<FirebaseConfig> | null = null;

export function loadFirebaseConfig() {
  configPromise ??= getFirebaseWebConfig().catch((e) => {
    configPromise = null;
    throw e;
  });
  return configPromise;
}

const REQUIRED: (keyof FirebaseConfig)[] = [
  "apiKey",
  "projectId",
  "messagingSenderId",
  "appId",
  "vapidKey",
];

export async function getMissingFirebaseConfiguration() {
  const cfg = await loadFirebaseConfig();
  return REQUIRED.filter((k) => !cfg[k]).map((k) => `FIREBASE_${k}`);
}

let swRegistration: ServiceWorkerRegistration | null = null;

async function getBrowserMessaging(): Promise<Messaging> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    throw new Error("Push notifications need a browser with service worker support.");
  }
  const cfg = await loadFirebaseConfig();
  const missing = await getMissingFirebaseConfiguration();
  if (missing.length) throw new Error(`Notifications aren't configured yet (${missing.join(", ")}).`);
  const [{ getApp, getApps, initializeApp }, { getMessaging, isSupported }] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);
  if (!(await isSupported())) throw new Error("This browser does not support push notifications.");
  const appName = "ripple-push-notifications";
  const app = getApps().some((a) => a.name === appName)
    ? getApp(appName)
    : initializeApp(
        {
          apiKey: cfg.apiKey,
          ...(cfg.authDomain ? { authDomain: cfg.authDomain } : {}),
          projectId: cfg.projectId,
          messagingSenderId: cfg.messagingSenderId,
          appId: cfg.appId,
          ...(cfg.storageBucket ? { storageBucket: cfg.storageBucket } : {}),
        },
        appName,
      );
  swRegistration ??= await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  return getMessaging(app);
}

function getInstallationId(userId: string) {
  const key = installationKey(userId);
  const current = localStorage.getItem(key);
  if (current) return current;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

export async function registerFirebaseDevice(userId: string, askPermission = true) {
  if (!("Notification" in window)) throw new Error("This browser does not support notifications.");
  if (window.top !== window.self) {
    throw new Error("Open the app in its own tab to turn on notifications.");
  }
  if (Notification.permission === "denied") {
    throw new Error("Notifications are blocked. Allow them in your browser's site settings.");
  }
  if (Notification.permission !== "granted") {
    if (!askPermission) throw new Error("Notification permission not granted yet.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Notification permission was not granted.");
  }
  const cfg = await loadFirebaseConfig();
  const messaging = await getBrowserMessaging();
  const { getToken } = await import("firebase/messaging");
  const token = await getToken(messaging, {
    vapidKey: cfg.vapidKey,
    ...(swRegistration ? { serviceWorkerRegistration: swRegistration } : {}),
  });
  if (!token) throw new Error("Could not get a notification token for this device.");
  const installationId = getInstallationId(userId);
  const { error } = await supabase.from("push_device_tokens" as never).upsert(
    {
      user_id: userId,
      installation_id: installationId,
      token,
      platform: "web",
      user_agent: navigator.userAgent.slice(0, 512),
      last_seen_at: new Date().toISOString(),
    } as never,
    { onConflict: "user_id,installation_id" },
  );
  if (error) {
    if (error.code === "23505") {
      throw new Error("This browser is registered to another account. Sign out of it first.");
    }
    throw new Error("This device could not be saved for notifications.");
  }
  return { installationId };
}

export async function unregisterFirebaseDevice(userId: string) {
  const key = installationKey(userId);
  const installationId = localStorage.getItem(key);
  if (!installationId) return;
  const { error } = await supabase
    .from("push_device_tokens" as never)
    .delete()
    .eq("user_id" as never, userId as never)
    .eq("installation_id" as never, installationId as never);
  if (error) throw new Error("This device could not be removed from notifications.");
  try {
    const { deleteToken } = await import("firebase/messaging");
    await deleteToken(await getBrowserMessaging());
  } catch (e) {
    console.warn("[notifications] token cleanup failed", e);
  }
  localStorage.removeItem(key);
}

export async function listenForForegroundPush(handler: (payload: MessagePayload) => void) {
  const { onMessage } = await import("firebase/messaging");
  return onMessage(await getBrowserMessaging(), handler);
}
