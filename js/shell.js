'use strict';

// فاست باي — التنقل بين الصفحات، سعر الشاشة، هوية الشركة، النوافذ المنبثقة، شريط الجوال
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= التبديل بين التبويبات =================
const TABS = ['calculator', 'reports', 'transactions', 'usdt', 'egp', 'accounts', 'expenses', 'traders', 'customers', 'ready', 'countries', 'settings', 'users', 'position', 'ratelog', 'insights'];
const TITLES = {
    calculator: 'حاسبة وصرافة الحوالات',
    reports: 'التقرير المالي والأرباح',
    transactions: 'سجل الحوالات والبحث المتقدم',
    usdt: 'إيداع وسحب USDT',
    egp: 'الجنيه المصري — فودافون وانستا باي',
    accounts: 'الحسابات والمحافظ',
    expenses: 'المصاريف التشغيلية',
    traders: 'حسابات التجار',
    customers: 'إدارة الزبائن',
    ready: 'الحسابات الجاهزة',
    countries: 'تسعير ومعاملات الدول',
    settings: 'الإعدادات العامة والربط السحابي',
    users: 'المستخدمون والصلاحيات',
    position: 'المركز المالي والديون',
    ratelog: 'سجل الأسعار',
    insights: 'وين بتربح أكتر'
};

// صفحات فرعية بدون زر بالقائمة: زرها المضيء بالقائمة هو صفحتها الأم.
// المركز المالي بصلاحية التقارير، والمستخدمين بصلاحيتهم الخاصة
const SUB_TABS = { users: 'settings', position: 'reports', ratelog: 'reports', insights: 'reports' };
const navTabOf = (t) => SUB_TABS[t] || t;
const tabPerm = (t) => (t === 'position' || t === 'ratelog' || t === 'insights' ? 'reports' : t);

// كل صفحة تُرسم فقط وهي ظاهرة، وعند فتحها تُرسم بآخر البيانات (switchTab)
function pageHidden(tab) {
    return !$('page-' + tab) || $('page-' + tab).classList.contains('hidden');
}

// المستخدمون صفحة فرعية من الإعدادات: زر "الإعدادات" يظهر لمن عنده أي منهما
function tabVisible(t) {
    if (t === 'settings') return hasPerm('settings') || hasPerm('users');
    if (SUB_TABS[t]) return false;
    return hasPerm(t);
}

function switchTab(tab) {
    if (tab === 'settings' && !hasPerm('settings') && hasPerm('users')) tab = 'users';
    if (!TABS.includes(tab) || !hasPerm(tabPerm(tab))) return;
    const navTab = navTabOf(tab);
    TABS.forEach(t => {
        $('page-' + t).classList.toggle('hidden', t !== tab);
        $('nav-' + t)?.classList.toggle('active', t === navTab);
        $('mnav-' + t)?.classList.toggle('active', t === navTab);
    });
    // الأزرار الفرعية داخل الإعدادات
    document.querySelectorAll('.subnav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
        b.classList.toggle('hidden', !hasPerm(tabPerm(b.dataset.tab)));
    });
    $('page-title').textContent = TITLES[tab] || 'فاست باي';
    replayClass($('page-title'), 'title-swap');
    $('mnav-more-menu').classList.add('hidden');
    moveNavIndicator();
    updateMobileNav();
    window.scrollTo({ top: 0 });

    if (tab === 'reports') {
        updateReportsData();
        renderMonthlyAnalysis({ replay: true });
    }
    if (tab === 'calculator') {
        replayCalcEntrance();
        renderRecentTx();
    }
    updateMobileResultBar();
    if (tab === 'transactions') renderLedgerTable();
    if (tab === 'expenses') renderExpenses();
    if (tab === 'usdt') renderUsdtPage();
    if (tab === 'egp') renderEgpPage();
    if (tab === 'accounts') renderAccountsPage();
    if (tab === 'users') renderUsersPage();
    // زر التجار بالقائمة دايماً بيفتح القائمة (مش آخر تاجر كان مفتوح)
    if (tab === 'traders') { panelTraderId = null; renderTraders(); }
    if (tab === 'customers') renderCustomersTable();
    if (tab === 'ready') renderReadyPage();
    if (tab === 'countries') renderCountriesTable();
    if (tab === 'settings') loadSettingsPage();
    if (tab === 'position') renderPositionPage();
    if (tab === 'ratelog') renderRateLogPage();
    if (tab === 'insights') renderInsightsPage();
    // الحاسبة إلها حركة دخول خاصة (replayCalcEntrance)
    if (tab !== 'calculator') playPageEnter($('page-' + tab));
}

