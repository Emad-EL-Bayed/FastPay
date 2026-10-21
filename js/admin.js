'use strict';

// فاست باي — أدوات المدير: قفل الأيام بعد الجرد، سجل التعديلات، مسح البيانات التجريبية، واسترجاع نسخة احتياطية
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= قفل الأيام بعد الجرد =================
// الجرد بيقفل يومه واللي قبله (globalConfig.lockedThrough: إعداد مشترك، السكربت بيحدّثه مع كل جرد).
// بدون صلاحية "تعديل الأيام المقفلة": ما في تعديل ولا حذف لحركة تاريخها مقفل، ولا حركة جديدة بتاريخ قبل آخر يوم مجرود
// (بنفس يوم الجرد مسموح: زبون إجا بعد الجرد). السكربت بيفحص نفس الشي، وهون بس حتى ينرفض قبل ما يتغير شي عندنا.
const lockDate = () => (sheetHas('dayLock') ? String(globalConfig.lockedThrough || '') : '');
const lockApplies = () => !!lockDate() && !hasPerm('unlock');

function dayLocked(date) {
    return lockApplies() && !!date && date <= lockDate();
}

function backdateLocked(date) {
    return lockApplies() && !!date && date < lockDate();
}

function lockWarn() {
    showToast('اليوم مقفل بعد الجرد', `الحركات لحد ${lockDate()} ما بتتعدل ولا بتنحذف. اطلب من المدير يفتحها.`, 'warning');
}

// 🔒 جنب تاريخ الحركة المقفلة (للكل، حتى المدير يعرف إنه اليوم مجرود)
function lockMark(date) {
    const lock = lockDate();
    if (!lock || !date || date > lock) return '';
    return ` <span class="lock-mark" title="${hasPerm('unlock') ? 'يوم مجرود (إلك صلاحية تعدّله)' : 'يوم مجرود: ما بتتعدل'}">🔒</span>`;
}

// الحقول اللي بتتغير حتى بيوم مقفل (نفس السكربت): الحالة (إلا الإلغاء)، اسم الزبون، الملاحظة
const LOCK_FREE_FIELDS = {
    ledger: ['status', 'recipient', 'customerId', 'approval', 'approvedBy'],
    usdtMoves: ['customerName', 'customerId'],
    egpMoves: ['customerName', 'customerId'],
    accountMoves: ['note', 'accountName'],
    traderMoves: ['traderName'],
    expenses: []
};
const LOCK_IGNORED = ['createdBy', 'updatedBy', 'serial'];

// تعديل حركة ممنوع على هالمستخدم؟ before = الحركة قبل التعديل (فاضي للحركة الجديدة)
function editLocked(collection, before, after) {
    if (!before || !dayLocked(before.date)) return backdateLocked(after.date);
    if (collection === 'ledger' && after.status === CANCELLED && before.status !== CANCELLED) return true;
    const free = LOCK_FREE_FIELDS[collection] || [];
    return Object.keys(after).some(k => !free.includes(k) && !LOCK_IGNORED.includes(k)
        && JSON.stringify(after[k] ?? '') !== JSON.stringify(before[k] ?? ''));
}

// ================= أدوات المدير بالإعدادات =================
function renderAdminTools() {
    const lockOk = sheetHas('dayLock');
    const lock = lockDate();
    $('lock-status').innerHTML = !lockOk
        ? '<span class="text-amber-700 font-bold">حدّث السكربت</span> حتى يشتغل قفل الأيام.'
        : lock
            ? `🔒 مقفل لحد <bdi class="ltr-num font-black text-slate-900">${escapeHtml(lock)}</bdi> (من آخر جرد). الموظفين ما بيعدّلوا ولا بيحذفوا حركات هالأيام.`
            : 'ما في أيام مقفلة. أول جرد بيقفل يومه تلقائياً.';
    $('lock-controls').classList.toggle('hidden', !lockOk);
    $('lock-date').value = lock;
    $('edits-open-btn').disabled = !sheetHas('editLog');
    // المسح والاسترجاع للمدير بس: الإعدادات (الصفحة نفسها) والحذف والمستخدمين
    const admin = hasPerm('settings') && hasPerm('users') && hasPerm('delete');
    $('reset-section').classList.toggle('hidden', !admin);
    $('reset-open-btn').disabled = !sheetHas('resetData');
    // المسح لمرة وحدة: بعده الزر بيختفي
    $('reset-open-btn').classList.toggle('hidden', !!resetUsed);
    $('reset-done').classList.toggle('hidden', !resetUsed);
    $('reset-done').innerHTML = resetUsed
        ? `✓ انمسحت <bdi class="ltr-num">${escapeHtml(resetUsed.at || '')}</bdi>${resetUsed.by ? ' · ' + escapeHtml(personName(resetUsed.by)) : ''}`
        : '';
    $('restore-section').classList.toggle('hidden', !admin);
    $('restore-open-btn').disabled = !sheetHas('restore');
    renderTxLimitSettings();
    renderFraudSettings();
}

