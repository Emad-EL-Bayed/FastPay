/* فاست باي — عامل الخلفية (البرنامج بيسجّله: js/bgsync.js و js/push.js، بجذر الموقع جنب index.html).
   1) إشعارات الجوال (Firebase): بيستقبل الإشعار والبرنامج مسكّر وبيعرضه (فاير بيز بيعرضه لحاله من "webpush.notification"
      اللي بيبعته السكربت)، والكبسة عليه بتفتح البرنامج. إعداد فاير بيز (مش سري) بيوصل بالرابط ?cfg=<JSON>.
   2) المزامنة بالخلفية (الأندرويد، Background Sync): أول ما يرجع النت، كروم بيصحّيه بـ "sync" فبيبعت العمليات المعلقة
      (نسختها بـ IndexedDB fastpay-bg) للشيت، وبيسجّل نتيجة كل وحدة (done) حتى البرنامج يكمّل منها لما ينفتح.
      نفس القفل تبع البرنامج (navigator.locks 'fastpay-outbox')، فما بيبعتوا مع بعض. بيوقف عند أول تعارض ("مين عدّل قبلي"
      بدّه قرارك بالبرنامج). الآيفون ما بيدعمها.
   3) فتح البرنامج بدون نت (بطلب عماد 2026-10-19: البرنامج المثبّت كان يقول "ما في نت" ويسكّر): ملفات البرنامج
      (index.html، الأنماط، js/، الشعارات) والخطوط ومكتبات الفاتورة بتنحفظ بـ Cache Storage (fastpay-app-v1).
      الصفحة نفسها: من النت أول دايماً (أحدث نسخة)، وإذا ما في نت (أو تأخر 4 ثواني) من المحفوظ. الملفات اللي عليها ?v=
      من المحفوظ أول (كل نسخة رابطها جديد)، والباقي من المحفوظ وبيتحدث بالخلفية. الشيت (POST) ما بيمرق من هون أبداً.
      البيانات بدون نت من النسخة المحفوظة بالبرنامج (cache.js). البرنامج بيبعت قائمة ملفاته بعد كل فتحة (precache). */
let cfg = null;
try { cfg = JSON.parse(new URL(self.location.href).searchParams.get('cfg') || 'null'); } catch (e) { cfg = null; }
if (cfg && cfg.apiKey) {
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
    firebase.initializeApp(cfg);
    firebase.messaging();
}

// النسخة الجديدة من هالملف بتشتغل فوراً بدل ما تستنى كل نوافذ البرنامج تتسكّر
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// ================= فتح البرنامج بدون نت =================
const APP_CACHE = 'fastpay-app-v1';
const CACHE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'www.gstatic.com'];
const pageKey = (url) => { const u = new URL(url); return u.origin + u.pathname; };

function cacheable(url) {
    const u = new URL(url);
    if (u.origin === self.location.origin) return !/firebase-messaging-sw\.js$/.test(u.pathname);
    return CACHE_HOSTS.indexOf(u.hostname) >= 0;
}

async function fromNetworkFirst(req) {
    const cache = await caches.open(APP_CACHE);
    const saved = async () => (await cache.match(pageKey(req.url))) || (await cache.match(new URL('index.html', self.registration.scope).href))
        || (await cache.match(self.registration.scope));
    let res = null;
    try {
        res = await Promise.race([fetch(req), new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000))]);
    } catch (e) {
        return (await saved()) || Response.error();
    }
    if (res && res.ok) {
        cache.put(pageKey(req.url), res.clone());
        return res;
    }
    // الاستضافة رجّعت خطأ (مش انقطاع): المحفوظ أحسن من صفحة خطأ
    return (await saved()) || res;
}

async function fromCacheFirst(req, refresh) {
    const cache = await caches.open(APP_CACHE);
    const hit = await cache.match(req);
    const update = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
    });
    if (hit) {
        if (refresh) update.catch(() => {});
        return hit;
    }
    return update;
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || !cacheable(req.url)) return;
    const url = new URL(req.url);
    if (req.mode === 'navigate') return event.respondWith(fromNetworkFirst(req));
    // ?v=81: كل نسخة رابطها جديد، فالمحفوظ دايماً صح. بدون ?v (الشعار، الخطوط): المحفوظ وبيتحدث بالخلفية
    event.respondWith(fromCacheFirst(req, !url.search || url.origin !== self.location.origin));
});

// البرنامج بيبعت ملفاته بعد ما يفتح: بنحفظها، وبنشيل النسخ القديمة (نفس الملف بـ ?v= قديم)
self.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type !== 'precache' || !Array.isArray(msg.urls)) return;
    event.waitUntil((async () => {
        const cache = await caches.open(APP_CACHE);
        // الصفحة نفسها لحالها تحت (msg.page) بدون ?query
        const urls = msg.urls.filter(u => { try { return cacheable(u) && !/(index\.html|\/)$/.test(new URL(u).pathname); } catch (e) { return false; } });
        await Promise.all(urls.map(async (u) => {
            if (await cache.match(u)) return;
            try {
                const res = await fetch(u, new URL(u).origin === self.location.origin ? {} : { mode: 'cors', credentials: 'omit' });
                if (res.ok || res.type === 'opaque') await cache.put(u, res);
            } catch (e) { /* بنجربها المرة الجاية */ }
        }));
        if (msg.page) {
            try { const res = await fetch(msg.page, { cache: 'no-store' }); if (res.ok) await cache.put(pageKey(msg.page), res); } catch (e) { /* بدون نت */ }
        }
        const keep = new Set(urls);
        const paths = new Set(urls.map(u => { const x = new URL(u); return x.origin === self.location.origin && x.search ? x.pathname : ''; }).filter(Boolean));
        for (const req of await cache.keys()) {
            const x = new URL(req.url);
            if (x.origin === self.location.origin && x.search && paths.has(x.pathname) && !keep.has(req.url)) await cache.delete(req);
        }
    })());
});

