self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    return;
  }

  const notification = payload.notification ?? {};
  const data = payload.data ?? {};
  const title = notification.title ?? data.title ?? "Ripple";
  const options = {
    body: notification.body ?? data.body ?? "",
    icon: notification.icon ?? data.icon ?? "/favicon.ico",
    badge: data.badge ?? "/favicon.ico",
    tag: data.notificationId ?? undefined,
    renotify: false,
    vibrate: [120, 60, 120],
    data: { deepLink: data.deepLink ?? data.link ?? "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = "/";
  try {
    const requested = new URL(event.notification.data?.deepLink ?? "/", self.location.origin);
    if (requested.origin === self.location.origin) target = requested.href;
  } catch {
    target = "/";
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});