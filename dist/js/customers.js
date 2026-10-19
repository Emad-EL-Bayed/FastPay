'use strict';

// فاست باي — إدارة الزبائن وملف الزبون
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= إدارة الزبائن =================
// ---------- إحصائيات الزبائن (تُحسب مرة واحدة لكل الحوالات وحركات USDT والجنيه) ----------
// الحركة تتبع الزبون برقمه الداخلي، والحركات بدون رقم تتبعه بالاسم
const txCustomerKey = (t) => (t.customerId ? 'c:' + t.customerId : 'n:' + normName(t.recipient));
const usdtCustomerKey = (m) => (m.customerId ? 'c:' + m.customerId : 'n:' + normName(m.customerName));

// count/profit... للحوالات، و usdt* لحركات USDT، و egp* للجنيه؛ profit و months يجمعان الكل
function emptyCustomerStats() {
    return {
        all: [], count: 0, activeCount: 0, cancelled: 0, receivedIls: 0, receivedUsd: 0, profit: 0, first: '', last: '', sources: {}, months: {},
        usdt: [], usdtCount: 0, usdtDeposit: 0, usdtWithdraw: 0, usdtProfit: 0,
        egp: [], egpCount: 0, egpSent: 0, egpReceived: 0, egpProfit: 0
    };
}
const SUMMED_STATS = ['count', 'activeCount', 'cancelled', 'receivedIls', 'receivedUsd', 'profit', 'usdtCount', 'usdtDeposit', 'usdtWithdraw', 'usdtProfit', 'egpCount', 'egpSent', 'egpReceived', 'egpProfit'];

function buildCustomerStatsIndex() {
    const index = new Map();
    const statsFor = (key) => {
        if (!index.has(key)) index.set(key, emptyCustomerStats());
        return index.get(key);
    };
    const addDate = (s, date) => {
        if (date && (!s.first || date < s.first)) s.first = date;
        if (date && (!s.last || date > s.last)) s.last = date;
    };
    const addProfit = (s, date, profit) => {
        s.profit += profit;
        const m = monthKeyOf(date);
        if (m) s.months[m] = (s.months[m] || 0) + profit;
    };
    ledger.forEach(t => {
        const s = statsFor(txCustomerKey(t));
        s.all.push(t);
        s.count++;
        addDate(s, t.date);
        if (t.status === CANCELLED) { s.cancelled++; return; }
        s.activeCount++;
        if (t.currency === 'USD') s.receivedUsd += t.clientUsd; else s.receivedIls += t.clientIls;
        s.sources[t.country] = (s.sources[t.country] || 0) + 1;
        addProfit(s, t.date, t.profitIls);
    });
    // الإيداع والسحب فقط (تعديل الرصيد ليس لزبون)
    usdtMoves.forEach(m => {
        if (m.kind === 'adjust') return;
        const s = statsFor(usdtCustomerKey(m));
        s.usdt.push(m);
        s.usdtCount++;
        addDate(s, m.date);
        if (m.kind === 'deposit') s.usdtDeposit += m.amount; else s.usdtWithdraw += m.amount;
        s.usdtProfit += m.profitIls;
        addProfit(s, m.date, m.profitIls);
    });
    // إرسال واستقبال الجنيه (الشحن والتعديل مش لزبون)
    egpMoves.forEach(m => {
        if (m.kind !== 'send' && m.kind !== 'receive') return;
        const s = statsFor(usdtCustomerKey(m));
        s.egp.push(m);
        s.egpCount++;
        addDate(s, m.date);
        if (m.kind === 'send') s.egpSent += m.egp; else s.egpReceived += m.egp;
        s.egpProfit += m.profitIls;
        addProfit(s, m.date, m.profitIls);
    });
    return index;
}

// حوالات الزبون: برقم جواله، أو باسمه إذا كانت الحوالة بدون جوال
function customerStats(c, index = buildCustomerStatsIndex()) {
    const byId = (c.id && index.get('c:' + c.id)) || emptyCustomerStats();
    const byName = index.get('n:' + normName(c.name));
    if (!byName) return byId;
    const merged = emptyCustomerStats();
    [byId, byName].forEach(s => {
        merged.all.push(...s.all);
        merged.usdt.push(...s.usdt);
        merged.egp.push(...s.egp);
        SUMMED_STATS.forEach(k => { merged[k] += s[k]; });
        if (s.first && (!merged.first || s.first < merged.first)) merged.first = s.first;
        if (s.last && (!merged.last || s.last > merged.last)) merged.last = s.last;
        Object.entries(s.sources).forEach(([k, v]) => { merged.sources[k] = (merged.sources[k] || 0) + v; });
        Object.entries(s.months).forEach(([k, v]) => { merged.months[k] = (merged.months[k] || 0) + v; });
    });
    return merged;
}

