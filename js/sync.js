'use strict';

// فاست باي — Google Sheets: القراءة والتحديث السريع وصندوق العمليات المعلقة
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= Google Sheets: القراءة والمزامنة =================
// يُرسل الطلب كنص عادي (بدون preflight) حتى نستطيع قراءة رد السكربت والتأكد من الوصول.
// الحالات: ok | failed (ومعها error؛ 'network' = ما وصل رد) | disabled
async function postToSheets(payload, { noSession = false } = {}) {
    const url = (globalConfig.driveWebhook || '').trim();
    if (!url) return { status: 'disabled' };
    if (navigator.onLine === false) return { status: 'failed', error: 'offline' };

    const extra = {};
    if (globalConfig.syncToken) extra.token = globalConfig.syncToken;
    if (session?.token && !noSession) {
        extra.session = session.token;
        // اسم الجهاز لقائمة "الأجهزة المسجّلة" (السكربت بيكتبه للجلسة اللي ما إلها اسم، وآخر استعمال كل 10 دقايق)
        if (!payload.device) extra.device = pushDeviceLabel();
    }
    const body = JSON.stringify({ ...payload, ...extra });
    try {
        const res = await fetch(url, { method: 'POST', body });
        if (!res.ok) return { status: 'failed', error: 'HTTP ' + res.status };
        let data = null;
        try { data = JSON.parse(await res.text()); } catch (_) { /* السكربت القديم لا يرد بـ JSON */ }
        if (data && data.ok === false) {
            if (data.error === 'auth_required' && payload.action !== 'login') onAuthRequired();
            return { status: 'failed', error: data.error || 'rejected', data };
        }
        return { status: 'ok', data };
    } catch (e) {
        // ما وصل رد: النت قطع أو ضعيف (شبكة بدون إنترنت، التطبيق راح للخلفية بالنص...). بنعتبرها ما وصلت،
        // فالعمليات بتضل بالانتظار وبتنبعت مرة ثانية. كانت تنحسب "وصلت غالباً" وتنشال فتضيع (2026-10-17).
        // إعادة الإرسال آمنة: كل عملية بالانتظار حفظ أو حذف برقم ثابت، فما بتتكرر
        return { status: 'failed', error: 'network' };
    }
}

// ---------- قراءة الزبائن والحوالات من الشيت ----------
// state: loading (لسا ما في بيانات) / stale (النسخة المحفوظة معروضة لحد ما يوصل الشيت) / ready / error.
// offline: النسخة المحفوظة والشيت مش متصل (اللمعة بتوقف والبيانات بتضل باهتة)
function setDataStatus(state, message = '', { offline = false } = {}) {
    dataState = state;
    if (state === 'error') sheetReadFailed = true;
    document.body.classList.toggle('data-loading', state === 'loading');
    document.body.classList.toggle('data-stale', state === 'stale');
    document.body.classList.toggle('data-offline', state === 'stale' && offline);
    // بدون نت: الشريط المتحرك (offline-banner) بدل هاد
    $('data-status-bar').classList.toggle('hidden', state === 'ready' || (state === 'stale' && offline) || (state === 'error' && navigator.onLine === false));
    $('data-status-bar').classList.toggle('!border-rose-200', state === 'error');
    $('data-status-text').textContent = message;
    $('data-status-text').className = 'font-bold ' + (state === 'error' ? 'text-rose-700' : 'text-slate-600');
    $('data-status-retry').classList.toggle('hidden', !(state === 'error' || (state === 'stale' && offline)));
    // أثناء التحميل نمنع الحفظ حتى لا تختلط البيانات القديمة بالجديدة
    $('save-tx-btn').disabled = state === 'loading';
    renderOfflineBanner();
}

function renderDataViews() {
    renderPositionPage();
    renderTraders();
    renderUsdtPage();
    renderEgpPage();
    renderAccountsPage();
    renderLedgerTable();
    renderRecentTx();
    renderCustomersTable();
    renderExpenses();
    renderReadyPage();
    updateReportsData();
    updateSyncPendingBar();
}

