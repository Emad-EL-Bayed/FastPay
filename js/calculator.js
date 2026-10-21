'use strict';

// فاست باي — الحاسبة: معادلة الحساب والبحث عن الزبون
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

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

function countryOptionsHtml(list) {
    return list.map(c => `
        <option data-name="${escapeHtml(c.name)}" data-type="${escapeHtml(c.type)}" data-factor="${escapeHtml(c.factor)}">
            ${escapeHtml(c.name)} (${TYPE_SYMBOL[c.type] || '÷'} ${escapeHtml(c.factor)})
        </option>
    `).join('');
}

function selectedCountry(select) {
    const opt = select.options[select.selectedIndex];
    if (!opt) return null;
    return { name: opt.dataset.name, type: opt.dataset.type, factor: toNum(opt.dataset.factor, 1) };
}

function factorLabel(c) {
    return c.type === 'direct_percent' ? `خصم ${c.factor}%` : `${TYPE_SYMBOL[c.type]} ${c.factor}`;
}

// ---------- اختيار المصدر (شبكة الدول والمنصات) ----------
let calcSource = null; // { name, type, factor }

// USDT والجنيه المصري إلهم صفحاتهم، فما بيظهروا بمصادر الحاسبة (الحوالات القديمة عليهم بتضل)
const isUsdtSource = (c) => /usdt|جنيه/i.test(c?.name || '');

function renderSourceGrid() {
    const query = ($('source-search').value || '').trim().toLowerCase();
    if (!calcSource || (!calcSource.other && !countries.some(c => c.name === calcSource.name && !isUsdtSource(c)))) {
        const first = countries.find(c => !isUsdtSource(c));
        calcSource = first ? { ...first } : { ...OTHER_SOURCE };
        applySourceToInputs();
    }
    // USDT له صفحة خاصة (إيداع وسحب)، فلا يظهر في الحاسبة
    const list = countries.filter(c => !isUsdtSource(c) && (!query || c.name.toLowerCase().includes(query)));
    const otherActive = !!calcSource?.other;
    const otherChip = `
        <button type="button" data-action="select-source" data-name="${escapeHtml(OTHER_SOURCE.name)}" data-other="1" role="radio" aria-checked="${otherActive}"
            class="source-chip source-chip-other${otherActive ? ' active' : ''}">
            <span class="source-chip-name">✏️ أخرى</span>
            <span class="source-chip-rate">تكتب النوع والنسبة</span>
        </button>`;
    $('source-grid').innerHTML = list.map(c => {
            const active = calcSource && !calcSource.other && c.name === calcSource.name;
            return `
                <button type="button" data-action="select-source" data-name="${escapeHtml(c.name)}" role="radio" aria-checked="${active}"
                    class="source-chip${active ? ' active' : ''}">
                    <span class="source-chip-name">${escapeHtml(c.name)}</span>
                    <span class="source-chip-rate">${escapeHtml(factorLabel(c))}</span>
                    <span class="source-chip-cost">${escapeHtml(costLabel(c.costMode, c.costValue))} · ربح ${escapeHtml(c.profitPct)}%</span>
                </button>`;
        }).join('') + otherChip;
}

function applySourceToInputs() {
    const isOther = !!calcSource?.other;
    const isPercent = calcSource?.type === 'direct_percent';
    $('calc_factor').value = isOther ? '' : (calcSource ? calcSource.factor : '');
    $('calc_factor').placeholder = isOther ? '0' : '';
    $('calc_op_symbol').textContent = TYPE_SYMBOL[calcSource?.type] || '÷';
    $('calc_factor_label').textContent = isPercent ? 'النسبة %' : 'المعامل';
    const inUsd = isPercent || (calcSource && calcSource.type === 'mul' && calcSource.factor === 1);
    $('calc_amount_hint').textContent = inUsd ? '(بالدولار)' : '(بالعملة الأصلية)';
    $('other-fields').classList.toggle('hidden', !isOther);
    applySourceRates();
    updateSourceBadge();
}

// تعبئة التكلفة والربح من تسعير الدولة المختارة (أو الافتراضي لخيار "أخرى")
function applySourceRates() {
    const src = calcSource && !calcSource.other ? calcSource : null;
    setCostMode(src ? src.costMode : 'pct', false);
    $('calc_cost_pct').value = src ? src.costValue : globalConfig.costPct;
    // زبون VIP: أقل من نسبة الدولة بخصمه
    calcVipApplied = calcVipDiscount();
    $('calc_profit_pct').value = round2(Math.max(0, baseProfitPct() - calcVipApplied));
}

// ---------- زبون VIP: خصم على نسبة ربح الدولة (بطلب عماد 2026-10-21) ----------
// الخصم من نافذة الزبون (المدير بس)، وبينزل لحاله لما تختار الزبون؛ ما بيكتب فوق نسبة عدّلتها بإيدك إلا إذا تغيّر الزبون
let calcVipApplied = 0;

