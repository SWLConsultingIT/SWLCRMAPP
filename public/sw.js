/* Growth Engine service worker — Web Push (P2b).
   Shows a push notification and focuses/opens the deep-link on click. */

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = {}; }
  const title = data.title || "Growth Engine";
  const options = {
    body: data.body || "",
    tag: data.tag || undefined,       // collapses duplicates with the same tag
    data: { url: data.url || "/" },
    renotify: !!data.tag,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Focus an existing tab and route it to the deep-link.
        if ("focus" in client) {
          if ("navigate" in client) { try { client.navigate(url); } catch (_) {} }
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