// ---------- تنبيهات الاحتيال (إعدادات مشتركة fraudSameNumber / fraudNewIls / fraudDailyCount) ----------
function renderFraudSettings() {
    const on = globalConfig.fraudSameNumber !== 'no';
    const btn = $('fraud-same-toggle');
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.lastChild.textContent = on ? 'شغّال' : 'مسكّر';
    if (document.activeElement !== $('fraud_new_ils')) $('fraud_new_ils').value = toNum(globalConfig.fraudNewIls, 0);
    if (document.activeElement !== $('fraud_daily')) $('fraud_daily').value = toNum(globalConfig.fraudDailyCount, 0);
    $('fraud-script-note').classList.toggle('hidden', sheetHas('fraud'));
}

function toggleFraudSame() {
    globalConfig.fraudSameNumber = globalConfig.fraudSameNumber === 'no' ? 'yes' : 'no';
    saveAll();
    renderFraudSettings();
}

function saveFraudLimits() {
    globalConfig.fraudNewIls = Math.max(0, round2(toNum($('fraud_new_ils').value, 0)));
    globalConfig.fraudDailyCount = Math.max(0, Math.round(toNum($('fraud_daily').value, 0)));
    saveAll();
    renderFraudSettings();
    showToast('انحفظ', 'حدود تنبيهات الاحتيال اتحدّثت لكل الأجهزة', 'success');
}

// ---------- حد الحوالة للموظف (إعداد مشترك txLimitOn / txLimit) ----------
// ================= الأجهزة المسجّلة (بطلب عماد 2026-10-21، ميزة devices) =================
// كل جلسة دخول = جهاز (السكربت sessions_list). المدير بيشوف الكل مجمّعين حسب الموظف (الإعدادات ← الحماية)،
// وكل واحد بيشوف أجهزته بـ "ملفي". "طلّعه" (session_revoke) بيطلّع الجهاز فوراً وبيوقف إشعاراته؛ الجهاز اللي إنت عليه لا (للخروج: تسجيل الخروج)
let sessionsCache = null; // { sessions, manager, at }
let sessionsLoading = false;

const sessionsAvailable = () => authEnabled && !!session?.username && sheetHas('devices');
const deviceIcon = (dev) => !dev ? '❔' : /آيفون|أندرويد|آيباد/.test(dev) ? '📱' : '💻';
const sessionTime = (ms) => ms ? notifyWhen(new Date(ms).toISOString()) : '';

function renderSessionsCard() {
    const card = $('devices-settings');
    const on = authEnabled && !!session?.username;
    card.classList.toggle('hidden', !on);
    if (!on) return;
    if (!sheetHas('devices')) {
        $('devices-list').innerHTML = '<p class="text-xs text-amber-700 font-bold">حدّث سكربت Google Sheets حتى تبين الأجهزة.</p>';
        return;
    }
    renderSessionList($('devices-list'), false);
    if (!sessionsCache || Date.now() - sessionsCache.at > 60000) loadSessions();
}

