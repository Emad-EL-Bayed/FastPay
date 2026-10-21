'use strict';

// فاست باي — USDT: الحساب، الصفحة، نموذج الحركة، الدفعات، الإعدادات
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= USDT =================
// الحركات من ورقة "حركات USDT"؛ رصيد USDT = مجموع أثر كل حركة
let usdtMoves = [];

const USDT_KINDS = { deposit: 'إيداع', withdraw: 'سحب', adjust: 'تعديل رصيد' };
// السكربت فيه عمود "تعديل على النهائي" (من features في رد list)؛ بدونه التعديل بيضيع، فالخانة مسكّرة
let sheetSupportsFinalAdjust = false;
// ملاحظة دفعات الحركة في الحسابات
const usdtPayNote = (m) => `${USDT_KINDS[m.kind]} USDT · ${m.customerName}`;
const isUsdtPayNote = (note) => Object.values(USDT_KINDS).some(k => note.startsWith(`${k} USDT · `));
const PAY_STATE = {
    unpaid: { label: 'غير مدفوعة', cls: 'bg-amber-50 text-amber-700' },
    partial: { label: 'جزئي', cls: 'bg-sky-50 text-sky-700' },
    paid: { label: 'مدفوعة', cls: 'bg-emerald-50 text-emerald-700' }
};
let usdtSearch = '';
let editingUsdtId = null;
let usdtPctTouched = false; // إذا عدّلت النسبة بيدك لا نغيّرها تلقائياً حسب الشريحة

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

function normalizeUsdt(m) {
    const kind = USDT_KINDS[m?.kind] ? m.kind : 'deposit';
    const amount = round2(toNum(m?.amount, 0));
    const fixedTotal = kind === 'adjust' ? 0 : Math.max(0, round2(toNum(m?.fixedTotal, 0)));
    const base = {
        id: toNum(m?.id, 0),
        serial: toSerial(m?.serial),
        date: String(m?.date ?? '').slice(0, 10),
        kind,
        customerId: String(m?.customerId ?? '').trim(),
        customerName: String(m?.customerName ?? '').trim(),
        amount: kind === 'adjust' ? amount : Math.max(0, amount),
        network: kind === 'deposit' ? String(m?.network ?? '').trim() : '',
        networkFee: kind === 'deposit' ? Math.max(0, toNum(m?.networkFee, 0)) : 0,
        pct: kind === 'adjust' ? 0 : Math.max(0, toNum(m?.pct, 0)),
        rate: Math.max(0, toNum(m?.rate, 0)),
        currency: m?.currency === 'USD' ? 'USD' : 'ILS',
        discount: kind === 'deposit' ? Math.max(0, toNum(m?.discount, 0)) : 0,
        fixedTotal,
        finalAdjust: kind === 'adjust' || fixedTotal > 0 ? 0 : round2(toNum(m?.finalAdjust, 0)),
        settle: kind === 'adjust' ? 0 : Math.max(0, round2(toNum(m?.settle, 0))),
        address: String(m?.address ?? '').trim(),
        note: String(m?.note ?? '').trim(),
        createdBy: String(m?.createdBy ?? '').trim(),
        updatedBy: String(m?.updatedBy ?? '').trim()
    };
    return { ...base, ...computeUsdt(base) };
}

const usdtDir = (m) => (m.kind === 'deposit' ? 1 : -1);

function usdtPayState(m) {
    if (m.kind === 'adjust') return null;
    const paid = paidFor('usdt', m.id, m.currency, usdtDir(m));
    const remaining = round2(m.total - m.settle - paid);
    const state = remaining <= 0.004 ? 'paid' : paid > 0.004 ? 'partial' : 'unpaid';
    return { paid, remaining: Math.max(0, remaining), state };
}

const usdtBalance = () => round2(usdtMoves.reduce((s, m) => s + m.usdtEffect, 0));

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

// المبلغ المتفق عليه (شيكل أو دولار) ← كمية USDT بخطوات نصف، والتقريب دائماً لصالحنا:
// الإيداع: الزبون يدفع المبلغ ويأخذ USDT مقرّباً لتحت. السحب: يرسل USDT مقرّباً لفوق ويستلم المبلغ.
function usdtForMoney(f, autoPct) {
    const r = f.currency === 'USD' ? 1 : f.rate;
    const money = f.fixedTotal;
    if (!(r > 0) || !(money > 0)) return { amount: 0, pct: f.pct };
    if (f.kind === 'deposit') {
        const get = (pct) => Math.max(0, roundDownHalf(((money + f.discount) / r - f.networkFee) / (1 + pct / 100)));
        const tiers = usdtDepositTiers();
        if (!autoPct || tiers.length < 2) return { amount: get(f.pct), pct: f.pct };
        // نسبة الإيداع تعتمد على الكمية: لكل شريحة الكمية اللي بتطلع وبتضل بنفس الشريحة، ونأخذ الأكتر (الأحسن للزبون)
        const options = tiers
            .map(t => ({ amount: get(t.pct), pct: t.pct }))
            .filter(o => o.amount > 0 && usdtPctFor('deposit', o.amount) === o.pct)
            .sort((a, b) => b.amount - a.amount);
        return options[0] || { amount: get(tiers[0].pct), pct: tiers[0].pct };
    }
    const need = (pct) => roundUpHalf(money / (r * (1 - pct / 100)));
    const tiers = usdtTiers();
    if (!autoPct || !tiers.length) return { amount: need(f.pct), pct: f.pct };
    // نسبة السحب تعتمد على الكمية نفسها: لكل شريحة أقل كمية تكفي وتبقى في نفس الشريحة، ونأخذ الأقل
    const options = tiers
        .map(t => ({ amount: Math.max(need(t.pct), roundUpHalf(t.min)), pct: t.pct }))
        .filter(o => usdtPctFor('withdraw', o.amount) === o.pct)
        .sort((a, b) => a.amount - b.amount);
    return options[0] || { amount: need(f.pct), pct: f.pct };
}

