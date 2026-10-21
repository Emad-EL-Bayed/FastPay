'use strict';

// فاست باي — الإعدادات، الإعدادات المشتركة في الشيت، النسخ الاحتياطي وسجل المحذوفات
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= الإعدادات =================
function loadSettingsPage() {
    renderMonthlySettings();
    renderUsdtSettings();
    renderEgpTierSettings();
    renderBackupStatus();
    renderAdminTools();
    renderPushSettings();
    $('deleted-section').classList.toggle('hidden', !hasPerm('delete'));
    $('set_screen_rate').value = globalConfig.screenRate;
    $('set_market_rate').textContent = globalConfig.marketRate ? globalConfig.marketRate + ' ₪' : '—';
    $('set_cost_pct').value = globalConfig.costPct;
    $('set_profit_pct').value = globalConfig.profitPct;
    $('set_minus_ils').value = globalConfig.minusIls;
    $('set_drive_url').value = globalConfig.driveWebhook || '';
    $('set_sync_token').value = globalConfig.syncToken || '';
    $('set_sell_offset').value = globalConfig.sellOffset;
    $('set_buy_offset').value = globalConfig.buyOffset;
    $('set_company_name').value = globalConfig.companyName || '';
    $('set_company_subtitle').value = globalConfig.companySubtitle || '';
    $('set_receipt_footer').value = globalConfig.receiptFooter || '';
    renderWaMessageSettings();
    updateSellBuyPreview();
}