// ================= سعر دولار الشاشة =================
// يصبح true عندما يكتب المستخدم سعراً خاصاً في الحاسبة، حتى لا يمسحه التحديث التلقائي
let calcRateTouched = false;

// مصدر السعر تحت سعر الشاشة بالإعدادات
const RATE_SOURCE_NOTE = {
    market: ' · من سوق العملات (زي الشاشة)',
    coinbase: ' · من Coinbase (احتياط، ممكن يتأخر عن الشاشة)',
    daily: ' · سعر يومي (المصدر المباشر ما رد)'
};

// حالة الاتصال بسعر السوق: loading | ok | manual | error
let rateStatus = 'loading';
let lastRateFetchMs = 0;

// طلب واحد لسعر السوق يخدم الدولار والجنيه معاً (نحتفظ بالرد دقيقة)
// الرد: { rates: { ILS, EGP, EUR, JOD }, live, source } — source: market (سوق العملات عبر السكربت، زي الشاشة)،
// coinbase (احتياط، ممكن يتأخر)، daily (سعر يومي)؛ live = false يعني سعر يومي
let marketRatesCache = null; // { at, promise }
// آخر مرة وصل سعر السوق من السكربت: الاحتياط (Coinbase) ما بيكتب فوقه تلقائياً خلال 10 دقايق
// (كان Coinbase يوصل بعده عند فتح الصفحة ويرجّع السعر المتأخر)
let lastScriptMarketMs = 0;
const scriptMarketFresh = () => Date.now() - lastScriptMarketMs < 10 * 60 * 1000;

// سعر السوق من السكربت (رد market أو مع قراءة الشيت) بنفس شكل الرد
function marketFromScript(m) {
    const ils = toNum(m?.rates?.ILS, NaN);
    if (!(ils > 0)) return null;
    return { rates: { ILS: ils, EGP: toNum(m.rates.EGP, NaN), EUR: toNum(m.rates.EUR, 0), JOD: toNum(m.rates.JOD, 0) }, live: true, source: 'market' };
}

