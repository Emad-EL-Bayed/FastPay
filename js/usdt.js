'use strict';

// فاست باي — USDT: الحساب، الصفحة، نموذج الحركة، الدفعات، الإعدادات
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= USDT =================
// الحركات من ورقة "حركات USDT"؛ رصيد USDT = مجموع أثر كل حركة
let usdtMoves = [];

const USDT_KINDS = { deposit: 'إيداع', withdraw: 'سحب', adjust: 'تعديل رصيد', transfer: 'تحويل بين المحافظ' };
// إيداع وسحب = شغل مع زبون (ربح، فاتورة، دفع). التعديل والتحويل بين محافظنا لا
const usdtTrade = (m) => m.kind === 'deposit' || m.kind === 'withdraw';
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

function normalizeUsdt(m) {
    const kind = USDT_KINDS[m?.kind] ? m.kind : 'deposit';
    const trade = kind === 'deposit' || kind === 'withdraw';
    const amount = round2(toNum(m?.amount, 0));
    const fixedTotal = trade ? Math.max(0, round2(toNum(m?.fixedTotal, 0))) : 0;
    const base = {
        id: toNum(m?.id, 0),
        serial: toSerial(m?.serial),
        date: String(m?.date ?? '').slice(0, 10),
        kind,
        customerId: String(m?.customerId ?? '').trim(),
        customerName: String(m?.customerName ?? '').trim(),
        amount: kind === 'adjust' ? amount : Math.max(0, amount),
        network: kind === 'deposit' || kind === 'transfer' ? String(m?.network ?? '').trim() : '',
        networkFee: kind === 'deposit' || kind === 'transfer' ? Math.max(0, toNum(m?.networkFee, 0)) : 0,
        pct: trade ? Math.max(0, toNum(m?.pct, 0)) : 0,
        rate: Math.max(0, toNum(m?.rate, 0)),
        currency: m?.currency === 'USD' ? 'USD' : 'ILS',
        discount: kind === 'deposit' ? Math.max(0, toNum(m?.discount, 0)) : 0,
        fixedTotal,
        finalAdjust: !trade || fixedTotal > 0 ? 0 : round2(toNum(m?.finalAdjust, 0)),
        settle: trade ? Math.max(0, round2(toNum(m?.settle, 0))) : 0,
        // محفظتنا (محافظ USDT)، وللتحويل: لوين
        walletId: String(m?.walletId ?? '').trim(),
        toWalletId: kind === 'transfer' ? String(m?.toWalletId ?? '').trim() : '',
        address: String(m?.address ?? '').trim(),
        note: String(m?.note ?? '').trim(),
        trackToken: String(m?.trackToken ?? '').trim(),
        createdBy: String(m?.createdBy ?? '').trim(),
        updatedBy: String(m?.updatedBy ?? '').trim()
    };
    return { ...base, ...computeUsdt(base) };
}

const usdtDir = (m) => (m.kind === 'deposit' ? 1 : -1);

