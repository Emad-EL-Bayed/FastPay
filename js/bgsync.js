'use strict';

// فاست باي — المزامنة بالخلفية على الأندرويد (Background Sync، بطلب عماد 2026-10-19)
// تسجّل والنت مقطوع وتسكّر البرنامج: أول ما الجوال يشبك نت، كروم بيصحّي عامل الخلفية (firebase-messaging-sw.js،
// نفس عامل الإشعارات) فبيبعت العمليات المعلقة للشيت لحاله وبيسكّر. الآيفون ما بيسمح بهالشي (بيضل يبعت لما تفتح البرنامج).
// - العمليات المعلقة نسخة منها بـ IndexedDB (`fastpay-bg`، مفتاح outbox: العمليات + رابط الشيت والمفتاح والجلسة)،
//   لأنه عامل الخلفية ما بيقدر يقرا localStorage. كل عملية إلها `_qid` ثابت.
// - البرنامج وعامل الخلفية ما بيبعتوا مع بعض أبداً: الاثنين بيمسكوا نفس القفل (navigator.locks 'fastpay-outbox').
//   اللي بيبعته عامل الخلفية بيتسجل بـ `done` [{qid, res}]، والبرنامج أول ما يصحى بيقراه (absorbBackgroundSync):
//   بيشيل الواصل من الانتظار (ورقم الإيصال وآخر تحديث)، والمتعارض بيروح لـ "مين عدّل قبلي".
// - عامل الخلفية بيوقف عند أول تعارض (الباقي للبرنامج، حتى ما يكتب تعديل ثاني على نفس السطر).

const BG_DB = 'fastpay-bg';
const BG_STORE = 'kv';
const BG_TAG = 'fastpay-outbox';
let bgDbPromise = null;

function bgDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('no_idb'));
    bgDbPromise ??= new Promise((resolve, reject) => {
        const req = indexedDB.open(BG_DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(BG_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }).catch(err => { bgDbPromise = null; throw err; });
    return bgDbPromise;
}

async function bgRequest(mode, fn) {
    const db = await bgDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(BG_STORE, mode);
        const req = fn(tx.objectStore(BG_STORE));
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

// نفس القفل بالبرنامج وعامل الخلفية (المتصفح القديم بدونه: البرنامج لحاله أصلاً)
function withOutboxLock(fn) {
    return navigator.locks?.request ? navigator.locks.request('fastpay-outbox', fn) : fn();
}

// عامل الخلفية بيشتغل بس من رابط https، والمتصفح لازم يدعم Background Sync (كروم، الأندرويد)
const bgSyncSupported = () => 'serviceWorker' in navigator && 'SyncManager' in window
    && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname));

// رابط عامل الخلفية: مع إعداد فاير بيز إذا الإشعارات مجهّزة (نفس الرابط لازم بالحالتين حتى ما يتبدل كل شوي)
function serviceWorkerUrl() {
    const { vapidKey, ...cfg } = pushState?.web || {};
    return 'firebase-messaging-sw.js' + (cfg.apiKey ? '?cfg=' + encodeURIComponent(JSON.stringify(cfg)) : '');
}

let swRegistering = null;
function ensureServiceWorker() {
    if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) return Promise.resolve(null);
    swRegistering ??= navigator.serviceWorker.register(serviceWorkerUrl(), { scope: './' })
        .catch(err => { console.warn('SW register failed:', err); return null; })
        .finally(() => { setTimeout(() => { swRegistering = null; }, 0); });
    return swRegistering;
}

// اطلب من كروم يصحّينا أول ما يرجع النت (بس إذا في إشي معلّق)
async function requestBackgroundSync() {
    if (!bgSyncSupported() || !outbox.length) return;
    try {
        const reg = await ensureServiceWorker();
        if (reg?.sync) await reg.sync.register(BG_TAG);
    } catch (err) {
        console.warn('Background sync register failed:', err);
    }
}

// ---------- النسخة بـ IndexedDB ----------
const newQid = () => 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// بعد أي تغيير بالانتظار (saveAll): بنستنى شوي وبنكتب النسخة
let mirrorTimer = null;
function scheduleOutboxMirror() {
    if (!bgSyncSupported()) return;
    clearTimeout(mirrorTimer);
    mirrorTimer = setTimeout(() => { mirrorOutbox(); }, 250);
}

