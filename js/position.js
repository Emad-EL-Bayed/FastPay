'use strict';

// فاست باي — المركز المالي والديون (صفحة فرعية من التقارير)، وتنبيه الرصيد القليل
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= تنبيه الرصيد القليل =================
// لكل حساب (رصيد الشيكل) ومحفظة جنيه حد تنبيه اختياري (alertBelow، عمود بالشيت). 0 = بدون تنبيه
const isLowBalance = (balance, limit) => limit > 0 && balance < limit;

function lowBalances() {
    const out = [];
    const bal = accountBalances();
    accounts.forEach(a => {
        const b = bal[a.id]?.ILS || 0;
        if (isLowBalance(b, a.alertBelow)) out.push({ key: 'a:' + a.id, name: accountName(a), balance: b, limit: a.alertBelow, unit: '₪' });
    });
    const eb = egpWalletBalances();
    egpWallets.forEach(w => {
        const b = eb[w.id] || 0;
        if (isLowBalance(b, w.alertBelow)) out.push({ key: 'e:' + w.id, name: egpWalletName(w), balance: b, limit: w.alertBelow, unit: 'جنيه' });
    });
    return out;
}

// بعد كل تغيير (saveAll) وكل تحميل: تنبيه لما حساب ينزل تحت حدّه.
// أول مرة بعد التحميل: تنبيه واحد فيه كل القليلة، وبعدها بس الجديد
let lowAlerted = null; // Set بمفاتيح الحسابات اللي نبّهنا عليها
function checkLowBalances() {
    if (dataState !== 'ready') return;
    const low = lowBalances();
    if (lowAlerted === null) {
        if (low.length) showToast('⚠️ رصيد قليل', low.map(x => `${x.name}: ${fmt(x.balance)} ${x.unit}`).join(' · '), 'warning');
    } else {
        low.filter(x => !lowAlerted.has(x.key)).forEach(x => {
            showToast('⚠️ رصيد قليل', `${x.name} صار ${fmt(x.balance)} ${x.unit} (أقل من ${fmt(x.limit, 0)})`, 'warning');
        });
    }
    lowAlerted = new Set(low.map(x => x.key));
}

// ================= الديون =================
// owed: على الزبائن وإلنا (إيداع USDT، إرسال جنيه، بيع جنيه لسا ما ندفعوا)
// owe: علينا للزبائن (حوالات لسا ما انصرفت كاملة، سحب USDT، استقبال جنيه، شراء جنيه)
function debtItems() {
    const owed = [], owe = [];
    ledger.forEach(t => {
        if (t.status === CANCELLED || t.status === 'مكتمل') return;
        const left = round2(txDue(t) - txPaid(t));
        if (left > 0.004) owe.push({ who: t.recipient, customerId: t.customerId, amount: left, cur: t.currency, date: t.date, type: 'tx', id: t.id, no: receiptNo(t), label: `حوالة ${t.status}` });
    });
    usdtMoves.forEach(m => {
        const st = usdtPayState(m);
        if (!st || st.remaining <= 0.004) return;
        (m.kind === 'deposit' ? owed : owe).push({ who: m.customerName, customerId: m.customerId, amount: st.remaining, cur: m.currency, date: m.date, type: 'usdt', id: m.id, no: receiptNo(m), label: `${USDT_KINDS[m.kind]} USDT` });
    });
    egpMoves.forEach(m => {
        const st = egpPayState(m);
        if (!st || st.remaining <= 0.004) return;
        (st.dir > 0 ? owed : owe).push({ who: egpPayWho(m), customerId: m.customerId, amount: st.remaining, cur: m.currency, date: m.date, type: 'egp', id: m.id, no: receiptNo(m), label: EGP_KINDS[m.kind] });
    });
    return { owed, owe };
}

