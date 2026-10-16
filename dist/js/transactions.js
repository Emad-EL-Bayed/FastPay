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
    // البنك: رقم الجوال أو الـ IBAN (واحد منهم على الأقل)
    const iban = payout === 'بنكي' ? readIbanField($('calc_iban')) : '';
    if (iban === null) return null;
    if (payout !== 'كاش' && !account && !iban) {
        $('calc_account').focus();
        return warn(payout === 'بنكي' ? 'اكتب رقم الجوال المربوط بالحساب أو الـ IBAN' : 'اكتب رقم المحفظة');
    }
    // الزبون المختار من القائمة أو بنفس الاسم، وإلا زبون جديد
    const customer = customers.find(c => c.id === $('calc_customer_id').value)
        || customers.find(c => normName(c.name) === normName(recipient));
    const phone = readCustomerPhone('calc', customer?.id);
    if (phone === null) return null;
    const date = $('calc_date').value || localDateStr();
    if (backdateLocked(date)) { lockWarn(); return null; }
    return {
        input, recipient, payout, provider, account, iban, customer, phone,
        date,
        status: $('calc_status').value
    };
}

// ربط الحوالة بالزبون (مع تحديث بياناته ورقم الواتساب إن كُتب)، أو إنشاء زبون جديد
function upsertTxCustomer({ customer, recipient, payout, provider, account, iban, phone, date }) {
    if (customer) {
        Object.assign(customer, { name: recipient, payout, provider, account: account || customer.account, iban: iban || customer.iban || '' }, phone ? { phone } : {});
        return customer;
    }
    const created = { id: newCustomerId(), name: recipient, phone, payout, provider, account, iban, createdAt: date };
    customers.unshift(created);
    return created;
}

// الحساب من الأرقام مباشرة (وليس من النص المعروض) ثم التقريب لقرشين
function buildNewTx({ input, recipient, payout, provider, account, iban, date, status }, customer) {
    const r = computeTransfer(input);
    return {
        id: newTxId(),
        date, customerId: customer.id, recipient, phone: '', account, iban, payout, provider,
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
            (searchPhone && (normPhone(t.account).includes(searchPhone) || (t.iban && t.iban.toLowerCase().includes(searchPhone)))) ||
            (searchId && (serialHit ? String(t.serial) === searchId : String(t.id).includes(searchId)));
        // البحث برقم الحوالة أو الإيصال كاملاً يُظهرها حتى لو كانت حالتها مخفية
        const matchStatus = !hidden.includes(t.status) || (searchId && (String(t.id) === searchId || String(t.serial) === searchId));
        const matchMonth = !monthFilter || t.date.startsWith(monthFilter);
        const matchDate = !dateFilter || t.date === dateFilter;
        return matchSearch && matchStatus && matchMonth && matchDate;
    });

    if (filtered.length === 0) {
        $('ledger-body').innerHTML = `<tr><td colspan="7" class="p-6 text-center text-xs text-slate-400">${emptyMessage(ledger.length, 'لا توجد نتائج مطابقة للفلترة', 'لا توجد حوالات في الشيت بعد')}</td></tr>`;
        refreshTxDetails();
        return;
    }

    const shown = filtered.slice(0, ledgerLimit);
    const rest = filtered.length - shown.length;
    $('ledger-body').innerHTML = shown.map(t => {
        const syncState = txSyncState(t.id);
        const syncDot = syncState ? `<span class="sync-dot ${syncState}" title="${SYNC_TITLES[syncState]}"></span>` : '';
        // باقي التفاصيل (الرقم، المبلغ الأصلي، الربح، سعر الشاشة، التعديل والحذف) بنافذة "تفاصيل"
        return `
            <tr class="hover:bg-slate-50">
                <td class="p-3.5 text-center whitespace-nowrap"><button data-action="tx-details" data-id="${t.id}" class="txd-link" title="التفاصيل${auditTitle(t) ? ' · ' + auditTitle(t) : ''}${t.serial ? ` · رقم الحركة ${t.id}` : ''}">${syncDot} ${receiptNo(t)}</button></td>
                <td class="p-3.5 whitespace-nowrap text-slate-500 text-xs num">${escapeHtml(t.date)}${lockMark(t.date)}</td>
                <td class="p-3.5">
                    <span class="flex items-center gap-2">
                        <button data-action="open-customer" data-id="${escapeHtml(t.customerId)}" data-name="${escapeHtml(t.recipient)}" class="font-bold text-slate-900 hover:text-blue-700 hover:underline text-right whitespace-nowrap" title="ملف الزبون">${escapeHtml(t.recipient)}</button>
                        <span class="badge ${payoutBadgeClass(t.payout)} whitespace-nowrap" title="${escapeHtml(payoutLabel(t))}">${escapeHtml(t.provider || payoutLabel(t))}</span>
                        ${txCopyButton(t)}
                    </span>
                </td>
                <td class="p-3.5 whitespace-nowrap"><span class="badge bg-slate-100 text-slate-700">${escapeHtml(t.country)}</span></td>
                <td class="p-3.5 font-mono text-left font-black text-slate-900 num whitespace-nowrap"><button data-action="open-receipt" data-id="${t.id}" class="amount-link" title="الفاتورة">${deliveredHtml(t)}</button></td>
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
                    <button data-action="tx-details" data-id="${t.id}" class="text-blue-700 hover:text-blue-900 font-bold text-xs px-2.5 py-1 bg-blue-50 rounded-lg mr-1">تفاصيل</button>
                </td>
            </tr>
        `;
    }).join('') + (rest > 0 ? `
        <tr><td colspan="7" class="p-3 text-center">
            <button data-action="ledger-more" class="text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg transition">عرض ${Math.min(rest, LEDGER_PAGE)} حوالة أخرى</button>
            <span class="text-[11px] text-slate-400 mr-2">معروض ${shown.length} من ${filtered.length}</span>
        </td></tr>` : '');
    refreshTxDetails();
}

