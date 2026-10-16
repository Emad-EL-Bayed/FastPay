'use strict';

// فاست باي — Google Sheets: القراءة والتحديث السريع وصندوق العمليات المعلقة
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= Google Sheets: القراءة والمزامنة =================
// يُرسل الطلب كنص عادي (بدون preflight) حتى نستطيع قراءة رد السكربت والتأكد من الوصول.
// الحالات: ok | unconfirmed (أُرسل ولا يمكن قراءة الرد) | failed | disabled
async function postToSheets(payload, { noSession = false } = {}) {
    const url = (globalConfig.driveWebhook || '').trim();
    if (!url) return { status: 'disabled' };
    if (navigator.onLine === false) return { status: 'failed', error: 'offline' };

    const extra = {};
    if (globalConfig.syncToken) extra.token = globalConfig.syncToken;
    if (session?.token && !noSession) extra.session = session.token;
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
        // غالباً وصل الطلب لكن السكربت لا يسمح بقراءة الرد (CORS)، فلا نعيد الإرسال لتجنب التكرار
        return { status: 'unconfirmed' };
    }
}

// ---------- قراءة الزبائن والحوالات من الشيت ----------
function setDataStatus(state, message = '') {
    dataState = state;
    if (state === 'error') sheetReadFailed = true;
    $('data-status-bar').classList.toggle('hidden', state === 'ready');
    $('data-status-bar').classList.toggle('!border-rose-200', state === 'error');
    $('data-status-text').textContent = message;
    $('data-status-text').className = 'font-bold ' + (state === 'error' ? 'text-rose-700' : 'text-slate-600');
    $('data-status-retry').classList.toggle('hidden', state !== 'error');
    // أثناء التحميل نمنع الحفظ حتى لا تختلط البيانات القديمة بالجديدة
    $('save-tx-btn').disabled = state === 'loading';
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
    countries: { get: () => countries, set: (v) => { countries = v; }, norm: (r) => normalizeCountry(r), ok: (x) => x.name },
    accounts: { get: () => accounts, set: (v) => { accounts = v; }, norm: (r) => normalizeAccount(r), ok: (x) => x.id },
    accountMoves: { get: () => accountMoves, set: (v) => { accountMoves = v; }, norm: (r) => normalizeAmove(r), ok: (x) => x.id && x.accountId },
    usdtMoves: { get: () => usdtMoves, set: (v) => { usdtMoves = v; }, norm: (r) => normalizeUsdt(r), ok: (x) => x.id },
    egpWallets: { get: () => egpWallets, set: (v) => { egpWallets = v; }, norm: (r) => normalizeEgpWallet(r), ok: (x) => x.id },
    egpMoves: { get: () => egpMoves, set: (v) => { egpMoves = v; }, norm: (r) => normalizeEgp(r), ok: (x) => x.id },
    closings: { get: () => closings, set: (v) => { closings = v; }, norm: (r) => normalizeClosing(r), ok: (x) => x.id }
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

async function loadFromSheets({ manual = false, silent = false } = {}) {
    if (!globalConfig.driveWebhook) {
        setLiveIndicator(false);
        setDataStatus('error', 'لا يوجد رابط Google Sheets. أضفه من الإعدادات لقراءة الزبائن والحوالات.');
        renderDataViews();
        return;
    }

    const seq = ++loadSeq;
    if (!silent) {
        setDataStatus('loading', 'جاري تحميل الزبائن والحوالات من Google Sheets...');
        renderDataViews();
    }
    sheetReading = true;
    updateLiveCard();

    // نرسل العمليات المعلقة أولاً حتى تكون القراءة محدّثة
    await flushOutbox();
    const quick = !manual && silent && syncCursor && dataState === 'ready' && Date.now() - lastFullLoadMs < FULL_RELOAD_MS;
    const result = await postToSheets(quick ? { action: 'list', since: syncCursor } : { action: 'list' });
    if (seq !== loadSeq) return; // وصل طلب تحميل أحدث
    sheetReading = false;

    const data = result.data;
    if (result.error === 'auth_required') {
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
        sheetSupportsWallets = Array.isArray(data.accounts);
        accounts = (data.accounts || []).map(normalizeAccount).filter(a => a.id);
        accountMoves = (data.accountMoves || []).map(normalizeAmove).filter(m => m.id && m.accountId);
        usdtMoves = (data.usdtMoves || []).map(normalizeUsdt).filter(m => m.id);
        // السكربت القديم لا يرسل أوراق الجنيه
        sheetSupportsEgp = Array.isArray(data.egpMoves);
        sheetFeatures = Array.isArray(data.features) ? data.features : [];
        sheetSupportsFinalAdjust = sheetHas('finalAdjust');
        // خانة IBAN بالحاسبة بتنفتح لما يكون السكربت بيدعمها
        syncIbanField($('calc_iban'), $('calc_iban_hint'));
        dataEpoch = data.dataEpoch || '';
        egpWallets = (data.egpWallets || []).map(normalizeEgpWallet).filter(w => w.id);
        egpMoves = (data.egpMoves || []).map(normalizeEgp).filter(m => m.id);
        closings = (data.closings || []).map(normalizeClosing).filter(c => c.id);
        lastFullLoadMs = Date.now();
    }
    // السكربت القديم لا يرسل serverTime، فيبقى التحميل كاملاً في كل مرة
    syncCursor = data.serverTime || null;
    updateAuthFromServer(data);
    // الإشعارات (notify.js): مع كل قراءة، الكاملة بتبدّل القائمة والسريعة بتضيف
    if (Array.isArray(data.team)) notifyTeam = data.team;
    if (data.serverTime) notifyCursor = data.serverTime;
    if ('notifications' in data) applyNotifications(data.notifications, { full: !data.incremental });
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
    if (panelTraderId && !$('traderPanel').classList.contains('hidden')) renderTraderPanel();
    // التغييرات التي لم تصل للشيت بعد تبقى ظاهرة
    outbox.forEach(applyOpLocally);
    sortLedger();

    sheetReadFailed = false;
    lastUpdateAt = nowTimeLabel();
    setDataStatus('ready');
    checkLowBalances();
    setLiveIndicator(true);
    // التحديث السريع بدون تغييرات لا يعيد رسم الصفحة
    if (changedCount !== 0 || !silent) renderDataViews();
    if (manual) showToast('تم التحديث من الشيت', `${ledger.length} حوالة، ${customers.length} زبون، ${expenses.length} مصروف`, 'info');
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
    upsert_egp_wallet: ['egpWallets', 'wallet']
};
const DELETE_OPS = { delete_account: 'accounts', delete_amove: 'accountMoves', delete_usdt: 'usdtMoves', delete_egp: 'egpMoves', delete_egp_wallet: 'egpWallets' };

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
    }
}

