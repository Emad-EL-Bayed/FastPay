'use strict';

// فاست باي — المصاريف
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= المصاريف =================
// البنود الثابتة + اللي انضافت بزر "+ بند" (مشتركة) + أي بند انكتب بمصروف قبل (لفلتر البنود)
const configList = (key) => (Array.isArray(globalConfig[key]) ? globalConfig[key] : []).map(c => String(c || '').trim()).filter(Boolean);
const customExpenseCategories = () => configList('expenseCategories');
const hiddenExpenseCategories = () => configList('expenseCategoriesHidden');

function expenseCategories() {
    const used = expenses.map(e => e.category).filter(Boolean);
    return [...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...customExpenseCategories(), ...used])];
}

// الاقتراحات تحت خانة البند: نفسها بدون اللي انشالوا بالـ ×
function expenseSuggestions() {
    const hidden = new Set(hiddenExpenseCategories().map(normName));
    return expenseCategories().filter(c => !hidden.has(normName(c)));
}

// "+ بند": بيضل اقتراح لكل الأجهزة (إعداد مشترك، فلصاحب صلاحية الإعدادات). غيره بيكتب البند الجديد بالخانة وبيصير اقتراح بعد أول مصروف
function addExpenseCategory() {
    const name = $('exp_cat_new').value.trim().replace(/\s+/g, ' ');
    if (!name) return $('exp_cat_new').focus();
    if (expenseSuggestions().some(c => normName(c) === normName(name))) {
        showToast('موجود', `"${name}" موجود بالاقتراحات`, 'info');
    } else {
        // كان منشال: بيرجع
        globalConfig.expenseCategoriesHidden = hiddenExpenseCategories().filter(c => normName(c) !== normName(name));
        if (!expenseCategories().some(c => normName(c) === normName(name))) globalConfig.expenseCategories = [...customExpenseCategories(), name];
        saveAll();
        showToast('انضاف البند', `"${name}" صار بالاقتراحات لكل الأجهزة`, 'success');
    }
    $('exp_cat_new').value = '';
    $('exp-cat-add').classList.add('hidden');
    $('exp_category').value = name;
    renderExpenses();
    $('exp_amount').focus();
}

// × على أي اقتراح (حتى الثابت): بينشال من الاقتراحات بس، والمصاريف عليه بتضل وبفلتر البنود. "+ بند" بيرجّعه
function removeExpenseCategory(name) {
    globalConfig.expenseCategories = customExpenseCategories().filter(c => c !== name);
    if (DEFAULT_EXPENSE_CATEGORIES.includes(name) || expenses.some(e => e.category === name)) {
        globalConfig.expenseCategoriesHidden = [...new Set([...hiddenExpenseCategories(), name])];
    }
    saveAll();
    renderExpenses();
    showToast('انشال من الاقتراحات', `"${name}" · بترجّعه من "+ بند" إذا احتجته`, 'info');
}