// ================= نسخ رقم التحويل =================
// رقم الجوال/المحفظة لحاله بينسخ فوراً. إذا في IBAN بتطلع قائمة: الرقم، IBAN، أو "نسخ الكل" (كل واحد بسطر)
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';

function txCopyButton(t) {
    if (!t.account && !t.iban) return '';
    const title = t.iban ? 'نسخ الرقم أو الـ IBAN' : 'نسخ ' + accountLabel(t);
    return `<button type="button" data-action="tx-copy" data-id="${t.id}" class="copy-btn" title="${title}" aria-label="${title}">${COPY_ICON}</button>`;
}

// شو بينسخ: {label, shown, value}
function txCopyItems(t) {
    const items = [];
    if (t.account) items.push({ label: accountLabel(t), shown: t.account, value: t.account });
    if (t.iban) items.push({ label: 'IBAN', shown: formatIban(t.iban), value: t.iban });
    // الاسم، الرقم، IBAN، والمبلغ: كل واحد بسطر
    if (items.length > 1) {
        const all = [t.recipient, t.account, t.iban, msgMoney(txDue(t), t.currency)].filter(Boolean).join('\n');
        items.push({ label: 'نسخ الكل', shown: 'الاسم والرقم و IBAN والمبلغ، كل واحد بسطر', value: all, all: true });
    }
    return items;
}

function onTxCopy(btn) {
    const t = ledger.find(x => x.id === toNum(btn.dataset.id, NaN));
    if (!t) return;
    const items = txCopyItems(t);
    if (items.length === 1) return copyWithFlash(btn, items[0]);
    openCopyMenu(btn, items);
}

async function copyWithFlash(btn, item) {
    const ok = await copyText(item.value);
    if (!ok) return showToast('ما زبط النسخ', 'المتصفح منع النسخ، انسخه بإيدك', 'warning');
    // السجل ممكن ينرسم من جديد بالنص (تحديث حيّ): الزر الموجود هلّق بنفس الرقم
    const live = btn?.isConnected ? btn : btn && document.querySelector(`[data-action="${btn.dataset.action}"][data-id="${btn.dataset.id}"]${btn.dataset.field ? `[data-field="${btn.dataset.field}"]` : ''}`);
    if (live) {
        live.classList.add('copied');
        setTimeout(() => live.classList.remove('copied'), 1200);
    }
    showToast('تم النسخ', item.all ? 'الاسم والرقم و IBAN والمبلغ، كل واحد بسطر' : `${item.label}: ${item.shown}`, 'success');
}

