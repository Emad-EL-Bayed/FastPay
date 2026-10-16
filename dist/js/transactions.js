'use strict';

// فاست باي — حفظ الحوالة، السجل، التعديل، تصدير Excel
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= حفظ حوالة جديدة =================
function newTxId() {
    // معرّف مبني على الوقت: لا يتكرر حتى لو مُسحت بيانات المتصفح وبقيت الصفوف في الشيت
    const maxId = ledger.reduce((m, t) => Math.max(m, t.id), 0);
    return Math.max(Date.now(), maxId + 1);
}

let lastSavedTxId = null;

async function saveNewTransaction() {
    const form = readNewTxForm();
    if (!form) return;
    startSaveTxButton();
    let saved = false;
    try {
        const customer = upsertTxCustomer(form);
        const tx = buildNewTx(form, customer);
        ledger.unshift(tx);
        highlightTxId = tx.id;
        queueOps({ action: 'upsert_customer', customer }, { action: 'upsert', ...tx });
        renderLedgerTable();
        renderCustomersTable();
        renderRecentTx();

        const syncStatus = await flushOutbox();
        saved = true;
        const amountText = tx.currency === 'USD' ? `$${fmt(tx.clientUsd)}` : `${fmt(tx.clientIls)} ₪`;
        showToast('تم حفظ الحوالة', `${form.recipient} — ${amountText} بسعر شاشة ${tx.screenRate}. ${syncResultMessage(syncStatus)}`, syncToastType(syncStatus));

        lastSavedTxId = tx.id;
        $('last-receipt-btn').classList.remove('hidden');
        if (PAID_STATUSES.includes(tx.status) && sheetSupportsWallets && accounts.length) openTxPayModal(tx, tx.status, { afterCreate: true });
        // تفريغ النموذج للحوالة التالية (المصدر المختار يبقى كما هو)
        resetCalcForm();
        $('calc_recipient').focus();
    } finally {
        finishSaveTxButton(saved);
    }
}

// نموذج الحاسبة بعد التحقق، أو null بعد تنبيه بالخانة الناقصة
function readNewTxForm() {
    const warn = (msg) => { showToast('تنبيه', msg, 'warning'); return null; };
    const input = readCalcInputs();
    if (input.orig <= 0) return warn('الرجاء إدخال المبلغ أولاً');
    if (input.isOther && !input.country) {
        $('calc_other_name').focus();
        return warn('اكتب نوع المعاملة في خانة "نوع المعاملة"');
    }
    if (!input.country) return warn('الرجاء اختيار الدولة أو المصدر');
    if (input.screenRate <= 0) return warn('سعر الشاشة غير صحيح');

    const recipient = $('calc_recipient').value.trim();
    if (!recipient) return warn('الرجاء كتابة اسم العميل');

    const payout = $('calc_payout_type').value;
    const provider = payout === 'كاش' ? '' : $('calc_provider').value;
    const account = payout === 'كاش' ? '' : $('calc_account').value.trim();
    if (payout !== 'كاش' && !account) {
        $('calc_account').focus();
        return warn(payout === 'بنكي' ? 'اكتب رقم الحساب البنكي' : 'اكتب رقم المحفظة');
    }
    // الزبون المختار من القائمة أو بنفس الاسم، وإلا زبون جديد
    const customer = customers.find(c => c.id === $('calc_customer_id').value)
        || customers.find(c => normName(c.name) === normName(recipient));
    const phone = readCustomerPhone('calc', customer?.id);
    if (phone === null) return null;
    const date = $('calc_date').value || localDateStr();
    if (backdateLocked(date)) { lockWarn(); return null; }
    return {
        input, recipient, payout, provider, account, customer, phone,
        date,
        status: $('calc_status').value
    };
}

// ربط الحوالة بالزبون (مع تحديث بياناته ورقم الواتساب إن كُتب)، أو إنشاء زبون جديد
function upsertTxCustomer({ customer, recipient, payout, provider, account, phone, date }) {
    if (customer) {
        Object.assign(customer, { name: recipient, payout, provider, account: account || customer.account }, phone ? { phone } : {});
        return customer;
    }
    const created = { id: newCustomerId(), name: recipient, phone, payout, provider, account, createdAt: date };
    customers.unshift(created);
    return created;
}