async function loadMarketRates({ fresh = false } = {}) {
    // الأدق أول: السكربت (إذا منشور بالنسخة اللي فيها السوق)
    if (globalConfig.driveWebhook && sheetHas('market')) {
        const r = await postToSheets({ action: 'market', fresh });
        const data = r.status === 'ok' ? marketFromScript(r.data?.market) : null;
        if (data) {
            lastScriptMarketMs = Date.now();
            return data;
        }
    }
    let lastErr;
    for (const src of RATE_SOURCES) {
        try {
            // بدون نسخة المتصفح المخزنة (المصدر اليومي بيطلب تخزينها ساعة)
            const r = await fetch(src.url, { cache: 'no-store' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const rates = src.rates(await r.json());
            const ils = toNum(rates?.ILS, NaN);
            if (!(ils > 0)) throw new Error('no ILS rate');
            return { rates: { ILS: ils, EGP: toNum(rates?.EGP, NaN), EUR: toNum(rates?.EUR, 0), JOD: toNum(rates?.JOD, 0) }, live: src.live, source: src.source };
        } catch (err) {
            console.warn('Rate source failed:', src.url, err);
            lastErr = err;
        }
    }
    throw lastErr;
}

function fetchMarketRates({ fresh = false } = {}) {
    if (!fresh && marketRatesCache && Date.now() - marketRatesCache.at < 60 * 1000) return marketRatesCache.promise;
    const promise = loadMarketRates({ fresh });
    marketRatesCache = { at: Date.now(), promise };
    promise.catch(() => { if (marketRatesCache?.promise === promise) marketRatesCache = null; });
    return promise;
}

async function fetchLiveDollarRate({ manual = false } = {}) {
    // في الوضع اليدوي لا يتغير السعر إلا بطلب صريح من المستخدم
    if (globalConfig.rateMode === 'manual' && !manual) {
        rateStatus = 'manual';
        applyScreenRateToUI();
        return;
    }
    rateStatus = 'loading';
    lastRateFetchMs = Date.now();
    applyScreenRateToUI();

    try {
        const data = await fetchMarketRates({ fresh: manual });
        const market = toNum(data?.rates?.ILS, NaN);
        if (!(market > 0)) throw new Error('لم يتم استلام سعر صحيح');

        // ربما ثبّت المستخدم سعراً يدوياً أثناء انتظار الرد
        if (!manual && globalConfig.rateMode === 'manual') return;
        applyMarketData(data, { manual });
        // الرد انتجاهل (سعر السكربت أحدث): بس نشيل "جاري جلب السعر"
        if (rateStatus === 'loading') {
            rateStatus = 'ok';
            applyScreenRateToUI();
        }
        lastUpdateAt = nowTimeLabel();

        if (manual) showToast('تم تحديث سعر الشاشة', `${globalConfig.screenRate} ₪ ${data.live ? 'من السوق' : 'سعر يومي (المصدر المباشر ما رد)'} — التحديث التلقائي مفعّل`, data.live ? 'success' : 'warning');
    } catch (err) {
        console.warn('Could not fetch live rate, keeping current rate:', err);
        rateStatus = globalConfig.rateMode === 'manual' ? 'manual' : 'error';
        applyScreenRateToUI();
        if (manual) showToast('تنبيه الاتصال', 'تعذر جلب سعر السوق حالياً، تم الإبقاء على السعر المعتمد', 'warning');
    }
}

// سعر الشاشة = سعر السوق كما هو، وفرق البيع والشراء يُحسب منه
function applyMarketData(data, { manual = false } = {}) {
    const market = toNum(data?.rates?.ILS, NaN);
    if (!(market > 0)) return;
    if (!manual && data.source !== 'market' && scriptMarketFresh()) return;
    globalConfig.marketRate = round3(market);
    globalConfig.marketLive = data.live;
    globalConfig.marketSource = data.source || '';
    // اليورو والدينار (لكل دولار): لحسابات التجار بصفحة المركز المالي
    globalConfig.marketFx = { EUR: data.rates.EUR, JOD: data.rates.JOD };
    globalConfig.screenRate = round3(market);
    globalConfig.rateMode = 'auto';
    globalConfig.screenRateLastUpdated = nowTimeLabel();
    rateStatus = 'ok';
    lastRateFetchMs = Date.now();
    if (manual) calcRateTouched = false;
    saveAll();
    applyScreenRateToUI();
    runLiveCalc();
}

// سعر السوق وصل مع قراءة الشيت (كل دقيقتين، من ذاكرة السكربت): بيصير الرد المخزّن، وبيتطبّق على الدولار والجنيه
// إذا الوضع تلقائي. هيك السعر بيتبع الشاشة بدون طلبات زيادة
function useScriptMarket(m) {
    const data = marketFromScript(m);
    if (!data) return;
    lastScriptMarketMs = Date.now();
    marketRatesCache = { at: Date.now(), promise: Promise.resolve(data) };
    if (globalConfig.rateMode !== 'manual') applyMarketData(data);
    applyEgpMarket(data);
}

function pinScreenRateManual() {
    const input = $('set_screen_rate');
    const val = toNum(input.value, NaN);
    if (!(val > 0)) return showToast('تنبيه', 'الرجاء إدخال سعر دولار رقمي صحيح', 'warning');

    globalConfig.screenRate = round3(val);
    globalConfig.rateMode = 'manual';
    globalConfig.screenRateLastUpdated = nowTimeLabel();
    rateStatus = 'manual';
    calcRateTouched = false;

    saveAll();
    input.blur();
    applyScreenRateToUI();
    runLiveCalc();
    showToast('تم تثبيت السعر يدوياً', `سعر الشاشة ${globalConfig.screenRate} ₪ ولن يتغير تلقائياً حتى تضغط "جلب السعر من السوق"`);
}

function applyScreenRateToUI() {
    const rate = toNum(globalConfig.screenRate);
    const updated = globalConfig.screenRateLastUpdated;
    const isManual = globalConfig.rateMode === 'manual';
    if (isManual && rateStatus !== 'loading') rateStatus = 'manual';

    // البطاقة الحيّة في الشريط العلوي: الرقم يتحرك نحو السعر الجديد عند تغيّره
    animateNumber($('top-screen-display'), rate, (v) => fmt(v, 2), 700);
    flashLiveRate(rate);
    $('live-lock').classList.toggle('hidden', !isManual);
    updateLiveCard();

    // الحاسبة تحسب بسعر البيع (سعر الشاشة + فرق البيع)، ويمكن تعديله لحوالة واحدة
    if (!calcRateTouched) $('calc_screen_rate').value = sellBuyRates().sell;

    // الإعدادات
    $('set_current_rate').textContent = fmt(rate, 3) + ' ₪';
    // حقل الإعدادات يتبع السعر المعتمد حتى لا يعيد "حفظ الإعدادات" سعراً قديماً
    if (document.activeElement !== $('set_screen_rate')) $('set_screen_rate').value = rate;
    $('set_market_rate').textContent = globalConfig.marketRate ? fmt(globalConfig.marketRate, 3) : '—';
    const badge = $('rate-mode-badge');
    badge.textContent = isManual ? '🔒 يدوي مثبّت' : (rateStatus === 'error' ? 'تلقائي · غير متصل' : 'تلقائي من السوق');
    badge.className = 'badge ' + (isManual ? 'bg-amber-50 text-amber-700' : rateStatus === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700');
    $('screen-update-time').textContent = rateStatus === 'loading' ? 'جاري جلب السعر...' : (updated ? `آخر تحديث: ${updated}${isManual ? '' : RATE_SOURCE_NOTE[globalConfig.marketLive === false ? 'daily' : globalConfig.marketSource] || ''}` : 'لم يُحدَّث بعد');

    renderSellBuyRates();
    // أسعار الجنيه بالشيكل تعتمد على سعر البيع والشراء
    if (!pageHidden('egp')) {
        renderEgpRates();
        renderEgpQuick();
    }
}

function renderSellBuyRates() {
    const { sell, buy } = sellBuyRates();
    $('rate-sell-val').textContent = sell.toFixed(3);
    $('rate-buy-val').textContent = buy.toFixed(3);
    $('res_rate_screen').textContent = toNum(globalConfig.screenRate).toFixed(3);
    $('res_rate_sell').textContent = sell.toFixed(3);
    $('res_rate_buy').textContent = buy.toFixed(3);
    updateSellBuyPreview();
}

// معاينة فورية في الإعدادات أثناء الكتابة
function updateSellBuyPreview() {
    const screen = toNum($('set_screen_rate').value, globalConfig.screenRate);
    const { sell, buy } = sellBuyRates(screen, toNum($('set_sell_offset').value, globalConfig.sellOffset), toNum($('set_buy_offset').value, globalConfig.buyOffset));
    $('set_sell_preview').textContent = sell.toFixed(3) + ' ₪';
    $('set_buy_preview').textContent = buy.toFixed(3) + ' ₪';
}

// ================= هوية الشركة (القائمة الجانبية والفاتورة) =================
// شعار الشركة: نسخة مضمّنة (js/logo-data.js) تعمل في صور الفواتير حتى عند الفتح من الجهاز مباشرة
function logoHtml() {
    return `<img src="${LOGO_DATA}" alt="" class="w-full h-full object-contain">`;
}

// شعار واحد لكل المنصة: القائمة الجانبية، رأس الجوال، الإعدادات، أيقونة المتصفح، والفاتورة
function applyBranding() {
    const name = globalConfig.companyName || 'فاست باي';
    ['brand-logo', 'hdr-logo', 'login-logo'].forEach(id => { $(id).innerHTML = logoHtml(); });
    $('login-company').textContent = name;
    $('brand-name').textContent = name;
    $('brand-subtitle').textContent = globalConfig.companySubtitle || '';
    document.title = name;
}

// يصغّر صورة إلى max بكسل كحد أقصى ويعيدها كـ dataURL
// maxChars: حد لطول النص (خلية الشيت تتسع لـ 50 ألف حرف)، فنجرّب صيغاً أصغر عند الحاجة
function resizeImageFile(file, max, onDone, maxChars = Infinity) {
    if (!file || !file.type.startsWith('image/')) return showToast('ملف غير صالح', 'اختر صورة (PNG أو JPG أو SVG)', 'warning');
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round((img.width || max) * scale));
            canvas.height = Math.max(1, Math.round((img.height || max) * scale));
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            let url = canvas.toDataURL('image/png');
            if (url.length > maxChars) url = canvas.toDataURL('image/webp', 0.85);
            if (url.length > maxChars) {
                // JPG لا يدعم الشفافية، فنضع خلفية بيضاء
                ctx.globalCompositeOperation = 'destination-over';
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                url = canvas.toDataURL('image/jpeg', 0.8);
            }
            if (url.length > maxChars) return showToast('الصورة كبيرة', 'جرّب صورة أبسط أو أصغر', 'warning');
            onDone(url);
        };
        img.onerror = () => showToast('تعذر قراءة الصورة', '', 'error');
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

// صورة شخصية: قص مربع من الوسط ثم تصغير إلى size بكسل (JPG صغير يتسع في خلية الشيت)
function cropSquareImage(file, size, onDone) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return showToast('ملف غير صالح', 'اختر صورة (JPG أو PNG)', 'warning');
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            const side = Math.min(img.width, img.height);
            if (!side) return showToast('تعذر قراءة الصورة', 'جرّب صورة JPG أو PNG', 'error');
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, size, size);
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
            let url = canvas.toDataURL('image/jpeg', 0.85);
            if (url.length > 40000) url = canvas.toDataURL('image/jpeg', 0.6);
            onDone(url);
        };
        img.onerror = () => showToast('تعذر قراءة الصورة', 'جرّب صورة JPG أو PNG', 'error');
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