function daysSince(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const then = new Date(y, m - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - then) / 86400000);
}

// العدد مع التمييز الصحيح: شهر، شهرين، 3 أشهر، 11 شهراً
function arabicCount(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return `${n} ${few}`;
    return `${n} ${many}`;
}

function relativeDays(dateStr) {
    const n = daysSince(dateStr);
    if (n === null) return '';
    if (n <= 0) return 'اليوم';
    if (n === 1) return 'أمس';
    if (n < 30) return 'منذ ' + arabicCount(n, 'يوم', 'يومين', 'أيام', 'يوماً');
    if (n < 365) return 'منذ ' + arabicCount(Math.max(1, Math.round(n / 30)), 'شهر', 'شهرين', 'أشهر', 'شهراً');
    const years = Math.round(n / 365);
    return 'منذ ' + arabicCount(Math.max(1, years), 'سنة', 'سنتين', 'سنوات', 'سنة');
}

function receivedHtml(s) {
    if (!s.receivedIls && !s.receivedUsd) return '<span class="text-slate-400">—</span>';
    const parts = [];
    if (s.receivedIls || !s.receivedUsd) parts.push(`${fmt(s.receivedIls, 0)} ₪`);
    if (s.receivedUsd) parts.push(`<bdi class="ltr-num">$${fmt(s.receivedUsd, 0)}</bdi>`);
    return parts.join(' + ');
}

function renderCustomersTable() {
    if (pageHidden('customers')) return;
    const search = ($('cust_search').value || '').trim().toLowerCase();
    const searchDigits = normPhone(search);
    const sort = $('cust_sort').value || 'recent';
    const index = buildCustomerStatsIndex();

    const rows = customers
        .filter(c => !search || c.name.toLowerCase().includes(search) || (searchDigits && (whatsappDigits(c.phone).includes(searchDigits) || normPhone(c.account).includes(searchDigits) || (c.iban && c.iban.toLowerCase().includes(searchDigits)))))
        .map(c => ({ c, s: customerStats(c, index) }));

    const sorters = {
        recent: (a, b) => (b.s.last || b.c.createdAt || '').localeCompare(a.s.last || a.c.createdAt || ''),
        count: (a, b) => (b.s.count + b.s.usdtCount + b.s.egpCount) - (a.s.count + a.s.usdtCount + a.s.egpCount),
        profit: (a, b) => b.s.profit - a.s.profit,
        received: (a, b) => (b.s.receivedIls + b.s.receivedUsd * globalConfig.screenRate) - (a.s.receivedIls + a.s.receivedUsd * globalConfig.screenRate),
        name: (a, b) => a.c.name.localeCompare(b.c.name, 'ar')
    };
    rows.sort(sorters[sort] || sorters.recent);

    if (rows.length === 0) {
        $('customers-body').innerHTML = `<tr><td colspan="8" class="p-6 text-center text-xs text-slate-400">${emptyMessage(customers.length, 'لا توجد نتائج مطابقة', 'لا يوجد زبائن في الشيت بعد')}</td></tr>`;
        return;
    }

    $('customers-body').innerHTML = rows.map(({ c, s }) => `
        <tr class="hover:bg-slate-50 cursor-pointer" data-action="open-customer" data-id="${escapeHtml(c.id)}" title="فتح ملف الزبون">
            <td class="p-3.5">
                <span class="flex items-center gap-2.5">
                    <span class="cust-avatar">${escapeHtml(c.name.trim().charAt(0) || '؟')}</span>
                    <span class="font-bold text-slate-900 whitespace-nowrap">${escapeHtml(c.name)}</span>
                </span>
            </td>
            <td class="p-3.5 whitespace-nowrap">${whatsappButton(c)}</td>
            <td class="p-3.5"><span class="badge ${payoutBadgeClass(c.payout)}">${escapeHtml(payoutLabel(c))}</span></td>
            <td class="p-3.5 text-center whitespace-nowrap"><span class="cust-count-pill">${[s.count || (!s.usdtCount && !s.egpCount) ? `${s.count} حوالة` : '', s.usdtCount ? `${s.usdtCount} USDT` : '', s.egpCount ? `${s.egpCount} جنيه` : ''].filter(Boolean).join(' · ')}</span></td>
            <td class="p-3.5 font-bold text-slate-800 num whitespace-nowrap">${receivedHtml(s)}</td>
            <td class="profit-only p-3.5 font-black text-emerald-700 num whitespace-nowrap">${s.profit ? '+' + fmt(s.profit, 0) + ' ₪' : '<span class="text-slate-400 font-medium">—</span>'}</td>
            <td class="p-3.5 text-xs text-slate-500 whitespace-nowrap">${s.last ? `${escapeHtml(s.last)}<span class="block text-[10px] text-slate-400">${relativeDays(s.last)}</span>` : 'لم يتعامل بعد'}</td>
            <td class="p-3.5 text-center whitespace-nowrap">
                <button data-action="edit-customer" data-id="${escapeHtml(c.id)}" class="text-blue-600 hover:text-blue-800 font-bold text-xs px-2.5 py-1 bg-blue-50 rounded-lg mr-1">تعديل</button>
                <button data-action="delete-customer" data-id="${escapeHtml(c.id)}" class="text-slate-400 hover:text-red-600 p-1 font-bold">✕</button>
            </td>
        </tr>
    `).join('');
}

