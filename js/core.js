'use strict';

// فاست باي — الثوابت والإعدادات الافتراضية، أدوات مساعدة، تحميل البيانات من المتصفح، الإشعارات
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= الثوابت والإعدادات الافتراضية =================
// المتصفح يحفظ الإعدادات والتسعير فقط. الزبائن والحوالات مصدرها Google Sheets.
const STORAGE = {
    config: 'fastpay_v8_config',
    countries: 'fastpay_v8_countries',
    // عمليات لم تصل للشيت بعد (انقطاع إنترنت مثلاً)، تُحذف فور وصولها
    outbox: 'fastpay_v9_outbox',
    // نسخة من شعارات التجار { رقم التاجر: صورة } حتى لا تضيع إن لم يحفظها الشيت
    traderLogos: 'fastpay_v9_trader_logos',
    // جلسة الدخول على هذا الجهاز { token, username, displayName, avatarSig, perms, auth }
    session: 'fastpay_v10_session',
    // نسخة من صورتي الشخصية { user, sig, data } حتى تظهر فوراً بدون طلبها كل مرة
    avatar: 'fastpay_v11_avatar',
    // إشعارات الجوال على هالجهاز { token: رمز فاير بيز, user, at } (push.js)
    push: 'fastpay_v12_push',
    // تعديلات ما انحفظت لأنه حدا عدّل نفس السطر قبل (conflicts.js)، لحد ما تختار [{group, ops, info}]
    conflicts: 'fastpay_v13_conflicts'
};

// مفاتيح قديمة كانت تحفظ الزبائن والحوالات داخل المتصفح، تُمسح عند الفتح
const LEGACY_DATA_KEYS = ['fastpay_v8_customers', 'fastpay_v8_ledger', 'fastpay_v8_sync_queue'];

// رابط السكربت (DEFAULT_WEBHOOK) بـ js/endpoint.js: صفحة تتبّع الحوالة (track.html) كمان بتستعمله
// مصادر سعر السوق بالترتيب (الدولار بالشيكل والجنيه من نفس الطلب):
// Coinbase سعر مباشر بيتحدث كل كم دقيقة. open.er-api احتياط بس: بيتحدث مرة باليوم (00:00 UTC)، فخلال النهار بيكون سعر إمبارح
// الأول قبلهم: السكربت بيجيب سوق العملات (Yahoo، زي الشاشة) من سيرفرات جوجل (ميزة market، shell.js loadMarketRates).
// Coinbase طلع بيتأخر ساعات عن الشاشة (السبت 2026-10-17: 3.097 والشاشة 3.111)، فصار احتياط بس
const RATE_SOURCES = [
    { url: 'https://api.coinbase.com/v2/exchange-rates?currency=USD', live: true, source: 'coinbase', rates: (d) => d?.data?.rates },
    { url: 'https://open.er-api.com/v6/latest/USD', live: false, source: 'daily', rates: (d) => d?.rates }
];
const RATE_REFRESH_MS = 10 * 60 * 1000;

const STATUSES = ['قيد الإنتظار', 'فحص', 'جزئي', 'مكتمل', 'ملغي'];
const CANCELLED = 'ملغي';
const PAYOUTS = ['محفظة', 'بنكي', 'كاش'];
// الجهات المتاحة لكل طريقة استلام (بال باي أول، بطلب عماد 2026-10-19)
const PAYOUT_PROVIDERS = {
    'محفظة': ['بال باي', 'جوال باي'],
    'بنكي': ['بنك فلسطين'],
    'كاش': []
};