// ================= النوافذ المنبثقة =================
let confirmCallback = null;

function openModal(id) {
    cancelModalOut($(id));
    $(id).classList.remove('hidden');
}
function closeModal(id) {
    if (!$(id).classList.contains('hidden')) animateModalOut($(id));
    $(id).classList.add('hidden');
    // إغلاق نافذة الدفع بدون حفظ = إلغاء
    if (id === 'payModal' && payCtx) cancelPayModal();
}

// زر "⚙️ النسب والشرائح" بصفحة USDT ونافذة أسعار الجنيه: بيفتح الإعدادات على كرتها (لصاحب صلاحية الإعدادات)
function openSettingsCard(id) {
    if (!hasPerm('settings')) return showToast('تنبيه', 'تعديل الإعدادات لصاحب صلاحية الإعدادات', 'warning');
    // الإشعار "المهم" ما بيتسكّر إلا بـ "قرأت"
    document.querySelectorAll('.modal:not(.hidden):not(#notifyAlertModal)').forEach(m => closeModal(m.id));
    switchTab('settings');
    // التاب اللي فيه الكرت (الإعدادات صارت تابات)
    const tab = $(id)?.dataset.stab?.split(' ')[0];
    if (tab) setSettingsTab(tab);
    // بعد ما الصفحة ترسم وتخلص حركة الدخول
    setTimeout(() => {
        $(id)?.scrollIntoView({ behavior: motionReduced() ? 'instant' : 'smooth', block: 'start' });
        replayClass($(id), 'card-flash');
    }, 350);
}

