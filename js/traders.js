'use strict';

// فاست باي — التجار: القائمة، حساب التاجر (صفحة بتبويبات: الكشف، الخدمات، الجملة، المعلومات)، والحركات
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= التجار (حساب جارٍ بين تاجر وتاجر) =================
// الرصيد الموجب = لنا عنده، والسالب = له عندنا. لكل عملة رصيد مستقل.
const TRADE_CURRENCIES = {
    USD: { sym: '$', name: 'دولار' },
    EUR: { sym: '€', name: 'يورو' },
    JOD: { sym: 'د.أ', name: 'دينار' },
    ILS: { sym: '₪', name: 'شيكل' }
};

// sign: اتجاه الأثر على الرصيد (+ لنا عنده، - له عندنا)، feeOp: العمولة تُخصم (-1) أو تُضاف (+1)
// النسبة تبدأ دائماً من صفر وتُكتب يدوياً لكل حركة (أو من جدول خدمة التاجر)، وتُخصم من مبلغ الحركة.
// العمولة = المبلغ × النسبة + مبلغ ثابت (جدول الخدمة: 5$ أو 1.8%)
// الجملة (بطلب عماد 2026-10-17): شراء بنسبته (عليك المبلغ + نسبته) وبيع بنسبتي (إلك المبلغ + نسبتي)،
// والبيع بيحسب ربحه = المبلغ × (نسبة البيع − نسبة الشراء). الربح بيضل بصفحة التجار بس (مش بالتقارير، بقراره)
// legacy: أنواع قديمة تبقى لقراءة الحركات السابقة فقط ولا تظهر كأزرار
// settle: التصفير، واتجاهه (he_paid / i_paid) يُحدَّد تلقائياً حسب الرصيد
const TMOVE_KINDS = {
    for_us: { label: 'لنا', hint: 'مبلغ لنا عنده، وتُخصم العمولة منه إن وُجدت', sign: 1, feeOp: -1 },
    for_him: { label: 'له', hint: 'مبلغ له عندنا، وتُخصم العمولة منه إن وُجدت', sign: -1, feeOp: -1 },
    buy_whole: { label: 'شراء جملة', hint: 'اشتريت منه مبلغ بنسبته: صار عليك المبلغ + النسبة', sign: -1, feeOp: 1, whole: 'buy' },
    sell_whole: { label: 'بيع جملة', hint: 'بعتله مبلغ بنسبتك: صار إلك عنده المبلغ + النسبة', sign: 1, feeOp: 1, whole: 'sell' },
    he_paid: { label: 'تصفير (دفع لنا)', hint: 'دفع لنا دفعة لتسديد الرصيد، وتُخصم العمولة منها إن وُجدت', sign: -1, feeOp: -1, settle: true },
    i_paid: { label: 'تصفير (دفعنا له)', hint: 'دفعنا له دفعة لتسديد الرصيد، وتُخصم العمولة منها إن وُجدت', sign: 1, feeOp: -1, settle: true },
    recv_for_me: { label: 'استلم لنا', hint: 'استلم مبلغاً لحسابنا، وتُخصم عمولته', sign: 1, feeOp: -1, legacy: true },
    paid_for_me: { label: 'أرسل عنا', hint: 'أرسل مبلغاً لصالحنا، وتُضاف عمولته', sign: -1, feeOp: 1, legacy: true },
    recv_for_him: { label: 'استلمنا له', hint: 'استلمنا مبلغاً لحسابه، وتُخصم عمولتنا', sign: -1, feeOp: -1, legacy: true },
    paid_for_him: { label: 'أرسلنا عنه', hint: 'أرسلنا مبلغاً لصالحه، وتُضاف عمولتنا', sign: 1, feeOp: 1, legacy: true }
};

let traders = [];
let traderMoves = [];
let sheetSupportsTraders = true;

function normalizeTrader(t) {
    return {
        id: String(t?.id ?? '').trim(),
        name: String(t?.name ?? '').trim(),
        phone: String(t?.phone ?? '').trim(),
        commissionPct: Math.max(0, toNum(t?.commissionPct, 0)),
        myCommissionPct: Math.max(0, toNum(t?.myCommissionPct, 0)),
        note: String(t?.note ?? '').trim(),
        logo: /^data:image\//.test(String(t?.logo ?? '')) ? String(t.logo) : '',
        createdAt: String(t?.createdAt ?? '').slice(0, 10)
    };
}