function usdtPayState(m) {
    if (!usdtTrade(m)) return null;
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
    $('usdt-balance').classList.toggle('neg', bal < -0.004);
    // الرصيد الإجمالي: خلفية خضرا خفيفة لما يكون موجب وحمرا لما يكون سالب
    const hero = $('usdt-balance').closest('.usdt-hero');
    hero?.classList.toggle('pos', bal > 0.004);
    hero?.classList.toggle('neg', bal < -0.004);
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
    const walletFilter = $('usdt_wallet_filter').value;
    const inWallet = (m) => walletFilter === 'ALL' || (walletFilter === 'none' ? !m.walletId : m.walletId === walletFilter || m.toWalletId === walletFilter);
    renderUsdtWallets();
    const list = usdtMoves
        .filter(m => (kindFilter === 'ALL' || m.kind === kindFilter) && (!monthFilter || m.date.startsWith(monthFilter)) && (!dateFilter || m.date === dateFilter) && inWallet(m))
        .filter(m => !q || (serialHit ? String(m.serial) === qNo : normName(m.customerName).includes(q) || String(m.id).includes(qNo) || normName(m.address).includes(q)))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
        .slice(0, 300);

    $('usdt-body').innerHTML = list.length === 0
        ? `<tr><td colspan="10" class="p-6 text-center text-xs text-slate-400">${emptyMessage(usdtMoves.length, 'لا توجد نتائج', 'لا توجد حركات USDT بعد')}</td></tr>`
        : list.map(m => {
            const st = usdtPayState(m);
            const kindCls = m.kind === 'deposit' ? 'bg-rose-50 text-rose-700' : m.kind === 'withdraw' ? 'bg-emerald-50 text-emerald-700' : m.kind === 'transfer' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600';
            const trade = usdtTrade(m);
            const w = usdtWallets.find(x => x.id === m.walletId);
            const effect = `${m.usdtEffect >= 0 ? '+' : '−'}${fmt(Math.abs(m.usdtEffect))}`;
            return `
                <tr class="hover:bg-slate-50">
                    <td class="p-3 text-[10px] text-slate-400 font-mono whitespace-nowrap" title="${auditTitle(m)}${m.serial ? ` · رقم الحركة ${m.id}` : ''}">${receiptNo(m)}</td>
                    <td class="p-3 text-xs text-slate-500 whitespace-nowrap num">${escapeHtml(m.date)}${lockMark(m.date)}</td>
                    <td class="p-3 whitespace-nowrap"><span class="inline-flex items-center gap-1.5">${w && m.kind !== 'transfer' ? usdtWalletLogo(w, 'xs') : ''}<span class="badge ${kindCls}">${m.kind === 'transfer' ? 'تحويل' : USDT_KINDS[m.kind]}</span></span></td>
                    <td class="p-3 font-bold text-slate-900 whitespace-nowrap">${m.kind === 'transfer'
                        ? usdtTransferLabel(m)
                        : trade && m.customerName
                        ? `<button data-action="open-customer" data-id="${escapeHtml(m.customerId)}" data-name="${escapeHtml(m.customerName)}" class="font-bold hover:text-blue-700 hover:underline text-right" title="ملف الزبون">${escapeHtml(m.customerName)}</button>`
                        : escapeHtml(!trade ? m.note || '—' : '—')}</td>
                    <td class="p-3 font-mono font-bold num whitespace-nowrap">${fmt(Math.abs(m.amount))} <span class="text-[10px] text-slate-400">USDT</span>${m.network ? `<div class="text-[10px] text-slate-400 font-sans">${escapeHtml(m.network)} · ${fmt(m.networkFee)}$</div>` : ''}</td>
                    <td class="p-3 font-mono text-xs num whitespace-nowrap ${m.usdtEffect >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${effect}</td>
                    <td class="p-3 font-mono font-black num whitespace-nowrap">${!trade ? '—' : `<button data-action="usdt-receipt" data-id="${m.id}" class="amount-link" title="الفاتورة">${moneyCur(m.total, m.currency)}</button>`}${trade ? `<div class="text-[10px] text-slate-400 font-sans">${m.pct}% · سعر ${fmt(m.rate, 2)}${m.discount ? ` · خصم ${fmt(m.discount)}` : ''}${m.finalAdjust ? ` · تعديل ${signedAmount(m.finalAdjust)}` : ''}</div>` : ''}</td>
                    <td class="p-3 whitespace-nowrap">${st ? `<span class="badge ${PAY_STATE[st.state].cls}">${PAY_STATE[st.state].label}</span>${st.state === 'partial' ? `<div class="text-[10px] text-slate-500 mt-0.5">الباقي ${moneyCur(st.remaining, m.currency)}</div>` : ''}` : ''}</td>
                    <td class="profit-only p-3 font-mono font-black num whitespace-nowrap ${m.profitIls >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${!trade ? '' : `${m.profitIls >= 0 ? '+' : ''}${fmt(m.profitIls)} ₪`}</td>
                    <td class="p-3 text-center whitespace-nowrap">
                        ${st && st.state !== 'paid' ? `<button data-action="usdt-pay" data-id="${m.id}" class="text-white bg-slate-900 hover:bg-slate-800 font-bold text-xs px-2.5 py-1 rounded-lg">${m.kind === 'deposit' ? 'استلام' : 'دفع'}</button>` : ''}
                        ${trade ? `<button data-action="usdt-receipt" data-id="${m.id}" class="text-slate-700 font-bold text-xs px-2.5 py-1 bg-slate-100 rounded-lg">فاتورة</button>` : ''}
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
    renderUsdtBlackNote();
}

// القائمة السوداء (core.js blacklistHit): الاسم، الجوال، ورقم الزبون المحفوظ أو الجديد
function usdtBlackHit() {
    if ($('us_kind').value === 'adjust') return null;
    const name = $('us_customer').value;
    const known = customers.find(c => c.id === $('us_customer_id').value) || customers.find(c => normName(c.name) === normName(name));
    return blacklistHit({ name, numbers: [$('us_phone').value, $('us_np_account').value, known?.phone, known?.account, known?.bankAccount, known?.iban] });
}

function renderUsdtBlackNote() {
    const hit = usdtBlackHit();
    $('us_black_note').classList.toggle('hidden', !hit);
    if (hit) $('us_black_note').textContent = blackNoteText(hit);
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
    // المحفظة: الحركة القديمة بمحفظتها، والجديدة بالأساسية
    $('us_wallet').value = m ? m.walletId : (defaultUsdtWallet()?.id || '');
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
    renderUsdtWalletPicker();
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
        settle: editingUsdtId ? usdtMoves.find(m => m.id === editingUsdtId)?.settle || 0 : 0,
        walletId: $('us_wallet').value
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

// نفس الحركة انسجلت قبل شوي؟ (بطلب عماد 2026-10-22: سحب لؤي انسجل 4 مرات ورا بعض)
// نفس النوع والزبون والكمية والعملة خلال دقيقتين (رقم الحركة = وقت إنشائها)، زي الحاسبة recentSameTx
const SAME_MOVE_MS = 2 * 60000;
const sameMoveAgo = (m) => { const mins = Math.max(1, Math.round((Date.now() - m.id) / 60000)); return mins === 1 ? 'دقيقة' : mins + ' دقايق'; };

function recentSameUsdt(f, customerId, name) {
    const now = Date.now();
    return latestById(usdtMoves.filter(m => now - m.id < SAME_MOVE_MS && m.id <= now && m.kind === f.kind && m.currency === f.currency
        && Math.abs(Math.abs(m.amount) - Math.abs(f.amount)) < 0.005
        && (f.kind === 'adjust' || (customerId && m.customerId ? m.customerId === customerId : normName(m.customerName) === normName(name)))));
}

const latestById = (list) => list.reduce((best, m) => (!best || m.id > best.id ? m : best), null);

async function saveUsdt(e, sameOk = false, blackOk = false) {
    e.preventDefault();
    if (!walletsReady()) return;
    const f = resolvedUsdtForm();
    if (!(Math.abs(f.amount) > 0)) return showToast('تنبيه', 'اكتب المبلغ', 'warning');
    const name = $('us_customer').value.trim();
    if (f.kind !== 'adjust' && !name) return showToast('تنبيه', 'اكتب اسم الزبون', 'warning');
    if (f.kind !== 'adjust' && f.currency === 'ILS' && !(f.rate > 0)) return showToast('تنبيه', 'سعر الدولار غير صحيح', 'warning');
    // المحفظة إجبارية للحركة الجديدة لما يكون في محافظ (القديمة بدون محفظة بتضل زي ما هي)
    if (!editingUsdtId && usdtWalletsOn() && !f.walletId) return showToast('تنبيه', 'اختار المحفظة', 'warning');
    if (!editingUsdtId && !blackOk) {
        const hit = usdtBlackHit();
        if (hit) return checkBlacklistThen(hit, () => saveUsdt({ preventDefault() {} }, sameOk, true));
    }
    if (!editingUsdtId && !sameOk) {
        const known = customers.find(c => c.id === $('us_customer_id').value) || customers.find(c => normName(c.name) === normName(name));
        const same = recentSameUsdt(f, known?.id || '', name);
        if (same) {
            showAppConfirm('هاي الحركة انسجلت قبل شوي',
                `${USDT_KINDS[same.kind]} ${fmtTrim(Math.abs(same.amount))} USDT${same.customerName ? ' · ' + same.customerName : ''} ${receiptNo(same)} انسجلت قبل ${sameMoveAgo(same)}. بدك تسجلها كمان مرة؟`,
                () => saveUsdt({ preventDefault() {} }, true, blackOk));
            return;
        }
    }
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
    if (!m || !usdtTrade(m) || !walletsReady()) return;
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

// ================= محافظ USDT (بطلب عماد 2026-10-24، ميزة usdtWallets) =================
// ورقة "محافظ USDT": Bybit (الأساسية)، Binance، RedotPay… رصيد كل وحدة من حركات USDT عليها (walletId)، والتحويل بين
// المحافظ حركة kind = transfer: بتطلّع المبلغ من وحدة وبتوصّل المبلغ ناقص الرسوم للثانية (المجموع بينقص الرسوم بس).
// كل محفظة إلها ID وعنوان TRC20 و BEP20 بأزرار نسخ. الأساسية بتنختار لحالها بكل حركة جديدة، وفي وحدة أساسية دايماً.
// الزبون ما بيشوف المحفظة (لا فاتورة ولا تتبّع)
let usdtWallets = [];
let editingUsdtWalletId = null;
let usdtWalletLogoDraft; // undefined = ما تغيّر، '' = بدون صورة، data:… = صورة مرفوعة
let editingUsdtTransferId = null;

const USDT_WALLET_TYPES = {
    bybit: { label: 'Bybit', color: '#ff7a1a' }, // برتقالي (بطلب عماد، كان أصفر زي Binance)
    binance: { label: 'Binance', color: '#f0b90b' },
    redotpay: { label: 'RedotPay', color: '#e30613' },
    other: { label: 'محفظة أخرى', color: '#64748b' }
};
// شعار Bybit و RedotPay مرسوم (Binance من شعارات الخدمات)
const USDT_LOGO_SVG = {
    bybit: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#17181e"/><text x="20" y="24.4" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="10.4" fill="#fff">BYB<tspan fill="#f7a600">I</tspan>T</text></svg>',
    redotpay: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#e30613"/><text x="20" y="28" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="21" fill="#fff">R</text></svg>'
};

const usdtWalletsOn = () => sheetHas('usdtWallets') && usdtWallets.length > 0;

function normalizeUsdtWallet(w) {
    const walletType = USDT_WALLET_TYPES[w?.walletType] ? w.walletType : 'other';
    const logo = String(w?.logo ?? '');
    return {
        id: String(w?.id ?? '').trim(),
        walletType,
        holder: String(w?.holder ?? '').trim(),
        uid: latinDigits(String(w?.uid ?? '')).trim(),
        trc20: String(w?.trc20 ?? '').trim(),
        bep20: String(w?.bep20 ?? '').trim(),
        isDefault: w?.isDefault === true || w?.isDefault === 'yes',
        alertBelow: Math.max(0, toNum(w?.alertBelow, 0)),
        logo: /^data:image\//.test(logo) ? logo : '',
        order: toNum(w?.order, 0),
        note: String(w?.note ?? '').trim(),
        createdAt: String(w?.createdAt ?? '').slice(0, 10)
    };
}

const usdtWalletPayload = (w) => ({ ...w, isDefault: w.isDefault ? 'yes' : 'no', alertBelow: w.alertBelow || '' });
const sortedUsdtWallets = () => usdtWallets.slice().sort((a, b) => (b.isDefault - a.isDefault) || a.order - b.order);
const defaultUsdtWallet = () => usdtWallets.find(w => w.isDefault) || sortedUsdtWallets()[0] || null;

function usdtWalletName(w) {
    const t = usdtWalletTitle(w);
    return t.sub ? `${t.name} · ${t.sub}` : t.name;
}

// اسم المحفظة وسطر تحته: النوع (Bybit) والاسم اللي انكتب، بدون تكرار ("Bybit · Bybit" لما الاسم نفس النوع)
function usdtWalletTitle(w) {
    if (!w) return { name: 'محفظة محذوفة', sub: '' };
    const holder = String(w.holder || '').trim();
    if (w.walletType === 'other') return { name: holder || 'محفظة', sub: '' };
    const label = USDT_WALLET_TYPES[w.walletType].label;
    return { name: label, sub: holder && holder.toLowerCase() !== label.toLowerCase() ? holder : '' };
}

function usdtWalletLogo(w, size = '') {
    const cls = `uw-logo${size ? ' ' + size : ''}`;
    if (w?.logo) return `<img src="${escapeHtml(w.logo)}" alt="" class="${cls}">`;
    const type = w?.walletType || 'other';
    if (type === 'binance') {
        const b = SERVICE_BRANDS.binance;
        return `<span class="${cls}" style="background:#1e2329"><svg viewBox="-4 -4 32 32" aria-hidden="true"><path fill="#${b.hex}" d="${b.d}"/></svg></span>`;
    }
    if (USDT_LOGO_SVG[type]) return `<span class="${cls}">${USDT_LOGO_SVG[type]}</span>`;
    return `<span class="${cls} uw-letter">${escapeHtml((w?.holder || '؟').trim().charAt(0) || '؟')}</span>`;
}

// رصيد كل محفظة ('' = حركات قبل المحافظ)
function usdtWalletBalances() {
    const bal = {};
    const add = (id, v) => { const k = id || ''; bal[k] = round2((bal[k] || 0) + v); };
    usdtMoves.forEach(m => {
        if (m.kind === 'transfer') { add(m.walletId, -m.amount); add(m.toWalletId, m.amount - m.networkFee); }
        else add(m.walletId, m.usdtEffect);
    });
    return bal;
}

function usdtTransferLabel(m) {
    const from = usdtWallets.find(x => x.id === m.walletId), to = usdtWallets.find(x => x.id === m.toWalletId);
    return `<span class="inline-flex items-center gap-1.5">${usdtWalletLogo(from, 'xs')}<span>${escapeHtml(usdtWalletName(from))}</span><span class="text-slate-400">←</span>${usdtWalletLogo(to, 'xs')}<span>${escapeHtml(usdtWalletName(to))}</span></span>${m.networkFee || m.network ? `<span class="block text-[10px] text-slate-400 font-normal">${m.network ? escapeHtml(m.network) + ' · ' : ''}رسوم ${fmtTrim(m.networkFee)} USDT · وصل ${fmtTrim(m.amount - m.networkFee)}</span>` : ''}`;
}

const shortAddr = (v) => (v.length > 16 ? `${v.slice(0, 6)}…${v.slice(-5)}` : v);

function renderUsdtWallets() {
    const on = sheetHas('usdtWallets');
    // السكربت المنشور قديم: القسم بيبين مع سطر بيحكي ليش (كان بيختفي كله وعماد ما عرف شو ناقص)
    $('usdt-wallets-wrap').classList.toggle('hidden', !on && dataState !== 'ready');
    $('usdt-wallet-new-btn').classList.toggle('hidden', !on);
    $('usdt_wallet_filter').classList.toggle('hidden', !usdtWalletsOn());
    if (!on) {
        $('usdt-transfer-btn').classList.add('hidden');
        $('usdt-wallets-loose').classList.add('hidden');
        $('usdt-wallets').innerHTML = '<p class="col-span-full text-xs font-bold text-amber-700">المحافظ بتشتغل بعد ما تنشر سكربت Google Sheets الجديد: الصق السكربت كله، وبعدين نشر ← إدارة عمليات النشر ← ✏️ ← إصدار جديد، وارجع افتح البرنامج.</p>';
        return;
    }
    const bal = usdtWalletBalances();
    const list = sortedUsdtWallets();
    // فلتر المحفظة بالسجل
    const sel = $('usdt_wallet_filter');
    const cur = sel.value || 'ALL';
    sel.innerHTML = '<option value="ALL">كل المحافظ</option>' + list.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(usdtWalletName(w))}</option>`).join('')
        + (usdtMoves.some(m => !m.walletId) ? '<option value="none">بدون محفظة</option>' : '');
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'ALL';
    $('usdt-transfer-btn').classList.toggle('hidden', list.length < 2);
    // البطاقات بتتوزع على عرض الصفحة: 2 أو 3 بالسطر على الكمبيوتر (بطلب عماد 2026-10-24)
    $('usdt-wallets').style.setProperty('--uw-cols', Math.min(3, Math.max(2, list.length)));
    $('usdt-wallets').innerHTML = list.length ? list.map(w => {
        const b = bal[w.id] || 0;
        const low = w.alertBelow > 0 && b < w.alertBelow;
        const t = usdtWalletTitle(w);
        const fields = USDT_COPY_FIELDS.filter(([f]) => w[f]);
        const id = escapeHtml(w.id);
        return `
            <div class="uw-card${low ? ' low' : ''}${w.isDefault ? ' main' : ''}" style="--uw:${USDT_WALLET_TYPES[w.walletType].color}">
                <div class="uw-top">
                    ${usdtWalletLogo(w, 'lg')}
                    <div class="uw-title">
                        <b>${escapeHtml(t.name)}</b>
                        ${t.sub ? `<span>${escapeHtml(t.sub)}</span>` : ''}
                    </div>
                    ${w.isDefault ? '<span class="uw-main-chip">★ الأساسية</span>' : ''}
                </div>
                <div class="uw-bal">
                    <span class="uw-bal-label">الرصيد${low ? '<i class="uw-low">⚠️ قليل</i>' : ''}</span>
                    <div class="uw-amount${b < 0 ? ' neg' : ''}"><bdi class="num count-up">${fmt(b)}</bdi><small>USDT</small></div>
                </div>
                <div class="uw-foot">
                    <span class="uw-nets" dir="ltr">${fields.map(([, tag]) => tag).join(' · ')}</span>
                    <span class="uw-actions">
                        ${fields.length ? `<button type="button" data-action="usdt-wallet-copy-open" data-id="${id}" class="uw-btn">${USDT_COPY_SVG}نسخ</button>` : ''}
                        <button type="button" data-action="edit-usdt-wallet" data-id="${id}" class="uw-btn uw-icon" title="تعديل" aria-label="تعديل المحفظة">${USDT_PEN_SVG}</button>
                    </span>
                </div>
            </div>`;
    }).join('') : `<div class="col-span-full text-xs text-slate-500">ضيف محافظك (Bybit، Binance، RedotPay…) حتى تعرف رصيد كل وحدة، وتنسخ الـ ID والعناوين بكبسة.</div>`;
    const loose = bal[''] || 0;
    $('usdt-wallets-loose').classList.toggle('hidden', !list.length || Math.abs(loose) < 0.005);
    $('usdt-wallets-loose').innerHTML = `حركات قبل المحافظ (بدون محفظة): <bdi dir="ltr">${loose >= 0 ? '+' : '−'}${fmt(Math.abs(loose))}</bdi> USDT`;
}

// اللي بينسخ من المحفظة: [الحقل، الشارة، الوصف بنافذة النسخ]
const USDT_COPY_FIELDS = [['uid', 'ID', 'رقم الحساب (ID)'], ['trc20', 'TRC20', 'عنوان شبكة Tron'], ['bep20', 'BEP20', 'عنوان شبكة BNB Smart Chain']];
const USDT_COPY_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.2"/><path d="M13 4.5A1.5 1.5 0 0 0 11.5 3h-6A2.5 2.5 0 0 0 3 5.5v6A1.5 1.5 0 0 0 4.5 13"/></svg>';
const USDT_PEN_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.6 3.6a1.9 1.9 0 0 1 2.7 2.7L7.2 15.4l-3.6.9.9-3.6z"/><path d="M12.2 5l2.7 2.7"/></svg>';

// زر "نسخ" بالكرت بيفتح نافذة بتختار منها شو تنسخ (بطلب عماد 2026-10-24)
function openUsdtCopy(id) {
    const w = usdtWallets.find(x => x.id === id);
    if (!w) return;
    const t = usdtWalletTitle(w);
    const fields = USDT_COPY_FIELDS.filter(([f]) => w[f]);
    const wid = escapeHtml(w.id);
    $('usdtCopyCard').style.setProperty('--uw', USDT_WALLET_TYPES[w.walletType].color);
    $('uwc_head').innerHTML = `
        ${usdtWalletLogo(w, 'lg')}
        <div class="uw-title">
            <b>${escapeHtml(t.name)}</b>
            <span>${t.sub ? escapeHtml(t.sub) + ' · ' : ''}اختار شو بدك تنسخ</span>
        </div>
        <button type="button" data-action="close-modal" data-modal="usdtCopyModal" class="uwc-close" aria-label="إغلاق">✕</button>`;
    $('uwc_list').innerHTML = fields.map(([f, tag, desc]) => `
        <button type="button" data-action="usdt-wallet-copy" data-id="${wid}" data-field="${f}" class="uwc-row">
            <span class="uwc-tag">${tag}</span>
            <span class="uwc-body"><small>${desc}</small><bdi dir="ltr">${escapeHtml(w[f])}</bdi></span>
            <span class="uwc-ico" aria-hidden="true"><span class="c">${USDT_COPY_SVG}</span><span class="ok">✓</span></span>
        </button>`).join('')
        + (fields.length > 1 ? `<button type="button" data-action="usdt-wallet-copy" data-id="${wid}" data-field="all" class="uwc-all">${USDT_COPY_SVG}نسخ الكل (كل واحد بسطر)</button>` : '');
    openModal('usdtCopyModal');
}

async function copyUsdtWalletField(btn) {
    const w = usdtWallets.find(x => x.id === btn.dataset.id);
    const field = btn.dataset.field;
    if (!w) return;
    let item;
    if (field === 'all') {
        const lines = USDT_COPY_FIELDS.filter(([f]) => w[f]).map(([f, tag]) => `${tag}: ${w[f]}`);
        if (!lines.length) return;
        item = { label: usdtWalletName(w), shown: 'الـ ID والعناوين، كل واحد بسطر', value: lines.join('\n') };
    } else {
        if (!w[field]) return;
        const label = { uid: 'ID', trc20: 'عنوان TRC20', bep20: 'عنوان BEP20' }[field];
        item = { label: `${usdtWalletName(w)} · ${label}`, shown: shortAddr(w[field]), value: w[field] };
    }
    const inModal = !!btn.closest('#usdtCopyModal');
    // من نافذة النسخ: بتتسكّر لحالها بعد ما يبين ✓ (وإذا المتصفح منع النسخ بتضل مفتوحة حتى تنسخه بإيدك)
    if (await copyWithFlash(btn, item) && inModal) setTimeout(() => closeModal('usdtCopyModal'), 550);
}

// اختيار المحفظة بنافذة حركة USDT (أزرار بالشعارات)
function renderUsdtWalletPicker() {
    const show = usdtWalletsOn();
    $('us_wallet_wrap').classList.toggle('hidden', !show);
    if (!show) return;
    const kind = $('us_kind').value;
    $('us_wallet_label').textContent = kind === 'deposit' ? 'طلع من محفظة' : kind === 'withdraw' ? 'وصل على محفظة' : 'المحفظة';
    const sel = $('us_wallet').value;
    $('us_wallets').innerHTML = sortedUsdtWallets().map(w => `
        <button type="button" data-action="us-wallet" data-id="${escapeHtml(w.id)}" class="uw-chip${w.id === sel ? ' active' : ''}" aria-pressed="${w.id === sel}">
            ${usdtWalletLogo(w, 'sm')}<span class="truncate">${escapeHtml(usdtWalletName(w))}</span>
        </button>`).join('');
}

function pickUsdtWallet(id) {
    $('us_wallet').value = id;
    renderUsdtWalletPicker();
}

// ---------- نافذة المحفظة ----------
function openUsdtWalletModal(w = null) {
    if (!walletsReady()) return;
    if (!sheetHas('usdtWallets')) return showToast('حدّث السكربت أولاً', 'محافظ USDT بدها نسخة السكربت الجديدة', 'warning');
    editingUsdtWalletId = w ? w.id : null;
    usdtWalletLogoDraft = undefined;
    $('usdtWalletModalTitle').textContent = w ? `تعديل ${usdtWalletName(w)}` : 'محفظة USDT جديدة';
    $('uw_type').value = w ? w.walletType : (usdtWallets.some(x => x.walletType === 'bybit') ? 'binance' : 'bybit');
    $('uw_holder').value = w ? w.holder : '';
    $('uw_uid').value = w ? w.uid : '';
    $('uw_trc20').value = w ? w.trc20 : '';
    $('uw_bep20').value = w ? w.bep20 : '';
    $('uw_alert').value = w && w.alertBelow ? w.alertBelow : '';
    // وحدة أساسية دايماً: أول محفظة أساسية، والأساسية ما بتنشال إلا لما تعلّم غيرها
    $('uw_default').checked = w ? w.isDefault : !usdtWallets.length;
    $('uw_default').disabled = !!(w && w.isDefault) || !usdtWallets.length;
    $('uw_default_note').textContent = w && w.isDefault ? 'هاي الأساسية. لتغييرها علّم محفظة ثانية كأساسية.' : !usdtWallets.length ? 'أول محفظة بتكون الأساسية.' : 'بتنختار لحالها بكل حركة USDT جديدة.';
    $('uw_opening_wrap').classList.toggle('hidden', !!w);
    $('uw_opening').value = '';
    $('uw_delete').classList.toggle('hidden', !w);
    renderUsdtWalletTypeChips();
    openModal('usdtWalletModal');
    $('uw_holder').focus();
}

function renderUsdtWalletTypeChips() {
    const type = $('uw_type').value;
    const existing = usdtWallets.find(x => x.id === editingUsdtWalletId);
    const logo = usdtWalletLogoDraft !== undefined ? usdtWalletLogoDraft : existing?.logo || '';
    $('uw_types').innerHTML = Object.entries(USDT_WALLET_TYPES).map(([k, t]) => `
        <button type="button" data-action="uw-type" data-type="${k}" class="uw-chip${k === type ? ' active' : ''}" aria-pressed="${k === type}">
            ${usdtWalletLogo({ walletType: k, holder: $('uw_holder').value || t.label }, 'sm')}<span>${t.label}</span>
        </button>`).join('');
    $('uw_logo_preview').innerHTML = usdtWalletLogo({ walletType: type, holder: $('uw_holder').value, logo }, 'lg');
    $('uw_logo_remove').classList.toggle('hidden', !logo);
}

function setUsdtWalletType(type) {
    $('uw_type').value = USDT_WALLET_TYPES[type] ? type : 'other';
    renderUsdtWalletTypeChips();
}

function onUsdtWalletLogoFile(file) {
    cropSquareImage(file, 96, (dataUrl) => {
        if (dataUrl.length > 15000) return showToast('الصورة كبيرة', 'جرّب صورة أبسط أو أصغر', 'warning');
        usdtWalletLogoDraft = dataUrl;
        renderUsdtWalletTypeChips();
    });
}

function removeUsdtWalletLogo() {
    usdtWalletLogoDraft = '';
    $('uw_logo_file').value = '';
    renderUsdtWalletTypeChips();
}

const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const BEP20_RE = /^0x[0-9a-fA-F]{40}$/;

async function saveUsdtWallet(e) {
    e.preventDefault();
    if (!walletsReady() || !sheetHas('usdtWallets')) return;
    const existing = usdtWallets.find(w => w.id === editingUsdtWalletId);
    const trc20 = $('uw_trc20').value.replace(/\s+/g, '');
    const bep20 = $('uw_bep20').value.replace(/\s+/g, '');
    if (trc20 && !TRC20_RE.test(trc20)) { $('uw_trc20').focus(); return showToast('عنوان TRC20 مش صحيح', 'لازم يبدأ بـ T وطوله 34 حرف', 'warning'); }
    if (bep20 && !BEP20_RE.test(bep20)) { $('uw_bep20').focus(); return showToast('عنوان BEP20 مش صحيح', 'لازم يبدأ بـ 0x وبعده 40 حرف', 'warning'); }
    const makeDefault = $('uw_default').checked || !usdtWallets.some(w => w.id !== editingUsdtWalletId);
    const wallet = normalizeUsdtWallet({
        ...(existing || {}),
        id: existing ? existing.id : 'uw' + nextId(),
        walletType: $('uw_type').value,
        holder: $('uw_holder').value.slice(0, 60),
        uid: $('uw_uid').value.replace(/\s+/g, '').slice(0, 60),
        trc20, bep20,
        isDefault: existing?.isDefault || makeDefault,
        alertBelow: $('uw_alert').value,
        logo: usdtWalletLogoDraft !== undefined ? usdtWalletLogoDraft : existing?.logo,
        order: existing ? existing.order : usdtWallets.reduce((m, w) => Math.max(m, w.order), -1) + 1,
        createdAt: existing ? existing.createdAt : localDateStr()
    });
    const ops = [];
    // وحدة أساسية بس
    if (wallet.isDefault) usdtWallets.filter(w => w.id !== wallet.id && w.isDefault).forEach(w => { w.isDefault = false; ops.push({ action: 'upsert_usdt_wallet', wallet: usdtWalletPayload(w) }); });
    if (existing) Object.assign(existing, wallet); else usdtWallets.push(wallet);
    ops.unshift({ action: 'upsert_usdt_wallet', wallet: usdtWalletPayload(wallet) });
    // الرصيد الحالي = تعديل رصيد على المحفظة
    const opening = round2(toNum($('uw_opening').value, 0));
    if (!existing && opening) {
        const move = normalizeUsdt({ id: nextId(), date: localDateStr(), kind: 'adjust', amount: opening, walletId: wallet.id, note: 'رصيد افتتاحي', currency: 'ILS' });
        usdtMoves.push(move);
        ops.push({ action: 'upsert_usdt', move });
    }
    queueOps(...ops);
    closeModal('usdtWalletModal');
    renderUsdtPage();
    const status = await flushOutbox();
    showToast(existing ? 'تم تعديل المحفظة' : 'انضافت المحفظة', `${usdtWalletName(wallet)}${wallet.isDefault ? ' · الأساسية' : ''} — ${syncResultMessage(status)}`, syncToastType(status));
}

function deleteUsdtWalletPrompt() {
    const w = usdtWallets.find(x => x.id === editingUsdtWalletId);
    if (!w) return;
    if (usdtMoves.some(m => m.walletId === w.id || m.toWalletId === w.id)) return showToast('ما بتنحذف', 'عليها حركات USDT. احذف حركاتها أول أو خلّيها.', 'warning');
    showAppConfirm('حذف المحفظة', `حذف ${usdtWalletName(w)}؟`, async () => {
        usdtWallets = usdtWallets.filter(x => x.id !== w.id);
        const ops = [{ action: 'delete_usdt_wallet', id: w.id }];
        // الأساسية انحذفت: اللي بعدها بتصير أساسية
        const next = w.isDefault ? sortedUsdtWallets()[0] : null;
        if (next) { next.isDefault = true; ops.push({ action: 'upsert_usdt_wallet', wallet: usdtWalletPayload(next) }); }
        queueOps(...ops);
        closeModal('usdtWalletModal');
        renderUsdtPage();
        const status = await flushOutbox();
        showToast('انحذفت المحفظة', syncResultMessage(status), syncToastType(status));
    });
}

// ---------- التحويل بين المحافظ ----------
function openUsdtTransfer(m = null) {
    if (!walletsReady()) return;
    if (usdtWallets.length < 2) return showToast('بدك محفظتين', 'ضيف محفظة ثانية أول', 'warning');
    editingUsdtTransferId = m ? m.id : null;
    const list = sortedUsdtWallets();
    const from = m ? m.walletId : list[0].id;
    $('ut_from').value = from;
    $('ut_to').value = m ? m.toWalletId : list.find(w => w.id !== from).id;
    $('ut_amount').value = m ? m.amount : '';
    // الجديد: نفس شبكة آخر تحويل (أو أول شبكة) ورسومها؛ الخانة بتنكتب بإيدك
    const last = m || usdtMoves.filter(x => x.kind === 'transfer').sort((a, b) => b.id - a.id)[0];
    const net = usdtNetworks().find(n => n.name === last?.network) || (last && !last.network ? null : usdtNetworks()[0]);
    $('ut_network').value = m ? m.network : net ? net.name : '';
    $('ut_fee').value = m ? m.networkFee || '' : net ? toNum(net.fee, 0) || '' : '';
    $('ut_date').value = m ? m.date : localDateStr();
    $('ut_note').value = m ? m.note : '';
    $('usdtTransferTitle').textContent = m ? 'تعديل التحويل بين المحافظ' : 'تحويل بين المحافظ';
    renderUsdtTransferForm();
    openModal('usdtTransferModal');
    $('ut_amount').focus();
}

function renderUsdtTransferForm() {
    const chips = (field) => sortedUsdtWallets().map(w => `
        <button type="button" data-action="ut-wallet" data-field="${field}" data-id="${escapeHtml(w.id)}" class="uw-chip${$('ut_' + field).value === w.id ? ' active' : ''}">
            ${usdtWalletLogo(w, 'sm')}<span class="truncate">${escapeHtml(usdtWalletName(w))}</span>
        </button>`).join('');
    $('ut_from_chips').innerHTML = chips('from');
    $('ut_to_chips').innerHTML = chips('to');
    const net = $('ut_network').value;
    $('ut_networks').innerHTML = usdtNetworks().map(n => `
        <button type="button" data-action="ut-network" data-name="${escapeHtml(n.name)}" class="tf-chip${net === n.name ? ' active' : ''}">${escapeHtml(n.name)} <b class="num">${fmtTrim(toNum(n.fee, 0))}</b></button>`).join('')
        + `<button type="button" data-action="ut-network" data-name="" class="tf-chip${net === '' ? ' active' : ''}">بدون رسوم <b class="num">0</b></button>`;
    const amount = toNum($('ut_amount').value, 0), fee = toNum($('ut_fee').value, 0);
    const to = usdtWallets.find(w => w.id === $('ut_to').value);
    $('ut_preview').textContent = amount > 0 ? `بيوصل على ${usdtWalletName(to)}: ${fmtTrim(Math.max(0, amount - fee))} USDT${fee ? ` (رسوم ${fmtTrim(fee)})` : ''}` : '';
}

// الشبكة بتعبّي رسومها الافتراضية (من إعدادات USDT)
function pickUsdtTransferNetwork(name) {
    $('ut_network').value = name;
    const n = usdtNetworks().find(x => x.name === name);
    $('ut_fee').value = n ? toNum(n.fee, 0) || '' : '';
    renderUsdtTransferForm();
    $('ut_fee').focus();
}

function pickUsdtTransferWallet(field, id) {
    $('ut_' + field).value = id;
    // نفس المحفظة بالطرفين: الثاني بيتبدّل
    const other = field === 'from' ? 'to' : 'from';
    if ($('ut_' + other).value === id) $('ut_' + other).value = sortedUsdtWallets().find(w => w.id !== id)?.id || '';
    renderUsdtTransferForm();
}

async function saveUsdtTransfer(e) {
    e.preventDefault();
    const from = $('ut_from').value, to = $('ut_to').value;
    const amount = round2(toNum($('ut_amount').value, 0));
    const fee = round2(Math.max(0, toNum($('ut_fee').value, 0)));
    if (!from || !to || from === to) return showToast('تنبيه', 'اختار محفظتين مختلفتين', 'warning');
    if (!(amount > 0)) return showToast('تنبيه', 'اكتب المبلغ اللي طلع', 'warning');
    if (fee >= amount) return showToast('تنبيه', 'الرسوم أكبر من المبلغ', 'warning');
    const existing = usdtMoves.find(m => m.id === editingUsdtTransferId);
    const move = normalizeUsdt({ id: existing ? existing.id : nextId(), date: $('ut_date').value || localDateStr(), kind: 'transfer', amount, network: $('ut_network').value, networkFee: fee, walletId: from, toWalletId: to, note: $('ut_note').value, currency: 'ILS' });
    if (editLocked('usdtMoves', existing && { ...existing }, move)) return lockWarn();
    if (!existing && backdateLocked(move.date)) return lockWarn();
    if (existing) Object.assign(existing, move); else usdtMoves.push(move);
    queueOps({ action: 'upsert_usdt', move });
    closeModal('usdtTransferModal');
    renderUsdtPage();
    const status = await flushOutbox();
    showToast(existing ? 'تم تعديل التحويل' : 'تم التحويل', `${fmtTrim(amount)} USDT: ${usdtWalletName(usdtWallets.find(w => w.id === from))} ← ${usdtWalletName(usdtWallets.find(w => w.id === to))} — ${syncResultMessage(status)}`, syncToastType(status));
}