function queueOps(...ops) {
    outbox.push(...ops.map(op => JSON.parse(JSON.stringify(op))));
    saveAll();
}

function flushOutbox() {
    // إن كان إرسال سابق جارياً ننتظره ثم نرسل ما أُضيف بعده
    if (flushing) return flushing.then(() => flushOutbox());

    flushing = (async () => {
        let status = outbox.length ? 'ok' : 'idle';
        renderLedgerTable();
        updateLiveCard();
        let rejected = 0, locked = 0;
        while (outbox.length) {
            if (!globalConfig.driveWebhook) { status = 'disabled'; break; }
            // عدة عمليات في طلب واحد (السكربت القديم لا يدعمها فنرجع لعملية لكل طلب)
            if (batchSupported && outbox.length > 1) {
                const ops = outbox.slice(0, 25);
                const r = await postToSheets({ action: 'batch', ops });
                if (r.status === 'ok' && Array.isArray(r.data?.results)) {
                    let stop = false;
                    for (const res of r.data.results) {
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
                    saveAll();
                    if (stop) break;
                    continue;
                }
                if (r.error === 'unknown_action') { batchSupported = false; continue; }
                if (r.status === 'unconfirmed') {
                    status = 'unconfirmed';
                    outbox.splice(0, ops.length);
                    saveAll();
                    continue;
                }
                status = 'failed';
                break;
            }
            const r = await postToSheets(outbox[0]);
            // عملية لا تسمح بها الصلاحية (أو على يوم مقفل) لن تنجح أبداً: نحذفها من الانتظار
            if (r.status === 'failed' && (r.error === 'forbidden' || r.error === 'day_locked')) {
                if (r.error === 'day_locked') locked++; else rejected++;
                outbox.shift();
                saveAll();
                continue;
            }
            if (r.status === 'failed') { status = 'failed'; break; }
            if (r.status === 'unconfirmed') status = 'unconfirmed';
            if (r.status === 'ok') applyWriteResult(outbox[0], r.data || {});
            outbox.shift();
            saveAll();
        }
        if (rejected) showToast('عملية مرفوضة', `${rejected > 1 ? rejected + ' عمليات' : 'عملية'} لا تملك صلاحيتها، لم تُحفظ في الشيت`, 'error');
        if (locked) showToast('اليوم مقفل بعد الجرد', `${locked > 1 ? locked + ' عمليات' : 'عملية'} على أيام انعمل إلها جرد ما انحفظت. اطلب من المدير يفتح الأيام.`, 'error');
        // المرفوض كان ظاهر عندنا: نرجع نحمّل من الشيت
        if (rejected || locked) {
            lastFullLoadMs = 0;
            setTimeout(() => loadFromSheets({ silent: true }), 0);
        }
        lastFlushFailed = status === 'failed' || status === 'disabled';
        if (status === 'ok' || status === 'unconfirmed') lastUpdateAt = nowTimeLabel();
        return status;
    })().finally(() => {
        flushing = null;
        saveAll();
        renderLedgerTable();
    });
    return flushing;
}

// السكربت بيرجّع رقم الإيصال للحوالة أو حركة USDT/الجنيه الجديدة: نحطه عندنا فوراً (الفاتورة بتنفتح بعد الحفظ)
function applyWriteResult(op, res) {
    if (!res?.serial || !op) return;
    const target = op.action === 'upsert' ? ledger.find(t => t.id === toNum(op.id, NaN))
        : op.action === 'upsert_usdt' ? usdtMoves.find(m => m.id === toNum(op.move?.id, NaN))
        : op.action === 'upsert_egp' ? egpMoves.find(m => m.id === toNum(op.move?.id, NaN))
        : null;
    if (target) target.serial = toSerial(res.serial);
}

function txSyncState(id) {
    const pending = outbox.some(op => op.action === 'upsert' && toNum(op.id, NaN) === id);
    if (!pending) return null;
    return flushing || !lastFlushFailed ? 'pending' : 'failed';
}

function syncResultMessage(status) {
    if (status === 'ok' || status === 'idle') return 'تمت المزامنة مع Google Sheets';
    if (status === 'unconfirmed') return 'أُرسلت لـ Google Sheets دون تأكيد الاستلام';
    if (status === 'disabled') return 'لم تُرسل: لا يوجد رابط Google Sheets في الإعدادات';
    return 'لم تصل لـ Google Sheets بعد، ستُعاد المحاولة تلقائياً';
}

function syncToastType(status) {
    if (status === 'failed' || status === 'disabled') return 'error';
    return status === 'unconfirmed' ? 'info' : 'success';
}

function updateSyncPendingBar() {
    const show = outbox.length > 0 && lastFlushFailed && !flushing;
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