// ---------- صفحة USDT ----------
function renderUsdtPage() {
    if (pageHidden('usdt')) return;
    $('usdt-settings-link').classList.toggle('hidden', !hasPerm('settings'));
    $('wallets-unsupported-usdt').classList.toggle('hidden', sheetSupportsWallets || dataState !== 'ready');
    const today = localDateStr(), month = today.slice(0, 7);
    let profitToday = 0, profitMonth = 0, unpaidIls = 0, unpaidUsd = 0;
    usdtMoves.forEach(m => {
        if (m.date === today) profitToday += m.profitIls;
        if (m.date.startsWith(month)) profitMonth += m.profitIls;
        const st = usdtPayState(m);
        if (st && m.kind === 'deposit') { if (m.currency === 'USD') unpaidUsd += st.remaining; else unpaidIls += st.remaining; }
    });
    const bal = usdtBalance();
    $('usdt-balance').textContent = fmt(bal);
    $('usdt-balance').classList.toggle('text-rose-300', bal < 0);
    $('usdt-profit-today').textContent = '+' + fmt(profitToday, 1) + ' ₪';
    $('usdt-profit-month').textContent = '+' + fmt(profitMonth, 1) + ' ₪';
    $('usdt-unpaid').textContent = moneyCur(unpaidIls, 'ILS') + (unpaidUsd ? ` + ${moneyCur(unpaidUsd, 'USD')}` : '');

    const q = normName(usdtSearch);
    const qNo = q.replace('#', '');
    const serialHit = /^\d+$/.test(qNo) && usdtMoves.some(m => String(m.serial) === qNo);
    const kindFilter = $('usdt_kind_filter').value;
    const monthFilter = $('usdt_month_filter').value;
    // يوم محدد (بطلب عماد 2026-10-21)
    const dateFilter = $('usdt_date_filter').value;
    const list = usdtMoves
        .filter(m => (kindFilter === 'ALL' || m.kind === kindFilter) && (!monthFilter || m.date.startsWith(monthFilter)) && (!dateFilter || m.date === dateFilter))
        .filter(m => !q || (serialHit ? String(m.serial) === qNo : normName(m.customerName).includes(q) || String(m.id).includes(qNo) || normName(m.address).includes(q)))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
        .slice(0, 300);

    $('usdt-body').innerHTML = list.length === 0
        ? `<tr><td colspan="10" class="p-6 text-center text-xs text-slate-400">${emptyMessage(usdtMoves.length, 'لا توجد نتائج', 'لا توجد حركات USDT بعد')}</td></tr>`
        : list.map(m => {
            const st = usdtPayState(m);
            const kindCls = m.kind === 'deposit' ? 'bg-rose-50 text-rose-700' : m.kind === 'withdraw' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600';
            const effect = `${m.usdtEffect >= 0 ? '+' : '−'}${fmt(Math.abs(m.usdtEffect))}`;
            return `
                <tr class="hover:bg-slate-50">
                    <td class="p-3 text-[10px] text-slate-400 font-mono whitespace-nowrap" title="${auditTitle(m)}${m.serial ? ` · رقم الحركة ${m.id}` : ''}">${receiptNo(m)}</td>
                    <td class="p-3 text-xs text-slate-500 whitespace-nowrap num">${escapeHtml(m.date)}${lockMark(m.date)}</td>
                    <td class="p-3 whitespace-nowrap"><span class="badge ${kindCls}">${USDT_KINDS[m.kind]}</span></td>
                    <td class="p-3 font-bold text-slate-900 whitespace-nowrap">${m.kind !== 'adjust' && m.customerName
                        ? `<button data-action="open-customer" data-id="${escapeHtml(m.customerId)}" data-name="${escapeHtml(m.customerName)}" class="font-bold hover:text-blue-700 hover:underline text-right" title="ملف الزبون">${escapeHtml(m.customerName)}</button>`
                        : escapeHtml(m.kind === 'adjust' ? m.note || '—' : '—')}</td>
                    <td class="p-3 font-mono font-bold num whitespace-nowrap">${fmt(Math.abs(m.amount))} <span class="text-[10px] text-slate-400">USDT</span>${m.network ? `<div class="text-[10px] text-slate-400 font-sans">${escapeHtml(m.network)} · ${fmt(m.networkFee)}$</div>` : ''}</td>
                    <td class="p-3 font-mono text-xs num whitespace-nowrap ${m.usdtEffect >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${effect}</td>
                    <td class="p-3 font-mono font-black num whitespace-nowrap">${m.kind === 'adjust' ? '—' : `<button data-action="usdt-receipt" data-id="${m.id}" class="amount-link" title="الفاتورة">${moneyCur(m.total, m.currency)}</button>`}${m.kind !== 'adjust' ? `<div class="text-[10px] text-slate-400 font-sans">${m.pct}% · سعر ${fmt(m.rate, 2)}${m.discount ? ` · خصم ${fmt(m.discount)}` : ''}${m.finalAdjust ? ` · تعديل ${signedAmount(m.finalAdjust)}` : ''}</div>` : ''}</td>
                    <td class="p-3 whitespace-nowrap">${st ? `<span class="badge ${PAY_STATE[st.state].cls}">${PAY_STATE[st.state].label}</span>${st.state === 'partial' ? `<div class="text-[10px] text-slate-500 mt-0.5">الباقي ${moneyCur(st.remaining, m.currency)}</div>` : ''}` : ''}</td>
                    <td class="profit-only p-3 font-mono font-black num whitespace-nowrap ${m.profitIls >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${m.kind === 'adjust' ? '' : `${m.profitIls >= 0 ? '+' : ''}${fmt(m.profitIls)} ₪`}</td>
                    <td class="p-3 text-center whitespace-nowrap">
                        ${st && st.state !== 'paid' ? `<button data-action="usdt-pay" data-id="${m.id}" class="text-white bg-slate-900 hover:bg-slate-800 font-bold text-xs px-2.5 py-1 rounded-lg">${m.kind === 'deposit' ? 'استلام' : 'دفع'}</button>` : ''}
                        ${m.kind !== 'adjust' ? `<button data-action="usdt-receipt" data-id="${m.id}" class="text-slate-700 font-bold text-xs px-2.5 py-1 bg-slate-100 rounded-lg">فاتورة</button>` : ''}
                        <button data-action="edit-usdt" data-id="${m.id}" class="text-blue-600 font-bold text-xs px-2.5 py-1 bg-blue-50 rounded-lg">تعديل</button>
                        <button data-action="delete-usdt" data-id="${m.id}" class="text-slate-400 hover:text-red-600 p-1 font-bold" title="حذف">✕</button>
                    </td>
                </tr>`;
        }).join('');
}

