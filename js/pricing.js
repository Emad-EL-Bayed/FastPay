'use strict';

// فاست باي — حساب الأسعار (مصدر واحد للبرنامج ولصفحة الأسعار للزبائن prices.html، 2026-10-25)
// دوال صافية بتقرأ الإعدادات من globalConfig (بالبرنامج من core.js، وبالصفحة من رد السكربت prices).
// انتقلت هون زي ما هي من core/shell/calculator/usdt/egp: أي تعديل على الحساب هون بيوصل للاثنين.
// لازم تتحمّل قبل core.js (أدوات toNum/round2/fmt بتنستعمل وقت تحميله).

// القيم الافتراضية للأسعار (لما الإعداد مش بالشيت): البرنامج (DEFAULT_CONFIG بـ core.js) وصفحة الأسعار
const PRICE_DEFAULTS = {
    minusIls: 1.0,
    // سعر البيع والشراء: فرق شبه ثابت عن سعر الشاشة
    sellOffset: -0.01,
    buyOffset: 0.03,
    // USDT: نسبة الإيداع (أول شريحة) وشرائحها فوقها، الشبكات ورسومها، وشرائح نسبة السحب حسب المبلغ ($)
    usdtDepositPct: 1,
    usdtDepositTiers: [],
    usdtNetworks: [{ name: 'TRC20', fee: 1.3 }, { name: 'BEP20', fee: 0.15 }],
    usdtTiers: [{ min: 0, pct: 5 }, { min: 400, pct: 4 }, { min: 1000, pct: 3 }],
    // الجنيه: نسبتنا من السوق للإرسال والاستقبال، وشرائحها بالشيكل فوق أول شريحة
    egpSendPct: 13,
    egpReceivePct: 13,
    egpSendTiers: [],
    egpReceiveTiers: []
};

// ================= أدوات الأرقام وشرائح الدولة (من core.js) =================
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

// ---------- شرائح الدولة حسب المبلغ بالدولار (بطلب عماد 2026-10-22) ----------
// tiers = الشرائح بعد الأولى [{min $, cost, profit}]؛ الأولى (من 0) = costValue و profitPct.
// التكلفة بنوع تكلفة الدولة (نسبة أو ثابت $). بالشيت نص JSON بعمود "الشرائح" (نفس تنظيف السكربت cleanCountryTiers)
// (دالة مش const: normalizeCountry بتنادى وقت التحميل فوق بالملف)
function tierNum(v) {
    return Math.round(Math.max(0, toNum(v, 0)) * 10000) / 10000;
}

function normalizeCountryTiers(raw) {
    let list = raw;
    if (typeof raw === 'string') { try { list = JSON.parse(raw || '[]'); } catch (e) { list = []; } }
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
        .map(t => ({ min: tierNum(t?.min), cost: tierNum(t?.cost), profit: tierNum(t?.profit) }))
        .filter(t => t.min > 0 && !seen.has(t.min) && seen.add(t.min))
        .sort((a, b) => a.min - b.min)
        .slice(0, 20);
}

// كل الشرائح مع الأولى
const countryTierList = (c) => [{ min: 0, cost: c.costValue, profit: c.profitPct }, ...(c.tiers || [])];

// الشريحة اللي بيقع فيها المبلغ (الحد نفسه من الشريحة الجديدة: 100$ = "من 100")
function countryTierAt(c, usd) {
    const list = countryTierList(c);
    let idx = 0;
    list.forEach((t, i) => { if (usd + 1e-9 >= t.min) idx = i; });
    return { list, idx, tier: list[idx] };
}

// المبلغ بالدولار اللي بتنحسب عليه الشريحة: الخصم المباشر المبلغ أصلاً بالدولار، والباقي بعد المعامل
function sourceUsdAmount(type, orig, factor) {
    if (type === 'direct_percent') return Math.max(0, orig);
    if (type === 'mul') return Math.max(0, orig * factor);
    return factor > 0 ? Math.max(0, orig / factor) : 0;
}

// ================= سعر البيع والشراء (من shell.js) =================
// سعر البيع والشراء = سعر الشاشة + فرق ثابت. سعر البيع هو المعتمد في الحاسبة
function sellBuyRates(screen = globalConfig.screenRate, sellOffset = globalConfig.sellOffset, buyOffset = globalConfig.buyOffset) {
    return {
        sell: round3(toNum(screen) + toNum(sellOffset, 0)),
        buy: round3(toNum(screen) + toNum(buyOffset, 0))
    };
}

