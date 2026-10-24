'use strict';

// فاست باي — الجنيه المصري: محافظ (فودافون كاش، انستا باي...)، إرسال واستقبال جنيه، شحن/بيع، شاشة الجنيه، والحاسبة السريعة
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= البيانات =================
// المحافظ من ورقة "محافظ الجنيه" والحركات من "حركات الجنيه". رصيد كل محفظة = مجموع أثر الحركات عليها
let egpWallets = [];
let egpMoves = [];
let sheetSupportsEgp = true;
let egpWalletFilter = '';
let egpSearch = '';
let editingEgpId = null;
let editingEgpWalletId = null;
let egpPickerIndex = -1;
let egpQuick = { dir: 'send', unit: 'EGP' };
let egpPctTouched = false; // إذا عدّلت النسبة بيدك لحركة وحدة، ما بتتغير حسب الشريحة

const EGP_WALLET_TYPES = {
    vodafone: { label: 'فودافون كاش', color: '#e60000', soft: '#fee2e2', ink: '#991b1b' },
    instapay: { label: 'انستا باي', color: '#6d28d9', soft: '#ede9fe', ink: '#4c1d95' },
    etisalat: { label: 'اتصالات كاش', color: '#16a34a', soft: '#dcfce7', ink: '#166534' },
    orange: { label: 'أورنج كاش', color: '#f97316', soft: '#ffedd5', ink: '#9a3412' },
    bank: { label: 'بنك مصري', color: '#0369a1', soft: '#e0f2fe', ink: '#075985' },
    cash: { label: 'كاش جنيه', color: '#f59e0b', soft: '#fef3c7', ink: '#92400e' },
    other: { label: 'أخرى', color: '#64748b', soft: '#f1f5f9', ink: '#334155' }
};
// نفس الأسماء في السكربت (VALUE_LABELS.kind)
const EGP_KINDS = { send: 'إرسال جنيه', receive: 'استقبال جنيه', topup: 'شحن/بيع جنيه', adjust: 'تعديل رصيد', transfer: 'تحويل بين المحافظ' };
// ملاحظة دفعات الحركة في الحسابات
const egpPayWho = (m) => m.customerName || m.party || egpWalletName(egpWallets.find(w => w.id === m.walletId));
const egpPayNote = (m) => `${EGP_KINDS[m.kind]} · ${egpPayWho(m)}`;
const isEgpPayNote = (note) => Object.values(EGP_KINDS).some(k => note.startsWith(`${k} · `));
const EGP_KIND_CLS = { send: 'bg-rose-50 text-rose-700', receive: 'bg-emerald-50 text-emerald-700', topup: 'bg-sky-50 text-sky-700', adjust: 'bg-slate-100 text-slate-600', transfer: 'bg-slate-100 text-slate-600' };

function normalizeEgpWallet(w) {
    return {
        id: String(w?.id ?? '').trim(),
        walletType: EGP_WALLET_TYPES[w?.walletType] ? w.walletType : 'other',
        holder: String(w?.holder ?? '').trim(),
        number: String(w?.number ?? '').trim(),
        // تنبيه لما رصيدها ينزل تحت هالمبلغ بالجنيه (0 = بدون تنبيه)
        alertBelow: Math.max(0, toNum(w?.alertBelow, 0)),
        order: toNum(w?.order, 0),
        note: String(w?.note ?? '').trim(),
        createdAt: String(w?.createdAt ?? '').slice(0, 10)
    };
}

function egpWalletName(w) {
    if (!w) return 'محفظة محذوفة';
    const label = EGP_WALLET_TYPES[w.walletType].label;
    return w.holder ? `${label} – ${w.holder}` : label;
}

const sortedEgpWallets = () => [...egpWallets].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
const egpWalletColor = (w) => EGP_WALLET_TYPES[w?.walletType || 'other'].color;
// الجنيه بدون كسور إلا إذا في كسور فعلاً (رسوم مثلاً)
const fmtEgp = (v) => fmt(v, Math.abs(round2(v) % 1) > 0.004 ? 2 : 0);

// ================= الحساب =================
// الجنيه لأقرب جنيه صحيح، والشيكل والدولار لأقرب نصف — دايماً لصالحنا
const floorEgp = (v) => Math.floor(round2(v) + 1e-9);
const ceilEgp = (v) => Math.ceil(round2(v) - 1e-9);

// الإرسال: الزبون بيدفع (الجنيه ÷ سعر الزبون) دولار، وبالشيكل × سعر الشراء، مقرّب لفوق لأقرب نصف
// الاستقبال: بندفع (الجنيه ÷ سعر الزبون) دولار، وبالشيكل × سعر البيع، مقرّب لتحت
// الربح = الفرق بين المدفوع وقيمة الجنيه على شاشة الجنيه بنفس سعر الدولار (ورسوم التحويل علينا)
// المبلغ المتفق عليه (fixedTotal) يصير هو المبلغ النهائي بالضبط. الشحن/البيع: مبلغ فعلي بدون ربح
function computeEgp({ kind, egp, fee = 0, rate = 0, screen = 0, usdRate = 0, currency, settle = 0, fixedTotal = 0, finalAdjust = 0, total = 0 }) {
    if (kind === 'send' || kind === 'receive') {
        const ils = currency !== 'USD';
        const k = ils ? usdRate : 1;
        const send = kind === 'send';
        const gross = rate > 0 ? egp / rate * k : 0;
        // finalAdjust: تعديل ± يدوي بعد التقريب (لا يُستعمل مع المبلغ المتفق عليه)، والربح يتبعه
        const final = fixedTotal > 0 ? round2(fixedTotal) : Math.max(0, round2((send ? roundUpHalf(gross) : roundDownHalf(gross)) + finalAdjust));
        // بدون شاشة للجنيه ما بنحسب ربح
        const value = screen > 0 ? (send ? egp + fee : egp) / screen * k : null;
        const profit = value === null ? 0 : send ? final - settle - value : value - (final - settle);
        return { gross: round2(gross), total: final, egpEffect: send ? -round2(egp + fee) : round2(egp), profitIls: round2(ils ? profit : profit * usdRate) };
    }
    if (kind === 'topup') return { gross: round2(total), total: round2(total), egpEffect: round2(egp), profitIls: 0 };
    if (kind === 'transfer') return { gross: 0, total: 0, egpEffect: -round2(fee), profitIls: 0 };
    return { gross: 0, total: 0, egpEffect: round2(egp), profitIls: 0 };
}

function normalizeEgp(m) {
    const kind = EGP_KINDS[m?.kind] ? m.kind : 'send';
    const trade = kind === 'send' || kind === 'receive';
    const egp = round2(toNum(m?.egp, 0));
    const fixedTotal = trade ? Math.max(0, round2(toNum(m?.fixedTotal, 0))) : 0;
    const base = {
        id: toNum(m?.id, 0),
        serial: toSerial(m?.serial),
        date: String(m?.date ?? '').slice(0, 10),
        kind,
        customerId: trade ? String(m?.customerId ?? '').trim() : '',
        customerName: trade ? String(m?.customerName ?? '').trim() : '',
        walletId: String(m?.walletId ?? '').trim(),
        walletName: String(m?.walletName ?? '').trim(),
        toWalletId: kind === 'transfer' ? String(m?.toWalletId ?? '').trim() : '',
        // التعديل والشحن/البيع بإشارة (+ يدخل المحفظة، − يطلع منها)، والباقي موجب
        egp: kind === 'adjust' || kind === 'topup' ? egp : Math.max(0, egp),
        fee: kind === 'send' || kind === 'transfer' ? Math.max(0, round2(toNum(m?.fee, 0))) : 0,
        rate: trade ? Math.max(0, toNum(m?.rate, 0)) : 0,
        screen: trade ? Math.max(0, toNum(m?.screen, 0)) : 0,
        usdRate: Math.max(0, toNum(m?.usdRate, 0)),
        currency: m?.currency === 'USD' ? 'USD' : 'ILS',
        fixedTotal,
        finalAdjust: trade && !(fixedTotal > 0) ? round2(toNum(m?.finalAdjust, 0)) : 0,
        total: kind === 'topup' ? Math.max(0, round2(toNum(m?.total, 0))) : 0,
        settle: trade || kind === 'topup' ? Math.max(0, round2(toNum(m?.settle, 0))) : 0,
        party: String(m?.party ?? '').trim(),
        partyNumber: String(m?.partyNumber ?? '').trim(),
        note: String(m?.note ?? '').trim(),
        trackToken: String(m?.trackToken ?? '').trim(),
        createdBy: String(m?.createdBy ?? '').trim(),
        updatedBy: String(m?.updatedBy ?? '').trim()
    };
    return { ...base, ...computeEgp(base) };
}

// المبلغ المتفق عليه (شيكل أو دولار) ← الجنيه بالجنيه الصحيح، والتقريب لصالحنا:
// الإرسال: الزبون بيدفع المبلغ وبيوصل جنيه مقرّب لتحت. الاستقبال: بيبعت جنيه مقرّب لفوق وبياخد المبلغ.
function egpForMoney(f) {
    const k = f.currency === 'USD' ? 1 : f.usdRate;
    if (!(k > 0) || !(f.rate > 0) || !(f.fixedTotal > 0)) return 0;
    const exact = f.fixedTotal / k * f.rate;
    return Math.max(0, f.kind === 'send' ? floorEgp(exact) : ceilEgp(exact));
}

// اتجاه الفلوس: 1 داخلة لنا (إرسال، بيع جنيه)، −1 طالعة منا (استقبال، شراء جنيه)، 0 بدون دفع
function egpDir(m) {
    if (m.kind === 'send') return 1;
    if (m.kind === 'receive') return -1;
    if (m.kind === 'topup') return m.egp >= 0 ? -1 : 1;
    return 0;
}

function egpPayState(m) {
    const dir = egpDir(m);
    if (!dir || !(m.total > 0)) return null;
    const paid = paidFor('egp', m.id, m.currency, dir);
    const remaining = round2(m.total - m.settle - paid);
    const state = remaining <= 0.004 ? 'paid' : paid > 0.004 ? 'partial' : 'unpaid';
    return { paid, remaining: Math.max(0, remaining), state, dir };
}

// أثر حركة على محفظة واحدة (التحويل ينقص من وحدة ويزيد الثانية)
function egpEffectOn(m, walletId) {
    if (m.kind === 'transfer') return (m.walletId === walletId ? -(m.egp + m.fee) : 0) + (m.toWalletId === walletId ? m.egp : 0);
    return m.walletId === walletId ? m.egpEffect : 0;
}