// ---------- اختيار الزبون (نفس قائمة الحاسبة) ----------
let usdtPickerIndex = -1;

function updateUsdtCustomerStatus() {
    const q = normName($('us_customer').value);
    const linked = customers.find(c => c.id === $('us_customer_id').value);
    if (linked && normName(linked.name) !== q) $('us_customer_id').value = '';
    const known = customers.find(c => c.id === $('us_customer_id').value) || customers.find(c => normName(c.name) === q);
    $('us_customer_status').textContent = known ? '✓ زبون مسجل' : q ? '+ زبون جديد' : '';
    $('us_customer_status').className = 'text-[10px] font-bold ' + (known ? 'text-emerald-600' : 'text-blue-600');
    const adjust = $('us_kind').value === 'adjust';
    updateCustomerPhoneField('us', known, adjust ? '' : q);
    syncNewPayoutField('us', !known && !!q && $('us_kind').value === 'withdraw');
}

function onUsdtCustomerInput() {
    updateUsdtCustomerStatus();
    usdtPickerIndex = -1;
    $('us-customer-dropdown').innerHTML = customerPickerHtml($('us_customer').value.trim(), 'usdt-select-customer');
    $('us-customer-dropdown').classList.remove('hidden');
}

function closeUsdtCustomerPicker() {
    $('us-customer-dropdown').classList.add('hidden');
}

function selectUsdtCustomer(id) {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    $('us_customer').value = c.name;
    $('us_customer_id').value = c.id;
    $('us_phone').value = '';
    updateUsdtCustomerStatus();
    closeUsdtCustomerPicker();
    $('us_amount').focus();
}

function onUsdtCustomerKey(e) {
    usdtPickerIndex = pickerKeyNav(e, $('us-customer-dropdown'), usdtPickerIndex, selectUsdtCustomer, closeUsdtCustomerPicker);
}