// القائمة الصغيرة جنب الزر (وحدة بس مفتوحة)
let copyMenuItems = [];
let copyMenuAnchor = null;

function openCopyMenu(anchor, items) {
    const menu = $('copy-menu');
    if (copyMenuAnchor === anchor && !menu.classList.contains('hidden')) return closeCopyMenu();
    copyMenuItems = items;
    copyMenuAnchor = anchor;
    menu.innerHTML = items.map((it, i) => `
        <button type="button" data-action="copy-pick" data-i="${i}" class="copy-menu-item${it.all ? ' all' : ''}" role="menuitem">
            <span class="font-bold">${escapeHtml(it.label)}</span>
            <bdi class="${it.all ? '' : 'ltr-num font-mono'}">${escapeHtml(it.shown)}</bdi>
        </button>`).join('');
    menu.classList.remove('hidden');
    // تحت الزر، وما بتطلع برّا الشاشة
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    menu.style.left = left + 'px';
    menu.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
}

function closeCopyMenu() {
    $('copy-menu').classList.add('hidden');
    copyMenuAnchor = null;
}

function pickCopyItem(i) {
    const item = copyMenuItems[i];
    const anchor = copyMenuAnchor;
    closeCopyMenu();
    if (item) copyWithFlash(anchor, item);
}

// ================= نافذة تفاصيل الحوالة =================
// كل اللي انشال من السطر، مع نسخ رقم التحويل والـ IBAN، الدفعات، مين أضاف وعدّل، وأزرار الفاتورة والتعديل والحذف
let txDetailsId = null;

function openTxDetails(id) {
    if (!ledger.some(x => x.id === id)) return;
    txDetailsId = id;
    renderTxDetails();
    openModal('txDetailsModal');
}

// السجل انرسم من جديد (تحديث، دفعة، تغيير حالة): النافذة المفتوحة بتتحدث كمان
function refreshTxDetails() {
    if (txDetailsId === null || $('txDetailsModal').classList.contains('hidden')) return;
    if (!ledger.some(x => x.id === txDetailsId)) return closeModal('txDetailsModal');
    renderTxDetails();
}

// stack: الاسم فوق والقيمة تحت (للـ IBAN الطويل)
function txDetailsRow(label, value, extra = '', stack = false) {
    return `<div class="txd-row${stack ? ' txd-stack' : ''}"><span class="txd-label">${label}</span><span class="txd-value"><span class="min-w-0">${value}</span>${extra}</span></div>`;
}

