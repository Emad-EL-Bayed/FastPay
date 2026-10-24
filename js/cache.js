'use strict';

// فاست باي — النسخة المحفوظة على الجهاز والشيمر (بطلب عماد 2026-10-18)
// البرنامج كان يستنى الشيت عند كل فتح ("جاري التحميل…" والشاشة فاضية). هلّق آخر بيانات وصلت بتنحفظ بالجهاز
// (IndexedDB، لكل مستخدم ورابط شيت لحاله) وبتطلع فوراً عند الفتح وعليها لمعة (stale)، وبنفس اللحظة بنجيب من الشيت
// اللي تغيّر من آخر مرة. أول ما يوصل: اللمعة بتوقف، واللي تغيّر بيومض لحظة.
// - لحد ما يوصل الشيت: تعديل وحذف الحركات الموجودة مقفول (staleBlocks)، والجديد مسموح.
// - بدون نت: النسخة بتضل باهتة بدون لمعة مع "مش متصل · آخر نسخة قبل…".
// - تسجيل الخروج أو انتهاء الجلسة بيمسحها. الشيت بيضل المصدر الوحيد: النسخة للعرض السريع بس.

const SNAP_DB = 'fastpay-cache';
const SNAP_STORE = 'snapshots';
const SNAP_VERSION = 1;
let snapDbPromise = null;
let snapshotAt = 0;

function snapDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('no_idb'));
    snapDbPromise ??= new Promise((resolve, reject) => {
        const req = indexedDB.open(SNAP_DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(SNAP_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('blocked'));
    }).catch(err => { snapDbPromise = null; throw err; });
    return snapDbPromise;
}

async function snapRequest(mode, fn) {
    const db = await snapDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SNAP_STORE, mode);
        const req = fn(tx.objectStore(SNAP_STORE));
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

const snapKey = () => `${session?.username || ''}|${String(globalConfig.driveWebhook || '').trim()}`;
// بدون انتظار طويل: إذا الجهاز بطيء بقراءة النسخة بنكمّل زي قبل
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

function clearSnapshot() {
    clearTimeout(snapTimer);
    snapRequest('readwrite', store => store.clear()).catch(() => { /* ما في نسخة */ });
}

// ---------- الحفظ (بعد كل قراءة ناجحة من الشيت) ----------
let snapTimer = null;
function scheduleSnapshot() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(saveSnapshot, 800);
}

async function saveSnapshot() {
    if (dataState !== 'ready' || !globalConfig.driveWebhook || (authEnabled && !session?.token)) return;
    const collections = {};
    Object.entries(COLLECTION_NORMALIZERS).forEach(([name, c]) => { collections[name] = c.get(); });
    // الشعارات كبيرة ومحفوظة لحالها (STORAGE.traderLogos)
    collections.traders = traders.map(({ logo, ...t }) => t);
    const snap = {
        v: SNAP_VERSION, key: snapKey(), savedAt: Date.now(),
        cursor: syncCursor, lastFull: lastFullLoadMs, epoch: dataEpoch, features: sheetFeatures,
        flags: { sheetSupportsExpenses, sheetSupportsTraders, sheetSupportsWallets, sheetSupportsEgp, sheetSupportsCountries },
        collections, stamps: [...rowStamps], people: peopleNames, push: pushState,
        // آخر قيم الإعدادات المشتركة بالشيت: حتى تعديل إعداد بعد الفتح (قبل أي قراءة كاملة) يوصل الشيت فوراً
        shared: { ...sharedSnapshot }, sharedReady
    };
    try {
        await snapRequest('readwrite', store => store.put(snap, 'main'));
        snapshotAt = snap.savedAt;
    } catch (err) {
        console.warn('Snapshot save failed:', err);
    }
}

// ---------- الفتح: النسخة المحفوظة فوراً ----------
async function restoreSnapshot() {
    if (!globalConfig.driveWebhook || (authEnabled && !session?.token)) return false;
    let snap = null;
    try { snap = await withTimeout(snapRequest('readonly', store => store.get('main')), 1500); } catch (e) { return false; }
    if (!snap || snap.v !== SNAP_VERSION || snap.key !== snapKey() || !snap.collections) return false;
    // الشيت سبق النسخة (ما بنرجع لورا)
    if (dataState !== 'loading') return false;
    const logos = loadTraderLogos();
    Object.entries(COLLECTION_NORMALIZERS).forEach(([name, c]) => {
        c.set((Array.isArray(snap.collections[name]) ? snap.collections[name] : []).map(c.norm).filter(c.ok));
    });
    traders.forEach(t => { t.logo = logos[t.id] || ''; });
    const f = snap.flags || {};
    sheetSupportsExpenses = f.sheetSupportsExpenses !== false;
    sheetSupportsTraders = f.sheetSupportsTraders !== false;
    sheetSupportsWallets = f.sheetSupportsWallets !== false;
    sheetSupportsEgp = f.sheetSupportsEgp !== false;
    sheetSupportsCountries = !!f.sheetSupportsCountries;
    sheetFeatures = Array.isArray(snap.features) ? snap.features : [];
    // كان الإعداد المعدّل بعد الفتح يستنى أول قراءة كاملة (لحد 30 دقيقة)، وهي كانت ترجّعه للقديم (2026-10-22)
    if (snap.sharedReady && snap.shared && typeof snap.shared === 'object') {
        Object.assign(sharedSnapshot, snap.shared);
        sharedReady = true;
    }
    sheetSupportsFinalAdjust = sheetHas('finalAdjust');
    syncIbanField($('calc_iban'), $('calc_iban_hint'));
    syncBankAccountField($('calc_bank_account'));
    runLiveCalc();
    syncCursor = snap.cursor || null;
    lastFullLoadMs = snap.lastFull || 0;
    dataEpoch = snap.epoch ?? null;
    rowStamps = new Map(Array.isArray(snap.stamps) ? snap.stamps : []);
    if (snap.people) peopleNames = snap.people;
    if (snap.push) pushState = snap.push;
    // التغييرات اللي لسا ما وصلت الشيت بتضل ظاهرة فوق النسخة
    outbox.forEach(applyOpLocally);
    sortLedger();
    snapshotAt = snap.savedAt || 0;
    setDataStatus('stale', staleStatusText(false));
    renderDataViews();
    return true;
}