// ---------- واتساب ----------
function customerOfTx(t) {
    return customers.find(c => t.customerId && c.id === t.customerId)
        || customers.find(c => normName(c.name) === normName(t.recipient));
}

// زر فتح المحادثة: أخضر إذا كان للزبون رقم واتساب، ورمادي يفتح تعديل الزبون لإضافة الرقم
function whatsappButton(c, { compact = false } = {}) {
    if (!c) return '';
    if (hasWhatsapp(c)) {
        return `<button data-action="open-whatsapp" data-id="${escapeHtml(c.id)}" class="wa-btn" title="فتح محادثة واتساب مع ${escapeHtml(c.name)}">
            ${WA_ICON}${compact ? '' : `<bdi class="ltr-num">+${escapeHtml(whatsappDigits(c.phone))}</bdi>`}</button>`;
    }
    return `<button data-action="edit-customer" data-id="${escapeHtml(c.id)}" class="wa-btn wa-missing" title="أضف رقم الواتساب لـ ${escapeHtml(c.name)}">
        ${WA_ICON}${compact ? '' : 'أضف الرقم'}</button>`;
}

const WA_ICON = '<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 01-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 01-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 012.89 6.99c0 5.45-4.44 9.88-9.89 9.88m8.41-18.29A11.82 11.82 0 0012.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.94L.06 24l6.31-1.65a11.88 11.88 0 005.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.16-3.49-8.41"/></svg>';

function openWhatsapp(id) {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    if (!hasWhatsapp(c)) {
        showToast('لا يوجد رقم واتساب', 'أضف الرقم مع المقدمة من إدارة الزبائن', 'warning');
        return openCustomerModal(c);
    }
    window.open(`https://wa.me/${whatsappDigits(c.phone)}`, '_blank', 'noopener');
}

// ---------- ملف الزبون ----------
let profileCustomer = null;

// يقبل زبوناً غير مسجل (من حوالة قديمة) فيبني له ملفاً من بيانات الحوالة
function openCustomerProfile(id, fallbackName = '') {
    let c = customers.find(x => id && x.id === id) || customers.find(x => fallbackName && normName(x.name) === normName(fallbackName));
    if (!c) {
        const tx = ledger.find(t => normName(t.recipient) === normName(fallbackName));
        const um = !tx && (usdtMoves.find(m => (id && m.customerId === id) || normName(m.customerName) === normName(fallbackName))
            || egpMoves.find(m => m.customerName && ((id && m.customerId === id) || normName(m.customerName) === normName(fallbackName))));
        if (!tx && !um) return;
        c = normalizeCustomer(tx
            ? { id: id || '', name: tx.recipient, payout: tx.payout, provider: tx.provider, account: tx.account, iban: tx.iban }
            : { id: id || '', name: um.customerName, payout: 'كاش' });
    }
    profileCustomer = c;
    renderCustomerProfile(c);
    openModal('customerModal');
    $('customer-profile').scrollTop = 0;
}

function renderCustomerProfile(c) {
    const s = customerStats(c);
    const registered = customers.some(x => x.id && x.id === c.id);
    $('customer-profile').innerHTML = `
        ${profileHeadHtml(c, s, registered)}

        <div class="p-4 sm:p-5 space-y-5">
            ${profileTilesHtml(s)}

            ${profileMonthsHtml(s)}

            ${profileActionsHtml(c, registered)}

            ${profileTimelineHtml(s)}
        </div>
    `;
    animateProfile();
}