async function loadSessions() {
    if (sessionsLoading || !sessionsAvailable()) return;
    sessionsLoading = true;
    refreshSessionViews();
    const r = await postToSheets({ action: 'sessions_list' });
    sessionsLoading = false;
    if (r.status === 'ok' && r.data?.ok) sessionsCache = { sessions: r.data.sessions || [], manager: !!r.data.manager, at: Date.now() };
    else if (!sessionsCache) sessionsCache = null;
    refreshSessionViews(r.status === 'ok' ? '' : 'ما قدرنا نجيب الأجهزة، اكبس تحديث');
}

function refreshSessionViews(error = '') {
    if (!pageHidden('settings') && settingsTab() === 'security') renderSessionList($('devices-list'), false, error);
    if (!$('profileModal').classList.contains('hidden')) renderSessionList($('pf_devices'), true, error);
}

function sessionRowHtml(x) {
    const meta = [
        x.at ? 'دخل ' + sessionTime(x.at) : (x.dev ? '' : 'دخل قبل التحديث، اسمه بيبين أول ما ينفتح البرنامج عليه'),
        // آخر استعمال بس إذا بعد الدخول بشوي (وإلا نفس الوقت مرتين)
        x.seen && !(x.at && x.seen - x.at < 120000) ? 'آخر استعمال ' + sessionTime(x.seen) : ''
    ].filter(Boolean).join(' · ');
    const name = x.dev || (x.at ? 'جهاز بدون اسم' : 'جهاز قديم');
    return `
        <div class="dev-row${x.current ? ' current' : ''}">
            <span class="dev-ic" aria-hidden="true">${deviceIcon(x.dev)}</span>
            <div class="min-w-0 flex-1">
                <div class="font-bold text-slate-900 truncate">${escapeHtml(name)}${x.current ? ' <span class="dev-badge">هالجهاز</span>' : ''}</div>
                ${meta ? `<div class="text-[11px] text-slate-400">${meta}</div>` : ''}
            </div>
            ${x.current ? '' : `<button type="button" data-action="session-revoke" data-sid="${escapeHtml(x.sid)}" class="dev-out">طلّعه</button>`}
        </div>`;
}

function renderSessionList(box, mineOnly, error = '') {
    if (!box) return;
    if (!sessionsCache) {
        box.innerHTML = `<p class="text-xs ${error ? 'text-amber-700 font-bold' : 'text-slate-400'}">${error || (sessionsLoading ? 'عم نجيب الأجهزة…' : '')}</p>`;
        return;
    }
    const list = sessionsCache.sessions.filter(x => !mineOnly || x.user === session?.username);
    if (!list.length) { box.innerHTML = '<p class="text-xs text-slate-400">ما في أجهزة</p>'; return; }
    if (mineOnly || !sessionsCache.manager) { box.innerHTML = list.map(sessionRowHtml).join(''); return; }
    // المدير: مجمّعين حسب الموظف، أنا أول
    const users = [...new Set(list.map(x => x.user))].sort((a, b) => (b === session?.username) - (a === session?.username) || personName(a).localeCompare(personName(b), 'ar'));
    box.innerHTML = users.map(u => {
        const mine = list.filter(x => x.user === u);
        return `
            <div class="space-y-1.5">
                <div class="dev-user">${escapeHtml(personName(u))}<span>${mine.length === 1 ? 'جهاز واحد' : mine.length === 2 ? 'جهازين' : mine.length + ' أجهزة'}</span></div>
                ${mine.map(sessionRowHtml).join('')}
            </div>`;
    }).join('');
}

function askRevokeSession(sid) {
    const x = sessionsCache?.sessions.find(s => s.sid === sid);
    if (!x) return;
    const who = x.user === session?.username ? '' : ` تبع ${personName(x.user)}`;
    showAppConfirm('تطليع جهاز', `بدك تطلّع "${x.dev || 'جهاز قديم'}"${who}؟ بيطلع من البرنامج فوراً وبيوقف يوصله إشعارات.`, async () => {
        const r = await postToSheets({ action: 'session_revoke', sid });
        if (r.status === 'ok' && r.data?.ok) {
            sessionsCache.sessions = sessionsCache.sessions.filter(s => s.sid !== sid);
            refreshSessionViews();
            showToast('انطلع', `${x.dev || 'الجهاز'}${who} طلع من البرنامج`, 'success');
        } else {
            const err = r.data?.error;
            showToast('ما زبط', err === 'forbidden' ? 'ما عندك صلاحية تطلّع هالجهاز' : err === 'self_session' ? 'هاد الجهاز اللي إنت عليه، استعمل تسجيل الخروج' : 'ما وصل رد، جرّب كمان مرة', 'warning');
        }
    });
}

