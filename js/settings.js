'use strict';

// فاست باي — الإعدادات، الإعدادات المشتركة في الشيت، النسخ الاحتياطي وسجل المحذوفات
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= الإعدادات =================
// ---------- تابات الإعدادات (بطلب عماد 2026-10-21: الصفحة كانت طويلة كثير) ----------
// كل كرت عليه data-stab (ممكن أكثر من تاب، زي زر الحفظ)، والتاب المفتوح بينحفظ على هالجهاز بس
const SETTINGS_TABS = ['rates', 'expenses', 'security', 'receipt', 'prices', 'link', 'look'];
const settingsTab = () => SETTINGS_TABS.includes(globalConfig.settingsTab) ? globalConfig.settingsTab : 'rates';

function setSettingsTab(tab, { remember = true, animate = false } = {}) {
    if (!SETTINGS_TABS.includes(tab)) tab = 'rates';
    document.querySelectorAll('#settings-tabs [data-stab]').forEach(b => {
        const on = b.dataset.stab === tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('#page-settings > [data-stab]').forEach(el => {
        const was = !el.classList.contains('stab-off');
        const on = el.dataset.stab.split(' ').includes(tab);
        el.classList.toggle('stab-off', !on);
        if (animate && on && !was && !motionReduced()) replayClass(el, 'stab-in');
    });
    if (tab === 'security') renderSessionsCard();
    if (remember && globalConfig.settingsTab !== tab) {
        globalConfig.settingsTab = tab;
        try { localStorage.setItem(STORAGE.config, JSON.stringify(globalConfig)); } catch (e) { /* التخزين محظور: بيضل لهالجلسة */ }
    }
}

function loadSettingsPage() {
    setSettingsTab(settingsTab(), { remember: false });
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
    renderTrackLinkSetting();
    renderSectionToggles();
    renderReceiptQrSetting();
    renderLoyaltySettings();
    renderRecurringSettings();
    renderPricesSettings();
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
    trackLinkOn: { label: 'رابط التتبّع برسالة واتساب الحوالة (yes/no)', type: 'str' },
    payoutReadyOn: { label: 'جاهزية الدفع بصفحة الحسابات (yes/no)', type: 'str' },
    trackDays: { label: 'مدة رابط التتبّع بالأيام (فاضي = 7)', type: 'str' },
    trackExpire: { label: 'رابط التتبّع بينتهي (yes/no)', type: 'str' },
    trackLinkOff: { label: 'زبائن ما بينبعتلهم رابط التتبّع (أرقامهم)', type: 'json' },
    lateHours: { label: 'الحوالة المتأخرة: بعد كم ساعة (فاضي = 3، 0 = مسكّر)', type: 'str' },
    blacklist: { label: 'القائمة السوداء: أرقام وأسماء ممنوعة', type: 'json' },
    recurringExpenses: { label: 'المصاريف الثابتة: بتنضاف لحالها بيومها كل شهر', type: 'json' },
    receiptQrOn: { label: 'QR بالفاتورة لصفحة التتبّع (yes/no)', type: 'str' },
    goalOn: { label: 'هدف الشهر بالتقارير (yes/no)', type: 'str' },
    goalAmount: { label: 'هدف الشهر: صافي الربح ₪', type: 'num' },
    pricesPage: { label: 'صفحة الأسعار للزبائن: {on, wa, welcome, usd, usdt, egp, sources, ready}', type: 'json' },
    loyaltyOn: { label: 'الزبون الدايم: مكافأة (yes/no)', type: 'str' },
    loyaltyEvery: { label: 'الزبون الدايم: كل كم حوالة مكتملة', type: 'num' },
    loyaltyType: { label: 'الزبون الدايم: pct خصم من نسبة الربح / ils مبلغ للزبون', type: 'str' },
    loyaltyValue: { label: 'الزبون الدايم: قيمة المكافأة (% أو ₪)', type: 'num' },
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

// ---------- رابط التتبّع برسالة الحوالة (سويتش عام trackLinkOn، والمستثنيين trackLinkOff من نافذة الزبون) ----------
function renderTrackLinkSetting() {
    const show = hasPerm('settings') && sheetHas('track');
    $('track-link-row').classList.toggle('hidden', !show);
    if (!show) return;
    const on = globalConfig.trackLinkOn !== 'no';
    const btn = $('track-link-toggle');
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.lastChild.textContent = on ? 'شغّال' : 'مسكّر';
    const off = trackLinkOffIds().length;
    const moves = sheetHas('trackMoves');
    $('track-link-note').textContent = on
        ? `بينضاف لحاله لرسالة ${moves ? 'الحوالة و USDT والجنيه' : 'الحوالة'}${off ? ` · إلا ${off === 1 ? 'زبون واحد مستثنى' : off + ' زبائن مستثنيين'} (من نافذة الزبون)` : '. لزبون معيّن: من نافذة الزبون'}`
        : 'ما بينضاف لأي رسالة. بتقدر تنسخه بإيدك من نافذة الفاتورة';
    // المدة: السكربت الجديد بس بيقراها (قبل كانت 30 يوم ثابتة)
    $('track-days-row').classList.toggle('hidden', !moves);
    if (!moves) return;
    const forever = globalConfig.trackExpire === 'no';
    const days = trackDaysValue();
    const input = $('track_days');
    if (document.activeElement !== input) input.value = days;
    input.disabled = forever;
    input.classList.toggle('opacity-50', forever);
    const expBtn = $('track-expire-toggle');
    expBtn.classList.toggle('on', forever);
    expBtn.setAttribute('aria-pressed', String(forever));
    $('track-days-note').textContent = forever
        ? 'الرابط ما بينتهي أبداً، والزبون بيقدر يفتحه أي وقت'
        : `الرابط بيشتغل ${days === 1 ? 'يوم واحد' : days + ' أيام'} من تاريخ الحركة، وبعدها بيبين "الرابط انتهى"`;
}

const trackDaysValue = () => { const d = Math.round(toNum(globalConfig.trackDays, 0)); return d >= 1 ? Math.min(d, 365) : 7; };

function saveTrackDays() {
    const d = Math.round(toNum($('track_days').value, 0));
    if (!(d >= 1 && d <= 365)) {
        showToast('تنبيه', 'المدة من يوم لـ 365 يوم', 'warning');
        $('track_days').value = trackDaysValue();
        return;
    }
    globalConfig.trackDays = String(d);
    saveAll();
    renderTrackLinkSetting();
    showToast('تم', `رابط التتبّع بيشتغل ${d === 1 ? 'يوم واحد' : d + ' أيام'}`, 'success');
}

function toggleTrackExpire() {
    globalConfig.trackExpire = globalConfig.trackExpire === 'no' ? 'yes' : 'no';
    saveAll();
    renderTrackLinkSetting();
}

function toggleTrackLink() {
    globalConfig.trackLinkOn = globalConfig.trackLinkOn === 'no' ? 'yes' : 'no';
    saveAll();
    renderTrackLinkSetting();
}

const trackLinkOffIds = () => (Array.isArray(globalConfig.trackLinkOff) ? globalConfig.trackLinkOff : []).map(String).filter(Boolean);

// ---------- أقسام الصفحات: بتبين أو بتنخفى عند الكل (إعدادات مشتركة، بطلب عماد 2026-10-21) ----------
// سويتش (status-toggle): الحالة والكلمة
function setToggle(btn, on, onText, offText) {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.lastChild.textContent = on ? onText : offText;
}

function renderSectionToggles() {
    setToggle($('payout-ready-toggle'), globalConfig.payoutReadyOn !== 'no', 'ظاهرة', 'مخفية');
    const goal = globalConfig.goalOn === 'yes';
    setToggle($('goal-toggle'), goal, 'ظاهر', 'مخفي');
    $('goal_amount').disabled = !goal;
    if (document.activeElement !== $('goal_amount')) $('goal_amount').value = toNum(globalConfig.goalAmount, 0) || '';
}

function toggleGoal() {
    globalConfig.goalOn = globalConfig.goalOn === 'yes' ? 'no' : 'yes';
    if (globalConfig.goalOn === 'yes' && !(toNum(globalConfig.goalAmount, 0) > 0)) setTimeout(() => $('goal_amount').focus(), 50);
    saveAll();
    renderSectionToggles();
    updateReportsData();
}

function saveGoalAmount() {
    globalConfig.goalAmount = Math.max(0, round2(toNum($('goal_amount').value, 0)));
    saveAll();
    renderSectionToggles();
    updateReportsData();
    showToast('انحفظ الهدف', globalConfig.goalAmount ? `${fmt(globalConfig.goalAmount, 0)} ₪ صافي بالشهر` : 'بدون هدف', 'success');
}

// ---------- QR بالفاتورة ----------
function renderReceiptQrSetting() {
    setToggle($('receipt-qr-toggle'), globalConfig.receiptQrOn !== 'no', 'شغّال', 'مسكّر');
}

function toggleReceiptQr() {
    globalConfig.receiptQrOn = globalConfig.receiptQrOn === 'no' ? 'yes' : 'no';
    saveAll();
    renderReceiptQrSetting();
}

// ---------- الزبون الدايم (إعدادات مشتركة loyaltyOn / loyaltyEvery / loyaltyType / loyaltyValue) ----------
function renderLoyaltySettings() {
    const on = globalConfig.loyaltyOn === 'yes';
    setToggle($('loyalty-toggle'), on, 'شغّال', 'مسكّر');
    $('loyalty-fields').classList.toggle('opacity-50', !on);
    ['loyalty_every', 'loyalty_type', 'loyalty_value'].forEach(id => { $(id).disabled = !on; });
    if (document.activeElement !== $('loyalty_every')) $('loyalty_every').value = loyaltyEvery();
    $('loyalty_type').value = globalConfig.loyaltyType === 'ils' ? 'ils' : 'pct';
    if (document.activeElement !== $('loyalty_value')) $('loyalty_value').value = toNum(globalConfig.loyaltyValue, 1);
    $('loyalty_unit').textContent = $('loyalty_type').value === 'ils' ? '₪' : '%';
    $('loyalty-script-note').classList.toggle('hidden', sheetHas('loyalty'));
}

function toggleLoyalty() {
    globalConfig.loyaltyOn = globalConfig.loyaltyOn === 'yes' ? 'no' : 'yes';
    saveAll();
    renderLoyaltySettings();
    applyVipProfit();
    runLiveCalc();
}

function saveLoyaltySettings() {
    globalConfig.loyaltyEvery = Math.min(100, Math.max(2, Math.round(toNum($('loyalty_every').value, 10))));
    globalConfig.loyaltyType = $('loyalty_type').value === 'ils' ? 'ils' : 'pct';
    globalConfig.loyaltyValue = Math.max(0, round2(toNum($('loyalty_value').value, 0)));
    saveAll();
    renderLoyaltySettings();
    applyVipProfit();
    runLiveCalc();
}

function togglePayoutReady() {
    globalConfig.payoutReadyOn = globalConfig.payoutReadyOn === 'no' ? 'yes' : 'no';
    saveAll();
    renderSectionToggles();
    renderPayoutReadiness();
}

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

// ---------- صفحة الأسعار للزبائن (prices.html، بطلب عماد 2026-10-25) ----------
// إعداد مشترك pricesPage: {on, wa, welcome, usd, usdt, egp, sources: [أرقام الدول], ready: [أرقام الحسابات الجاهزة]}.
// السكربت (publicPrices) بيعطي الصفحة بس اللي هون مشغّل.
const PRICES_PAGE = 'https://emad-el-bayed.github.io/FastPay/prices.html';
const PRICES_SECTIONS = [['usd', 'سعر الدولار'], ['usdt', 'USDT إيداع وسحب'], ['egp', 'الجنيه المصري']];

function pricesCfg() {
    const c = globalConfig.pricesPage && typeof globalConfig.pricesPage === 'object' ? globalConfig.pricesPage : {};
    return {
        on: c.on === 'yes' ? 'yes' : 'no', wa: String(c.wa || ''), welcome: String(c.welcome || ''),
        usd: c.usd === 'no' ? 'no' : 'yes', usdt: c.usdt === 'no' ? 'no' : 'yes', egp: c.egp === 'no' ? 'no' : 'yes',
        ready: Array.isArray(c.ready) ? c.ready.map(String) : [], readyOn: c.readyOn === 'no' ? 'no' : 'yes',
        // دول "تسعير الدول" بتطلع لحالها (countriesAuto)، إلا اللي شلتها (hiddenCountries = أرقام بالتسعير)
        countriesAuto: c.countriesAuto === 'no' ? 'no' : 'yes',
        hiddenCountries: Array.isArray(c.hiddenCountries) ? c.hiddenCountries.map(String) : [],
        methods: Array.isArray(c.methods) ? c.methods.map(normPriceMethod).filter(m => m.name) : []
    };
}

// طريقة (باي بال، وايز، ريفولت…): من أي دول بتشتغل، ومربوطة بتسعير دولة (اختياري) حتى يطلع للزبون المبلغ
function normPriceMethod(m) {
    return {
        id: String(m?.id || ''), name: String(m?.name || '').trim().slice(0, 40), brand: SERVICE_BRANDS[m?.brand] ? m.brand : '',
        mode: m?.mode === 'except' ? 'except' : 'only',
        countries: [...new Set((Array.isArray(m?.countries) ? m.countries : []).map(String).filter(c => /^[A-Z]{2}$/.test(c)))],
        // تلقائي = الدول من معلومات الشركة الجاهزة (PROVIDER_COVERAGE)، وفوقها زيادة extra وإلا blocked
        auto: m?.auto === 'no' ? 'no' : 'yes',
        extra: [...new Set((Array.isArray(m?.extra) ? m.extra : []).map(String).filter(c => /^[A-Z]{2}$/.test(c)))],
        blocked: [...new Set((Array.isArray(m?.blocked) ? m.blocked : []).map(String).filter(c => /^[A-Z]{2}$/.test(c)))],
        source: String(m?.source || ''), on: m?.on === 'no' ? 'no' : 'yes'
    };
}

function savePricesCfg(patch, toast = '') {
    globalConfig.pricesPage = { ...pricesCfg(), ...patch };
    saveAll();
    renderPricesSettings();
    if (toast) showToast('انحفظ', toast, 'success');
}

const pricesUrl = () => (location.protocol === 'https:' ? new URL('prices.html', location.href).href : PRICES_PAGE);

function renderPricesSettings() {
    const card = $('prices-settings');
    if (!card) return;
    const cfg = pricesCfg();
    const on = cfg.on === 'yes';
    $('prices-script-note').classList.toggle('hidden', sheetHas('pricesPage'));
    setToggle($('prices-toggle'), on, 'شغّالة', 'مسكّرة');
    $('prices-body').classList.toggle('opacity-50', !on);
    if (document.activeElement !== $('prices_wa')) $('prices_wa').value = cfg.wa;
    if (document.activeElement !== $('prices_welcome')) $('prices_welcome').value = cfg.welcome;
    // واتساب بدّه الرقم الدولي (970… أو 972…)، مش 059…
    const wa = cfg.wa.replace(/\D/g, '');
    $('prices-wa-warn').classList.toggle('hidden', !on || (wa.length >= 11 && !wa.startsWith('0')));
    const chip = (action, id, label, active) => `<button type="button" data-action="${action}" data-id="${escapeHtml(id)}" class="tf-chip ${active ? 'active' : ''}" aria-pressed="${active}">${active ? '✓ ' : ''}${escapeHtml(label)}</button>`;
    $('prices-sections').innerHTML = PRICES_SECTIONS.map(([k, label]) => chip('prices-sec', k, label, cfg[k] === 'yes')).join('');
    renderPriceMethods(cfg);
    renderPriceCountries(cfg);
    setToggle($('prices-ready-toggle'), cfg.readyOn === 'yes', 'ظاهر', 'مخفي');
    $('prices-ready').classList.toggle('opacity-50', cfg.readyOn !== 'yes');
    const ready = (typeof readyAccounts !== 'undefined' ? readyAccounts : []).filter(r => r.id);
    $('prices-ready').innerHTML = ready.length ? ready.map(r => chip('prices-ready', r.id, r.name, cfg.ready.includes(String(r.id)))).join('') : '<span class="text-[11px] text-slate-400">ما في حسابات جاهزة</span>';
    const url = pricesUrl();
    $('prices-url').textContent = url;
    $('prices-open').href = url;
    renderPricesQr(url);
}

// QR للرابط (نفس مكتبة QR الفاتورة)، بتطبعه على المحل
function renderPricesQr(url) {
    const box = $('prices-qr');
    if (typeof qrcode !== 'function') {
        box.innerHTML = '';
        loadScript(RECEIPT_LIBS.qr).then(() => { if ($('prices-qr')) renderPricesQr(url); }).catch(() => {});
        return;
    }
    try {
        const q = qrcode(0, 'M');
        q.addData(url);
        q.make();
        box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (e) { box.innerHTML = ''; }
}

function togglePricesList(key, id) {
    const cfg = pricesCfg();
    const list = cfg[key].includes(id) ? cfg[key].filter(x => x !== id) : [...cfg[key], id];
    savePricesCfg({ [key]: list });
}

// ---------- الطرق (بطلب عماد 2026-10-25: "بدعم مثلاً ريفولت دولة سنغافورة") ----------
const METHOD_BRANDS = ['paypal', 'wise', 'revolut', 'payoneer', 'westernunion', 'moneygram', 'binance', 'applepay', 'googlepay', 'visa', 'mastercard'];
let methodDraft = null;

const methodLogoHtml = (m, size = 'md') => (m.brand ? `<span class="sv-logo ${size}">${brandSvg(m.brand)}</span>` : `<span class="sv-logo ${size} pm-initial">${escapeHtml((m.name || '؟').charAt(0))}</span>`);
const methodSourceName = (id) => countries.find(c => String(c.id) === String(id))?.name || '';

function methodCountriesText(m) {
    if (methodIsAuto(m)) {
        const ch = m.extra.length + m.blocked.length;
        return `تلقائي · بتشتغل ${methodCoverageText(m)}${ch ? ` · ${ch} تعديل بإيدك` : ''}`;
    }
    const n = m.countries.length;
    const names = m.countries.slice(0, 3).map(c => worldFlag(c) + ' ' + (worldCountry(c)?.[1] || c)).join('، ');
    if (m.mode === 'except') return n ? `كل الدول ما عدا ${names}${n > 3 ? ` و${n - 3} غيرهم` : ''}` : 'كل الدول';
    return n ? `${names}${n > 3 ? ` و${n - 3} دول ثانية` : ''}` : 'ما في دول مختارة';
}

function renderPriceMethods(cfg = pricesCfg()) {
    const box = $('prices-methods');
    if (!box) return;
    box.innerHTML = cfg.methods.length ? cfg.methods.map(m => `
        <div class="pm-row ${m.on === 'no' ? 'off' : ''}">
            ${methodLogoHtml(m)}
            <div class="min-w-0 flex-1">
                <b class="block text-sm text-slate-900">${escapeHtml(m.name)}</b>
                <span class="block text-[11px] text-slate-500 truncate">${escapeHtml(methodCountriesText(m))}</span>
                <span class="block text-[10px] ${m.source ? 'text-emerald-700' : 'text-slate-400'} font-bold">${m.source && methodSourceName(m.source) ? `السعر من تسعير "${escapeHtml(methodSourceName(m.source))}"` : 'بدون سعر · واتساب بس'}</span>
            </div>
            <button type="button" data-action="pm-toggle" data-id="${escapeHtml(m.id)}" class="status-toggle ${m.on !== 'no' ? 'on' : ''}" style="--c:#10b981" aria-pressed="${m.on !== 'no'}"><span class="sw"></span>${m.on !== 'no' ? 'ظاهرة' : 'مخفية'}</button>
            <button type="button" data-action="pm-edit" data-id="${escapeHtml(m.id)}" class="text-xs font-bold text-blue-700 hover:underline">تعديل</button>
        </div>`).join('') : '<p class="text-[11px] text-slate-400">ما في طرق لسا. ضيف باي بال، وايز، ريفولت… والدول اللي بتشتغل منها.</p>';
}

// دول التسعير بالصفحة: كل سطر اسمه دولة بيطلع لحاله؛ الكبسة بتخفيه أو بترجّعه
function pricingCountries() {
    return [...countries].filter(c => c.id && pricingCountryIso(c.name)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function renderPriceCountries(cfg = pricesCfg()) {
    const box = $('prices-countries');
    if (!box) return;
    const on = cfg.countriesAuto === 'yes';
    setToggle($('prices-countries-toggle'), on, 'تلقائي', 'مسكّر');
    box.classList.toggle('opacity-50', !on);
    const list = pricingCountries();
    box.innerHTML = list.length ? list.map(c => {
        const shown = on && !cfg.hiddenCountries.includes(String(c.id));
        return `<button type="button" data-action="prices-country" data-id="${escapeHtml(c.id)}" class="tf-chip ${shown ? 'active' : ''}" aria-pressed="${shown}" ${on ? '' : 'disabled'}>${shown ? '✓ ' : ''}${escapeHtml(c.name)}</button>`;
    }).join('') : '<span class="text-[11px] text-slate-400">ما في دول بتسعير الدول</span>';
}

function togglePriceCountry(id) {
    const cfg = pricesCfg();
    savePricesCfg({ hiddenCountries: cfg.hiddenCountries.includes(id) ? cfg.hiddenCountries.filter(x => x !== id) : [...cfg.hiddenCountries, id] });
}

function openMethodModal(id = '') {
    const m = pricesCfg().methods.find(x => x.id === id);
    methodDraft = m ? { ...m, countries: [...m.countries], extra: [...m.extra], blocked: [...m.blocked] } : { id: '', name: '', brand: '', mode: 'only', countries: [], auto: 'yes', extra: [], blocked: [], source: '', on: 'yes' };
    $('pm_title').textContent = m ? `تعديل ${m.name}` : 'طريقة جديدة';
    $('pm_name').value = methodDraft.name;
    $('pm_search').value = '';
    $('pm_delete').classList.toggle('hidden', !m);
    const srcs = [...countries].filter(c => c.id && !isUsdtSource(c)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    $('pm_source').innerHTML = '<option value="">بدون سعر · الزبون بيطلب على واتساب</option>' + srcs.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    $('pm_source').value = methodDraft.source && srcs.some(c => String(c.id) === methodDraft.source) ? methodDraft.source : '';
    renderMethodModal();
    openModal('methodModal');
    $('pm_name').focus();
}

function renderMethodModal() {
    const d = methodDraft;
    if (!d) return;
    $('pm_brands').innerHTML = `<button type="button" data-action="pm-brand" data-k="" class="pm-brand ${!d.brand ? 'on' : ''}"><span class="sv-logo md pm-initial">${escapeHtml((d.name || '؟').charAt(0))}</span><span>بدون</span></button>`
        + METHOD_BRANDS.filter(k => SERVICE_BRANDS[k]).map(k => `<button type="button" data-action="pm-brand" data-k="${k}" class="pm-brand ${d.brand === k ? 'on' : ''}"><span class="sv-logo md">${brandSvg(k)}</span><span>${escapeHtml(SERVICE_BRANDS[k].name)}</span></button>`).join('');
    // شركة معروفة: الدول تلقائي من معلوماتها، أو بإيدك
    const known = !!PROVIDER_COVERAGE[d.brand];
    const auto = methodIsAuto(d);
    $('pm_auto_wrap').classList.toggle('hidden', !known);
    $('pm_manual_wrap').classList.toggle('hidden', auto);
    document.querySelectorAll('#pm_autos [data-auto]').forEach(b => b.classList.toggle('active', b.dataset.auto === (auto ? 'yes' : 'no')));
    if (auto) {
        $('pm_auto_info').innerHTML = `${escapeHtml(d.name || SERVICE_BRANDS[d.brand].name)} بتشتغل <b>${methodCoverageText(d)}</b> حسب معلوماتها (${PROVIDER_COVERAGE_AS_OF}). إذا في دولة غلط، دوّر عليها تحت واكبسها: ✓ يعني شغّالة.`;
        $('pm_overrides').innerHTML = [...d.extra.map(c => [c, '+']), ...d.blocked.map(c => [c, '−'])]
            .map(([c, sign]) => `<button type="button" data-action="pm-country" data-c="${c}" class="pm-chip ${sign === '+' ? 'on' : 'off'}">${sign} ${worldFlag(c)} ${escapeHtml(worldCountry(c)?.[1] || c)} <b>×</b></button>`).join('')
            || '<span class="text-[11px] text-slate-400">ما في تعديلات: كله حسب معلومات الشركة</span>';
        renderMethodSearch();
        return;
    }
    document.querySelectorAll('#pm_modes [data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === d.mode));
    $('pm_countries_label').textContent = d.mode === 'except' ? 'الدول اللي ما بتشتغل منها' : 'الدول اللي بتشتغل منها';
    $('pm_selected').innerHTML = d.countries.length
        ? d.countries.map(c => `<button type="button" data-action="pm-country" data-c="${c}" class="pm-chip on">${worldFlag(c)} ${escapeHtml(worldCountry(c)?.[1] || c)} <b>×</b></button>`).join('')
        : `<span class="text-[11px] text-slate-400">${d.mode === 'except' ? 'ولا دولة: بتشتغل من كل الدول' : 'اختار دولة وحدة على الأقل'}</span>`;
    renderMethodSearch();
}

function renderMethodSearch() {
    const q = $('pm_search').value;
    const list = q.trim() ? worldSearch(q, 12) : WORLD_COUNTRIES.slice(0, 24);
    const auto = methodIsAuto(methodDraft);
    $('pm_results').innerHTML = list.map(c => {
        // تلقائي: ✓ = شغّالة منها (بعد التعديلات). بإيد: معلّمة بالقائمة
        const on = auto ? methodWorksIn(methodDraft, c[0]) : methodDraft.countries.includes(c[0]);
        return `<button type="button" data-action="pm-country" data-c="${c[0]}" class="pm-chip ${on ? 'on' : ''}">${on ? '✓ ' : ''}${worldFlag(c[0])} ${escapeHtml(c[1])}</button>`;
    }).join('') || '<span class="text-[11px] text-slate-400">ما لقينا دولة بهالاسم</span>';
}

function toggleMethodCountry(iso) {
    const d = methodDraft;
    if (methodIsAuto(d)) {
        // التعديل فوق المعلومات الجاهزة: اللي كان تعديل بيرجع، وإلا بيصير زيادة أو "إلا"
        if (d.extra.includes(iso)) d.extra = d.extra.filter(c => c !== iso);
        else if (d.blocked.includes(iso)) d.blocked = d.blocked.filter(c => c !== iso);
        else if (methodWorksIn(d, iso)) d.blocked.push(iso);
        else d.extra.push(iso);
        return renderMethodModal();
    }
    d.countries = d.countries.includes(iso) ? d.countries.filter(c => c !== iso) : [...d.countries, iso];
    renderMethodModal();
}

function saveMethod() {
    const d = methodDraft;
    d.name = $('pm_name').value.trim().slice(0, 40) || (d.brand ? SERVICE_BRANDS[d.brand].name : '');
    d.source = $('pm_source').value;
    if (!d.name) return showToast('تنبيه', 'اكتب اسم الطريقة', 'warning');
    if (!methodIsAuto(d) && d.mode === 'only' && !d.countries.length) return showToast('تنبيه', 'اختار الدول اللي بتشتغل منها', 'warning');
    const list = pricesCfg().methods;
    if (!d.id) d.id = 'm' + Date.now().toString(36);
    const i = list.findIndex(x => x.id === d.id);
    if (i >= 0) list[i] = normPriceMethod(d); else list.push(normPriceMethod(d));
    savePricesCfg({ methods: list }, `${d.name} انحفظت`);
    closeModal('methodModal');
}

function deleteMethod() {
    const d = methodDraft;
    showAppConfirm('تحذف الطريقة؟', `${d.name} بتنشال من صفحة الزبائن.`, () => {
        savePricesCfg({ methods: pricesCfg().methods.filter(x => x.id !== d.id) }, 'انحذفت');
        closeModal('methodModal');
    });
}

function toggleMethodOn(id) {
    savePricesCfg({ methods: pricesCfg().methods.map(m => (m.id === id ? { ...m, on: m.on === 'no' ? 'yes' : 'no' } : m)) });
}

function bindPricesSettingsEvents() {
    $('pm_search')?.addEventListener('input', renderMethodSearch);
    $('pm_name')?.addEventListener('input', () => { if (methodDraft) { methodDraft.name = $('pm_name').value; if (!methodDraft.brand) renderMethodModal(); } });
    $('prices_wa')?.addEventListener('change', (e) => {
        const wa = whatsappDigits(e.target.value);
        savePricesCfg({ wa }, wa ? 'الطلبات بتوصل على هالرقم' : '');
    });
    $('prices_welcome')?.addEventListener('change', (e) => savePricesCfg({ welcome: e.target.value.trim().slice(0, 300) }, 'انحفظت الجملة'));
}

async function copyPricesUrl(btn) {
    if (await copyWithFlash(btn, { label: 'رابط صفحة الأسعار', shown: pricesUrl(), value: pricesUrl() })) return;
}