// ---------- نموذج حركة USDT ----------
function openUsdtModal(kind = 'deposit', m = null) {
    if (!walletsReady()) return;
    editingUsdtId = m ? m.id : null;
    $('usdtModalTitle').textContent = m ? `تعديل حركة USDT ${receiptNo(m)}` : 'حركة USDT جديدة';
    setHistoryButton('us_history', m?.id);
    $('us_network').innerHTML = usdtNetworks().map(n => `<option value="${escapeHtml(n.name)}" data-fee="${toNum(n.fee, 0)}">${escapeHtml(n.name)} · ${fmt(toNum(n.fee, 0))}$</option>`).join('');
    $('us_customer').value = m ? m.customerName : '';
    $('us_customer_id').value = m ? m.customerId : '';
    $('us_phone').value = '';
    updateUsdtCustomerStatus();
    closeUsdtCustomerPicker();
    $('us_amount').value = m ? Math.abs(m.amount) || '' : '';
    $('us_adjust_dir').value = m && m.kind === 'adjust' && m.amount < 0 ? 'out' : 'in';
    $('us_date').value = m ? m.date : localDateStr();
    $('us_note').value = m ? m.note : '';
    // الخصم القديم صار تعديلاً سالباً على النهائي
    $('us_final_adjust').value = m ? (m.finalAdjust || (m.discount ? -m.discount : '')) : '';
    $('us_money').value = m && m.fixedTotal ? m.fixedTotal : '';
    $('us_currency').value = m ? m.currency : 'ILS';
    if (m && m.network) $('us_network').value = m.network;
    $('us_fee').value = m ? m.networkFee : '';
    setUsdtKind(m ? m.kind : kind, { keepValues: !!m });
    if (m) {
        $('us_pct').value = m.pct;
        $('us_rate').value = m.rate;
    }
    updateUsdtPreview();
    openModal('usdtModal');
    $(m && m.kind === 'adjust' ? 'us_amount' : 'us_customer').focus();
}

function setUsdtKind(kind, { keepValues = false } = {}) {
    $('us_kind').value = kind;
    document.querySelectorAll('#us_kinds [data-kind]').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
    const adjust = kind === 'adjust';
    $('us_trade_fields').classList.toggle('hidden', adjust);
    $('us_adjust_fields').classList.toggle('hidden', !adjust);
    $('us_customer_wrap').classList.toggle('hidden', adjust);
    $('us_money_wrap').classList.toggle('hidden', adjust);
    $('us_deposit_fields').classList.toggle('hidden', kind !== 'deposit');
    $('us_final_adjust_wrap').classList.toggle('hidden', adjust);
    $('us_copy').classList.toggle('hidden', adjust);
    updateUsdtCustomerStatus();
    $('us_amount_label').textContent = adjust ? 'كمية USDT' : kind === 'deposit' ? 'المبلغ الذي يريده الزبون (USDT)' : 'المبلغ الذي أرسله الزبون (USDT)';
    $('us_rate_label').textContent = kind === 'deposit' ? 'سعر الشراء' : 'سعر البيع';
    if (!keepValues) {
        const { sell, buy } = sellBuyRates();
        $('us_rate').value = kind === 'deposit' ? buy : sell;
        $('us_pct').value = usdtPctFor(kind, toNum($('us_amount').value, 0));
        if (kind === 'deposit' && $('us_fee').value === '') $('us_fee').value = toNum($('us_network').selectedOptions[0]?.dataset.fee, 0);
        $('us_final_adjust').value = '';
        usdtPctTouched = false;
    }
    setUsdtCurrency($('us_currency').value);
}

function updateUsdtMoneyLabel() {
    const cur = $('us_currency').value === 'USD' ? 'بالدولار' : 'بالشيكل';
    $('us_money_label').textContent = $('us_kind').value === 'withdraw' ? `أو اللي بدّه ياخذه ${cur}` : `أو اللي بدّه يدفعه ${cur}`;
}

function setUsdtCurrency(cur) {
    $('us_currency').value = cur;
    document.querySelectorAll('#us_currencies [data-cur]').forEach(b => b.classList.toggle('active', b.dataset.cur === cur));
    updateUsdtMoneyLabel();
    updateUsdtPreview();
}

function readUsdtForm() {
    const kind = $('us_kind').value;
    const amount = toNum($('us_amount').value, 0);
    return {
        fixedTotal: kind === 'adjust' ? 0 : Math.max(0, toNum($('us_money').value, 0)),
        kind,
        amount: kind === 'adjust' && $('us_adjust_dir').value === 'out' ? -amount : amount,
        network: kind === 'deposit' ? $('us_network').value : '',
        networkFee: toNum($('us_fee').value, 0),
        pct: toNum($('us_pct').value, 0),
        rate: toNum($('us_rate').value, 0),
        currency: $('us_currency').value,
        discount: 0,
        finalAdjust: kind === 'adjust' ? 0 : readFinalAdjust('us'),
        settle: editingUsdtId ? usdtMoves.find(m => m.id === editingUsdtId)?.settle || 0 : 0
    };
}

// الفورم بعد حساب الكمية من المبلغ المتفق عليه (إن كُتب)، والنسبة حسب الشريحة (الإيداع والسحب)
function resolvedUsdtForm() {
    const f = readUsdtForm();
    const autoPct = f.kind !== 'adjust' && !usdtPctTouched && !editingUsdtId;
    if (f.fixedTotal > 0) Object.assign(f, usdtForMoney(f, autoPct), { finalAdjust: 0 });
    else if (autoPct) f.pct = usdtPctFor(f.kind, f.amount);
    f.autoPct = autoPct;
    return f;
}

