'use strict';

// فاست باي — الجرد اليومي وملخص شغل الموظفين
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= الجرد اليومي =================
// لكل حساب وعملة: رصيد البرنامج مقابل الرصيد الفعلي. يُحفظ في ورقة "الجرد اليومي"، ويمكن تسوية الفرق بحركة يدوية.
let closings = [];

function normalizeClosing(c) {
    return {
        id: String(c?.id ?? '').trim(),
        date: String(c?.date ?? '').slice(0, 10),
        accountId: String(c?.accountId ?? '').trim(),
        accountName: String(c?.accountName ?? '').trim(),
        currency: c?.currency === 'USD' ? 'USD' : 'ILS',
        system: round2(toNum(c?.system, 0)),
        actual: round2(toNum(c?.actual, 0)),
        diff: round2(toNum(c?.diff, 0)),
        settled: c?.settled === 'yes' || c?.settled === true,
        note: String(c?.note ?? '').trim(),
        createdBy: String(c?.createdBy ?? '').trim()
    };
}

// صفوف الجرد: كل حساب بالشيكل، والدولار للحسابات التي فيها دولار
function closingLines() {
    const bal = accountBalances();
    return sortedAccounts().flatMap(a => ['ILS', ...(a.usd ? ['USD'] : [])].map(cur => ({ a, cur, system: bal[a.id]?.[cur] || 0 })));
}

function openClosingModal() {
    if (!walletsReady()) return;
    if (!accounts.length) return showToast('لا توجد حسابات', 'أضف حساباتك أولاً', 'warning');
    const today = localDateStr();
    $('closingModalTitle').textContent = `جرد آخر اليوم — ${today}`;
    $('closing-rows').innerHTML = closingLines().map(({ a, cur, system }) => {
        const prev = closings.find(c => c.id === `${today}_${a.id}_${cur}`);
        return `
            <tr style="--acc:${ACCOUNT_TYPES[a.accType].color}">
                <td class="p-2 whitespace-nowrap"><span class="acc-dot"></span> <b>${escapeHtml(accountName(a))}</b> <span class="text-[10px] text-slate-400">${CUR_SYM[cur]}</span></td>
                <td class="p-2 font-mono num whitespace-nowrap">${fmt(system)}</td>
                <td class="p-2"><input type="number" step="any" class="closing-input w-28 border border-slate-200 rounded-lg p-1.5 font-bold" data-acc="${escapeHtml(a.id)}" data-cur="${cur}" data-system="${system}" value="${prev ? prev.actual : ''}" placeholder="${fmt(system)}"></td>
                <td class="p-2 font-mono num font-black whitespace-nowrap closing-diff">—</td>
            </tr>`;
    }).join('');
    $('closing_settle').checked = false;
    $('closing_note').value = '';
    $('closing-summary').innerHTML = employeeDaySummaryHtml(today);
    updateClosingDiffs();
    openModal('closingModal');
}

function updateClosingDiffs() {
    let total = 0;
    document.querySelectorAll('#closing-rows tr').forEach(tr => {
        const input = tr.querySelector('.closing-input');
        const cell = tr.querySelector('.closing-diff');
        if (input.value === '') { cell.textContent = '—'; cell.className = 'p-2 font-mono num font-black whitespace-nowrap closing-diff text-slate-300'; return; }
        const diff = round2(toNum(input.value, 0) - toNum(input.dataset.system, 0));
        if (input.dataset.cur === 'ILS') total += diff;
        cell.textContent = isZero(diff) ? '✓ مطابق' : `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}`;
        cell.className = `p-2 font-mono num font-black whitespace-nowrap closing-diff ${isZero(diff) ? 'text-emerald-600' : diff > 0 ? 'text-sky-700' : 'text-rose-600'}`;
    });
    $('closing-total').textContent = isZero(total) ? 'لا يوجد فرق بالشيكل' : `مجموع الفرق بالشيكل: ${total > 0 ? '+' : '−'}${fmt(Math.abs(total))} ₪ (${total > 0 ? 'زيادة' : 'نقص'})`;
}

async function saveClosing(e) {
    e.preventDefault();
    const date = localDateStr();
    const settle = $('closing_settle').checked;
    const note = $('closing_note').value.trim();
    const rows = [], moves = [];
    document.querySelectorAll('#closing-rows .closing-input').forEach(input => {
        if (input.value === '') return;
        const a = accounts.find(x => x.id === input.dataset.acc);
        const cur = input.dataset.cur;
        const system = round2(toNum(input.dataset.system, 0));
        const actual = round2(toNum(input.value, 0));
        const diff = round2(actual - system);
        const doSettle = settle && !isZero(diff);
        rows.push(normalizeClosing({ id: `${date}_${a.id}_${cur}`, date, accountId: a.id, accountName: accountName(a), currency: cur, system, actual, diff, settled: doSettle, note }));
        if (doSettle) moves.push(makeAmove({ accountId: a.id, currency: cur, amount: diff, reason: 'manual', note: `تسوية جرد ${date}${note ? ' · ' + note : ''}`, date }));
    });
    if (!rows.length) return showToast('تنبيه', 'اكتب الرصيد الفعلي لحساب واحد على الأقل', 'warning');
    const ids = new Set(rows.map(r => r.id));
    closings = closings.filter(c => !ids.has(c.id)).concat(rows);
    // الجرد بيقفل اليوم (السكربت بيحفظ القفل بالشيت حتى لو ما معك صلاحية الإعدادات)
    if (sheetHas('dayLock') && date > (globalConfig.lockedThrough || '')) globalConfig.lockedThrough = date;
    accountMoves.push(...moves);
    queueOps(...rows.map(r => ({ action: 'upsert_closing', closing: { ...r, settled: r.settled ? 'yes' : 'no' } })), ...amoveOps(moves));
    closeModal('closingModal');
    renderAccountsPage();
    const status = await flushOutbox();
    const off = rows.filter(r => !isZero(r.diff)).length;
    showToast('تم حفظ الجرد', `${rows.length} حساب · ${off ? `${off} فيها فرق${moves.length ? ' (سُوّيت)' : ''}` : 'كلها مطابقة ✓'} — ${syncResultMessage(status)}`, syncToastType(status));
}