// الحساب من الأرقام مباشرة (وليس من النص المعروض) ثم التقريب لقرشين
function buildNewTx({ input, recipient, payout, provider, account, date, status }, customer) {
    const r = computeTransfer(input);
    return {
        id: newTxId(),
        date, customerId: customer.id, recipient, phone: '', account, payout, provider,
        currency: input.currency,
        country: input.country,
        type: input.type,
        orig: input.orig,
        factor: input.factor,
        costPct: input.costPct,
        costMode: input.costMode,
        costFixed: input.costFixed,
        profitPct: input.profitPct,
        minusIls: input.minusIls,
        screenRate: input.screenRate,
        clientIls: round2(r.clientIls),
        clientUsd: round2(r.clientUsd),
        costIls: round2(r.costIls),
        profitIls: round2(r.profitIls),
        status
    };
}

// زر الحفظ: "جاري الحفظ..." ثم "✓ تم الحفظ" لثانية، ويبقى معطلاً أثناء تحميل البيانات
function startSaveTxButton() {
    const btn = $('save-tx-btn');
    btn.disabled = true;
    btn.classList.add('saving');
    btn.querySelector('.save-btn-label').textContent = 'جاري الحفظ...';
}

function finishSaveTxButton(saved) {
    const btn = $('save-tx-btn');
    const label = btn.querySelector('.save-btn-label');
    btn.classList.remove('saving');
    if (saved) {
        btn.classList.add('done');
        label.textContent = '✓ تم الحفظ';
        setTimeout(() => {
            btn.classList.remove('done');
            label.textContent = 'حفظ الحوالة';
            btn.disabled = dataState === 'loading';
        }, 1300);
    } else {
        label.textContent = 'حفظ الحوالة';
        btn.disabled = dataState === 'loading';
    }
}

// ================= سجل الحوالات =================
function emptyMessage(total, noMatch, noData) {
    if (dataState === 'loading') return 'جاري التحميل من Google Sheets...';
    if (dataState === 'error' && !total) return 'تعذر قراءة البيانات من Google Sheets';
    return total ? noMatch : noData;
}

const SYNC_TITLES = {
    pending: 'جاري الإرسال إلى Google Sheets',
    failed: 'لم تصل إلى Google Sheets بعد'
};

function hiddenStatuses() {
    return Array.isArray(globalConfig.hiddenStatuses) ? globalConfig.hiddenStatuses : [];
}

// أزرار الحالات: كل حالة تشتغل أو تطفي، مع عدد الحوالات فيها
function renderStatusToggles() {
    const hidden = hiddenStatuses();
    const counts = {};
    ledger.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; });
    $('tx_status_toggles').innerHTML = STATUSES.map(s => {
        const on = !hidden.includes(s);
        return `<button type="button" data-action="toggle-status" data-status="${s}" class="status-toggle${on ? ' on' : ''}" style="--c:${STATUS_TOGGLE_COLORS[s]}" aria-pressed="${on}">
            <span class="sw"></span>${s}<span class="cnt">${counts[s] || 0}</span>
        </button>`;
    }).join('');
}

const STATUS_TOGGLE_COLORS = { 'قيد الإنتظار': '#f59e0b', 'فحص': '#64748b', 'جزئي': '#0ea5e9', 'مكتمل': '#10b981', 'ملغي': '#f43f5e' };

function toggleStatusFilter(status) {
    const hidden = hiddenStatuses();
    globalConfig.hiddenStatuses = hidden.includes(status) ? hidden.filter(s => s !== status) : [...hidden, status];
    saveAll();
    resetLedgerAndRender();
}

// الجدول يعرض أول 200 حوالة من نتيجة البحث، وزر "عرض المزيد" يضيف 200
const LEDGER_PAGE = 200;
let ledgerLimit = LEDGER_PAGE;

// عند تغيير البحث أو الفلاتر نرجع لأول 200
function resetLedgerAndRender() {
    ledgerLimit = LEDGER_PAGE;
    renderLedgerTable();
}

