'use strict';

// فاست باي — الحسابات والمحافظ وحركاتها، نافذة الدفع، ودفع الحوالات
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= الحسابات (محافظ وبنوك وكاش) =================
// رصيد كل حساب = مجموع حركاته (موجب دخل، سالب خرج). البنك والكاش فيهم شيكل ودولار، والمحافظ شيكل فقط.
const ACCOUNT_TYPES = {
    jawwal: { label: 'جوال باي', color: '#4ade80', soft: '#dcfce7', ink: '#166534', usd: false },
    palpay: { label: 'بال باي', color: '#581c87', soft: '#f3e8ff', ink: '#581c87', usd: false },
    malchat: { label: 'مالتشات', color: '#c4b5fd', soft: '#f5f3ff', ink: '#6d28d9', usd: false },
    bank: { label: 'بنك فلسطين', color: '#7c3aed', soft: '#ede9fe', ink: '#5b21b6', usd: true },
    cash: { label: 'كاش', color: '#f59e0b', soft: '#fef3c7', ink: '#92400e', usd: true },
    other: { label: 'أخرى', color: '#64748b', soft: '#f1f5f9', ink: '#334155', usd: false }
};
const AMOVE_REASONS = { manual: 'يدوي', transfer: 'تحويل بين الحسابات', usdt: 'USDT', tx: 'حوالة', egp: 'جنيه' };
// دفعات مرتبطة بعملية: اسمها في السبب (الضغط عليها يفتح سجلها)
const REF_LABELS = { tx: 'حوالة', usdt: 'USDT', egp: 'جنيه' };

let accounts = [];
let accountMoves = [];
let sheetSupportsWallets = true;
let accountFilterId = '';

function normalizeAccount(a) {
    const accType = ACCOUNT_TYPES[a?.accType] ? a.accType : 'other';
    return {
        id: String(a?.id ?? '').trim(),
        accType,
        holder: String(a?.holder ?? '').trim(),
        usd: a?.usd === true || a?.usd === 'yes',
        // تنبيه لما رصيد الشيكل ينزل تحت هالمبلغ (0 = بدون تنبيه)
        alertBelow: Math.max(0, toNum(a?.alertBelow, 0)),
        order: toNum(a?.order, 0),
        note: String(a?.note ?? '').trim(),
        createdAt: String(a?.createdAt ?? '').slice(0, 10)
    };
}

// الشيت يحفظ "فيه دولار" كنعم/لا
const accountPayload = (a) => ({ ...a, usd: a.usd ? 'yes' : 'no' });

function accountName(a) {
    if (!a) return 'حساب محذوف';
    const label = ACCOUNT_TYPES[a.accType].label;
    return a.holder ? `${label} – ${a.holder}` : label;
}

function normalizeAmove(m) {
    return {
        id: toNum(m?.id, 0),
        date: String(m?.date ?? '').slice(0, 10),
        accountId: String(m?.accountId ?? '').trim(),
        accountName: String(m?.accountName ?? '').trim(),
        currency: m?.currency === 'USD' ? 'USD' : 'ILS',
        amount: round2(toNum(m?.amount, 0)),
        reason: AMOVE_REASONS[m?.reason] ? m.reason : 'manual',
        // tx/usdt/egp: دفعة مرتبطة بحوالة أو حركة USDT أو جنيه، transfer: طرفا تحويل بين حسابين (نفس refId)
        refType: ['usdt', 'tx', 'egp', 'transfer'].includes(m?.refType) ? m.refType : '',
        refId: String(m?.refId ?? '').trim(),
        note: String(m?.note ?? '').trim(),
        createdBy: String(m?.createdBy ?? '').trim(),
        updatedBy: String(m?.updatedBy ?? '').trim()
    };
}