function egpWalletBalances() {
    const map = {};
    const add = (id, v) => { if (id) map[id] = round2((map[id] || 0) + v); };
    egpMoves.forEach(m => {
        if (m.kind === 'transfer') {
            add(m.walletId, -(m.egp + m.fee));
            add(m.toWalletId, m.egp);
        } else add(m.walletId, m.egpEffect);
    });
    return map;
}

const egpBalance = () => round2(egpMoves.reduce((s, m) => s + m.egpEffect, 0));

function egpReady() {
    if (sheetSupportsEgp) return true;
    showToast('حدّث السكربت أولاً', 'سكربت Google Sheets الحالي لا يدعم صفحة الجنيه', 'warning');
    return false;
}

// ================= شاشة الجنيه =================
// جنيه لكل دولار: تلقائي من نفس مصدر سعر الدولار، أو مثبّت يدوياً.
// السوق = الشاشة مع سعر الدولار (الإرسال على سعر الشراء، والاستقبال على سعر الصرف = سعر البيع)،
// والزبون بياخد أقل من السوق بنسبتنا بالاتجاهين (نفس النسبة للشيكل والدولار):
// الإرسال: الجنيه اللي بيوصله = السوق × (1 − ن) ← سعر الإرسال = الشاشة × (1 − ن)
// الاستقبال: اللي بياخده = قيمة الجنيه بالسوق × (1 − ن) ← سعر الاستقبال = الشاشة ÷ (1 − ن)
let egpRateStatus = 'loading';
let lastEgpRateFetchMs = 0;

const egpScreen = () => toNum(globalConfig.egpScreenRate, 0);
const EGP_MAX_PCT = 90;

function egpRateFromPct(kind, screen, pct) {
    const f = 1 - toNum(pct, 0) / 100;
    if (!(screen > 0) || !(f > 0)) return 0;
    return round4(kind === 'send' ? screen * f : screen / f);
}

// النسبة من سعر الحركة وشاشتها (عكس egpRateFromPct)
function egpPctOf(kind, screen, rate) {
    if (!(screen > 0) || !(rate > 0)) return 0;
    return round2((kind === 'send' ? 1 - rate / screen : 1 - screen / rate) * 100);
}

function egpRates(screen = egpScreen()) {
    const sendPct = toNum(globalConfig.egpSendPct, 0);
    const receivePct = toNum(globalConfig.egpReceivePct, 0);
    return {
        screen: screen > 0 ? screen : 0,
        usdSend: sellBuyRates().buy,
        usdReceive: sellBuyRates().sell,
        sendPct,
        receivePct,
        send: egpRateFromPct('send', screen, sendPct),
        receive: egpRateFromPct('receive', screen, receivePct)
    };
}

// سعر الألف جنيه بعملة الدفع
const egpPerThousand = (rate, usdRate, cur) => (rate > 0 ? round2(1000 / rate * (cur === 'USD' ? 1 : usdRate)) : 0);

// ---------- شرائح النسبة حسب المبلغ (بطلب عماد 2026-10-17، زي شرائح سحب USDT) ----------
// المبلغ بالشيكل اللي بيدفعه الزبون (إرسال) أو بياخده (استقبال)، والدولار بيتحول بسعر دولار الحركة.
// أول شريحة (من 0) = النسبة الأساسية egpSendPct/egpReceivePct، والشرائح فوقها egpSendTiers/egpReceiveTiers [{min ₪, pct}]
const EGP_TIER_KEYS = { send: ['egpSendPct', 'egpSendTiers'], receive: ['egpReceivePct', 'egpReceiveTiers'] };

function egpTiers(kind) {
    const [pctKey, tiersKey] = EGP_TIER_KEYS[kind];
    const extra = (Array.isArray(globalConfig[tiersKey]) ? globalConfig[tiersKey] : [])
        .map(t => ({ min: round2(toNum(t?.min, 0)), pct: round2(toNum(t?.pct, NaN)) }))
        .filter(t => t.min > 0 && t.pct >= 0 && t.pct <= EGP_MAX_PCT)
        .sort((a, b) => a.min - b.min);
    return [{ min: 0, pct: toNum(globalConfig[pctKey], 0) }, ...extra];
}

function egpTierFor(kind, ils) {
    let tier = null;
    egpTiers(kind).forEach(t => { if (!tier || ils >= t.min - 0.004) tier = t; });
    return tier;
}

// "أقل من 400 ₪" / "من 400 لـ 1000 ₪" / "من 1000 ₪ فما فوق"
const egpTierRange = (kind, min) => tierRangeText(egpTiers(kind), min, '₪');

// النسبة اللي بتنطبق على الحركة f ({kind, egp, fixedTotal, currency, usdRate, screen}):
// - المبلغ المتفق عليه: الشريحة من المبلغ نفسه.
// - الجنيه: لكل شريحة بنحسب المبلغ وبناخد الشريحة اللي المبلغ بيقع فيها (إذا أكتر من وحدة: الأحسن للزبون).
// - بالإرسال لما الجنيه على حد شريحة (بنسبتها المبلغ تحت حدها، وبالنسبة اللي قبلها فوقه): الزبون بيدفع حد
//   الشريحة بالضبط (400 ₪) بنسبة بيناتهم، فالمبلغ ما بينزل لما الجنيه يزيد. edge = حد الشريحة
function egpTierPct(f) {
    const tiers = egpTiers(f.kind);
    const base = { pct: tiers[0].pct, min: 0, edge: 0 };
    const toIls = f.currency === 'USD' ? f.usdRate : 1;
    if (tiers.length < 2 || !(f.screen > 0) || !(f.usdRate > 0)) return base;
    if (f.fixedTotal > 0) {
        const t = egpTierFor(f.kind, f.fixedTotal * toIls);
        return { pct: t.pct, min: t.min, edge: 0 };
    }
    if (!(f.egp > 0)) return base;
    const send = f.kind === 'send';
    const totalAt = (pct) => computeEgp({ ...f, rate: egpRateFromPct(f.kind, f.screen, pct), fixedTotal: 0, finalAdjust: 0 }).total;
    const options = [];
    tiers.forEach(t => {
        const total = totalAt(t.pct);
        if (egpTierFor(f.kind, total * toIls).min === t.min) return options.push({ pct: t.pct, min: t.min, edge: 0, total });
        if (!send || !t.min || total * toIls >= t.min) return;
        // حد الشريحة بعملة الحركة، والنسبة لتحت بخانتين حتى المبلغ قبل التقريب ما يعدّي الحد
        const edge = roundUpHalf(t.min / toIls);
        const rate = f.egp * (f.currency === 'USD' ? 1 : f.usdRate) / edge;
        const pct = Math.floor(((1 - rate / f.screen) * 100 + 1e-9) * 100) / 100;
        if (!(pct >= 0) || pct > EGP_MAX_PCT) return;
        const edgeTotal = totalAt(pct);
        if (egpTierFor(f.kind, edgeTotal * toIls).min === t.min) options.push({ pct, min: t.min, edge: t.min, total: edgeTotal });
    });
    if (!options.length) {
        const t = egpTierFor(f.kind, totalAt(base.pct) * toIls);
        return { pct: t.pct, min: t.min, edge: 0 };
    }
    options.sort((a, b) => (send ? a.total - b.total : b.total - a.total));
    return options[0];
}

// الحركة بنسبة شريحتها وسعرها
function withEgpTier(f) {
    const t = egpTierPct(f);
    return { ...f, pct: t.pct, rate: egpRateFromPct(f.kind, f.screen, t.pct), tierMin: t.min, tierEdge: t.edge };
}

// سطر صغير تحت الحساب: أي شريحة انطبقت (بس إذا في شرائح)
function egpTierNote(f) {
    if (egpTiers(f.kind).length < 2) return '';
    const text = f.tierEdge
        ? `على حد شريحة ${fmtEgp(f.tierEdge)} ₪، فبيدفع ${f.currency === 'USD' ? 'حدها بالدولار' : `${fmtEgp(f.tierEdge)} ₪ بالضبط`} (نسبة ${round2(f.pct)}%)`
        : `الشريحة: ${egpTierRange(f.kind, f.tierMin)} ← ${round2(f.pct)}%`;
    return `<div class="text-[11px] text-slate-500 profit-only">${text}</div>`;
}

// "13%" أو "13% · من 400 ₪: 10%"
const egpTierSummary = (kind) => egpTiers(kind).map((t, i) => (i ? `من ${fmtEgp(t.min)} ₪: ${round2(t.pct)}%` : `${round2(t.pct)}%`)).join(' · ');

async function fetchEgpRate({ manual = false } = {}) {
    // في الوضع اليدوي لا يتغير السعر إلا بطلب صريح
    if (globalConfig.egpRateMode === 'manual' && !manual) {
        egpRateStatus = 'manual';
        renderEgpRates();
        return;
    }
    // نطلبه كل 10 دقائق على الأكثر (نفس طلب سعر الدولار)
    if (!manual && egpRateStatus === 'ok' && Date.now() - lastEgpRateFetchMs < RATE_REFRESH_MS) return;
    lastEgpRateFetchMs = Date.now();
    egpRateStatus = 'loading';
    renderEgpRates();
    try {
        const data = await fetchMarketRates({ fresh: manual });
        const market = toNum(data?.rates?.EGP, NaN);
        if (!(market > 0)) throw new Error('لم يتم استلام سعر الجنيه');
        // ربما ثبّت المستخدم سعراً يدوياً أثناء انتظار الرد
        if (!manual && globalConfig.egpRateMode === 'manual') {
            egpRateStatus = 'manual';
            renderEgpRates();
            return;
        }
        applyEgpMarket(data, { force: manual });
        // الرد انتجاهل (سعر السكربت أحدث): بس نشيل "جاري"
        if (egpRateStatus === 'loading') {
            egpRateStatus = 'ok';
            renderEgpRates();
        }
        if (manual) showToast('تم تحديث شاشة الجنيه', `${fmt(globalConfig.egpScreenRate)} جنيه للدولار من السوق (التحديث التلقائي مفعّل)`);
    } catch (err) {
        console.warn('Could not fetch EGP rate:', err);
        egpRateStatus = globalConfig.egpRateMode === 'manual' ? 'manual' : 'error';
        renderEgpRates();
        if (manual) showToast('تنبيه الاتصال', 'تعذر جلب سعر الجنيه حالياً، بقي السعر المعتمد', 'warning');
    }
}