function filteredExpenses() {
    const month = $('exp_month_filter').value || '';
    const category = $('exp_category_filter').value || 'ALL';
    return expenses
        .filter(e => (!month || e.date.startsWith(month)) && (category === 'ALL' || e.category === category))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

function renderExpenses() {
    if (pageHidden('expenses')) return;
    const categories = expenseCategories();

    // اقتراحات البنود (صاحب الإعدادات بيشيل أي وحدة بالـ × وبيضيف بـ "+ بند")
    const canAdd = hasPerm('settings');
    $('expense-category-chips').innerHTML = expenseSuggestions().map(c =>
        `<span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-200 transition">
            <button type="button" data-action="pick-category" data-category="${escapeHtml(c)}" class="px-2.5 py-1 text-[11px] font-bold text-slate-600">${escapeHtml(c)}</button>${canAdd
                ? `<button type="button" data-action="exp-cat-remove" data-category="${escapeHtml(c)}" class="pl-2 -mr-1 text-[11px] text-slate-400 hover:text-rose-600" title="شيله من الاقتراحات" aria-label="شيل ${escapeHtml(c)} من الاقتراحات">×</button>` : ''}
        </span>`
    ).join('') + (canAdd ? '<button type="button" data-action="exp-cat-open" class="px-2.5 py-1 rounded-full border border-dashed border-slate-300 hover:border-blue-300 text-[11px] font-bold text-slate-500 hover:text-blue-700 transition">+ بند</button>' : '');

    const filterSelect = $('exp_category_filter');
    const currentFilter = filterSelect.value || 'ALL';
    filterSelect.innerHTML = '<option value="ALL">كل البنود</option>' +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    filterSelect.value = categories.includes(currentFilter) ? currentFilter : 'ALL';

    $('expenses-unsupported').classList.toggle('hidden', sheetSupportsExpenses || dataState !== 'ready');
    const recCount = recurringItems().filter(x => x.on !== 'no').length;
    $('exp-recurring-btn').classList.toggle('hidden', !hasPerm('settings'));
    $('exp-recurring-count').textContent = recCount ? `(${recCount})` : '';
    $('expense-save-btn').disabled = dataState === 'loading' || !sheetSupportsExpenses;

    const list = filteredExpenses();

    // الملخص حسب البند (حسب الفلترة الحالية)
    const byCategory = {};
    let total = 0;
    list.forEach(e => {
        byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
        total += e.amount;
    });
    $('expenses-total').textContent = fmt(total) + ' ₪';
    const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    $('expenses-by-category').innerHTML = entries.length === 0
        ? '<div class="col-span-full text-slate-400 text-xs py-3 text-center">لا توجد مصاريف في هذه الفترة</div>'
        : entries.map(([cat, sum]) => `
            <div class="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs">
                <span class="block text-slate-500 font-bold">${escapeHtml(cat)}</span>
                <span class="block font-black text-rose-600 num text-base mt-0.5">${fmt(sum)} ₪</span>
                <span class="block text-[10px] text-slate-400">${total ? Math.round(sum / total * 100) : 0}% من الإجمالي</span>
            </div>
        `).join('');

    $('expenses-body').innerHTML = list.length === 0
        ? `<tr><td colspan="5" class="p-6 text-center text-xs text-slate-400">${emptyMessage(expenses.length, 'لا توجد مصاريف مطابقة للفلترة', 'لا توجد مصاريف مسجلة بعد')}</td></tr>`
        : list.map(e => `
            <tr class="hover:bg-slate-50">
                <td class="p-3.5 whitespace-nowrap text-slate-500 text-xs num">${escapeHtml(e.date)}</td>
                <td class="p-3.5"><span class="badge bg-rose-50 text-rose-700">${escapeHtml(e.category)}</span></td>
                <td class="p-3.5 font-mono font-black text-slate-900 num whitespace-nowrap">${fmt(e.amount)} ₪</td>
                <td class="p-3.5 text-slate-500 text-xs">${/^تلقائي/.test(e.note) ? `<span class="badge bg-sky-50 text-sky-700 ml-1" title="مصروف ثابت انضاف لحاله">🔁 تلقائي</span>${escapeHtml(e.note.replace(/^تلقائي\s*·?\s*/, ''))}` : escapeHtml(e.note || '-')}</td>
                <td class="p-3.5 text-center whitespace-nowrap">
                    <button data-action="edit-expense" data-id="${e.id}" class="text-blue-600 hover:text-blue-800 font-bold text-xs px-2.5 py-1 bg-blue-50 rounded-lg mr-1">تعديل</button>
                    <button data-action="delete-expense" data-id="${e.id}" class="text-slate-400 hover:text-red-600 p-1 font-bold" title="حذف من السجل ومن الإكسل">✕</button>
                </td>
            </tr>
        `).join('');
}

function resetExpenseForm() {
    $('exp_id').value = '';
    $('exp_category').value = '';
    $('exp_amount').value = '';
    $('exp_note').value = '';
    $('exp_date').value = localDateStr();
    $('expenseFormTitle').textContent = 'إضافة مصروف';
    $('expense-save-btn').textContent = 'حفظ المصروف';
    $('expense-cancel-edit').classList.add('hidden');
}

function editExpense(id) {
    const e = expenses.find(x => x.id === id);
    if (!e) return;
    $('exp_id').value = e.id;
    $('exp_category').value = e.category;
    $('exp_amount').value = e.amount;
    $('exp_date').value = e.date;
    $('exp_note').value = e.note;
    $('expenseFormTitle').textContent = 'تعديل مصروف';
    $('expense-save-btn').textContent = 'حفظ التعديل';
    $('expense-cancel-edit').classList.remove('hidden');
    $('expenseForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('exp_amount').focus();
}

async function saveExpense(ev) {
    ev.preventDefault();
    if (!sheetSupportsExpenses) return showToast('حدّث السكربت أولاً', 'سكربت Google Sheets الحالي لا يدعم المصاريف', 'warning');

    const editingId = toNum($('exp_id').value, 0);
    const expense = normalizeExpense({
        id: editingId || Math.max(Date.now(), expenses.reduce((m, e) => Math.max(m, e.id), 0) + 1),
        date: $('exp_date').value || localDateStr(),
        category: $('exp_category').value,
        amount: $('exp_amount').value,
        note: $('exp_note').value
    });
    if (!expense.category) return showToast('تنبيه', 'اختر بند المصروف', 'warning');
    if (!(expense.amount > 0)) return showToast('تنبيه', 'المبلغ يجب أن يكون أكبر من صفر', 'warning');
    if (editLocked('expenses', expenses.find(x => x.id === expense.id), expense)) return lockWarn();

    const i = expenses.findIndex(x => x.id === expense.id);
    if (i >= 0) expenses[i] = expense; else expenses.unshift(expense);
    queueOps({ action: 'upsert_expense', expense });
    resetExpenseForm();
    renderExpenses();
    updateReportsData();

    const syncStatus = await flushOutbox();
    showToast(editingId ? 'تم تعديل المصروف' : 'تم حفظ المصروف', `${expense.category} — ${fmt(expense.amount)} ₪. ${syncResultMessage(syncStatus)}`, syncToastType(syncStatus));
}

function deleteExpensePrompt(id) {
    const e = expenses.find(x => x.id === id);
    if (!e) return;
    if (dayLocked(e.date)) return lockWarn();
    showAppConfirm('تأكيد حذف المصروف', `هل أنت متأكد من حذف مصروف "${e.category}" بقيمة ${fmt(e.amount)} ₪؟ سيُحذف من الشيت أيضاً.`, async () => {
        expenses = expenses.filter(x => x.id !== id);
        queueOps({ action: 'delete_expense', id });
        if (toNum($('exp_id').value, 0) === id) resetExpenseForm();
        renderExpenses();
        updateReportsData();
        const syncStatus = await flushOutbox();
        showToast('تم حذف المصروف', syncResultMessage(syncStatus), syncToastType(syncStatus));
    });
}

function exportExpensesCSV() {
    const list = filteredExpenses();
    const header = ['التاريخ', 'البند', 'المبلغ ₪', 'ملاحظات'];
    const rows = list.map(e => [e.date, e.category, e.amount.toFixed(2), e.note]);
    const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
    downloadBlob('\uFEFF' + csv, 'text/csv;charset=utf-8;', `مصاريف_فاست_باي_${$('exp_month_filter').value || localDateStr()}.csv`);
    showToast('تم التصدير', `تم تنزيل ${list.length} مصروف`, 'info');
}

// ================= المصاريف الثابتة (بطلب عماد 2026-10-24) =================
// إعداد مشترك recurringExpenses: [{id, name, category, amount, day, on, start}]. السكربت (recurringExpensesJob، كل ربع ساعة)
// بيضيفها لورقة المصاريف بيومها ("تلقائي · الاسم")، مرة بالشهر، ومن شهر start (اليوم لسا ما إجا بهالشهر ← هالشهر، وإلا الجاي)
const pad2 = (n) => String(n).padStart(2, '0');

function recurringItems() {
    return Array.isArray(globalConfig.recurringExpenses) ? globalConfig.recurringExpenses.filter(x => x && x.id) : [];
}

// أول شهر بينضاف فيه: إذا يومه لسا ما إجا بهالشهر هالشهر، وإلا الشهر الجاي (حتى ما ينضاف شي دفعته قبل)
function recurringStart(day) {
    const now = new Date();
    if (day > now.getDate()) return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}`;
}

// التاريخ الجاي اللي بينضاف فيه
function recurringNextDate(x) {
    const today = localDateStr();
    const now = new Date();
    for (let i = 0; i < 14; i++) {
        const d0 = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const key = `${d0.getFullYear()}-${pad2(d0.getMonth() + 1)}`;
        if (x.start && key < x.start) continue;
        const last = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
        const date = `${key}-${pad2(Math.min(Math.max(1, x.day), last))}`;
        if (date >= today) return date;
    }
    return '';
}

function renderRecurringSettings() {
    const list = recurringItems();
    $('rec-script-note').classList.toggle('hidden', sheetHas('recurringExpenses'));
    $('rec-list').innerHTML = list.length ? list.map(x => {
        const on = x.on !== 'no';
        const next = on ? recurringNextDate(x) : '';
        return `<div class="rec-row${on ? '' : ' off'}">
            <div class="min-w-0 flex-1">
                <b class="text-slate-900">${escapeHtml(x.name || x.category)}</b>${x.category && x.category !== x.name ? ` <span class="text-[11px] text-slate-500">· ${escapeHtml(x.category)}</span>` : ''}
                <span class="block text-[10px] text-slate-400">يوم ${x.day} بالشهر${next ? ` · الجاية <bdi class="ltr-num">${escapeHtml(next)}</bdi>` : on ? '' : ' · موقّف'}</span>
            </div>
            <b class="num text-rose-700 whitespace-nowrap">${fmtTrim(x.amount)} ₪</b>
            <button type="button" data-action="rec-toggle" data-id="${escapeHtml(x.id)}" class="status-toggle${on ? ' on' : ''}" style="--c:#10b981" aria-pressed="${on}"><span class="sw"></span>${on ? 'شغّال' : 'موقّف'}</button>
            <button type="button" data-action="rec-edit" data-id="${escapeHtml(x.id)}" class="text-[11px] font-bold text-blue-700 px-1.5">تعديل</button>
            <button type="button" data-action="rec-remove" data-id="${escapeHtml(x.id)}" class="text-[11px] font-bold text-slate-400 hover:text-rose-600 px-1" aria-label="احذف">✕</button>
        </div>`;
    }).join('') : '<p class="text-xs text-slate-400">ما في مصاريف ثابتة لسا. أضف الإيجار أو الرواتب تحت.</p>';
}

function resetRecurringForm() {
    $('rec_id').value = '';
    $('rec_name').value = '';
    $('rec_category').value = '';
    $('rec_amount').value = '';
    $('rec_day').value = '1';
    $('rec-save-btn').textContent = '+ أضف';
    $('rec-cancel').classList.add('hidden');
}

function editRecurring(id) {
    const x = recurringItems().find(r => r.id === id);
    if (!x) return;
    $('rec_id').value = x.id;
    $('rec_name').value = x.name || '';
    $('rec_category').value = x.category || '';
    $('rec_amount').value = x.amount;
    $('rec_day').value = x.day;
    $('rec-save-btn').textContent = 'حفظ التعديل';
    $('rec-cancel').classList.remove('hidden');
    $('rec_name').focus();
}

function saveRecurring() {
    if (!hasPerm('settings')) return;
    const name = $('rec_name').value.trim().slice(0, 60);
    const category = ($('rec_category').value.trim() || name).slice(0, 60);
    const amount = round2(toNum($('rec_amount').value, 0));
    const day = Math.round(toNum($('rec_day').value, 0));
    if (!name && !category) return showToast('تنبيه', 'اكتب اسم المصروف', 'warning');
    if (!(amount > 0)) return showToast('تنبيه', 'اكتب المبلغ', 'warning');
    if (!(day >= 1 && day <= 31)) return showToast('تنبيه', 'اليوم من 1 لـ 31', 'warning');
    const list = recurringItems();
    const id = $('rec_id').value;
    const old = list.find(x => x.id === id);
    const item = { id: old ? old.id : 'r' + nextId(), name: name || category, category, amount, day, on: old ? old.on : 'yes', start: old && old.day === day ? old.start : recurringStart(day) };
    globalConfig.recurringExpenses = old ? list.map(x => (x.id === id ? item : x)) : list.concat(item);
    saveAll();
    resetRecurringForm();
    renderRecurringSettings();
    renderExpenses();
    const next = recurringNextDate(item);
    showToast(old ? 'انحفظ التعديل' : 'انضاف المصروف الثابت', `${item.name} ${fmtTrim(amount)} ₪${next ? ' · أول مرة ' + next : ''}`, 'success');
}

function toggleRecurring(id) {
    globalConfig.recurringExpenses = recurringItems().map(x => (x.id === id ? { ...x, on: x.on === 'no' ? 'yes' : 'no', start: x.on === 'no' ? recurringStart(x.day) : x.start } : x));
    saveAll();
    renderRecurringSettings();
    renderExpenses();
}

function removeRecurring(id) {
    const x = recurringItems().find(r => r.id === id);
    if (!x) return;
    showAppConfirm('حذف المصروف الثابت', `${x.name} ${fmtTrim(x.amount)} ₪ ما عاد ينضاف كل شهر. المصاريف اللي انضافت قبل بتضل.`, () => {
        globalConfig.recurringExpenses = recurringItems().filter(r => r.id !== id);
        saveAll();
        renderRecurringSettings();
        renderExpenses();
    });
}