// آخر الجرد: تاريخ، مين، وعدد الفروقات
function renderClosingHistory() {
    const byDate = {};
    closings.forEach(c => { (byDate[c.date] ??= []).push(c); });
    const dates = Object.keys(byDate).sort().reverse().slice(0, 7);
    $('closing-history').innerHTML = dates.length === 0
        ? '<div class="text-xs text-slate-400">لم يُعمل جرد بعد</div>'
        : dates.map(d => {
            const list = byDate[d];
            const off = list.filter(c => !isZero(c.diff));
            const ils = round2(off.filter(c => c.currency === 'ILS').reduce((s, c) => s + c.diff, 0));
            const by = [...new Set(list.map(c => c.createdBy).filter(Boolean))].map(personName).join('، ');
            return `<div class="flex flex-wrap justify-between gap-2 text-xs py-1.5 border-b border-slate-100 last:border-0">
                <span class="font-bold text-slate-700 num">${escapeHtml(d)}</span>
                <span class="${off.length ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold'}">${off.length ? `${off.length} فرق${!isZero(ils) ? ` · ${ils > 0 ? '+' : '−'}${fmt(Math.abs(ils))} ₪` : ''}` : '✓ مطابق'}</span>
                <span class="text-slate-400">${by ? 'بواسطة ' + escapeHtml(by) : ''}</span>
            </div>`;
        }).join('');
}

// ملخص شغل اليوم لكل موظف (من "أُضيفت بواسطة")
function employeeDaySummaryHtml(date) {
    const rows = {};
    const get = (u) => (rows[u || 'بدون اسم'] ??= { tx: 0, txIls: 0, usdt: 0, egp: 0, paidOut: 0, paidIn: 0, exp: 0 });
    ledger.forEach(t => { if (t.date === date && t.status !== CANCELLED) { const r = get(t.createdBy); r.tx++; r.txIls += t.clientIls; } });
    usdtMoves.forEach(m => { if (m.date === date && usdtTrade(m)) get(m.createdBy).usdt++; });
    egpMoves.forEach(m => { if (m.date === date && (m.kind === 'send' || m.kind === 'receive')) get(m.createdBy).egp++; });
    accountMoves.forEach(m => { if (m.date === date && REF_LABELS[m.refType] && m.currency === 'ILS') { const r = get(m.createdBy); if (m.amount < 0) r.paidOut -= m.amount; else r.paidIn += m.amount; } });
    expenses.forEach(e => { if (e.date === date) get(e.createdBy).exp += e.amount; });
    const names = Object.keys(rows);
    if (!names.length) return '<div class="text-xs text-slate-400">لا توجد حركات اليوم</div>';
    // عمود الجنيه يظهر فقط إذا في حركات جنيه اليوم
    const egpCol = names.some(n => rows[n].egp);
    return `<table class="w-full text-xs text-right">
        <thead><tr class="text-slate-500"><th class="p-1.5">الموظف</th><th class="p-1.5">حوالات</th><th class="p-1.5">USDT</th>${egpCol ? '<th class="p-1.5">جنيه</th>' : ''}<th class="p-1.5">دفعنا ₪</th><th class="p-1.5">استلمنا ₪</th><th class="p-1.5">مصاريف</th></tr></thead>
        <tbody>${names.map(n => { const r = rows[n]; return `<tr class="border-t border-slate-100">
            <td class="p-1.5 font-bold">${escapeHtml(personName(n))}</td>
            <td class="p-1.5 num">${r.tx}${r.tx ? ` <span class="text-slate-400">(${fmt(r.txIls, 0)} ₪)</span>` : ''}</td>
            <td class="p-1.5 num">${r.usdt}</td>${egpCol ? `<td class="p-1.5 num">${r.egp}</td>` : ''}
            <td class="p-1.5 num text-rose-600">${r.paidOut ? fmt(r.paidOut, 0) : '—'}</td>
            <td class="p-1.5 num text-emerald-600">${r.paidIn ? fmt(r.paidIn, 0) : '—'}</td>
            <td class="p-1.5 num">${r.exp ? fmt(r.exp, 0) : '—'}</td></tr>`; }).join('')}</tbody></table>`;
}