function profileHeadHtml(c, s, registered) {
    const sinceFirst = s.first ? relativeDays(s.first).replace('منذ ', '') : '';
    return `
        <div class="cp-head">
            <button data-action="close-modal" data-modal="customerModal" class="cp-close" aria-label="إغلاق">✕</button>
            <div class="flex items-center gap-3.5">
                <div class="cp-avatar">${escapeHtml(c.name.trim().charAt(0) || '؟')}</div>
                <div class="min-w-0">
                    <h3 class="text-lg font-black text-white truncate">${escapeHtml(c.name)}</h3>
                    <div class="text-xs text-slate-300 mt-0.5 flex flex-wrap gap-x-2">
                        <span>${escapeHtml(payoutLabel(c))}</span>
                        ${c.account ? `<span>·</span><bdi class="ltr-num font-mono">${escapeHtml(c.account)}</bdi>` : ''}
                        ${c.iban ? `<span>·</span><bdi class="ltr-num font-mono">${escapeHtml(formatIban(c.iban))}</bdi>` : ''}
                    </div>
                </div>
            </div>
            ${registered ? `<div class="mt-3">${whatsappButton(c)}</div>` : ''}
            <div class="flex flex-wrap gap-1.5 mt-4 text-[11px] font-bold">
                ${s.first ? `<span class="cp-chip">🗓️ زبون منذ ${escapeHtml(s.first)}${sinceFirst ? ` (${sinceFirst})` : ''}</span>` : '<span class="cp-chip">لم يتعامل بعد</span>'}
                ${s.last ? `<span class="cp-chip">⏱️ آخر تعامل ${relativeDays(s.last)}</span>` : ''}
                ${!registered ? '<span class="cp-chip">غير مسجل في الزبائن</span>' : ''}
            </div>
        </div>`;
}

// البطاقات: العدد، ما استلمه، ربحنا، أكثر مصدر، و USDT إن وُجدت
function profileTilesHtml(s) {
    const topSource = Object.entries(s.sources).sort((a, b) => b[1] - a[1])[0];
    const moves = s.activeCount + s.usdtCount + s.egpCount;
    const avgProfit = moves ? s.profit / moves : 0;
    // USDT: الباقي على الزبون (إيداع ما دفعه) أو إله (سحب ما دفعناه)
    const owes = { ILS: 0, USD: 0 }, owed = { ILS: 0, USD: 0 };
    s.usdt.forEach(m => {
        const st = usdtPayState(m);
        if (st && st.remaining > 0.004) (m.kind === 'deposit' ? owes : owed)[m.currency] += st.remaining;
    });
    const curPair = (o) => [o.ILS ? moneyCur(o.ILS, 'ILS') : '', o.USD ? moneyCur(o.USD, 'USD') : ''].filter(Boolean).join(' + ');
    // الجنيه: الباقي عليه (إرسال ما دفعه) أو إله (استقبال ما دفعناه)
    const egpOwes = { ILS: 0, USD: 0 }, egpOwed = { ILS: 0, USD: 0 };
    s.egp.forEach(m => {
        const st = egpPayState(m);
        if (st && st.remaining > 0.004) (st.dir > 0 ? egpOwes : egpOwed)[m.currency] += st.remaining;
    });
    const profitParts = [s.usdtCount ? `${fmt(s.usdtProfit, 0)} ₪ من USDT` : '', s.egpCount ? `${fmt(s.egpProfit, 0)} ₪ من الجنيه` : ''].filter(Boolean);
    return `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div class="cp-tile" style="--d:0ms">
                <span class="cp-tile-label">عدد الحوالات</span>
                <span class="cp-tile-value num" data-count="${s.count}">0</span>
                <span class="cp-tile-sub">${s.activeCount} فعّالة${s.cancelled ? ` · ${s.cancelled} ملغاة` : ''}</span>
            </div>
            <div class="cp-tile" style="--d:60ms">
                <span class="cp-tile-label">إجمالي ما استلمه</span>
                <span class="cp-tile-value num"><span data-money="${s.receivedIls}">0</span> <small>₪</small></span>
                <span class="cp-tile-sub">${s.receivedUsd ? `+ <bdi class="ltr-num">$${fmt(s.receivedUsd, 0)}</bdi> بالدولار` : 'بدون الملغاة'}</span>
            </div>
            <div class="cp-tile cp-tile-hero profit-only" style="--d:120ms">
                <span class="cp-tile-label">صافي ربحنا منه</span>
                <span class="cp-tile-value num"><span data-money="${s.profit}">0</span> <small>₪</small></span>
                <span class="cp-tile-sub">${profitParts.length ? `منها ${profitParts.join(' و')}` : `متوسط ${fmt(avgProfit, 1)} ₪ للحوالة`}</span>
            </div>
            <div class="cp-tile" style="--d:180ms">
                <span class="cp-tile-label">أكثر مصدر</span>
                <span class="cp-tile-value cp-tile-text">${topSource ? escapeHtml(topSource[0]) : '—'}</span>
                <span class="cp-tile-sub">${topSource ? `${topSource[1]} حوالة` : ''}</span>
            </div>
            ${s.usdtCount ? `
            <div class="cp-tile cp-usdt col-span-2 sm:col-span-4" style="--d:240ms">
                <div class="flex justify-between items-baseline">
                    <span class="cp-tile-label">USDT</span>
                    <span class="cp-tile-sub">${s.usdtCount} حركة</span>
                </div>
                <div class="cp-usdt-grid">
                    <div><span>اشترى (إيداع)</span><b class="num text-slate-900">${fmt(s.usdtDeposit)}</b></div>
                    <div><span>باع (سحب)</span><b class="num text-slate-900">${fmt(s.usdtWithdraw)}</b></div>
                    ${curPair(owes) ? `<div><span>عليه (ما دفع)</span><b class="num text-amber-700">${curPair(owes)}</b></div>` : ''}
                    ${curPair(owed) ? `<div><span>إله (ما دفعناله)</span><b class="num text-sky-700">${curPair(owed)}</b></div>` : ''}
                    ${!curPair(owes) && !curPair(owed) ? '<div><span>الدفعات</span><b class="text-emerald-700">✓ كله مدفوع</b></div>' : ''}
                </div>
            </div>` : ''}
            ${s.egpCount ? `
            <div class="cp-tile cp-egp col-span-2 sm:col-span-4" style="--d:270ms">
                <div class="flex justify-between items-baseline">
                    <span class="cp-tile-label">الجنيه المصري</span>
                    <span class="cp-tile-sub">${s.egpCount} حركة</span>
                </div>
                <div class="cp-usdt-grid">
                    <div><span>بعتناله (إرسال)</span><b class="num text-slate-900">${fmtEgp(s.egpSent)} جنيه</b></div>
                    <div><span>وصلنا منه (استقبال)</span><b class="num text-slate-900">${fmtEgp(s.egpReceived)} جنيه</b></div>
                    ${curPair(egpOwes) ? `<div><span>عليه (ما دفع)</span><b class="num text-amber-700">${curPair(egpOwes)}</b></div>` : ''}
                    ${curPair(egpOwed) ? `<div><span>إله (ما دفعناله)</span><b class="num text-sky-700">${curPair(egpOwed)}</b></div>` : ''}
                    ${!curPair(egpOwes) && !curPair(egpOwed) ? '<div><span>الدفعات</span><b class="text-emerald-700">✓ كله مدفوع</b></div>' : ''}
                </div>
            </div>` : ''}
        </div>`;
}