// ================= جاهزية الدفع (بطلب عماد 2026-10-21) =================
// كل اللي لسا لازم ندفعه (نفس "عليك" بالديون: حوالات مش مكتملة، سحب USDT، استقبال/شراء جنيه) مجمّع حسب الجهة اللي
// بينصرف عليها، مقابل رصيد حساباتنا من نفس النوع. الحوالة من جهتها، و USDT والجنيه من جهة الزبون المحفوظة بملفه
const PROVIDER_ACC_TYPE = { 'بال باي': 'palpay', 'جوال باي': 'jawwal', 'بنك فلسطين': 'bank' };
const READY_TYPE_WORD = { tx: 'حوالات', usdt: 'USDT', egp: 'جنيه' };

function payoutAccType(payout, provider) {
    if (payout === 'كاش') return 'cash';
    if (PROVIDER_ACC_TYPE[provider]) return PROVIDER_ACC_TYPE[provider];
    return payout === 'بنكي' ? 'bank' : '';
}

function payoutReadiness() {
    const bal = accountBalances();
    const have = {};
    accounts.forEach(a => ['ILS', 'USD'].forEach(cur => {
        const k = a.accType + '|' + cur;
        have[k] = round2((have[k] || 0) + (bal[a.id]?.[cur] || 0));
    }));
    const groups = new Map();
    debtItems().owe.forEach(i => {
        let type = '', pending = false;
        if (i.type === 'tx') {
            const t = ledger.find(x => x.id === i.id);
            type = t ? payoutAccType(t.payout, t.provider) : '';
            pending = t?.approval === 'pending';
        } else {
            const c = customers.find(x => i.customerId && x.id === i.customerId) || customers.find(x => i.who && normName(x.name) === normName(i.who));
            type = c ? payoutAccType(c.payout, c.provider) : '';
        }
        const key = type + '|' + i.cur;
        if (!groups.has(key)) groups.set(key, { type, cur: i.cur, need: 0, pending: 0, by: {}, items: [] });
        const g = groups.get(key);
        g.need = round2(g.need + i.amount);
        if (pending) g.pending = round2(g.pending + i.amount);
        g.by[i.type] = round2((g.by[i.type] || 0) + i.amount);
        g.items.push({ ...i, pending });
    });
    return [...groups.values()].map(g => {
        const h = g.type ? (have[g.type + '|' + g.cur] || 0) : null;
        return { ...g, have: h, short: g.type ? round2(g.need - h) : 0 };
    }).sort((a, b) => (!a.type) - (!b.type) || b.short - a.short || b.need - a.need);
}

function payoutItemLabel(i) {
    if (i.type === 'tx') return 'حوالة';
    if (i.type === 'usdt') return 'سحب USDT';
    return EGP_KINDS[egpMoves.find(m => m.id === i.id)?.kind] || 'جنيه';
}