function calcCustomer() {
    return customers.find(c => c.id && c.id === $('calc_customer_id').value) || customers.find(c => normName(c.name) === normName($('calc_recipient').value));
}

function calcVipDiscount() {
    if (typeof sheetHas !== 'function' || !sheetHas('vip')) return 0;
    return Math.max(0, toNum(calcCustomer()?.vipDiscount, 0));
}

function baseProfitPct() {
    const src = calcSource && !calcSource.other ? calcSource : null;
    return src ? src.profitPct : globalConfig.profitPct;
}

function applyVipProfit() {
    const vip = calcVipDiscount();
    if (vip === calcVipApplied) return;
    calcVipApplied = vip;
    $('calc_profit_pct').value = round2(Math.max(0, baseProfitPct() - vip));
    runLiveCalc();
}

function renderCalcVipNote(input) {
    const vip = calcVipApplied > 0 && input.orig > 0;
    $('calc-vip-note').classList.toggle('hidden', !vip);
    if (vip) $('calc-vip-note').innerHTML = `⭐ زبون مميز<span class="profit-only"> · الربح ${escapeHtml(String(input.profitPct))}% بدل ${escapeHtml(String(baseProfitPct()))}%</span>`;
}

function setCostMode(mode, recalc = true) {
    mode = mode === 'fixed' ? 'fixed' : 'pct';
    $('calc_cost_mode').value = mode;
    document.querySelectorAll('[data-action="set-cost-mode"]').forEach(b => {
        const on = b.dataset.mode === mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on);
    });
    $('calc_cost_pct').step = mode === 'fixed' ? '0.5' : '0.1';
    if (recalc) runLiveCalc();
}

function otherSourceName() {
    const typed = $('calc_other_name').value.trim();
    return typed ? `أخرى - ${typed}` : '';
}

function updateSourceBadge() {
    $('res_source_badge').textContent = calcSource?.other ? (otherSourceName() || 'أخرى') : (calcSource?.name || '');
}

function selectSource(name, isOther = false) {
    if (isOther) {
        calcSource = { ...OTHER_SOURCE };
    } else {
        const c = countries.find(x => x.name === name);
        if (!c) return;
        calcSource = { ...c };
    }
    applySourceToInputs();
    renderSourceGrid();
    runLiveCalc();
    (isOther ? $('calc_other_name') : $('calc_orig_amount')).focus();
}

// ---------- طريقة الاستلام والجهة والعملة ----------
function providerOptions(payout) {
    return PAYOUT_PROVIDERS[payout] || [];
}

function setPayout(payout, provider) {
    if (!PAYOUTS.includes(payout)) payout = 'محفظة';
    const options = providerOptions(payout);
    if (!options.includes(provider)) provider = options[0] || '';
    $('calc_payout_type').value = payout;
    $('calc_provider').value = provider;

    document.querySelectorAll('[data-action="set-payout"]').forEach(b => {
        const on = b.dataset.payout === payout;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on);
    });
    $('provider-row').innerHTML = options.map(p => `
        <button type="button" data-action="set-provider" data-provider="${escapeHtml(p)}" class="provider-chip${p === provider ? ' active' : ''}">${escapeHtml(p)}</button>
    `).join('');
    $('payout-details').classList.toggle('hidden', payout === 'كاش');
    $('payout-cash-note').classList.toggle('hidden', payout !== 'كاش');
    // البنك: رقم الجوال المربوط بالحساب (للتحويل)، رقم الحساب، و IBAN. واحد منهم على الأقل
    const bank = payout === 'بنكي';
    $('calc_account_label').textContent = bank ? 'رقم الجوال (للتحويل)' : 'رقم المحفظة';
    $('calc_account').placeholder = bank ? 'الجوال المربوط بحساب ' + (provider || 'البنك') : 'رقم محفظة ' + (provider || 'الزبون');
    // البنك: الجهة بسطر لحالها، وتحتها الجوال ورقم الحساب جنب بعض
    $('provider-cell').classList.toggle('sm:col-span-2', bank);
    $('bank-account-row').classList.toggle('hidden', !bank);
    $('iban-row').classList.toggle('hidden', !bank);
    syncBankAccountField($('calc_bank_account'));
    syncIbanField($('calc_iban'), $('calc_iban_hint'));
    syncCalcRepeatActive();
}

// رقم الحساب البنكي: الخانة بتتسكّر إذا السكربت المنشور قديم (ما فيه عمود إله فبيضيع)
function syncBankAccountField(input) {
    const supported = sheetHas('bankAccount');
    input.disabled = !supported;
    input.placeholder = supported ? 'رقم حساب الزبون' : 'حدّث السكربت حتى ينحفظ رقم الحساب';
}

// للحفظ: '' إذا فاضي أو الخانة مسكّرة
const readBankAccountField = (input) => (input.disabled ? '' : latinDigits(input.value).trim());

