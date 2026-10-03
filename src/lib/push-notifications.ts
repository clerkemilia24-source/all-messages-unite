import { deleteToken, getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { getApp, getApps, initializeApp } from "firebase/app";
import type { MessagePayload, Messaging } from "firebase/messaging";
import { supabase } from "@/integrations/supabase/client";

const installationKey = (userId: string) => `ripple-push-installation:${userId}`;

const firebaseEnvironment = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined,
};

const requiredEnvironment: [keyof typeof firebaseEnvironment, string][] = [
  ["apiKey", "VITE_FIREBASE_API_KEY"],
  ["authDomain", "VITE_FIREBASE_AUTH_DOMAIN"],
  ["projectId", "VITE_FIREBASE_PROJECT_ID"],
  ["messagingSenderId", "VITE_FIREBASE_MESSAGING_SENDER_ID"],
  ["appId", "VITE_FIREBASE_APP_ID"],
  ["vapidKey", "VITE_FIREBASE_VAPID_KEY"],
];

export function getMissingFirebaseConfiguration() {
  return requiredEnvironment
    .filter(([key]) => !firebaseEnvironment[key]?.trim())
    .map(([, environmentName]) => environmentName);
}

async function getBrowserMessaging(): Promise<Messaging> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    throw new Error("Push notifications require a supported browser with service workers.");
  }
  const missing = getMissingFirebaseConfiguration();
  if (missing.length) throw new Error(`Missing Firebase web config: ${missing.join(", ")}`);
  const [{ getApp, getApps, initializeApp }, { getMessaging, isSupported }] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);
  if (!(await isSupported()))
    throw new Error("Firebase messaging is not supported in this browser.");

  const appName = "ripple-push-notifications";
  const app = getApps().some((candidate) => candidate.name === appName)
    ? getApp(appName)
    : initializeApp(
        {
          apiKey: firebaseEnvironment.apiKey!,
          authDomain: firebaseEnvironment.authDomain!,
          projectId: firebaseEnvironment.projectId!,
          messagingSenderId: firebaseEnvironment.messagingSenderId!,
          appId: firebaseEnvironment.appId!,
        },
        appName,
      );
  await navigator.serviceWorker.register("/firebase-messaging-sw.js");
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

export async function registerFirebaseDevice(userId: string) {
  const missing = getMissingFirebaseConfiguration();
  if (missing.length) throw new Error(`Missing Firebase web config: ${missing.join(", ")}`);
  if (!("Notification" in window)) {
    throw new Error("This browser does not support notifications.");
  }
  if (Notification.permission === "denied") {
    throw new Error("Notifications are blocked in browser settings.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");

  const messaging = await getBrowserMessaging();
  const token = await getToken(messaging, { vapidKey: firebaseEnvironment.vapidKey });
  if (!token) throw new Error("Firebase did not issue a device token.");
  const installationId = getInstallationId(userId);
  const { error } = await supabase.from("push_device_tokens").upsert(
    {
      user_id: userId,
      installation_id: installationId,
      token,
      platform: "web",
      user_agent: navigator.userAgent.slice(0, 512),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "user_id,installation_id" },
  );
  if (error) {
    if (error.code === "23505") {
      throw new Error(
        "This browser token belongs to another account. Sign out of that account first.",
      );
    }
    throw new Error("The Firebase device token could not be saved.");
  }
  return { installationId };
}

export async function unregisterFirebaseDevice(userId: string) {
  const key = installationKey(userId);
  const installationId = localStorage.getItem(key);
  if (!installationId) return;
  const { error } = await supabase
    .from("push_device_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("installation_id", installationId);
  if (error) throw new Error("This device could not be removed from push notifications.");

  if (!getMissingFirebaseConfiguration().length) {
    try {
      const { deleteToken, isSupported } = await import("firebase/messaging");
      if (await isSupported()) await deleteToken(await getBrowserMessaging());
    } catch (error) {
      console.warn("[notifications] FCM token cleanup failed after device removal", error);
    }
  }
  localStorage.removeItem(key);
}

export async function listenForForegroundPush(handler: (payload: MessagePayload) => void) {
  const { onMessage } = await import("firebase/messaging");
  return onMessage(await getBrowserMessaging(), handler);
}
