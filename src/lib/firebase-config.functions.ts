import { createServerFn } from "@tanstack/react-start";

// Firebase web config values are public identifiers (shipped to every browser).
export const getFirebaseWebConfig = createServerFn({ method: "GET" }).handler(async () => {
  const env = (k: string) => (process.env[k] ?? "").trim();
  return {
    apiKey: env("FIREBASE_API_KEY"),
    authDomain: env("FIREBASE_AUTH_DOMAIN"),
    projectId: env("FIREBASE_PROJECT_ID"),
    messagingSenderId: env("FIREBASE_MESSAGING_SENDER_ID"),
    appId: env("FIREBASE_APP_ID"),
    storageBucket: env("FIREBASE_STORAGE_BUCKET"),
    vapidKey: env("FIREBASE_VAPID_KEY"),
  };
});