const DEFAULT_CONFIG = {
    screenRate: 3.70,
    marketRate: null,
    screenRateLastUpdated: '',
    rateMode: 'auto',          // auto: يتحدث من السوق | manual: مثبّت يدوياً
    costPct: 5.0,
    profitPct: 5.0,
    minusIls: 1.0,
    driveWebhook: DEFAULT_WEBHOOK,
    syncToken: '',
    // سعر البيع والشراء: فرق شبه ثابت عن سعر الشاشة (للعرض فقط)
    sellOffset: -0.01,
    buyOffset: 0.03,
    // بنود مصاريف مقترحة زيادة عن الثابتة (زر "+ بند"، بطلب عماد 2026-10-21)
    expenseCategories: [],
    // بنود مقترحة انشالت بالـ × (حتى الثابتة واللي انكتبت بمصاريف قبل)
    expenseCategoriesHidden: [],
    // تنبيهات الاحتيال لحظة الحفظ (بطلب عماد 2026-10-21): نفس الرقم لاسم ثاني، زبون جديد فوق مبلغ، كثير حوالات باليوم (0 = مسكّر)
    fraudSameNumber: 'yes',
    fraudNewIls: 3000,
    fraudDailyCount: 3,
    // رابط التتبّع برسالة واتساب الحوالة: سويتش عام، وزبائن مستثنيين (أرقامهم)
    trackLinkOn: 'yes',
    trackLinkOff: [],
    // التقرير الشهري بالإيميل: '' = إيميل صاحب السكربت، 'off' = مسكّر، أو إيميل
    reportEmail: '',
    // حد الحوالة للموظف (بطلب عماد 2026-10-19): فوقه بتستنى موافقة المدير
    txLimitOn: 'yes',
    txLimit: 5000,
    // الإشعارات اليومية على الجوال: الساعة، أو 'off'
    pushDebtsHour: '9',
    pushSummaryHour: '22',
    // بيانات الشركة للفاتورة (الشعار ملف ثابت assets/logo.png)
    companyName: 'فاست باي',
    companySubtitle: 'FAST PAY SYSTEM',
    receiptFooter: 'شكراً لتعاملكم معنا',
    // الحالات المخفية في سجل الحوالات (أزرار تشغيل/إيقاف تبقى محفوظة)
    hiddenStatuses: [],
    // إظهار سعر صرف الدولار في الفاتورة (يبقى الاختيار محفوظاً)
    receiptShowRate: true,
    // USDT: نسبة الإيداع (أول شريحة) وشرائحها فوقها، الشبكات ورسومها، وشرائح نسبة السحب حسب المبلغ ($)
    usdtDepositPct: 1,
    usdtDepositTiers: [],
    usdtNetworks: [{ name: 'TRC20', fee: 1.3 }, { name: 'BEP20', fee: 0.15 }],
    usdtTiers: [{ min: 0, pct: 5 }, { min: 400, pct: 4 }, { min: 1000, pct: 3 }],
    // الجنيه المصري: شاشة الجنيه (جنيه للدولار) تلقائية أو مثبّتة، ونسبتنا من السوق للإرسال والاستقبال
    egpRateMode: 'auto',
    egpScreenRate: 0,
    egpMarketRate: 0,
    egpRateUpdated: '',
    egpSendPct: 13,
    egpReceivePct: 13,
    // شرائح النسبة حسب المبلغ بالشيكل فوق أول شريحة (أول شريحة = egpSendPct/egpReceivePct)
    egpSendTiers: [],
    egpReceiveTiers: [],
    // قفل الأيام: آخر يوم مجرود (الحركات لحد هاليوم ما بتتعدل إلا بصلاحية "تعديل الأيام المقفلة")
    lockedThrough: '',
    // رسالة الفاتورة على واتساب حسب الحالة: بس الجمل اللي تعدّلت (الباقي من WA_MESSAGE_DEFAULTS بـ receipts.js)
    waMessages: {},
    // صوت الإشعارات (على هالجهاز بس)
    notifySound: true
};