// شاشة الجنيه من رد السوق (من طلب سعر الدولار، أو مع قراءة الشيت)، إذا الوضع تلقائي
function applyEgpMarket(data, { force = false } = {}) {
    const market = toNum(data?.rates?.EGP, NaN);
    if (!(market > 0) || (!force && globalConfig.egpRateMode === 'manual')) return;
    // الاحتياط ما بيكتب فوق سعر السكربت الحديث (إلا بطلب يدوي)
    if (!force && data.source !== 'market' && scriptMarketFresh()) return;
    globalConfig.egpMarketRate = round2(market);
    globalConfig.egpScreenRate = round2(market);
    globalConfig.egpRateMode = 'auto';
    globalConfig.egpRateUpdated = nowTimeLabel();
    egpRateStatus = 'ok';
    lastEgpRateFetchMs = Date.now();
    saveAll();
    renderEgpRates();
    renderEgpQuick();
}

function pinEgpRate() {
    const val = toNum($('egp_set_screen').value, NaN);
    if (!(val > 0)) return showToast('تنبيه', 'اكتب سعر الجنيه للدولار', 'warning');
    globalConfig.egpScreenRate = round2(val);
    globalConfig.egpRateMode = 'manual';
    globalConfig.egpRateUpdated = nowTimeLabel();
    egpRateStatus = 'manual';
    saveAll();
    $('egp_set_screen').blur();
    renderEgpRates();
    renderEgpQuick();
    showToast('تم تثبيت شاشة الجنيه', `${fmt(globalConfig.egpScreenRate)} جنيه للدولار، وما بتتغير لحالها لحتى تكبس "من السوق"`);
}

// النسبة تنكتب مباشرة، أو بتنحسب من سعر الألف جنيه بالشيكل
function onEgpPctChange(el) {
    const send = el.id.startsWith('egp_set_send');
    const r = egpRates();
    let pct = toNum(el.value, NaN);
    if (el.id.endsWith('_price')) {
        const usd = send ? r.usdSend : r.usdReceive;
        if (!(r.screen > 0) || !(usd > 0) || !(pct > 0)) { renderEgpRates(); return; }
        const market = 1000 / r.screen * usd;
        pct = send ? (1 - market / pct) * 100 : (1 - pct / market) * 100;
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > EGP_MAX_PCT) {
        showToast('تنبيه', `النسبة لازم تكون بين 0 و ${EGP_MAX_PCT}% (السعر ما بيكون أحسن من السوق)`, 'warning');
        renderEgpRates();
        return;
    }
    globalConfig[send ? 'egpSendPct' : 'egpReceivePct'] = round2(pct);
    saveAll();
    renderEgpRates();
    renderEgpQuick();
}