// ================= معادلة الحوالة (من calculator.js) =================
// ================= معادلة الحساب (مصدر واحد لكل الشاشات) =================
// currency: ILS يُسلَّم بالشيكل (مع الخصم الإضافي) | USD يُسلَّم بالدولار مباشرة (بدون خصم الشيكل)
// finalAdjust: تعديل ± يدوي على المسلّم بعد الحساب، بعملة التسليم (من نافذة تعديل الحوالة)، والربح بيتبعه
function computeTransfer({ orig, type, factor, costPct, profitPct, screenRate, minusIls, currency = 'ILS', costMode = 'pct', costFixed = 0, finalAdjust = 0 }) {
    let baseUsd;
    if (type === 'div') baseUsd = factor > 0 ? orig / factor : 0;
    else if (type === 'mul') baseUsd = orig * factor;
    else baseUsd = orig * (1 - factor / 100);
    baseUsd = Math.max(0, baseUsd);

    // التكلفة: نسبة من المبلغ، أو مبلغ ثابت بالدولار لا يتجاوز المبلغ نفسه
    const costUsd = costMode === 'fixed' ? Math.min(Math.max(0, costFixed), baseUsd) : baseUsd * (costPct / 100);
    const profitUsd = baseUsd * (profitPct / 100);
    const clientUsd = Math.max(0, baseUsd - costUsd - profitUsd);
    const grossIls = clientUsd * screenRate;
    // الخصم الإضافي لا يتجاوز المبلغ نفسه، ويذهب للربح (للتسليم بالشيكل فقط)
    const appliedMinus = currency === 'USD' ? 0 : (grossIls > 0 ? Math.min(Math.max(0, minusIls), grossIls) : 0);

    const usd = currency === 'USD';
    const clientIls = usd ? 0 : grossIls - appliedMinus;
    // التعديل ما بينزّل المسلّم تحت الصفر. بنعطيه أكثر = ربح أقل (بالدولار: × سعر الشاشة)
    const adj = Math.max(toNum(finalAdjust, 0), -(usd ? clientUsd : clientIls));

    return {
        baseUsd, costUsd, profitUsd, grossIls, appliedMinus,
        clientUsd: usd ? clientUsd + adj : clientUsd,
        clientIls: usd ? 0 : clientIls + adj,
        // الربح والتكلفة دائماً بالشيكل حتى تبقى التقارير بعملة واحدة
        profitIls: profitUsd * screenRate + appliedMinus - adj * (usd ? screenRate : 1),
        costIls: costUsd * screenRate,
        finalAdjust: adj
    };
}

// ================= USDT (من usdt.js) =================
// تقريب لأقرب نصف: الإيداع لفوق (لصالحنا) والسحب لتحت
const roundUpHalf = (v) => Math.ceil(round2(v) * 2 - 1e-9) / 2;

const roundDownHalf = (v) => Math.floor(round2(v) * 2 + 1e-9) / 2;

// الإيداع: (المبلغ + النسبة + الشبكة) × سعر الشراء − الخصم، ورصيد USDT ينقص المبلغ + الشبكة
// السحب: (المبلغ − النسبة) × سعر البيع، ورصيد USDT يزيد المبلغ
// fixedTotal: مبلغ متفق عليه بالشيكل/الدولار (الكمية محسوبة منه لصالحنا)، فيكون هو المبلغ النهائي
// الربح = الفرق بين ما دفعه/قبضه الزبون وقيمة الـ USDT بنفس السعر (يشمل النسبة والخصم والتقريب والفرق المُسوّى)
// finalAdjust: تعديل ± يدوي على المبلغ النهائي بعد التقريب (لا يُستعمل مع المبلغ المتفق عليه)، والربح يتبعه
function computeUsdt({ kind, amount, networkFee, pct, rate, currency, discount, settle, fixedTotal = 0, finalAdjust = 0 }) {
    const ils = currency !== 'USD';
    if (kind === 'adjust') return { gross: 0, total: 0, usdtEffect: round2(amount), profitIls: 0 };
    // التحويل بين محافظنا: المجموع بينقص رسوم التحويل بس
    if (kind === 'transfer') return { gross: 0, total: 0, usdtEffect: -round2(Math.max(0, networkFee)), profitIls: 0 };
    if (kind === 'deposit') {
        const costUsd = amount + networkFee;
        const gross = (amount * (1 + pct / 100) + networkFee) * (ils ? rate : 1);
        const total = fixedTotal > 0 ? round2(fixedTotal) : Math.max(0, round2(roundUpHalf(gross - discount) + finalAdjust));
        const profit = total - settle - costUsd * (ils ? rate : 1);
        return { gross: round2(gross), total, usdtEffect: -round2(costUsd), profitIls: round2(ils ? profit : profit * rate) };
    }
    const gross = amount * (1 - pct / 100) * (ils ? rate : 1);
    const total = fixedTotal > 0 ? round2(fixedTotal) : Math.max(0, round2(roundDownHalf(gross) + finalAdjust));
    const profit = amount * (ils ? rate : 1) - (total - settle);
    return { gross: round2(gross), total, usdtEffect: round2(amount), profitIls: round2(ils ? profit : profit * rate) };
}