// ---------- نسخة الشعارات في المتصفح ----------
function loadTraderLogos() {
    const v = loadJSON(STORAGE.traderLogos, {});
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function saveTraderLogo(id, logo) {
    const logos = loadTraderLogos();
    if (logo) logos[id] = logo; else delete logos[id];
    try {
        localStorage.setItem(STORAGE.traderLogos, JSON.stringify(logos));
    } catch (e) {
        console.error('Logo storage error:', e);
        showToast('تعذر حفظ نسخة الشعار', 'مساحة المتصفح ممتلئة', 'warning');
    }
}

// بصمة الشعار: نفس طريقة السكربت (طوله + آخر حروفه)
function logoSig(logo) {
    const v = String(logo || '');
    return v ? v.length + ':' + v.slice(-16) : '';
}

// الشيت يرسل بصمة الشعار فقط (logoSig)، فنعرض النسخة المحفوظة عندنا ونطلب من الشيت فقط الشعار الذي تغيّر.
// السكربت الأقدم يرسل الشعار كاملاً (logo) أو لا يرسله أبداً (بلا عمود) فنعرض النسخة المحفوظة.
// شعار محفوظ عندنا وناقص في الشيت يُرفع له مرة واحدة.
async function syncTraderLogos(rawTraders) {
    const cache = loadTraderLogos();
    const need = [];
    const backfill = [];
    const pending = (id) => outbox.some(op => op.action === 'upsert_trader' && op.trader?.id === id);
    rawTraders.forEach(r => {
        const t = traders.find(x => x.id === String(r?.id ?? '').trim());
        if (!t || pending(t.id)) return;
        const cached = cache[t.id] || '';
        if ('logoSig' in r || 'logo' in r) {
            const sig = 'logoSig' in r ? String(r.logoSig || '') : logoSig(r.logo);
            if (!sig) {
                t.logo = cached;
                if (cached) backfill.push({ action: 'upsert_trader', trader: { ...t } });
            } else if (logoSig(cached) === sig) {
                t.logo = cached;
            } else if ('logo' in r) {
                t.logo = String(r.logo);
                saveTraderLogo(t.id, t.logo);
            } else if (logoSig(t.logo) === sig) {
                saveTraderLogo(t.id, t.logo);
            } else {
                need.push(t.id);
            }
        } else if (!t.logo) {
            t.logo = cached;
        }
    });
    if (backfill.length) { queueOps(...backfill); flushOutbox(); }
    if (!need.length) return;
    const res = await postToSheets({ action: 'logos', ids: need });
    const logos = res.status === 'ok' ? res.data?.logos : null;
    if (!logos) return;
    Object.entries(logos).forEach(([id, logo]) => {
        const t = traders.find(x => x.id === id);
        if (!t) return;
        t.logo = /^data:image\//.test(logo) ? logo : '';
        saveTraderLogo(id, t.logo);
    });
    renderTraders();
}

// شعار التاجر أو أول حرف من اسمه
function traderAvatar(t) {
    return t.logo
        ? `<img src="${escapeHtml(t.logo)}" alt="" class="w-full h-full object-contain bg-white">`
        : escapeHtml(t.name.charAt(0) || '؟');
}


// ================= الحساب: العمولة والأثر على الرصيد =================
// لنا/له/التصفير: العمولة بتنخصم من المبلغ، وما بتعدّيه (عمولة 5$ على 3$ = 3$، الأثر صفر مش سالب).
// الجملة: النسبة بتنزاد على المبلغ.
function moveEffect(kind, amount, pct, fixed = 0) {
    const k = TMOVE_KINDS[kind] || TMOVE_KINDS.for_us;
    const raw = amount * (pct / 100) + fixed;
    const commission = k.feeOp < 0 ? Math.min(amount, raw) : raw;
    return { commission, effect: k.sign * (amount + k.feeOp * commission), capped: commission < raw - 1e-9 };
}

// ربح بيع الجملة: اللي أخدناه فوق المبلغ ناقص اللي دفعناه لما اشتريناه
const wholesaleProfit = (amount, commission, buyPct) => round2(commission - amount * (buyPct / 100));

function normalizeTmove(m) {
    const kind = TMOVE_KINDS[m?.kind] ? m.kind : 'for_us';
    const amount = Math.max(0, toNum(m?.amount, 0));
    const pct = Math.max(0, toNum(m?.commissionPct, 0));
    const fixed = Math.max(0, round2(toNum(m?.commissionFixed, 0)));
    const { commission, effect } = moveEffect(kind, amount, pct, fixed);
    const buyPct = kind === 'sell_whole' ? Math.max(0, toNum(m?.buyPct, 0)) : 0;
    return {
        id: toNum(m?.id, 0),
        date: String(m?.date ?? '').slice(0, 10),
        traderId: String(m?.traderId ?? '').trim(),
        traderName: String(m?.traderName ?? '').trim(),
        kind,
        currency: TRADE_CURRENCIES[m?.currency] ? m.currency : 'USD',
        amount,
        commissionPct: pct,
        commissionFixed: fixed,
        commission: round2(commission),
        effect: round2(effect),
        buyPct,
        profit: kind === 'sell_whole' ? wholesaleProfit(amount, commission, buyPct) : 0,
        serviceId: String(m?.serviceId ?? '').trim(),
        note: String(m?.note ?? '').trim()
    };
}

// نص العمولة: "1.8%" أو "5$" أو "5% + 0.1$"
function commissionText(pct, fixed, cur = 'USD') {
    const parts = [];
    if (pct) parts.push(`${round2(pct)}%`);
    if (fixed || !pct) parts.push(`${fmtTrim(fixed)}${curSym(cur)}`);
    return parts.join(' + ');
}

// نسب الجملة الافتراضية تبع التاجر: "شراء جملة 2% · بيع جملة 3%"
function traderWholePctText(t) {
    const parts = [];
    if (t.commissionPct) parts.push(`شراء جملة ${round2(t.commissionPct)}%`);
    if (t.myCommissionPct) parts.push(`بيع جملة ${round2(t.myCommissionPct)}%`);
    return parts.join(' · ');
}

// ================= خدمات التجار (بطلب عماد 2026-10-17) =================
// لكل تاجر خدمات (ويسترن، باي بال...) بجدول عمولته زي ما بيبعته: لحد 100$ ← 5$، لحد 1000$ ← 1.8%، 2001$ وأكثر ← 1.2%.
// بصفحة التجار بس: بتختار الخدمة بحركة "لنا/له" بالدولار فعمولتها بتنحسب لحالها حسب المبلغ.
// الحاسبة ما إلها دخل بالتجار (بقرار عماد): ويسترن وباي بال فيها دول عادية
let traderServices = [];

// الشريحة: لحد upTo (شاملة)، والأخيرة بدون حد = وأكثر. أي مبلغ فوق آخر حد بياخد آخر شريحة
function normalizeServiceTiers(raw) {
    let list = raw;
    if (typeof raw === 'string') { try { list = JSON.parse(raw || '[]'); } catch (e) { list = []; } }
    return (Array.isArray(list) ? list : [])
        .map(t => {
            const upTo = t?.upTo === null || t?.upTo === undefined || t?.upTo === '' ? null : toNum(t.upTo, NaN);
            return { upTo: Number.isFinite(upTo) && upTo > 0 ? round2(upTo) : null, pct: Math.max(0, round2(toNum(t?.pct, 0))), fixed: Math.max(0, round2(toNum(t?.fixed, 0))) };
        })
        .sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
}

function normalizeService(s) {
    return {
        id: String(s?.id ?? '').trim(),
        traderId: String(s?.traderId ?? '').trim(),
        traderName: String(s?.traderName ?? '').trim(),
        name: String(s?.name ?? '').trim(),
        order: toNum(s?.order, 0),
        tiers: normalizeServiceTiers(s?.tiers),
        note: String(s?.note ?? '').trim(),
        logo: String(s?.logo ?? '').trim()
    };
}

// ---------- شعار الخدمة ----------
// logo: فاضي = تلقائي من اسم الخدمة، "brand:paypal,moneygram" = شعارات جاهزة (service-logos.js)، "none" = بدون، أو صورة مرفوعة data:image
// الشعارات الجاهزة اللي اسمها مذكور بالخدمة، بترتيب ذكرها (أطول كلمة بتغلب: "ابل باي" مش "ابل")، لحد 3
function brandsInName(name) {
    const text = String(name || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
    const hits = [];
    Object.entries(SERVICE_BRANDS).forEach(([key, b]) => {
        b.words.forEach(w => {
            const word = w.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
            const at = text.indexOf(word);
            if (at >= 0) hits.push({ key, at, end: at + word.length });
        });
    });
    hits.sort((a, b) => a.at - b.at || (b.end - b.at) - (a.end - a.at));
    const picked = [];
    hits.forEach(h => {
        if (picked.some(p => p.key === h.key || (h.at < p.end && p.at < h.end))) return;
        picked.push(h);
    });
    return picked.slice(0, 3).map(h => h.key);
}

function serviceBrandKeys(sv) {
    const logo = sv?.logo || '';
    if (logo.startsWith('brand:')) return logo.slice(6).split(',').filter(k => SERVICE_BRANDS[k]).slice(0, 3);
    if (logo) return [];
    return brandsInName(sv?.name);
}

const brandSvg = (key) => {
    const b = SERVICE_BRANDS[key];
    return b ? `<svg viewBox="0 0 24 24" aria-label="${escapeHtml(b.name)}" role="img"><path fill="#${b.hex}" d="${b.d}"/></svg>` : '';
};

// الشعار بمربع أبيض (بيضل فاتح بالوضع الداكن حتى الشعارات السودا تبين). size: sm (الكشف والقوائم) / md / lg
function serviceLogoHtml(sv, size = 'md') {
    const logo = sv?.logo || '';
    if (/^data:image\//.test(logo)) return `<span class="sv-logo ${size}"><img src="${escapeHtml(logo)}" alt=""></span>`;
    const keys = serviceBrandKeys(sv);
    if (!keys.length) return '';
    return `<span class="sv-logos">${keys.map(k => `<span class="sv-logo ${size}">${brandSvg(k)}</span>`).join('')}</span>`;
}

const servicesOf = (traderId) => traderServices.filter(s => s.traderId === traderId).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

function serviceTier(s, amount) {
    const tiers = s?.tiers || [];
    if (!tiers.length) return null;
    return tiers.find(t => t.upTo === null || amount <= t.upTo + 1e-9) || tiers[tiers.length - 1];
}

// عمولة التاجر على مبلغ (بالدولار): النسبة + الثابت، وما بتعدّي المبلغ نفسه
function serviceFee(s, amount) {
    const t = serviceTier(s, amount);
    if (!t || !(amount > 0)) return 0;
    return round2(Math.min(amount, amount * (t.pct / 100) + t.fixed));
}

// "لحد 100$" / "101 – 300$" / "2001$ وأكثر" (زي ما التاجر بيكتبها). الحد بكسور (100.5): "فوق 100.5 – 300$"
function tierRangeLabel(tiers, i) {
    const t = tiers[i];
    const prev = i > 0 && tiers[i - 1].upTo !== null ? tiers[i - 1].upTo : 0;
    const whole = Number.isInteger(prev);
    if (t.upTo === null) return !prev ? 'كل المبالغ' : whole ? `${fmtTrim(prev + 1)}$ وأكثر` : `فوق ${fmtTrim(prev)}$`;
    if (!prev) return `لحد ${fmtTrim(t.upTo)}$`;
    return `${whole ? fmtTrim(prev + 1) : `فوق ${fmtTrim(prev)}`} – ${fmtTrim(t.upTo)}$`;
}

// ---------- قراءة جدول العمولات من رسالة واتساب التاجر ----------
// "من 0 الى 100 $ عمولة 5$ / من 301$ إلى $1000 عمولة 1.8% / 2001$ وأكثر 1.2% عمولة"
// بنلاقي الفترات (من … إلى … أو … وأكثر)، والعمولة بعد كل فترة لحد اللي بعدها: نسبة إذا في %، وإلا مبلغ بـ $.
// الاسم من أول سطر بدون أرقام (بعد ما نشيل "تحديث عمولات" والرموز)
function parseTierMessage(text) {
    const clean = latinDigits(text).replace(/[*_~]/g, ' ').replace(/(\d),(?=\d{3}\b)/g, '$1');
    const num = '\\$?\\s*(\\d+(?:\\.\\d+)?)\\s*\\$?';
    const rangeRe = new RegExp(`من\\s*${num}\\s*(?:إلى|الى|الي|إلي|لـ|حتى|لحد|-|–)\\s*${num}`, 'g');
    const openRe = new RegExp(`${num}\\s*(?:و\\s*)?(?:أكثر|اكثر|فما\\s*فوق|فأكثر|فاكثر|وفوق)`, 'g');
    const found = [];
    let m;
    while ((m = rangeRe.exec(clean))) found.push({ at: m.index, end: rangeRe.lastIndex, upTo: toNum(m[2], NaN) });
    while ((m = openRe.exec(clean))) {
        if (!found.some(f => m.index >= f.at && m.index < f.end)) found.push({ at: m.index, end: openRe.lastIndex, upTo: null, from: toNum(m[1], NaN) });
    }
    found.sort((a, b) => a.at - b.at);
    const tiers = [];
    found.forEach((f, i) => {
        const seg = clean.slice(f.end, i + 1 < found.length ? found[i + 1].at : clean.length);
        const pct = seg.match(/(\d+(?:\.\d+)?)\s*%/);
        const fixed = seg.match(/\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*\$|(?:عمولة|عموله)\s*(\d+(?:\.\d+)?)/);
        const tier = { upTo: f.upTo, pct: pct ? toNum(pct[1], 0) : 0, fixed: !pct && fixed ? toNum(fixed[1] ?? fixed[2] ?? fixed[3], 0) : 0 };
        if (tier.pct || tier.fixed) tiers.push(tier);
    });
    const title = clean.split(/\n/).map(l => l.replace(/[^\p{L}\p{N}\s/&()-]/gu, ' ').replace(/تحديث\s*(?:ال)?عمولات|عمولات/g, '').replace(/\s+/g, ' ').trim())
        .find(l => l && !/\d/.test(l)) || '';
    return { name: title, tiers: normalizeServiceTiers(tiers) };
}

// ================= أدوات العرض والأرصدة =================
const curSym = (c) => TRADE_CURRENCIES[c]?.sym || c;
const tradeMoney = (v, c, digits = 2) => `<bdi class="ltr-num">${fmt(Math.abs(v), digits)} ${curSym(c)}</bdi>`;
const isZero = (v) => Math.abs(v) < 0.005;
// المبلغ مع إشارته داخل نفس الاتجاه (حتى لا تنقلب الإشارة في الصفحة العربية)
const signedMoney = (v, c) => `<bdi class="ltr-num">${isZero(v) ? '' : v > 0 ? '+' : '−'}${fmt(Math.abs(v))} ${curSym(c)}</bdi>`;
// لون الرصيد/الأثر: لنا أخضر، له أحمر، صفر رمادي
const traderEffClass = (v) => (isZero(v) ? 'text-slate-400' : v > 0 ? 'text-emerald-700' : 'text-rose-700');

function traderMovesOf(id, currency) {
    return traderMoves
        .filter(m => m.traderId === id && (!currency || m.currency === currency))
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

function traderBalances(id) {
    const bal = {};
    traderMoves.forEach(m => {
        if (m.traderId !== id) return;
        bal[m.currency] = round2((bal[m.currency] || 0) + m.effect);
    });
    return bal;
}

function balanceText(v) {
    if (isZero(v)) return 'متصفّر';
    return v > 0 ? 'لنا عنده' : 'له عندنا';
}

function balanceChip(cur, v, big = false) {
    const cls = isZero(v) ? 'zero' : (v > 0 ? 'mine' : 'his');
    return `<span class="bal-chip ${cls}${big ? ' big' : ''}">
        <span class="bal-chip-label">${balanceText(v)}</span>
        <b>${tradeMoney(v, cur)}</b>
    </span>`;
}

function traderWhatsapp(t) {
    if (!hasWhatsapp(t)) return '';
    return `<button data-action="open-wa-trader" data-id="${escapeHtml(t.id)}" class="wa-btn" title="فتح محادثة واتساب">${WA_ICON}<bdi class="ltr-num">+${escapeHtml(whatsappDigits(t.phone))}</bdi></button>`;
}

// ================= صفحة التجار =================
// صفحة وحدة بوجهين: قائمة التجار، أو حساب تاجر واحد (بدل النافذة) بزر رجوع وتبويبات.
let panelTraderId = null;

function renderTraders() {
    if (pageHidden('traders')) return;
    $('traders-unsupported').classList.toggle('hidden', sheetSupportsTraders || dataState !== 'ready');
    if (panelTraderId && !traders.some(x => x.id === panelTraderId)) panelTraderId = null;
    $('traders-list-view').classList.toggle('hidden', !!panelTraderId);
    $('trader-view').classList.toggle('hidden', !panelTraderId);
    if (panelTraderId) renderTraderPanel(); else renderTraderList();
}

// ---------- القائمة: ملخص العملات، الترتيب والفلتر، وكرت لكل تاجر ----------
let traderSort = 'recent';
let traderFilter = 'all';

const TRADER_SORTS = { recent: 'آخر تعامل', balance: 'الأكبر رصيداً', name: 'الاسم' };
const TRADER_FILTERS = { all: 'الكل', mine: 'لنا عنده', his: 'له عندنا', zero: 'متصفّر' };

// حالة التاجر بكل عملاته: لنا عنده بعملة وحدة على الأقل، له عندنا، أو كله صفر
function traderBalanceState(bal) {
    const vals = Object.values(bal).filter(v => !isZero(v));
    return { mine: vals.some(v => v > 0), his: vals.some(v => v < 0), zero: !vals.length };
}

// الرصيد كله بالشيكل (للترتيب بس): الدولار بالشاشة واليورو والدينار بسعر السوق
function traderBalanceWeight(bal) {
    const fx = positionRates();
    return Object.entries(bal).reduce((s, [c, v]) => s + Math.abs(v) * (fx[c] || 1), 0);
}

function renderTraderList() {
    // المجموع لكل عملة: كم لنا عند التجار وكم لهم عندنا
    const totals = {};
    const info = traders.map(t => {
        const bal = traderBalances(t.id);
        const moves = traderMovesOf(t.id);
        Object.entries(bal).forEach(([c, v]) => {
            totals[c] ??= { mine: 0, his: 0 };
            if (v > 0) totals[c].mine += v; else totals[c].his += -v;
        });
        return { t, bal, moves, last: moves[moves.length - 1], state: traderBalanceState(bal) };
    });
    const whole = wholesaleProfitByCurrency();
    const curs = Object.keys(totals);
    $('traders-totals').innerHTML = curs.map((c, i) => `
        <div class="ana-tile" style="--d:${i * 60}ms">
            <span class="ana-tile-label">${TRADE_CURRENCIES[c].name}</span>
            <span class="text-xs text-emerald-700 font-bold">لنا عند التجار: ${tradeMoney(totals[c].mine, c)}</span>
            <span class="text-xs text-rose-700 font-bold">للتجار عندنا: ${tradeMoney(totals[c].his, c)}</span>
            <span class="text-[11px] text-slate-500">الصافي: ${balanceText(totals[c].mine - totals[c].his)} ${tradeMoney(totals[c].mine - totals[c].his, c)}</span>
            ${whole[c] ? `<span class="text-[11px] font-bold text-emerald-700 profit-only">ربح الجملة: هالشهر ${tradeMoney(whole[c].month, c)} · الكل ${tradeMoney(whole[c].all, c)}</span>` : ''}
        </div>`).join('');

    const counts = { all: info.length, mine: 0, his: 0, zero: 0 };
    info.forEach(x => { if (x.state.mine) counts.mine++; if (x.state.his) counts.his++; if (x.state.zero) counts.zero++; });
    $('trader_filters').innerHTML = Object.entries(TRADER_FILTERS).map(([k, l]) => `
        <button type="button" data-action="trader-filter" data-filter="${k}" class="tf-chip ${k}${k === traderFilter ? ' active' : ''}">${l}<b>${counts[k]}</b></button>`).join('');
    $('trader_sort').value = traderSort;

    const q = normName($('trader_search').value);
    const list = info
        .filter(x => (!q || normName(x.t.name).includes(q) || (x.t.phone && latinDigits($('trader_search').value).replace(/\D/g, '').length >= 3 && whatsappDigits(x.t.phone).includes(latinDigits($('trader_search').value).replace(/\D/g, ''))))
            && (traderFilter === 'all' || x.state[traderFilter]));
    const lastKey = (x) => x.last ? x.last.date + String(x.last.id).padStart(16, '0') : '';
    list.sort(traderSort === 'name' ? (a, b) => a.t.name.localeCompare(b.t.name, 'ar')
        : traderSort === 'balance' ? (a, b) => traderBalanceWeight(b.bal) - traderBalanceWeight(a.bal) || a.t.name.localeCompare(b.t.name, 'ar')
        : (a, b) => lastKey(b).localeCompare(lastKey(a)) || a.t.name.localeCompare(b.t.name, 'ar'));

    if (!list.length) {
        const msg = traders.length ? (q ? 'لا يوجد تاجر بهذا الاسم' : `ما في تجار "${TRADER_FILTERS[traderFilter]}"`) : 'لا يوجد تجار بعد. أضف أول تاجر للبدء.';
        $('traders-grid').innerHTML = `<div class="col-span-full section-card p-8 text-center text-sm text-slate-400">${emptyMessage(traders.length, msg, msg)}</div>`;
        return;
    }
    $('traders-grid').innerHTML = list.map((x, i) => traderCardHtml(x, i)).join('');
}

function traderCardHtml({ t, bal, moves, last }, i) {
    const chips = Object.entries(bal).map(([c, v]) => balanceChip(c, v)).join('') || '<span class="text-xs text-slate-400">لا توجد حركات بعد</span>';
    const svs = servicesOf(t.id);
    const sub = [traderWholePctText(t), t.note && escapeHtml(t.note)].filter(Boolean).join(' · ');
    return `
        <div class="trader-card" data-action="open-trader" data-id="${escapeHtml(t.id)}" style="--d:${Math.min(i, 12) * 50}ms">
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2.5 min-w-0">
                    <span class="tc-avatar">${traderAvatar(t)}</span>
                    <div class="min-w-0">
                        <div class="text-lg font-black text-slate-900 truncate">${escapeHtml(t.name)}</div>
                        ${sub ? `<div class="text-xs text-slate-500 truncate">${sub}</div>` : ''}
                    </div>
                </div>
                <button data-action="new-tmove" data-id="${escapeHtml(t.id)}" class="shrink-0 text-sm font-bold bg-slate-900 text-white px-4 py-2 rounded-xl">+ حركة</button>
            </div>
            ${svs.length ? `<div class="tc-services">${svs.map(sv => `<span class="tc-service">${serviceLogoHtml(sv, 'sm')}<span class="truncate">${escapeHtml(sv.name)}</span></span>`).join('')}</div>` : ''}
            <div class="flex flex-wrap gap-2 mt-3">${Object.entries(bal).length ? Object.entries(bal).map(([c, v]) => balanceChip(c, v, true)).join('') : chips}</div>
            <div class="text-xs text-slate-400 mt-3">${last ? `آخر حركة ${relativeDays(last.date)} · ${moves.length} حركة` : ''}</div>
        </div>`;
}

// ---------- نافذة التاجر (إضافة وتعديل) ----------
function openTraderModal(t = null) {
    $('traderModalTitle').textContent = t ? 'تعديل التاجر: ' + t.name : 'تاجر جديد';
    $('tr_id').value = t ? t.id : '';
    $('tr_name').value = t ? t.name : '';
    $('tr_phone').value = t ? t.phone : '';
    $('tr_commission').value = t ? t.commissionPct || '' : '';
    $('tr_my_commission').value = t ? t.myCommissionPct || '' : '';
    $('tr_note').value = t ? t.note : '';
    setTraderLogo(t ? t.logo : '');
    traderFormLogoInitial = traderFormLogo;
    openModal('traderModal');
    $('tr_name').focus();
}

// الشعار المختار في نموذج التاجر (يُحفظ مع التاجر في الشيت)
let traderFormLogo = '';
let traderFormLogoInitial = '';
function setTraderLogo(url) {
    traderFormLogo = url || '';
    $('tr_logo_preview').innerHTML = traderFormLogo
        ? `<img src="${escapeHtml(traderFormLogo)}" alt="" class="w-full h-full object-contain bg-white">`
        : (escapeHtml($('tr_name').value.trim().charAt(0)) || '🏪');
    $('tr_logo_remove').classList.toggle('hidden', !traderFormLogo);
}

async function saveTrader(e) {
    e.preventDefault();
    if (!sheetSupportsTraders) return showToast('حدّث السكربت أولاً', 'سكربت Google Sheets الحالي لا يدعم التجار', 'warning');
    const editId = $('tr_id').value;
    const t = normalizeTrader({
        id: editId || 't' + Date.now(),
        name: $('tr_name').value, phone: $('tr_phone').value,
        commissionPct: $('tr_commission').value, myCommissionPct: $('tr_my_commission').value,
        note: $('tr_note').value, logo: traderFormLogo
    });
    if (!t.name) return showToast('تنبيه', 'اسم التاجر مطلوب', 'warning');
    if (t.phone && !hasWhatsapp(t)) return showToast('رقم الواتساب غير مكتمل', 'اكتبه مع المقدمة، مثل 970599123456', 'warning');
    if (traders.some(x => normName(x.name) === normName(t.name) && x.id !== editId)) return showToast('تنبيه', 'يوجد تاجر بنفس الاسم', 'warning');

    const existing = traders.find(x => x.id === editId);
    // اسم التاجر محفوظ كمان بخدماته (عمود "التاجر" بالشيت حتى تنقرا الورقة)
    const renamedServices = existing && existing.name !== t.name ? servicesOf(t.id) : [];
    renamedServices.forEach(sv => { sv.traderName = t.name; });
    // الشعار يُرسل للشيت فقط إن تغيّر، حتى لا نمسحه إن لم يكن قد وصل بعد
    const logoChanged = traderFormLogo !== traderFormLogoInitial;
    if (logoChanged) saveTraderLogo(t.id, t.logo);
    if (existing) Object.assign(existing, { ...t, createdAt: existing.createdAt });
    else traders.unshift({ ...t, createdAt: localDateStr() });
    const payload = { ...(existing || traders[0]) };
    if (!logoChanged) delete payload.logo;
    queueOps({ action: 'upsert_trader', trader: payload }, ...renamedServices.map(sv => ({ action: 'upsert_service', service: serviceOpPayload(sv) })));
    closeModal('traderModal');
    renderTraders();
    const status = await flushOutbox();
    showToast('تم حفظ التاجر', `${t.name} — ${syncResultMessage(status)}`, syncToastType(status));
}

function deleteTraderPrompt(id) {
    const t = traders.find(x => x.id === id);
    if (!t) return;
    const count = traderMoves.filter(m => m.traderId === id).length;
    const svs = servicesOf(id);
    showAppConfirm('حذف التاجر', `سيُحذف "${t.name}"${count ? ` و${count} حركة على حسابه` : ''}${svs.length ? ` و${svs.length} خدمة` : ''} من الشيت. متابعة؟`, async () => {
        const ops = traderMoves.filter(m => m.traderId === id).map(m => ({ action: 'delete_tmove', id: m.id }))
            .concat(svs.map(sv => ({ action: 'delete_service', id: sv.id })));
        traderMoves = traderMoves.filter(m => m.traderId !== id);
        traderServices = traderServices.filter(x => x.traderId !== id);
        traders = traders.filter(x => x.id !== id);
        saveTraderLogo(id, '');
        queueOps(...ops, { action: 'delete_trader', id });
        if (panelTraderId === id) panelTraderId = null;
        renderTraders();
        const status = await flushOutbox();
        showToast('تم حذف التاجر', syncResultMessage(status), syncToastType(status));
    });
}

// ================= حساب التاجر (صفحة كاملة بتبويبات) =================
let panelCurrency = 'USD';
let panelPeriod = 'since_zero';
let panelTab = 'statement';
let panelFrom = '';
let panelTo = '';
let panelSearch = '';

const PERIODS = {
    since_zero: 'منذ آخر تصفير',
    today: 'اليوم',
    week: 'آخر 7 أيام',
    month: 'هذا الشهر',
    all: 'كل الحركات',
    range: 'من تاريخ لتاريخ'
};

const TRADER_TABS = { statement: 'الكشف', services: 'الخدمات', wholesale: 'الجملة', info: 'المعلومات' };

const traderViewOpen = () => !!panelTraderId && !pageHidden('traders');

function openTraderPanel(id, currency) {
    const t = traders.find(x => x.id === id);
    if (!t) return;
    // فتح الصفحة من مكان ثاني (البحث) بيرجّعها للقائمة، فبنحدد التاجر بعدها
    if (pageHidden('traders')) switchTab('traders');
    panelTraderId = id;
    const bal = traderBalances(id);
    const used = Object.keys(bal);
    panelCurrency = currency || (used.find(c => !isZero(bal[c])) || used[0] || 'USD');
    panelPeriod = 'since_zero';
    panelTab = 'statement';
    panelFrom = panelTo = panelSearch = '';
    renderTraders();
    window.scrollTo({ top: 0 });
    playPageEnter($('trader-view'));
}

function closeTraderView() {
    if (!panelTraderId) return;
    panelTraderId = null;
    renderTraders();
    window.scrollTo({ top: 0 });
}

// حركات الفترة مع الرصيد الجاري قبل وبعد كل حركة. البحث بيفلتر المعروض بس (رصيد أول الفترة زي ما هو)
function statementFor(id, currency, period, { from = '', to = '', search = '' } = {}) {
    const all = traderMovesOf(id, currency);
    let running = 0;
    const rows = all.map(m => {
        const before = running;
        running = round2(running + m.effect);
        return { m, before, after: running };
    });

    let start = 0;
    if (period === 'since_zero') {
        // آخر نقطة صار فيها الرصيد صفراً (قبل آخر حركة)، فيظهر الحساب الحالي من بدايته
        for (let i = rows.length - 2; i >= 0; i--) {
            if (isZero(rows[i].after)) { start = i + 1; break; }
        }
    }
    const today = localDateStr();
    const weekAgo = localDateStr(new Date(Date.now() - 6 * 86400000));
    const inPeriod = rows.slice(start).filter(r =>
        period === 'today' ? r.m.date === today
        : period === 'week' ? r.m.date >= weekAgo
        : period === 'month' ? r.m.date.startsWith(today.slice(0, 7))
        : period === 'range' ? (!from || r.m.date >= from) && (!to || r.m.date <= to)
        : true
    );
    // رصيد أول الفترة: قبل أول حركة فيها، أو (فترة فاضية) الرصيد عند بدايتها
    const firstAfter = period === 'range' && from ? rows.find(r => r.m.date >= from) : null;
    const opening = inPeriod.length ? inPeriod[0].before
        : period === 'range' ? (firstAfter ? firstAfter.before : running)
        : running;
    const q = normName(latinDigits(search));
    const shown = q ? inPeriod.filter(r => tmoveMatches(r.m, q)) : inPeriod;
    // آخر الفترة: الرصيد بعد آخر حركة فيها (لفترة بتنتهي قبل اليوم)
    const closingRow = inPeriod[inPeriod.length - 1];
    const periodEnd = period === 'range' && to && closingRow ? closingRow.after : period === 'range' && to ? opening : running;
    return { rows: shown, opening, closing: running, periodEnd, total: rows.length, searched: !!q, inPeriod: inPeriod.length };
}

// البحث بالكشف: النوع، الخدمة، الملاحظة، أو المبلغ
function tmoveMatches(m, q) {
    const sv = m.serviceId ? traderServices.find(x => x.id === m.serviceId) : null;
    const text = normName([TMOVE_KINDS[m.kind].label, sv?.name, m.note, m.date].filter(Boolean).join(' '));
    const digits = q.replace(/[^\d.]/g, '');
    return text.includes(q) || (digits.length >= 2 && [m.amount, m.effect, m.commission].some(v => String(Math.abs(v)).includes(digits)));
}

function statementPeriodLabel() {
    if (panelPeriod !== 'range') return PERIODS[panelPeriod];
    if (panelFrom && panelTo) return `من ${panelFrom} لـ ${panelTo}`;
    if (panelFrom) return `من ${panelFrom}`;
    if (panelTo) return `لحد ${panelTo}`;
    return 'كل الحركات';
}

const statementOpts = () => ({ from: panelFrom, to: panelTo, search: panelSearch });

// مفتاح صورة الكشف الجاهزة للمشاركة: بيتغير مع أي شي بيبين فيها
function statementKey() {
    const st = statementFor(panelTraderId, panelCurrency, panelPeriod, statementOpts());
    return `st:${panelTraderId}:${panelCurrency}:${panelPeriod}:${panelFrom}:${panelTo}:${panelSearch}:` + st.rows.map(r => r.m.id + '/' + r.m.effect).join(',');
}

function renderTraderPanel() {
    const t = traders.find(x => x.id === panelTraderId);
    if (!t || pageHidden('traders')) return;
    const bal = traderBalances(t.id);
    const counts = { services: servicesOf(t.id).length, wholesale: traderMoves.filter(m => m.traderId === t.id && TMOVE_KINDS[m.kind].whole).length };
    // تحديث من الشيت وإنت بتكتب بحث الكشف: الخانة بتضل مفتوحة ومكان المؤشر زي ما هو
    const typing = document.activeElement?.id === 'tp_search' ? document.activeElement.selectionStart : null;
    $('trader-profile').innerHTML = `
        ${traderPanelHeadHtml(t)}
        <div class="section-card p-4 space-y-3">
            ${traderBalanceTabsHtml(bal)}
            ${traderPanelActionsHtml(t, bal[panelCurrency] || 0)}
        </div>
        <div class="seg tv-tabs" role="tablist" aria-label="أقسام حساب التاجر">
            ${Object.entries(TRADER_TABS).map(([k, l]) => `<button type="button" role="tab" data-action="trader-tab" data-tab="${k}" class="seg-btn${k === panelTab ? ' active' : ''}" aria-selected="${k === panelTab}">${l}${counts[k] ? ` <span class="text-slate-400">${counts[k]}</span>` : ''}</button>`).join('')}
        </div>
        <div id="tp_body">${traderTabHtml(t)}</div>`;
    if (panelTab === 'statement') renderTraderStatement();
    if (typing !== null && $('tp_search')) {
        $('tp_search').focus();
        $('tp_search').setSelectionRange(typing, typing);
    }
}

function traderTabHtml(t) {
    if (panelTab === 'services') return traderServicesTabHtml(t);
    if (panelTab === 'wholesale') return traderWholesaleTabHtml(t);
    if (panelTab === 'info') return traderInfoTabHtml(t);
    // الكشف برّا البطاقة حتى ياخد العرض كله بالجوال (هو أصلاً ورقة بإطارها)
    return `
        <div class="space-y-3">
            <div class="section-card p-3 sm:p-4 space-y-3">${traderPanelToolbarHtml()}</div>
            <div id="tp_statement"></div>
        </div>`;
}

function traderPanelHeadHtml(t) {
    const sub = [traderWholePctText(t), t.note && escapeHtml(t.note)].filter(Boolean).join(' · ');
    return `
        <div class="cp-head tv-head">
            <button type="button" data-action="trader-back" class="tv-back" aria-label="رجوع لكل التجار">→ كل التجار</button>
            <div class="flex items-center gap-3.5 mt-3">
                <div class="cp-avatar overflow-hidden">${traderAvatar(t)}</div>
                <div class="min-w-0">
                    <h3 class="text-lg font-black text-white truncate">${escapeHtml(t.name)}</h3>
                    ${sub ? `<div class="text-xs text-slate-300 mt-0.5">${sub}</div>` : ''}
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 mt-3">
                ${traderWhatsapp(t)}
                <button data-action="edit-trader" data-id="${escapeHtml(t.id)}" class="cp-chip hover:bg-white/20">تعديل</button>
                <button data-action="delete-trader" data-id="${escapeHtml(t.id)}" class="cp-chip hover:bg-white/20">حذف</button>
            </div>
        </div>`;
}

function traderBalanceTabsHtml(bal) {
    const curList = [...new Set([...Object.keys(bal), panelCurrency])];
    // على الجوال عمودين (كانت كل عملة بسطر لحالها)
    return `
        <div class="cur-tabs">
            ${curList.map(c => `
                <button data-action="trader-currency" data-cur="${c}" class="cur-tab${c === panelCurrency ? ' active' : ''}">
                    <span class="text-[11px] text-slate-500 block">${TRADE_CURRENCIES[c].name}</span>
                    ${balanceChip(c, bal[c] || 0, true)}
                </button>`).join('')}
            <select id="tp_add_currency" class="cur-add" aria-label="إضافة عملة">
                <option value="">+ عملة</option>
                ${Object.keys(TRADE_CURRENCIES).filter(c => !curList.includes(c)).map(c => `<option value="${c}">${TRADE_CURRENCIES[c].name}</option>`).join('')}
            </select>
        </div>`;
}

function traderPanelActionsHtml(t, current) {
    return `
        <div class="grid grid-cols-2 gap-2">
            <button data-action="new-tmove" data-id="${escapeHtml(t.id)}" data-cur="${panelCurrency}" class="cp-action bg-slate-900 text-white">+ حركة جديدة</button>
            <button data-action="settle-trader" data-id="${escapeHtml(t.id)}" data-cur="${panelCurrency}" class="cp-action ${isZero(current) ? 'bg-slate-100 text-slate-400' : 'bg-emerald-600 text-white'}" ${isZero(current) ? 'disabled' : ''}>
                ${isZero(current) ? 'الحساب متصفّر' : `تصفير الحساب<span class="block text-[11px] font-bold opacity-90 mt-0.5">${tradeMoney(current, panelCurrency, 0)}</span>`}
            </button>
        </div>`;
}

// ---------- تبويب الكشف: الفترة (أو من تاريخ لتاريخ)، البحث، التحميل والمشاركة ----------
function traderPanelToolbarHtml() {
    return `
        <div class="tv-scroll" role="group" aria-label="الفترة">
            ${Object.entries(PERIODS).map(([k, l]) => `<button type="button" data-action="trader-period" data-period="${k}" class="tf-chip${k === panelPeriod ? ' active' : ''}">${l}</button>`).join('')}
        </div>
        ${panelPeriod === 'range' ? `
        <div class="grid grid-cols-2 gap-2 text-xs">
            <label class="block"><span class="font-bold text-slate-600 block mb-1">من</span><input type="date" id="tp_from" value="${escapeHtml(panelFrom)}" class="w-full field !py-2"></label>
            <label class="block"><span class="font-bold text-slate-600 block mb-1">لـ</span><input type="date" id="tp_to" value="${escapeHtml(panelTo)}" class="w-full field !py-2"></label>
        </div>` : ''}
        <div class="flex flex-wrap items-center gap-2">
            <input type="search" id="tp_search" value="${escapeHtml(panelSearch)}" placeholder="ابحث بالكشف: زبون، خدمة، مبلغ..." aria-label="بحث بالكشف" class="flex-1 min-w-[10rem] text-xs field !py-2">
            <div class="flex gap-1.5">
                <button data-action="statement-pdf" class="text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-lg">PDF</button>
                <button data-action="statement-png" class="text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-2 rounded-lg">صورة</button>
                <button data-action="share-statement" class="inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg">${WA_ICON}<span>واتساب</span></button>
            </div>
        </div>`;
}

function renderTraderStatement() {
    const t = traders.find(x => x.id === panelTraderId);
    if (!t || !$('tp_statement')) return;
    $('tp_statement').innerHTML = statementHtml(t, statementFor(t.id, panelCurrency, panelPeriod, statementOpts()));
}

// الكشف: الطرفان، العنوان، الملخص، والحركات يوماً بيوم (هاد الجزء بيتحول لصورة)
function statementHtml(t, st) {
    const rangeEnded = panelPeriod === 'range' && panelTo;
    const endLabel = rangeEnded ? 'الرصيد آخر الفترة' : 'الرصيد الحالي';
    const endValue = rangeEnded ? st.periodEnd : st.closing;
    return `
        <div id="trader-statement" class="statement-paper">
            <!-- الطرفان: شركتنا يميناً والتاجر يساراً -->
            <div class="st-head">
                <div class="st-party">
                    <div class="st-logo">${logoHtml()}</div>
                    <div class="min-w-0">
                        <div class="font-black text-white text-sm truncate">${escapeHtml(globalConfig.companyName || 'فاست باي')}</div>
                        <div class="text-[11px] text-slate-400 truncate">${escapeHtml(globalConfig.companySubtitle || '')}</div>
                    </div>
                </div>
                <div class="st-party">
                    <div class="min-w-0 text-left">
                        <div class="font-black text-white text-sm truncate">${escapeHtml(t.name)}</div>
                        <div class="text-[11px] text-slate-400 truncate">${t.phone ? `<bdi class="ltr-num">${escapeHtml(t.phone)}</bdi>` : 'التاجر'}</div>
                    </div>
                    <div class="st-logo">${traderAvatar(t)}</div>
                </div>
            </div>
            <div class="st-title">
                <b>كشف حساب · ${TRADE_CURRENCIES[panelCurrency].name}</b>
                <span>${escapeHtml(statementPeriodLabel())}${st.searched ? ` · بحث: ${escapeHtml(panelSearch)}` : ''} · <bdi class="ltr-num">${localDateStr()}</bdi></span>
            </div>
            <div class="st-summary">
                <div><span>رصيد أول الفترة</span><b class="${traderEffClass(st.opening)}">${balanceText(st.opening)} ${tradeMoney(st.opening, panelCurrency)}</b></div>
                <div><span>عدد الحركات</span><b>${st.searched ? `${st.rows.length} من ${st.inPeriod}` : st.rows.length}</b></div>
                <div class="st-final"><span>${endLabel}</span><b class="${traderEffClass(endValue)}">${balanceText(endValue)} ${tradeMoney(endValue, panelCurrency)}</b></div>
            </div>
            ${statementDaysHtml(st.rows, st.searched)}
        </div>`;
}

// تجميع حركات الكشف حسب اليوم، مع صافي كل يوم. على الكمبيوتر جدول بأعمدة (الحركة، المبلغ، العمولة، الأثر، الرصيد)،
// وعلى الجوال كل حركة بسطرين (الأعمدة بتتجمع تحت العنوان) — نفس العناصر، والشكل من styles.css (.st-*)
function statementDaysHtml(rows, searched = false) {
    const days = [];
    rows.forEach(r => {
        let d = days[days.length - 1];
        if (!d || d.date !== r.m.date) { d = { date: r.m.date, rows: [], net: 0 }; days.push(d); }
        d.rows.push(r);
        d.net = round2(d.net + r.m.effect);
    });
    if (days.length === 0) return `<div class="text-sm text-slate-400 text-center py-10">${searched ? 'ما في حركات بتطابق البحث' : 'لا توجد حركات في هذه الفترة'}</div>`;
    return `
        <div class="st-cols"><span>الحركة</span><span>المبلغ</span><span>العمولة</span><span>الأثر</span><span>الرصيد</span><span></span></div>
        ${days.map(d => `
        <div class="st-day">
            <div class="st-day-head"><bdi class="ltr-num">${escapeHtml(d.date)}</bdi><span class="${traderEffClass(d.net)}">${searched ? 'صافي المعروض' : 'صافي اليوم'} ${signedMoney(d.net, panelCurrency)}</span></div>
            ${d.rows.map(({ m, after }) => statementRowHtml(m, after)).join('')}
        </div>`).join('')}`;
}

function statementRowHtml(m, after) {
    const fee = m.commission ? `${m.commissionPct ? `<span class="st-fee-how">${commissionText(m.commissionPct, m.commissionFixed, m.currency)}</span> ` : ''}${tradeMoney(m.commission, m.currency)}` : '<span class="text-slate-300">—</span>';
    return `
        <div class="st-row">
            <div class="st-c-title">
                <div class="st-title-line">${tmoveTitleHtml(m)}</div>
                <div class="st-detail-m">${tmoveDetailText(m)}</div>
                ${m.kind === 'sell_whole' ? `<div class="profit-only st-profit" data-export-ignore="true">ربحك ${signedMoney(m.profit, m.currency)} (اشتريتها بـ ${round2(m.buyPct)}%)</div>` : ''}
            </div>
            <div class="st-c st-c-amt">${tradeMoney(m.amount, m.currency)}</div>
            <div class="st-c st-c-fee">${fee}</div>
            <div class="st-c st-c-eff font-black ${traderEffClass(m.effect)}">${signedMoney(m.effect, m.currency)}</div>
            <div class="st-c st-c-bal"><span class="st-bal-label">الرصيد </span>${isZero(after) ? '<span class="text-slate-400">0</span>' : `<span class="${traderEffClass(after)}">${after > 0 ? 'لنا' : 'له'} ${tradeMoney(after, m.currency)}</span>`}</div>
            <div class="st-row-actions" data-export-ignore="true">
                <button data-action="edit-tmove" data-id="${m.id}" title="تعديل" aria-label="تعديل">✎</button>
                <button data-action="delete-tmove" data-id="${m.id}" title="حذف" aria-label="حذف">✕</button>
            </div>
        </div>`;
}

// "1,000 $ · عمولة 1.8% = 18 $" / "بـ 2% = 20 $"
function tmoveDetailText(m) {
    if (!m.commission) return tradeMoney(m.amount, m.currency);
    const how = m.commissionPct ? `${commissionText(m.commissionPct, m.commissionFixed, m.currency)} = ` : '';
    return `${tradeMoney(m.amount, m.currency)} · ${TMOVE_KINDS[m.kind].whole ? 'بـ' : 'عمولة'} ${how}${tradeMoney(m.commission, m.currency)}`;
}

// عنوان الحركة بالكشف: نوعها، والخدمة (إذا انحسبت عمولتها من جدول خدمة) والملاحظة
function tmoveTitleHtml(m) {
    const sv = m.serviceId ? traderServices.find(x => x.id === m.serviceId) : null;
    const extra = [sv?.name, m.note].filter(Boolean).map(escapeHtml).join(' · ');
    return (sv ? serviceLogoHtml(sv, 'sm') + ' ' : '') + `<b>${TMOVE_KINDS[m.kind].label}</b>` + (extra ? ` <span class="font-medium text-slate-500">· ${extra}</span>` : '');
}

// ---------- تبويب المعلومات ----------
function traderInfoTabHtml(t) {
    const moves = traderMovesOf(t.id);
    const svs = servicesOf(t.id);
    const item = (label, value) => `<div class="ti-item"><span>${label}</span><b>${value}</b></div>`;
    return `
        <div class="section-card p-4 space-y-3">
            <div class="grid grid-cols-2 gap-2">
                ${item('رقم الواتساب', t.phone ? `<bdi class="ltr-num">+${escapeHtml(whatsappDigits(t.phone))}</bdi>` : '<span class="text-slate-400">ما في</span>')}
                ${item('الملاحظات', t.note ? escapeHtml(t.note) : '<span class="text-slate-400">ما في</span>')}
                ${item('نسبة شراء الجملة منه', `${round2(t.commissionPct)}%`)}
                ${item('نسبة بيع الجملة إله', `${round2(t.myCommissionPct)}%`)}
                ${item('عدد الحركات', moves.length)}
                ${item('الخدمات', svs.length ? svs.map(x => escapeHtml(x.name)).join('، ') : '<span class="text-slate-400">ما في</span>')}
                ${item('أول حركة', moves.length ? `<bdi class="ltr-num">${escapeHtml(moves[0].date)}</bdi>` : '—')}
                ${item('آخر حركة', moves.length ? `<bdi class="ltr-num">${escapeHtml(moves[moves.length - 1].date)}</bdi> · ${relativeDays(moves[moves.length - 1].date)}` : '—')}
                ${t.createdAt ? item('انضاف', `<bdi class="ltr-num">${escapeHtml(t.createdAt)}</bdi>`) : ''}
            </div>
            <p class="text-[11px] text-slate-500">نسب الجملة هي اللي بتتعبّى لحالها لما تختار "شراء جملة" أو "بيع جملة" بالحركة، وبتقدر تغيّرها لكل حركة.</p>
            <button type="button" data-action="edit-trader" data-id="${escapeHtml(t.id)}" class="w-full text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 py-2.5 rounded-lg">تعديل بيانات التاجر</button>
        </div>`;
}

// ================= الجملة: الربح بيضل هون (مش بالتقارير) =================
const isThisMonth = (date) => String(date || '').startsWith(localDateStr().slice(0, 7));

function wholesaleProfitByCurrency(traderId = null) {
    const out = {};
    traderMoves.forEach(m => {
        if (m.kind !== 'sell_whole' || (traderId && m.traderId !== traderId)) return;
        const c = (out[m.currency] ??= { all: 0, month: 0, count: 0 });
        c.all = round2(c.all + m.profit);
        if (isThisMonth(m.date)) c.month = round2(c.month + m.profit);
        c.count++;
    });
    return out;
}

// آخر كلفة شراء جملة (بنفس العملة، من أي تاجر) كنسبة من المبلغ، مع المبلغ الثابت إذا في،
// حتى ينحسب ربح البيع صح (2% + 5$ على 1000$ = 2.5%)
function lastBuyPct(currency, exceptId = null) {
    const buys = traderMoves.filter(m => m.kind === 'buy_whole' && m.currency === currency && m.id !== exceptId && m.amount > 0)
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const b = buys[buys.length - 1];
    return b ? Math.round((b.commission / b.amount) * 100 * 10000) / 10000 : null;
}

function traderWholesaleTabHtml(t) {
    const moves = traderMovesOf(t.id).filter(m => TMOVE_KINDS[m.kind].whole).reverse();
    const sums = {};
    moves.forEach(m => {
        const s = (sums[m.currency] ??= { bought: 0, sold: 0, profit: 0, month: 0 });
        if (m.kind === 'buy_whole') s.bought = round2(s.bought + m.amount);
        else {
            s.sold = round2(s.sold + m.amount);
            s.profit = round2(s.profit + m.profit);
            if (isThisMonth(m.date)) s.month = round2(s.month + m.profit);
        }
    });
    return `
        <div class="section-card p-4 space-y-3">
            <div class="grid grid-cols-2 gap-2">
                <button type="button" data-action="new-tmove" data-id="${escapeHtml(t.id)}" data-cur="${panelCurrency}" data-kind="buy_whole" class="cp-action bg-rose-50 text-rose-800 border border-rose-100">+ شراء جملة منه<span class="block text-[10px] font-bold opacity-75">بنسبة ${round2(t.commissionPct)}%</span></button>
                <button type="button" data-action="new-tmove" data-id="${escapeHtml(t.id)}" data-cur="${panelCurrency}" data-kind="sell_whole" class="cp-action bg-emerald-50 text-emerald-800 border border-emerald-100">+ بيع جملة إله<span class="block text-[10px] font-bold opacity-75">بنسبة ${round2(t.myCommissionPct)}%</span></button>
            </div>
            ${Object.keys(sums).length ? `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${Object.entries(sums).map(([c, s]) => `
                <div class="ti-item">
                    <span>${TRADE_CURRENCIES[c].name}</span>
                    <span class="tw-sum"><span>اشتريت منه</span><b>${tradeMoney(s.bought, c)}</b></span>
                    <span class="tw-sum"><span>بعتله</span><b>${tradeMoney(s.sold, c)}</b></span>
                    <span class="tw-sum profit-only text-emerald-700"><span>ربحك هالشهر</span><b>${tradeMoney(s.month, c)}</b></span>
                    <span class="tw-sum profit-only text-emerald-700"><span>ربحك كله</span><b>${tradeMoney(s.profit, c)}</b></span>
                </div>`).join('')}
            </div>` : ''}
            <div>
                ${moves.length ? moves.map(m => `
                <div class="tw-row">
                    <div class="min-w-0 flex-1">
                        <div class="font-bold text-slate-800">${tmoveTitleHtml(m)}</div>
                        <div class="text-[11px] text-slate-500"><bdi class="ltr-num">${escapeHtml(m.date)}</bdi> · ${tmoveDetailText(m)}</div>
                    </div>
                    <div class="text-left shrink-0">
                        <div class="font-black ${traderEffClass(m.effect)}">${signedMoney(m.effect, m.currency)}</div>
                        ${m.kind === 'sell_whole' ? `<div class="text-[10px] font-bold text-emerald-700 profit-only">ربحك ${signedMoney(m.profit, m.currency)}</div>` : ''}
                    </div>
                    <div class="st-row-actions">
                        <button data-action="edit-tmove" data-id="${m.id}" title="تعديل">✎</button>
                        <button data-action="delete-tmove" data-id="${m.id}" title="حذف">✕</button>
                    </div>
                </div>`).join('') : '<p class="text-xs text-slate-400 text-center py-6">ما في جملة مع هالتاجر لسا. الشراء بيزيد اللي إله عندك (المبلغ + نسبته)، والبيع بيزيد اللي إلك عنده (المبلغ + نسبتك) وبيحسب ربحك.</p>'}
            </div>
        </div>`;
}

// ================= تبويب الخدمات (زي تسعير الدول) =================
function traderServicesTabHtml(t) {
    const list = servicesOf(t.id);
    const supported = sheetHas('traderServices');
    return `
        <div class="section-card p-4 space-y-2.5">
            ${!supported ? '<p class="text-[11px] font-bold text-amber-700">حدّث سكربت Google Sheets حتى تنحفظ الخدمات</p>' : ''}
            ${list.length ? `<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">${list.map(serviceCardHtml).join('')}</div>` : '<p class="text-sm text-slate-500">بتكتب جدول عمولة التاجر (أو بتلصق رسالته)، وبعدين بحركة "لنا" أو "له" بالدولار بتختار الخدمة فعمولتها بتنحسب لحالها حسب المبلغ.</p>'}
            <button type="button" data-action="service-new" data-id="${escapeHtml(t.id)}" class="w-full text-xs font-bold border border-dashed border-slate-300 hover:border-slate-400 text-slate-600 py-2.5 rounded-xl" ${supported ? '' : 'disabled'}>+ خدمة جديدة</button>
        </div>`;
}

function serviceCardHtml(sv) {
    return `
        <div class="tsv-card">
            <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2.5 min-w-0">
                    ${serviceLogoHtml(sv, 'lg')}
                    <div class="min-w-0">
                        <div class="font-black text-slate-900 text-base">${escapeHtml(sv.name)}</div>
                        ${sv.note ? `<div class="text-xs text-slate-500">${escapeHtml(sv.note)}</div>` : ''}
                    </div>
                </div>
                <button type="button" data-action="service-edit" data-id="${escapeHtml(sv.id)}" class="shrink-0 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 px-3 py-1.5 rounded-lg">تعديل</button>
            </div>
            <div class="tsv-tiers">
                ${sv.tiers.map((x, i) => `<span>${escapeHtml(tierRangeLabel(sv.tiers, i))}</span><b>${commissionText(x.pct, x.fixed)}</b>`).join('')}
            </div>
            <div class="flex items-center gap-2">
                <input type="text" inputmode="decimal" autocomplete="off" data-commas data-service-try="${escapeHtml(sv.id)}" placeholder="جرّب مبلغ $" aria-label="جرّب مبلغ" class="w-32 field !py-2 text-sm font-bold">
                <span class="text-xs text-slate-600" data-try-out="${escapeHtml(sv.id)}"></span>
            </div>
        </div>`;
}

// "جرّب مبلغ": العمولة والباقي لنا عنده
function onServiceTry(el) {
    const sv = traderServices.find(x => x.id === el.dataset.serviceTry);
    const out = document.querySelector(`[data-try-out="${CSS.escape(el.dataset.serviceTry)}"]`);
    if (!sv || !out) return;
    const amount = toNum(el.value, 0);
    if (!(amount > 0)) { out.textContent = ''; return; }
    const tier = serviceTier(sv, amount);
    const fee = serviceFee(sv, amount);
    out.innerHTML = `عمولته <b><bdi>${fmtTrim(fee)}$</bdi></b> (<bdi>${commissionText(tier.pct, tier.fixed)}</bdi>) · بيضل لنا عنده <b><bdi>${fmtTrim(round2(amount - fee))}$</bdi></b>`;
}

// خانات حساب التاجر: البحث بالكشف، "جرّب مبلغ"، التواريخ، وإضافة عملة (مستمع واحد على الصفحة)
function onTraderViewInput(e) {
    const el = e.target;
    if (el.dataset?.serviceTry !== undefined) return onServiceTry(el);
    if (el.id === 'tp_search') { panelSearch = el.value; renderTraderStatement(); }
}

function onTraderViewChange(e) {
    const el = e.target;
    if (el.id === 'tp_from' || el.id === 'tp_to') {
        if (el.id === 'tp_from') panelFrom = el.value; else panelTo = el.value;
        renderTraderStatement();
    } else if (el.id === 'tp_add_currency' && el.value) {
        panelCurrency = el.value;
        renderTraderPanel();
    }
}

// ---------- نافذة الخدمة: الشعار، الجدول، ولصق رسالة التاجر ----------
let svTiers = [];
let svLogo = '';

// الشعار: تلقائي من الاسم (الافتراضي)، أو تختار من الشعارات الجاهزة (لحد 3)، أو ترفع صورة، أو بدون.
// الاختيار والرفع بدهم عمود "الشعار" (ميزة serviceLogo بالسكربت)؛ التلقائي بيشتغل دايماً
function renderServiceLogoPicker() {
    const can = sheetHas('serviceLogo');
    const preview = { name: $('sv_name').value, logo: svLogo };
    const keys = serviceBrandKeys(preview);
    const mode = !svLogo ? 'auto' : svLogo === 'none' ? 'none' : svLogo.startsWith('brand:') ? 'brand' : 'image';
    $('sv_logo_preview').innerHTML = serviceLogoHtml(preview, 'lg') || '<span class="sv-logo lg sv-logo-empty">🏪</span>';
    $('sv_logo_status').textContent = mode === 'auto' ? (keys.length ? 'تلقائي من اسم الخدمة' : 'تلقائي: ما لقيت شعار بالاسم، اختار أو ارفع')
        : mode === 'none' ? 'بدون شعار' : mode === 'image' ? 'صورة مرفوعة' : 'مختار من القائمة';
    $('sv_logo_auto').classList.toggle('active', mode === 'auto');
    $('sv_logo_none').classList.toggle('active', mode === 'none');
    $('sv_logo_note').classList.toggle('hidden', can);
    ['sv_logo_none', 'sv_logo_upload'].forEach(id => { $(id).disabled = !can; });
    const chosen = mode === 'brand' ? keys : [];
    $('sv_logo_grid').innerHTML = Object.entries(SERVICE_BRANDS).map(([k, b]) => `
        <button type="button" data-action="service-logo-brand" data-key="${k}" class="sv-brand${chosen.includes(k) ? ' active' : ''}${mode === 'auto' && keys.includes(k) ? ' auto' : ''}" title="${escapeHtml(b.name)}" ${can ? '' : 'disabled'}>
            <span class="sv-logo md">${brandSvg(k)}</span><span>${escapeHtml(b.name)}</span>
        </button>`).join('');
}

function setServiceLogoMode(mode) {
    svLogo = mode === 'none' ? 'none' : '';
    renderServiceLogoPicker();
}

// كبسة على شعار جاهز: بيدخل أو بيطلع من اختيارك (لحد 3، بترتيب الكبس)
function toggleServiceBrand(key) {
    if (!sheetHas('serviceLogo')) return;
    const cur = svLogo.startsWith('brand:') ? svLogo.slice(6).split(',').filter(Boolean) : [];
    const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key].slice(-3);
    svLogo = next.length ? 'brand:' + next.join(',') : '';
    renderServiceLogoPicker();
}

// صورة صغيرة (96 بكسل، أقل من 15 ألف حرف) حتى ترجع مع قراءة الشيت بدون ما تثقّلها
function onServiceLogoFile(file) {
    resizeImageFile(file, 96, (url) => { svLogo = url; renderServiceLogoPicker(); }, 15000);
}

function openServiceModal(traderId, sv = null) {
    const t = traders.find(x => x.id === (sv ? sv.traderId : traderId));
    if (!t) return;
    if (!sheetHas('traderServices')) return showToast('حدّث السكربت أولاً', 'سكربت Google Sheets الحالي لا يدعم خدمات التجار', 'warning');
    $('serviceModalTitle').textContent = sv ? `تعديل خدمة — ${t.name}` : `خدمة جديدة — ${t.name}`;
    $('sv_id').value = sv ? sv.id : '';
    $('sv_trader').value = t.id;
    $('sv_name').value = sv ? sv.name : '';
    $('sv_note').value = sv ? sv.note : '';
    $('sv_paste').value = '';
    $('sv_paste_box').open = !sv;
    $('sv_delete').classList.toggle('hidden', !sv);
    svTiers = sv ? sv.tiers.map(x => ({ ...x })) : [{ upTo: null, pct: 0, fixed: 0 }];
    svLogo = sv ? sv.logo : '';
    renderServiceTiers();
    renderServiceLogoPicker();
    openModal('serviceModal');
    (sv ? $('sv_name') : $('sv_paste')).focus();
}

function renderServiceTiers() {
    const last = svTiers.length - 1;
    $('sv_tiers').innerHTML = svTiers.map((x, i) => `
        <div class="sv-tier">
            <span class="text-slate-500">${i === last && x.upTo === null ? 'فوقها' : 'لحد'}</span>
            <input type="text" inputmode="decimal" autocomplete="off" data-commas data-sv-tier="${i}" data-field="upTo" value="${x.upTo === null ? '' : formatThousands(x.upTo)}" placeholder="${i === last ? 'وأكثر' : 'المبلغ'}" aria-label="لحد كم دولار" class="w-full min-w-0 field !py-2 !px-2 font-mono">
            <span class="text-slate-500">$ ←</span>
            <input type="number" step="any" min="0" data-sv-tier="${i}" data-field="pct" value="${x.pct || ''}" placeholder="0" aria-label="نسبة %" class="w-full min-w-0 field !py-2 !px-2 font-bold">
            <span class="text-slate-500">% +</span>
            <input type="text" inputmode="decimal" autocomplete="off" data-commas data-sv-tier="${i}" data-field="fixed" value="${x.fixed ? formatThousands(x.fixed) : ''}" placeholder="0" aria-label="مبلغ ثابت $" class="w-full min-w-0 field !py-2 !px-2 font-bold">
            <span class="text-slate-500">$</span>
            ${svTiers.length > 1 ? `<button type="button" data-action="service-tier-remove" data-index="${i}" class="text-slate-400 hover:text-red-600 px-1 font-bold" aria-label="حذف الشريحة">✕</button>` : '<span></span>'}
        </div>`).join('');
    renderServiceExamples();
}

// أمثلة تحت الجدول حتى تتأكد إنه زي جدول التاجر
function renderServiceExamples() {
    const sv = { tiers: normalizeServiceTiers(svTiers) };
    const bounds = sv.tiers.map(x => x.upTo).filter(x => x !== null);
    // حد كل شريحة (أعلى مبلغ فيها) ومبلغ فوق آخر حد
    const above = Math.round((bounds[bounds.length - 1] || 500) * 1.5);
    const samples = [...new Set([...bounds.slice(0, 5), above])];
    $('sv_examples').innerHTML = sv.tiers.some(x => x.pct || x.fixed)
        ? 'أمثلة: ' + samples.map(a => `<bdi>${fmtTrim(a)}$</bdi> ← <b><bdi>${fmtTrim(serviceFee(sv, a))}$</bdi></b>`).join(' · ')
        : 'اكتب العمولة: نسبة % أو مبلغ ثابت $ أو الثنتين';
}

function onServiceTierInput(el) {
    const i = toNum(el.dataset.svTier, -1);
    if (!svTiers[i]) return;
    const f = el.dataset.field;
    svTiers[i][f] = f === 'upTo' ? (String(el.value).trim() === '' ? null : Math.max(0, toNum(el.value, 0))) : Math.max(0, toNum(el.value, 0));
    renderServiceExamples();
}

// شريحة جديدة قبل "وأكثر"
function addServiceTier() {
    const last = svTiers[svTiers.length - 1];
    if (last && last.upTo === null) {
        const prev = [...svTiers].reverse().find(x => x.upTo !== null);
        svTiers.splice(svTiers.length - 1, 0, { upTo: (prev?.upTo || 0) + 1000, pct: last.pct, fixed: last.fixed });
    } else svTiers.push({ upTo: null, pct: 0, fixed: 0 });
    renderServiceTiers();
}

function removeServiceTier(i) {
    if (svTiers.length < 2) return;
    svTiers.splice(i, 1);
    renderServiceTiers();
}

function parseServicePaste() {
    const r = parseTierMessage($('sv_paste').value);
    if (!r.tiers.length) return showToast('ما قدرت أقرا الجدول', 'اكتب الشرائح بإيدك تحت، أو تأكد إنه فيه "من … إلى … عمولة …"', 'warning');
    svTiers = r.tiers.map(x => ({ ...x }));
    if (!$('sv_name').value.trim() && r.name) $('sv_name').value = r.name;
    renderServiceTiers();
    $('sv_paste_box').open = false;
    showToast(`قريت ${r.tiers.length} شرائح`, 'راجعها مع الأمثلة قبل ما تحفظ', 'info');
}

async function saveService(e) {
    e.preventDefault();
    const t = traders.find(x => x.id === $('sv_trader').value);
    if (!t) return;
    const name = $('sv_name').value.trim();
    if (!name) return showToast('تنبيه', 'اكتب اسم الخدمة', 'warning');
    const tiers = normalizeServiceTiers(svTiers);
    const bounded = tiers.filter(x => x.upTo !== null).map(x => x.upTo);
    if (new Set(bounded).size !== bounded.length) return showToast('تنبيه', 'في شريحتين بنفس الحد', 'warning');
    if (tiers.filter(x => x.upTo === null).length > 1) return showToast('تنبيه', 'بس آخر شريحة بتكون "وأكثر" (بدون حد)', 'warning');
    if (!tiers.some(x => x.pct || x.fixed)) return showToast('تنبيه', 'اكتب العمولة بشريحة وحدة على الأقل', 'warning');
    if (tiers.some(x => x.pct >= 100)) return showToast('تنبيه', 'النسبة لازم تكون أقل من 100%', 'warning');
    const id = $('sv_id').value;
    const existing = traderServices.find(x => x.id === id);
    const sv = normalizeService({
        id: id || 'sv' + Date.now(), traderId: t.id, traderName: t.name, name,
        order: existing ? existing.order : servicesOf(t.id).reduce((m, x) => Math.max(m, x.order + 1), 0),
        tiers, note: $('sv_note').value,
        // سكربت قديم ما فيه عمود الشعار: بيضل التلقائي من الاسم
        logo: sheetHas('serviceLogo') ? svLogo : (existing?.logo || '')
    });
    if (existing) Object.assign(existing, sv); else traderServices.push(sv);
    queueOps({ action: 'upsert_service', service: serviceOpPayload(sv) });
    closeModal('serviceModal');
    afterServicesChanged();
    const status = await flushOutbox();
    showToast(existing ? 'تم تعديل الخدمة' : 'تمت إضافة الخدمة', `${name} عند ${t.name}: بتختارها بحركة "لنا" أو "له" بالدولار — ${syncResultMessage(status)}`, syncToastType(status));
}

// الشيت بيحفظ الجدول نص JSON
const serviceOpPayload = (sv) => ({ ...sv, tiers: JSON.stringify(sv.tiers) });

function deleteServicePrompt() {
    const sv = traderServices.find(x => x.id === $('sv_id').value);
    if (!sv) return;
    showAppConfirm('حذف الخدمة', `حذف "${sv.name}"؟ الحركات القديمة اللي انحسبت عليها بتضل زي ما هي.`, async () => {
        traderServices = traderServices.filter(x => x.id !== sv.id);
        queueOps({ action: 'delete_service', id: sv.id });
        closeModal('serviceModal');
        afterServicesChanged();
        const status = await flushOutbox();
        showToast('تم حذف الخدمة', syncResultMessage(status), syncToastType(status));
    });
}

// بعد أي تغيير بالخدمات: الصفحة (القائمة أو حساب التاجر)
function afterServicesChanged() {
    renderTraders();
}

// ================= نافذة الحركة =================
// أزرار: لنا / له / تصفير (+ زر النوع القديم عند تعديل حركة قديمة)، وتحتها الجملة
function renderTmoveKinds() {
    const current = $('tm_kind').value;
    const ck = TMOVE_KINDS[current];
    const btns = [
        { key: 'for_us', label: 'لنا', sub: 'يزيد ما لنا عنده', cls: 'mine', active: current === 'for_us' },
        { key: 'for_him', label: 'له', sub: 'يزيد ما له عندنا', cls: 'his', active: current === 'for_him' },
        { key: 'settle', label: 'تصفير', sub: ck.settle ? (current === 'he_paid' ? 'دفع لنا' : 'دفعنا له') : 'يقلّل الرصيد', cls: 'settle', active: !!ck.settle }
    ];
    if (ck.legacy) btns.push({ key: current, label: ck.label, sub: 'نوع قديم', cls: ck.sign > 0 ? 'mine' : 'his', active: true });
    const kindBtn = (b) => `
        <button type="button" data-action="tmove-kind" data-kind="${b.key}" class="kind-btn${b.active ? ' active' : ''} ${b.cls}">
            ${b.label}<span>${b.sub}</span>
        </button>`;
    $('tm_kinds').style.gridTemplateColumns = `repeat(${btns.length}, minmax(0, 1fr))`;
    $('tm_kinds').innerHTML = btns.map(kindBtn).join('');
    // الجملة: شراء بنسبته وبيع بنسبتي (الربح بيبين بالبيع)
    const t = traders.find(x => x.id === $('tm_trader').value);
    $('tm_kinds_whole').innerHTML = [
        { key: 'buy_whole', label: 'شراء جملة', sub: `منه، بيزيد اللي إله (${round2(t?.commissionPct || 0)}%)`, cls: 'his', active: current === 'buy_whole' },
        { key: 'sell_whole', label: 'بيع جملة', sub: `إله، بيزيد اللي إلك (${round2(t?.myCommissionPct || 0)}%)`, cls: 'mine', active: current === 'sell_whole' }
    ].map(kindBtn).join('');
}

// اتجاه التصفير حسب الرصيد: لنا عنده → دفع لنا، له عندنا → دفعنا له
function settleKindFor() {
    const t = traders.find(x => x.id === $('tm_trader').value);
    const bal = ((t && traderBalances(t.id)[$('tm_currency').value]) || 0) - editingMoveEffect();
    return bal < 0 && !isZero(bal) ? 'i_paid' : 'he_paid';
}

const isPlainKind = (kind) => kind === 'for_us' || kind === 'for_him';

function setTmoveKind(kind) {
    const prev = $('tm_kind').value;
    $('tm_kind').value = kind === 'settle' ? settleKindFor() : kind;
    const now = $('tm_kind').value;
    const whole = TMOVE_KINDS[now].whole;
    // النسبة الافتراضية بس لما النوع يتغير فعلاً (مش بفتح حركة محفوظة)
    if (now !== prev && !tmoveOpening) {
        const t = traders.find(x => x.id === $('tm_trader').value);
        if (isPlainKind(now) && $('tm_service').value) {
            // لنا ↔ له والخدمة مختارة: العمولة بترجع من جدولها
            tmoveFeeTouched = false;
        } else {
            $('tm_commission').value = whole === 'buy' ? (t?.commissionPct || 0) : whole === 'sell' ? (t?.myCommissionPct || 0) : 0;
            $('tm_commission_fixed').value = '';
        }
        if (whole === 'sell') $('tm_buy_pct').value = lastBuyPct($('tm_currency').value, toNum($('tm_id').value, -1)) ?? '';
        if (whole) { $('tm_service').value = ''; renderTmoveServiceChips(); }
    }
    syncTmoveFields();
    renderTmoveKinds();
    updateTmovePreview();
}

// الخدمة (لنا/له بالدولار بس، لأن جدولها بالدولار) ونسبة الشراء (بيع الجملة بس)، والعناوين حسب النوع
let tmoveSavedServiceId = '';

function syncTmoveFields() {
    const kind = $('tm_kind').value;
    const k = TMOVE_KINDS[kind];
    const t = traders.find(x => x.id === $('tm_trader').value);
    const list = t ? servicesOf(t.id) : [];
    // خدمة الحركة المحفوظة انحذفت: بتضل خيار حتى ما تنمسح من الحركة لما تعدّلها
    const lost = tmoveSavedServiceId && !list.some(x => x.id === tmoveSavedServiceId) ? tmoveSavedServiceId : '';
    const usd = $('tm_currency').value === 'USD';
    const show = isPlainKind(kind) && usd && (list.length > 0 || !!lost);
    $('tm_service_wrap').classList.toggle('hidden', !show);
    $('tm_service_note').classList.toggle('hidden', !(isPlainKind(kind) && !usd && list.length));
    if (show) {
        const cur = $('tm_service').value;
        $('tm_service').innerHTML = '<option value="">بدون خدمة (العمولة بإيدك)</option>'
            + list.map(x => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('')
            + (lost ? `<option value="${escapeHtml(lost)}">خدمة محذوفة (العمولة زي ما انحفظت)</option>` : '');
        $('tm_service').value = [...$('tm_service').options].some(o => o.value === cur) ? cur : '';
        renderTmoveServiceChips();
    }
    $('tm_buy_pct_wrap').classList.toggle('hidden', kind !== 'sell_whole');
    $('tm_commission_label').textContent = k.whole === 'buy' ? 'نسبته % (بتنزاد على المبلغ)'
        : k.whole === 'sell' ? 'بعتها بـ % (بتنزاد على المبلغ)'
        : k.settle ? 'العمولة % (بتنخصم من الدفعة)'
        : 'العمولة % (بتنخصم من المبلغ)';
}

// أزرار الخدمات بشعاراتها (القائمة الأصلية tm_service مخفية وهي اللي بتنقرا)
function renderTmoveServiceChips() {
    const cur = $('tm_service').value;
    $('tm_service_chips').innerHTML = [...$('tm_service').options].map(o => {
        const sv = traderServices.find(x => x.id === o.value);
        return `<button type="button" data-action="tmove-service" data-id="${escapeHtml(o.value)}" class="tm-svc${o.value === cur ? ' active' : ''}">
            ${sv ? serviceLogoHtml(sv, 'sm') : ''}<span>${o.value ? escapeHtml(sv ? sv.name : o.text) : 'بدون خدمة'}</span>
        </button>`;
    }).join('');
}

function pickTmoveService(id) {
    if ($('tm_service').value === id) return;
    $('tm_service').value = id;
    renderTmoveServiceChips();
    onTmoveServiceChange();
}

// الخدمة المختارة بتعبّي العمولة من جدولها حسب المبلغ (إلا إذا كتبتها بإيدك)
let tmoveFeeTouched = false;
let tmoveOpening = false;

function applyTmoveServiceFee() {
    const sv = traderServices.find(x => x.id === $('tm_service').value);
    if (!sv || tmoveFeeTouched || $('tm_service_wrap').classList.contains('hidden')) return;
    const amount = toNum($('tm_amount').value, 0);
    const tier = serviceTier(sv, amount);
    if (!tier) return;
    $('tm_commission').value = tier.pct || 0;
    $('tm_commission_fixed').value = tier.fixed || '';
}

// "بدون خدمة" بعد ما الخدمة عبّت العمولة: بترجع صفر (اللي كتبته بإيدك بيضل)
function onTmoveServiceChange() {
    if (!$('tm_service').value && !tmoveFeeTouched) {
        $('tm_commission').value = 0;
        $('tm_commission_fixed').value = '';
    }
    tmoveFeeTouched = false;
    updateTmovePreview();
}

// تغيير العملة: الخدمة بتختفي لغير الدولار، والعمولة اللي عبّتها بتنشال معها
function onTmoveCurrencyChange() {
    const auto = !$('tm_service_wrap').classList.contains('hidden') && $('tm_service').value && !tmoveFeeTouched;
    syncTmoveFields();
    if (auto && $('tm_service_wrap').classList.contains('hidden')) {
        $('tm_commission').value = 0;
        $('tm_commission_fixed').value = '';
    }
    updateTmovePreview();
}

function updateTmovePreview() {
    if (TMOVE_KINDS[$('tm_kind').value].settle && $('tm_kind').value !== settleKindFor()) {
        $('tm_kind').value = settleKindFor();
        renderTmoveKinds();
    }
    const kind = $('tm_kind').value;
    const k = TMOVE_KINDS[kind];
    const cur = $('tm_currency').value;
    applyTmoveServiceFee();
    const amount = toNum($('tm_amount').value, 0);
    const pct = toNum($('tm_commission').value, 0);
    const { commission, effect, capped } = moveEffect(kind, amount, pct, toNum($('tm_commission_fixed').value, 0));
    const t = traders.find(x => x.id === $('tm_trader').value);
    const after = round2(((t && traderBalances(t.id)[cur]) || 0) - editingMoveEffect() + effect);
    const sv = !$('tm_service_wrap').classList.contains('hidden') && traderServices.find(x => x.id === $('tm_service').value);
    const buyPct = toNum($('tm_buy_pct').value, NaN);
    const profitLine = kind === 'sell_whole'
        ? `<div class="flex justify-between text-[11px] mt-1 profit-only ${Number.isFinite(buyPct) ? 'text-emerald-700' : 'text-amber-700'} font-bold"><span>${Number.isFinite(buyPct) ? `ربحك (${round2(pct)}% − ${round2(buyPct)}%)` : 'اكتب بكم اشتريتها حتى ينحسب ربحك'}</span><b>${Number.isFinite(buyPct) ? signedMoney(wholesaleProfit(amount, commission, buyPct), cur) : ''}</b></div>`
        : '';
    // الجملة: المبلغ + النسبة = الأثر. لنا/له: المبلغ − العمولة = الأثر
    const math = amount > 0 && commission
        ? `<div class="text-[11px] text-slate-500 mt-1"><bdi class="ltr-num">${fmt(amount)} ${k.feeOp > 0 ? '+' : '−'} ${fmt(commission)} = ${fmt(Math.abs(effect))} ${curSym(cur)}</bdi></div>`
        : '';
    $('tm_preview').innerHTML = `
        <div class="text-[11px] text-slate-500 mb-1">${escapeHtml(k.hint)}${sv ? ` · جدول "${escapeHtml(sv.name)}"${tmoveFeeTouched ? ' (معدّلة بإيدك)' : ''}` : ''}</div>
        <div class="flex justify-between"><span>${commission ? `${k.whole ? 'النسبة' : 'العمولة'}: ${tradeMoney(commission, cur)}` : 'بدون عمولة'}</span>
        <b class="${!k.settle ? (effect >= 0 ? 'text-emerald-700' : 'text-rose-700') : 'text-slate-800'}">${k.settle ? 'تسديد ' : effect >= 0 ? 'لنا عنده +' : 'له عندنا +'}${tradeMoney(effect, cur)}</b></div>
        ${math}
        ${capped ? '<div class="text-[11px] font-bold text-amber-700 mt-1">العمولة أكبر من المبلغ، فانحسبت بقد المبلغ</div>' : ''}
        ${profitLine}
        <div class="flex justify-between text-[11px] mt-1"><span>الرصيد بعد الحركة</span><b>${balanceText(after)} ${tradeMoney(after, cur)}</b></div>`;
}

// عند التعديل: نطرح أثر الحركة القديمة من الرصيد في المعاينة
function editingMoveEffect() {
    const m = traderMoves.find(x => x.id === toNum($('tm_id').value, -1));
    return m && m.currency === $('tm_currency').value ? m.effect : 0;
}

function openTmoveModal({ traderId, kind = 'for_us', currency, amount = '', move = null } = {}) {
    if (!sheetSupportsTraders) return showToast('حدّث السكربت أولاً', 'سكربت Google Sheets الحالي لا يدعم التجار', 'warning');
    const t = traders.find(x => x.id === (move ? move.traderId : traderId));
    if (!t) return;
    $('tmoveModalTitle').textContent = (move ? 'تعديل حركة' : 'حركة جديدة') + ' — ' + t.name;
    $('tm_id').value = move ? move.id : '';
    $('tm_trader').value = t.id;
    $('tm_currency').value = move ? move.currency : (currency || panelCurrency || 'USD');
    $('tm_amount').value = move ? move.amount : amount;
    $('tm_date').value = move ? move.date : localDateStr();
    $('tm_note').value = move ? move.note : '';
    $('tm_commission').value = move ? move.commissionPct : 0;
    $('tm_commission_fixed').value = move && move.commissionFixed ? move.commissionFixed : '';
    $('tm_buy_pct').value = move && move.kind === 'sell_whole' ? move.buyPct : '';
    $('tm_service').innerHTML = '';
    $('tm_service').value = '';
    tmoveSavedServiceId = move?.serviceId || '';
    // الحركة المحفوظة بتفتح بعمولتها زي ما هي (ما بترجع للجدول إلا إذا غيّرت الخدمة).
    // الحركة الجديدة بتاخد افتراضيات نوعها من setTmoveKind (النوع قبله فاضي)
    tmoveFeeTouched = !!move;
    tmoveOpening = !!move;
    $('tm_kind').value = '';
    setTmoveKind(move ? move.kind : kind);
    tmoveOpening = false;
    if (move?.serviceId && !$('tm_service_wrap').classList.contains('hidden')) {
        $('tm_service').value = move.serviceId;
        renderTmoveServiceChips();
    }
    updateTmovePreview();
    openModal('tmoveModal');
    $('tm_amount').focus();
}

// التصفير: حركة تسديد بقيمة الرصيد الحالي، ويمكن تعديل المبلغ لتسديد جزئي
function settleTrader(id, currency) {
    const v = traderBalances(id)[currency] || 0;
    if (isZero(v)) return;
    openTmoveModal({ traderId: id, currency, kind: 'settle', amount: Math.abs(v) });
    $('tm_note').value = 'تصفير الحساب';
}

async function saveTmove(e) {
    e.preventDefault();
    const t = traders.find(x => x.id === $('tm_trader').value);
    if (!t) return;
    const editId = toNum($('tm_id').value, 0);
    const move = normalizeTmove({
        id: editId || Math.max(Date.now(), traderMoves.reduce((m, x) => Math.max(m, x.id), 0) + 1),
        date: $('tm_date').value || localDateStr(),
        traderId: t.id, traderName: t.name,
        kind: $('tm_kind').value, currency: $('tm_currency').value,
        amount: $('tm_amount').value, commissionPct: $('tm_commission').value, commissionFixed: $('tm_commission_fixed').value,
        buyPct: $('tm_buy_pct').value,
        serviceId: $('tm_service_wrap').classList.contains('hidden') ? '' : $('tm_service').value,
        note: $('tm_note').value
    });
    if (!(move.amount > 0)) return showToast('تنبيه', 'اكتب المبلغ', 'warning');
    if (move.kind === 'sell_whole' && String($('tm_buy_pct').value).trim() === '') return showToast('تنبيه', 'اكتب بكم اشتريتها (%) حتى ينحسب ربحك', 'warning');
    if (editLocked('traderMoves', traderMoves.find(x => x.id === move.id), move)) return lockWarn();

    const i = traderMoves.findIndex(x => x.id === move.id);
    if (i >= 0) traderMoves[i] = move; else traderMoves.push(move);
    queueOps({ action: 'upsert_tmove', move });
    closeModal('tmoveModal');
    if (panelTraderId === t.id) panelCurrency = move.currency;
    renderTraders();

    const bal = traderBalances(t.id)[move.currency] || 0;
    const status = await flushOutbox();
    showToast(isZero(bal) ? 'تم تصفير الحساب ✓' : 'تم حفظ الحركة',
        `${t.name}: ${balanceText(bal)} ${fmt(Math.abs(bal))} ${curSym(move.currency)} — ${syncResultMessage(status)}`, syncToastType(status));
}

function deleteTmovePrompt(id) {
    const m = traderMoves.find(x => x.id === id);
    if (!m) return;
    if (dayLocked(m.date)) return lockWarn();
    showAppConfirm('حذف الحركة', `حذف "${TMOVE_KINDS[m.kind].label}" بمبلغ ${fmt(m.amount)} ${curSym(m.currency)}؟`, async () => {
        traderMoves = traderMoves.filter(x => x.id !== id);
        queueOps({ action: 'delete_tmove', id });
        renderTraders();
        const status = await flushOutbox();
        showToast('تم حذف الحركة', syncResultMessage(status), syncToastType(status));
    });
}

async function exportStatement(format) {
    const t = traders.find(x => x.id === panelTraderId);
    if (!t || !$('trader-statement')) return;
    const buttons = document.querySelectorAll('[data-action^="statement-"]');
    buttons.forEach(b => { b.disabled = true; });
    try {
        await exportElement($('trader-statement'), format, `كشف_${t.name}_${panelCurrency}_${localDateStr()}`, 2.5);
        showToast('تم تحميل الكشف', (format === 'pdf' ? 'ملف PDF' : 'صورة PNG') + ' — أرسله للتاجر على واتساب', 'info');
    } catch (err) {
        console.error('Statement export failed:', err);
        showToast('تعذر إنشاء الصورة', 'تأكد من الاتصال بالإنترنت ثم حاول مجدداً', 'error');
    } finally {
        buttons.forEach(b => { b.disabled = false; });
    }
}