function updateUsdtPreview() {
    const f = resolvedUsdtForm();
    if (f.kind !== 'adjust' && f.fixedTotal > 0) $('us_amount').value = f.amount || '';
    if (f.autoPct) $('us_pct').value = f.pct;
    const tiered = f.kind !== 'adjust' && usdtKindTiers(f.kind).length > 1;
    $('us_pct_label').textContent = 'النسبة %' + (f.autoPct && tiered ? ' · حسب الشريحة' : '');
    // أي شريحة انطبقت (بس إذا في شرائح والنسبة تلقائية)
    const tierMin = usdtKindTiers(f.kind).filter(t => f.amount >= t.min).pop()?.min || 0;
    const tierLine = f.autoPct && tiered && f.amount > 0
        ? `<div class="text-[11px] text-slate-500 profit-only">الشريحة: ${tierRangeText(usdtKindTiers(f.kind), tierMin, '$')} ← ${round2(f.pct)}%</div>`
        : '';
    const r = computeUsdt({ ...f, amount: f.kind === 'adjust' ? f.amount : Math.max(0, f.amount) });
    const cur = f.currency;
    syncFinalAdjustField('us', f.kind === 'deposit' ? 1 : -1, f.fixedTotal > 0);
    const adjLine = finalAdjustLine(f.finalAdjust, cur, f.kind === 'deposit' ? 1 : -1, cur === 'USD' ? f.rate : 1);
    const balAfter = round2(usdtBalance() - (editingUsdtId ? usdtMoves.find(m => m.id === editingUsdtId)?.usdtEffect || 0 : 0) + r.usdtEffect);
    let lines;
    if (f.kind === 'adjust') {
        lines = `<div class="flex justify-between"><span>رصيد USDT بعد الحركة</span><b>${fmt(balAfter)}</b></div>`;
    } else if (f.kind === 'deposit') {
        lines = `
            <div class="flex justify-between"><span>المبلغ + النسبة ${f.pct}% + الشبكة ${fmt(f.networkFee)}$</span><b>${fmt(f.amount * (1 + f.pct / 100) + f.networkFee)} $</b></div>
            ${tierLine}
            ${cur === 'ILS' ? `<div class="flex justify-between"><span>× سعر الشراء ${f.rate}</span><b>${fmt(r.gross)} ₪</b></div>` : ''}
            ${fixedNote(f, r.total - r.gross)}
            ${adjLine}
            <div class="flex justify-between text-base mt-1 pt-1 border-t border-slate-200"><span class="font-bold">المطلوب من الزبون</span><b class="text-slate-900">${moneyCur(r.total, cur)}</b></div>
            <div class="flex justify-between text-[11px] text-slate-500"><span>من رصيد USDT: −${fmt(-r.usdtEffect)} (الباقي ${fmt(balAfter)})</span><span class="profit-only">الربح ${fmt(r.profitIls)} ₪</span></div>`;
    } else {
        lines = `
            <div class="flex justify-between"><span>المبلغ − النسبة ${f.pct}%</span><b>${fmt(f.amount * (1 - f.pct / 100))} $</b></div>
            ${tierLine}
            ${cur === 'ILS' ? `<div class="flex justify-between"><span>× سعر البيع ${f.rate}</span><b>${fmt(r.gross)} ₪</b></div>` : ''}
            ${fixedNote(f, r.gross - r.total)}
            ${adjLine}
            <div class="flex justify-between text-base mt-1 pt-1 border-t border-slate-200"><span class="font-bold">ندفع للزبون</span><b class="text-slate-900">${moneyCur(r.total, cur)}</b></div>
            <div class="flex justify-between text-[11px] text-slate-500"><span>رصيد USDT: +${fmt(r.usdtEffect)} (يصبح ${fmt(balAfter)})</span><span class="profit-only">الربح ${fmt(r.profitIls)} ₪</span></div>`;
    }
    $('us_preview').innerHTML = lines;
}

// زر "نسخ" جنب حفظ: نص قصير للزبون قبل الحفظ (بطلب عماد 2026-10-21)
// "إيداع 200$ USDT" ثم الشبكة (للإيداع) ثم المبلغ، بدون أغورات إلا إذا فيه (636 ₪ / 636.55 ₪)
function usdtQuoteText() {
    const f = resolvedUsdtForm();
    if (f.kind === 'adjust' || !(f.amount > 0)) return '';
    const r = computeUsdt({ ...f, amount: Math.max(0, f.amount) });
    return [
        `${f.kind === 'deposit' ? 'إيداع' : 'سحب'} ${fmtTrim(f.amount)}$ USDT`,
        f.kind === 'deposit' ? f.network : '',
        `${fmtTrim(r.total)} ${CUR_SYM[f.currency] || '₪'}`
    ].filter(Boolean).join('\n');
}