function saveAllSettings() {
    const screenRate = toNum($('set_screen_rate').value, NaN);
    const costPct = toNum($('set_cost_pct').value, NaN);
    const profitPct = toNum($('set_profit_pct').value, NaN);
    const minusIls = toNum($('set_minus_ils').value, NaN);
    const webhook = $('set_drive_url').value.trim();

    if (!(screenRate > 0)) return showToast('تنبيه', 'سعر الشاشة يجب أن يكون أكبر من صفر', 'warning');
    if (!(costPct >= 0) || !(profitPct >= 0) || costPct + profitPct >= 100) {
        return showToast('تنبيه', 'نسب التكلفة والربح يجب أن تكون صفراً أو أكثر ومجموعها أقل من 100%', 'warning');
    }
    if (!(minusIls >= 0)) return showToast('تنبيه', 'الخصم الإضافي يجب أن يكون صفراً أو أكثر', 'warning');
    if (webhook && !/^https:\/\//i.test(webhook)) return showToast('تنبيه', 'رابط المزامنة يجب أن يبدأ بـ https://', 'warning');

    // تغيير السعر من الإعدادات يثبّته يدوياً
    if (round3(screenRate) !== round3(globalConfig.screenRate)) {
        globalConfig.screenRate = round3(screenRate);
        globalConfig.rateMode = 'manual';
        globalConfig.screenRateLastUpdated = nowTimeLabel();
        rateStatus = 'manual';
        calcRateTouched = false;
    }

    const syncToken = $('set_sync_token').value.trim();
    const connectionChanged = webhook !== globalConfig.driveWebhook || syncToken !== globalConfig.syncToken;
    Object.assign(globalConfig, {
        costPct, profitPct, minusIls, driveWebhook: webhook, syncToken,
        sellOffset: toNum($('set_sell_offset').value, globalConfig.sellOffset),
        buyOffset: toNum($('set_buy_offset').value, globalConfig.buyOffset),
        companyName: $('set_company_name').value.trim() || 'فاست باي',
        companySubtitle: $('set_company_subtitle').value.trim(),
        receiptFooter: $('set_receipt_footer').value.trim(),
        waMessages: readWaMessageSettings()
    });
    applyBranding();

    // النسب الافتراضية تُطبق على خيار "أخرى" والدول الجديدة فقط
    if (calcSource?.other) applySourceRates();

    saveAll();
    applyScreenRateToUI();
    loadSettingsPage();
    runLiveCalc();
    showToast('تم حفظ الإعدادات', 'تم تطبيق جميع الإعدادات بنجاح');
    // رابط أو مفتاح جديد: نقرأ البيانات من الشيت من جديد
    if (connectionChanged) loadFromSheets();
}

// ================= الإعدادات المشتركة (ورقة "الإعدادات" في الشيت) =================
// نفس القيم على كل الأجهزة. يبقى في المتصفح فقط: رابط الشيت، جلسة الدخول، والتفضيلات الشخصية (فلاتر، سويتش سعر الفاتورة).
// الشعار ملف ثابت في المشروع (assets/logo.png) ولا يُحفظ في الشيت.
// manualOnly: اسم إعداد الوضع؛ السعر يُشارك فقط وهو مثبّت يدوياً، وفي الوضع التلقائي كل جهاز يجلبه من السوق.
const SHARED_SETTINGS = {
    rateMode: { label: 'سعر الشاشة: auto تلقائي من السوق / manual مثبّت يدوياً', type: 'str' },
    screenRate: { label: 'سعر الشاشة المثبّت يدوياً', type: 'num', manualOnly: 'rateMode' },
    screenRateLastUpdated: { label: 'وقت تثبيت السعر', type: 'str', manualOnly: 'rateMode' },
    sellOffset: { label: 'فرق سعر البيع ₪', type: 'num' },
    buyOffset: { label: 'فرق سعر الشراء ₪', type: 'num' },
    costPct: { label: 'التكلفة الافتراضية %', type: 'num' },
    profitPct: { label: 'الربح الافتراضي %', type: 'num' },
    minusIls: { label: 'خصم ثابت لكل حوالة ₪', type: 'num' },
    companyName: { label: 'اسم الشركة', type: 'str' },
    companySubtitle: { label: 'السطر تحت اسم الشركة', type: 'str' },
    receiptFooter: { label: 'الجملة أسفل الفاتورة', type: 'str' },
    waMessages: { label: 'رسالة الفاتورة على واتساب حسب الحالة (بس اللي تعدّل)', type: 'json' },
    usdtDepositPct: { label: 'USDT: نسبة الإيداع % (أول شريحة)', type: 'num' },
    usdtDepositTiers: { label: 'USDT: شرائح نسبة الإيداع فوق أول شريحة [{min: من كم USDT, pct}]', type: 'json' },
    usdtNetworks: { label: 'USDT: الشبكات ورسومها', type: 'json' },
    usdtTiers: { label: 'USDT: شرائح نسبة السحب', type: 'json' },
    egpRateMode: { label: 'شاشة الجنيه: auto تلقائي من السوق / manual مثبّت يدوياً', type: 'str' },
    egpScreenRate: { label: 'شاشة الجنيه المثبّتة يدوياً (جنيه للدولار)', type: 'num', manualOnly: 'egpRateMode' },
    egpRateUpdated: { label: 'وقت تثبيت شاشة الجنيه', type: 'str', manualOnly: 'egpRateMode' },
    egpSendPct: { label: 'الجنيه: نسبة الإرسال % (الزبون بياخد جنيه أقل من السوق)', type: 'num' },
    egpReceivePct: { label: 'الجنيه: نسبة الاستقبال % (الزبون بياخد أقل من قيمة الجنيه بالسوق)', type: 'num' },
    egpSendTiers: { label: 'الجنيه: شرائح نسبة الإرسال فوق أول شريحة [{min: من كم شيكل, pct}]', type: 'json' },
    egpReceiveTiers: { label: 'الجنيه: شرائح نسبة الاستقبال فوق أول شريحة [{min: من كم شيكل, pct}]', type: 'json' },
    lockedThrough: { label: 'قفل الأيام: الحركات لحد هاد التاريخ ما بتتعدل (بيتحدث مع كل جرد)', type: 'str' },
    expenseCategories: { label: 'المصاريف: بنود مقترحة زيادة (زر + بند)', type: 'json' },
    expenseCategoriesHidden: { label: 'المصاريف: بنود انشالت من الاقتراحات (×)', type: 'json' },
    fraudSameNumber: { label: 'تنبيه: نفس الرقم انبعتله باسم ثاني (yes/no)', type: 'str' },
    fraudNewIls: { label: 'تنبيه: زبون جديد فوق هالمبلغ ₪ (0 = مسكّر)', type: 'num' },
    fraudDailyCount: { label: 'تنبيه: أكثر من هالعدد حوالات لنفس الزبون باليوم (0 = مسكّر)', type: 'num' },
    reportEmail: { label: 'التقرير الشهري: الإيميل (فاضي = صاحب السكربت، off = مسكّر)', type: 'str' },
    txLimitOn: { label: 'حد الحوالة للموظف: yes شغّال / no مسكّر', type: 'str' },
    txLimit: { label: 'حد الحوالة للموظف ₪ (فوقه بتستنى موافقة المدير)', type: 'num' },
    pushDebtsHour: { label: 'إشعار تذكير الديون: الساعة (0-23) أو off', type: 'str' },
    pushSummaryHour: { label: 'إشعار ملخص اليوم: الساعة (0-23) أو off', type: 'str' }
};


function serializeShared(key) {
    const def = SHARED_SETTINGS[key];
    const v = globalConfig[key];
    if (def.type === 'json') return JSON.stringify(v ?? null);
    if (def.type === 'num') return String(toNum(v, DEFAULT_CONFIG[key] ?? 0));
    return String(v ?? '');
}

function parseShared(key, text) {
    const def = SHARED_SETTINGS[key];
    if (def.type === 'json') {
        try { return JSON.parse(text); } catch (e) { return DEFAULT_CONFIG[key]; }
    }
    if (def.type === 'num') return toNum(text, DEFAULT_CONFIG[key] ?? 0);
    return String(text ?? '');
}

// يطبّق القيم القادمة من الشيت. full: قراءة كاملة (بعدها نرفع أي إعداد غير موجود في الشيت)
function applySharedSettings(rows, full) {
    sheetSupportsSettings = true;
    const before = Object.keys(SHARED_SETTINGS).map(serializeShared).join('\u0001');
    const oldMode = globalConfig.rateMode;
    const oldEgpMode = globalConfig.egpRateMode;
    const got = {};
    // إعداد لسا بالانتظار (عدّلته هلّق): القراءة اللي كانت بالطريق قديمة، فما بتكتب فوقه (كان يرجع لحظة للقديم)
    const pending = new Set(outbox.filter(op => op.action === 'upsert_setting').map(op => op.setting?.id));
    rows.forEach(r => {
        const key = String(r?.id ?? '').trim();
        if (SHARED_SETTINGS[key] && !pending.has(key)) got[key] = String(r.value ?? '');
    });
    const modeOf = (key) => (got[key] !== undefined ? got[key] : globalConfig[key]);
    Object.entries(got).forEach(([key, text]) => {
        sharedSnapshot[key] = text;
        const def = SHARED_SETTINGS[key];
        if (def.manualOnly && modeOf(def.manualOnly) !== 'manual') return;
        globalConfig[key] = parseShared(key, text);
    });
    if (full) sharedReady = true;
    const changed = Object.keys(SHARED_SETTINGS).map(serializeShared).join('\u0001') !== before;
    if (changed) {
        if (globalConfig.rateMode === 'manual') { rateStatus = 'manual'; calcRateTouched = false; }
        saveAll();
        applyBranding();
        applyScreenRateToUI();
        runLiveCalc();
        if (!pageHidden('settings')) loadSettingsPage();
        // رجع السعر للتلقائي من جهاز آخر: نجلب سعر السوق
        if (oldMode === 'manual' && globalConfig.rateMode !== 'manual') fetchLiveDollarRate();
        if (globalConfig.egpRateMode === 'manual') egpRateStatus = 'manual';
        if (oldEgpMode === 'manual' && globalConfig.egpRateMode !== 'manual') fetchEgpRate();
        renderEgpPage();
        // قفل الأيام تغيّر: علامات 🔒 بالسجلات
        renderLedgerTable();
        renderUsdtPage();
        renderAccountsPage();
        // بنود المصاريف المقترحة من جهاز ثاني
        renderExpenses();
    }
    // أول جهاز يتصل بشيت فارغ يرفع إعداداته
    if (full) syncSharedSettings();
}

let sharedFlushTimer = null;
// إيميل صاحب السكربت (من list، لصاحب الإعدادات): التقرير الشهري بيروحله إذا ما في إيميل ثاني
let scriptOwnerEmail = '';

// ---------- التقرير الشهري بالإيميل (إعداد مشترك reportEmail: '' = صاحب السكربت، 'off' = مسكّر، أو إيميل) ----------
function renderMonthlySettings() {
    const card = $('monthly-settings');
    const show = hasPerm('settings') && sheetHas('monthlyEmail');
    card.classList.toggle('hidden', !show);
    if (!show) return;
    const v = String(globalConfig.reportEmail || '').trim();
    const on = v !== 'off';
    const btn = $('monthly-toggle');
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.lastChild.textContent = on ? 'شغّال' : 'مسكّر';
    $('monthly-fields').classList.toggle('hidden', !on);
    if (document.activeElement !== $('report_email')) $('report_email').value = on ? v : '';
    $('report_email').placeholder = scriptOwnerEmail || 'إيميل حساب جوجل تبع السكربت';
    const to = v && on ? v : scriptOwnerEmail;
    $('monthly-note').innerHTML = !on ? 'مسكّر: ما في تقرير بالإيميل.'
        : dailyPushState && dailyPushState.trigger === false
            ? '<span class="text-amber-700 font-bold">مش شغّال لسا:</span> افتح محرر السكربت، اختار الدالة <b>فعّل_الإشعارات_اليومية</b> واكبس Run مرة وحدة.'
            : `بيوصل أول كل شهر الساعة 8 الصبح${to ? ` على <bdi class="ltr-num font-bold">${escapeHtml(to)}</bdi>` : ''}. أول مرة جوجل بيطلب سماح "إرسال إيميل".`;
}

function toggleMonthlyReport() {
    globalConfig.reportEmail = String(globalConfig.reportEmail || '').trim() === 'off' ? '' : 'off';
    saveAll();
    renderMonthlySettings();
}

function saveReportEmail() {
    const v = $('report_email').value.trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return showToast('الإيميل مش صحيح', 'مثل name@gmail.com، أو خليه فاضي لإيميل صاحب السكربت', 'warning');
    globalConfig.reportEmail = v;
    saveAll();
    renderMonthlySettings();
    showToast('انحفظ', `التقرير الشهري بيوصل على ${v || scriptOwnerEmail || 'إيميل صاحب السكربت'}`, 'success');
}

async function testMonthlyReport() {
    $('monthly-test-btn').disabled = true;
    try {
        // إعداد لسا ما وصل الشيت: بنبعته أول
        await flushOutbox();
        const r = await postToSheets({ action: 'monthly_test' });
        if (r.status === 'ok') return showToast('انبعت التقرير ✓', `تقرير ${r.data.month} على ${r.data.to}. شوف الإيميل (وإذا مش موجود شوف الـ Spam)`, 'success');
        const why = r.error === 'unknown_action' ? 'انشر السكربت الجديد أول' : r.error === 'no_email' ? 'ما في إيميل: اكتب إيميل أو شغّل التقرير' : r.error === 'send_failed' ? 'جوجل ما بعته: شغّل أي دالة من محرر السكربت ووافق على سماح الإيميل' : 'تأكد من الاتصال';
        showToast('ما انبعت', why, 'error');
    } finally {
        $('monthly-test-btn').disabled = false;
    }
}

// يُستدعى من saveAll: أي إعداد مشترك تغيّر عن قيمة الشيت يُرسل له
function syncSharedSettings() {
    if (!sharedReady || !sheetSupportsSettings || !hasPerm('settings')) return;
    const ops = [];
    Object.keys(SHARED_SETTINGS).forEach(key => {
        const def = SHARED_SETTINGS[key];
        if (def.manualOnly && globalConfig[def.manualOnly] !== 'manual') return;
        const text = serializeShared(key);
        if (text === sharedSnapshot[key]) return;
        sharedSnapshot[key] = text;
        ops.push({ action: 'upsert_setting', setting: { id: key, label: def.label, value: text } });
    });
    if (!ops.length) return;
    queueOps(...ops);
    clearTimeout(sharedFlushTimer);
    sharedFlushTimer = setTimeout(() => flushOutbox(), 400);
}

// ================= النسخ الاحتياطي وسجل المحذوفات (في الإعدادات) =================
let lastBackupAt = null; // null = السكربت لم يرسل المعلومة (قديم أو بدون صلاحية)

function renderBackupStatus() {
    const box = $('backup-status');
    if (!box) return;
    if (lastBackupAt === null) { box.innerHTML = '<span class="text-slate-400">تظهر حالة النسخ بعد تحديث السكربت</span>'; return; }
    box.innerHTML = lastBackupAt
        ? `<span class="text-emerald-700 font-bold">✓ يعمل تلقائياً كل يوم</span> · آخر نسخة: <bdi class="ltr-num font-bold">${escapeHtml(lastBackupAt)}</bdi>`
        : '<span class="text-amber-700 font-bold">غير مفعّل بعد:</span> افتح محرر السكربت، اختر الدالة <b>فعّل_النسخ_الاحتياطي</b> واضغط Run مرة واحدة.';
}

let deletedItems = [];

async function loadDeletedList() {
    $('deleted-body').innerHTML = '<tr><td colspan="5" class="p-4 text-center text-xs text-slate-400">جاري التحميل...</td></tr>';
    const r = await postToSheets({ action: 'deleted_list' });
    if (r.status !== 'ok' || !Array.isArray(r.data?.items)) {
        $('deleted-body').innerHTML = `<tr><td colspan="5" class="p-4 text-center text-xs text-rose-600">${r.error === 'unknown_action' ? 'حدّث السكربت أولاً' : 'تعذر التحميل'}</td></tr>`;
        return;
    }
    deletedItems = r.data.items;
    $('deleted-body').innerHTML = deletedItems.length === 0
        ? '<tr><td colspan="5" class="p-4 text-center text-xs text-slate-400">لا توجد محذوفات</td></tr>'
        : deletedItems.map(d => `
            <tr class="hover:bg-slate-50">
                <td class="p-2 text-xs text-slate-500 whitespace-nowrap num">${escapeHtml(d.at)}</td>
                <td class="p-2 text-xs font-bold whitespace-nowrap">${escapeHtml(d.by ? personName(d.by) : '—')}</td>
                <td class="p-2 text-xs">${escapeHtml(d.summary || d.label + ' #' + d.id)}</td>
                <td class="p-2 text-[10px] text-slate-400 font-mono">#${escapeHtml(d.id)}</td>
                <td class="p-2 text-center whitespace-nowrap">${d.restored
                    ? `<span class="text-[10px] text-emerald-700">استُرجع ${escapeHtml(d.restored)}</span>`
                    : d.canRestore ? `<button data-action="restore-deleted" data-id="${escapeHtml(d.logId)}" class="text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg">استرجاع</button>` : '<span class="text-[10px] text-slate-300">قديم</span>'}</td>
            </tr>`).join('');
}

function restoreDeletedPrompt(logId) {
    const d = deletedItems.find(x => x.logId === logId);
    if (!d) return;
    showAppConfirm('استرجاع المحذوف', `استرجاع "${d.summary || d.label}" كما كان قبل الحذف؟`, async () => {
        const r = await postToSheets({ action: 'restore_deleted', logId });
        if (r.status !== 'ok') return showToast('لم يُسترجع', r.error === 'already_restored' ? 'تم استرجاعه من قبل' : 'تأكد من الاتصال وحاول مجدداً', 'error');
        showToast('تم الاسترجاع ✓', d.summary || d.label, 'success');
        loadDeletedList();
        loadFromSheets({ silent: true });
    });
}
