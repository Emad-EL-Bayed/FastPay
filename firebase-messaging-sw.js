/* فاست باي — عامل الخلفية لإشعارات الجوال (Firebase Cloud Messaging، js/push.js بيسجّله).
   بيستقبل الإشعار والبرنامج مسكّر وبيعرضه على الشاشة (فاير بيز بيعرضه لحاله من "webpush.notification" اللي بيبعته السكربت)،
   والكبسة عليه بتفتح البرنامج (fcm_options.link = رابط البرنامج على هالجهاز).
   إعداد فاير بيز (مش سري) بيوصل بالرابط: firebase-messaging-sw.js?cfg=<JSON>، لأنه هون ما في وصول لذاكرة الصفحة.
   ما في fetch هون: البرنامج ما بيتخبّى ولا بيشتغل بدون نت بسببه. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

let cfg = null;
try { cfg = JSON.parse(new URL(self.location.href).searchParams.get('cfg') || 'null'); } catch (e) { cfg = null; }
if (cfg && cfg.apiKey) {
    firebase.initializeApp(cfg);
    firebase.messaging();
}

// النسخة الجديدة من هالملف بتشتغل فوراً بدل ما تستنى كل نوافذ البرنامج تتسكّر
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