function renderLedgerTable() {
    if (pageHidden('transactions')) return;
    renderStatusToggles();
    const search = ($('tx_search').value || '').trim().toLowerCase();
    const searchPhone = normPhone(search);
    // رقم الحوالة (#): يكفي جزء منه، 3 أرقام على الأقل، أو رقم الإيصال كاملاً
    const searchId = /^#?\d{3,}$/.test(search) ? search.replace('#', '') : '';
    // رقم إيصال موجود بالضبط: بس هي (الرقم القصير ممكن يكون جوّا أرقام حركات طويلة)
    const serialHit = !!searchId && ledger.some(t => String(t.serial) === searchId);
    const hidden = hiddenStatuses();
    const monthFilter = $('tx_month_filter').value || '';
    const dateFilter = $('tx_date_filter').value || '';

    const filtered = ledger.filter(t => {
        const matchSearch = !search ||
            t.recipient.toLowerCase().includes(search) ||
            (searchPhone && normPhone(t.account).includes(searchPhone)) ||
            (searchId && (serialHit ? String(t.serial) === searchId : String(t.id).includes(searchId)));
        // البحث برقم الحوالة أو الإيصال كاملاً يُظهرها حتى لو كانت حالتها مخفية
        const matchStatus = !hidden.includes(t.status) || (searchId && (String(t.id) === searchId || String(t.serial) === searchId));
        const matchMonth = !monthFilter || t.date.startsWith(monthFilter);
        const matchDate = !dateFilter || t.date === dateFilter;
        return matchSearch && matchStatus && matchMonth && matchDate;
    });

    if (filtered.length === 0) {
        $('ledger-body').innerHTML = `<tr><td colspan="12" class="p-6 text-center text-xs text-slate-400">${emptyMessage(ledger.length, 'لا توجد نتائج مطابقة للفلترة', 'لا توجد حوالات في الشيت بعد')}</td></tr>`;
        return;
    }

    const shown = filtered.slice(0, ledgerLimit);
    const rest = filtered.length - shown.length;
    $('ledger-body').innerHTML = shown.map(t => {
        const cancelled = t.status === CANCELLED;
        const syncState = txSyncState(t.id);
        const syncDot = syncState ? `<span class="sync-dot ${syncState}" title="${SYNC_TITLES[syncState]}"></span>` : '';
        return `
            <tr class="hover:bg-slate-50">
                <td class="p-3.5 text-center text-[10px] text-slate-400 font-mono whitespace-nowrap" title="${auditTitle(t)}${t.serial ? ` · رقم الحركة ${t.id}` : ''}">${syncDot} ${receiptNo(t)}</td>
                <td class="p-3.5 whitespace-nowrap text-slate-500 text-xs num">${escapeHtml(t.date)}${lockMark(t.date)}</td>
                <td class="p-3.5"><button data-action="open-customer" data-id="${escapeHtml(t.customerId)}" data-name="${escapeHtml(t.recipient)}" class="font-bold text-slate-900 hover:text-blue-700 hover:underline text-right whitespace-nowrap" title="ملف الزبون">${escapeHtml(t.recipient)}</button></td>
                <td class="p-3.5 font-mono text-xs text-slate-600 select-all">${escapeHtml(t.account || '-')}</td>
                <td class="p-3.5 whitespace-nowrap"><span class="badge ${payoutBadgeClass(t.payout)}">${escapeHtml(payoutLabel(t))}</span></td>
                <td class="p-3.5 whitespace-nowrap"><span class="badge bg-slate-100 text-slate-700">${escapeHtml(t.country)}</span></td>
                <td class="p-3.5 font-mono font-semibold num text-slate-800">${fmt(t.orig, 2)}</td>
                <td class="p-3.5 font-mono text-left font-black text-slate-900 num whitespace-nowrap">${deliveredHtml(t)}</td>
                <td class="profit-only p-3.5 font-mono text-left font-black ${cancelled ? 'text-slate-400 line-through' : 'text-emerald-600'} num whitespace-nowrap">+${fmt(t.profitIls)} ₪</td>
                <td class="p-3.5 text-center font-mono text-xs font-bold text-slate-500">${fmt(t.screenRate, 3)} ₪</td>
                <td class="p-3.5 text-center whitespace-nowrap">
                    <span class="inline-flex items-center gap-1.5">
                        <select data-action="change-status" data-id="${t.id}" class="text-xs rounded-lg px-2.5 py-1 border outline-none cursor-pointer ${statusSelectClass(t.status)}">
                            ${STATUSES.map(s => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                        </select>
                        ${whatsappButton(customerOfTx(t), { compact: true })}
                    </span>
                    ${t.status === 'جزئي' ? `<div class="text-[10px] text-sky-700 mt-1">مدفوع ${fmt(txPaid(t))} من ${fmt(txDue(t))} ${CUR_SYM[t.currency]} <button data-action="tx-pay" data-id="${t.id}" class="font-bold underline mr-1">+ دفعة</button></div>` : ''}
                </td>
                <td class="p-3.5 text-center whitespace-nowrap">
                    <button data-action="open-receipt" data-id="${t.id}" class="text-slate-700 hover:text-slate-900 font-bold text-xs px-2.5 py-1 bg-slate-100 rounded-lg">فاتورة</button>
                    <button data-action="edit-tx" data-id="${t.id}" class="text-blue-600 hover:text-blue-800 font-bold text-xs px-2.5 py-1 bg-blue-50 rounded-lg mr-1">تعديل</button>
                    <button data-action="delete-tx" data-id="${t.id}" class="text-slate-400 hover:text-red-600 p-1 font-bold" title="حذف من السجل ومن الإكسل">✕</button>
                </td>
            </tr>
        `;
    }).join('') + (rest > 0 ? `
        <tr><td colspan="12" class="p-3 text-center">
            <button data-action="ledger-more" class="text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg transition">عرض ${Math.min(rest, LEDGER_PAGE)} حوالة أخرى</button>
            <span class="text-[11px] text-slate-400 mr-2">معروض ${shown.length} من ${filtered.length}</span>
        </td></tr>` : '');
}

