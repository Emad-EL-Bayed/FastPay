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
let txSaving = false;

// الحوالة بتنحفظ عندنا فوراً (النموذج بيفضى والتأكيد بيطلع)، وبعدين بتنبعت للشيت بالخلفية.
// كانت تستنى رد الشيت قبل ما يفضى النموذج، وزر "حفظ" بشريط الجوال ما كان يتسكّر ولا يبيّن شي،
// فبالنت الضعيف عماد كبس مرة ثانية وانحفظت نفس الحوالة مرتين (2026-10-17)
function saveNewTransaction() {
    if (txSaving) return;
    const form = readNewTxForm();
    if (!form) return;
    const hit = blacklistHit({ name: form.recipient, numbers: [form.account, form.bankAccount, form.iban, form.phone, form.customer?.phone] });
    checkBlacklistThen(hit, () => saveCheckedTransaction(form));
}

// القائمة السوداء قبل أي حفظ (الحاسبة و USDT والجنيه): الموظف ممنوع، والمدير بيكمّل على مسؤوليته
function checkBlacklistThen(hit, go) {
    if (!hit) return go();
    if (!isManager()) return showToast('⛔ ممنوع الحفظ', `${blackNoteText(hit).replace(/^⛔\s*/, '')}. بس المدير بيقدر يكمّل`, 'error');
    showAppConfirm('⛔ بالقائمة السوداء', `${blackLabel(hit)}${hit.reason ? ' — ' + hit.reason : ''}. بدك تكمّل على مسؤوليتك؟`, go);
}

function saveCheckedTransaction(form) {
    const same = recentSameTx(form);
    if (same) {
        const mins = Math.max(1, Math.round((Date.now() - same.id) / 60000));
        showAppConfirm('هاي الحوالة انحفظت قبل شوي',
            `${same.recipient} — ${txAmountText(same)} ${receiptNo(same)} انحفظت قبل ${mins === 1 ? 'دقيقة' : mins + ' دقايق'}. بدك تحفظها كمان مرة؟`,
            () => checkFraudThenCommit(form));
        return;
    }
    checkFraudThenCommit(form);
}

const txAmountText = (tx) => (tx.currency === 'USD' ? `$${fmt(tx.clientUsd)}` : `${fmt(tx.clientIls)} ₪`);

// نفس الزبون والمصدر والمبلغ والعملة، انحفظت من هالجهاز أو غيره خلال آخر دقيقتين (الرقم = وقت الإنشاء)
function recentSameTx({ recipient, input }) {
    const now = Date.now();
    return ledger.find(t => now - t.id < 2 * 60000 && t.id <= now
        && normName(t.recipient) === normName(recipient) && t.country === input.country
        && t.currency === input.currency && Math.abs(t.orig - input.orig) < 0.005);
}

// opts: trust = المدير قال "الزبون طبيعي" (بيصير موثوق)، flag = الموظف كمّل رغم التنبيه (⚠️ وإشعار للمدير)
async function commitNewTransaction(form, opts = {}) {
    txSaving = true;
    let tx;
    try {
        const customer = upsertTxCustomer(form);
        if (opts.trust) customer.trusted = 'yes';
        tx = buildNewTx(form, customer);
        if (opts.flag) tx.flag = opts.flag;
        // فوق حد الموظف: بتنحفظ وبتستنى موافقة المدير
        const held = applyTxLimit(tx, null);
        ledger.unshift(tx);
        highlightTxId = tx.id;
        lastSavedTxId = tx.id;
        queueOps({ action: 'upsert_customer', customer }, { action: 'upsert', ...tx });
        // تفريغ النموذج للحوالة التالية (المصدر المختار يبقى كما هو)
        resetCalcForm();
        renderLedgerTable();
        renderCustomersTable();
        renderRecentTx();
        $('last-receipt-btn').classList.remove('hidden');
        flashTxSaved();
        if (held) showToast('انحفظت، وبتستنى موافقة المدير', `${form.recipient} — ${txAmountText(tx)} فوق ${fmt(txLimitIls(), 0)} ₪، فما بتصير مكتملة لحد ما المدير يوافق (وصله إشعار)`, 'warning');
        else showToast('تم حفظ الحوالة', `${form.recipient} — ${txAmountText(tx)} بسعر شاشة ${tx.screenRate}`, 'success');
    } finally {
        txSaving = false;
    }
    if (PAID_STATUSES.includes(tx.status) && sheetSupportsWallets && accounts.length) openTxPayModal(tx, tx.status, { afterCreate: true });
    // الجوال: بدون كيبورد، بنطلع لأول الحاسبة فبيبين النموذج فاضي
    else if (isTouchDevice()) window.scrollTo({ top: 0 });
    else $('calc_recipient').focus();
    // بس إذا ما وصلت للشيت منقول (الحفظ نفسه صار)
    const syncStatus = await flushOutbox();
    if (syncToastType(syncStatus) !== 'success') showToast('الحوالة محفوظة عندك', syncResultMessage(syncStatus), 'warning');
}