// ---------- IBAN (للبنك، اختياري) ----------
// بالحاسبة ونافذة تعديل الحوالة ونافذة الزبون. الخانة بتتسكّر إذا السكربت المنشور قديم (ما في عمود IBAN فبيضيع)،
// وتحتها ✓ أو ✕. بينحفظ بدون مسافات، وبينعرض كل 4 حروف لحال
function syncIbanField(input, hint) {
    const supported = sheetHas('iban');
    input.disabled = !supported;
    input.placeholder = supported ? 'PS92 PALS 0000 0000 0400 1234 5670 2' : 'حدّث السكربت حتى ينحفظ الـ IBAN';
    const v = cleanIban(input.value);
    const ok = ibanValid(v);
    hint.textContent = !v ? '' : ok ? '✓ IBAN صحيح' : '✕ IBAN مش صحيح، راجع الحروف والأرقام';
    hint.className = 'iban-hint' + (!v ? '' : ok ? ' ok' : ' bad');
}

function setIbanField(input, hint, value) {
    input.value = formatIban(value);
    syncIbanField(input, hint);
}

// للحفظ: '' أو IBAN صحيح، و null = غلط (مع تنبيه والمؤشر على الخانة)
function readIbanField(input) {
    const v = cleanIban(input.value);
    if (!v || input.disabled) return '';
    if (ibanValid(v)) return v;
    input.focus();
    showToast('IBAN مش صحيح', 'راجع الحروف والأرقام، أو امسحه إذا مش لازم', 'warning');
    return null;
}

const IBAN_FIELDS = [['calc_iban', 'calc_iban_hint'], ['edit_tx_iban', 'edit_tx_iban_hint'], ['m_cust_iban', 'm_cust_iban_hint']];

function bindIbanEvents() {
    IBAN_FIELDS.forEach(([id, hintId]) => {
        $(id).addEventListener('input', () => syncIbanField($(id), $(hintId)));
        // لما تطلع من الخانة بتترتب كل 4 حروف
        $(id).addEventListener('blur', () => setIbanField($(id), $(hintId), $(id).value));
    });
}

function setProvider(provider) {
    setPayout($('calc_payout_type').value, provider);
}

function setCurrency(currency) {
    currency = currency === 'USD' ? 'USD' : 'ILS';
    $('calc_currency').value = currency;
    document.querySelectorAll('[data-action="set-currency"]').forEach(b => {
        const on = b.dataset.currency === currency;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on);
    });
    runLiveCalc();
}

function readCalcInputs() {
    return {
        country: calcSource?.other ? otherSourceName() : (calcSource?.name || ''),
        isOther: !!calcSource?.other,
        type: calcSource?.type || 'div',
        orig: toNum($('calc_orig_amount').value, 0),
        factor: toNum($('calc_factor').value, 0),
        costMode: $('calc_cost_mode').value === 'fixed' ? 'fixed' : 'pct',
        costPct: $('calc_cost_mode').value === 'fixed' ? 0 : toNum($('calc_cost_pct').value, 0),
        costFixed: $('calc_cost_mode').value === 'fixed' ? toNum($('calc_cost_pct').value, 0) : 0,
        profitPct: toNum($('calc_profit_pct').value, 0),
        screenRate: toNum($('calc_screen_rate').value, globalConfig.screenRate),
        minusIls: toNum(globalConfig.minusIls, 0),
        currency: $('calc_currency').value === 'USD' ? 'USD' : 'ILS',
        finalAdjust: 0
    };
}

// ---------- تعديل ± على المسلّم قبل الحفظ (بطلب عماد 2026-10-19) ----------
// زي نافذة تعديل الحوالة: الأزرار بتوصل لأقرب نص بنفس الاتجاه، و"احذف القروش" بينزل للرقم الصحيح
// (691.20 ← 691، وبيبين "خصم 0.20"). أي تغيير بالمبلغ أو النسب أو العملة بيلغي التعديل (كان لرقم ثاني)
let calcAdjust = 0;
let calcAdjustSig = '';
const calcInputSig = (i) => JSON.stringify([i.country, i.orig, i.type, i.factor, i.costMode, i.costPct, i.costFixed, i.profitPct, i.screenRate, i.minusIls, i.currency]);

// المدخلات مع التعديل (إذا لسا لنفس الأرقام)
function calcInputsWithAdjust() {
    const input = readCalcInputs();
    if (calcAdjust && calcInputSig(input) !== calcAdjustSig) calcAdjust = 0;
    input.finalAdjust = sheetHas('txAdjust') ? calcAdjust : 0;
    return input;
}

// المسلّم قبل أي تعديل، بعملة التسليم
function deliveredBase(input) {
    const r = computeTransfer({ ...input, finalAdjust: 0 });
    return input.currency === 'USD' ? r.clientUsd : r.clientIls;
}