function renderPayoutReadiness() {
    const box = $('payout-readiness');
    if (!box) return;
    if (dataState === 'loading') { box.innerHTML = ''; box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const rows = payoutReadiness();
    const shorts = rows.filter(r => r.type && r.short > 0.004).length;
    const missing = [['transactions', 'الحوالات'], ['usdt', 'USDT'], ['egp', 'الجنيه']].filter(([p]) => !hasPerm(p)).map(([, l]) => l);
    const head = `
        <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
                <h3 class="text-sm font-bold text-slate-900">💸 جاهزية الدفع</h3>
                <p class="text-[11px] text-slate-400">اللي لسا لازم تدفعه للزبائن، مقابل رصيد حساباتك من نفس النوع</p>
            </div>
            ${!rows.length ? '' : shorts
                ? `<span class="pr-badge short">⚠️ ناقص ${shorts === 1 ? 'بحساب واحد' : `بـ ${shorts} حسابات`}</span>`
                : '<span class="pr-badge ok">✓ كله مكفّي</span>'}
        </div>`;
    const note = missing.length ? `<p class="text-[11px] text-amber-700">⚠️ مش محسوب حسب صلاحياتك: ${missing.join('، ')}</p>` : '';
    if (!rows.length) {
        box.innerHTML = head + '<p class="text-xs font-bold text-emerald-700">✓ ما في إشي مستني تدفعه هلّق</p>' + note;
        return;
    }
    box.innerHTML = head + '<div class="space-y-2">' + rows.map(r => {
        const t = ACCOUNT_TYPES[r.type] || { label: 'مش محدد', color: '#64748b', soft: '#f1f5f9', ink: '#334155' };
        const by = Object.entries(r.by);
        const breakdown = [
            by.length > 1 ? by.map(([k, v]) => `${READY_TYPE_WORD[k]}: ${moneyCur(v, r.cur)}`).join(' · ') : '',
            r.pending > 0.004 ? `منها ${moneyCur(r.pending, r.cur)} بتستنى موافقتك ⏳` : ''
        ].filter(Boolean).join(' · ');
        const state = !r.type
            ? '<span class="pr-state none">بتختار الحساب وقت الدفع</span>'
            : r.short > 0.004
                ? `<span class="pr-state short">ناقصك ${moneyCur(r.short, r.cur)} ⚠️</span>`
                : '<span class="pr-state ok">✓ مكفّي</span>';
        const items = [...r.items].sort((a, b) => String(a.date).localeCompare(String(b.date))).map(i => `
            <button type="button" data-action="goto-ref" data-type="${i.type}" data-id="${escapeHtml(i.id)}" class="pr-item">
                <span class="min-w-0 truncate">${payoutItemLabel(i)} ${escapeHtml(i.no)} · ${escapeHtml(i.who || '')}${i.pending ? ' ⏳' : ''}</span>
                <b class="num shrink-0">${moneyCur(i.amount, i.cur)}</b>
            </button>`).join('');
        return `
            <details class="pr-row${r.short > 0.004 ? ' is-short' : ''}" style="--acc:${t.color};--acc-soft:${t.soft};--acc-ink:${t.ink}">
                <summary class="pr-sum">
                    <span class="pr-name"><span class="acc-chip">${escapeHtml(t.label)}</span>${r.cur === 'USD' ? '<span class="pr-cur">دولار</span>' : ''}</span>
                    <span class="pr-num"><small>لازمك</small><b class="num">${moneyCur(r.need, r.cur)}</b></span>
                    <span class="pr-num">${r.type ? `<small>معك</small><b class="num">${moneyCur(r.have, r.cur)}</b>` : ''}</span>
                    ${state}
                    <span class="pr-caret" aria-hidden="true">▾</span>
                </summary>
                ${breakdown ? `<div class="pr-break">${breakdown}</div>` : ''}
                <div class="pr-items">${items}</div>
            </details>`;
    }).join('') + '</div>' + note;
}

// كل زبون بسطر: مجموعه بالشيكل والدولار، وأقدم حركة
function groupDebts(items, usdRate) {
    const map = new Map();
    items.forEach(it => {
        const key = it.customerId ? 'c:' + it.customerId : 'n:' + normName(it.who);
        const g = map.get(key) || { key, who: it.who, customerId: it.customerId, items: [], ILS: 0, USD: 0, oldest: it.date };
        g.items.push(it);
        g[it.cur] = round2(g[it.cur] + it.amount);
        if (it.date && (!g.oldest || it.date < g.oldest)) g.oldest = it.date;
        map.set(key, g);
    });
    return [...map.values()].sort((a, b) => (b.ILS + b.USD * usdRate) - (a.ILS + a.USD * usdRate));
}

// ================= المركز المالي =================
// كل اللي معك + اللي إلك عند الناس − اللي عليك، بالشيكل: الدولار و USDT بسعر الشاشة، الجنيه بشاشته،
// واليورو والدينار (حسابات التجار) بسعر السوق
let positionGroups = { owed: [], owe: [] };

function positionRates() {
    const usd = toNum(globalConfig.screenRate, 0);
    const fx = globalConfig.marketFx || {};
    const perUsd = (cur) => (toNum(fx[cur], 0) > 0 ? usd / toNum(fx[cur], 0) : 0);
    return { ILS: 1, USD: usd, EUR: perUsd('EUR'), JOD: perUsd('JOD'), EGP: egpScreen() > 0 ? usd / egpScreen() : 0 };
}

function positionData() {
    const fx = positionRates();
    const bal = accountBalances();
    let cashIls = 0, cashUsd = 0;
    accounts.forEach(a => { cashIls += bal[a.id]?.ILS || 0; cashUsd += bal[a.id]?.USD || 0; });
    const usdt = usdtBalance();
    const egp = egpBalance();
    // التجار: لكل عملة، مجموع اللي إلنا عند التجار (أرصدة موجبة) واللي إلهم عندنا (سالبة)، كل تاجر لحاله
    const traderGross = {};
    traders.forEach(t => Object.entries(traderBalances(t.id)).forEach(([cur, v]) => {
        if (isZero(v)) return;
        const g = (traderGross[cur] ??= { lana: 0, lahum: 0 });
        if (v > 0) g.lana = round2(g.lana + v); else g.lahum = round2(g.lahum - v);
    }));
    const tradersFor = { lana: 0, lahum: 0 };
    Object.entries(traderGross).forEach(([cur, g]) => {
        tradersFor.lana += g.lana * (fx[cur] || 0);
        tradersFor.lahum += g.lahum * (fx[cur] || 0);
    });
    const { owed, owe } = debtItems();
    const sumIls = (items) => items.reduce((s, it) => s + it.amount * (fx[it.cur] || 0), 0);
    const assets = {
        cashIls, cashUsd, usdt, egp,
        total: cashIls + cashUsd * fx.USD + usdt * fx.USD + egp * fx.EGP
    };
    const receivable = { customers: sumIls(owed), traders: tradersFor.lana };
    const payable = { customers: sumIls(owe), traders: tradersFor.lahum };
    receivable.total = receivable.customers + receivable.traders;
    payable.total = payable.customers + payable.traders;
    const missingFx = Object.keys(traderGross).filter(cur => !fx[cur]);
    return { fx, assets, receivable, payable, net: assets.total + receivable.total - payable.total, traderGross, missingFx, owed, owe };
}

// ₪ مقرّب لشيكل صحيح، بإشارته بالمكان الصح داخل العربي
const ilsWhole = (v) => `<bdi class="ltr-num">${v < -0.5 ? '−' : ''}${fmt(Math.abs(v), 0)}</bdi> ₪`;

function positionRow(label, native, ils, hint = '') {
    return `<div class="pos-row">
        <span class="min-w-0"><b class="block text-slate-800">${label}</b>${hint ? `<span class="text-[11px] text-slate-400">${hint}</span>` : ''}</span>
        <span class="text-left shrink-0">${native ? `<span class="block text-[11px] text-slate-500 num">${native}</span>` : ''}<b class="num text-slate-900">${ilsWhole(ils)}</b></span>
    </div>`;
}

function debtGroupHtml(g, side) {
    const c = g.customerId ? customers.find(x => x.id === g.customerId) : customers.find(x => normName(x.name) === normName(g.who));
    const amounts = [g.ILS ? moneyCur(g.ILS, 'ILS') : '', g.USD ? moneyCur(g.USD, 'USD') : ''].filter(Boolean).join(' + ');
    const items = g.items.slice(0, 4).map(it => `<button data-action="goto-ref" data-type="${it.type}" data-id="${escapeHtml(it.id)}" class="debt-chip" title="${escapeHtml(it.date)}">${escapeHtml(it.label)} ${escapeHtml(it.no)} · ${moneyCur(it.amount, it.cur)}</button>`).join('')
        + (g.items.length > 4 ? `<span class="text-[11px] text-slate-400">+${g.items.length - 4}</span>` : '');
    return `<div class="debt-row">
        <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
                ${c ? `<button data-action="open-customer" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}" class="font-black text-slate-900 hover:text-blue-700 hover:underline text-right">${escapeHtml(g.who || '—')}</button>` : `<b class="text-slate-900">${escapeHtml(g.who || '—')}</b>`}
                <div class="text-[11px] text-slate-400">${g.items.length} حركة · أقدمها ${escapeHtml(relativeDays(g.oldest))}</div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <b class="num ${side === 'owed' ? 'text-emerald-700' : 'text-rose-700'}">${amounts}</b>
                <button data-action="cst-open" data-id="${escapeHtml(g.customerId || '')}" data-name="${escapeHtml(g.who || '')}" class="debt-chip" title="كشف حساب (صورة أو PDF) تبعته للزبون">📄 كشف</button>
                ${side === 'owed' && c && hasWhatsapp(c) ? `<button data-action="debt-remind" data-key="${escapeHtml(g.key)}" class="wa-btn" title="تذكير على واتساب">${WA_ICON} تذكير</button>` : ''}
            </div>
        </div>
        <div class="flex flex-wrap gap-1.5 mt-2">${items}</div>
    </div>`;
}

function renderPositionPage() {
    if (pageHidden('position')) return;
    const d = positionData();
    positionGroups = { owed: groupDebts(d.owed, d.fx.USD), owe: groupDebts(d.owe, d.fx.USD) };
    const low = lowBalances();
    const missing = [];
    if (!hasPerm('accounts')) missing.push('الحسابات');
    if (!hasPerm('traders')) missing.push('التجار');
    if (!hasPerm('usdt')) missing.push('USDT');
    if (!hasPerm('egp')) missing.push('الجنيه');
    const tile = (label, value, cls, hint) => `<div class="pos-tile"><span>${label}</span><b class="count-up num ${cls}">${ilsWhole(value)}</b><small>${hint}</small></div>`;
    const curName = (cur) => TRADE_CURRENCIES[cur]?.name || cur;
    const traderRows = Object.entries(d.traderGross).map(([cur, g]) => [
        g.lana ? positionRow(`لنا عند التجار (${curName(cur)})`, `${fmt(g.lana)} ${curSym(cur)}`, g.lana * (d.fx[cur] || 0), d.fx[cur] ? '' : 'ما في سعر لهالعملة') : '',
        g.lahum ? positionRow(`للتجار عندنا (${curName(cur)})`, `${fmt(g.lahum)} ${curSym(cur)}`, g.lahum * (d.fx[cur] || 0), d.fx[cur] ? '' : 'ما في سعر لهالعملة') : ''
    ].join('')).join('');

    $('position-body').innerHTML = `
        <section class="pos-hero theme-keep">
            <div class="flex flex-wrap justify-between items-start gap-3">
                <div>
                    <span class="text-xs font-bold text-slate-300">صافي المركز المالي</span>
                    <div class="pos-net num count-up">${ilsWhole(d.net)}</div>
                    <p class="text-[11px] text-slate-400 mt-1">معك ${ilsWhole(d.assets.total)} + إلك عند الناس ${ilsWhole(d.receivable.total)} − عليك ${ilsWhole(d.payable.total)}</p>
                </div>
                <div class="text-[11px] text-slate-400 text-left leading-5">
                    الدولار و USDT بسعر الشاشة <b class="text-slate-200 num">${fmt(d.fx.USD, 3)}</b><br>
                    ${d.fx.EGP ? `الجنيه بشاشته <b class="text-slate-200 num">${fmt(egpScreen())}</b>` : 'ما في شاشة للجنيه'}
                </div>
            </div>
            ${missing.length ? `<p class="text-[11px] text-amber-300 mt-3">⚠️ ناقص من الحساب حسب صلاحياتك: ${missing.join('، ')}</p>` : ''}
        </section>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            ${tile('معك الآن', d.assets.total, 'text-slate-900', 'الحسابات والكاش و USDT والجنيه')}
            ${tile('إلك عند الناس', d.receivable.total, 'text-emerald-700', 'ديون الزبائن واللي لنا عند التجار')}
            ${tile('عليك', d.payable.total, 'text-rose-700', 'حوالات لسا ما انصرفت، واللي للزبائن والتجار')}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section class="section-card p-5 space-y-1">
                <h3 class="text-sm font-black text-slate-900 mb-2">معك الآن</h3>
                ${positionRow('الحسابات والكاش (شيكل)', '', d.assets.cashIls)}
                ${d.assets.cashUsd ? positionRow('الحسابات والكاش (دولار)', moneyCur(d.assets.cashUsd, 'USD'), d.assets.cashUsd * d.fx.USD) : ''}
                ${positionRow('رصيد USDT', `${fmt(d.assets.usdt)} USDT`, d.assets.usdt * d.fx.USD)}
                ${positionRow('رصيد الجنيه (كل المحافظ)', `${fmtEgp(d.assets.egp)} جنيه`, d.assets.egp * d.fx.EGP, d.fx.EGP ? '' : 'ما في شاشة للجنيه')}
            </section>
            <section class="section-card p-5 space-y-1">
                <h3 class="text-sm font-black text-slate-900 mb-2">التجار</h3>
                ${traderRows || '<p class="text-xs text-slate-400 py-2">كل حسابات التجار متصفّرة</p>'}
                ${d.missingFx.length ? `<p class="text-[11px] text-amber-700 pt-1">ما في سعر سوق لـ ${d.missingFx.join('، ')}، فما انحسبت بالمجموع</p>` : ''}
            </section>
        </div>

        ${low.length ? `<section class="section-card p-5 space-y-2 !border-amber-200">
            <h3 class="text-sm font-black text-amber-800">⚠️ أرصدة قليلة</h3>
            ${low.map(x => `<div class="flex justify-between text-xs py-1"><b class="text-slate-800">${escapeHtml(x.name)}</b><span class="num text-amber-700 font-bold">${fmt(x.balance)} ${x.unit} <span class="text-slate-400 font-normal">(الحد ${fmt(x.limit, 0)})</span></span></div>`).join('')}
        </section>` : ''}

        <section class="section-card p-5 space-y-3">
            <div class="flex flex-wrap justify-between items-baseline gap-2">
                <h3 class="text-sm font-black text-slate-900">على الزبائن (إلك) <span class="text-xs font-bold text-emerald-700 num">${ilsWhole(d.receivable.customers)}</span></h3>
                <span class="text-[11px] text-slate-400">إيداع USDT وإرسال جنيه لسا ما ندفعوا. زر "تذكير" بيفتح واتساب برسالة جاهزة</span>
            </div>
            ${positionGroups.owed.length ? positionGroups.owed.map(g => debtGroupHtml(g, 'owed')).join('') : '<p class="text-xs text-slate-400">ما في ديون على الزبائن ✓</p>'}
        </section>

        <section class="section-card p-5 space-y-3">
            <div class="flex flex-wrap justify-between items-baseline gap-2">
                <h3 class="text-sm font-black text-slate-900">علينا للزبائن <span class="text-xs font-bold text-rose-700 num">${ilsWhole(d.payable.customers)}</span></h3>
                <span class="text-[11px] text-slate-400">حوالات لسا ما انصرفت كاملة، سحب USDT واستقبال جنيه لسا ما دفعناهم</span>
            </div>
            ${positionGroups.owe.length ? positionGroups.owe.map(g => debtGroupHtml(g, 'owe')).join('') : '<p class="text-xs text-slate-400">ما علينا شي للزبائن ✓</p>'}
        </section>`;
    countUpIn($('position-body'));
}

// تذكير الزبون بدينه على واتساب: رسالة فيها كل حركاته المفتوحة
function remindDebt(key) {
    const g = positionGroups.owed.find(x => x.key === key);
    if (!g) return;
    const c = g.customerId ? customers.find(x => x.id === g.customerId) : customers.find(x => normName(x.name) === normName(g.who));
    if (!c || !hasWhatsapp(c)) return showToast('ما في رقم واتساب', 'أضف رقمه من إدارة الزبائن', 'warning');
    const amounts = [g.ILS ? moneyCur(g.ILS, 'ILS') : '', g.USD ? moneyCur(g.USD, 'USD') : ''].filter(Boolean).join(' + ');
    const lines = g.items.map(it => `• ${it.label} ${it.no} (${it.date}): ${moneyCur(it.amount, it.cur)}`).join('\n');
    const text = `مرحباً ${c.name} 🌷\nتذكير لطيف من ${globalConfig.companyName || 'فاست باي'}: المبلغ المستحق ${amounts}\n${lines}\nشكراً لتعاملك معنا`;
    window.open(waUrl(c.phone, text), '_blank', 'noopener');
}