// نموذج الحاسبة بعد التحقق، أو null بعد تنبيه بالخانة الناقصة
function readNewTxForm() {
    const warn = (msg) => { showToast('تنبيه', msg, 'warning'); return null; };
    // مع التعديل ± (احذف القروش...) إذا انعمل لنفس الأرقام
    const input = calcInputsWithAdjust();
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
    // البنك: رقم الجوال أو رقم الحساب أو الـ IBAN (واحد منهم على الأقل)
    const bankAccount = payout === 'بنكي' ? readBankAccountField($('calc_bank_account')) : '';
    const iban = payout === 'بنكي' ? readIbanField($('calc_iban')) : '';
    if (iban === null) return null;
    if (payout !== 'كاش' && !account && !bankAccount && !iban) {
        $('calc_account').focus();
        return warn(payout === 'بنكي' ? 'اكتب رقم الجوال المربوط بالحساب أو رقم الحساب أو الـ IBAN' : 'اكتب رقم المحفظة');
    }
    // الزبون المختار من القائمة أو بنفس الاسم، وإلا زبون جديد
    const customer = customers.find(c => c.id === $('calc_customer_id').value)
        || customers.find(c => normName(c.name) === normName(recipient));
    const phone = readCustomerPhone('calc', customer?.id);
    if (phone === null) return null;
    const date = $('calc_date').value || localDateStr();
    if (backdateLocked(date)) { lockWarn(); return null; }
    return {
        input, recipient, payout, provider, account, bankAccount, iban, customer, phone,
        date,
        status: $('calc_status').value,
        loyalty: calcLoyaltyLabel()
    };
}

// ربط الحوالة بالزبون (مع تحديث بياناته ورقم الواتساب إن كُتب)، أو إنشاء زبون جديد
function upsertTxCustomer({ customer, recipient, payout, provider, account, bankAccount, iban, phone, date }) {
    if (customer) {
        Object.assign(customer, { name: recipient, payout, provider, account: account || customer.account, bankAccount: bankAccount || customer.bankAccount || '', iban: iban || customer.iban || '' }, phone ? { phone } : {});
        return customer;
    }
    const created = { id: newCustomerId(), name: recipient, phone, payout, provider, account, bankAccount, iban, createdAt: date };
    customers.unshift(created);
    return created;
}

// الحساب من الأرقام مباشرة (وليس من النص المعروض) ثم التقريب لقرشين
function buildNewTx({ input, recipient, payout, provider, account, bankAccount, iban, date, status, loyalty }, customer) {
    const r = computeTransfer(input);
    return {
        id: newTxId(),
        date, customerId: customer.id, recipient, phone: '', account, bankAccount, iban, payout, provider,
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
        finalAdjust: round2(r.finalAdjust),
        costIls: round2(r.costIls),
        profitIls: round2(r.profitIls),
        status,
        loyalty: loyalty || ''
    };
}

// زر الحفظ: "✓ تم الحفظ" لثانية، ويبقى معطلاً أثناء تحميل البيانات. والجوال بيرجف رجفة خفيفة (الأندرويد)
function flashTxSaved() {
    const btn = $('save-tx-btn');
    const label = btn.querySelector('.save-btn-label');
    btn.disabled = true;
    btn.classList.add('done');
    label.textContent = '✓ تم الحفظ';
    try { navigator.vibrate?.(40); } catch (e) { /* مش مدعوم */ }
    clearTimeout(flashTxSaved.timer);
    flashTxSaved.timer = setTimeout(() => {
        btn.classList.remove('done');
        label.textContent = 'حفظ الحوالة';
        btn.disabled = dataState === 'loading';
    }, 1300);
}