function clearTxFilters() {
    $('tx_search').value = '';
    $('tx_date_filter').value = '';
    $('tx_month_filter').value = '';
    resetLedgerAndRender();
}

// مكتمل / جزئي: نسأل "دفعت من وين؟" ونسجّل الخصم من الحسابات.
// الرجوع لحالة أخرى (أو الحذف) يُرجع المبلغ المدفوع للحسابات.
async function changeOrderStatus(id, newStatus) {
    const tx = ledger.find(x => x.id === id);
    if (!tx || !STATUSES.includes(newStatus)) return;
    // يوم مقفل: الحالة بتتغير عادي، إلا الإلغاء أو إرجاع دفعات مقفلة
    if ((newStatus === CANCELLED && dayLocked(tx.date)) || (!PAID_STATUSES.includes(newStatus) && refMoves('tx', tx.id).some(m => dayLocked(m.date)))) {
        renderLedgerTable();
        return lockWarn();
    }
    if (PAID_STATUSES.includes(newStatus)) {
        if (sheetSupportsWallets && accounts.length && txDue(tx) - txPaid(tx) > 0.004) return openTxPayModal(tx, newStatus);
        return applyTxStatus(tx, newStatus);
    }
    const paid = txPaid(tx);
    if (paid > 0.004) {
        renderLedgerTable(); // يرجع الاختيار كما كان حتى التأكيد
        return showAppConfirm('إرجاع المبلغ للحسابات', `دُفع من هذه الحوالة ${moneyCur(paid, tx.currency)}. تغيير الحالة إلى "${newStatus}" يُرجع المبلغ للحسابات. متابعة؟`, () => {
            applyTxStatus(tx, newStatus, refundTxOps(tx));
        });
    }
    applyTxStatus(tx, newStatus);
}

function deleteTxPrompt(id) {
    const tx = ledger.find(x => x.id === id);
    if (tx && (dayLocked(tx.date) || refMoves('tx', tx.id).some(m => dayLocked(m.date)))) return lockWarn();
    const paid = tx ? txPaid(tx) : 0;
    const extra = paid > 0.004 ? ` والمبلغ المدفوع منها (${moneyCur(paid, tx.currency)}) سيرجع للحسابات.` : '';
    showAppConfirm('تأكيد حذف الحوالة', `هل أنت متأكد من حذف هذه المعاملة؟ سيتم حذفها نهائياً من السجل ومن جدول Google Sheets.${extra}`, async () => {
        const refund = tx ? refundTxOps(tx) : [];
        ledger = ledger.filter(x => x.id !== id);
        queueOps(...refund, { action: 'delete', id });
        renderLedgerTable();
        renderCustomersTable();
        renderAccountsPage();
        const syncStatus = await flushOutbox();
        showToast('تم الحذف', `المعاملة ${tx ? receiptNo(tx) : '#' + id} — ${syncResultMessage(syncStatus)}`, syncToastType(syncStatus));
    });
}