// ربحنا منه شهرياً: آخر 12 شهراً
function profileMonthsHtml(s) {
    const current = currentMonthKey();
    const months = [];
    for (let i = 11; i >= 0; i--) {
        const k = shiftMonth(current, -i);
        months.push({ k, v: s.months[k] || 0 });
    }
    const maxMonth = Math.max(...months.map(m => m.v), 1);
    const activeMonths = months.filter(m => m.v > 0).length;
    return `
        <div class="profit-only bg-slate-50 border border-slate-200/80 rounded-xl p-4">
            <div class="flex justify-between items-baseline mb-3">
                <h4 class="text-xs font-bold text-slate-800">ربحنا منه شهرياً</h4>
                <span class="text-[11px] text-slate-500">آخر 12 شهراً · تعامل في ${activeMonths ? arabicCount(activeMonths, 'شهر واحد', 'شهرين', 'أشهر', 'شهراً') : 'لا شيء'}</span>
            </div>
            <div class="cp-bars" aria-label="ربحنا من الزبون لكل شهر">
                ${months.map((m, i) => `
                    <div class="cp-bar-col" title="${monthLabel(m.k)}: ${fmt(m.v, 1)} ₪">
                        <div class="cp-bar${m.k === current ? ' current' : ''}" style="--h:${(m.v / maxMonth) * 100}%;--d:${i * 40}ms"></div>
                        <span class="cp-bar-label">${i % 3 === 2 || i === 11 ? MONTH_NAMES[Number(m.k.slice(5)) - 1] : ''}</span>
                    </div>
                `).join('')}
            </div>
        </div>`;
}

function profileActionsHtml(c, registered) {
    return `
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button data-action="cust-new-tx" class="cp-action bg-slate-900 text-white">+ حوالة جديدة له</button>
            <button data-action="cust-show-ledger" class="cp-action bg-slate-100 text-slate-800">عرض في سجل الحوالات</button>
            ${registered ? `<button data-action="edit-customer" data-id="${escapeHtml(c.id)}" class="cp-action bg-slate-100 text-slate-800">تعديل البيانات</button>` : ''}
        </div>`;
}