function usdtNetworks() {
    const list = Array.isArray(globalConfig.usdtNetworks) ? globalConfig.usdtNetworks : [];
    return list.filter(n => n && String(n.name || '').trim());
}

// شرائح السحب: قائمة كاملة usdtTiers [{min $, pct}] من 0
function usdtTiers() {
    const list = Array.isArray(globalConfig.usdtTiers) ? globalConfig.usdtTiers : [];
    return list.map(t => ({ min: toNum(t.min, 0), pct: toNum(t.pct, 0) })).sort((a, b) => a.min - b.min);
}

// شرائح الإيداع (بطلب عماد 2026-10-17، زي السحب والجنيه): أول شريحة (من 0) = usdtDepositPct،
// والشرائح فوقها usdtDepositTiers [{min $, pct}]
function usdtDepositTiers() {
    const extra = (Array.isArray(globalConfig.usdtDepositTiers) ? globalConfig.usdtDepositTiers : [])
        .map(t => ({ min: toNum(t?.min, 0), pct: toNum(t?.pct, NaN) }))
        .filter(t => t.min > 0 && t.pct >= 0)
        .sort((a, b) => a.min - b.min);
    return [{ min: 0, pct: toNum(globalConfig.usdtDepositPct, 1) }, ...extra];
}

const usdtKindTiers = (kind) => (kind === 'deposit' ? usdtDepositTiers() : usdtTiers());

// النسبة حسب كمية USDT: آخر شريحة حدّها الأدنى أقل من أو يساوي الكمية
function usdtPctFor(kind, amount) {
    const tiers = usdtKindTiers(kind);
    let pct = tiers[0]?.pct ?? 0;
    tiers.forEach(t => { if (amount >= t.min) pct = t.pct; });
    return pct;
}

// المبلغ اللي فيه كسور بس إذا في كسور: 400 مش 400.00
const fmtTrim = (v) => fmt(v, Math.abs(round2(v) % 1) > 0.004 ? 2 : 0);

// "أقل من 400 $" / "من 400 لـ 1000 $" / "من 1000 $ فما فوق" (للـ USDT والجنيه)
function tierRangeText(tiers, min, unit) {
    const next = tiers.find(t => t.min > min);
    if (!min) return next ? `أقل من ${fmtTrim(next.min)} ${unit}` : 'كل المبالغ';
    return next ? `من ${fmtTrim(min)} لـ ${fmtTrim(next.min)} ${unit}` : `من ${fmtTrim(min)} ${unit} فما فوق`;
}

// ================= الجنيه المصري (من egp.js) =================
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

// المبلغ المتفق عليه (شيكل أو دولار) ← الجنيه بالجنيه الصحيح، والتقريب لصالحنا:
// الإرسال: الزبون بيدفع المبلغ وبيوصل جنيه مقرّب لتحت. الاستقبال: بيبعت جنيه مقرّب لفوق وبياخد المبلغ.
function egpForMoney(f) {
    const k = f.currency === 'USD' ? 1 : f.usdRate;
    if (!(k > 0) || !(f.rate > 0) || !(f.fixedTotal > 0)) return 0;
    const exact = f.fixedTotal / k * f.rate;
    return Math.max(0, f.kind === 'send' ? floorEgp(exact) : ceilEgp(exact));
}

const egpScreen = () => toNum(globalConfig.egpScreenRate, 0);

const EGP_MAX_PCT = 90;

function egpRateFromPct(kind, screen, pct) {
    const f = 1 - toNum(pct, 0) / 100;
    if (!(screen > 0) || !(f > 0)) return 0;
    return round4(kind === 'send' ? screen * f : screen / f);
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