// ================= تعديل الحوالة =================
let editType = 'div';

function openEditTxModal(id) {
    const tx = ledger.find(x => x.id === id);
    if (!tx) return;

    $('editModalTitle').textContent = `تعديل بيانات الحوالة ${receiptNo(tx)}`;
    setHistoryButton('edit_tx_history', tx.id);
    $('edit_tx_id').value = tx.id;
    $('edit_tx_date').value = tx.date;
    $('edit_tx_recipient').value = tx.recipient;
    $('edit_tx_payout').value = tx.payout;
    fillProviderSelect($('edit_tx_provider'), tx.payout, tx.provider);
    $('edit_tx_currency').value = tx.currency;
    $('edit_tx_account').value = tx.account;
    $('edit_tx_status').value = tx.status;
    $('edit_tx_audit').textContent = [tx.createdBy && `أضافها: ${personName(tx.createdBy)}`, tx.updatedBy && tx.updatedBy !== tx.createdBy && `آخر تعديل: ${personName(tx.updatedBy)}`].filter(Boolean).join(' · ');
    $('edit_tx_orig').value = tx.orig;
    $('edit_tx_factor').value = tx.factor;
    $('edit_tx_cost_mode').value = tx.costMode;
    $('edit_tx_cost_pct').value = tx.costMode === 'fixed' ? tx.costFixed : tx.costPct;
    $('edit_tx_profit_pct').value = tx.profitPct;
    $('edit_tx_minus').value = tx.minusIls;
    $('edit_tx_screen').value = tx.screenRate;

    // نعرض دولة الحوالة حتى لو حُذفت من جدول التسعير، مع نوع معادلتها الأصلي
    const list = [...countries];
    let idx = list.findIndex(c => c.name === tx.country && c.type === tx.type);
    if (idx === -1) {
        list.unshift({ name: tx.country, type: tx.type, factor: tx.factor });
        idx = 0;
    }
    const select = $('edit_tx_country');
    select.innerHTML = countryOptionsHtml(list);
    select.selectedIndex = idx;
    editType = tx.type;
    $('edit_op_symbol').textContent = TYPE_SYMBOL[editType];

    recalcEditModal();
    openModal('editTxModal');
}

function onEditCountrySelect() {
    const c = selectedCountry($('edit_tx_country'));
    if (!c) return;
    editType = c.type;
    $('edit_tx_factor').value = c.factor;
    $('edit_op_symbol').textContent = TYPE_SYMBOL[editType];
    // تكلفة وربح الدولة الجديدة
    const src = countries.find(x => x.name === c.name);
    if (src) {
        $('edit_tx_cost_mode').value = src.costMode;
        $('edit_tx_cost_pct').value = src.costValue;
        $('edit_tx_profit_pct').value = src.profitPct;
    }
    recalcEditModal();
}

function readEditInputs() {
    return {
        orig: toNum($('edit_tx_orig').value, 0),
        type: editType,
        factor: toNum($('edit_tx_factor').value, 0),
        costMode: $('edit_tx_cost_mode').value === 'fixed' ? 'fixed' : 'pct',
        costPct: $('edit_tx_cost_mode').value === 'fixed' ? 0 : toNum($('edit_tx_cost_pct').value, 0),
        costFixed: $('edit_tx_cost_mode').value === 'fixed' ? toNum($('edit_tx_cost_pct').value, 0) : 0,
        profitPct: toNum($('edit_tx_profit_pct').value, 0),
        minusIls: toNum($('edit_tx_minus').value, 0),
        screenRate: toNum($('edit_tx_screen').value, globalConfig.screenRate),
        currency: $('edit_tx_currency').value === 'USD' ? 'USD' : 'ILS'
    };
}

function recalcEditModal() {
    const input = readEditInputs();
    const r = computeTransfer(input);
    $('edit_preview_client_ils').textContent = input.currency === 'USD' ? `$ ${fmt(r.clientUsd)}` : fmt(r.clientIls) + ' ₪';
    $('edit_preview_profit_ils').textContent = '+' + fmt(r.profitIls) + ' ₪';
}