// ================= المزامنة بالخلفية =================
const BG_DB = 'fastpay-bg';
const BG_STORE = 'kv';

function bgDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(BG_DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(BG_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function bgRequest(db, mode, fn) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(BG_STORE, mode);
        const req = fn(tx.objectStore(BG_STORE));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

const withLock = (fn) => (self.navigator && self.navigator.locks && self.navigator.locks.request
    ? self.navigator.locks.request('fastpay-outbox', fn) : fn());

// لحد 25 عملية بالطلب، بدون ما تنقسم مجموعة (_grp، مثلاً حوالة ودفعاتها) بين طلبين
function batchSize(ops) {
    let n = Math.min(25, ops.length);
    const g = ops[n - 1] && ops[n - 1]._grp;
    if (n < ops.length && g && ops[n] && ops[n]._grp === g) {
        let k = n - 1;
        while (k > 0 && ops[k - 1]._grp === g) k--;
        if (k > 0) n = k;
    }
    return n;
}

const FINAL = ['forbidden', 'day_locked', 'conflict', 'conflict_group'];

async function sendOutbox() {
    return withLock(async () => {
        const db = await bgDb();
        const rec = await bgRequest(db, 'readonly', s => s.get('outbox'));
        if (!rec || !Array.isArray(rec.ops) || !rec.ops.length || !rec.conn || !rec.conn.url) return { sent: 0, conflicts: 0, retry: false };
        rec.done = Array.isArray(rec.done) ? rec.done : [];
        let sent = 0, conflicts = 0, retry = false;
        while (rec.ops.length) {
            const ops = rec.ops.slice(0, batchSize(rec.ops));
            const body = { action: 'batch', ops };
            if (rec.conn.token) body.token = rec.conn.token;
            if (rec.conn.session) body.session = rec.conn.session;
            let data = null;
            try {
                const res = await fetch(rec.conn.url, { method: 'POST', body: JSON.stringify(body) });
                if (res.ok) data = JSON.parse(await res.text());
            } catch (e) { data = null; }
            // ما وصل رد: كروم بيعيد المحاولة لحاله بعدين
            if (!data) { retry = true; break; }
            // الجلسة انتهت أو المفتاح غلط: بتستنى البرنامج (ما في فايدة نعيد)
            if (!Array.isArray(data.results)) break;
            let stop = false;
            for (const r of data.results) {
                const op = rec.ops[0];
                if (!op) break;
                if (r && (r.ok || FINAL.indexOf(r.error) >= 0)) {
                    rec.done.push({ qid: op._qid, res: r });
                    rec.ops.shift();
                    if (r.ok) sent++;
                    else if (String(r.error).indexOf('conflict') === 0) conflicts++;
                } else { stop = true; retry = true; break; }
            }
            await bgRequest(db, 'readwrite', s => s.put(rec, 'outbox'));
            // التعارض بدّه قرارك: الباقي بيستنى البرنامج
            if (stop || conflicts) break;
        }
        return { sent, conflicts, retry };
    });
}

async function notifyResult(r) {
    if (!r || (!r.sent && !r.conflicts) || !self.registration.showNotification) return;
    // البرنامج مفتوح قدامك: هو بيحكيلك
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some(w => w.visibilityState === 'visible')) return;
    const title = r.conflicts ? 'فاست باي · في تعديل بدّه قرارك' : 'فاست باي';
    const body = r.conflicts
        ? 'حدا عدّل نفس الحركة قبلك. افتح البرنامج واختار: تعديله ولا تعديلك'
        : `✓ ${r.sent === 1 ? 'عملية معلقة وصلت' : r.sent + ' عمليات معلقة وصلت'} للشيت لما رجع النت`;
    try {
        await self.registration.showNotification(title, { body, tag: 'fastpay-bgsync', icon: 'assets/icon-192.png', dir: 'rtl', lang: 'ar', silent: !r.conflicts });
    } catch (e) { /* ما في إذن إشعارات */ }
}

self.addEventListener('sync', (event) => {
    if (event.tag !== 'fastpay-outbox') return;
    event.waitUntil(sendOutbox().then(async (r) => {
        await notifyResult(r);
        // رفض الوعد = كروم بيعيد المحاولة لاحقاً
        if (r && r.retry) throw new Error('retry');
    }));
});

// كبسة على إشعار المزامنة: بتفتح البرنامج (إشعارات فاير بيز إلها رابطها)
self.addEventListener('notificationclick', (event) => {
    if (event.notification.tag !== 'fastpay-bgsync') return;
    event.notification.close();
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
        if (wins.length) return wins[0].focus();
        return self.clients.openWindow('./index.html');
    }));
});