const DEFAULT_COUNTRIES = [
    { name: '🇶🇦 قطر', type: 'div', factor: 4.03 },
    { name: '🇦🇪 الامارات', type: 'div', factor: 3.76 },
    { name: '🇲🇦 المغرب', type: 'div', factor: 10.5 },
    { name: '🇹🇳 تونس', type: 'div', factor: 3.7 },
    { name: '🇩🇿 الجزائر', type: 'div', factor: 273 },
    { name: '🇮🇶 العراق', type: 'div', factor: 1660 },
    { name: '🇯🇴 الاردن', type: 'mul', factor: 1.365 },
    { name: '🇰🇼 الكويت', type: 'mul', factor: 3.06 },
    { name: '🇧🇭 البحرين', type: 'mul', factor: 2.49 },
    { name: '🇴🇲 سلطنة عمان', type: 'mul', factor: 2.50 },
    { name: '🇾🇪 اليمن', type: 'direct_percent', factor: 6 },
    { name: '🇱🇧 لبنان', type: 'direct_percent', factor: 6 },
    { name: '🇪🇬 جنيه مصري', type: 'div', factor: 50 },
    { name: '🟡 ويسترن يونيون', type: 'mul', factor: 1 },
    { name: '🅿️ باي بال', type: 'mul', factor: 1 },
    { name: '₮ USDT', type: 'mul', factor: 1 },
    { name: '🎵 سحب تيك توك', type: 'mul', factor: 1 }
];

// خيار "أخرى": يكتب المستخدم نوع المعاملة ونسبة الخصم بنفسه
const OTHER_SOURCE = { name: 'أخرى', type: 'direct_percent', factor: 0, other: true };

// مصادر أُضيفت لاحقاً: تُضاف مرة واحدة لقوائم التسعير المحفوظة سابقاً
const ADDED_SOURCES_V2 = ['🇪🇬 جنيه مصري', '🟡 ويسترن يونيون', '🅿️ باي بال', '₮ USDT'];
const ADDED_SOURCES_V3 = ['🎵 سحب تيك توك'];

const DEFAULT_EXPENSE_CATEGORIES = ['كهرباء', 'إيجار', 'مكالمات', 'ضيافة', 'مشاريب', 'إنترنت', 'أخرى'];

const TYPE_SYMBOL = { div: '÷', mul: '×', direct_percent: '%' };
const TYPE_LABEL = { div: 'تقسيم', mul: 'ضرب', direct_percent: 'نسبة' };

// ================= أدوات مساعدة =================
const $ = (id) => document.getElementById(id);

