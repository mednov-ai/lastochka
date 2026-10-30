self.addEventListener('push', (event) => {
  let number;
  try {
    number = event.data?.json()?.number;
  } catch {
    number = undefined;
  }
  const body = Number.isSafeInteger(number)
    ? `Поступила заявка №${number}. Откройте кабинет администратора.`
    : 'Поступила новая заявка. Откройте кабинет администратора.';
  event.waitUntil(
    self.registration.showNotification('Ласточка — новая заявка', {
      body,
      tag: Number.isSafeInteger(number) ? `enquiry-${number}` : 'enquiry',
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL('admin/requests', self.registration.scope).href;
  event.waitUntil(self.clients.openWindow(target));
});