// الحوالات و USDT والجنيه في قائمة واحدة، الأحدث أولاً (الأرقام مبنية على الوقت)
function profileTimelineHtml(s) {
    const items = [
        ...s.all.map(t => ({ kind: 'tx', date: t.date, id: t.id, t })),
        ...s.usdt.map(m => ({ kind: 'usdt', date: m.date, id: m.id, m })),
        ...s.egp.map(m => ({ kind: 'egp', date: m.date, id: m.id, m }))
    ].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const statusDot = { 'مكتمل': '#10b981', 'قيد الإنتظار': '#f59e0b', 'فحص': '#94a3b8', 'ملغي': '#e11d48' };
    const payDot = { paid: '#10b981', partial: '#0ea5e9', unpaid: '#f59e0b' };
    const shown = items.slice(0, 50);
    return `
        <div>
            <h4 class="text-xs font-bold text-slate-800 mb-2">كل الحركات من أول تعامل <span class="text-slate-400 font-medium">(${items.length})</span></h4>
            ${items.length === 0 ? '<div class="text-xs text-slate-400 py-6 text-center bg-slate-50 rounded-xl">لا توجد حركات لهذا الزبون بعد</div>' : `
            <ul class="cp-timeline">
                ${shown.map((it, i) => it.kind === 'tx' ? profileTxItem(it.t, i, statusDot) : it.kind === 'usdt' ? profileUsdtItem(it.m, i, payDot) : profileEgpItem(it.m, i, payDot)).join('')}
            </ul>
            ${s.all.length > shown.filter(it => it.kind === 'tx').length ? `<button data-action="cust-show-ledger" class="w-full mt-2 text-xs font-bold text-blue-600 py-2 hover:underline">عرض كل الحوالات (${s.all.length}) في السجل ←</button>` : ''}`}
        </div>`;
}

// الأرقام تعدّ من الصفر، والأعمدة تنمو
function animateProfile() {
    const root = $('customer-profile');
    root.querySelectorAll('[data-count]').forEach(el => { el.dataset.value = 0; animateNumber(el, toNum(el.dataset.count), (v) => fmt(v, 0), 700); });
    root.querySelectorAll('[data-money]').forEach(el => { el.dataset.value = 0; animateNumber(el, toNum(el.dataset.money), (v) => fmt(v, 0), 900); });
    root.classList.remove('cp-in');
    // setTimeout بدل requestAnimationFrame حتى تنمو الأعمدة حتى لو كانت النافذة في الخلفية
    setTimeout(() => root.classList.add('cp-in'), 40);
}

function profileTxItem(t, i, statusDot) {
    return `
        <li class="cp-tx${t.status === CANCELLED ? ' cancelled' : ''}" style="--d:${Math.min(i, 12) * 45}ms">
            <span class="cp-tx-dot" style="background:${statusDot[t.status] || '#94a3b8'}"></span>
            <div class="min-w-0 flex-1">
                <div class="flex justify-between items-baseline gap-2">
                    <b class="num text-slate-900"><span class="cp-kind tx">حوالة</span><span class="cp-tx-amount">${deliveredHtml(t)}</span></b>
                    <span class="profit-only num text-xs font-bold ${t.status === CANCELLED ? 'text-slate-400 line-through' : 'text-emerald-600'}">+${fmt(t.profitIls)} ₪</span>
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5 truncate">
                    <bdi class="ltr-num">${escapeHtml(t.date)}</bdi> · ${escapeHtml(t.country)} · ${escapeHtml(payoutLabel(t))} · <span class="font-bold">${escapeHtml(t.status)}</span>
                </div>
            </div>
            <button data-action="open-receipt" data-id="${t.id}" class="cp-tx-receipt">فاتورة</button>
        </li>`;
}

// حركة USDT في ملف الزبون: الرقم # يفتح سجلها في صفحة USDT
function profileUsdtItem(m, i, payDot) {
    const st = usdtPayState(m);
    return `
        <li class="cp-tx" style="--d:${Math.min(i, 12) * 45}ms">
            <span class="cp-tx-dot" style="background:${payDot[st.state]}"></span>
            <div class="min-w-0 flex-1">
                <div class="flex justify-between items-baseline gap-2">
                    <b class="num text-slate-900"><span class="cp-kind ${m.kind}">${USDT_KINDS[m.kind]} USDT</span>${fmt(m.amount)} <small class="text-slate-400">USDT</small></b>
                    <span class="profit-only num text-xs font-bold ${m.profitIls >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${m.profitIls >= 0 ? '+' : ''}${fmt(m.profitIls)} ₪</span>
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">
                    <bdi class="ltr-num">${escapeHtml(m.date)}</bdi> · ${moneyCur(m.total, m.currency)} · <span class="font-bold">${PAY_STATE[st.state].label}${st.state === 'partial' ? ` (الباقي ${moneyCur(st.remaining, m.currency)})` : ''}</span>
                    · <button data-action="cust-goto-usdt" data-id="${m.id}" class="ref-link" title="فتح في سجل USDT">#${m.id}</button>
                </div>
            </div>
            <button data-action="usdt-receipt" data-id="${m.id}" class="cp-tx-receipt">فاتورة</button>
        </li>`;
}