async function mirrorOutbox() {
    if (!bgSyncSupported()) return;
    try {
        await withOutboxLock(async () => {
            await absorbBackgroundSyncLocked();
            outbox.forEach(op => { op._qid ??= newQid(); });
            const conn = { url: (globalConfig.driveWebhook || '').trim(), token: globalConfig.syncToken || '', session: session?.token || '' };
            await bgRequest('readwrite', store => store.put({ ops: outbox.length && conn.url ? outbox : [], conn, done: [], at: Date.now() }, 'outbox'));
        });
        // بس لما ما وصلت (والبرنامج مفتوح ومتصل هو اللي بيبعت)
        if (outbox.length && (lastFlushFailed || navigator.onLine === false)) requestBackgroundSync();
    } catch (err) {
        console.warn('Outbox mirror failed:', err);
    }
}

// ---------- لما البرنامج يصحى: اللي بعته عامل الخلفية ----------
let bgAbsorbing = false;
async function absorbBackgroundSync() {
    if (!bgSyncSupported() || bgAbsorbing) return 0;
    bgAbsorbing = true;
    try { return await withOutboxLock(() => absorbBackgroundSyncLocked()); }
    catch (err) { console.warn('Absorb failed:', err); return 0; }
    finally { bgAbsorbing = false; }
}

// لازم يكون جوّا القفل
async function absorbBackgroundSyncLocked() {
    let rec = null;
    try { rec = await bgRequest('readonly', store => store.get('outbox')); } catch (e) { return 0; }
    const done = Array.isArray(rec?.done) ? rec.done : [];
    if (!done.length) return 0;
    let sent = 0, rejected = 0, locked = 0, conflicted = 0;
    done.forEach(({ qid, res }) => {
        const i = outbox.findIndex(op => op._qid === qid);
        if (i < 0) return;
        const op = outbox[i];
        outbox.splice(i, 1);
        if (res?.error === 'conflict' || res?.error === 'conflict_group') { holdConflict(op, res); conflicted++; }
        else if (res?.ok) { applyWriteResult(op, res); sent++; }
        else if (res?.error === 'day_locked') locked++;
        else rejected++;
    });
    await bgRequest('readwrite', store => store.put({ ...rec, ops: outbox, done: [] }, 'outbox'));
    if (conflicted) holdChainedConflicts();
    saveAll();
    if (sent) showToast('✓ انبعتت بالخلفية', `${sent} ${sent === 1 ? 'عملية' : 'عمليات'} وصلت للشيت لما رجع النت والبرنامج مسكّر`, 'success');
    if (rejected) showToast('عملية مرفوضة', `${rejected > 1 ? rejected + ' عمليات' : 'عملية'} لا تملك صلاحيتها، لم تُحفظ في الشيت`, 'error');
    if (locked) showToast('اليوم مقفل بعد الجرد', `${locked > 1 ? locked + ' عمليات' : 'عملية'} على أيام انعمل إلها جرد ما انحفظت`, 'error');
    if (sent || rejected || locked || conflicted) {
        lastFullLoadMs = 0;
        setTimeout(() => loadFromSheets({ silent: dataState === 'ready' }), 0);
    }
    return sent + rejected + locked + conflicted;
}

function clearBackgroundOutbox() {
    bgRequest('readwrite', store => store.delete('outbox')).catch(() => { /* ما في */ });
}

// ---------- فتح البرنامج بدون نت (عامل الخلفية بيحفظ ملفاته) ----------
// بعد أول قراءة ناجحة بكل فتحة: بنبعت للعامل قائمة ملفات البرنامج (الصفحة، الأنماط، js بنسختها ?v=، الشعارات،
// الخطوط، ومكتبات الفاتورة) فبيحفظها، وبيشيل النسخ القديمة. الشيت (Apps Script) مش منها
let appShellSent = false;
async function cacheAppShell() {
    if (appShellSent || !('serviceWorker' in navigator)) return;
    const reg = await ensureServiceWorker();
    if (!reg) return;
    appShellSent = true;
    try {
        const ready = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 8000))]);
        const sw = ready?.active || reg.active;
        if (!sw) { appShellSent = false; return; }
        const sheet = (globalConfig.driveWebhook || '').trim();
        const urls = new Set([
            ...[...document.querySelectorAll('link[rel="stylesheet"][href], link[rel="manifest"][href], link[rel~="icon"][href], link[rel="apple-touch-icon"][href], script[src]')].map(el => el.href || el.src),
            ...Object.values(RECEIPT_LIBS),
            new URL('assets/icon-192.png', location.href).href,
            new URL('assets/icon-512.png', location.href).href,
            ...performance.getEntriesByType('resource').map(e => e.name)
        ]);
        const list = [...urls].filter(u => u && !u.startsWith('data:') && !u.startsWith(sheet) && !/script\.google|googleusercontent|firebase-messaging-sw/.test(u));
        sw.postMessage({ type: 'precache', urls: list, page: location.origin + location.pathname });
    } catch (err) {
        appShellSent = false;
        console.warn('App shell cache failed:', err);
    }
}