function sortLedger() {
    ledger.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

let loadSeq = 0;

// التحديث السريع: بعد أول تحميل كامل نطلب فقط ما تغيّر منذ آخر قراءة (since)،
// ونعيد التحميل الكامل كل 30 دقيقة أو عند الضغط على "تحديث من الشيت" كاحتياط
const FULL_RELOAD_MS = 30 * 60 * 1000;
let syncCursor = null;
let lastFullLoadMs = 0;
// ميزات السكربت المنشور (features في رد list): الخانات اللي بتحتاج أعمدة أو عمليات جديدة بتشتغل بس معه
let sheetFeatures = [];
const sheetHas = (f) => sheetFeatures.includes(f);
// بيتغير لما تنمسح البيانات التجريبية (من أي جهاز): ساعتها بنعمل تحميل كامل
let dataEpoch = null;

const COLLECTION_NORMALIZERS = {
    ledger: { get: () => ledger, set: (v) => { ledger = v; }, norm: (r) => normalizeTx(r), ok: (x) => x.id },
    customers: { get: () => customers, set: (v) => { customers = v; }, norm: (r) => normalizeCustomer(r), ok: (x) => x.id && x.name },
    expenses: { get: () => expenses, set: (v) => { expenses = v; }, norm: (r) => normalizeExpense(r), ok: (x) => x.id },
    traders: { get: () => traders, set: (v) => { traders = v; }, norm: (r) => normalizeTrader(r), ok: (x) => x.id && x.name },
    traderMoves: { get: () => traderMoves, set: (v) => { traderMoves = v; }, norm: (r) => normalizeTmove(r), ok: (x) => x.id && x.traderId },
    traderServices: { get: () => traderServices, set: (v) => { traderServices = v; }, norm: (r) => normalizeService(r), ok: (x) => x.id && x.name },
    countries: { get: () => countries, set: (v) => { countries = v; }, norm: (r) => normalizeCountry(r), ok: (x) => x.name },
    accounts: { get: () => accounts, set: (v) => { accounts = v; }, norm: (r) => normalizeAccount(r), ok: (x) => x.id },
    accountMoves: { get: () => accountMoves, set: (v) => { accountMoves = v; }, norm: (r) => normalizeAmove(r), ok: (x) => x.id && x.accountId },
    usdtMoves: { get: () => usdtMoves, set: (v) => { usdtMoves = v; }, norm: (r) => normalizeUsdt(r), ok: (x) => x.id },
    egpWallets: { get: () => egpWallets, set: (v) => { egpWallets = v; }, norm: (r) => normalizeEgpWallet(r), ok: (x) => x.id },
    egpMoves: { get: () => egpMoves, set: (v) => { egpMoves = v; }, norm: (r) => normalizeEgp(r), ok: (x) => x.id },
    closings: { get: () => closings, set: (v) => { closings = v; }, norm: (r) => normalizeClosing(r), ok: (x) => x.id },
    readyAccounts: { get: () => readyAccounts, set: (v) => { readyAccounts = v; }, norm: (r) => normalizeReady(r), ok: (x) => x.id && x.name },
    readySends: { get: () => readySends, set: (v) => { readySends = v; }, norm: (r) => normalizeReadySend(r), ok: (x) => x.id }
};

// ---------- تسعير الدول من الشيت ----------
// الشيت هو المصدر، والمتصفح يحتفظ بنسخة حتى تعمل الحاسبة فوراً عند الفتح.
// أول مرة يكون فيها جدول التسعير في الشيت فارغاً نرفع له التسعير المحفوظ في المتصفح.
function applySheetCountries(rows) {
    sheetSupportsCountries = true;
    const list = rows.map(normalizeCountry).filter(c => c.name);
    if (list.length) {
        countries = list;
    } else if (!globalConfig.countriesSeeded && countries.length && !outbox.some(op => op.action === 'upsert_country')) {
        queueOps(...countries.map(c => ({ action: 'upsert_country', country: c })));
        flushOutbox();
    }
    if (!globalConfig.countriesSeeded) {
        globalConfig.countriesSeeded = true;
        saveAll(); // نحفظ أرقام الدول حتى لا تتكرر إن أُعيد الرفع
    }
}

// بعد أي تغيير في التسعير من الشيت: ترتيب، حفظ النسخة، وتحديث الحاسبة والجدول
function afterCountriesChanged(before) {
    countries.forEach((c, i) => { if (!Number.isFinite(c.order)) c.order = i; });
    countries.sort((a, b) => a.order - b.order);
    if (JSON.stringify(countries) === before) return;
    saveAll();
    const current = calcSource && !calcSource.other ? countries.find(c => c.name === calcSource.name) : null;
    if (current && ['type', 'factor', 'costMode', 'costValue', 'profitPct'].some(k => current[k] !== calcSource[k])) {
        calcSource = { ...current };
        applySourceToInputs();
        runLiveCalc();
    }
    renderSourceGrid();
    if (!pageHidden('countries')) renderCountriesTable();
}

// ---------- "مين عدّل قبلي": آخر تحديث لكل سطر ----------
// 'ledger:123' ← '2026-10-18 21:00:00' زي ما وصلنا من الشيت (أو من رد الحفظ). كل تعديل أو حذف بيبعته
// معه (_base)، والسكربت ما بيكتب فوق سطر تغيّر بعدها (conflicts.js بيسأل)
let rowStamps = new Map();
const stampKey = (name, id) => name + ':' + String(id);

function takeStamps(data, full) {
    if (full) rowStamps = new Map();
    Object.keys(COLLECTION_NORMALIZERS).forEach(name => {
        (Array.isArray(data[name]) ? data[name] : []).forEach(r => {
            if (r && r.id !== undefined && r.id !== '' && r.updatedAt) rowStamps.set(stampKey(name, r.id), String(r.updatedAt));
        });
    });
    (data.deleted || []).forEach(d => rowStamps.delete(stampKey(d.c, d.id)));
}

// العملية على أي سطر: [القائمة، مكان السطر بالعملية] (الحذف بـ op.id)
const OP_ROWS = {
    upsert: ['ledger', null], delete: ['ledger', null],
    upsert_customer: ['customers', 'customer'], delete_customer: ['customers', null],
    upsert_expense: ['expenses', 'expense'], delete_expense: ['expenses', null],
    upsert_trader: ['traders', 'trader'], delete_trader: ['traders', null],
    upsert_tmove: ['traderMoves', 'move'], delete_tmove: ['traderMoves', null],
    upsert_service: ['traderServices', 'service'], delete_service: ['traderServices', null],
    upsert_country: ['countries', 'country'], delete_country: ['countries', null],
    upsert_account: ['accounts', 'account'], delete_account: ['accounts', null],
    upsert_amove: ['accountMoves', 'move'], delete_amove: ['accountMoves', null],
    upsert_usdt: ['usdtMoves', 'move'], delete_usdt: ['usdtMoves', null],
    upsert_egp_wallet: ['egpWallets', 'wallet'], delete_egp_wallet: ['egpWallets', null],
    upsert_egp: ['egpMoves', 'move'], delete_egp: ['egpMoves', null],
    upsert_closing: ['closings', 'closing'],
    // الحسابات الجاهزة: السكربت ما بيفحص "مين عدّل قبلي" عليها (النسخ بيغيّر آخر تحديث كل شوي)، بس آخر تحديث بيتسجّل
    upsert_ready: ['readyAccounts', 'ready'], delete_ready: ['readyAccounts', null], use_ready: ['readyAccounts', null]
};
const opIsDelete = (op) => op.action === 'delete' || String(op.action || '').startsWith('delete_');

function opRowKey(op) {
    const t = OP_ROWS[op?.action];
    if (!t) return null;
    const id = opIsDelete(op) ? op.id : (t[1] ? op[t[1]] : op)?.id;
    return id === undefined || id === null || id === '' ? null : stampKey(t[0], id);
}

// يدمج الصفوف المتغيرة والمحذوفة في البيانات الموجودة
function mergeIncremental(data) {
    Object.entries(COLLECTION_NORMALIZERS).forEach(([name, c]) => {
        const changed = (Array.isArray(data[name]) ? data[name] : []).map(c.norm).filter(c.ok);
        const removed = new Set((data.deleted || []).filter(d => d.c === name).map(d => String(d.id)));
        if (!changed.length && !removed.size) return;
        const byId = new Map(changed.map(x => [String(x.id), x]));
        const list = c.get().filter(x => !removed.has(String(x.id)) && !byId.has(String(x.id)));
        // الشعار لا يأتي مع التاجر، فنحتفظ بالمعروض حتى نتحقق من بصمته
        if (name === 'traders') changed.forEach(t => { t.logo = traders.find(x => x.id === t.id)?.logo || ''; });
        c.set(list.concat(changed.filter(x => !removed.has(String(x.id)))));
    });
}

// النسخة المحفوظة (cache.js) بتتحدث بالسريع إذا آخر تحميل كامل خلال يوم، وبعدها تحميل كامل بالخلفية
const STALE_QUICK_MS = 24 * 60 * 60 * 1000;

async function loadFromSheets({ manual = false, silent = false } = {}) {
    if (!globalConfig.driveWebhook) {
        setLiveIndicator(false);
        setDataStatus('error', 'لا يوجد رابط Google Sheets. أضفه من الإعدادات لقراءة الزبائن والحوالات.');
        renderDataViews();
        return;
    }

    const seq = ++loadSeq;
    // النسخة المحفوظة معروضة: ما بنمسحها، بس بتلمع لحد ما يوصل الشيت
    const stale = dataState === 'stale';
    if (stale) setDataStatus('stale', staleStatusText(false));
    else if (!silent) {
        setDataStatus('loading', 'جاري تحميل الزبائن والحوالات من Google Sheets...');
        renderDataViews();
    }
    sheetReading = true;
    updateLiveCard();

    // نرسل العمليات المعلقة أولاً حتى تكون القراءة محدّثة
    await flushOutbox();
    const quick = !manual && syncCursor && (stale
        ? Date.now() - lastFullLoadMs < STALE_QUICK_MS
        : silent && dataState === 'ready' && Date.now() - lastFullLoadMs < FULL_RELOAD_MS);
    const result = await postToSheets(quick ? { action: 'list', since: syncCursor } : { action: 'list' });
    if (seq !== loadSeq) return; // وصل طلب تحميل أحدث
    sheetReading = false;

    const data = result.data;
    if (result.error === 'auth_required') {
        clearSnapshot();
        sheetReadFailed = true;
        setLiveIndicator(false);
        setDataStatus('error', 'سجّل الدخول لعرض البيانات');
        return;
    }
    if (result.status !== 'ok' || !data || !Array.isArray(data.ledger)) {
        const reason = result.error === 'unauthorized' ? 'مفتاح الحماية غير صحيح، راجع الإعدادات.'
            : result.error === 'offline' ? 'لا يوجد اتصال بالإنترنت.'
            : 'تأكد من نشر السكربت الجديد (google-apps-script.gs) ومن صحة الرابط.';
        sheetReadFailed = true;
        setLiveIndicator(false);
        // النسخة المحفوظة بتضل معروضة (باهتة) مع "مش متصل"
        if (stale) {
            setDataStatus('stale', staleStatusText(true), { offline: true });
            if (manual) showToast('تعذرت المزامنة', reason, 'error');
            return;
        }
        // التحديث الصامت لا يمسح البيانات المعروضة عند الفشل
        if (silent) {
            if (manual) showToast('تعذرت المزامنة', reason, 'error');
            return;
        }
        setDataStatus('error', 'تعذر قراءة البيانات من Google Sheets. ' + reason);
        renderDataViews();
        return;
    }

    // البيانات انمسحت أو رجعت من نسخة احتياطية من جهاز ثاني: التحديث السريع ما بيكفي
    if (data.incremental && dataEpoch !== null && (data.dataEpoch || '') !== dataEpoch) {
        lastFullLoadMs = 0;
        showToast('تحدّثت البيانات', 'البيانات بالشيت تغيّرت (مسح أو استرجاع نسخة احتياطية)، رجعنا حمّلناها من جديد', 'info');
        return loadFromSheets({ silent: true });
    }
    const changedCount = data.incremental
        ? Object.keys(COLLECTION_NORMALIZERS).reduce((n, k) => n + (data[k]?.length || 0), 0) + (data.deleted?.length || 0)
        : -1;
    const countriesBefore = JSON.stringify(countries);
    const servicesBefore = JSON.stringify(traderServices);
    // اللي تغيّر من آخر مرة بيومض لحظة بعد الرسم (مش بأول تحميل بدون نسخة)
    const stampsBefore = stale || silent ? new Map(rowStamps) : null;
    // آخر تحديث لكل سطر من هالقراءة، قبل أي عملية بتنضاف هون (رفع التسعير لما ورقته فاضية): كان ياخد _base من النسخة المحفوظة القديمة
    takeStamps(data, !data.incremental);
    if (data.incremental) {
        mergeIncremental(data);
    } else {
        if (Array.isArray(data.countries)) applySheetCountries(data.countries);
        else sheetSupportsCountries = false;
        const previousLogos = new Map(traders.map(t => [t.id, t.logo]));
        ledger = data.ledger.map(normalizeTx).filter(t => t.id);
        customers = (Array.isArray(data.customers) ? data.customers : []).map(normalizeCustomer).filter(c => c.id && c.name);
        sheetSupportsExpenses = Array.isArray(data.expenses);
        expenses = (data.expenses || []).map(normalizeExpense).filter(e => e.id);
        sheetSupportsTraders = Array.isArray(data.traders);
        traders = (data.traders || []).map(normalizeTrader).filter(t => t.id && t.name);
        traders.forEach(t => { if (!t.logo && previousLogos.get(t.id)) t.logo = previousLogos.get(t.id); });
        traderMoves = (data.traderMoves || []).map(normalizeTmove).filter(m => m.id && m.traderId);
        traderServices = (data.traderServices || []).map(normalizeService).filter(x => x.id && x.name);
        sheetSupportsWallets = Array.isArray(data.accounts);
        accounts = (data.accounts || []).map(normalizeAccount).filter(a => a.id);
        accountMoves = (data.accountMoves || []).map(normalizeAmove).filter(m => m.id && m.accountId);
        usdtMoves = (data.usdtMoves || []).map(normalizeUsdt).filter(m => m.id);
        // السكربت القديم لا يرسل أوراق الجنيه
        sheetSupportsEgp = Array.isArray(data.egpMoves);
        sheetFeatures = Array.isArray(data.features) ? data.features : [];
        sheetSupportsFinalAdjust = sheetHas('finalAdjust');
        // خانات IBAN ورقم الحساب و± بالحاسبة بتنفتح لما يكون السكربت بيدعمها
        syncIbanField($('calc_iban'), $('calc_iban_hint'));
        syncBankAccountField($('calc_bank_account'));
        runLiveCalc();
        dataEpoch = data.dataEpoch || '';
        egpWallets = (data.egpWallets || []).map(normalizeEgpWallet).filter(w => w.id);
        egpMoves = (data.egpMoves || []).map(normalizeEgp).filter(m => m.id);
        closings = (data.closings || []).map(normalizeClosing).filter(c => c.id);
        readyAccounts = (data.readyAccounts || []).map(normalizeReady).filter(x => x.id && x.name);
        readySends = (data.readySends || []).map(normalizeReadySend).filter(x => x.id);
        lastFullLoadMs = Date.now();
    }
    // السكربت القديم لا يرسل serverTime، فيبقى التحميل كاملاً في كل مرة
    syncCursor = data.serverTime || null;
    updateAuthFromServer(data);
    // سعر السوق (زي الشاشة) من السكربت مع كل قراءة
    if (data.market) useScriptMarket(data.market);
    // الإشعارات (notify.js): مع كل قراءة، الكاملة بتبدّل القائمة والسريعة بتضيف
    if (Array.isArray(data.team)) notifyTeam = data.team;
    if (data.serverTime) notifyCursor = data.serverTime;
    if ('notifications' in data) applyNotifications(data.notifications, { full: !data.incremental });
    if ('dailyPush' in data) dailyPushState = data.dailyPush;
    if ('ownerEmail' in data) scriptOwnerEmail = data.ownerEmail || '';
    if ('push' in data) applyPushState(data.push, !data.incremental);
    else renderNotifyBadge();
    if ('lastBackup' in data) { lastBackupAt = data.lastBackup || ''; renderBackupStatus(); }
    // المسح لمرة وحدة: بعده زر المسح بيختفي
    if ('resetDone' in data && JSON.stringify(data.resetDone || null) !== JSON.stringify(resetUsed)) {
        resetUsed = data.resetDone || null;
        renderAdminTools();
    }
    if (Array.isArray(data.settings)) applySharedSettings(data.settings, !data.incremental);
    syncTraderLogos(data.traders || []);
    afterCountriesChanged(countriesBefore);
    if (traderViewOpen()) renderTraderPanel();
    // التغييرات التي لم تصل للشيت بعد تبقى ظاهرة
    outbox.forEach(applyOpLocally);
    // خدمات التجار تغيّرت (من جهاز ثاني): لوحة التاجر وكروت التجار
    if (JSON.stringify(traderServices) !== servicesBefore) afterServicesChanged();
    sortLedger();

    sheetReadFailed = false;
    lastUpdateAt = nowTimeLabel();
    setDataStatus('ready');
    checkLowBalances();
    setLiveIndicator(true);
    // التحديث السريع بدون تغييرات لا يعيد رسم الصفحة
    if (changedCount !== 0 || !silent || stale) renderDataViews();
    if (stampsBefore) flashChangedRows(stampsBefore);
    refreshOpenReceipt();
    scheduleSnapshot();
    // ملفات البرنامج على الجهاز حتى ينفتح بدون نت (مرة بكل فتحة)
    cacheAppShell();
    if (manual) showToast('تم التحديث من الشيت', `${ledger.length} حوالة، ${customers.length} زبون، ${expenses.length} مصروف`, 'info');
    // من النسخة المحفوظة بالسريع، وآخر تحميل كامل قديم: تحميل كامل بالخلفية (بيلقط اللي السريع ما بيشوفه، زي حذف سطر بإيد بالشيت)
    if (stale && quick && Date.now() - lastFullLoadMs >= FULL_RELOAD_MS) setTimeout(() => loadFromSheets({ silent: true }), 300);
    showNextConflict();
}

// ---------- الكتابة: صندوق العمليات المعلقة (Outbox) ----------
// كل تعديل يُضاف هنا ويُرسل بالترتيب. يبقى محفوظاً في المتصفح فقط حتى يصل للشيت.
let flushing = null;
let lastFlushFailed = false;
let batchSupported = true;

// عمليات القوائم البسيطة: اسم القائمة في COLLECTION_NORMALIZERS، ومكان العنصر في العملية
const UPSERT_OPS = {
    upsert_account: ['accounts', 'account'],
    upsert_amove: ['accountMoves', 'move'],
    upsert_usdt: ['usdtMoves', 'move'],
    upsert_closing: ['closings', 'closing'],
    upsert_egp: ['egpMoves', 'move'],
    upsert_egp_wallet: ['egpWallets', 'wallet'],
    upsert_service: ['traderServices', 'service']
};
const DELETE_OPS = { delete_account: 'accounts', delete_amove: 'accountMoves', delete_usdt: 'usdtMoves', delete_egp: 'egpMoves', delete_egp_wallet: 'egpWallets', delete_service: 'traderServices', delete_ready: 'readyAccounts' };

function applyOpLocally(op) {
    if (op.action === 'upsert') {
        const tx = normalizeTx(op);
        const i = ledger.findIndex(x => x.id === tx.id);
        if (i >= 0) ledger[i] = tx; else ledger.unshift(tx);
    } else if (op.action === 'delete') {
        ledger = ledger.filter(x => x.id !== toNum(op.id, NaN));
    } else if (op.action === 'upsert_customer') {
        const c = normalizeCustomer(op.customer);
        const i = customers.findIndex(x => x.id === c.id);
        if (i >= 0) customers[i] = c; else customers.unshift(c);
    } else if (op.action === 'delete_customer') {
        customers = customers.filter(x => x.id !== op.id);
    } else if (op.action === 'upsert_expense') {
        const e = normalizeExpense(op.expense);
        const i = expenses.findIndex(x => x.id === e.id);
        if (i >= 0) expenses[i] = e; else expenses.unshift(e);
    } else if (op.action === 'upsert_trader') {
        const t = normalizeTrader(op.trader);
        const i = traders.findIndex(x => x.id === t.id);
        if (!('logo' in (op.trader || {})) && i >= 0) t.logo = traders[i].logo;
        if (i >= 0) traders[i] = t; else traders.unshift(t);
    } else if (op.action === 'delete_trader') {
        traders = traders.filter(x => x.id !== op.id);
    } else if (op.action === 'upsert_tmove') {
        const m = normalizeTmove(op.move);
        const i = traderMoves.findIndex(x => x.id === m.id);
        if (i >= 0) traderMoves[i] = m; else traderMoves.push(m);
    } else if (op.action === 'delete_tmove') {
        traderMoves = traderMoves.filter(x => x.id !== toNum(op.id, NaN));
    } else if (UPSERT_OPS[op.action]) {
        const [name, field] = UPSERT_OPS[op.action];
        const c = COLLECTION_NORMALIZERS[name];
        const x = c.norm(op[field]);
        c.set(c.get().filter(y => String(y.id) !== String(x.id)).concat(x));
    } else if (DELETE_OPS[op.action]) {
        const c = COLLECTION_NORMALIZERS[DELETE_OPS[op.action]];
        c.set(c.get().filter(y => String(y.id) !== String(op.id)));
    } else if (op.action === 'upsert_country') {
        const c = normalizeCountry(op.country);
        const i = countries.findIndex(x => x.id === c.id);
        if (i >= 0) countries[i] = c; else countries.push(c);
    } else if (op.action === 'delete_country') {
        countries = countries.filter(x => x.id !== op.id);
    } else if (op.action === 'delete_expense') {
        expenses = expenses.filter(x => x.id !== toNum(op.id, NaN));
    } else if (op.action === 'upsert_ready') {
        // المحتوى بس: العدادات من الشيت
        const x = normalizeReady(op.ready);
        const old = readyAccounts.find(y => y.id === x.id);
        if (old) Object.assign(old, { name: x.name, category: x.category, details: x.details, terms: x.terms, paused: x.paused, expiresAt: x.expiresAt });
        else if (x.id && x.name) readyAccounts.push(x);
    } else if (op.action === 'use_ready') {
        // نسخ/إرسال لسا ما وصل الشيت: فوق العداد اللي إجا منه
        const x = readyAccounts.find(y => y.id === String(op.id));
        if (x) {
            x[op.kind === 'send' ? 'sends' : 'copies'] += 1;
            if (op.at && op.at > x.lastUsedAt) { x.lastUsedAt = op.at; x.lastUsedBy = session?.username || ''; }
        }
        // الإرسال لزبون: بملفه
        if (op.log?.id && !readySends.some(s => s.id === op.log.id)) {
            readySends.push(normalizeReadySend({ ...op.log, at: op.at, readyId: op.id, readyName: x?.name || '', createdBy: session?.username || '' }));
        }
    }
}

// العمليات اللي بتنضاف مع بعض مجموعة وحدة (_grp): السكربت بيفحصها كلها قبل ما يكتب (تعديل حوالة ودفعاتها مثلاً).
// كل تعديل أو حذف على سطر موجود بياخد _base = آخر تحديث شفناه إله؛ وإذا في عملية قبلها على نفس السطر لسا بالانتظار '@prev'
function queueOps(...ops) {
    const list = ops.map(op => JSON.parse(JSON.stringify(op)));
    const grp = list.length > 1 ? 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : '';
    const queued = new Set(outbox.map(opRowKey).filter(Boolean));
    list.forEach(op => {
        if (grp) op._grp = grp;
        const key = opRowKey(op);
        if (!key) return;
        if (queued.has(key)) op._base = '@prev';
        else if (rowStamps.has(key)) op._base = rowStamps.get(key);
        queued.add(key);
    });
    outbox.push(...list);
    saveAll();
}

// دفعة لحد 25 عملية، بدون ما تنقسم مجموعة بين دفعتين (إلا لو هي أكبر من 25)
function nextBatchSize() {
    let n = Math.min(25, outbox.length);
    const g = outbox[n - 1]?._grp;
    if (n < outbox.length && g && outbox[n]?._grp === g) {
        let k = n - 1;
        while (k > 0 && outbox[k - 1]._grp === g) k--;
        if (k > 0) n = k;
    }
    return n;
}

function flushOutbox() {
    // إن كان إرسال سابق جارياً ننتظره ثم نرسل ما أُضيف بعده
    if (flushing) return flushing.then(() => flushOutbox());

    // نفس قفل عامل الخلفية (bgsync.js): ما بنبعت مع بعض، واللي بعته هو بنشيله أول
    flushing = withOutboxLock(async () => {
        await absorbBackgroundSyncLocked();
        let status = outbox.length ? 'ok' : 'idle';
        renderLedgerTable();
        updateLiveCard();
        let rejected = 0, locked = 0, conflicted = 0;
        while (outbox.length) {
            if (!globalConfig.driveWebhook) { status = 'disabled'; break; }
            // عدة عمليات في طلب واحد (السكربت القديم لا يدعمها فنرجع لعملية لكل طلب)
            if (batchSupported && outbox.length > 1) {
                const ops = outbox.slice(0, nextBatchSize());
                const r = await postToSheets({ action: 'batch', ops });
                if (r.status === 'ok' && Array.isArray(r.data?.results)) {
                    let stop = false;
                    for (const res of r.data.results) {
                        // حدا عدّل السطر قبلي: العملية (ومجموعتها) بتطلع من الانتظار لحد ما تختار (conflicts.js)
                        if (res.error === 'conflict' || res.error === 'conflict_group') {
                            holdConflict(outbox.shift(), res);
                            conflicted++;
                            continue;
                        }
                        if (res.ok || res.error === 'forbidden' || res.error === 'day_locked') {
                            if (res.ok) applyWriteResult(outbox[0], res);
                            else if (res.error === 'day_locked') locked++;
                            else rejected++;
                            outbox.shift();
                            continue;
                        }
                        status = 'failed';
                        stop = true;
                        break;
                    }
                    // عمليات ورا المتعارضة على نفس السطر ما بتنبعت (كانت رح تكتب فوقه)
                    if (conflicted) holdChainedConflicts();
                    saveAll();
                    if (stop) break;
                    continue;
                }
                if (r.error === 'unknown_action') { batchSupported = false; continue; }
                // ما وصل رد: بتضل بالانتظار للمحاولة الجاية (ما بننشال إلا بعد ما السكربت يأكد)
                status = 'failed';
                break;
            }
            const r = await postToSheets(outbox[0]);
            if (r.status === 'failed' && r.error === 'conflict') {
                holdConflict(outbox.shift(), r.data || {});
                conflicted++;
                holdChainedConflicts();
                saveAll();
                continue;
            }
            // عملية لا تسمح بها الصلاحية (أو على يوم مقفل) لن تنجح أبداً: نحذفها من الانتظار
            if (r.status === 'failed' && (r.error === 'forbidden' || r.error === 'day_locked')) {
                if (r.error === 'day_locked') locked++; else rejected++;
                outbox.shift();
                saveAll();
                continue;
            }
            if (r.status !== 'ok') { status = 'failed'; break; }
            applyWriteResult(outbox[0], r.data || {});
            outbox.shift();
            saveAll();
        }
        if (rejected) showToast('عملية مرفوضة', `${rejected > 1 ? rejected + ' عمليات' : 'عملية'} لا تملك صلاحيتها، لم تُحفظ في الشيت`, 'error');
        if (locked) showToast('اليوم مقفل بعد الجرد', `${locked > 1 ? locked + ' عمليات' : 'عملية'} على أيام انعمل إلها جرد ما انحفظت. اطلب من المدير يفتح الأيام.`, 'error');
        // عمليات ورا عملية متعارضة على نفس السطر بتستنى معها
        if (conflicted) holdChainedConflicts();
        // المرفوض كان ظاهر عندنا (والمتعارض: بيبين اللي بالشيت لحد ما تختار): نرجع نحمّل من الشيت
        if (rejected || locked || conflicted) {
            lastFullLoadMs = 0;
            setTimeout(() => loadFromSheets({ silent: true }), 0);
            if (conflicted) setTimeout(showNextConflict, 0);
        }
        lastFlushFailed = status === 'failed' || status === 'disabled';
        if (status === 'ok') lastUpdateAt = nowTimeLabel();
        // ما وصلت (النت مقطوع): الأندرويد بيبعتها بالخلفية أول ما يرجع النت حتى لو سكّرت البرنامج
        if (status === 'failed') setTimeout(requestBackgroundSync, 0);
        return status;
    }).finally(() => {
        flushing = null;
        saveAll();
        renderLedgerTable();
    });
    return flushing;
}

// السكربت بيرجّع رقم الإيصال للحوالة أو حركة USDT/الجنيه الجديدة: نحطه عندنا فوراً (الفاتورة بتنفتح بعد الحفظ)
function applyWriteResult(op, res) {
    if (!op || !res) return;
    const key = opRowKey(op);
    if (key) {
        if (opIsDelete(op)) rowStamps.delete(key);
        else if (res.updatedAt) rowStamps.set(key, String(res.updatedAt));
    }
    // الحوالة: الموافقة والحالة زي ما قرر السكربت (حد الموظف)، ورمز رابط التتبّع
    if (op.action === 'upsert' && ('approval' in res || res.trackToken)) {
        const t = ledger.find(x => x.id === toNum(op.id, NaN));
        if (t && res.trackToken) t.trackToken = String(res.trackToken);
        if (t && 'approval' in res) {
            t.approval = res.approval === 'pending' || res.approval === 'approved' ? res.approval : '';
            if (res.status && STATUSES.includes(res.status)) t.status = res.status;
            setTimeout(renderLedgerTable, 0);
        }
    }
    // النسخ والإرسال: العداد زي ما بالشيت (مع اللي عملوه غيري)
    if (op.action === 'use_ready' && 'copies' in res) {
        const x = readyAccounts.find(y => y.id === String(op.id));
        if (x) Object.assign(x, { copies: toNum(res.copies, x.copies), sends: toNum(res.sends, x.sends), lastUsedAt: res.lastUsedAt || x.lastUsedAt, lastUsedBy: res.lastUsedBy || x.lastUsedBy });
    }
    if (!res.serial) return;
    const target = op.action === 'upsert' ? ledger.find(t => t.id === toNum(op.id, NaN))
        : op.action === 'upsert_usdt' ? usdtMoves.find(m => m.id === toNum(op.move?.id, NaN))
        : op.action === 'upsert_egp' ? egpMoves.find(m => m.id === toNum(op.move?.id, NaN))
        : null;
    if (target) {
        target.serial = toSerial(res.serial);
        // الفاتورة مفتوحة على الرقم المؤقت: بتترسم بالرقم الصح
        setTimeout(refreshOpenReceipt, 0);
    }
}

function txSyncState(id) {
    const pending = outbox.some(op => op.action === 'upsert' && toNum(op.id, NaN) === id);
    if (!pending) return null;
    return flushing || !lastFlushFailed ? 'pending' : 'failed';
}

function syncResultMessage(status) {
    if (status === 'ok' || status === 'idle') return 'تمت المزامنة مع Google Sheets';
    if (status === 'disabled') return 'لم تُرسل: لا يوجد رابط Google Sheets في الإعدادات';
    return 'لم تصل لـ Google Sheets بعد، ستُعاد المحاولة تلقائياً';
}

function syncToastType(status) {
    if (status === 'failed' || status === 'disabled') return 'error';
    return 'success';
}

function updateSyncPendingBar() {
    renderOfflineBanner();
    // بدون نت الشريط المتحرك بيحكي عن المعلّق
    const show = outbox.length > 0 && lastFlushFailed && !flushing && !offlineBannerShown();
    $('sync-pending-bar').classList.toggle('hidden', !show);
    $('sync-pending-count').textContent = outbox.length;
    updateLiveCard();
}

// ---------- البطاقة الحيّة: سعر الشاشة + المزامنة في وقت واحد ----------
let sheetReading = false;
let sheetReadFailed = false;
let lastUpdateAt = '';
let liveCycleRunning = false;

// الحالة الإجمالية: أسوأ حالة بين المزامنة وسعر السوق
function liveCardState() {
    if (flushing || sheetReading || rateStatus === 'loading' || liveCycleRunning) return 'syncing';
    if (globalConfig.driveWebhook && outbox.length && lastFlushFailed) return 'pending';
    if (globalConfig.driveWebhook && sheetReadFailed) return 'error';
    if (rateStatus === 'error') return 'rate-error';
    if (!globalConfig.driveWebhook) return 'disabled';
    return lastUpdateAt ? 'ok' : 'syncing';
}

const LIVE_CARD = {
    ok: { icon: '✓', text: 'كل شيء محدّث', title: 'سعر الشاشة والبيانات محدّثة، وتتحدث تلقائياً كل دقيقتين' },
    syncing: { icon: '⟳', text: 'جاري التحديث', title: 'جاري تحديث سعر الشاشة والمزامنة مع Google Sheets' },
    pending: { icon: '!', text: 'لم تتم المزامنة', title: 'عمليات لم تصل للشيت بعد — اضغط لإعادة المحاولة' },
    error: { icon: '!', text: 'الشيت غير متصل', title: 'تعذرت القراءة من Google Sheets — اضغط لإعادة المحاولة' },
    'rate-error': { icon: '!', text: 'سعر السوق غير متصل', title: 'تعذر جلب سعر السوق، السعر المعروض هو آخر سعر معروف — اضغط لإعادة المحاولة' },
    disabled: { icon: '–', text: 'المزامنة متوقفة', title: 'أضف رابط Google Sheets من الإعدادات' }
};

function updateLiveCard() {
    const card = $('live-card');
    if (!card) return;
    const state = liveCardState();
    const info = LIVE_CARD[state];
    const prev = card.dataset.state;
    card.dataset.state = state;
    card.title = info.title + (globalConfig.rateMode === 'manual' ? ' (سعر الشاشة مثبّت يدوياً)' : '');
    $('live-dot').className = 'live-dot ' + ({ ok: '', syncing: 'busy', 'rate-error': 'manual', disabled: 'off' }[state] ?? 'off');
    $('live-icon').textContent = info.icon;
    $('live-text').textContent = state === 'pending' ? `${info.text} (${outbox.length})` : info.text;
    $('live-time').textContent = state === 'syncing' ? '' : (lastUpdateAt ? `آخر تحديث ${lastUpdateAt}` : '');
    // ومضة خفيفة عند انتهاء تحديث ناجح
    if (prev === 'syncing' && state === 'ok' && !motionReduced()) {
        card.classList.remove('just-updated');
        void card.offsetWidth;
        card.classList.add('just-updated');
    }
}

// دورة تحديث واحدة: سعر الشاشة + المزامنة مع الشيت معاً
// إذا بقي البرنامج مفتوحاً بعد منتصف الليل: تواريخ النماذج والتقارير تنتقل لليوم الجديد
let lastSeenDay = '';
function handleDayRollover() {
    const today = localDateStr();
    if (!lastSeenDay) { lastSeenDay = today; return; }
    if (today === lastSeenDay) return;
    ['calc_date', 'exp_date'].forEach(id => { if ($(id).value === lastSeenDay) $(id).value = today; });
    if ($('exp_month_filter').value === lastSeenDay.slice(0, 7)) $('exp_month_filter').value = today.slice(0, 7);
    lastSeenDay = today;
    updateReportsData();
    renderExpenses();
}

async function liveCycle({ manual = false } = {}) {
    handleDayRollover();
    if (liveCycleRunning || (!manual && document.hidden)) return;
    liveCycleRunning = true;
    updateLiveCard();
    try {
        // موقع سعر السوق يحدّث سعره مرة يومياً، فنطلبه كل 10 دقائق على الأكثر
        const rateDue = manual || Date.now() - lastRateFetchMs >= RATE_REFRESH_MS;
        const tasks = [];
        if (rateDue) tasks.push(fetchLiveDollarRate());
        // شاشة الجنيه تنتظر 10 دقائق بين طلب وطلب لحالها
        tasks.push(fetchEgpRate());
        if (globalConfig.driveWebhook && dataState !== 'loading') {
            tasks.push((async () => {
                if (outbox.length) await flushOutbox();
                await loadFromSheets({ silent: dataState === 'ready' });
            })());
        }
        await Promise.all(tasks);
        if (!rateDue && rateStatus !== 'error' && !sheetReadFailed) lastUpdateAt = nowTimeLabel();
    } finally {
        liveCycleRunning = false;
        updateLiveCard();
    }
    if (manual) {
        const state = liveCardState();
        showToast(LIVE_CARD[state].text, state === 'ok' ? `سعر الشاشة ${fmt(globalConfig.screenRate, 3)} ₪ · ${ledger.length} حوالة` : LIVE_CARD[state].title, state === 'ok' ? 'success' : 'warning');
    }
}

async function retryFailedSync() {
    const status = await flushOutbox();
    if (status === 'failed' || status === 'disabled') {
        showToast('ما زالت عمليات معلقة', `${outbox.length} عملية لم تصل، تحقق من الاتصال أو رابط السكربت`, 'warning');
    } else {
        showToast('تمت المزامنة', 'كل العمليات المعلقة وصلت إلى Google Sheets');
    }
}