function customerGotoUsdt(id) {
    closeModal('customerModal');
    gotoRef('usdt', id);
}

// حركة جنيه في ملف الزبون: الرقم # يفتح سجلها في صفحة الجنيه
function profileEgpItem(m, i, payDot) {
    const st = egpPayState(m);
    return `
        <li class="cp-tx" style="--d:${Math.min(i, 12) * 45}ms">
            <span class="cp-tx-dot" style="background:${st ? payDot[st.state] : '#94a3b8'}"></span>
            <div class="min-w-0 flex-1">
                <div class="flex justify-between items-baseline gap-2">
                    <b class="num text-slate-900"><span class="cp-kind ${m.kind}">${EGP_KINDS[m.kind]}</span>${fmtEgp(m.egp)} <small class="text-slate-400">جنيه</small></b>
                    <span class="profit-only num text-xs font-bold ${m.profitIls >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${m.profitIls >= 0 ? '+' : ''}${fmt(m.profitIls)} ₪</span>
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">
                    <bdi class="ltr-num">${escapeHtml(m.date)}</bdi> · ${moneyCur(m.total, m.currency)}${st ? ` · <span class="font-bold">${PAY_STATE[st.state].label}${st.state === 'partial' ? ` (الباقي ${moneyCur(st.remaining, m.currency)})` : ''}</span>` : ''}
                    · <button data-action="cust-goto-egp" data-id="${m.id}" class="ref-link" title="فتح في سجل الجنيه">#${m.id}</button>
                </div>
            </div>
            <button data-action="egp-receipt" data-id="${m.id}" class="cp-tx-receipt">فاتورة</button>
        </li>`;
}

function customerGotoEgp(id) {
    closeModal('customerModal');
    gotoRef('egp', id);
}

function customerNewTransaction() {
    const c = profileCustomer;
    if (!c) return;
    closeModal('customerModal');
    switchTab('calculator');
    resetCalcForm();
    fillCustomerIntoCalc(c);
    // نختار المصدر الذي يتعامل منه الزبون عادةً
    const top = Object.entries(customerStats(c).sources).sort((a, b) => b[1] - a[1])[0];
    if (top && countries.some(x => x.name === top[0])) selectSource(top[0]);
    else $('calc_orig_amount').focus();
}

function customerShowLedger() {
    const c = profileCustomer;
    if (!c) return;
    closeModal('customerModal');
    clearTxFilters();
    $('tx_search').value = c.name;
    switchTab('transactions');
}

function fillProviderSelect(select, payout, current) {
    const options = providerOptions(payout);
    select.innerHTML = options.length
        ? options.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('')
        : '<option value="">—</option>';
    select.disabled = options.length === 0;
    select.value = options.includes(current) ? current : (options[0] || '');
}

function openCustomerModal(c = null) {
    $('custModalTitle').textContent = c ? 'تعديل بيانات الزبون: ' + c.name : 'إضافة زبون جديد';
    $('cust_edit_id').value = c ? c.id : '';
    $('m_cust_name').value = c ? c.name : '';
    $('m_cust_phone').value = c ? c.phone : '';
    $('m_cust_payout').value = c ? c.payout : 'محفظة';
    fillProviderSelect($('m_cust_provider'), $('m_cust_payout').value, c?.provider);
    $('m_cust_account').value = c ? c.account : '';
    setIbanField($('m_cust_iban'), $('m_cust_iban_hint'), c?.iban);
    syncCustPayoutFields();
    openModal('custModal');
    (c && !c.phone ? $('m_cust_phone') : $('m_cust_name')).focus();
}

// البنك: رقم الجوال المربوط بالحساب و IBAN (اختياري)؛ المحفظة: رقمها
function syncCustPayoutFields() {
    const payout = $('m_cust_payout').value;
    $('m_cust_account_label').textContent = payout === 'بنكي' ? 'رقم الجوال (للتحويل)' : 'رقم المحفظة';
    $('m_cust_iban_wrap').classList.toggle('hidden', payout !== 'بنكي');
}