async function copyUsdtQuote(btn) {
    const text = usdtQuoteText();
    if (!text) return showToast('تنبيه', 'اكتب المبلغ أول', 'warning');
    if (!(await copyText(text))) return showToast('ما زبط النسخ', 'المتصفح منع النسخ، انسخه بإيدك', 'warning');
    btn.classList.add('copied');
    btn.textContent = '✓ تم النسخ';
    clearTimeout(btn._copiedTimer);
    btn._copiedTimer = setTimeout(() => { btn.classList.remove('copied'); btn.textContent = '⧉ نسخ'; }, 1400);
    showToast('تم النسخ', text.replace(/\n/g, ' · '), 'success');
}

// ---------- تعديل ± على المبلغ النهائي (USDT والجنيه) ----------
// prefix: us أو eg. dir: 1 الزبون بيدفعلنا (الموجب بيزيد الربح)، −1 إحنا بندفعله (الموجب بينقص الربح)
const signedAmount = (v, cur) => `${v > 0 ? '+' : '−'}${cur ? moneyCur(Math.abs(v), cur) : fmt(Math.abs(v))}`;

function readFinalAdjust(prefix) {
    return sheetSupportsFinalAdjust ? round2(toNum($(prefix + '_final_adjust').value, 0)) : 0;
}