function renderEgpRates() {
    const r = egpRates();
    const manual = globalConfig.egpRateMode === 'manual';
    const ready = r.screen > 0 && r.usdSend > 0 && r.usdReceive > 0;
    const thousand = {
        marketSend: ready ? egpPerThousand(r.screen, r.usdSend, 'ILS') : 0,
        marketReceive: ready ? egpPerThousand(r.screen, r.usdReceive, 'ILS') : 0,
        send: ready ? egpPerThousand(r.send, r.usdSend, 'ILS') : 0,
        receive: ready ? egpPerThousand(r.receive, r.usdReceive, 'ILS') : 0
    };
    $('egp-screen').textContent = r.screen ? fmt(r.screen) : '—';
    $('egp-rate-badge').textContent = manual ? '🔒 يدوي' : egpRateStatus === 'error' ? 'غير متصل' : egpRateStatus === 'loading' ? 'جاري التحديث' : 'تلقائي';
    $('egp-rate-badge').className = 'badge ' + (manual ? 'bg-amber-50 text-amber-700' : egpRateStatus === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700');
    // مع الشرائح: سعر الألف لكل شريحة
    const tierLine = (kind, usd) => egpTiers(kind).slice(1).map(t => `من ${fmtEgp(t.min)} ₪ <b class="text-slate-800">${fmt(egpPerThousand(egpRateFromPct(kind, r.screen, t.pct), usd, 'ILS'))} ₪</b>`).join(' · ');
    const sendTiers = ready ? tierLine('send', r.usdSend) : '', receiveTiers = ready ? tierLine('receive', r.usdReceive) : '';
    $('egp-rates-line').innerHTML = ready
        ? `الألف: إرسال <b class="text-slate-800">${fmt(thousand.send)} ₪</b> · استقبال <b class="text-slate-800">${fmt(thousand.receive)} ₪</b>`
            + (sendTiers ? `<div class="font-medium">إرسال ${sendTiers}</div>` : '')
            + (receiveTiers ? `<div class="font-medium">استقبال ${receiveTiers}</div>` : '')
        : 'ما في سعر للجنيه بعد';
    $('egp-thousand-line').innerHTML = ready
        ? `الألف جنيه بالسوق: إرسال <b class="text-slate-900">${fmt(thousand.marketSend)} ₪</b> · استقبال <b class="text-slate-900">${fmt(thousand.marketReceive)} ₪</b><div class="font-medium text-slate-400">شاشة ${fmt(r.screen)} · شراء الدولار ${fmt(r.usdSend, 3)} · صرف ${fmt(r.usdReceive, 3)}</div>`
        : '';
    $('egp-pct-line').textContent = `نسبتنا: إرسال ${egpTierSummary('send')} — استقبال ${egpTierSummary('receive')}`;
    const hasTiers = egpTiers('send').length > 1 || egpTiers('receive').length > 1;
    $('egp-tiers-hint').textContent = hasTiers
        ? `هاي أول شريحة (${egpTierRange('send', 0)})، والشرائح الأكبر من الإعدادات.`
        : 'بدك نسبة حسب المبلغ (100 ₪ بسعر و 400 ₪ بسعر)؟ من الشرائح.';
    // تعديل الأسعار لمن عنده صلاحية الإعدادات (تُحفظ في الشيت لكل الأجهزة)
    const canEdit = hasPerm('settings');
    $('egp-rate-form').classList.toggle('hidden', !canEdit);
    $('egp-rate-readonly').classList.toggle('hidden', canEdit);
    $('egp-pct-line').classList.toggle('hidden', canEdit);
    const setField = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
    setField('egp_set_screen', r.screen || '');
    setField('egp_set_send_pct', r.sendPct);
    setField('egp_set_receive_pct', r.receivePct);
    setField('egp_set_send_price', thousand.send || '');
    setField('egp_set_receive_price', thousand.receive || '');
    $('egp_set_send_price').disabled = $('egp_set_receive_price').disabled = !ready;
    const market = toNum(globalConfig.egpMarketRate, 0);
    $('egp-rate-info').textContent = [market ? `السوق ${fmt(market)}` : '', globalConfig.egpRateUpdated ? `آخر تحديث ${globalConfig.egpRateUpdated}` : ''].filter(Boolean).join(' · ');
}

// ================= الصفحة =================
function renderEgpPage() {
    if (pageHidden('egp')) return;
    $('egp-unsupported').classList.toggle('hidden', sheetSupportsEgp || dataState !== 'ready');
    renderEgpRates();
    renderEgpStats();
    renderEgpWallets();
    renderEgpQuick();
    renderEgpLog();
}

const moneyPair = (o) => [o.ILS || !o.USD ? moneyCur(o.ILS, 'ILS') : '', o.USD ? moneyCur(o.USD, 'USD') : ''].filter(Boolean).join(' + ');

function renderEgpStats() {
    const today = localDateStr(), month = today.slice(0, 7);
    let profitToday = 0, profitMonth = 0;
    const owedToUs = { ILS: 0, USD: 0 }, weOwe = { ILS: 0, USD: 0 };
    egpMoves.forEach(m => {
        if (m.date === today) profitToday += m.profitIls;
        if (m.date.startsWith(month)) profitMonth += m.profitIls;
        const st = egpPayState(m);
        if (st && st.remaining > 0.004) (st.dir > 0 ? owedToUs : weOwe)[m.currency] += st.remaining;
    });
    const bal = egpBalance();
    $('egp-balance').textContent = fmtEgp(bal);
    $('egp-balance').classList.toggle('text-rose-300', bal < 0);
    $('egp-profit-today').textContent = '+' + fmt(profitToday, 1) + ' ₪';
    $('egp-profit-month').textContent = `هذا الشهر +${fmt(profitMonth, 1)} ₪`;
    $('egp-owed-to-us').textContent = moneyPair(owedToUs);
    $('egp-we-owe').textContent = `علينا للزبائن: ${moneyPair(weOwe)}`;
}

function renderEgpWallets() {
    const bal = egpWalletBalances();
    const list = sortedEgpWallets();
    $('egp-wallets').innerHTML = list.length === 0
        ? `<div class="col-span-full text-center py-5 space-y-3">
                <p class="text-xs text-slate-400">${emptyMessage(0, '', 'ما في محافظ جنيه بعد. ابدأ بفودافون كاش وانستا باي، أو أضف محفظة.')}</p>
                ${dataState === 'ready' ? '<button data-action="egp-wallet-defaults" class="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4 py-2.5 rounded-lg">ابدأ بفودافون كاش وانستا باي</button>' : ''}
            </div>`
        : list.map((w, i) => {
            const t = EGP_WALLET_TYPES[w.walletType];
            const b = bal[w.id] || 0;
            const low = isLowBalance(b, w.alertBelow);
            return `
                <div class="acc-card${egpWalletFilter === w.id ? ' active' : ''}${low ? ' low' : ''}" data-action="filter-egp-wallet" data-id="${escapeHtml(w.id)}" title="عرض حركات هذه المحفظة" style="--acc:${t.color};--acc-soft:${t.soft};--acc-ink:${t.ink};--d:${i * 40}ms">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <span class="acc-chip">${escapeHtml(t.label)}</span>${low ? '<span class="low-chip" title="الرصيد أقل من حد التنبيه">⚠️ قليل</span>' : ''}
                            <div class="font-black text-slate-900 mt-1.5 truncate">${escapeHtml(w.holder || t.label)}</div>
                            ${w.number ? `<div class="text-[11px] text-slate-400 font-mono truncate" dir="ltr">${escapeHtml(w.number)}</div>` : ''}
                        </div>
                        <button data-action="edit-egp-wallet" data-id="${escapeHtml(w.id)}" class="text-[11px] font-bold text-slate-400 hover:text-slate-700 px-1">تعديل</button>
                    </div>
                    <div class="mt-3 acc-balance ${b < 0 ? 'neg' : ''}">${fmtEgp(b)} <small class="text-xs text-slate-400">جنيه</small></div>
                </div>`;
        }).join('');
}

function toggleEgpWalletFilter(id) {
    egpWalletFilter = egpWalletFilter === id ? '' : id;
    renderEgpWallets();
    renderEgpLog();
}

function egpWalletCell(id) {
    const w = egpWallets.find(x => x.id === id);
    return `<span class="acc-dot" style="--acc:${egpWalletColor(w)}"></span> <b class="text-slate-800">${escapeHtml(egpWalletName(w))}</b>`;
}

function egpRowHtml(m) {
    const st = egpPayState(m);
    const trade = m.kind === 'send' || m.kind === 'receive';
    const who = trade && m.customerName
        ? `<button data-action="open-customer" data-id="${escapeHtml(m.customerId)}" data-name="${escapeHtml(m.customerName)}" class="font-bold hover:text-blue-700 hover:underline text-right" title="ملف الزبون">${escapeHtml(m.customerName)}</button>`
        : `<span class="font-bold">${escapeHtml(m.party || m.note || '—')}</span>`;
    const partyLine = trade && (m.party || m.partyNumber)
        ? `<div class="text-[10px] text-slate-400 font-medium">${m.kind === 'send' ? 'إلى' : 'من'} ${escapeHtml(m.party)} <bdi class="ltr-num">${escapeHtml(m.partyNumber)}</bdi></div>`
        : '';
    const wallet = m.kind === 'transfer' ? `${egpWalletCell(m.walletId)} <span class="text-slate-400">←</span> ${egpWalletCell(m.toWalletId)}` : egpWalletCell(m.walletId);
    const effect = m.kind === 'transfer'
        ? '<span class="text-slate-500">تحويل</span>'
        : `<span class="${m.egpEffect >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${m.egpEffect >= 0 ? '+' : '−'}${fmtEgp(Math.abs(m.egpEffect))}</span>`;
    const total = trade
        ? `<button data-action="egp-receipt" data-id="${m.id}" class="amount-link" title="الإيصال">${moneyCur(m.total, m.currency)}</button><div class="text-[10px] text-slate-400 font-sans">الألف ${fmt(egpPerThousand(m.rate, m.usdRate, m.currency))} ${CUR_SYM[m.currency]}${m.screen > 0 ? ` · ${fmt(egpPctOf(m.kind, m.screen, m.rate))}%` : ''}${m.finalAdjust ? ` · تعديل ${signedAmount(m.finalAdjust)}` : ''}</div>`
        : m.kind === 'topup' ? `${moneyCur(m.total, m.currency)}<div class="text-[10px] text-slate-400 font-sans">${m.egp >= 0 ? 'شراء' : 'بيع'} جنيه</div>` : '—';
    return `
        <tr class="hover:bg-slate-50">
            <td class="p-3 text-[10px] text-slate-400 font-mono whitespace-nowrap" title="${auditTitle(m)}${m.serial ? ` · رقم الحركة ${m.id}` : ''}">${receiptNo(m)}</td>
            <td class="p-3 text-xs text-slate-500 whitespace-nowrap num">${escapeHtml(m.date)}${lockMark(m.date)}</td>
            <td class="p-3 whitespace-nowrap"><span class="badge ${EGP_KIND_CLS[m.kind]}">${EGP_KINDS[m.kind]}</span></td>
            <td class="p-3 text-slate-900 whitespace-nowrap">${who}${partyLine}</td>
            <td class="p-3 text-xs whitespace-nowrap">${wallet}</td>
            <td class="p-3 font-mono font-bold num whitespace-nowrap">${fmtEgp(Math.abs(m.egp))} <span class="text-[10px] text-slate-400 font-sans">جنيه</span><div class="text-[10px] font-sans">${effect}${m.fee ? ` <span class="text-slate-400">· رسوم ${fmtEgp(m.fee)}</span>` : ''}</div></td>
            <td class="p-3 font-mono font-black num whitespace-nowrap">${total}</td>
            <td class="p-3 whitespace-nowrap">${st ? `<span class="badge ${PAY_STATE[st.state].cls}">${PAY_STATE[st.state].label}</span>${st.state === 'partial' ? `<div class="text-[10px] text-slate-500 mt-0.5">الباقي ${moneyCur(st.remaining, m.currency)}</div>` : ''}` : ''}</td>
            <td class="profit-only p-3 font-mono font-black num whitespace-nowrap ${m.profitIls >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${trade ? `${m.profitIls >= 0 ? '+' : ''}${fmt(m.profitIls)} ₪` : ''}</td>
            <td class="p-3 text-center whitespace-nowrap">
                ${st && st.state !== 'paid' ? `<button data-action="egp-pay" data-id="${m.id}" class="text-white bg-slate-900 hover:bg-slate-800 font-bold text-xs px-2.5 py-1 rounded-lg">${st.dir > 0 ? 'استلام' : 'دفع'}</button>` : ''}
                ${trade ? `<button data-action="egp-receipt" data-id="${m.id}" class="text-slate-700 font-bold text-xs px-2.5 py-1 bg-slate-100 rounded-lg">فاتورة</button>` : ''}
                <button data-action="edit-egp" data-id="${m.id}" class="text-blue-600 font-bold text-xs px-2.5 py-1 bg-blue-50 rounded-lg">تعديل</button>
                <button data-action="delete-egp" data-id="${m.id}" class="text-slate-400 hover:text-red-600 p-1 font-bold" title="حذف">✕</button>
            </td>
        </tr>`;
}

function renderEgpLog() {
    if (pageHidden('egp')) return;
    const q = normName(egpSearch);
    const qDigits = normPhone(q);
    const qNo = q.replace('#', '');
    const serialHit = /^\d+$/.test(qNo) && egpMoves.some(m => String(m.serial) === qNo);
    const kindFilter = $('egp_kind_filter').value;
    const monthFilter = $('egp_month_filter').value;
    const wallet = egpWallets.find(w => w.id === egpWalletFilter);
    $('egp-wallet-chip').classList.toggle('hidden', !wallet);
    $('egp-wallet-chip-name').textContent = wallet ? egpWalletName(wallet) : '';
    const list = egpMoves
        .filter(m => kindFilter === 'ALL' || m.kind === kindFilter || (kindFilter === 'adjust' && m.kind === 'transfer'))
        .filter(m => !monthFilter || m.date.startsWith(monthFilter))
        .filter(m => !wallet || m.walletId === wallet.id || m.toWalletId === wallet.id)
        .filter(m => !q || (serialHit ? String(m.serial) === qNo : normName(m.customerName).includes(q) || normName(m.party).includes(q)
            || (qDigits && normPhone(m.partyNumber).includes(qDigits)) || String(m.id).includes(qNo)))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
        .slice(0, 300);
    $('egp-body').innerHTML = list.length === 0
        ? `<tr><td colspan="10" class="p-6 text-center text-xs text-slate-400">${emptyMessage(egpMoves.length, 'لا توجد نتائج', 'لا توجد حركات جنيه بعد')}</td></tr>`
        : list.map(egpRowHtml).join('');
}

// ---------- الحاسبة السريعة (تسعير بدون حفظ) ----------
function setEgpQuick(patch) {
    Object.assign(egpQuick, patch);
    renderEgpQuick();
}

// نفس دوال الحركة: كم بيدفع/بياخد الزبون، أو كم جنيه (بنسبة الشريحة، لكل عملة لحالها)
function egpQuote() {
    const amount = toNum($('egpq_amount').value, 0);
    const r = egpRates();
    const send = egpQuick.dir === 'send';
    const base = { kind: egpQuick.dir, rate: send ? r.send : r.receive, pct: send ? r.sendPct : r.receivePct, screen: r.screen, usdRate: send ? r.usdSend : r.usdReceive, fee: 0, settle: 0, fixedTotal: 0 };
    if (!(amount > 0) || !(base.rate > 0)) return { base, amount: 0 };
    if (egpQuick.unit === 'EGP') {
        const fi = withEgpTier({ ...base, egp: amount, currency: 'ILS' });
        const fu = withEgpTier({ ...base, egp: amount, currency: 'USD' });
        return { base, amount, egp: amount, fi, fu, ils: computeEgp(fi), usd: computeEgp(fu) };
    }
    const f = withEgpTier({ ...base, currency: egpQuick.unit, fixedTotal: amount });
    const egp = egpForMoney(f);
    return { base, amount, egp, f, money: computeEgp({ ...f, egp }), cur: egpQuick.unit };
}

function renderEgpQuick() {
    if (pageHidden('egp')) return;
    document.querySelectorAll('#egpq-dirs [data-dir]').forEach(b => b.classList.toggle('active', b.dataset.dir === egpQuick.dir));
    document.querySelectorAll('#egpq-units [data-unit]').forEach(b => b.classList.toggle('active', b.dataset.unit === egpQuick.unit));
    const q = egpQuote();
    const send = egpQuick.dir === 'send';
    const { rate, usdRate, screen, pct } = q.base;
    if (!(rate > 0)) {
        $('egpq-result').innerHTML = '<div class="tm-preview text-amber-700 font-bold">ما في سعر للجنيه بعد — ثبّت شاشة الجنيه من "⚙️ الأسعار"</div>';
        return;
    }
    // السعر والنسبة حسب شريحة المبلغ المكتوب (بالجنيه: الشيكل والدولار ممكن كل واحد بشريحة)
    const fIls = q.fi || q.f, fUsd = q.fu || q.f;
    const pcts = [...new Set([fIls?.pct ?? pct, fUsd?.pct ?? pct])].map(p => fmt(p) + '%').join(' / ');
    const tiers = egpTiers(egpQuick.dir);
    const tierPrices = tiers.length > 1
        ? `<span class="basis-full">الشرائح (الألف للزبون): ${tiers.map(t => `${egpTierRange(egpQuick.dir, t.min)} <b class="text-slate-800">${fmt(egpPerThousand(egpRateFromPct(egpQuick.dir, screen, t.pct), usdRate, 'ILS'))} ₪</b>`).join(' · ')}</span>`
        : '';
    const prices = `
        <div class="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[11px] text-slate-500 border-t border-slate-100 pt-2">
            <span>سعر الألف جنيه للزبون: <b class="text-slate-800">${fmt(egpPerThousand(fIls?.rate || rate, usdRate, 'ILS'))} ₪</b> · <b class="text-slate-800">${fmt(egpPerThousand(fUsd?.rate || rate, 0, 'USD'))} $</b></span>
            <span class="profit-only">نسبتنا ${pcts} · الألف بالسوق ${fmt(egpPerThousand(screen, usdRate, 'ILS'))} ₪</span>
            ${tierPrices}
        </div>`;
    if (!q.amount) {
        $('egpq-result').innerHTML = `<div class="text-sm text-slate-400 py-2">اكتب المبلغ لتشوف السعر</div>${prices}`;
        return;
    }
    const head = (html) => `<div class="text-sm text-slate-600">${html}</div>`;
    let body;
    if (egpQuick.unit === 'EGP') {
        const rounded = (r, cur) => (Math.abs(r.gross - r.total) > 0.004 ? `قبل التقريب ${moneyCur(r.gross, cur)}` : '');
        body = head(send ? `عشان يوصل <b class="text-slate-900">${fmtEgp(q.egp)} جنيه</b>، الزبون بيدفع:` : `لما يوصلنا <b class="text-slate-900">${fmtEgp(q.egp)} جنيه</b>، بنعطي الزبون:`)
            + `<div class="grid grid-cols-2 gap-2">
                ${egpQuickTile(send, 'بالشيكل', moneyCur(q.ils.total, 'ILS'), rounded(q.ils, 'ILS'), q.ils.profitIls, egpTierNote(q.fi))}
                ${egpQuickTile(send, 'أو بالدولار', moneyCur(q.usd.total, 'USD'), rounded(q.usd, 'USD'), q.usd.profitIls, egpTierNote(q.fu))}
            </div>`;
    } else if (!(q.egp > 0)) {
        body = '<div class="tm-preview text-amber-700 font-bold">المبلغ قليل، ما بيكفي لأي جنيه</div>';
    } else {
        body = head(send ? `الزبون بيدفع <b class="text-slate-900">${moneyCur(q.amount, q.cur)}</b>، فبيوصله:` : `عشان ياخذ <b class="text-slate-900">${moneyCur(q.amount, q.cur)}</b>، لازم يبعتلنا:`)
            + egpQuickTile(send, send ? 'الجنيه اللي بيوصل' : 'الجنيه اللي لازم يوصلنا', `${fmtEgp(q.egp)} جنيه`, 'مقرّب لجنيه صحيح لصالحنا', q.money.profitIls, egpTierNote(q.f));
    }
    $('egpq-result').innerHTML = body + prices;
}

// بلاطة نتيجة: العنوان، المبلغ كبير، وتحته التقريب والربح. الإرسال بلون الإرسال والاستقبال بلونه
function egpQuickTile(send, label, value, sub, profit, note = '') {
    return `
        <div class="rounded-xl border p-3 ${send ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}">
            <span class="block text-[11px] font-bold ${send ? 'text-rose-700' : 'text-emerald-700'}">${label}</span>
            <b class="block text-2xl font-black text-slate-900 num leading-tight mt-0.5">${value}</b>
            ${sub ? `<span class="block text-[11px] text-slate-500 mt-1">${sub}</span>` : ''}
            <span class="block text-[11px] font-bold text-slate-600 mt-0.5 profit-only">ربحنا ${fmt(profit)} ₪</span>
            ${note}
        </div>`;
}

function recordEgpQuote() {
    const amount = toNum($('egpq_amount').value, 0);
    if (!openEgpModal(egpQuick.dir)) return;
    if (!(amount > 0)) return;
    if (egpQuick.unit === 'EGP') {
        $('eg_egp').value = amount;
    } else {
        setEgpCurrency(egpQuick.unit);
        $('eg_money').value = amount;
    }
    updateEgpPreview();
}

// ---------- اختيار الزبون (نفس قائمة الحاسبة) ----------
function updateEgpCustomerStatus() {
    const q = normName($('eg_customer').value);
    const linked = customers.find(c => c.id === $('eg_customer_id').value);
    if (linked && normName(linked.name) !== q) $('eg_customer_id').value = '';
    const known = customers.find(c => c.id === $('eg_customer_id').value) || customers.find(c => normName(c.name) === q);
    $('eg_customer_status').textContent = known ? '✓ زبون مسجل' : q ? '+ زبون جديد' : '';
    $('eg_customer_status').className = 'text-[10px] font-bold ' + (known ? 'text-emerald-600' : 'text-blue-600');
    const trade = ['send', 'receive'].includes($('eg_kind').value);
    updateCustomerPhoneField('eg', known, trade ? q : '');
    syncNewPayoutField('eg', !known && !!q && $('eg_kind').value === 'receive');
    renderEgpBlackNote();
}

// القائمة السوداء: اسم الزبون واسم المستلم/المرسل، والجوال ورقم فودافون/انستا والرقم المحفوظ للزبون
function egpBlackHit() {
    if (!['send', 'receive'].includes($('eg_kind').value)) return null;
    const name = $('eg_customer').value;
    const known = customers.find(c => c.id === $('eg_customer_id').value) || customers.find(c => normName(c.name) === normName(name));
    const numbers = [$('eg_phone').value, $('eg_np_account').value, $('eg_party_number').value, known?.phone, known?.account, known?.bankAccount, known?.iban];
    return blacklistHit({ name, numbers }) || blacklistHit({ name: $('eg_party').value });
}

function renderEgpBlackNote() {
    const hit = egpBlackHit();
    $('eg_black_note').classList.toggle('hidden', !hit);
    if (hit) $('eg_black_note').textContent = blackNoteText(hit);
}

function onEgpCustomerInput() {
    updateEgpCustomerStatus();
    egpPickerIndex = -1;
    $('eg-customer-dropdown').innerHTML = customerPickerHtml($('eg_customer').value.trim(), 'egp-select-customer');
    $('eg-customer-dropdown').classList.remove('hidden');
}

function closeEgpCustomerPicker() {
    $('eg-customer-dropdown').classList.add('hidden');
}

function selectEgpCustomer(id) {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    $('eg_customer').value = c.name;
    $('eg_customer_id').value = c.id;
    $('eg_phone').value = '';
    updateEgpCustomerStatus();
    closeEgpCustomerPicker();
    $('eg_egp').focus();
}

function onEgpCustomerKey(e) {
    egpPickerIndex = pickerKeyNav(e, $('eg-customer-dropdown'), egpPickerIndex, selectEgpCustomer, closeEgpCustomerPicker);
}

// ---------- نموذج حركة الجنيه ----------
const egpWalletOptions = (selected = '') => sortedEgpWallets()
    .map(w => `<option value="${escapeHtml(w.id)}" ${w.id === selected ? 'selected' : ''}>${escapeHtml(egpWalletName(w))}</option>`).join('');

// يرجع false إذا ما انفتحت النافذة
function openEgpModal(kind = 'send', m = null) {
    if (!egpReady()) return false;
    if (!egpWallets.length) {
        showToast('ما في محافظ جنيه', 'أضف محفظة (فودافون كاش أو انستا باي) أولاً', 'warning');
        return false;
    }
    editingEgpId = m ? m.id : null;
    egpPctTouched = false;
    $('egpModalTitle').textContent = m ? `تعديل حركة جنيه ${receiptNo(m)}` : 'حركة جنيه جديدة';
    setHistoryButton('eg_history', m?.id);
    const firstWallet = sortedEgpWallets()[0].id;
    $('eg_wallet').innerHTML = egpWalletOptions(m ? m.walletId : egpWalletFilter || firstWallet);
    $('eg_to_wallet').innerHTML = egpWalletOptions(m?.toWalletId || '');
    $('eg_customer').value = m ? m.customerName : '';
    $('eg_customer_id').value = m ? m.customerId : '';
    $('eg_phone').value = '';
    $('eg_party').value = m ? m.party : '';
    $('eg_party_number').value = m ? m.partyNumber : '';
    $('eg_egp').value = m ? Math.abs(m.egp) || '' : '';
    $('eg_money').value = m && m.fixedTotal ? m.fixedTotal : '';
    $('eg_final_adjust').value = m && m.finalAdjust ? m.finalAdjust : '';
    $('eg_total').value = m && m.kind === 'topup' ? m.total || '' : '';
    $('eg_fee').value = m && m.fee ? m.fee : '';
    $('eg_note').value = m ? m.note : '';
    $('eg_date').value = m ? m.date : localDateStr();
    $('eg_currency').value = m ? m.currency : 'ILS';
    const dir = m ? (m.kind === 'transfer' ? 'transfer' : m.egp < 0 ? 'out' : 'in') : 'in';
    egpPartyOpen = !!(m && (m.party || m.partyNumber));
    setEgpKind(m ? (m.kind === 'transfer' ? 'adjust' : m.kind) : kind, { keepValues: !!m, dir });
    if (m && (m.kind === 'send' || m.kind === 'receive')) {
        $('eg_pct').value = egpPctOf(m.kind, m.screen, m.rate);
        $('eg_usd_rate').value = m.usdRate;
    }
    closeEgpCustomerPicker();
    updateEgpPreview();
    openModal('egpModal');
    const trade = m ? m.kind === 'send' || m.kind === 'receive' : kind === 'send' || kind === 'receive';
    $(trade && !m ? 'eg_customer' : 'eg_egp').focus();
    return true;
}

function openEgpTransfer() {
    if (egpWallets.length < 2) return showToast('بدك محفظتين', 'أضف محفظة ثانية لتحوّل بينهم', 'warning');
    if (!openEgpModal('adjust')) return;
    $('eg_dir').value = 'transfer';
    const from = $('eg_wallet').value;
    const other = sortedEgpWallets().find(w => w.id !== from);
    if (other) $('eg_to_wallet').value = other.id;
    syncEgpDirFields();
    updateEgpPreview();
}

const EGP_DIR_OPTIONS = {
    topup: [['in', 'شراء جنيه (يدخل المحفظة)'], ['out', 'بيع جنيه (يطلع من المحفظة)']],
    adjust: [['in', 'إضافة للرصيد'], ['out', 'خصم من الرصيد'], ['transfer', 'تحويل لمحفظة ثانية']]
};

function setEgpKind(kind, { keepValues = false, dir = $('eg_dir').value } = {}) {
    $('eg_kind').value = kind;
    document.querySelectorAll('#eg_kinds [data-kind]').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
    const trade = kind === 'send' || kind === 'receive';
    $('eg_customer_wrap').classList.toggle('hidden', !trade);
    // الصفوف كاملة تختفي للتعديل، والشحن/البيع يظهر له اسم الجهة والعملة فقط
    syncEgpPartyFields();
    $('eg_party_number_wrap').classList.toggle('hidden', !trade);
    $('eg_rates_row').classList.toggle('hidden', !(trade || kind === 'topup'));
    $('eg_trade_fields').classList.toggle('hidden', !trade);
    $('eg_money_wrap').classList.toggle('hidden', !trade);
    $('eg_final_adjust_wrap').classList.toggle('hidden', !trade);
    $('eg_total_wrap').classList.toggle('hidden', kind !== 'topup');
    $('eg_dir_wrap').classList.toggle('hidden', !EGP_DIR_OPTIONS[kind]);
    if (EGP_DIR_OPTIONS[kind]) {
        $('eg_dir').innerHTML = EGP_DIR_OPTIONS[kind].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
        $('eg_dir').value = EGP_DIR_OPTIONS[kind].some(([v]) => v === dir) ? dir : 'in';
    }
    $('eg_party_label').textContent = kind === 'send' ? 'اسم المستلم (اختياري)' : kind === 'receive' ? 'اسم المرسل (اختياري)' : 'من مين؟ تاجر أو صراف (اختياري)';
    $('eg_party_number_label').textContent = kind === 'send' ? 'رقم فودافون / عنوان انستا باي للمستلم (اختياري)' : 'رقم المرسل (اختياري)';
    $('eg_amount_label').textContent = kind === 'send' ? 'المبلغ اللي بيوصل (جنيه)' : kind === 'receive' ? 'المبلغ اللي وصلنا (جنيه)' : 'المبلغ بالجنيه';
    $('eg_pct_label').textContent = kind === 'send' ? 'نسبة الإرسال %' : 'نسبة الاستقبال %';
    $('eg_usd_label').textContent = kind === 'send' ? 'سعر شراء الدولار ₪' : 'سعر صرف الدولار ₪';
    if (!keepValues && trade) {
        const r = egpRates();
        $('eg_pct').value = kind === 'send' ? r.sendPct : r.receivePct;
        $('eg_usd_rate').value = kind === 'send' ? r.usdSend : r.usdReceive;
        $('eg_final_adjust').value = '';
        egpPctTouched = false;
    }
    updateEgpCustomerStatus();
    syncEgpDirFields();
    setEgpCurrency($('eg_currency').value);
}

// اسم ورقم المستلم/المرسل خلف زر "+"
let egpPartyOpen = false;

function syncEgpPartyFields() {
    const kind = $('eg_kind').value;
    const allowed = kind === 'send' || kind === 'receive' || kind === 'topup';
    $('eg_party_fields').classList.toggle('hidden', !(allowed && egpPartyOpen));
    $('eg_party_toggle').classList.toggle('hidden', !allowed || egpPartyOpen);
    $('eg_party_toggle').textContent = kind === 'send' ? '+ بيانات المستلم (الاسم والرقم)' : kind === 'receive' ? '+ بيانات المرسل (الاسم والرقم)' : '+ من مين؟ (تاجر أو صراف)';
}

function setEgpPartyOpen(open) {
    egpPartyOpen = open;
    syncEgpPartyFields();
    if (open) $('eg_party').focus();
}

function openEgpRatesModal() {
    renderEgpRates();
    openModal('egpRatesModal');
}

// المحفظة الثانية والرسوم حسب النوع والاتجاه
function syncEgpDirFields() {
    const kind = $('eg_kind').value;
    const transfer = kind === 'adjust' && $('eg_dir').value === 'transfer';
    $('eg_to_wrap').classList.toggle('hidden', !transfer);
    $('eg_fee_wrap').classList.toggle('hidden', !(kind === 'send' || transfer));
    $('eg_wallet_label').textContent = kind === 'send' ? 'نبعت من محفظة' : kind === 'receive' ? 'وصل على محفظة' : transfer ? 'من محفظة' : 'المحفظة';
    const sold = kind === 'topup' && $('eg_dir').value === 'out';
    $('eg_total_label').textContent = sold ? 'المبلغ اللي قبضته' : 'المبلغ اللي دفعته';
}

function setEgpCurrency(cur) {
    $('eg_currency').value = cur;
    document.querySelectorAll('#eg_currencies [data-cur]').forEach(b => b.classList.toggle('active', b.dataset.cur === cur));
    const word = cur === 'USD' ? 'بالدولار' : 'بالشيكل';
    $('eg_money_label').textContent = $('eg_kind').value === 'receive' ? `أو اللي بدّه ياخذه ${word}` : `أو اللي بدّه يدفعه ${word}`;
    updateEgpPreview();
}

function readEgpForm() {
    const kind = $('eg_kind').value;
    const dir = $('eg_dir').value;
    const existing = egpMoves.find(m => m.id === editingEgpId);
    const realKind = kind === 'adjust' && dir === 'transfer' ? 'transfer' : kind;
    const trade = realKind === 'send' || realKind === 'receive';
    const amount = Math.abs(toNum($('eg_egp').value, 0));
    // الحركة القديمة تحتفظ بشاشتها، والجديدة بالشاشة الحالية
    const screen = trade ? (existing?.screen || egpScreen()) : 0;
    const pct = toNum($('eg_pct').value, 0);
    let rate = trade && pct >= 0 && pct <= EGP_MAX_PCT ? egpRateFromPct(realKind, screen, pct) : 0;
    // تعديل حركة بدون تغيير نسبتها: نفس سعرها المحفوظ بالضبط
    if (trade && existing?.kind === realKind && existing.rate > 0 && pct === egpPctOf(existing.kind, existing.screen, existing.rate)) rate = existing.rate;
    return {
        kind: realKind,
        egp: (realKind === 'adjust' || realKind === 'topup') && dir === 'out' ? -amount : amount,
        walletId: $('eg_wallet').value,
        toWalletId: realKind === 'transfer' ? $('eg_to_wallet').value : '',
        fee: realKind === 'send' || realKind === 'transfer' ? Math.max(0, toNum($('eg_fee').value, 0)) : 0,
        rate,
        pct,
        screen,
        usdRate: trade ? toNum($('eg_usd_rate').value, 0) : toNum(globalConfig.screenRate, 0),
        currency: $('eg_currency').value,
        fixedTotal: trade ? Math.max(0, toNum($('eg_money').value, 0)) : 0,
        finalAdjust: trade && !(toNum($('eg_money').value, 0) > 0) ? readFinalAdjust('eg') : 0,
        total: realKind === 'topup' ? Math.max(0, toNum($('eg_total').value, 0)) : 0,
        settle: existing ? existing.settle : 0
    };
}

// الفورم بنسبة الشريحة (حركة جديدة وما انكتبت النسبة بإيد)، وبعدها الجنيه من المبلغ المتفق عليه (إن كُتب)
function resolvedEgpForm() {
    let f = readEgpForm();
    const trade = f.kind === 'send' || f.kind === 'receive';
    const autoPct = trade && !egpPctTouched && !editingEgpId;
    if (autoPct) f = withEgpTier(f);
    f.autoPct = autoPct;
    if (f.fixedTotal > 0) f.egp = egpForMoney(f);
    return f;
}

// المبلغ المتفق عليه: الجنيه مقرّب لجنيه صحيح، والفرق لصالحنا
function egpFixedNote(f, r) {
    if (!(f.fixedTotal > 0)) return '';
    if (!(f.egp > 0)) return '<div class="text-amber-700 font-bold">المبلغ قليل، ما بيكفي لأي جنيه</div>';
    const diff = f.kind === 'send' ? r.total - r.gross : r.gross - r.total;
    return `<div class="flex justify-between text-emerald-700"><span>تقريب الجنيه لـ ${fmtEgp(f.egp)} (لصالحنا)</span><b>+ ${moneyCur(Math.max(0, round2(diff)), f.currency)}</b></div>`;
}

function updateEgpPreview() {
    const f = resolvedEgpForm();
    if (f.fixedTotal > 0) $('eg_egp').value = f.egp || '';
    if (f.autoPct) $('eg_pct').value = f.pct;
    if (f.kind === 'send' || f.kind === 'receive') {
        $('eg_pct_label').textContent = (f.kind === 'send' ? 'نسبة الإرسال %' : 'نسبة الاستقبال %') + (f.autoPct && egpTiers(f.kind).length > 1 ? ' · حسب الشريحة' : '');
    }
    const r = computeEgp(f);
    const cur = f.currency;
    const bal = egpWalletBalances();
    // رصيد المحفظة بعد الحركة (عند التعديل نشيل أثرها القديم أولاً)
    const existing = egpMoves.find(m => m.id === editingEgpId);
    const after = (id) => round2((bal[id] || 0) - (existing ? egpEffectOn(existing, id) : 0) + egpEffectOn({ ...f, ...r }, id));
    const walletName = (id) => escapeHtml(egpWalletName(egpWallets.find(w => w.id === id)));
    const signed = (v) => `${v >= 0 ? '+' : '−'}${fmtEgp(Math.abs(v))}`;
    let lines;
    if (f.kind === 'send' || f.kind === 'receive') {
        const send = f.kind === 'send';
        syncFinalAdjustField('eg', send ? 1 : -1, f.fixedTotal > 0);
        if (!(f.rate > 0) || !(f.screen > 0)) {
            $('eg_preview').innerHTML = `<div class="text-amber-700 font-bold">${f.screen > 0 ? `النسبة لازم تكون بين 0 و ${EGP_MAX_PCT}%` : 'ما في شاشة للجنيه — ثبّت شاشة الجنيه من كرت أسعار الجنيه'}</div>`;
            return;
        }
        const k = cur === 'USD' ? 1 : f.usdRate;
        const market = f.egp / f.screen * k;
        const original = egpPerThousand(f.screen, f.usdRate, cur);
        lines = `
            <div class="flex justify-between profit-only"><span>${fmtEgp(f.egp)} جنيه بسعر السوق</span><b>${moneyCur(market, cur)}</b></div>
            <div class="flex justify-between"><span>${send ? `بسعرنا (جنيه أقل من السوق بـ ${fmt(f.pct)}%)` : `بسعرنا (ناقص ${fmt(f.pct)}%)`}</span><b>${moneyCur(r.gross, cur)}</b></div>
            ${f.autoPct ? egpTierNote(f) : ''}
            ${egpFixedNote(f, r)}
            ${finalAdjustLine(f.finalAdjust, cur, send ? 1 : -1, cur === 'USD' ? f.usdRate : 1)}
            <div class="flex justify-between text-base mt-1 pt-1 border-t border-slate-200"><span class="font-bold">${send ? 'المطلوب من الزبون' : 'ندفع للزبون'}</span><b class="text-slate-900">${moneyCur(r.total, cur)}</b></div>
            <div class="flex justify-between text-[11px] text-slate-500"><span>${walletName(f.walletId)}: ${signed(r.egpEffect)} جنيه${f.fee ? ` (منها رسوم ${fmtEgp(f.fee)})` : ''} ← ${fmtEgp(after(f.walletId))}</span><span class="profit-only">الربح ${fmt(r.profitIls)} ₪</span></div>
            <div class="flex justify-between text-[11px] text-slate-500"><span>سعر الألف جنيه للزبون: ${fmt(egpPerThousand(f.rate, f.usdRate, cur))} ${CUR_SYM[cur]}</span><span class="profit-only">السوق ${fmt(original)} ${CUR_SYM[cur]} (شاشة ${fmt(f.screen)}${cur === 'ILS' ? ` · ${send ? 'شراء' : 'صرف'} ${fmt(f.usdRate, 3)}` : ''})</span></div>`;
    } else if (f.kind === 'topup') {
        const usdTotal = cur === 'USD' ? f.total : f.usdRate > 0 ? f.total / f.usdRate : 0;
        const implied = usdTotal > 0 ? Math.abs(f.egp) / usdTotal : 0;
        lines = `
            <div class="flex justify-between"><span>${f.egp >= 0 ? 'اشتريت' : 'بعت'} ${fmtEgp(Math.abs(f.egp))} جنيه ${f.egp >= 0 ? 'ودفعت' : 'وقبضت'}</span><b>${moneyCur(f.total, cur)}</b></div>
            ${implied ? `<div class="flex justify-between text-[11px] text-slate-500"><span>يعني تقريباً</span><span>${fmt(implied)} جنيه للدولار${egpScreen() ? ` (الشاشة ${fmt(egpScreen())})` : ''}</span></div>` : ''}
            <div class="flex justify-between text-[11px] text-slate-500"><span>${walletName(f.walletId)}: ${signed(r.egpEffect)} جنيه ← ${fmtEgp(after(f.walletId))}</span><span>بدون ربح</span></div>`;
    } else if (f.kind === 'transfer') {
        lines = `
            <div class="flex justify-between"><span>من ${walletName(f.walletId)}</span><b>−${fmtEgp(f.egp + f.fee)} ← ${fmtEgp(after(f.walletId))}</b></div>
            <div class="flex justify-between"><span>إلى ${walletName(f.toWalletId)}</span><b>+${fmtEgp(f.egp)} ← ${fmtEgp(after(f.toWalletId))}</b></div>
            ${f.fee ? `<div class="text-[11px] text-slate-500">رسوم التحويل ${fmtEgp(f.fee)} جنيه بتنقص من الرصيد</div>` : ''}`;
    } else {
        lines = `<div class="flex justify-between"><span>${walletName(f.walletId)}: ${signed(r.egpEffect)} جنيه</span><b>يصبح ${fmtEgp(after(f.walletId))}</b></div>`;
    }
    $('eg_preview').innerHTML = lines;
}

// نفس الحركة انسجلت قبل شوي؟ (زي USDT recentSameUsdt): نفس النوع والزبون (أو المحفظة بلا زبون) والجنيه والعملة خلال دقيقتين
function recentSameEgp(f, customerId, name, trade) {
    const now = Date.now();
    return latestById(egpMoves.filter(m => now - m.id < SAME_MOVE_MS && m.id <= now && m.kind === f.kind && m.currency === f.currency
        && Math.abs(Math.abs(m.egp) - Math.abs(f.egp)) < 0.005
        && (trade ? (customerId && m.customerId ? m.customerId === customerId : normName(m.customerName) === normName(name)) : m.walletId === f.walletId)));
}

async function saveEgp(e, sameOk = false, blackOk = false) {
    e.preventDefault();
    if (!egpReady()) return;
    const f = resolvedEgpForm();
    const trade = f.kind === 'send' || f.kind === 'receive';
    const warn = (msg, focusId) => {
        if (focusId) $(focusId).focus();
        showToast('تنبيه', msg, 'warning');
    };
    if (!(Math.abs(f.egp) > 0)) return warn('اكتب المبلغ بالجنيه', 'eg_egp');
    if (!egpWallets.some(w => w.id === f.walletId)) return warn('اختر المحفظة');
    if (f.kind === 'transfer' && (!f.toWalletId || f.toWalletId === f.walletId)) return warn('اختر محفظتين مختلفتين');
    const name = $('eg_customer').value.trim();
    if (trade && !name) return warn('اكتب اسم الزبون', 'eg_customer');
    if (trade && !(f.screen > 0)) return warn('ما في شاشة للجنيه، ثبّتها من كرت أسعار الجنيه');
    if (trade && !(f.rate > 0)) return warn(`النسبة لازم تكون بين 0 و ${EGP_MAX_PCT}%`, 'eg_pct');
    if (trade && f.currency === 'ILS' && !(f.usdRate > 0)) return warn('سعر الدولار غير صحيح', 'eg_usd_rate');
    // رقم المستلم بالإرسال اختياري (بطلب عماد 2026-10-16)
    if (f.kind === 'topup' && !(f.total > 0)) return warn('اكتب المبلغ اللي دفعته أو قبضته', 'eg_total');
    if (!editingEgpId && !blackOk) {
        const hit = egpBlackHit();
        if (hit) return checkBlacklistThen(hit, () => saveEgp({ preventDefault() {} }, sameOk, true));
    }
    if (!editingEgpId && !sameOk) {
        const known = trade ? customers.find(c => c.id === $('eg_customer_id').value) || customers.find(c => normName(c.name) === normName(name)) : null;
        const same = recentSameEgp(f, known?.id || '', name, trade);
        if (same) {
            showAppConfirm('هاي الحركة انسجلت قبل شوي',
                `${EGP_KINDS[same.kind].replace(/\s*جنيه$/, '')} ${fmtTrim(Math.abs(same.egp))} جنيه${same.customerName ? ' · ' + same.customerName : ''} ${receiptNo(same)} انسجلت قبل ${sameMoveAgo(same)}. بدك تسجلها كمان مرة؟`,
                () => saveEgp({ preventDefault() {} }, true, blackOk));
            return;
        }
    }
    const existing = egpMoves.find(m => m.id === editingEgpId);
    // الزبون المختار من القائمة، أو بنفس الاسم، أو زبون جديد (مثل الحاسبة و USDT)
    const ops = [];
    let customer = null;
    if (trade) {
        customer = customers.find(c => c.id === $('eg_customer_id').value) || customers.find(c => normName(c.name) === normName(name));
        const phone = readCustomerPhone('eg', customer?.id);
        if (phone === null) return;
        if (!customer) {
            customer = normalizeCustomer({ id: newCustomerId(), name, phone, payout: 'كاش', provider: '', account: '', ...readNewPayout('eg'), createdAt: $('eg_date').value || localDateStr() });
            customers.unshift(customer);
            ops.push({ action: 'upsert_customer', customer });
        } else if (phone) {
            customer.phone = phone;
            ops.push({ action: 'upsert_customer', customer });
        }
    }
    const move = normalizeEgp({
        ...f,
        id: existing ? existing.id : nextId(),
        date: $('eg_date').value || localDateStr(),
        customerId: customer ? customer.id : '',
        customerName: customer ? customer.name : '',
        walletName: egpWalletName(egpWallets.find(w => w.id === f.walletId)),
        party: trade || f.kind === 'topup' ? $('eg_party').value.trim() : '',
        partyNumber: trade ? $('eg_party_number').value.trim() : '',
        note: $('eg_note').value,
        settle: existing ? existing.settle : 0
    });
    if (editLocked('egpMoves', existing && { ...existing }, move)) return lockWarn();
    if (existing) move.serial = existing.serial;
    if (existing) Object.assign(existing, move); else egpMoves.push(move);
    const noteOps = existing ? relinkNotesOps('egp', move.id, egpPayNote(move), isEgpPayNote) : [];
    queueOps(...ops, { action: 'upsert_egp', move }, ...noteOps);
    closeModal('egpModal');
    renderCustomersTable();
    renderEgpPage();
    if (noteOps.length) renderAccountsPage();
    updateReportsData();
    const bal = egpWalletBalances();
    const negative = [move.walletId, move.toWalletId].filter(Boolean).map(id => egpWallets.find(w => w.id === id)).filter(w => w && (bal[w.id] || 0) < 0);
    const status = await flushOutbox();
    showToast(existing ? 'تم تعديل الحركة' : 'تم حفظ الحركة', `${EGP_KINDS[move.kind]} ${fmtEgp(Math.abs(move.egp))} جنيه — ${syncResultMessage(status)}`, syncToastType(status));
    if (negative.length) showToast('انتبه: رصيد سالب', negative.map(egpWalletName).join('، '), 'warning');
    // الإيصال ما بيفتح لحاله (بطلب عماد): بينفتح من المبلغ بالسطر أو زر "فاتورة"
}

function openEgpPay(id) {
    const m = egpMoves.find(x => x.id === id);
    const st = m && egpPayState(m);
    if (!st || !walletsReady()) return;
    const titles = {
        send: `استلام دفعة إرسال جنيه ${receiptNo(m)}`,
        receive: `دفع استقبال جنيه ${receiptNo(m)}`,
        topup: st.dir < 0 ? `دفع ثمن شراء جنيه #${m.id}` : `استلام ثمن بيع جنيه #${m.id}`
    };
    const who = egpPayWho(m);
    openPayModal({
        title: titles[m.kind],
        subtitle: `${who} · ${fmtEgp(Math.abs(m.egp))} جنيه`,
        currency: m.currency,
        due: round2(m.total - m.settle),
        paid: st.paid,
        dir: st.dir,
        onSave: async (lines, settle) => {
            if (settle && dayLocked(m.date)) return lockWarn();
            const moves = lines.map(l => makeAmove({ accountId: l.accountId, currency: m.currency, amount: st.dir * l.amount, reason: 'egp', refType: 'egp', refId: m.id, note: egpPayNote(m) }));
            accountMoves.push(...moves);
            const ops = amoveOps(moves);
            if (settle) {
                Object.assign(m, normalizeEgp({ ...m, settle: round2(m.settle + settle) }));
                ops.push({ action: 'upsert_egp', move: m });
            }
            queueOps(...ops);
            renderEgpPage();
            renderAccountsPage();
            updateReportsData();
            if (st.dir < 0) warnNegative(lines, m.currency);
            const status = await flushOutbox();
            const after = egpPayState(m);
            showToast(after.state === 'paid' ? 'الحركة مدفوعة بالكامل ✓' : 'تم تسجيل الدفعة', `${who}${after.remaining ? ` · الباقي ${moneyCur(after.remaining, m.currency)}` : ''}${settle ? ` · فرق مُسوّى ${moneyCur(settle, m.currency)}` : ''} — ${syncResultMessage(status)}`, syncToastType(status));
        }
    });
}

function deleteEgpPrompt(id) {
    const m = egpMoves.find(x => x.id === id);
    if (!m) return;
    const moves = refMoves('egp', m.id);
    if (dayLocked(m.date) || moves.some(x => dayLocked(x.date))) return lockWarn();
    const extra = moves.length ? ` وستُحذف ${moves.length} دفعة مرتبطة بها من الحسابات` : '';
    showAppConfirm('حذف حركة جنيه', `حذف ${EGP_KINDS[m.kind]} ${fmtEgp(Math.abs(m.egp))} جنيه${m.customerName ? ' لـ ' + m.customerName : ''}؟${extra}`, async () => {
        egpMoves = egpMoves.filter(x => x.id !== id);
        accountMoves = accountMoves.filter(x => !moves.includes(x));
        queueOps(...moves.map(x => ({ action: 'delete_amove', id: x.id })), { action: 'delete_egp', id });
        renderEgpPage();
        renderAccountsPage();
        updateReportsData();
        const status = await flushOutbox();
        showToast('تم الحذف', syncResultMessage(status), syncToastType(status));
    });
}

// ---------- محافظ الجنيه ----------
function openEgpWalletModal(w = null) {
    if (!egpReady()) return;
    editingEgpWalletId = w ? w.id : null;
    $('egpWalletModalTitle').textContent = w ? 'تعديل محفظة الجنيه' : 'محفظة جنيه جديدة';
    $('ew_type').value = w ? w.walletType : 'vodafone';
    $('ew_holder').value = w ? w.holder : '';
    $('ew_number').value = w ? w.number : '';
    $('ew_note').value = w ? w.note : '';
    $('ew_alert').value = w && w.alertBelow ? w.alertBelow : '';
    $('ew_alert').disabled = !sheetHas('alerts');
    $('ew_opening').value = '';
    $('ew_opening_wrap').classList.toggle('hidden', !!w);
    $('ew_delete').classList.toggle('hidden', !w);
    openModal('egpWalletModal');
    $('ew_holder').focus();
}

function newEgpWallet(fields) {
    return normalizeEgpWallet({
        id: 'e' + nextId(),
        order: egpWallets.reduce((m, w) => Math.max(m, w.order), -1) + 1,
        createdAt: localDateStr(),
        ...fields
    });
}

async function saveEgpWallet(e) {
    e.preventDefault();
    if (!egpReady()) return;
    const existing = egpWallets.find(w => w.id === editingEgpWalletId);
    const fields = { walletType: $('ew_type').value, holder: $('ew_holder').value, number: $('ew_number').value, note: $('ew_note').value, alertBelow: sheetHas('alerts') ? $('ew_alert').value : existing?.alertBelow };
    const wallet = existing ? normalizeEgpWallet({ ...existing, ...fields }) : newEgpWallet(fields);
    if (existing) Object.assign(existing, wallet); else egpWallets.push(wallet);
    const ops = [{ action: 'upsert_egp_wallet', wallet }];
    // الرصيد الحالي عند إضافة المحفظة = حركة تعديل أولى
    const opening = existing ? 0 : round2(toNum($('ew_opening').value, 0));
    if (opening) {
        const move = normalizeEgp({ id: nextId(), date: localDateStr(), kind: 'adjust', walletId: wallet.id, walletName: egpWalletName(wallet), egp: opening, note: 'رصيد افتتاحي' });
        egpMoves.push(move);
        ops.push({ action: 'upsert_egp', move });
    }
    queueOps(...ops);
    closeModal('egpWalletModal');
    renderEgpPage();
    const status = await flushOutbox();
    showToast(existing ? 'تم تعديل المحفظة' : 'تمت إضافة المحفظة', `${egpWalletName(wallet)} — ${syncResultMessage(status)}`, syncToastType(status));
}

function deleteEgpWalletPrompt() {
    const w = egpWallets.find(x => x.id === editingEgpWalletId);
    if (!w) return;
    if (egpMoves.some(m => m.walletId === w.id || m.toWalletId === w.id)) {
        return showToast('لا يمكن الحذف', 'على هذه المحفظة حركات. احذف حركاتها أولاً أو اتركها.', 'warning');
    }
    showAppConfirm('حذف المحفظة', `حذف "${egpWalletName(w)}"؟`, async () => {
        egpWallets = egpWallets.filter(x => x.id !== w.id);
        if (egpWalletFilter === w.id) egpWalletFilter = '';
        queueOps({ action: 'delete_egp_wallet', id: w.id });
        closeModal('egpWalletModal');
        renderEgpPage();
        const status = await flushOutbox();
        showToast('تم حذف المحفظة', syncResultMessage(status), syncToastType(status));
    });
}

// أول مرة: فودافون كاش وانستا باي بضغطة وحدة
async function createDefaultEgpWallets() {
    if (!egpReady() || egpWallets.length) return;
    const created = [newEgpWallet({ walletType: 'vodafone' })];
    created.push(newEgpWallet({ walletType: 'instapay', order: created[0].order + 1 }));
    egpWallets.push(...created);
    queueOps(...created.map(wallet => ({ action: 'upsert_egp_wallet', wallet })));
    renderEgpPage();
    const status = await flushOutbox();
    showToast('تمت إضافة المحافظ', `فودافون كاش وانستا باي — اكبس "تعديل" لتكتب اسم صاحبها ورقمها. ${syncResultMessage(status)}`, syncToastType(status));
}

// ================= الإعدادات: شرائح النسبة حسب المبلغ =================
// صف لكل شريحة: من كم شيكل، النسبة، أو سعر الألف جنيه للزبون (بتنحسب منه النسبة زي نافذة الأسعار).
// أول صف (من 0) هو النسبة الأساسية، وبيتعدّل من هون أو من "⚙️ الأسعار"
function renderEgpTierSettings() {
    const r = egpRates();
    const ready = r.screen > 0 && r.usdSend > 0 && r.usdReceive > 0;
    ['send', 'receive'].forEach(kind => {
        const usd = kind === 'send' ? r.usdSend : r.usdReceive;
        $(`egp-${kind}-tiers`).innerHTML = egpTiers(kind).map((t, i) => `
            <div class="flex flex-wrap gap-2 items-center text-xs">
                <span class="text-slate-500">من</span>
                <input type="text" inputmode="decimal" autocomplete="off" data-commas data-egp-tier="${kind}" data-index="${i}" data-field="min" value="${formatThousands(t.min)}" ${i === 0 ? 'disabled' : ''} aria-label="من مبلغ بالشيكل" class="w-24 border border-slate-200 rounded-lg p-2 bg-white font-mono disabled:bg-slate-50">
                <span class="text-slate-500">₪ فما فوق ←</span>
                <input type="number" step="0.01" min="0" max="${EGP_MAX_PCT}" data-egp-tier="${kind}" data-index="${i}" data-field="pct" value="${t.pct}" aria-label="النسبة %" class="w-20 border border-slate-200 rounded-lg p-2 bg-white font-bold">
                <span class="text-slate-500">% أو الألف</span>
                <input type="number" step="0.01" min="0" data-egp-tier="${kind}" data-index="${i}" data-field="price" value="${ready ? egpPerThousand(egpRateFromPct(kind, r.screen, t.pct), usd, 'ILS') : ''}" ${ready ? '' : 'disabled'} aria-label="سعر الألف جنيه للزبون بالشيكل" class="w-24 border border-slate-200 rounded-lg p-2 bg-white font-mono disabled:bg-slate-50">
                <span class="text-slate-500">₪</span>
                ${i > 0 ? `<button type="button" data-action="egp-tier-remove" data-kind="${kind}" data-index="${i}" class="text-slate-400 hover:text-red-600 px-2 font-bold" aria-label="حذف الشريحة">✕</button>` : ''}
            </div>`).join('');
    });
    $('egp-tiers-market').textContent = ready
        ? `سعر الألف محسوب على الأسعار هلّق (شاشة الجنيه ${fmt(r.screen)} · شراء الدولار ${fmt(r.usdSend, 3)} · صرف ${fmt(r.usdReceive, 3)}). النسبة هي اللي بتنحفظ، فسعر الألف بيتغير مع الشاشة.`
        : 'ما في شاشة للجنيه بعد، فسعر الألف ما بينحسب (النسبة بتشتغل عادي).';
}

function onEgpTierInput(el) {
    const kind = el.dataset.egpTier;
    if (!EGP_TIER_KEYS[kind]) return;
    const i = toNum(el.dataset.index, -1);
    const tiers = egpTiers(kind);
    const t = tiers[i];
    if (!t) return;
    const v = toNum(el.value, NaN);
    const bad = (msg) => { showToast('تنبيه', msg, 'warning'); renderEgpTierSettings(); };
    if (el.dataset.field === 'min') {
        if (!(v > 0)) return bad('حد الشريحة لازم يكون أكبر من صفر');
        if (tiers.some((x, k) => k !== i && Math.abs(x.min - v) < 0.005)) return bad('في شريحة ثانية بنفس المبلغ');
        t.min = round2(v);
    } else {
        let pct = v;
        if (el.dataset.field === 'price') {
            const r = egpRates();
            const usd = kind === 'send' ? r.usdSend : r.usdReceive;
            if (!(r.screen > 0) || !(usd > 0) || !(v > 0)) return renderEgpTierSettings();
            const market = 1000 / r.screen * usd;
            pct = kind === 'send' ? (1 - market / v) * 100 : (1 - v / market) * 100;
        }
        if (!Number.isFinite(pct) || pct < 0 || pct > EGP_MAX_PCT) return bad(`النسبة لازم تكون بين 0 و ${EGP_MAX_PCT}% (السعر ما بيكون أحسن من السوق)`);
        t.pct = round2(pct);
    }
    saveEgpTiers(kind, tiers);
}

// أول شريحة بتنحفظ بالنسبة الأساسية، والباقي مرتّب بالشرائح (إعدادات مشتركة بالشيت)
function saveEgpTiers(kind, tiers) {
    const [pctKey, tiersKey] = EGP_TIER_KEYS[kind];
    globalConfig[pctKey] = round2(tiers[0].pct);
    globalConfig[tiersKey] = tiers.slice(1).sort((a, b) => a.min - b.min).map(t => ({ min: t.min, pct: t.pct }));
    saveAll();
    renderEgpTierSettings();
    renderEgpRates();
    renderEgpQuick();
}

function addEgpTier(kind) {
    if (!EGP_TIER_KEYS[kind]) return;
    const tiers = egpTiers(kind);
    const last = tiers[tiers.length - 1];
    tiers.push({ min: last.min ? last.min + 400 : 400, pct: Math.max(0, round2(last.pct - 1)) });
    saveEgpTiers(kind, tiers);
}

function removeEgpTier(kind, i) {
    if (!EGP_TIER_KEYS[kind] || !(i > 0)) return;
    saveEgpTiers(kind, egpTiers(kind).filter((_, k) => k !== i));
}