function renderTxLimitSettings() {
    const on = globalConfig.txLimitOn !== 'no';
    const ok = sheetHas('txApproval');
    const btn = $('tx-limit-toggle');
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.lastChild.textContent = on ? 'شغّال' : 'مسكّر';
    if (document.activeElement !== $('tx_limit')) $('tx_limit').value = toNum(globalConfig.txLimit, 5000);
    $('tx_limit').disabled = !on;
    $('tx-limit-note').classList.toggle('hidden', ok);
}

function toggleTxLimit() {
    globalConfig.txLimitOn = globalConfig.txLimitOn === 'no' ? 'yes' : 'no';
    saveAll();
    renderTxLimitSettings();
    showToast(globalConfig.txLimitOn === 'no' ? 'حد الحوالة مسكّر' : 'حد الحوالة شغّال', globalConfig.txLimitOn === 'no' ? 'الموظفين بيسجّلوا أي مبلغ بدون موافقة' : `فوق ${fmt(txLimitIls(), 0)} ₪ بتستنى موافقتك`, 'info');
}

function saveTxLimit() {
    const v = toNum($('tx_limit').value, 0);
    if (!(v > 0)) { $('tx_limit').value = toNum(globalConfig.txLimit, 5000); return showToast('تنبيه', 'الحد لازم يكون أكبر من صفر (أو سكّر السويتش)', 'warning'); }
    if (v === toNum(globalConfig.txLimit, 5000)) return;
    globalConfig.txLimit = round2(v);
    saveAll();
    showToast('انحفظ الحد', `حوالة الموظف فوق ${fmt(v, 0)} ₪ بتستنى موافقتك`, 'success');
}

