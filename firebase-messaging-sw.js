// الموقع انتقل لـ app.fastpayps.com: عامل الخلفية القديم بيمسح ملفاته وبيشيل حاله
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate('https://app.fastpayps.com/');
})()));
