self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { return; }
  event.waitUntil(self.registration.showNotification(data.title || '쏙쓸계산기', {
    body: data.body || '', tag: data.id, icon: '/icon.png', data: { url: data.url || '/' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const existing = windows.find(client => new URL(client.url).origin === url.origin);
    if (existing) { await existing.navigate(url.href); return existing.focus(); }
    return clients.openWindow(url.href);
  }));
});