function showAppConfirm(title, message, onConfirm) {
    $('confirmModalTitle').textContent = title;
    $('confirmModalMessage').textContent = message;
    confirmCallback = onConfirm;
    openModal('appConfirmModal');
}

function closeAppConfirm() {
    closeModal('appConfirmModal');
    confirmCallback = null;
}

// ================= شريط الجوال: 4 صفحات + "المزيد" =================
const MOBILE_PRIMARY = ['calculator', 'transactions', 'usdt', 'accounts', 'egp', 'reports', 'customers', 'ready', 'traders', 'expenses', 'countries', 'settings'];

function updateMobileNav() {
    const allowed = MOBILE_PRIMARY.filter(tabVisible);
    const primary = allowed.length <= 5 ? allowed : allowed.slice(0, 4);
    const more = allowed.filter(t => !primary.includes(t));
    TABS.forEach(t => $('mnav-' + t)?.classList.toggle('hidden', !primary.includes(t)));
    $('mnav-more').classList.toggle('hidden', !more.length);
    $('mnav-more-menu').innerHTML = more.map(t => `<button data-action="switch-tab" data-tab="${t}" class="mnav-more-item">${escapeHtml(TITLES[t] || t)}</button>`).join('');
    const current = TABS.find(t => !$('page-' + t).classList.contains('hidden'));
    $('mnav-more').classList.toggle('active', more.includes(navTabOf(current)));
}

function toggleMobileMore() {
    $('mnav-more-menu').classList.toggle('hidden');
}