// الرقم الجديد بعد الكبسة: step رقم (±½، ±1) أو 'cents' أو 'reset'
function nextFinalAdjust(base, adj, step) {
    if (step === 'reset') return 0;
    if (step === 'cents') return round2(Math.max(Math.floor(round2(base + adj) + 1e-9), 0) - base);
    const target = round2(base + adj + step);
    const snapped = step > 0 ? Math.floor(target * 2 + 1e-9) / 2 : Math.ceil(target * 2 - 1e-9) / 2;
    return round2(Math.max(snapped, 0) - base);
}

// "خصم 0.20 ₪" / "زيادة 0.50 ₪"
const adjustWord = (adj, cur) => `${adj < 0 ? 'خصم' : 'زيادة'} ${moneyCur(Math.abs(adj), cur)}`;

function bumpCalcAdjust(stepRaw) {
    if (!sheetHas('txAdjust')) return;
    const input = calcInputsWithAdjust();
    if (input.orig <= 0) return;
    const step = stepRaw === 'cents' || stepRaw === 'reset' ? stepRaw : toNum(stepRaw, 0);
    if (!step) return;
    calcAdjust = nextFinalAdjust(deliveredBase(input), input.finalAdjust, step);
    calcAdjustSig = calcInputSig(input);
    runLiveCalc();
}

function renderCalcAdjust(input, r) {
    const show = input.orig > 0 && sheetHas('txAdjust');
    $('calc-adjust').classList.toggle('hidden', !show);
    const adj = show ? r.finalAdjust : 0;
    const cur = input.currency === 'USD' ? 'USD' : 'ILS';
    const amount = cur === 'USD' ? r.clientUsd : r.clientIls;
    // ما في قروش: الزر ما إله شغل
    $('calc-adj-cents').disabled = !show || Math.abs(amount - Math.floor(amount + 1e-9)) < 0.005;
    $('calc-adj-reset').classList.toggle('hidden', !adj);
    $('calc-adjust-note').classList.toggle('hidden', !adj);
    if (adj) $('calc-adjust-note').innerHTML = `قبل التعديل <bdi class="num">${escapeHtml(moneyCur(deliveredBase(input), cur))}</bdi> · <b class="${adj < 0 ? 'text-amber-300' : 'text-sky-300'}">${escapeHtml(adjustWord(adj, cur))}</b>`;
}

let lastResultValue = null;

function runLiveCalc() {
    syncCalcRepeatActive();
    const input = calcInputsWithAdjust();
    const r = computeTransfer(input);
    const isUsd = input.currency === 'USD';
    const payoutAmount = isUsd ? r.clientUsd : r.clientIls;
    const fast = (v) => fmt(v);

    // الرقم الكبير يتحرك بسرعة نحو القيمة الجديدة، مع نبضة خفيفة عند التغيير
    const big = $('res_client_ils');
    animateNumber(big, payoutAmount, fast, 350);
    if (lastResultValue !== null && Math.abs(lastResultValue - payoutAmount) > 0.004 && !motionReduced()) {
        big.classList.remove('bump');
        void big.offsetWidth;
        big.classList.add('bump');
    }
    lastResultValue = payoutAmount;

    $('res_currency_lbl').textContent = isUsd ? '$ دولار' : '₪ شيكل';
    $('mrb-amount').textContent = fmt(payoutAmount);
    $('mrb-currency').textContent = isUsd ? '$' : '₪';
    $('mrb-profit').textContent = fmt(r.profitIls);
    resultInputReady = input.orig > 0;
    updateMobileResultBar();
    $('res_hint').textContent = input.orig <= 0
        ? 'أدخل المبلغ لعرض النتيجة'
        : isUsd
            ? 'يُسلَّم بالدولار، شامل خصم التكلفة وربحك'
            : 'شامل خصم التكلفة وربحك';
    renderCalcAdjust(input, r);
    renderCalcVipNote(input);
    // الموظف فوق حد الحوالة
    const over = input.orig > 0 && txLimitActive() && (isUsd ? r.clientUsd * input.screenRate : r.clientIls) > txLimitIls() + 0.004;
    $('calc-limit-note').classList.toggle('hidden', !over);
    if (over) $('calc-limit-note').textContent = `⏳ فوق ${fmt(txLimitIls(), 0)} ₪: بتنحفظ وبتستنى موافقة المدير`;

    animateNumber($('res_profit_ils'), r.profitIls, (v) => '+' + fmt(v), 350);
    $('res_profit_usd').textContent = fmt(r.profitUsd) + ' $';
    animateNumber($('res_cost_ils'), r.costIls, fast, 350);
    $('res_cost_usd').textContent = fmt(r.costUsd) + ' $';

    // شريط التوزيع
    const total = r.baseUsd || 1;
    $('split-client').style.width = (r.baseUsd ? (r.clientUsd / total) * 100 : 0) + '%';
    $('split-cost').style.width = (r.baseUsd ? (r.costUsd / total) * 100 : 0) + '%';
    $('split-profit').style.width = (r.baseUsd ? (r.profitUsd / total) * 100 : 0) + '%';

    $('step_base_usd').textContent = fmt(r.baseUsd) + ' $';
    $('step_cost_pct_lbl').textContent = input.costMode === 'fixed' ? `$${input.costFixed} ثابت` : input.costPct + '%';
    $('step_profit_pct_lbl').textContent = input.profitPct + '%';
    $('step_cost_usd').textContent = '-' + fmt(r.costUsd) + ' $';
    $('step_profit_usd').textContent = '-' + fmt(r.profitUsd) + ' $';
    $('step_client_usd').textContent = fmt(r.clientUsd) + ' $';
    $('step_screen_lbl').textContent = input.screenRate;
    $('step_gross_ils').textContent = fmt(r.grossIls) + ' ₪';
    $('step_final_ils').textContent = fmt(r.clientIls) + ' ₪';
    $('step_final_usd').textContent = fmt(r.clientUsd) + ' $';
    $('step-row-gross').classList.toggle('hidden', isUsd);
    $('step-row-final').classList.toggle('hidden', isUsd);
    $('step-row-usd').classList.toggle('hidden', !isUsd);
}