// المدير بيغيّر آخر يوم مقفل (أو بيفتح الكل)، والإعداد المشترك بيوصل لكل الأجهزة
function saveLockDate(clear) {
    const value = clear ? '' : $('lock-date').value;
    if (!clear && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return showToast('تنبيه', 'اختر التاريخ', 'warning');
    globalConfig.lockedThrough = value;
    saveAll();
    renderAdminTools();
    renderLedgerTable();
    renderAccountsPage();
    showToast(value ? 'تم قفل الأيام' : 'انفتحت كل الأيام', value ? `لحد ${value}` : 'الموظفين بيقدروا يعدّلوا كل الحركات لحد الجرد الجاي', 'info');
}

// ================= سجل التعديلات =================
// كل تعديل على حركة: مين، إمتى، وشو تغيّر (قبل ← بعد). من ورقة "_سجل التعديلات" المخفية
const EDIT_REF_TYPES = { ledger: 'tx', usdtMoves: 'usdt', egpMoves: 'egp' };
let editsItems = [];

async function openEditsModal(id = '') {
    $('editsModalTitle').textContent = id ? 'سجل تعديلات الحركة' : 'سجل التعديلات';
    $('edits-search').value = '';
    $('edits-search-wrap').classList.toggle('hidden', !!id);
    $('edits-list').innerHTML = '<div class="text-center text-xs text-slate-400 py-8">جاري التحميل...</div>';
    openModal('editsModal');
    const r = await postToSheets({ action: 'edits_list', ...(id ? { id: String(id) } : {}) });
    if (r.status !== 'ok' || !Array.isArray(r.data?.items)) {
        $('edits-list').innerHTML = `<div class="text-center text-xs text-rose-600 py-8">${r.error === 'unknown_action' ? 'حدّث السكربت أولاً' : 'تعذر التحميل، تأكد من الاتصال'}</div>`;
        return;
    }
    editsItems = r.data.items;
    renderEditsList();
}

function editRecordLink(e) {
    if (!e.id) return '';
    const type = EDIT_REF_TYPES[e.c];
    if (!type) return `<span class="text-slate-400 font-mono text-[11px]">#${escapeHtml(e.id)}</span>`;
    return `<button data-action="edits-goto" data-type="${type}" data-id="${escapeHtml(e.id)}" class="ref-link text-[11px]">${escapeHtml(refNo(type, e.id))}</button>`;
}

function renderEditsList() {
    const q = normName($('edits-search').value);
    const list = editsItems.filter(e => !q || normName([e.label, e.summary, e.by, personName(e.by), e.id, refNo(EDIT_REF_TYPES[e.c] || '', e.id), ...e.changes.flat()].join(' ')).includes(q));
    const value = (v) => (String(v ?? '').trim() === '' ? '<i class="text-slate-400">فاضي</i>' : `<bdi>${escapeHtml(v)}</bdi>`);
    $('edits-list').innerHTML = list.length === 0
        ? `<div class="text-center text-xs text-slate-400 py-8">${editsItems.length ? 'ما في نتائج' : 'ما في تعديلات لسا'}</div>`
        : list.map(e => `
            <div class="edit-item">
                <div class="flex flex-wrap justify-between items-center gap-x-3 gap-y-1">
                    <span class="flex items-center gap-1.5 min-w-0"><span class="badge bg-slate-100 text-slate-700">${escapeHtml(e.label)}</span>${editRecordLink(e)} <b class="text-slate-800 text-xs truncate">${escapeHtml(e.summary.replace(e.label + ' · ', ''))}</b></span>
                    <span class="text-[11px] text-slate-400 whitespace-nowrap"><bdi class="ltr-num">${escapeHtml(e.at)}</bdi> · ${escapeHtml(e.by ? personName(e.by) : '—')}</span>
                </div>
                <ul class="mt-1.5 space-y-0.5">
                    ${e.changes.map(([field, before, after]) => `<li class="text-xs"><span class="text-slate-500">${escapeHtml(field)}:</span> <span class="edit-old">${value(before)}</span> <span class="text-slate-400">←</span> <span class="edit-new">${value(after)}</span></li>`).join('')}
                </ul>
            </div>`).join('');
}

// ================= مسح البيانات التجريبية =================
// قبل البدء بالشغل الحقيقي. السكربت بيعمل نسخة احتياطية كاملة أول، وإذا فشلت ما بيمسح شي.
// لمرة وحدة: بعدها الزر بيختفي (resetUsed من رد list) والسكربت بيرفض (reset_used)
// بتضل: المستخدمين والإعدادات وتسعير الدول، وقائمة الحسابات ومحافظ الجنيه (أرصدتها بترجع صفر إذا انمسحت حركاتها)
const RESET_OPTIONS = [
    ['ledger', 'الحوالات', () => ledger.length],
    ['usdt', 'حركات USDT', () => usdtMoves.length],
    ['egp', 'حركات الجنيه (أرصدة المحافظ بترجع صفر)', () => egpMoves.length],
    ['amoves', 'حركات الحسابات (الأرصدة بترجع صفر)', () => accountMoves.length],
    ['expenses', 'المصاريف', () => expenses.length],
    ['customers', 'الزبائن', () => customers.length],
    ['traders', 'التجار وحركاتهم وخدماتهم', () => traders.length + traderMoves.length + traderServices.length],
    ['closings', 'الجرد اليومي (وبينفتح قفل الأيام)', () => closings.length],
    ['logs', 'السجلات: المحذوفات والتعديلات والإشعارات', () => null]
];
const RESET_WORD = 'امسح';
let resetUsed = null; // {at, by} لما يكون المسح انعمل

function openResetModal() {
    if (!sheetHas('resetData')) return showToast('حدّث السكربت أولاً', 'مسح البيانات بيحتاج السكربت الجديد', 'warning');
    $('reset-options').innerHTML = RESET_OPTIONS.map(([key, label, count]) => {
        const n = count();
        return `<label class="perm-check"><input type="checkbox" value="${key}" checked><span>${label}${n !== null ? `<small>${n} سطر</small>` : ''}</span></label>`;
    }).join('');
    $('reset-confirm').value = '';
    updateResetButton();
    openModal('resetModal');
}

const resetChoices = () => [...document.querySelectorAll('#reset-options input:checked')].map(i => i.value);

function updateResetButton() {
    $('reset-go').disabled = $('reset-confirm').value.trim() !== RESET_WORD || !resetChoices().length;
}

const RESET_ERRORS = {
    backup_failed: 'ما قدرنا نعمل نسخة احتياطية، فما انمسح شي. شغّل "فعّل_النسخ_الاحتياطي" من محرر السكربت مرة وجرّب.',
    forbidden: 'المسح بس للمدير (صلاحية الإعدادات والحذف والمستخدمين)',
    nothing_selected: 'اختار شو بدك تمسح',
    reset_used: 'المسح انعمل قبل هيك، وهو لمرة وحدة. إذا لازم تمسح كمان مرة: من محرر السكربت شغّل "اسمح_بالمسح_مرة_ثانية".'
};

async function runReset() {
    const what = resetChoices();
    if (!what.length || $('reset-confirm').value.trim() !== RESET_WORD) return;
    const btn = $('reset-go');
    btn.disabled = true;
    btn.textContent = 'جاري النسخ الاحتياطي والمسح...';
    try {
        // العمليات المعلقة توصل أول، حتى ما ترجع بعد المسح
        await flushOutbox();
        const r = await postToSheets({ action: 'reset_data', what });
        if (r.error === 'network') {
            showToast('ما وصل رد من الشيت', 'ممكن يكون المسح صار. اكبس "تحديث من الشيت" بعد دقيقة وشوف.', 'warning');
            return;
        }
        if (r.status !== 'ok' || !r.data?.ok) {
            showToast('ما انمسح شي', RESET_ERRORS[r.error] || 'تأكد من الاتصال وإنك نشرت السكربت الجديد، وجرّب مرة ثانية', 'error');
            return;
        }
        closeModal('resetModal');
        resetUsed = r.data.resetDone || { at: '', by: '' };
        renderAdminTools();
        const total = Object.values(r.data.counts || {}).reduce((s, n) => s + n, 0);
        showToast('انمسحت البيانات التجريبية ✓', `${total} سطر · النسخة الاحتياطية: ${r.data.backup || 'بمجلد النسخ'}. سجّل الأرصدة الافتتاحية لحساباتك.`, 'success');
        lastFullLoadMs = 0;
        await loadFromSheets({ silent: true });
    } finally {
        btn.textContent = 'امسح نهائياً';
        updateResetButton();
    }
}

// ================= استرجاع نسخة احتياطية =================
// المدير بيختار نسخة من مجلد النسخ وشو يرجّع منها. السكربت بيعمل نسخة من الوضع الحالي أول (وإذا فشلت ما بيتغير شي)،
// وبعدها الأوراق المختارة بترجع زي ما كانت. كل الأجهزة بتعمل تحميل كامل (dataEpoch)
const RESTORE_OPTIONS = [
    ['ledger', 'الحوالات', () => ledger.length],
    ['usdt', 'حركات USDT', () => usdtMoves.length],
    ['egp', 'الجنيه (المحافظ وحركاتها)', () => egpWallets.length + egpMoves.length],
    ['accounts', 'الحسابات وحركاتها', () => accounts.length + accountMoves.length],
    ['expenses', 'المصاريف', () => expenses.length],
    ['customers', 'الزبائن', () => customers.length],
    ['traders', 'التجار وحركاتهم وخدماتهم', () => traders.length + traderMoves.length + traderServices.length],
    ['closings', 'الجرد اليومي', () => closings.length],
    ['settings', 'الإعدادات وتسعير الدول (وقفل الأيام)', () => null],
    ['ready', 'الحسابات الجاهزة', () => readyAccounts.length],
    ['users', 'المستخدمين وكلمات السر', () => null]
];
// المستخدمين مش مختارة تلقائياً: بترجّع كلمات السر القديمة
const RESTORE_DEFAULT_OFF = ['users'];
const RESTORE_WORD = 'استرجع';
let restoreBackups = [];
let restoreFileId = '';
let restoreRows = null; // كم سطر بكل مجموعة بالنسخة المختارة (null = لسا بيتحمّل)
let restoreChecked = new Set();

async function openRestoreModal() {
    if (!sheetHas('restore')) return showToast('حدّث السكربت أولاً', 'الاسترجاع بيحتاج السكربت الجديد', 'warning');
    restoreBackups = [];
    restoreFileId = '';
    restoreRows = null;
    restoreChecked = new Set(RESTORE_OPTIONS.map(o => o[0]).filter(k => !RESTORE_DEFAULT_OFF.includes(k)));
    $('restore-confirm').value = '';
    $('restore-step2').classList.add('hidden');
    $('restore-list').innerHTML = '<div class="text-center text-slate-400 py-6">جاري تحميل النسخ...</div>';
    updateRestoreButton();
    openModal('restoreModal');
    const r = await postToSheets({ action: 'backups_list' });
    if (r.status !== 'ok' || !Array.isArray(r.data?.items)) {
        $('restore-list').innerHTML = `<div class="text-center text-rose-600 py-6">${r.error === 'unknown_action' ? 'حدّث السكربت أولاً' : r.error === 'forbidden' ? 'الاسترجاع للمدير بس' : 'تعذر التحميل، تأكد من الاتصال'}</div>`;
        return;
    }
    restoreBackups = r.data.items;
    renderRestoreList();
}

function backupDayLabel(at) {
    const day = String(at || '').slice(0, 10);
    const d = new Date(day + 'T12:00:00');
    const weekday = isNaN(d) ? '' : d.toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long' });
    return `${weekday} <bdi class="ltr-num">${escapeHtml(day)}</bdi> · <bdi class="ltr-num">${escapeHtml(String(at || '').slice(11, 16))}</bdi>`;
}

function renderRestoreList() {
    $('restore-list').innerHTML = restoreBackups.length === 0
        ? '<div class="text-center text-slate-400 py-6 leading-6">ما في نسخ بمجلد "فاست باي - نسخ احتياطية".<br>شغّل "فعّل_النسخ_الاحتياطي" من محرر السكربت.</div>'
        : restoreBackups.map(b => `
            <label class="perm-check items-center">
                <input type="radio" name="restore-file" value="${escapeHtml(b.id)}"${b.id === restoreFileId ? ' checked' : ''}>
                <span class="flex-1 min-w-0">${backupDayLabel(b.at)}<small>${escapeHtml(relativeDays(b.at.slice(0, 10)))}${b.note ? '' : ' · النسخة اليومية'}</small></span>
                ${b.note ? `<span class="badge ${b.note === 'قبل المسح' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}">${escapeHtml(b.note)}</span>` : ''}
            </label>`).join('');
}

// اختيار نسخة: بنجيب كم سطر فيها بكل مجموعة
async function pickRestoreFile(id) {
    restoreFileId = id;
    restoreRows = null;
    renderRestoreOptions();
    $('restore-step2').classList.remove('hidden');
    updateRestoreButton();
    const r = await postToSheets({ action: 'backup_info', fileId: id });
    if (restoreFileId !== id) return; // اختار نسخة ثانية بالنص
    restoreRows = r.status === 'ok' && r.data?.rows ? r.data.rows : {};
    renderRestoreOptions();
    updateRestoreButton();
}

function renderRestoreOptions() {
    $('restore-options').innerHTML = RESTORE_OPTIONS.map(([key, label, count]) => {
        const inBackup = restoreRows ? restoreRows[key] : undefined;
        const missing = restoreRows && (inBackup === null || inBackup === undefined);
        const now = count();
        const info = !restoreRows ? 'جاري الفحص...'
            : missing ? 'مش موجودة بالنسخة'
            : `بالنسخة ${inBackup} سطر${now !== null ? ` · هلّق ${now}` : ''}`;
        return `<label class="perm-check${missing ? ' opacity-50' : ''}"><input type="checkbox" value="${key}"${restoreChecked.has(key) && !missing ? ' checked' : ''}${missing ? ' disabled' : ''}><span>${label}<small>${info}</small></span></label>`;
    }).join('');
    syncRestoreUsersWarn();
}

const restoreChoices = () => [...document.querySelectorAll('#restore-options input:checked')].map(i => i.value);

function syncRestoreUsersWarn() {
    $('restore-users-warn').classList.toggle('hidden', !restoreChoices().includes('users'));
}

function updateRestoreButton() {
    $('restore-go').disabled = !restoreFileId || !restoreRows || !restoreChoices().length
        || $('restore-confirm').value.trim() !== RESTORE_WORD;
}

const RESTORE_ERRORS = {
    backup_failed: 'ما قدرنا نعمل نسخة من الوضع الحالي، فما تغيّر شي. شغّل "فعّل_النسخ_الاحتياطي" من محرر السكربت مرة وجرّب.',
    forbidden: 'الاسترجاع بس للمدير (صلاحية الإعدادات والحذف والمستخدمين)',
    not_found: 'النسخة مش موجودة بمجلد النسخ (يمكن انحذفت). افتح النافذة من جديد.',
    self_lock: 'إنت مش مدير بهاي النسخة، فلو رجعت المستخدمين بتسكّر البرنامج على حالك. شيل "المستخدمين" من الاختيار.',
    nothing_selected: 'اختار شو بدك ترجع'
};

async function runRestore() {
    const fileId = restoreFileId;
    const what = restoreChoices();
    if (!fileId || !what.length || $('restore-confirm').value.trim() !== RESTORE_WORD) return;
    const btn = $('restore-go');
    btn.disabled = true;
    btn.textContent = 'جاري النسخ والاسترجاع...';
    try {
        // العمليات المعلقة توصل أول، حتى ما تنكتب فوق النسخة المسترجعة
        await flushOutbox();
        if (outbox.length) {
            showToast('ما استرجعنا شي', 'في عمليات لسا ما وصلت للشيت. تأكد من الاتصال وجرّب كمان شوي.', 'warning');
            return;
        }
        const r = await postToSheets({ action: 'restore_backup', fileId, what });
        // ما وصل رد: ممكن يكون الاسترجاع صار بالشيت
        if (r.error === 'network') {
            showToast('ما وصل رد من الشيت', 'اكبس "تحديث من الشيت" بعد دقيقة وشوف إذا رجعت البيانات.', 'warning');
            return;
        }
        if (r.status !== 'ok' || !r.data?.ok) {
            showToast('ما استرجعنا شي', RESTORE_ERRORS[r.error] || 'تأكد من الاتصال وإنك نشرت السكربت الجديد، وجرّب مرة ثانية', 'error');
            return;
        }
        closeModal('restoreModal');
        const total = Object.values(r.data.counts || {}).reduce((s, n) => s + n, 0);
        showToast('رجعت النسخة ✓', `${total} سطر · الوضع اللي كان قبل الاسترجاع انحفظ بنسخة "قبل الاسترجاع"، فلو غلطت بترجع منها.`, 'success');
        lastFullLoadMs = 0;
        await loadFromSheets({ silent: true });
    } finally {
        btn.textContent = 'استرجع';
        updateRestoreButton();
    }
}

// زر "سجل التعديلات" بنوافذ الحركات: لصاحب صلاحية الإعدادات، والسكربت بيدعمه
function setHistoryButton(btnId, recordId) {
    const btn = $(btnId);
    btn.classList.toggle('hidden', !recordId || !hasPerm('settings') || !sheetHas('editLog'));
    btn.dataset.id = recordId || '';
}

function bindAdminEvents() {
    $('edits-search').addEventListener('input', renderEditsList);
    $('reset-options').addEventListener('change', updateResetButton);
    $('reset-confirm').addEventListener('input', updateResetButton);
    $('restore-list').addEventListener('change', (e) => { if (e.target.name === 'restore-file') pickRestoreFile(e.target.value); });
    $('restore-options').addEventListener('change', (e) => {
        restoreChecked[e.target.checked ? 'add' : 'delete'](e.target.value);
        syncRestoreUsersWarn();
        updateRestoreButton();
    });
    $('restore-confirm').addEventListener('input', updateRestoreButton);
}