function renderTxDetails() {
    const t = ledger.find(x => x.id === txDetailsId);
    if (!t) return;
    const cancelled = t.status === CANCELLED;
    const copyBtn = (field, label) => `<button type="button" data-action="txd-copy" data-id="${t.id}" data-field="${field}" class="copy-btn" title="نسخ ${label}" aria-label="نسخ ${label}">${COPY_ICON}</button>`;
    const receive = [txDetailsRow('طريقة الاستلام', escapeHtml(payoutLabel(t)))];
    if (t.account) receive.push(txDetailsRow(accountLabel(t), `<bdi class="ltr-num font-mono">${escapeHtml(t.account)}</bdi>`, copyBtn('account', accountLabel(t))));
    if (t.iban) receive.push(txDetailsRow('IBAN', `<bdi class="ltr-num font-mono txd-iban">${escapeHtml(formatIban(t.iban))}</bdi>`, copyBtn('iban', 'IBAN'), true));
    // ÷ 4.03 أو × 1.365، والنسبة المباشرة: خصم 6%
    const factorText = fmt(t.factor, 4).replace(/\.?0+$/, '');
    const formula = t.type === 'direct_percent' ? `خصم <bdi class="num">${factorText}%</bdi>` : `<bdi dir="ltr" class="num">${TYPE_SYMBOL[t.type] || ''} ${factorText}</bdi>`;
    const calc = [
        txDetailsRow('الدولة / المصدر', escapeHtml(t.country)),
        txDetailsRow('المبلغ الأصلي', `<span class="num">${fmt(t.orig)}</span>`),
        txDetailsRow('المعادلة', formula),
        txDetailsRow('التكلفة', `<bdi class="num">${escapeHtml(costLabel(t.costMode, t.costMode === 'fixed' ? t.costFixed : t.costPct))}</bdi>`),
        txDetailsRow('نسبة الربح', `<bdi class="num">${t.profitPct}%</bdi>`),
        txDetailsRow('سعر الشاشة', `<span class="num">${fmt(t.screenRate, 3)} ₪</span>`),
        ...(t.finalAdjust ? [txDetailsRow('تعديل على المسلّم', `<bdi class="num">${signedAmount(t.finalAdjust, t.currency)}</bdi>`)] : []),
        `<div class="profit-only">${txDetailsRow('ربحي', `<span class="num font-black ${cancelled ? 'text-slate-400 line-through' : 'text-emerald-600'}">+${fmt(t.profitIls)} ₪</span>`)}</div>`
    ];
    const moves = refMoves('tx', t.id);
    const paid = txPaid(t);
    const payments = moves.map(m => txDetailsRow(escapeHtml(m.accountName || accountName(accounts.find(a => a.id === m.accountId)) || 'حساب'),
        `<span class="num">${moneyCur(Math.abs(m.amount), m.currency)}</span> <span class="text-[10px] text-slate-400">${escapeHtml(m.date)}</span>`));
    const audit = [t.createdBy && `أضافها: ${escapeHtml(personName(t.createdBy))}`, t.updatedBy && t.updatedBy !== t.createdBy && `آخر تعديل: ${escapeHtml(personName(t.updatedBy))}`].filter(Boolean).join(' · ');
    const showHistory = hasPerm('settings') && sheetHas('editLog');
    const c = customerOfTx(t);
    $('tx-details-body').innerHTML = `
        <div class="txd-head">
            <div class="flex justify-between items-start gap-3">
                <div class="min-w-0">
                    <button data-action="txd-customer" class="txd-name" title="ملف الزبون">${escapeHtml(t.recipient)}</button>
                    <div class="text-[11px] text-slate-400 mt-0.5"><bdi class="font-mono">${receiptNo(t)}</bdi> · <bdi class="ltr-num">${escapeHtml(t.date)}</bdi>${lockMark(t.date)}</div>
                </div>
                <button data-action="close-modal" data-modal="txDetailsModal" class="text-slate-400 hover:text-slate-700 shrink-0" aria-label="إغلاق">✕</button>
            </div>
            <div class="flex items-end justify-between gap-3 mt-3">
                <div>
                    <div class="text-[11px] text-slate-500">المسلّم للزبون</div>
                    <div class="txd-amount num ${cancelled ? 'line-through text-slate-400' : ''}">${deliveredHtml(t)}</div>
                </div>
                <span class="badge border ${statusSelectClass(t.status)}">${escapeHtml(t.status)}</span>
            </div>
            ${t.status === 'جزئي' ? `<div class="text-[11px] text-sky-700 mt-2">مدفوع ${fmt(paid)} من ${fmt(txDue(t))} ${CUR_SYM[t.currency]} <button data-action="tx-pay" data-id="${t.id}" class="font-bold underline mr-1">+ دفعة</button></div>` : ''}
        </div>
        <div class="txd-body">
            <section>
                <h4 class="txd-title">الاستلام</h4>
                ${receive.join('')}
                ${t.account && t.iban ? `<button type="button" data-action="txd-copy" data-id="${t.id}" data-field="all" class="txd-copy-all">${COPY_ICON} نسخ الكل (الاسم والرقم و IBAN والمبلغ)</button>` : ''}
            </section>
            <section>
                <h4 class="txd-title">الحساب</h4>
                ${calc.join('')}
            </section>
            ${moves.length ? `<section><h4 class="txd-title">الدفعات</h4>${payments.join('')}</section>` : ''}
            ${audit || showHistory ? `<div class="txd-audit"><span>${audit}</span>${showHistory ? `<button data-action="open-edits" data-id="${t.id}" class="font-bold text-slate-600 hover:text-slate-900">📝 سجل التعديلات</button>` : ''}</div>` : ''}
        </div>
        <div class="txd-actions">
            <button data-action="open-receipt" data-id="${t.id}" class="bg-slate-900 hover:bg-slate-800 text-white">فاتورة</button>
            <button data-action="txd-edit" data-id="${t.id}" class="bg-blue-50 hover:bg-blue-100 text-blue-700">تعديل</button>
            ${c ? whatsappButton(c, { compact: true }) : ''}
            <button data-action="delete-tx" data-id="${t.id}" class="txd-delete bg-rose-50 hover:bg-rose-100 text-rose-700">حذف</button>
        </div>`;
}