function sortedAccounts() {
    return [...accounts].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function accountBalances() {
    const map = {};
    accountMoves.forEach(m => {
        const b = (map[m.accountId] ??= { ILS: 0, USD: 0 });
        b[m.currency] = round2(b[m.currency] + m.amount);
    });
    return map;
}

const refMoves = (refType, refId) => accountMoves.filter(m => m.refType === refType && m.refId === String(refId));

// رقم إيصال الحركة المرتبطة بالدفعة (أو رقمها الطويل إذا مش عندنا)
function refNo(refType, refId) {
    const list = refType === 'tx' ? ledger : refType === 'usdt' ? usdtMoves : refType === 'egp' ? egpMoves : [];
    const x = list.find(r => String(r.id) === String(refId));
    return x ? receiptNo(x) : '#' + refId;
}

// المدفوع لحركة: dir = 1 للفلوس الداخلة لنا (إيداع USDT)، و -1 للخارجة منا (حوالة، سحب USDT)
function paidFor(refType, refId, currency, dir) {
    return round2(refMoves(refType, refId).filter(m => m.currency === currency).reduce((s, m) => s + m.amount * dir, 0));
}

function makeAmove({ accountId, currency, amount, reason, refType = '', refId = '', note = '', date = localDateStr() }) {
    const a = accounts.find(x => x.id === accountId);
    return normalizeAmove({ id: nextId(), date, accountId, accountName: accountName(a), currency, amount, reason, refType, refId, note });
}

const amoveOps = (moves) => moves.map(move => ({ action: 'upsert_amove', move }));

// ملاحظة الدفعة فيها اسم الزبون: لما تتعدل الحوالة/USDT/الجنيه نحدّث ملاحظة دفعاتها (إلا اللي انكتبت بيد)
function relinkNotesOps(refType, refId, note, isAuto) {
    const moves = refMoves(refType, refId).filter(m => m.note !== note && isAuto(m.note));
    moves.forEach(m => { m.note = note; });
    return amoveOps(moves);
}

function walletsReady() {
    if (sheetSupportsWallets) return true;
    showToast('حدّث السكربت أولاً', 'سكربت Google Sheets الحالي لا يدعم الحسابات و USDT', 'warning');
    return false;
}

// ---------- صفحة الحسابات ----------
function renderAccountsPage() {
    if (pageHidden('accounts')) return;
    $('wallets-unsupported-accounts').classList.toggle('hidden', sheetSupportsWallets || dataState !== 'ready');
    const bal = accountBalances();
    const list = sortedAccounts();
    let totalIls = 0, totalUsd = 0;
    list.forEach(a => { totalIls += bal[a.id]?.ILS || 0; totalUsd += bal[a.id]?.USD || 0; });
    $('accounts-total-ils').textContent = moneyCur(totalIls, 'ILS');
    $('accounts-total-usd').textContent = moneyCur(totalUsd, 'USD');

    $('accounts-grid').innerHTML = list.length === 0
        ? `<div class="col-span-full section-card p-8 text-center text-sm text-slate-400">${emptyMessage(0, '', 'لا توجد حسابات بعد. أضف حساباتك (جوال باي، بال باي، مالشات، البنك، الكاش) مع رصيدها الحالي.')}</div>`
        : list.map((a, i) => {
            const t = ACCOUNT_TYPES[a.accType];
            const b = bal[a.id] || { ILS: 0, USD: 0 };
            const active = accountFilterId === a.id;
            const low = isLowBalance(b.ILS, a.alertBelow);
            return `
                <div class="acc-card${active ? ' active' : ''}${low ? ' low' : ''}" data-action="filter-account" data-id="${escapeHtml(a.id)}" style="--acc:${t.color};--acc-soft:${t.soft};--acc-ink:${t.ink};--d:${i * 40}ms">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <span class="acc-chip">${escapeHtml(t.label)}</span>${low ? '<span class="low-chip" title="الرصيد أقل من حد التنبيه">⚠️ قليل</span>' : ''}
                            <div class="font-black text-slate-900 mt-1.5 truncate">${escapeHtml(a.holder || t.label)}</div>
                        </div>
                        <button data-action="edit-account" data-id="${escapeHtml(a.id)}" class="text-[11px] font-bold text-slate-400 hover:text-slate-700 px-1">تعديل</button>
                    </div>
                    <div class="mt-3 space-y-0.5">
                        <div class="acc-balance ${b.ILS < 0 ? 'neg' : ''}">${moneyCur(b.ILS, 'ILS')}</div>
                        ${a.usd ? `<div class="acc-balance usd ${b.USD < 0 ? 'neg' : ''}">${moneyCur(b.USD, 'USD')}</div>` : ''}
                    </div>
                </div>`;
        }).join('');
    renderAccountMoves();
    renderClosingHistory();
}

function renderAccountMoves() {
    const filterAcc = accounts.find(a => a.id === accountFilterId);
    $('amoves-title').textContent = filterAcc ? `حركات ${accountName(filterAcc)}` : 'آخر الحركات على كل الحسابات';
    $('amoves-clear').classList.toggle('hidden', !filterAcc);
    const moves = accountMoves
        .filter(m => !filterAcc || m.accountId === filterAcc.id)
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
        .slice(0, 200);
    $('amoves-body').innerHTML = moves.length === 0
        ? '<tr><td colspan="6" class="p-6 text-center text-xs text-slate-400">لا توجد حركات</td></tr>'
        : moves.map(m => {
            const a = accounts.find(x => x.id === m.accountId);
            const ref = REF_LABELS[m.refType]
                ? `<button data-action="goto-ref" data-type="${m.refType}" data-id="${escapeHtml(m.refId)}" class="ref-link">${REF_LABELS[m.refType]} ${escapeHtml(refNo(m.refType, m.refId))}</button>`
                : AMOVE_REASONS[m.reason];
            return `
                <tr class="hover:bg-slate-50">
                    <td class="p-3 text-xs text-slate-500 whitespace-nowrap num" title="${auditTitle(m)}">${escapeHtml(m.date)}${lockMark(m.date)}</td>
                    <td class="p-3 whitespace-nowrap"><span class="acc-dot" style="--acc:${ACCOUNT_TYPES[a?.accType || 'other'].color}"></span> <b class="text-slate-800">${escapeHtml(a ? accountName(a) : m.accountName)}</b></td>
                    <td class="p-3 font-mono font-black num whitespace-nowrap ${m.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${m.amount >= 0 ? '+' : '−'}${moneyCur(Math.abs(m.amount), m.currency)}</td>
                    <td class="p-3 text-xs text-slate-600 whitespace-nowrap">${ref}</td>
                    <td class="p-3 text-xs text-slate-500">${escapeHtml(m.note)}</td>
                    <td class="p-3 text-center whitespace-nowrap">
                        <button data-action="edit-amove" data-id="${m.id}" class="text-blue-600 hover:text-blue-800 font-bold text-xs px-2 py-1 bg-blue-50 rounded-lg">تعديل</button>
                        <button data-action="delete-amove" data-id="${m.id}" class="text-slate-400 hover:text-red-600 font-bold text-xs p-1" title="حذف الحركة">✕</button>
                    </td>
                </tr>`;
        }).join('');
}

function accountOptionsHtml(currency, selected = '') {
    return sortedAccounts()
        .filter(a => currency !== 'USD' || a.usd)
        .map(a => `<option value="${escapeHtml(a.id)}" ${a.id === selected ? 'selected' : ''}>${escapeHtml(accountName(a))}</option>`).join('');
}

function openAccountModal(a = null) {
    if (!walletsReady()) return;
    $('accountModalTitle').textContent = a ? 'تعديل الحساب' : 'حساب جديد';
    $('acc_id').value = a ? a.id : '';
    $('acc_type').value = a ? a.accType : 'jawwal';
    $('acc_holder').value = a ? a.holder : '';
    $('acc_usd').checked = a ? a.usd : ACCOUNT_TYPES.jawwal.usd;
    $('acc_note').value = a ? a.note : '';
    $('acc_alert').value = a && a.alertBelow ? a.alertBelow : '';
    $('acc_alert').disabled = !sheetHas('alerts');
    $('acc_open_ils').value = '';
    $('acc_open_usd').value = '';
    $('acc_opening').classList.toggle('hidden', !!a);
    $('acc_delete').classList.toggle('hidden', !a);
    syncAccountUsdField();
    openModal('accountModal');
    $('acc_holder').focus();
}

function syncAccountUsdField() {
    $('acc_open_usd_wrap').classList.toggle('hidden', !$('acc_usd').checked);
}

async function saveAccount(e) {
    e.preventDefault();
    if (!walletsReady()) return;
    const editId = $('acc_id').value;
    const existing = accounts.find(a => a.id === editId);
    const acc = normalizeAccount({
        id: editId || 'a' + nextId(),
        accType: $('acc_type').value,
        holder: $('acc_holder').value,
        usd: $('acc_usd').checked,
        alertBelow: sheetHas('alerts') ? $('acc_alert').value : existing?.alertBelow,
        order: existing ? existing.order : accounts.reduce((m, a) => Math.max(m, a.order), -1) + 1,
        note: $('acc_note').value,
        createdAt: existing ? existing.createdAt : localDateStr()
    });
    if (existing) Object.assign(existing, acc); else accounts.push(acc);
    const ops = [{ action: 'upsert_account', account: accountPayload(acc) }];
    // الرصيد الحالي عند إنشاء الحساب = حركة يدوية أولى
    if (!existing) {
        const moves = [];
        const ils = toNum($('acc_open_ils').value, 0), usd = acc.usd ? toNum($('acc_open_usd').value, 0) : 0;
        if (ils) moves.push(makeAmove({ accountId: acc.id, currency: 'ILS', amount: ils, reason: 'manual', note: 'رصيد افتتاحي' }));
        if (usd) moves.push(makeAmove({ accountId: acc.id, currency: 'USD', amount: usd, reason: 'manual', note: 'رصيد افتتاحي' }));
        accountMoves.push(...moves);
        ops.push(...amoveOps(moves));
    }
    queueOps(...ops);
    closeModal('accountModal');
    renderAccountsPage();
    const status = await flushOutbox();
    showToast(existing ? 'تم تعديل الحساب' : 'تمت إضافة الحساب', `${accountName(acc)} — ${syncResultMessage(status)}`, syncToastType(status));
}

function deleteAccountPrompt() {
    const a = accounts.find(x => x.id === $('acc_id').value);
    if (!a) return;
    if (accountMoves.some(m => m.accountId === a.id)) {
        return showToast('لا يمكن الحذف', 'على هذا الحساب حركات. احذف حركاته أولاً أو اتركه.', 'warning');
    }
    showAppConfirm('حذف الحساب', `حذف "${accountName(a)}"؟`, async () => {
        accounts = accounts.filter(x => x.id !== a.id);
        queueOps({ action: 'delete_account', id: a.id });
        closeModal('accountModal');
        if (accountFilterId === a.id) accountFilterId = '';
        renderAccountsPage();
        const status = await flushOutbox();
        showToast('تم حذف الحساب', syncResultMessage(status), syncToastType(status));
    });
}

// حركة يدوية (إضافة / سحب) أو تحويل بين حسابين، أو تعديل حركة موجودة
let editingAmoveIds = []; // عند التعديل: الحركة نفسها، أو طرفا التحويل

function transferLegs(m) {
    if (m.refType !== 'transfer' || !m.refId) return [m];
    const legs = accountMoves.filter(x => x.refType === 'transfer' && x.refId === m.refId);
    return legs.length === 2 ? legs : [m];
}

function openAmoveModal(mode = 'manual', move = null) {
    if (!walletsReady()) return;
    if (!accounts.length) return showToast('لا توجد حسابات', 'أضف حساباً أولاً', 'warning');
    const legs = move ? transferLegs(move) : [];
    if (move) mode = legs.length === 2 ? 'transfer' : 'manual';
    editingAmoveIds = legs.map(x => x.id);
    const from = legs.length === 2 ? legs.find(x => x.amount < 0) : move;
    const to = legs.length === 2 ? legs.find(x => x.amount > 0) : null;
    const linked = !!move && !!REF_LABELS[move.refType];
    $('am_mode').value = mode;
    $('amoveModalTitle').textContent = move
        ? (linked ? `تعديل دفعة ${REF_LABELS[move.refType]} ${refNo(move.refType, move.refId)}` : 'تعديل الحركة')
        : mode === 'transfer' ? 'تحويل بين الحسابات' : 'حركة يدوية على حساب';
    $('am_currency').value = move ? move.currency : 'ILS';
    $('am_amount').value = move ? Math.abs(from.amount) : '';
    $('am_note').value = move ? move.note : '';
    $('am_date').value = move ? move.date : localDateStr();
    $('am_dir').value = move && move.amount < 0 ? 'out' : 'in';
    // دفعة حوالة/USDT: اتجاهها وعملتها ثابتان
    $('am_dir').disabled = linked;
    $('am_currency').disabled = linked;
    $('am_manual_fields').classList.toggle('hidden', mode === 'transfer');
    $('am_to_wrap').classList.toggle('hidden', mode !== 'transfer');
    $('am_from_label').textContent = mode === 'transfer' ? 'من حساب' : 'الحساب';
    $('am_account').innerHTML = '';
    $('am_to').innerHTML = '';
    fillAmoveAccounts();
    if (move) {
        $('am_account').value = from.accountId;
        if (to) $('am_to').value = to.accountId;
    } else if (accountFilterId) {
        $('am_account').value = accountFilterId;
    }
    openModal('amoveModal');
    $('am_amount').focus();
}

function fillAmoveAccounts() {
    const cur = $('am_currency').value;
    const from = $('am_account').value, to = $('am_to').value;
    $('am_account').innerHTML = accountOptionsHtml(cur, from);
    $('am_to').innerHTML = accountOptionsHtml(cur, to);
    if ($('am_mode').value === 'transfer' && $('am_to').value === $('am_account').value && $('am_to').options.length > 1) $('am_to').selectedIndex = 1;
}

async function saveAmove(e) {
    e.preventDefault();
    if (!walletsReady()) return;
    const mode = $('am_mode').value;
    const currency = $('am_currency').value;
    const amount = round2(toNum($('am_amount').value, 0));
    const date = $('am_date').value || localDateStr();
    const note = $('am_note').value.trim();
    const from = $('am_account').value;
    if (!from) return showToast('تنبيه', currency === 'USD' ? 'لا يوجد حساب فيه دولار' : 'اختر الحساب', 'warning');
    if (!(amount > 0)) return showToast('تنبيه', 'اكتب المبلغ', 'warning');
    let moves;
    const editing = editingAmoveIds.map(id => accountMoves.find(x => x.id === id)).filter(Boolean);
    if (mode === 'transfer') {
        const to = $('am_to').value;
        if (!to || to === from) return showToast('تنبيه', 'اختر حسابين مختلفين', 'warning');
        const label = `${accountName(accounts.find(a => a.id === from))} ← ${accountName(accounts.find(a => a.id === to))}`;
        const out = makeAmove({ accountId: from, currency, amount: -amount, reason: 'transfer', note: note || label, date });
        const inn = makeAmove({ accountId: to, currency, amount, reason: 'transfer', note: note || label, date });
        // نفس الأرقام عند التعديل، والطرفان مربوطان برقم واحد
        if (editing.length === 2) {
            out.id = editing.find(x => x.amount < 0).id;
            inn.id = editing.find(x => x.amount > 0).id;
        }
        out.refType = inn.refType = 'transfer';
        out.refId = inn.refId = editing[0]?.refId || String(out.id);
        moves = [out, inn];
    } else if (editing.length === 1) {
        const old = editing[0];
        const linked = !!REF_LABELS[old.refType];
        const sign = linked ? Math.sign(old.amount) || 1 : $('am_dir').value === 'out' ? -1 : 1;
        moves = [normalizeAmove({ ...old, accountId: from, accountName: accountName(accounts.find(a => a.id === from)), currency: linked ? old.currency : currency, amount: sign * amount, date, note })];
    } else {
        const sign = $('am_dir').value === 'out' ? -1 : 1;
        moves = [makeAmove({ accountId: from, currency, amount: sign * amount, reason: 'manual', note, date })];
    }
    if (moves.some(x => editLocked('accountMoves', editing.find(y => y.id === x.id), x))) return lockWarn();
    const ids = new Set(moves.map(x => x.id));
    accountMoves = accountMoves.filter(x => !ids.has(x.id)).concat(moves);
    editingAmoveIds = [];
    queueOps(...amoveOps(moves));
    closeModal('amoveModal');
    renderAccountsPage();
    renderUsdtPage();
    renderEgpPage();
    renderLedgerTable();
    const status = await flushOutbox();
    showToast(editing.length ? 'تم تعديل الحركة' : 'تم حفظ الحركة', `${moneyCur(amount, currency)} — ${syncResultMessage(status)}`, syncToastType(status));
}

// الضغط على "حوالة #…" أو "USDT #…" أو "جنيه #…" يفتح سجلها مفلتراً على رقمها (رقم الإيصال إذا إلها)
function gotoRef(type, id) {
    const no = refNo(type, id);
    if (type === 'egp') {
        if (!hasPerm('egp')) return showToast('لا توجد صلاحية', 'صفحة الجنيه غير متاحة لك', 'warning');
        $('egp_kind_filter').value = 'ALL';
        $('egp_month_filter').value = '';
        $('egp_search').value = no;
        egpSearch = no;
        egpWalletFilter = '';
        switchTab('egp');
    } else if (type === 'tx') {
        if (!hasPerm('transactions')) return showToast('لا توجد صلاحية', 'صفحة سجل الحوالات غير متاحة لك', 'warning');
        $('tx_date_filter').value = '';
        $('tx_month_filter').value = '';
        $('tx_search').value = no.replace('#', '');
        ledgerLimit = LEDGER_PAGE;
        switchTab('transactions');
    } else {
        if (!hasPerm('usdt')) return showToast('لا توجد صلاحية', 'صفحة USDT غير متاحة لك', 'warning');
        $('usdt_kind_filter').value = 'ALL';
        $('usdt_month_filter').value = '';
        $('usdt_search').value = no;
        usdtSearch = no;
        switchTab('usdt');
    }
}

function deleteAmovePrompt(id) {
    const m = accountMoves.find(x => x.id === id);
    if (!m) return;
    const legs = transferLegs(m);
    if (legs.some(x => dayLocked(x.date))) return lockWarn();
    const linked = REF_LABELS[m.refType] ? ` هذه الحركة مرتبطة بـ ${REF_LABELS[m.refType]} ${refNo(m.refType, m.refId)}، وحذفها يقلل المدفوع منها.` : '';
    const both = legs.length === 2 ? ' (يُحذف طرفا التحويل معاً)' : '';
    showAppConfirm('حذف الحركة', `حذف ${moneyCur(Math.abs(m.amount), m.currency)} من "${m.accountName}"؟${linked}${both}`, async () => {
        const ids = new Set(legs.map(x => x.id));
        accountMoves = accountMoves.filter(x => !ids.has(x.id));
        queueOps(...legs.map(x => ({ action: 'delete_amove', id: x.id })));
        renderAccountsPage();
        renderUsdtPage();
        renderEgpPage();
        renderLedgerTable();
        const status = await flushOutbox();
        showToast('تم حذف الحركة', syncResultMessage(status), syncToastType(status));
    });
}

// ================= نافذة الدفع: من أي حساب (أو أكثر) دُفع / استُلم المبلغ =================
// ctx: { title, subtitle, currency, due, paid, dir (1 داخل لنا / -1 خارج منا), onSave(lines, settle), onSkip?, onCancel? }
let payCtx = null;

function payRemaining() {
    return payCtx ? round2(payCtx.due - payCtx.paid) : 0;
}

function payEntered() {
    return round2([...document.querySelectorAll('#pay-accounts .pay-input')].reduce((s, el) => s + Math.max(0, toNum(el.value, 0)), 0));
}

function openPayModal(ctx) {
    payCtx = ctx;
    const bal = accountBalances();
    const list = sortedAccounts().filter(a => ctx.currency !== 'USD' || a.usd);
    $('payModalTitle').textContent = ctx.title;
    $('pay-subtitle').textContent = ctx.subtitle || '';
    $('pay-dir-label').textContent = ctx.dir > 0 ? 'وين وصلت الفلوس؟' : 'دفعت من وين؟';
    $('pay-accounts').innerHTML = list.length === 0
        ? `<div class="text-xs text-slate-400 text-center py-4">لا يوجد حساب ${ctx.currency === 'USD' ? 'فيه دولار' : ''}. أضف حساباتك من صفحة "الحسابات".</div>`
        : list.map(a => {
            const t = ACCOUNT_TYPES[a.accType];
            const b = bal[a.id]?.[ctx.currency] || 0;
            return `
                <div class="pay-row" style="--acc:${t.color}">
                    <span class="acc-dot"></span>
                    <div class="min-w-0 flex-1">
                        <div class="font-bold text-slate-800 truncate">${escapeHtml(accountName(a))}</div>
                        <div class="text-[10px] text-slate-400">الرصيد ${moneyCur(b, ctx.currency)}</div>
                    </div>
                    <button type="button" data-action="pay-fill" data-id="${escapeHtml(a.id)}" class="text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-md shrink-0">الباقي</button>
                    <input type="number" step="any" min="0" inputmode="decimal" data-acc="${escapeHtml(a.id)}" class="pay-input" placeholder="0">
                </div>`;
        }).join('');
    $('pay_settle').checked = false;
    $('pay-skip').classList.toggle('hidden', !ctx.onSkip);
    updatePaySummary();
    openModal('payModal');
    $('pay-accounts').querySelector('.pay-input')?.focus();
}

function payFill(accountId) {
    const input = $('pay-accounts').querySelector(`.pay-input[data-acc="${CSS.escape(accountId)}"]`);
    if (!input) return;
    const others = payEntered() - Math.max(0, toNum(input.value, 0));
    input.value = Math.max(0, round2(payRemaining() - others)) || '';
    updatePaySummary();
}

function updatePaySummary() {
    if (!payCtx) return;
    const cur = payCtx.currency;
    const remaining = payRemaining();
    const entered = payEntered();
    const after = round2(remaining - entered);
    $('pay-summary').innerHTML = `
        <div><span>المطلوب</span><b>${moneyCur(payCtx.due, cur)}</b></div>
        <div><span>مدفوع سابقاً</span><b>${moneyCur(payCtx.paid, cur)}</b></div>
        <div><span>الباقي الآن</span><b class="${after > 0.004 ? 'text-amber-700' : after < -0.004 ? 'text-rose-700' : 'text-emerald-700'}">${moneyCur(Math.max(after, 0), cur)}${after < -0.004 ? ' (زيادة!)' : ''}</b></div>`;
    const showSettle = after > 0.004;
    $('pay-settle-wrap').classList.toggle('hidden', !showSettle);
    $('pay-settle-text').textContent = `اعتبر الباقي (${moneyCur(Math.max(after, 0), cur)}) خصماً وأغلق الحركة كمدفوعة`;
}

function cancelPayModal() {
    const ctx = payCtx;
    payCtx = null;
    closeModal('payModal');
    ctx?.onCancel?.();
}

function savePayModal() {
    const ctx = payCtx;
    if (!ctx) return;
    const remaining = payRemaining();
    const entered = payEntered();
    if (entered - remaining > 0.004) return showToast('تنبيه', 'المبلغ المدخل أكبر من الباقي', 'warning');
    const settle = $('pay_settle').checked && remaining - entered > 0.004 ? round2(remaining - entered) : 0;
    if (!(entered > 0) && !settle) return showToast('تنبيه', 'اكتب المبلغ في حساب واحد على الأقل', 'warning');
    const lines = [...document.querySelectorAll('#pay-accounts .pay-input')]
        .map(el => ({ accountId: el.dataset.acc, amount: round2(Math.max(0, toNum(el.value, 0))) }))
        .filter(l => l.amount > 0);
    payCtx = null;
    closeModal('payModal');
    ctx.onSave(lines, settle);
}

function skipPayModal() {
    const ctx = payCtx;
    payCtx = null;
    closeModal('payModal');
    ctx?.onSkip?.();
}

// تنبيه إذا صار رصيد حساب سالباً بعد الدفع
function warnNegative(lines, currency) {
    const bal = accountBalances();
    const neg = lines.map(l => accounts.find(a => a.id === l.accountId)).filter(a => a && (bal[a.id]?.[currency] || 0) < 0);
    if (neg.length) showToast('انتبه: رصيد سالب', neg.map(accountName).join('، '), 'warning');
}

// ================= دفع الحوالات (مكتمل / جزئي) =================
const PAID_STATUSES = ['جزئي', 'مكتمل'];
const txDue = (t) => (t.currency === 'USD' ? t.clientUsd : t.clientIls);
const txPaid = (t) => paidFor('tx', t.id, t.currency, -1);

function openTxPayModal(tx, wantedStatus = 'مكتمل', { afterCreate = false } = {}) {
    openPayModal({
        title: `دفع الحوالة ${receiptNo(tx)}`,
        subtitle: `${tx.recipient} · ${payoutLabel(tx)}`,
        currency: tx.currency,
        due: txDue(tx),
        paid: txPaid(tx),
        dir: -1,
        onSave: (lines, settle) => {
            const moves = lines.map(l => makeAmove({ accountId: l.accountId, currency: tx.currency, amount: -l.amount, reason: 'tx', refType: 'tx', refId: tx.id, note: tx.recipient }));
            accountMoves.push(...moves);
            const done = settle > 0 || txDue(tx) - txPaid(tx) <= 0.004;
            applyTxStatus(tx, done ? 'مكتمل' : 'جزئي', amoveOps(moves));
            warnNegative(lines, tx.currency);
        },
        // بدون تسجيل حساب: تتغير الحالة فقط
        onSkip: afterCreate ? null : () => applyTxStatus(tx, wantedStatus),
        onCancel: () => renderLedgerTable()
    });
}

async function applyTxStatus(tx, status, extraOps = []) {
    tx.status = status;
    queueOps(...extraOps, { action: 'upsert', ...tx });
    renderLedgerTable();
    renderAccountsPage();
    const syncStatus = await flushOutbox();
    const paid = txPaid(tx);
    const detail = status === 'جزئي' ? ` · مدفوع ${moneyCur(paid, tx.currency)} من ${moneyCur(txDue(tx), tx.currency)}` : '';
    showToast('تم تغيير الحالة', `${receiptNo(tx)}: ${status}${detail} — ${syncResultMessage(syncStatus)}`, syncStatus === 'ok' ? 'info' : syncToastType(syncStatus));
}

// إرجاع دفعات الحوالة للحسابات (عند إلغاء الدفع أو حذف الحوالة)
function refundTxOps(tx) {
    const moves = refMoves('tx', tx.id);
    accountMoves = accountMoves.filter(m => !moves.includes(m));
    return moves.map(m => ({ action: 'delete_amove', id: m.id }));
}