// يحوّل لرقم، ويستخدم البديل فقط إذا لم يكن رقماً صالحاً (الصفر قيمة مقبولة).
// فاصلة الآلاف (1,000 من خانات المبالغ data-commas) بتنشال
function toNum(value, fallback = 0) {
    const n = typeof value === 'number' ? value : parseFloat(typeof value === 'string' ? value.replace(/,/g, '') : value);
    return Number.isFinite(n) ? n : fallback;
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

function fmt(n, digits = 2) {
    return toNum(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// المبلغ مع رمز العملة: 12.50 ₪ أو 12.50 $
const CUR_SYM = { ILS: '₪', USD: '$' };
const moneyCur = (v, cur) => `${fmt(v)} ${CUR_SYM[cur] || '₪'}`;

// رقم الإيصال القصير اللي بيعطيه السكربت (#1042)، أو رقم الحركة الطويل إذا لسا ما وصلت للشيت
const receiptNo = (x) => '#' + (x?.serial || x?.id);
const toSerial = (v) => Math.max(0, Math.trunc(toNum(v, 0)));

// تاريخ اليوم بالتوقيت المحلي (وليس UTC)
function localDateStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function nowTimeLabel() {
    return new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// الأرقام العربية والفارسية (٥٠٠ / ۵۰۰) ← 500، والفاصلة العشرية العربية ٫ ← نقطة
const latinDigits = (v) => String(v ?? '')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/٫/g, '.').replace(/٬/g, '');

// كيبورد الجوال العربي بيكتب ٥٠٠، والخانة الرقمية كانت ترفضها بصمت (المبلغ يضل صفر)، ورقم الجوال
// بالأرقام العربية ما كان ينفع لواتساب. بالخانات الرقمية والجوال والحسابات ([data-latin]) بنكتبها 500 بدالها
function onArabicDigitsInput(e) {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !(el.type === 'number' || el.type === 'tel' || el.hasAttribute('data-latin') || el.hasAttribute('data-commas'))) return;
    const text = e.data ?? e.dataTransfer?.getData('text/plain');
    if (!text || !/[٠-٩۰-۹٫٬]/.test(text)) return;
    e.preventDefault();
    if (document.execCommand('insertText', false, latinDigits(text))) return;
    // متصفح قديم ما بيدعمها: بنضيفها آخر الخانة
    el.value += latinDigits(text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ================= المبالغ بفاصلة الآلاف: 100,000 (بطلب عماد 2026-10-17) =================
// خانات المبالغ عليها data-commas: نص مش رقم (الخانة الرقمية ما بتقبل فاصلة) بكيبورد أرقام (inputmode=decimal).
// الفاصلة بتنحط وإنت بتكتب (onCommasInput)، و toNum بيشيلها، وأي قيمة بيحطها الكود (.value = 1234.5) بتنكتب 1,234.5.
// الخانات اللي بتقبل سالب (التعديل ±، الرصيد الافتتاحي، الجرد) ضلّت رقمية: كيبورد الأرقام بالآيفون ما فيه ناقص
function formatThousands(v) {
    let s = latinDigits(v).replace(/[^\d.]/g, '');
    const dot = s.indexOf('.');
    if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    const [int, dec] = s.split('.');
    // الأصفار بأول الرقم بتضل: مسح أول رقم من 1,000,000 ثم كتابة 2 لازم تعطي 2,000,000
    const head = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return dec === undefined ? head : `${head || '0'}.${dec}`;
}

const INPUT_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
Object.defineProperty(HTMLInputElement.prototype, 'value', {
    ...INPUT_VALUE,
    set(v) { INPUT_VALUE.set.call(this, this.hasAttribute('data-commas') ? formatThousands(v) : v); }
});

// يكتب القيمة مرتبة، والمؤشر بيضل بعد نفس الرقم (keep = كم رقم/نقطة قبله)
function setCommasValue(el, raw, keep) {
    const out = formatThousands(raw);
    INPUT_VALUE.set.call(el, out);
    let pos = 0;
    for (let seen = 0; pos < out.length && seen < keep; pos++) if (out[pos] !== ',') seen++;
    if (document.activeElement === el) el.setSelectionRange(pos, pos);
}

const digitsBefore = (text) => latinDigits(text).replace(/[^\d.]/g, '').length;

function onCommasInput(e) {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !el.hasAttribute('data-commas')) return;
    const raw = INPUT_VALUE.get.call(el);
    if (formatThousands(raw) === raw) return;
    setCommasValue(el, raw, digitsBefore(raw.slice(0, el.selectionStart ?? raw.length)));
}

// المسح فوق الفاصلة: بيمسح الرقم اللي جنبها (وإلا الفاصلة بترجع والمسح كأنه ما صار)
function onCommasDelete(e) {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !el.hasAttribute('data-commas') || el.selectionStart !== el.selectionEnd) return;
    const v = INPUT_VALUE.get.call(el), i = el.selectionStart;
    let raw;
    if (e.inputType === 'deleteContentBackward' && v[i - 1] === ',' && i >= 2) raw = v.slice(0, i - 2) + v.slice(i);
    else if (e.inputType === 'deleteContentForward' && v[i] === ',') raw = v.slice(0, i) + v.slice(i + 2);
    else return;
    e.preventDefault();
    setCommasValue(el, raw, digitsBefore(v.slice(0, e.inputType === 'deleteContentBackward' ? i - 2 : i)));
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

const normPhone = (p) => latinDigits(p).replace(/[\s-]/g, '');
const normName = (n) => String(n ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// رقم الواتساب بصيغة دولية (أرقام فقط بدون + أو 00)
function whatsappDigits(phone) {
    let d = latinDigits(phone).replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    return d;
}
const hasWhatsapp = (c) => whatsappDigits(c?.phone).length >= 10 && !whatsappDigits(c?.phone).startsWith('0');

// ---------- البنك: رقم الجوال للتحويل و IBAN ----------
// IBAN بينحفظ بدون مسافات وبحروف كبيرة، وبينعرض كل 4 حروف لحال. الأرقام العربية (٠-٩) بتتحول
const cleanIban = (v) => latinDigits(v).replace(/[\s-]/g, '').toUpperCase();
const formatIban = (v) => cleanIban(v).replace(/(.{4})(?=.)/g, '$1 ');

// صحيح = شكله صح ورقم الفحص (mod 97) صح. الفلسطيني (PS) طوله 29
function ibanValid(v) {
    const s = cleanIban(v);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    if (s.startsWith('PS') && s.length !== 29) return false;
    let rem = 0;
    for (const ch of s.slice(4) + s.slice(0, 4)) {
        const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
        for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
    }
    return rem === 1;
}

// رقم البنك صار رقم الجوال المربوط بالحساب؛ الحوالات القديمة فيها رقم حساب
const looksLikePhone = (v) => /^(\+?97[02]|0097[02])?0?5\d{8}$/.test(normPhone(v));
function accountLabel(x) {
    if (x?.payout !== 'بنكي') return 'رقم المحفظة';
    return !x.account || looksLikePhone(x.account) ? 'رقم الجوال' : 'رقم الحساب';
}

// نسخ نص للحافظة، وإذا المتصفح ما سمح بالطريقة القديمة. بترجع true إذا نجح.
// writeText بتنطلب فوراً (قبل أي انتظار) حتى تضل جوّا نفس الكبسة
async function copyText(text) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { /* نجرّب الطريقة القديمة */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
}

const newCustomerId = () => 'c' + Date.now() + Math.floor(Math.random() * 1000);

// رقم فريد مبني على الوقت، ولا يتكرر حتى لو أنشأنا عدة حركات في نفس اللحظة
let lastIssuedId = 0;
function nextId() {
    lastIssuedId = Math.max(Date.now(), lastIssuedId + 1);
    return lastIssuedId;
}

// ---------- المستخدمون: الاسم الظاهر والصورة ----------
// { اسم الدخول: الاسم الظاهر } من الشيت، لعرض "بواسطة" بالاسم
let peopleNames = {};
const personName = (username) => peopleNames[username] || username;

// "أضافها فلان · آخر تعديل فلان" يظهر عند الوقوف على الرقم فقط
function auditTitle(x) {
    const parts = [];
    if (x?.createdBy) parts.push(`أضافها: ${personName(x.createdBy)}`);
    if (x?.updatedBy && x.updatedBy !== x.createdBy) parts.push(`آخر تعديل: ${personName(x.updatedBy)}`);
    return escapeHtml(parts.join(' · '));
}

// الصورة الشخصية، أو أول حرف من الاسم على لون ثابت لكل مستخدم
const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5', '#b45309'];
function avatarHtml(name, url, cls = '', seed = name) {
    if (url && String(url).startsWith('data:image/')) return `<span class="avatar ${cls}"><img src="${escapeHtml(url)}" alt=""></span>`;
    let h = 0;
    for (const ch of String(seed || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    const letter = String(name || '').trim().charAt(0) || '؟';
    return `<span class="avatar ${cls}" style="background:${AVATAR_COLORS[h % AVATAR_COLORS.length]}">${escapeHtml(letter)}</span>`;
}

function payoutBadgeClass(payout) {
    if (payout === 'بنكي') return 'bg-purple-50 text-purple-700';
    if (payout === 'كاش') return 'bg-sky-50 text-sky-700';
    return 'bg-emerald-50 text-emerald-700';
}

function statusSelectClass(st) {
    if (st === 'مكتمل') return 'bg-emerald-50 text-emerald-700 border-emerald-200 font-bold';
    if (st === 'قيد الإنتظار') return 'bg-amber-50 text-amber-700 border-amber-200 font-bold';
    if (st === 'جزئي') return 'bg-sky-50 text-sky-700 border-sky-200 font-bold';
    if (st === CANCELLED) return 'bg-red-50 text-red-700 border-red-200 font-bold';
    return 'bg-slate-50 text-slate-700 border-slate-200 font-bold';
}

function downloadBlob(content, mime, filename) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ================= تحميل البيانات وترحيلها =================
function loadJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        const value = JSON.parse(raw);
        return value ?? fallback;
    } catch (e) {
        return fallback;
    }
}

function loadArray(key, fallback) {
    const value = loadJSON(key, fallback);
    return Array.isArray(value) ? value : fallback;
}

let globalConfig = { ...DEFAULT_CONFIG, ...loadJSON(STORAGE.config, {}) };
delete globalConfig.syncCustomers;
delete globalConfig.companyLogo; // الشعار صار ملفاً ثابتاً: assets/logo.png
delete globalConfig.rateOffset; // أُلغي هامش الشاشة: سعر الشاشة = سعر السوق، والفروق في البيع والشراء
let countries = loadArray(STORAGE.countries, DEFAULT_COUNTRIES.map(c => ({ ...c })))
    .map(normalizeCountry).filter(c => c.name);
let outbox = loadArray(STORAGE.outbox, []);

// الإعدادات المشتركة: بعد أول قراءة كاملة فقط نرسل التغييرات (حتى لا نكتب قيماً قديمة فوق الشيت)
let sheetSupportsSettings = false;
let sharedReady = false;
const sharedSnapshot = {}; // آخر قيمة معروفة في الشيت لكل إعداد

// الدخول: authEnabled = في الشيت ورقة مستخدمين (يُعرف من رد السكربت ويُحفظ مع الجلسة)
let session = loadJSON(STORAGE.session, null);
let authEnabled = !!(session?.token || session?.auth);

if (!globalConfig.sourcesV2Added) {
    ADDED_SOURCES_V2.forEach(name => {
        const def = DEFAULT_COUNTRIES.find(c => c.name === name);
        if (def && !countries.some(c => c.name === name)) countries.push({ ...def });
    });
    globalConfig.sourcesV2Added = true;
}
if (!globalConfig.sourcesV3Added) {
    ADDED_SOURCES_V3.forEach(name => {
        const def = DEFAULT_COUNTRIES.find(c => c.name === name);
        if (def && !countries.some(c => c.name === name)) countries.push({ ...def });
    });
    globalConfig.sourcesV3Added = true;
}

countries.forEach((c, i) => { if (!Number.isFinite(c.order)) c.order = i; });

// تبدأ فارغة وتُملأ من Google Sheets
let customers = [];
let ledger = [];
let expenses = [];
let sheetSupportsExpenses = true; // يصبح false إذا كان سكربت الشيت قديماً
let sheetSupportsCountries = false; // تسعير الدول في الشيت (السكربت الجديد)، وإلا يبقى في المتصفح
let dataState = 'loading'; // loading | stale (النسخة المحفوظة لحد ما يوصل الشيت، cache.js) | ready | error

LEGACY_DATA_KEYS.forEach(key => {
    try { localStorage.removeItem(key); } catch (e) { /* التخزين محظور */ }
});

// الشيت قد يحوّل 0599xxxxxx إلى رقم فيضيع الصفر الأول
function fixPhone(value) {
    const p = String(value ?? '').trim();
    return /^5\d{8}$/.test(p) ? '0' + p : p;
}

// لكل دولة تكلفتها (نسبة % أو مبلغ ثابت بالدولار) ونسبة ربحها
// يُستدعى أثناء تحميل الملف (قبل تعريف المتغيرات اللاحقة)، فالعدّاد خاصية على الدالة نفسها
function newCountryId() {
    newCountryId.seq = (newCountryId.seq || 0) + 1;
    return 'k' + Date.now().toString(36) + newCountryId.seq.toString(36);
}

// id ثابت حتى لو تغيّر الاسم، وorder لترتيب القائمة كما هي في الشيت
function normalizeCountry(c) {
    return {
        id: String(c?.id ?? '').trim() || newCountryId(),
        order: toNum(c?.order, NaN),
        name: String(c?.name ?? '').trim(),
        type: TYPE_SYMBOL[c?.type] ? c.type : 'div',
        factor: toNum(c?.factor, 1),
        costMode: c?.costMode === 'fixed' ? 'fixed' : 'pct',
        costValue: Math.max(0, toNum(c?.costValue, globalConfig.costPct)),
        profitPct: Math.max(0, toNum(c?.profitPct, globalConfig.profitPct))
    };
}

function costLabel(mode, value) {
    if (!toNum(value)) return 'بدون تكلفة';
    return mode === 'fixed' ? `$${fmt(value, value % 1 ? 2 : 0)} ثابت` : `${value}%`;
}

function normalizeProvider(payout, provider) {
    const p = String(provider ?? '').trim();
    if (p) return p;
    // الحوالات القديمة بدون جهة: المحفظة كانت جوال باي (قبل ما بال باي يصير أول)، والبنك بنك فلسطين
    if (payout === 'محفظة') return 'جوال باي';
    return (PAYOUT_PROVIDERS[payout] || [])[0] || '';
}

function normalizeCustomer(c) {
    return {
        id: String(c?.id ?? '').trim(),
        phone: String(c?.phone ?? '').trim(),
        name: String(c?.name ?? '').trim(),
        payout: PAYOUTS.includes(c?.payout) ? c.payout : 'محفظة',
        provider: normalizeProvider(c?.payout, c?.provider),
        account: String(c?.account ?? '').trim(),
        bankAccount: latinDigits(String(c?.bankAccount ?? '')).trim(),
        iban: cleanIban(c?.iban),
        // زبون مميز: خصم على نسبة ربح الدولة بالحاسبة (%)، وموثوق = بدون تنبيهات احتيال (المدير بس بيغيّرهم)
        vipDiscount: Math.max(0, round2(toNum(c?.vipDiscount, 0))),
        trusted: c?.trusted === 'yes' || c?.trusted === true ? 'yes' : 'no',
        createdAt: String(c?.createdAt ?? '').slice(0, 10)
    };
}

function normalizeExpense(e) {
    return {
        id: toNum(e?.id, 0),
        date: String(e?.date ?? '').slice(0, 10),
        category: String(e?.category ?? '').trim(),
        amount: toNum(e?.amount, 0),
        note: String(e?.note ?? '').trim(),
        createdBy: String(e?.createdBy ?? '').trim(),
        updatedBy: String(e?.updatedBy ?? '').trim()
    };
}

// الصفوف القديمة في الشيت قد لا تحتوي نوع المعادلة والنسب، فنكملها هنا
function normalizeTx(t) {
    const country = countries.find(c => c.name === t?.country);
    const phone = fixPhone(t?.phone);
    return {
        id: toNum(t?.id, 0),
        serial: toSerial(t?.serial),
        date: String(t?.date ?? '').slice(0, 10),
        recipient: String(t?.recipient ?? '').trim(),
        phone: phone === '-' ? '' : phone,
        customerId: String(t?.customerId ?? '').trim(),
        account: String(t?.account ?? '').trim(),
        bankAccount: latinDigits(String(t?.bankAccount ?? '')).trim(),
        iban: cleanIban(t?.iban),
        payout: PAYOUTS.includes(t?.payout) ? t.payout : 'محفظة',
        provider: normalizeProvider(t?.payout, t?.provider),
        currency: t?.currency === 'USD' ? 'USD' : 'ILS',
        country: String(t?.country ?? ''),
        type: TYPE_SYMBOL[t?.type] ? t.type : (country ? country.type : 'div'),
        orig: toNum(t?.orig, 0),
        factor: toNum(t?.factor, country ? country.factor : 1),
        costPct: toNum(t?.costPct, globalConfig.costPct),
        costMode: t?.costMode === 'fixed' ? 'fixed' : 'pct',
        costFixed: toNum(t?.costFixed, 0),
        profitPct: toNum(t?.profitPct, globalConfig.profitPct),
        minusIls: toNum(t?.minusIls, globalConfig.minusIls),
        screenRate: toNum(t?.screenRate, globalConfig.screenRate),
        clientIls: toNum(t?.clientIls, 0),
        clientUsd: toNum(t?.clientUsd, 0),
        finalAdjust: round2(toNum(t?.finalAdjust, 0)),
        costIls: toNum(t?.costIls, 0),
        profitIls: toNum(t?.profitIls, 0),
        status: STATUSES.includes(t?.status) ? t.status : STATUSES[0],
        // حد الحوالة للموظف: '' | pending (بتستنى المدير) | approved
        approval: t?.approval === 'pending' || t?.approval === 'approved' ? t.approval : '',
        approvedBy: String(t?.approvedBy ?? '').trim(),
        // ⚠️ تنبيه احتيال (الموظف كمّل رغمه)، ورمز رابط التتبّع (السكربت بيعطيه)
        flag: String(t?.flag ?? '').trim(),
        trackToken: String(t?.trackToken ?? '').trim(),
        createdBy: String(t?.createdBy ?? '').trim(),
        updatedBy: String(t?.updatedBy ?? '').trim()
    };
}

// يحفظ في المتصفح الإعدادات والتسعير والعمليات المعلقة فقط
function saveAll() {
    try {
        localStorage.setItem(STORAGE.config, JSON.stringify(globalConfig));
        localStorage.setItem(STORAGE.countries, JSON.stringify(countries));
        localStorage.setItem(STORAGE.outbox, JSON.stringify(outbox));
        // نسخة للمزامنة بالخلفية على الأندرويد (bgsync.js)
        scheduleOutboxMirror();
    } catch (e) {
        console.error('Storage error:', e);
        showToast('تعذر الحفظ في المتصفح', 'التخزين محظور، والعمليات غير المُرسلة قد تضيع عند إغلاق الصفحة', 'error');
    }
    updateReportsData();
    updateSyncPendingBar();
    syncSharedSettings();
    checkLowBalances();
}

// ================= الإشعارات المنبثقة (Toast) =================
const TOAST_STYLES = {
    success: { border: 'border-emerald-200', badge: 'bg-emerald-50 text-emerald-600', icon: '✓', color: '#10b981' },
    info: { border: 'border-blue-200', badge: 'bg-blue-50 text-blue-600', icon: 'ℹ', color: '#3b82f6' },
    warning: { border: 'border-amber-200', badge: 'bg-amber-50 text-amber-600', icon: '!', color: '#f59e0b' },
    error: { border: 'border-rose-200', badge: 'bg-rose-50 text-rose-600', icon: '✕', color: '#f43f5e' }
};

function showToast(title, message = '', type = 'success') {
    const style = TOAST_STYLES[type] || TOAST_STYLES.success;
    const duration = type === 'error' ? 6000 : 3500;
    const toast = document.createElement('div');
    toast.className = `toast-item flex items-center gap-3 p-3.5 rounded-xl border shadow-lg w-80 max-w-full text-xs bg-white text-slate-800 ${style.border}`;
    // خط الوقت المتبقي تحت التنبيه (styles.css)
    toast.style.setProperty('--toast-c', style.color);
    toast.style.setProperty('--toast-ms', duration + 'ms');
    toast.innerHTML = `
        <div class="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${style.badge}">${style.icon}</div>
        <div class="flex-1 min-w-0">
            <p class="font-bold text-slate-900 leading-tight" data-role="title"></p>
            <p class="text-[11px] text-slate-400 mt-0.5 hidden" data-role="message"></p>
        </div>
        <button type="button" class="text-slate-300 hover:text-slate-500 font-bold p-1" data-role="close">✕</button>
    `;
    // textContent يمنع تنفيذ أي HTML داخل الأسماء
    toast.querySelector('[data-role="title"]').textContent = title;
    if (message) {
        const msg = toast.querySelector('[data-role="message"]');
        msg.textContent = message;
        msg.classList.remove('hidden');
    }
    toast.querySelector('[data-role="close"]').addEventListener('click', () => toast.remove());

    $('toastContainer').appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 20);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