function copyTxField(btn) {
    const t = ledger.find(x => x.id === toNum(btn.dataset.id, NaN));
    if (!t) return;
    const items = txCopyItems(t);
    const item = btn.dataset.field === 'all'
        ? (items.find(i => i.all) || { label: 'نسخ الكل', value: [t.recipient, t.account, t.iban, msgMoney(txDue(t), t.currency)].filter(Boolean).join('\n'), all: true })
        : btn.dataset.field === 'iban' ? items.find(i => i.label === 'IBAN') : items[0];
    if (item) copyWithFlash(btn, item);
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
    setIbanField($('edit_tx_iban'), $('edit_tx_iban_hint'), tx.iban);
    syncEditTxPayoutFields();
    $('edit_tx_status').value = tx.status;
    $('edit_tx_audit').textContent = [tx.createdBy && `أضافها: ${personName(tx.createdBy)}`, tx.updatedBy && tx.updatedBy !== tx.createdBy && `آخر تعديل: ${personName(tx.updatedBy)}`].filter(Boolean).join(' · ');
    $('edit_tx_orig').value = tx.orig;
    $('edit_tx_factor').value = tx.factor;
    $('edit_tx_cost_mode').value = tx.costMode;
    $('edit_tx_cost_pct').value = tx.costMode === 'fixed' ? tx.costFixed : tx.costPct;
    $('edit_tx_profit_pct').value = tx.profitPct;
    $('edit_tx_minus').value = tx.minusIls;
    $('edit_tx_screen').value = tx.screenRate;
    $('edit_tx_final_adjust').value = tx.finalAdjust ? String(tx.finalAdjust) : '';
    $('edit_tx_final_adjust_wrap').querySelectorAll('input, button').forEach(el => { el.disabled = !sheetHas('txAdjust'); });
    $('edit_tx_final_adjust_wrap').classList.toggle('opacity-50', !sheetHas('txAdjust'));

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

// البنك: "رقم الجوال (للتحويل)" و IBAN، المحفظة: رقم المحفظة، والكاش بدون رقم
function syncEditTxPayoutFields() {
    const payout = $('edit_tx_payout').value;
    $('edit_tx_account_label').textContent = payout === 'بنكي' ? 'رقم الجوال (للتحويل)' : payout === 'كاش' ? 'الرقم (للكاش مش لازم)' : 'رقم المحفظة';
    $('edit_tx_iban_wrap').classList.toggle('hidden', payout !== 'بنكي');
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
        currency: $('edit_tx_currency').value === 'USD' ? 'USD' : 'ILS',
        // السكربت القديم ما فيه عمود إله، فبيضيع: الخانة مسكّرة
        finalAdjust: sheetHas('txAdjust') ? round2(toNum($('edit_tx_final_adjust').value, 0)) : 0
    };
}

function recalcEditModal() {
    const input = readEditInputs();
    const r = computeTransfer(input);
    $('edit_preview_client_ils').textContent = input.currency === 'USD' ? `$ ${fmt(r.clientUsd)}` : fmt(r.clientIls) + ' ₪';
    $('edit_preview_profit_ils').textContent = '+' + fmt(r.profitIls) + ' ₪';
    syncTxAdjustHint(input, r);
}

// ================= تعديل ± على المسلّم (زي USDT) =================
// المسلّم فيه قروش (1,387.46)، فالأزرار بتوصل لأقرب نص بنفس الاتجاه: +½ ← 1,387.50، −½ ← 1,387.00، وبعدها خطوات عادية
const txAdjustBase = (input) => {
    const r = computeTransfer({ ...input, finalAdjust: 0 });
    return input.currency === 'USD' ? r.clientUsd : r.clientIls;
};