async function saveCustomerManual(e) {
    e.preventDefault();
    const editId = $('cust_edit_id').value;
    const existingIban = (customers.find(x => x.id === editId) || {}).iban || '';
    // IBAN بس للبنك؛ إذا غيّرت لمحفظة بيضل محفوظ للمرة الجاية
    const iban = $('m_cust_payout').value === 'بنكي' ? readIbanField($('m_cust_iban')) : existingIban;
    if (iban === null) return;
    const data = normalizeCustomer({
        id: editId || newCustomerId(),
        phone: $('m_cust_phone').value,
        name: $('m_cust_name').value,
        payout: $('m_cust_payout').value,
        provider: $('m_cust_provider').value,
        account: $('m_cust_account').value,
        iban: sheetHas('iban') ? iban : existingIban
    });
    if (!data.name) return showToast('تنبيه', 'اسم الزبون مطلوب', 'warning');
    if (data.phone && !hasWhatsapp(data)) {
        return showToast('رقم الواتساب غير مكتمل', 'اكتبه مع المقدمة، مثل 970599123456', 'warning');
    }
    const sameName = customers.find(x => normName(x.name) === normName(data.name) && x.id !== editId);
    if (sameName) return showToast('تنبيه', `يوجد زبون بنفس الاسم "${sameName.name}". أضف ما يميّزه (مثل اسم العائلة).`, 'warning');
    const samePhone = data.phone && customers.find(x => whatsappDigits(x.phone) === whatsappDigits(data.phone) && x.id !== editId);
    if (samePhone) return showToast('تنبيه', `رقم الواتساب مسجل مسبقاً للزبون ${samePhone.name}`, 'warning');

    const existing = editId && customers.find(x => x.id === editId);
    let renamed = { ops: [], count: 0 };
    if (existing) {
        const oldName = existing.name;
        Object.assign(existing, { name: data.name, phone: data.phone, payout: data.payout, provider: data.provider, account: data.account, iban: data.iban });
        if (existing.name !== oldName) renamed = renameCustomerOps(existing, oldName);
        queueOps({ action: 'upsert_customer', customer: existing }, ...renamed.ops);
    } else {
        const created = { ...data, createdAt: localDateStr() };
        customers.unshift(created);
        queueOps({ action: 'upsert_customer', customer: created });
    }

    closeModal('custModal');
    renderCustomersTable();
    renderLedgerTable();
    if (renamed.count) {
        renderUsdtPage();
        renderEgpPage();
        renderAccountsPage();
        updateReportsData();
    }
    if (!$('customerModal').classList.contains('hidden') && profileCustomer) openCustomerProfile(profileCustomer.id || editId, data.name);
    const syncStatus = await flushOutbox();
    showToast('تم حفظ الزبون', `${data.name}${renamed.count ? ` · تحدّث الاسم في ${renamed.count} حركة` : ''} — ${syncResultMessage(syncStatus)}`, syncToastType(syncStatus));
}

// تغيير اسم الزبون يحدّث اسمه في كل حركاته (الحوالات، USDT، الجنيه) وملاحظات دفعاتها في الحسابات.
// الحركة له إذا مربوطة برقمه، أو بدون رقم وباسمه القديم. بس الأقسام اللي إلك صلاحية عليها (غيرها السكربت بيرفضه)
function renameCustomerOps(c, oldName) {
    const mine = (customerId, name) => (customerId ? customerId === c.id : normName(name) === normName(oldName));
    const ops = [];
    let count = 0;
    if (hasPerm('transactions')) {
        ledger.filter(t => mine(t.customerId, t.recipient) && t.recipient !== c.name).forEach(t => {
            const before = t.recipient;
            t.recipient = c.name;
            ops.push({ action: 'upsert', ...t }, ...relinkNotesOps('tx', t.id, t.recipient, note => note === before));
            count++;
        });
    }
    if (hasPerm('usdt')) {
        usdtMoves.filter(m => m.kind !== 'adjust' && mine(m.customerId, m.customerName) && m.customerName !== c.name).forEach(m => {
            m.customerName = c.name;
            ops.push({ action: 'upsert_usdt', move: m }, ...relinkNotesOps('usdt', m.id, usdtPayNote(m), isUsdtPayNote));
            count++;
        });
    }
    if (hasPerm('egp')) {
        egpMoves.filter(m => (m.kind === 'send' || m.kind === 'receive') && mine(m.customerId, m.customerName) && m.customerName !== c.name).forEach(m => {
            m.customerName = c.name;
            ops.push({ action: 'upsert_egp', move: m }, ...relinkNotesOps('egp', m.id, egpPayNote(m), isEgpPayNote));
            count++;
        });
    }
    return { ops, count };
}

function deleteCustomerPrompt(id) {
    showAppConfirm('تأكيد حذف الزبون', 'هل أنت متأكد من حذف هذا الزبون من الشيت؟ حوالاته السابقة تبقى في السجل.', async () => {
        customers = customers.filter(x => x.id !== id);
        queueOps({ action: 'delete_customer', id });
        renderCustomersTable();
        const syncStatus = await flushOutbox();
        showToast('تم حذف الزبون', syncResultMessage(syncStatus), syncToastType(syncStatus));
    });
}
