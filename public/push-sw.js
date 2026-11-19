/* LG PLAST Live APK — Phone Push & Notification Click Service Worker Helper */
/* Works standalone or imported by Workbox generateSW via importScripts */

self.addEventListener('push', (event) => {
  let payload = {
    title: 'LG PLAST PlantOps Update',
    body: 'A new floor update requires your attention.',
    tag: 'lgplast_push_update',
    targetTab: 'status',
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = { ...payload, ...parsed };
      }
    }
  } catch {
    try {
      const text = event.data ? event.data.text() : '';
      if (text) payload.body = text;
    } catch {}
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: payload.tag || 'lgplast_push_update',
      renotify: true,
      requireInteraction: true,
      vibrate: [240, 100, 240],
      data: payload,
    })
  );
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'LGPLAST_SHOW_LOCAL_PUSH') return;
  const payload = msg.payload || {};
  event.waitUntil(
    self.registration.showNotification(payload.title || 'LG PLAST PlantOps Update', {
      body: payload.body || 'New APK update arrived.',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: payload.tag || 'lgplast_local_push',
      renotify: true,
      requireInteraction: payload.urgent !== false,
      vibrate: [240, 100, 240],
      data: payload,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetTab = data.targetTab || 'status';

  const params = new URLSearchParams();
  params.set('openTab', targetTab);
  if (data.dispatchStage) params.set('dispatchStage', data.dispatchStage);
  if (data.dieselSubTab) params.set('dieselSubTab', data.dieselSubTab);
  if (data.openWeightCheck) params.set('weightCheck', '1');
  const targetUrl = `/?${params.toString()}`;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.postMessage({
              type: 'LGPLAST_NOTIFICATION_CLICK',
              payload: data,
            });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