// الأزرار بتضيف على الخانة
function bumpFinalAdjust(id, step) {
    const el = $(id);
    if (!el || el.disabled) return;
    el.value = String(round2(toNum(el.value, 0) + step) || '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

function syncFinalAdjustField(prefix, dir, fixed) {
    const off = fixed || !sheetSupportsFinalAdjust;
    const wrap = $(prefix + '_final_adjust_wrap');
    wrap.querySelectorAll('input, button').forEach(el => { el.disabled = off; });
    wrap.classList.toggle('opacity-50', off);
    $(prefix + '_final_adjust_hint').textContent = !sheetSupportsFinalAdjust
        ? 'حدّث سكربت Google Sheets لتفعيل التعديل'
        : fixed ? 'كاتب المبلغ المتفق عليه بالضبط، ما في داعي للتعديل'
            : dir > 0 ? 'موجب = الزبون بيدفع أكثر (ربح أكثر) · سالب = خصم للزبون (ربح أقل)'
                : 'موجب = بنعطيه أكثر (ربح أقل) · سالب = بنعطيه أقل (ربح أكثر)';
}

// سطر المعاينة: التعديل وأثره على الربح (k: سعر الدولار إذا الدفع بالدولار، حتى يطلع الربح بالشيكل)
function finalAdjustLine(adj, cur, dir, k) {
    if (!adj) return '';
    const profit = round2(dir * adj * k);
    return `<div class="flex justify-between text-blue-700"><span>تعديل يدوي على النهائي <span class="profit-only text-[11px] text-slate-500">(الربح ${signedAmount(profit, 'ILS')})</span></span><b>${signedAmount(adj, cur)}</b></div>`;
}

// المبلغ المتفق عليه: الكمية مقرّبة لنصف، والفرق يضاف لربحنا
function fixedNote(f, diff) {
    if (!(f.fixedTotal > 0)) return '';
    if (!(f.amount > 0)) return '<div class="text-amber-700 font-bold">المبلغ قليل، ما بيكفي لأي كمية USDT</div>';
    return `<div class="flex justify-between text-emerald-700"><span>تقريب الـ USDT لـ ${fmt(f.amount)} (لصالحنا)</span><b>+ ${moneyCur(Math.max(0, round2(diff)), f.currency)}</b></div>`;
}

async function saveUsdt(e) {
    e.preventDefault();
    if (!walletsReady()) return;
    const f = resolvedUsdtForm();
    if (!(Math.abs(f.amount) > 0)) return showToast('تنبيه', 'اكتب المبلغ', 'warning');
    const name = $('us_customer').value.trim();
    if (f.kind !== 'adjust' && !name) return showToast('تنبيه', 'اكتب اسم الزبون', 'warning');
    if (f.kind !== 'adjust' && f.currency === 'ILS' && !(f.rate > 0)) return showToast('تنبيه', 'سعر الدولار غير صحيح', 'warning');
    const existing = usdtMoves.find(m => m.id === editingUsdtId);
    // الزبون المختار من القائمة، أو بنفس الاسم، أو زبون جديد (مثل الحاسبة)
    const ops = [];
    let customer = null;
    if (f.kind !== 'adjust') {
        customer = customers.find(c => c.id === $('us_customer_id').value) || customers.find(c => normName(c.name) === normName(name));
        const phone = readCustomerPhone('us', customer?.id);
        if (phone === null) return;
        if (!customer) {
            customer = normalizeCustomer({ id: newCustomerId(), name, phone, payout: 'كاش', provider: '', account: '', ...readNewPayout('us'), createdAt: $('us_date').value || localDateStr() });
            customers.unshift(customer);
            ops.push({ action: 'upsert_customer', customer });
        } else if (phone) {
            customer.phone = phone;
            ops.push({ action: 'upsert_customer', customer });
        }
    }
    const move = normalizeUsdt({
        ...f,
        id: existing ? existing.id : nextId(),
        date: $('us_date').value || localDateStr(),
        customerId: customer ? customer.id : '',
        customerName: customer ? customer.name : '',
        address: existing ? existing.address : '',
        note: $('us_note').value,
        settle: existing ? existing.settle : 0
    });
    if (editLocked('usdtMoves', existing && { ...existing }, move)) return lockWarn();
    if (existing) move.serial = existing.serial;
    if (existing) Object.assign(existing, move); else usdtMoves.push(move);
    const noteOps = existing ? relinkNotesOps('usdt', move.id, usdtPayNote(move), isUsdtPayNote) : [];
    queueOps(...ops, { action: 'upsert_usdt', move }, ...noteOps);
    closeModal('usdtModal');
    renderCustomersTable();
    renderUsdtPage();
    if (noteOps.length) renderAccountsPage();
    updateReportsData();
    const status = await flushOutbox();
    // الفاتورة ما بتفتح لحالها (بطلب عماد): بتنفتح من المبلغ بالسطر أو زر "فاتورة"
    showToast(existing ? 'تم تعديل الحركة' : 'تم حفظ الحركة', `${USDT_KINDS[move.kind]} ${fmt(Math.abs(move.amount))} USDT — ${syncResultMessage(status)}`, syncToastType(status));
}

function openUsdtPay(id) {
    const m = usdtMoves.find(x => x.id === id);
    if (!m || m.kind === 'adjust' || !walletsReady()) return;
    const st = usdtPayState(m);
    openPayModal({
        title: m.kind === 'deposit' ? `استلام دفعة إيداع USDT ${receiptNo(m)}` : `دفع سحب USDT ${receiptNo(m)}`,
        subtitle: `${m.customerName} · ${fmt(m.amount)} USDT`,
        currency: m.currency,
        due: round2(m.total - m.settle),
        paid: st.paid,
        dir: usdtDir(m),
        onSave: async (lines, settle) => {
            // تسوية الفرق بتغيّر الحركة نفسها: ممنوعة إذا يومها مقفل
            if (settle && dayLocked(m.date)) return lockWarn();
            const moves = lines.map(l => makeAmove({ accountId: l.accountId, currency: m.currency, amount: usdtDir(m) * l.amount, reason: 'usdt', refType: 'usdt', refId: m.id, note: usdtPayNote(m) }));
            accountMoves.push(...moves);
            const ops = amoveOps(moves);
            if (settle) {
                Object.assign(m, normalizeUsdt({ ...m, settle: round2(m.settle + settle) }));
                ops.push({ action: 'upsert_usdt', move: m });
            }
            queueOps(...ops);
            renderUsdtPage();
            renderAccountsPage();
            updateReportsData();
            if (m.kind === 'withdraw') warnNegative(lines, m.currency);
            const status = await flushOutbox();
            const after = usdtPayState(m);
            showToast(after.state === 'paid' ? 'الحركة مدفوعة بالكامل ✓' : 'تم تسجيل الدفعة', `${m.customerName}${after.remaining ? ` · الباقي ${moneyCur(after.remaining, m.currency)}` : ''}${settle ? ` · فرق مُسوّى ${moneyCur(settle, m.currency)}` : ''} — ${syncResultMessage(status)}`, syncToastType(status));
        }
    });
}

function deleteUsdtPrompt(id) {
    const m = usdtMoves.find(x => x.id === id);
    if (!m) return;
    const moves = refMoves('usdt', m.id);
    if (dayLocked(m.date) || moves.some(x => dayLocked(x.date))) return lockWarn();
    const extra = moves.length ? ` وستُحذف ${moves.length} دفعة مرتبطة بها من الحسابات` : '';
    showAppConfirm('حذف حركة USDT', `حذف ${USDT_KINDS[m.kind]} ${fmt(Math.abs(m.amount))} USDT${m.customerName ? ' لـ ' + m.customerName : ''}؟${extra}`, async () => {
        usdtMoves = usdtMoves.filter(x => x.id !== id);
        accountMoves = accountMoves.filter(x => !moves.includes(x));
        queueOps(...moves.map(x => ({ action: 'delete_amove', id: x.id })), { action: 'delete_usdt', id });
        renderUsdtPage();
        renderAccountsPage();
        updateReportsData();
        const status = await flushOutbox();
        showToast('تم الحذف', syncResultMessage(status), syncToastType(status));
    });
}

// ---------- إعدادات USDT (الشبكات، شرائح الإيداع والسحب) ----------
function renderUsdtSettings() {
    $('usdt-networks-list').innerHTML = usdtNetworks().map((n, i) => `
        <div class="flex gap-2 items-center">
            <input type="text" data-net="${i}" data-field="name" value="${escapeHtml(n.name)}" class="usdt-set-input flex-1 min-w-0 border border-slate-200 rounded-lg p-2 bg-white font-bold" placeholder="اسم الشبكة">
            <input type="number" step="any" min="0" data-net="${i}" data-field="fee" value="${toNum(n.fee, 0)}" class="usdt-set-input w-24 border border-slate-200 rounded-lg p-2 bg-white font-mono" placeholder="الرسوم $">
            <button type="button" data-action="usdt-net-remove" data-index="${i}" class="text-slate-400 hover:text-red-600 px-2 font-bold">✕</button>
        </div>`).join('');
    $('usdt-deposit-tiers-list').innerHTML = usdtTierRowsHtml('deposit');
    $('usdt-tiers-list').innerHTML = usdtTierRowsHtml('withdraw');
}

// صف لكل شريحة: من كم USDT، والنسبة. أول صف من 0 (حدّه ما بيتغير)
function usdtTierRowsHtml(kind) {
    return usdtKindTiers(kind).map((t, i) => `
        <div class="flex gap-2 items-center text-xs">
            <span class="text-slate-500">من</span>
            <input type="text" inputmode="decimal" autocomplete="off" data-commas data-tier="${i}" data-tkind="${kind}" data-field="min" value="${formatThousands(t.min)}" ${i === 0 ? 'disabled' : ''} aria-label="من كمية USDT" class="usdt-set-input w-24 border border-slate-200 rounded-lg p-2 bg-white font-mono disabled:bg-slate-50">
            <span class="text-slate-500">$ فما فوق ←</span>
            <input type="number" step="any" min="0" data-tier="${i}" data-tkind="${kind}" data-field="pct" value="${t.pct}" aria-label="النسبة %" class="usdt-set-input w-20 border border-slate-200 rounded-lg p-2 bg-white font-bold">
            <span class="text-slate-500">%</span>
            ${i > 0 ? `<button type="button" data-action="usdt-tier-remove" data-kind="${kind}" data-index="${i}" class="text-slate-400 hover:text-red-600 px-2 font-bold" aria-label="حذف الشريحة">✕</button>` : ''}
        </div>`).join('');
}

function onUsdtSettingInput(el) {
    if (el.dataset.net !== undefined) {
        const nets = usdtNetworks().map(n => ({ ...n }));
        const n = nets[toNum(el.dataset.net, -1)];
        if (!n) return;
        n[el.dataset.field] = el.dataset.field === 'fee' ? Math.max(0, toNum(el.value, 0)) : el.value.trim() || n.name;
        globalConfig.usdtNetworks = nets;
        saveAll();
        return;
    }
    if (el.dataset.tier === undefined) return;
    const kind = el.dataset.tkind === 'deposit' ? 'deposit' : 'withdraw';
    const tiers = usdtKindTiers(kind);
    const i = toNum(el.dataset.tier, -1);
    const t = tiers[i];
    if (!t) return;
    const v = toNum(el.value, NaN);
    const bad = (msg) => { showToast('تنبيه', msg, 'warning'); renderUsdtSettings(); };
    if (el.dataset.field === 'min') {
        if (i === 0) return;
        if (!(v > 0)) return bad('حد الشريحة لازم يكون أكبر من صفر');
        if (tiers.some((x, k) => k !== i && Math.abs(x.min - v) < 0.005)) return bad('في شريحة ثانية بنفس الكمية');
        t.min = round2(v);
    } else {
        if (!(v >= 0) || v >= 100) return bad('النسبة لازم تكون من 0 لأقل من 100%');
        t.pct = round2(v);
    }
    saveUsdtTiers(kind, tiers);
}

// السحب: القائمة كاملة. الإيداع: أول شريحة بالنسبة الأساسية والباقي بالشرائح (إعدادات مشتركة بالشيت)
function saveUsdtTiers(kind, tiers) {
    const sorted = [...tiers].sort((a, b) => a.min - b.min).map(t => ({ min: t.min, pct: t.pct }));
    if (kind === 'deposit') {
        globalConfig.usdtDepositPct = sorted[0].pct;
        globalConfig.usdtDepositTiers = sorted.slice(1);
    } else {
        globalConfig.usdtTiers = sorted;
    }
    saveAll();
    renderUsdtSettings();
}

function addUsdtNetwork() {
    globalConfig.usdtNetworks = [...usdtNetworks(), { name: 'شبكة جديدة', fee: 0 }];
    saveAll();
    renderUsdtSettings();
}

function removeUsdtNetwork(i) {
    globalConfig.usdtNetworks = usdtNetworks().filter((_, k) => k !== i);
    saveAll();
    renderUsdtSettings();
}

function addUsdtTier(kind) {
    const tiers = usdtKindTiers(kind);
    const last = tiers[tiers.length - 1];
    const step = kind === 'deposit' ? 400 : 1000;
    tiers.push({ min: (last?.min || 0) + step, pct: Math.max(0, round2((last?.pct ?? 3) - (kind === 'deposit' ? 0.5 : 1))) });
    saveUsdtTiers(kind, tiers);
}

function removeUsdtTier(kind, i) {
    if (!(i > 0)) return;
    saveUsdtTiers(kind, usdtKindTiers(kind).filter((_, k) => k !== i));
}