async function saveEditedTransaction(e) {
    e.preventDefault();
    const id = toNum($('edit_tx_id').value, NaN);
    const tx = ledger.find(x => x.id === id);
    if (!tx) return;

    const input = readEditInputs();
    if (input.orig <= 0) return showToast('تنبيه', 'المبلغ الأصلي يجب أن يكون أكبر من صفر', 'warning');
    if (input.screenRate <= 0) return showToast('تنبيه', 'سعر الشاشة غير صحيح', 'warning');

    const r = computeTransfer(input);
    const oldStatus = tx.status;
    const oldRecipient = tx.recipient;
    const before = { ...tx };
    const next = {
        date: $('edit_tx_date').value,
        recipient: $('edit_tx_recipient').value.trim(),
        payout: $('edit_tx_payout').value,
        provider: $('edit_tx_payout').value === 'كاش' ? '' : $('edit_tx_provider').value,
        account: $('edit_tx_account').value.trim(),
        status: $('edit_tx_status').value,
        country: selectedCountry($('edit_tx_country'))?.name || tx.country,
        ...input,
        clientIls: round2(r.clientIls),
        clientUsd: round2(r.clientUsd),
        costIls: round2(r.costIls),
        profitIls: round2(r.profitIls)
    };
    const willRefund = !PAID_STATUSES.includes(next.status) && txPaid(tx) > 0.004;
    if (editLocked('ledger', before, { ...tx, ...next }) || (willRefund && refMoves('tx', tx.id).some(m => dayLocked(m.date)))) return lockWarn();
    Object.assign(tx, next);

    // الرجوع عن مكتمل/جزئي يُرجع المدفوع للحسابات، والتحويل إليهما يسأل "دفعت من وين؟"
    const refund = !PAID_STATUSES.includes(tx.status) && txPaid(tx) > 0.004 ? refundTxOps(tx) : [];
    // ملاحظة دفعاتها = اسم المستلم
    const noteOps = tx.recipient !== oldRecipient ? relinkNotesOps('tx', tx.id, tx.recipient, note => note === oldRecipient) : [];
    queueOps(...refund, { action: 'upsert', ...tx }, ...noteOps);
    closeModal('editTxModal');
    renderLedgerTable();
    renderAccountsPage();
    const syncStatus = await flushOutbox();
    showToast('تم تحديث المعاملة', `المعاملة ${receiptNo(tx)}${refund.length ? ' · أُرجع المدفوع للحسابات' : ''} — ${syncResultMessage(syncStatus)}`, syncToastType(syncStatus));
    if (PAID_STATUSES.includes(tx.status) && !PAID_STATUSES.includes(oldStatus) && sheetSupportsWallets && accounts.length && txDue(tx) - txPaid(tx) > 0.004) {
        openTxPayModal(tx, tx.status, { afterCreate: true });
    }
}

// ================= تصدير Excel (CSV) =================
function csvCell(value) {
    let s = String(value ?? '');
    // منع تنفيذ الصيغ عند فتح الملف في Excel
    if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
}

function exportToCSV() {
    const header = ['المعرف', 'التاريخ', 'المرسل إليه', 'رقم الحساب / المحفظة', 'طريقة التسليم', 'الجهة', 'الدولة', 'نوع المعادلة', 'المبلغ الأصلي', 'معامل التحويل', 'نسبة التكلفة %', 'تكلفة ثابتة $', 'نسبة الربح %', 'الخصم الإضافي', 'سعر الشاشة المعتمد', 'عملة التسليم', 'المسلّم بالشيكل', 'المسلّم بالدولار', 'التكلفة بالشيكل', 'صافي الربح بالشيكل', 'الحالة'];
    const rows = ledger.map(t => [
        t.id, t.date, t.recipient, t.account, t.payout, t.provider, t.country, TYPE_LABEL[t.type],
        t.orig, t.factor, t.costPct, t.costFixed, t.profitPct, t.minusIls, t.screenRate,
        t.currency === 'USD' ? 'دولار' : 'شيكل', t.clientIls.toFixed(2), t.clientUsd.toFixed(2),
        t.costIls.toFixed(2), t.profitIls.toFixed(2), t.status
    ]);
    const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
    downloadBlob('\uFEFF' + csv, 'text/csv;charset=utf-8;', `سجل_حوالات_فاست_باي_${localDateStr()}.csv`);
    showToast('تم التصدير', 'تم تنزيل ملف Excel بنجاح', 'info');
}