// بدء البيانات عند فتح البرنامج: النسخة أول (إذا في)، وبعدين الشيت
async function startDataLoad() {
    await restoreSnapshot();
    loadFromSheets();
}

// ---------- الشريط ----------
function agoText(ms) {
    const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (min < 1) return 'هلّق';
    if (min < 60) return `قبل ${min === 1 ? 'دقيقة' : min === 2 ? 'دقيقتين' : min + ' دقايق'}`;
    const h = Math.round(min / 60);
    if (h < 24) return `قبل ${h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : h + ' ساعات'}`;
    const d = Math.round(h / 24);
    return `قبل ${d === 1 ? 'يوم' : d === 2 ? 'يومين' : d + ' أيام'}`;
}

function staleStatusText(offline) {
    const ago = snapshotAt ? ` (${agoText(snapshotAt)})` : '';
    return offline
        ? `مش متصل بالشيت · هاي آخر نسخة محفوظة${ago}. بتقدر تسجّل الجديد، وتعديل الموجود بيرجع لما يتحدث`
        : `⟳ آخر نسخة محفوظة${ago} · عم يتحدث من الشيت…`;
}

// ---------- قفل تعديل الموجود لحد ما يتحدث ----------
// تعديل/حذف حركة موجودة، الدفع على حوالة أو USDT أو جنيه، التصفير، والاسترجاع من المحذوفات.
// (المستخدمين مش من النسخة، فمش مقفولين)
const STALE_EDIT_ACTIONS = /^(edit|delete)-(?!user$)|^(txd-edit|service-edit|tx-pay|usdt-pay|egp-pay|settle-trader|restore-deleted|tx-approve|tx-flag-ok|notice-pick|gone-contacted)$/;
const staleBlocks = (action) => dataState === 'stale' && STALE_EDIT_ACTIONS.test(String(action || ''));

function warnStale() {
    const offline = document.body.classList.contains('data-offline');
    showToast(offline ? 'مش متصل بالشيت' : 'لحظة، عم يتحدث من الشيت',
        offline ? 'تعديل وحذف الحركات الموجودة بيرجع لما يرجع النت ويتحدث. الجديد بتقدر تسجّله عادي'
            : 'ثواني وبتقدر تعدّل (حتى ما تعدّل على نسخة قديمة)', 'info');
}

// ---------- اللي تغيّر بيومض لحظة ----------
// before: آخر تحديث لكل سطر قبل القراءة. السطر/الكرت اللي فيه زر أو رابط عليه رقم الحركة (data-id)
function flashChangedRows(before) {
    if (motionReduced()) return;
    const ids = new Set();
    rowStamps.forEach((v, k) => { if (before.get(k) !== v) ids.add(k.slice(k.indexOf(':') + 1)); });
    if (!ids.size || ids.size > 40) return;
    requestAnimationFrame(() => {
        const seen = new Set();
        ids.forEach(id => {
            document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach(el => {
                const box = el.closest('tr, .trader-card, .acc-card, .st-row, .tw-row, .tsv-card, .ready-card, li');
                if (!box || seen.has(box) || !box.offsetParent) return;
                seen.add(box);
                replayClass(box, 'row-changed');
            });
        });
    });
}

// ---------- شريط "ما في إنترنت" (أيقونة متحركة، فوق كل الصفحات) ----------
// بيطلع لما الجهاز بدون نت، أو النسخة المحفوظة معروضة والشيت مش متصل. بيحكي شو اللي قدامك وشو صاير بالمعلّق
const offlineBannerShown = () => !$('offline-banner').classList.contains('hidden');

function renderOfflineBanner() {
    const banner = $('offline-banner');
    if (!banner) return;
    const noNet = navigator.onLine === false;
    const staleOffline = document.body.classList.contains('data-offline');
    const noData = (dataState === 'error' || dataState === 'loading') && noNet;
    const show = noNet || staleOffline;
    banner.classList.toggle('hidden', !show);
    if (!show) return;
    $('offline-title').textContent = noNet ? 'ما في إنترنت' : 'الشيت مش متصل';
    const pending = outbox.length;
    $('offline-text').textContent = [
        noData ? 'أول فتحة على هالجهاز بدها نت حتى تنزل البيانات، بعدها البرنامج بينفتح حتى بدونه.'
            : staleOffline ? `اللي قدامك آخر نسخة محفوظة${snapshotAt ? ' (' + agoText(snapshotAt) + ')' : ''}.`
            : 'اللي قدامك آخر إشي وصل من الشيت.',
        pending ? `${pending === 1 ? 'عملية وحدة محفوظة' : pending + ' عمليات محفوظة'} عندك وبتنبعت لحالها لما يرجع النت.`
            : noData ? '' : 'اللي بتسجّله بينحفظ عندك وبينبعت لحاله لما يرجع النت.'
    ].filter(Boolean).join(' ');
}

// ---------- لما ما في نسخة: أسطر فاضية بتلمع بمكان البيانات ----------
function skeletonLines(n = 4) {
    return `<span class="skel-list" aria-label="جاري التحميل">${Array.from({ length: n }, (_, i) => `<span class="skel-line" style="width:${[92, 78, 86, 64, 88][i % 5]}%"></span>`).join('')}</span>`;
}