// ================= سجل الحوالات =================
function emptyMessage(total, noMatch, noData) {
    // أول مرة على الجهاز (ما في نسخة محفوظة): أسطر فاضية بتلمع بدل الكلام
    if (dataState === 'loading') return skeletonLines();
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
            (searchPhone && (normPhone(t.account).includes(searchPhone) || (t.bankAccount && normPhone(t.bankAccount).includes(searchPhone)) || (t.iban && t.iban.toLowerCase().includes(searchPhone)))) ||
            (searchId && (serialHit ? String(t.serial) === searchId : String(t.id).includes(searchId)));
        // البحث برقم الحوالة أو الإيصال كاملاً يُظهرها حتى لو كانت حالتها مخفية
        const matchStatus = !hidden.includes(t.status) || (searchId && (String(t.id) === searchId || String(t.serial) === searchId));
        const matchMonth = !monthFilter || t.date.startsWith(monthFilter);
        const matchDate = !dateFilter || t.date === dateFilter;
        return matchSearch && matchStatus && matchMonth && matchDate;
    });

    renderApprovalBanner();
    renderLateBanner();
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
        const lateMs = txLateMs(t);
        // باقي التفاصيل (الرقم، المبلغ الأصلي، الربح، سعر الشاشة، التعديل والحذف) بنافذة "تفاصيل"
        return `
            <tr class="hover:bg-slate-50${lateMs ? ' row-late' : ''}">
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
                    ${approvalChip(t)}
                    ${flagChip(t)}
                    ${lateMs ? `<div class="late-chip" title="انسجلت ${escapeHtml(new Date(t.id).toLocaleString('ar-EG', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'numeric' }))}">⏰ صرلها ${lateAgoWords(lateMs)}</div>` : ''}
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
    if (!t.account && !t.iban && !t.bankAccount) return '';
    const title = txCopyItems(t).length > 1 ? 'نسخ الرقم أو الحساب أو الـ IBAN' : 'نسخ ' + txCopyItems(t)[0].label;
    return `<button type="button" data-action="tx-copy" data-id="${t.id}" class="copy-btn" title="${title}" aria-label="${title}">${COPY_ICON}</button>`;
}

// شو بينسخ: {label, shown, value}
function txCopyItems(t) {
    const items = [];
    if (t.account) items.push({ label: accountLabel(t), shown: t.account, value: t.account, field: 'account' });
    if (t.bankAccount) items.push({ label: 'رقم الحساب', shown: t.bankAccount, value: t.bankAccount, field: 'bankAccount' });
    if (t.iban) items.push({ label: 'IBAN', shown: formatIban(t.iban), value: t.iban, field: 'iban' });
    // الاسم، الأرقام، والمبلغ: كل واحد بسطر
    if (items.length > 1) items.push({ label: 'نسخ الكل', shown: 'الاسم والأرقام والمبلغ، كل واحد بسطر', value: txCopyAllText(t), all: true });
    return items;
}

const txCopyAllText = (t) => [t.recipient, t.account, t.bankAccount, t.iban, msgMoney(txDue(t), t.currency)].filter(Boolean).join('\n');

function onTxCopy(btn) {
    const t = ledger.find(x => x.id === toNum(btn.dataset.id, NaN));
    if (!t) return;
    const items = txCopyItems(t);
    if (items.length === 1) return copyWithFlash(btn, items[0]);
    openCopyMenu(btn, items);
}

async function copyWithFlash(btn, item) {
    const ok = await copyText(item.value);
    if (!ok) { showToast('ما زبط النسخ', 'المتصفح منع النسخ، انسخه بإيدك', 'warning'); return false; }
    // السجل ممكن ينرسم من جديد بالنص (تحديث حيّ): الزر الموجود هلّق بنفس الرقم
    const live = btn?.isConnected ? btn : btn && document.querySelector(`[data-action="${btn.dataset.action}"][data-id="${btn.dataset.id}"]${btn.dataset.field ? `[data-field="${btn.dataset.field}"]` : ''}`);
    if (live) {
        live.classList.add('copied');
        setTimeout(() => live.classList.remove('copied'), 1200);
    }
    showToast('تم النسخ', item.all ? 'الاسم والأرقام والمبلغ، كل واحد بسطر' : `${item.label}: ${item.shown}`, 'success');
    return true;
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
    if (t.bankAccount) receive.push(txDetailsRow('رقم الحساب', `<bdi class="ltr-num font-mono">${escapeHtml(t.bankAccount)}</bdi>`, copyBtn('bankAccount', 'رقم الحساب')));
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
        ...(t.finalAdjust ? [txDetailsRow('تعديل على المسلّم', `<bdi class="num">${escapeHtml(adjustWord(t.finalAdjust, t.currency))}</bdi>`)] : []),
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
            ${approvalDetailsHtml(t)}
            ${flagDetailsHtml(t)}
            ${t.loyalty ? `<div class="loyal-box">🎁 أخدت مكافأة الزبون الدايم<span class="profit-only">: ${escapeHtml(/%$/.test(t.loyalty) ? 'خصم ' + t.loyalty + ' من الربح' : t.loyalty + ' زيادة للزبون')}</span></div>` : ''}
            ${t.status === 'جزئي' ? `<div class="text-[11px] text-sky-700 mt-2">مدفوع ${fmt(paid)} من ${fmt(txDue(t))} ${CUR_SYM[t.currency]} <button data-action="tx-pay" data-id="${t.id}" class="font-bold underline mr-1">+ دفعة</button></div>` : ''}
        </div>
        <div class="txd-body">
            <section>
                <h4 class="txd-title">الاستلام</h4>
                ${receive.join('')}
                ${txCopyItems(t).some(i => i.all) ? `<button type="button" data-action="txd-copy" data-id="${t.id}" data-field="all" class="txd-copy-all">${COPY_ICON} نسخ الكل (الاسم والأرقام والمبلغ)</button>` : ''}
            </section>
            ${trackUrl(t) && !cancelled ? `<section>
                <h4 class="txd-title">رابط التتبّع للزبون</h4>
                <div class="txd-track">
                    <bdi class="ltr-num">${escapeHtml(trackUrl(t).replace(/^https?:\/\//, ''))}</bdi>
                    <button type="button" data-action="txd-track-copy" data-id="${t.id}" class="copy-btn" title="نسخ الرابط" aria-label="نسخ رابط التتبّع">${COPY_ICON}</button>
                    <a href="${escapeHtml(trackUrl(t))}" target="_blank" rel="noopener" class="txd-track-open">فتح</a>
                </div>
                <p class="text-[10px] text-slate-400 mt-1">بينبعت لحاله مع رسالة الواتساب. الزبون بيشوف الحالة والمبلغ بس، وبيضل شغّال 30 يوم</p>
            </section>` : ''}
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
        ? (items.find(i => i.all) || { label: 'نسخ الكل', value: txCopyAllText(t), all: true })
        : items.find(i => i.field === btn.dataset.field) || items[0];
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
    // بتستنى موافقة المدير: ما بتصير جزئي/مكتملة لحد ما يوافق
    if (PAID_STATUSES.includes(newStatus) && txHeld(tx)) {
        renderLedgerTable();
        return approvalWarn(tx);
    }
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

// ================= حد الحوالة للموظف وموافقة المدير (بطلب عماد 2026-10-19) =================
// حوالة الموظف فوق الحد (الإعدادات ← الرقابة والأمان: سويتش + المبلغ، افتراضي 5000 ₪) بتنحفظ "بانتظار الموافقة"، وما بتصير
// جزئي/مكتملة لحد ما المدير (صلاحية إدارة المستخدمين) يوافق، وبيوصله إشعار. السكربت هو اللي بيقرر (txApprovalGate)،
// وهون بنعرض ونمنع قبل. بس الجديدة أو اللي مبلغها زاد: الحوالات القديمة الكبيرة ما بتتأثر
const isManager = () => hasPerm('users');
const txLimitIls = () => (globalConfig.txLimitOn === 'no' ? 0 : Math.max(0, toNum(globalConfig.txLimit, 5000)) || 5000);
const txValueIls = (t) => (t.currency === 'USD' ? toNum(t.clientUsd, 0) * toNum(t.screenRate, 0) : toNum(t.clientIls, 0));
const txLimitActive = () => sheetHas('txApproval') && txLimitIls() > 0 && !isManager();
// محجوزة: بتستنى الموافقة والحد شغّال (إذا انسكّر السويتش ما بتوقف إشي)
const txHeld = (t) => t?.approval === 'pending' && txLimitIls() > 0 && !isManager();

// قبل الحفظ (نفس قاعدة السكربت): next = الحوالة الجديدة أو التعديل، old = قبل التعديل. بترجع true إذا صارت بتستنى
function applyTxLimit(next, old) {
    if (!txLimitActive()) return false;
    const value = txValueIls({ ...(old || {}), ...next });
    const increased = !old || value > txValueIls(old) + 0.004;
    if (!(value > txLimitIls() + 0.004 && increased)) return false;
    next.approval = 'pending';
    next.approvedBy = '';
    if (PAID_STATUSES.includes(next.status) && !(old && PAID_STATUSES.includes(old.status))) next.status = old ? old.status : STATUSES[0];
    return true;
}

function approvalWarn(t) {
    showToast('بتستنى موافقة المدير', `${t.recipient} — ${txAmountText(t)} فوق ${fmt(txLimitIls(), 0)} ₪. أول ما يوافق بتقدر تكمّلها`, 'warning');
}

function approvalChip(t) {
    if (t.approval !== 'pending' || t.status === CANCELLED) return '';
    return isManager()
        ? `<button data-action="tx-approve" data-id="${t.id}" class="approval-chip manager" title="${escapeHtml(personName(t.createdBy || ''))} سجّلها، فوق حد الموظف">✓ وافق</button>`
        : '<span class="approval-chip" title="فوق حد الموظف، المدير لازم يوافق">⏳ بانتظار الموافقة</span>';
}

function approvalDetailsHtml(t) {
    if (t.approval === 'pending' && t.status !== CANCELLED) {
        return `<div class="approval-box"><span>⏳ بتستنى موافقة المدير (فوق ${fmt(txLimitIls(), 0)} ₪)${t.createdBy ? ' · سجّلها ' + escapeHtml(personName(t.createdBy)) : ''}</span>${isManager() ? `<button data-action="tx-approve" data-id="${t.id}" class="approval-chip manager">✓ وافق</button>` : ''}</div>`;
    }
    if (t.approval === 'approved' && t.approvedBy) return `<div class="text-[11px] text-emerald-700 mt-2">✓ وافق عليها ${escapeHtml(personName(t.approvedBy))}</div>`;
    return '';
}

// شريط للمدير فوق السجل: الحوالات اللي بتستنى موافقته
function renderApprovalBanner() {
    const box = $('approval-banner');
    const list = isManager() ? ledger.filter(t => t.approval === 'pending' && t.status !== CANCELLED) : [];
    box.classList.toggle('hidden', !list.length);
    if (!list.length) return;
    box.innerHTML = `<div class="approval-banner-head">⏳ ${list.length === 1 ? 'حوالة بتستنى موافقتك' : list.length + ' حوالات بتستنى موافقتك'}</div>`
        + list.slice(0, 8).map(t => `<div class="approval-row">
            <button data-action="tx-details" data-id="${t.id}" class="min-w-0 text-right"><b>${escapeHtml(t.recipient)}</b> <span class="num">${deliveredHtml(t)}</span> <span class="text-[11px] text-slate-500">${t.createdBy ? escapeHtml(personName(t.createdBy)) + ' · ' : ''}${escapeHtml(t.date)}</span></button>
            <button data-action="tx-approve" data-id="${t.id}" class="approval-chip manager">✓ وافق</button>
        </div>`).join('');
}

// ================= الحوالة المتأخرة (بطلب عماد 2026-10-23) =================
// مش مكتملة ولا ملغية، وصرلها أكتر من lateHours ساعة من وقت إنشائها (= رقمها). السطر برتقالي وعليه "⏰ صرلها…"،
// وشريط فوق السجل. الإشعار عالجوال من السكربت (lateTxJob كل ربع ساعة)
function lateHoursValue() {
    const raw = String(globalConfig.lateHours ?? '').trim();
    if (raw === '') return 3;
    const h = toNum(raw, 0);
    return h > 0 ? h : 0;
}

function txLateMs(t, now = Date.now()) {
    const hours = lateHoursValue();
    if (!hours || t.status === 'مكتمل' || t.status === CANCELLED || !(t.id > 1e12)) return 0;
    const ms = now - t.id;
    return ms >= hours * 3600000 ? ms : 0;
}

// 3 ساعات، 11 ساعة، يومين، 5 أيام
function lateAgoWords(ms) {
    const h = Math.floor(ms / 3600000);
    if (h < 24) return h <= 1 ? 'ساعة' : h === 2 ? 'ساعتين' : h <= 10 ? `${h} ساعات` : `${h} ساعة`;
    const d = Math.floor(h / 24);
    return d === 1 ? 'يوم' : d === 2 ? 'يومين' : d <= 10 ? `${d} أيام` : `${d} يوم`;
}

function renderLateBanner() {
    const box = $('late-banner');
    const now = Date.now();
    const list = ledger.map(t => ({ t, ms: txLateMs(t, now) })).filter(x => x.ms).sort((a, b) => b.ms - a.ms);
    box.classList.toggle('hidden', !list.length);
    if (!list.length) { box.innerHTML = ''; return; }
    const h = lateHoursValue();
    box.innerHTML = `<div class="late-banner-head">⏰ ${list.length === 1 ? 'حوالة متأخرة' : list.length + ' حوالات متأخرة'} <span>(صرلها أكتر من ${fmtTrim(h)} ${h === 1 ? 'ساعة' : 'ساعات'} وما خلصت)</span></div>`
        + list.slice(0, 6).map(({ t, ms }) => `<button data-action="tx-details" data-id="${t.id}" class="late-row">
            <span class="min-w-0 truncate"><b>${escapeHtml(t.recipient)}</b> <span class="num">${deliveredHtml(t)}</span> <span class="text-[11px] text-slate-500">${escapeHtml(t.status)}${t.createdBy ? ' · ' + escapeHtml(personName(t.createdBy)) : ''}</span></span>
            <span class="late-ago">صرلها ${lateAgoWords(ms)}</span>
        </button>`).join('')
        + (list.length > 6 ? `<div class="text-[11px] text-slate-500 pt-1">وغيرهم ${list.length - 6}</div>` : '');
}

// كل دقيقة: إذا تغيّرت المتأخرة (أو صار إلها ساعة زيادة) بنعيد رسم السجل
let lateSig = '';
function lateTick() {
    const now = Date.now();
    const sig = ledger.map(t => [t.id, txLateMs(t, now)]).filter(([, ms]) => ms).map(([id, ms]) => id + ':' + Math.floor(ms / 3600000)).join(',');
    if (sig === lateSig) return;
    lateSig = sig;
    if (!pageHidden('transactions')) renderLedgerTable();
}

async function approveTx(id) {
    const tx = ledger.find(x => x.id === id);
    if (!tx || !isManager() || tx.approval !== 'pending') return;
    tx.approval = 'approved';
    tx.approvedBy = session?.username || '';
    queueOps({ action: 'upsert', ...tx });
    renderLedgerTable();
    refreshTxDetails();
    const status = await flushOutbox();
    showToast('تمت الموافقة ✓', `${tx.recipient} — ${txAmountText(tx)}: الموظف بيقدر يكمّلها هلّق`, syncToastType(status));
}

// ================= تنبيهات الاحتيال (بطلب عماد 2026-10-21) =================
// لحظة حفظ الحوالة: (أ) نفس رقم المحفظة/الحساب/IBAN انبعتله قبل باسم ثاني، (ب) زبون جديد ومبلغه فوق حد، (ج) كثير حوالات
// لنفس الزبون باليوم. الحدود إعدادات مشتركة (الرقابة والأمان). المدير لما يكمّل: "الزبون طبيعي" (بيصير موثوق، وما بيطلعله
// تنبيه بعدها، وما في ⚠️). الموظف لما يكمّل: الحوالة عليها ⚠️ وبيوصل المدير إشعار، والمدير بيشيلها بـ "✓ طبيعي"
let fraudPending = null;

function fraudReasons(form) {
    if (!sheetHas('fraud') || form.customer?.trusted === 'yes') return [];
    const c = form.customer;
    const mineTx = (t) => (c && t.customerId && t.customerId === c.id) || normName(t.recipient) === normName(form.recipient);
    const mineCust = (x) => (c && x.id === c.id) || normName(x.name) === normName(form.recipient);
    const reasons = [];
    if (globalConfig.fraudSameNumber !== 'no') {
        const nums = [[form.account, normPhone(form.account || '')], [form.bankAccount, normPhone(form.bankAccount || '')], [formatIban(form.iban || ''), cleanIban(form.iban || '')]]
            .filter(([, n]) => n.length >= 6);
        const has = (x, n) => [normPhone(x.account || ''), normPhone(x.bankAccount || ''), cleanIban(x.iban || '')].includes(n);
        for (const [shown, n] of nums) {
            const hit = ledger.find(t => t.status !== CANCELLED && !mineTx(t) && has(t, n)) || customers.find(x => !mineCust(x) && has(x, n));
            if (hit) { reasons.push(`الرقم ${shown} انبعتله قبل باسم «${hit.recipient || hit.name}»`); break; }
        }
    }
    const prev = ledger.filter(t => t.status !== CANCELLED && mineTx(t));
    const r = computeTransfer(form.input);
    const value = form.input.currency === 'USD' ? r.clientUsd * form.input.screenRate : r.clientIls;
    const limitNew = toNum(globalConfig.fraudNewIls, 0);
    if (limitNew > 0 && !prev.length && value > limitNew) reasons.push(`زبون جديد (أول حوالة إله) والمبلغ ${fmt(value, 0)} ₪`);
    const maxDay = toNum(globalConfig.fraudDailyCount, 0);
    const todayCount = prev.filter(t => t.date === form.date).length;
    if (maxDay > 0 && todayCount >= maxDay) reasons.push(`هاي الحوالة رقم ${todayCount + 1} لنفس الزبون اليوم`);
    return reasons;
}

function checkFraudThenCommit(form) {
    const reasons = fraudReasons(form);
    if (!reasons.length) return commitNewTransaction(form);
    fraudPending = { form, reasons };
    const mgr = isManager();
    $('fraud-reasons').innerHTML = reasons.map(x => `<li>${escapeHtml(x)}</li>`).join('');
    $('fraud-ok-btn').textContent = mgr ? '✓ كمّل، الزبون طبيعي' : 'كمّل وبلّغ المدير';
    $('fraud-note').textContent = mgr
        ? 'الزبون بيصير موثوق: ما بيطلعله تنبيه بعدها، وما بتبين ⚠️ على حوالته للموظفين'
        : 'الحوالة بتنحفظ وعليها ⚠️، وبيوصل المدير إشعار يراجعها';
    openModal('fraudModal');
}

function confirmFraud() {
    const p = fraudPending;
    fraudPending = null;
    closeModal('fraudModal');
    if (!p) return;
    commitNewTransaction(p.form, isManager() ? { trust: true } : { flag: p.reasons.join(' · ') });
}

function flagChip(t) {
    if (!t.flag) return '';
    return isManager()
        ? `<button data-action="tx-flag-ok" data-id="${t.id}" class="flag-chip manager" title="${escapeHtml(t.flag)}">⚠️ تنبيه · ✓ طبيعي</button>`
        : `<span class="flag-chip" title="${escapeHtml(t.flag)}">⚠️ تنبيه</span>`;
}

function flagDetailsHtml(t) {
    if (!t.flag) return '';
    return `<div class="flag-box"><span>⚠️ ${escapeHtml(t.flag)}${t.createdBy ? ` · سجّلها ${escapeHtml(personName(t.createdBy))}` : ''}</span>${isManager() ? `<button data-action="tx-flag-ok" data-id="${t.id}" class="flag-chip manager">✓ الزبون طبيعي</button>` : ''}</div>`;
}

// المدير راجعها: العلامة بتنشال والزبون بيصير موثوق
async function clearTxFlag(id) {
    const tx = ledger.find(x => x.id === id);
    if (!tx || !isManager() || !tx.flag) return;
    tx.flag = '';
    const ops = [{ action: 'upsert', ...tx }];
    const c = customerOfTx(tx);
    if (c && c.trusted !== 'yes') {
        c.trusted = 'yes';
        ops.push({ action: 'upsert_customer', customer: c });
    }
    queueOps(...ops);
    renderLedgerTable();
    refreshTxDetails();
    const status = await flushOutbox();
    showToast('تمام ✓', `${tx.recipient}: انشال التنبيه${c ? ' وصار زبون موثوق' : ''}`, syncToastType(status));
}

function copyTrackLink(btn) {
    const t = ledger.find(x => x.id === toNum(btn.dataset.id, NaN));
    const url = t && trackUrl(t);
    if (url) copyWithFlash(btn, { label: 'رابط التتبّع', shown: url.replace(/^https?:\/\//, ''), value: url });
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
    $('edit_tx_bank_account').value = tx.bankAccount;
    syncBankAccountField($('edit_tx_bank_account'));
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

// البنك: "رقم الجوال (للتحويل)" ورقم الحساب و IBAN، المحفظة: رقم المحفظة، والكاش بدون رقم
function syncEditTxPayoutFields() {
    const payout = $('edit_tx_payout').value;
    $('edit_tx_account_label').textContent = payout === 'بنكي' ? 'رقم الجوال (للتحويل)' : payout === 'كاش' ? 'الرقم (للكاش مش لازم)' : 'رقم المحفظة';
    $('edit_tx_bank_wrap').classList.toggle('hidden', payout !== 'بنكي');
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
// المسلّم فيه قروش (1,387.46)، فالأزرار بتوصل لأقرب نص بنفس الاتجاه: +½ ← 1,387.50، −½ ← 1,387.00، وبعدها خطوات عادية.
// "احذف القروش" ← 1,387.00 (خصم 0.46). نفس الحساب تبع الحاسبة (calculator.js nextFinalAdjust)
function bumpTxFinalAdjust(stepRaw) {
    const el = $('edit_tx_final_adjust');
    const step = stepRaw === 'cents' ? 'cents' : toNum(stepRaw, 0);
    if (el.disabled || !step) return;
    const input = readEditInputs();
    const adj = nextFinalAdjust(deliveredBase(input), input.finalAdjust, step);
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
        ? `قبل التعديل ${escapeHtml(moneyCur(deliveredBase(input), cur))} · <b>${escapeHtml(adjustWord(r.finalAdjust, cur))}</b> <span class="profit-only">· الربح ${signedAmount(-r.finalAdjust * (cur === 'USD' ? input.screenRate : 1), 'ILS')}</span>`
        : 'الأزرار بتوصل لأقرب نص · "احذف القروش" بينزل للرقم الصحيح · موجب = بنعطيه أكثر، سالب = أقل';
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
    const bankAccount = $('edit_tx_payout').value === 'بنكي' ? readBankAccountField($('edit_tx_bank_account')) : '';

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
        ...(sheetHas('bankAccount') ? { bankAccount } : {}),
        status: $('edit_tx_status').value,
        country: selectedCountry($('edit_tx_country'))?.name || tx.country,
        ...input,
        finalAdjust: round2(r.finalAdjust),
        clientIls: round2(r.clientIls),
        clientUsd: round2(r.clientUsd),
        costIls: round2(r.costIls),
        profitIls: round2(r.profitIls)
    };
    // المبلغ زاد فوق حد الموظف: بترجع تستنى الموافقة
    const held = applyTxLimit(next, tx);
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
    showToast('تم تحديث المعاملة', `المعاملة ${receiptNo(tx)}${refund.length ? ' · أُرجع المدفوع للحسابات' : ''}${held ? ' · بتستنى موافقة المدير' : ''} — ${syncResultMessage(syncStatus)}`, held ? 'warning' : syncToastType(syncStatus));
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
    const header = ['المعرف', 'رقم الإيصال', 'التاريخ', 'المرسل إليه', 'رقم الحساب / المحفظة', 'رقم الحساب البنكي', 'IBAN', 'طريقة التسليم', 'الجهة', 'الدولة', 'نوع المعادلة', 'المبلغ الأصلي', 'معامل التحويل', 'نسبة التكلفة %', 'تكلفة ثابتة $', 'نسبة الربح %', 'الخصم الإضافي', 'سعر الشاشة المعتمد', 'عملة التسليم', 'المسلّم بالشيكل', 'المسلّم بالدولار', 'تعديل على النهائي', 'التكلفة بالشيكل', 'صافي الربح بالشيكل', 'الحالة'];
    const rows = ledger.map(t => [
        t.id, t.serial || '', t.date, t.recipient, t.account, t.bankAccount, formatIban(t.iban), t.payout, t.provider, t.country, TYPE_LABEL[t.type],
        t.orig, t.factor, t.costPct, t.costFixed, t.profitPct, t.minusIls, t.screenRate,
        t.currency === 'USD' ? 'دولار' : 'شيكل', t.clientIls.toFixed(2), t.clientUsd.toFixed(2), t.finalAdjust || '',
        t.costIls.toFixed(2), t.profitIls.toFixed(2), t.status
    ]);
    const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
    downloadBlob('\uFEFF' + csv, 'text/csv;charset=utf-8;', `سجل_حوالات_فاست_باي_${localDateStr()}.csv`);
    showToast('تم التصدير', 'تم تنزيل ملف Excel بنجاح', 'info');
}