function payoutLabel(t) {
    const base = t.payout === 'بنكي' ? 'بنك' : t.payout;
    return t.provider ? `${base} · ${t.provider}` : base;
}

function deliveredHtml(t) {
    return t.currency === 'USD'
        ? `<bdi class="ltr-num">$ ${fmt(t.clientUsd)}</bdi>`
        : `${fmt(t.clientIls)} ₪`;
}

// ---------- آخر الحوالات في الواجهة الرئيسية ----------
let highlightTxId = null;

function renderRecentTx() {
    const box = $('recent-tx');
    if (!box || pageHidden('calculator')) return;
    const recent = [...ledger].sort((a, b) => b.id - a.id).slice(0, 5);
    box.innerHTML = recent.length === 0
        ? `<li class="text-xs text-slate-400 py-3 text-center">${emptyMessage(0, '', 'لا توجد حوالات بعد')}</li>`
        : recent.map(t => `
            <li class="recent-item${t.id === highlightTxId ? ' new' : ''}">
                <div class="min-w-0">
                    <span class="block font-bold text-slate-800 truncate">${escapeHtml(t.recipient)}</span>
                    <span class="block text-[10px] text-slate-400 truncate">${escapeHtml(t.country)} · ${escapeHtml(payoutLabel(t))}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <div class="text-left">
                        <button data-action="open-receipt" data-id="${t.id}" class="amount-link block font-black text-slate-900 num" title="الفاتورة">${deliveredHtml(t)}</button>
                        <span class="profit-only block text-[10px] text-emerald-600 font-bold num">+${fmt(t.profitIls)} ₪</span>
                    </div>
                    <button data-action="open-receipt" data-id="${t.id}" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700 transition">فاتورة</button>
                </div>
            </li>
        `).join('');
    highlightTxId = null;
}

// الحوالة الجديدة دايماً "فحص" (بطلب عماد 2026-10-21)
const CALC_DEFAULT_STATUS = 'فحص';

function resetCalcForm() {
    $('calc_recipient').value = '';
    $('calc_customer_id').value = '';
    $('calc_account').value = '';
    $('calc_bank_account').value = '';
    setIbanField($('calc_iban'), $('calc_iban_hint'), '');
    $('calc_orig_amount').value = '';
    calcAdjust = 0;
    $('calc_status').value = CALC_DEFAULT_STATUS;
    $('calc_date').value = localDateStr();
    $('calc_phone').value = '';
    updateCustomerPhoneField('calc', null, '');
    setCustomerStatus(false, 'عميل جديد');
    setPayout('محفظة');
    setCurrency('ILS');
    renderCalcRepeat();
    calcRateTouched = false;
    applyScreenRateToUI();
    $('calc_other_name').value = '';
    updateSourceBadge();
    if (calcSource && !calcSource.other) $('calc_factor').value = calcSource.factor;
    applySourceRates();
    runLiveCalc();
}

// ---------- شريط النتيجة السريع على الجوال ----------
let resultInputReady = false;
let resultCardVisible = true;

function updateMobileResultBar() {
    const bar = $('mobile-result-bar');
    const onCalc = !$('page-calculator').classList.contains('hidden');
    const show = onCalc && resultInputReady && !resultCardVisible;
    bar.classList.toggle('show', show);
    bar.setAttribute('aria-hidden', String(!show));
}