function bumpTxFinalAdjust(step) {
    const el = $('edit_tx_final_adjust');
    if (el.disabled || !step) return;
    const input = readEditInputs();
    const base = txAdjustBase(input);
    const target = round2(base + input.finalAdjust + step);
    const snapped = step > 0 ? Math.floor(target * 2 + 1e-9) / 2 : Math.ceil(target * 2 - 1e-9) / 2;
    const adj = round2(Math.max(snapped, 0) - base);
    el.value = adj ? String(adj) : '';
    recalcEditModal();
}

function syncTxAdjustHint(input, r) {
    const hint = $('edit_tx_final_adjust_hint');
    if (!sheetHas('txAdjust')) {
        hint.textContent = 'حدّث سكربت Google Sheets لتفعيل التعديل';
        return;
    }
    const cur = input.currency === 'USD' ? 'USD' : 'ILS';
    hint.innerHTML = r.finalAdjust
        ? `قبل التعديل ${escapeHtml(moneyCur(txAdjustBase(input), cur))} · التعديل <b>${signedAmount(r.finalAdjust, cur)}</b> <span class="profit-only">· الربح ${signedAmount(-r.finalAdjust * (cur === 'USD' ? input.screenRate : 1), 'ILS')}</span>`
        : 'الأزرار بتوصل لأقرب نص · موجب = بنعطيه أكثر (ربح أقل) · سالب = بنعطيه أقل (ربح أكثر)';
}

async function saveEditedTransaction(e) {
    e.preventDefault();
    const id = toNum($('edit_tx_id').value, NaN);
    const tx = ledger.find(x => x.id === id);
    if (!tx) return;

    const input = readEditInputs();
    if (input.orig <= 0) return showToast('تنبيه', 'المبلغ الأصلي يجب أن يكون أكبر من صفر', 'warning');
    if (input.screenRate <= 0) return showToast('تنبيه', 'سعر الشاشة غير صحيح', 'warning');
    // IBAN بس للبنك؛ غيره بينمسح. السكربت القديم ما فيه عمود إله، فبيضل زي ما هو
    const iban = $('edit_tx_payout').value === 'بنكي' ? readIbanField($('edit_tx_iban')) : '';
    if (iban === null) return;

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
        ...(sheetHas('iban') ? { iban } : {}),
        status: $('edit_tx_status').value,
        country: selectedCountry($('edit_tx_country'))?.name || tx.country,
        ...input,
        finalAdjust: round2(r.finalAdjust),
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
    const header = ['المعرف', 'رقم الإيصال', 'التاريخ', 'المرسل إليه', 'رقم الحساب / المحفظة', 'IBAN', 'طريقة التسليم', 'الجهة', 'الدولة', 'نوع المعادلة', 'المبلغ الأصلي', 'معامل التحويل', 'نسبة التكلفة %', 'تكلفة ثابتة $', 'نسبة الربح %', 'الخصم الإضافي', 'سعر الشاشة المعتمد', 'عملة التسليم', 'المسلّم بالشيكل', 'المسلّم بالدولار', 'تعديل على النهائي', 'التكلفة بالشيكل', 'صافي الربح بالشيكل', 'الحالة'];
    const rows = ledger.map(t => [
        t.id, t.serial || '', t.date, t.recipient, t.account, formatIban(t.iban), t.payout, t.provider, t.country, TYPE_LABEL[t.type],
        t.orig, t.factor, t.costPct, t.costFixed, t.profitPct, t.minusIls, t.screenRate,
        t.currency === 'USD' ? 'دولار' : 'شيكل', t.clientIls.toFixed(2), t.clientUsd.toFixed(2), t.finalAdjust || '',
        t.costIls.toFixed(2), t.profitIls.toFixed(2), t.status
    ]);
    const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
    downloadBlob('\uFEFF' + csv, 'text/csv;charset=utf-8;', `سجل_حوالات_فاست_باي_${localDateStr()}.csv`);
    showToast('تم التصدير', 'تم تنزيل ملف Excel بنجاح', 'info');
}