function watchResultCard() {
    const card = document.querySelector('.calc-result');
    if (!card || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(([entry]) => {
        resultCardVisible = entry.isIntersecting;
        updateMobileResultBar();
    }, { threshold: 0.35 }).observe(card);
}

// يعيد حركة دخول بطاقات الحاسبة عند فتح الصفحة
function replayCalcEntrance() {
    document.querySelectorAll('#page-calculator .calc-step').forEach(el => {
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
    });
}

// ================= كرّر آخر حوالة (بطلب عماد 2026-10-21) =================
// لزبون إله حوالات قبل: زر لكل دولة بعتها (آخر حوالة منها، لحد 3) بيعبّي المصدر وعملة التسليم وطريقة الاستلام والرقم.
// المبلغ لا، والنسب من تسعير الدول اليوم (selectSource)، مش من الحوالة القديمة
const CALC_REPEAT_MAX = 3;

function calcRepeatTxs() {
    const id = $('calc_customer_id').value;
    const name = normName($('calc_recipient').value);
    const c = customers.find(x => x.id === id) || (name ? customers.find(x => normName(x.name) === name) : null);
    if (!c) return [];
    const mine = ledger.filter(t => t.status !== 'ملغي' && t.country && !isUsdtSource({ name: t.country })
        && (t.customerId ? t.customerId === c.id : normName(t.recipient) === normName(c.name)));
    mine.sort((a, b) => String(b.date).localeCompare(String(a.date)) || toNum(b.id) - toNum(a.id));
    const seen = new Set();
    return mine.filter(t => !seen.has(t.country) && seen.add(t.country)).slice(0, CALC_REPEAT_MAX);
}

const repeatPayoutLabel = (t) => t.payout === 'كاش' ? 'كاش' : (t.provider || t.payout || '');

// الزر مضوي إذا الحاسبة هلّق على نفس الدولة والعملة والجهة
function calcMatchesTx(t) {
    const src = calcSource?.other ? otherSourceName() : calcSource?.name;
    return src === t.country && $('calc_currency').value === (t.currency === 'USD' ? 'USD' : 'ILS')
        && $('calc_payout_type').value === t.payout && ($('calc_payout_type').value === 'كاش' || $('calc_provider').value === t.provider);
}

function renderCalcRepeat() {
    const box = $('calc-repeat');
    const list = calcRepeatTxs();
    box.classList.toggle('hidden', !list.length);
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<span class="calc-repeat-label">↻ زي آخر مرة:</span>` + list.map(t => `
        <button type="button" data-action="calc-repeat" data-id="${escapeHtml(t.id)}" class="repeat-chip${calcMatchesTx(t) ? ' active' : ''}"
            title="آخر حوالة من هون: ${escapeHtml(t.date)} · ${escapeHtml(moneyCur(t.currency === 'USD' ? t.clientUsd : t.clientIls, t.currency))}">
            ${escapeHtml(t.country.replace(/^أخرى\s*-\s*/, ''))} · ${escapeHtml(repeatPayoutLabel(t))} · ${t.currency === 'USD' ? '$' : '₪'}
        </button>`).join('');
}

// بس الإضاءة (بدون ما ندوّر بالحوالات من جديد): بعد أي تغيير بالمصدر أو العملة أو الجهة
function syncCalcRepeatActive() {
    document.querySelectorAll('#calc-repeat .repeat-chip').forEach(b => {
        const t = ledger.find(x => String(x.id) === b.dataset.id);
        b.classList.toggle('active', !!t && calcMatchesTx(t));
    });
}

function applyCalcRepeat(id) {
    const t = ledger.find(x => String(x.id) === String(id));
    if (!t) return;
    const other = /^أخرى\s*-\s*/.test(t.country);
    if (other) {
        selectSource(OTHER_SOURCE.name, true);
        $('calc_other_name').value = t.country.replace(/^أخرى\s*-\s*/, '');
        $('calc_factor').value = t.factor || '';
        updateSourceBadge();
    } else if (countries.some(c => c.name === t.country)) {
        selectSource(t.country);
    } else {
        showToast('تنبيه', `${t.country} مش موجودة بتسعير الدول، اختار المصدر بإيدك`, 'warning');
    }
    setCurrency(t.currency);
    setPayout(t.payout, t.provider);
    $('calc_account').value = t.account || '';
    $('calc_bank_account').value = t.bankAccount || '';
    setIbanField($('calc_iban'), $('calc_iban_hint'), t.iban || '');
    runLiveCalc();
    renderCalcRepeat();
    $('calc_orig_amount').focus();
}

// ================= البحث الذكي عن الزبون =================
function setCustomerStatus(isExisting, text) {
    const el = $('cust-auto-status');
    el.textContent = text;
    el.className = isExisting
        ? 'text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200'
        : 'text-[11px] font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-100';
}

// قائمة الزبائن: تفتح بالضغط على الخانة، وتتفلتر أثناء الكتابة
let pickerIndex = -1;

function customerLastDates() {
    const last = {};
    const seen = (key, date) => { if (date && (!last[key] || date > last[key])) last[key] = date; };
    ledger.forEach(t => seen(t.customerId || 'n:' + normName(t.recipient), t.date));
    usdtMoves.forEach(m => { if (m.kind !== 'adjust') seen(m.customerId || 'n:' + normName(m.customerName), m.date); });
    egpMoves.forEach(m => { if (m.customerName) seen(m.customerId || 'n:' + normName(m.customerName), m.date); });
    return last;
}

function onCustomerSearchInput() {
    const input = $('calc_recipient');
    const query = normName(input.value);
    const dropdown = $('customer-search-dropdown');

    // كتابة اسم مختلف تلغي ربط الزبون المختار سابقاً
    const linked = customers.find(c => c.id === $('calc_customer_id').value);
    if (linked && normName(linked.name) !== query) $('calc_customer_id').value = '';
    const exact = customers.find(c => normName(c.name) === query);
    if (!$('calc_customer_id').value) {
        setCustomerStatus(!!exact, exact ? '✓ زبون مسجل' : (query ? '+ زبون جديد' : 'عميل جديد'));
    }
    updateCustomerPhoneField('calc', customers.find(c => c.id === $('calc_customer_id').value) || exact, input.value);
    applyVipProfit();
    renderCalcRepeat();

    pickerIndex = -1;
    dropdown.innerHTML = customerPickerHtml(input.value.trim(), 'select-customer');
    dropdown.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
}

// قائمة الزبائن نفسها للحاسبة و USDT: المطابق لما تكتبه، والأحدث تعاملاً أولاً
function customerPickerHtml(rawQuery, action) {
    const query = normName(rawQuery);
    const last = customerLastDates();
    const lastOf = (c) => last[c.id] || last['n:' + normName(c.name)] || c.createdAt || '';
    const matches = customers
        .filter(c => !query || normName(c.name).includes(query) || normPhone(c.account).includes(normPhone(query)))
        .sort((a, b) => {
            // الأسماء التي تبدأ بما تكتبه أولاً، ثم الأحدث تعاملاً
            const as = normName(a.name).startsWith(query) ? 0 : 1;
            const bs = normName(b.name).startsWith(query) ? 0 : 1;
            return as - bs || lastOf(b).localeCompare(lastOf(a));
        })
        .slice(0, 50);
    if (matches.length === 0) {
        return customers.length
            ? `<div class="p-3 text-xs text-slate-500 text-center">لا يوجد زبون بهذا الاسم — سيُحفظ "${escapeHtml(rawQuery)}" كزبون جديد</div>`
            : '<div class="p-3 text-xs text-slate-400 text-center">لا يوجد زبائن بعد — اكتب اسم الزبون الجديد</div>';
    }
    return matches.map(c => `
        <div data-action="${action}" data-id="${escapeHtml(c.id)}" role="option" class="cust-option">
            <span class="cust-avatar">${escapeHtml(c.name.trim().charAt(0) || '؟')}</span>
            <span class="min-w-0 flex-1">
                <span class="font-bold text-slate-800 block truncate">${c.vipDiscount > 0 ? '<span title="زبون مميز">⭐</span> ' : ''}${highlightMatch(c.name, rawQuery)}</span>
                <span class="text-[11px] text-slate-400 truncate block">${escapeHtml(payoutLabel(c))}${c.account ? ` · <bdi class="ltr-num font-mono">${escapeHtml(c.account)}</bdi>` : ''}</span>
            </span>
            ${lastOf(c) ? `<span class="text-[10px] text-slate-400 shrink-0">${relativeDays(lastOf(c))}</span>` : ''}
        </div>
    `).join('');
}

// ---------- رقم الواتساب في الحاسبة و USDT ----------
// يظهر فقط للاسم الجديد أو لزبون مسجل ما إله رقم، ويُحفظ مع الزبون عند حفظ الحركة
function updateCustomerPhoneField(prefix, customer, name) {
    const show = !!normName(name) && !hasWhatsapp(customer);
    $(prefix + '_phone_wrap').classList.toggle('hidden', !show);
    $(prefix + '_phone_label').textContent = customer
        ? `رقم الواتساب (اختياري) — ${customer.name} ما إله رقم`
        : 'رقم الواتساب (اختياري)';
}

// ---------- زبون جديد من USDT أو الجنيه: كيف بيستلم (بطلب عماد 2026-10-21) ----------
// بس بالحركات اللي إحنا بندفع فيها (سحب USDT، استقبال جنيه)، ولاسم جديد. زي الحاسبة: بال باي أول، والرقم اختياري.
// بينحفظ بملف الزبون (payout/provider/account)، فجاهزية الدفع بتحسبه على الحساب الصح والحاسبة بتعبّيه بعدين
const newPayoutState = {};

function setNewPayout(prefix, payout, provider) {
    if (!PAYOUTS.includes(payout)) payout = 'محفظة';
    const options = providerOptions(payout);
    if (!options.includes(provider)) provider = options[0] || '';
    newPayoutState[prefix] = { payout, provider };
    $(prefix + '_np_payouts').querySelectorAll('[data-payout]').forEach(b => {
        const on = b.dataset.payout === payout;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
    });
    $(prefix + '_np_providers').innerHTML = options.map(p => `
        <button type="button" data-action="np-provider" data-prefix="${prefix}" data-provider="${escapeHtml(p)}" class="provider-chip${p === provider ? ' active' : ''}">${escapeHtml(p)}</button>`).join('');
    $(prefix + '_np_providers').classList.toggle('hidden', !options.length);
    const acc = $(prefix + '_np_account');
    acc.classList.toggle('hidden', payout === 'كاش');
    acc.placeholder = payout === 'بنكي' ? `رقم الجوال المربوط بـ ${provider || 'البنك'} (اختياري)` : `رقم محفظة ${provider || 'الزبون'} (اختياري)`;
}

function syncNewPayoutField(prefix, show) {
    const wrap = $(prefix + '_np_wrap');
    if (show && wrap.classList.contains('hidden')) {
        setNewPayout(prefix, 'محفظة');
        $(prefix + '_np_account').value = '';
    }
    wrap.classList.toggle('hidden', !show);
}

// للحفظ: null إذا الخانات مخفية (الزبون بيضل زي ما كان)
function readNewPayout(prefix) {
    if ($(prefix + '_np_wrap').classList.contains('hidden')) return null;
    const st = newPayoutState[prefix] || { payout: 'محفظة', provider: 'بال باي' };
    return { payout: st.payout, provider: st.provider, account: st.payout === 'كاش' ? '' : latinDigits($(prefix + '_np_account').value).trim() };
}

// الرقم المكتوب ('' إذا فارغ أو مخفي)، أو null إذا غلط (مع تنبيه)
function readCustomerPhone(prefix, customerId = '') {
    const input = $(prefix + '_phone');
    const phone = input.value.trim();
    if ($(prefix + '_phone_wrap').classList.contains('hidden') || !phone) return '';
    if (!hasWhatsapp({ phone })) {
        input.focus();
        showToast('رقم الواتساب غير مكتمل', 'اكتبه مع المقدمة، مثل 970599123456، أو اتركه فارغاً', 'warning');
        return null;
    }
    const other = customers.find(x => x.id !== customerId && whatsappDigits(x.phone) === whatsappDigits(phone));
    if (other) {
        input.focus();
        showToast('الرقم مسجل لزبون ثاني', `رقم الواتساب هذا للزبون ${other.name}`, 'warning');
        return null;
    }
    return phone;
}

// الأسهم و Enter للتنقل في أي قائمة زبائن. يرجع الرقم الجديد للعنصر المظلل
function pickerKeyNav(e, dropdown, index, onPick, onClose) {
    const options = [...dropdown.querySelectorAll('.cust-option')];
    if (dropdown.classList.contains('hidden') || !options.length) return index;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        index = (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options.forEach((o, i) => o.classList.toggle('active', i === index));
        options[index].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && index >= 0) {
        e.preventDefault();
        onPick(options[index].dataset.id);
    } else if (e.key === 'Escape') {
        onClose();
    }
    return index;
}

function highlightMatch(name, query) {
    const safe = escapeHtml(name);
    if (!query) return safe;
    const i = name.toLowerCase().indexOf(query.toLowerCase());
    if (i < 0) return safe;
    return escapeHtml(name.slice(0, i)) + '<mark class="cust-mark">' + escapeHtml(name.slice(i, i + query.length)) + '</mark>' + escapeHtml(name.slice(i + query.length));
}

function closeCustomerPicker() {
    $('customer-search-dropdown').classList.add('hidden');
    $('calc_recipient').setAttribute('aria-expanded', 'false');
}

// الأسهم و Enter للتنقل في القائمة
function onCustomerPickerKey(e) {
    pickerIndex = pickerKeyNav(e, $('customer-search-dropdown'), pickerIndex, selectCustomerFromSearch, closeCustomerPicker);
}

function fillCustomerIntoCalc(c) {
    $('calc_recipient').value = c.name;
    $('calc_customer_id').value = c.id || '';
    setPayout(c.payout || 'محفظة', c.provider);
    $('calc_account').value = c.account || '';
    $('calc_bank_account').value = c.bankAccount || '';
    setIbanField($('calc_iban'), $('calc_iban_hint'), c.iban);
    $('calc_phone').value = '';
    updateCustomerPhoneField('calc', customers.find(x => c.id && x.id === c.id) || null, c.name);
    setCustomerStatus(true, c.vipDiscount > 0 && sheetHas('vip') ? '⭐ زبون مميز' : '✓ زبون مسجل');
    applyVipProfit();
    renderCalcRepeat();
}

function selectCustomerFromSearch(id) {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    fillCustomerIntoCalc(c);
    closeCustomerPicker();
    $('calc_orig_amount').focus();
}
