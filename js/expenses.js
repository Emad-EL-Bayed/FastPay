'use strict';

// فاست باي — المصاريف
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= المصاريف =================
// البنود الثابتة + اللي انضافت بزر "+ بند" (مشتركة) + أي بند انكتب بمصروف قبل
const customExpenseCategories = () => (Array.isArray(globalConfig.expenseCategories) ? globalConfig.expenseCategories : []).map(c => String(c || '').trim()).filter(Boolean);

function expenseCategories() {
    const used = expenses.map(e => e.category).filter(Boolean);
    return [...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...customExpenseCategories(), ...used])];
}

// "+ بند": بيضل اقتراح لكل الأجهزة (إعداد مشترك، فلصاحب صلاحية الإعدادات). غيره بيكتب البند الجديد بالخانة وبيصير اقتراح بعد أول مصروف
function addExpenseCategory() {
    const name = $('exp_cat_new').value.trim().replace(/\s+/g, ' ');
    if (!name) return $('exp_cat_new').focus();
    if (expenseCategories().some(c => normName(c) === normName(name))) {
        showToast('موجود', `"${name}" موجود بالاقتراحات`, 'info');
    } else {
        globalConfig.expenseCategories = [...customExpenseCategories(), name];
        saveAll();
        showToast('انضاف البند', `"${name}" صار بالاقتراحات لكل الأجهزة`, 'success');
    }
    $('exp_cat_new').value = '';
    $('exp-cat-add').classList.add('hidden');
    $('exp_category').value = name;
    renderExpenses();
    $('exp_amount').focus();
}

function removeExpenseCategory(name) {
    globalConfig.expenseCategories = customExpenseCategories().filter(c => c !== name);
    saveAll();
    renderExpenses();
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

    // اقتراحات البنود
    $('expense-categories').innerHTML = categories.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
    const custom = customExpenseCategories();
    const canAdd = hasPerm('settings');
    $('expense-category-chips').innerHTML = categories.map(c =>
        `<span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-200 transition">
            <button type="button" data-action="pick-category" data-category="${escapeHtml(c)}" class="px-2.5 py-1 text-[11px] font-bold text-slate-600">${escapeHtml(c)}</button>${canAdd && custom.includes(c) && !DEFAULT_EXPENSE_CATEGORIES.includes(c)
                ? `<button type="button" data-action="exp-cat-remove" data-category="${escapeHtml(c)}" class="pl-2 -mr-1 text-[11px] text-slate-400 hover:text-rose-600" title="شيله من الاقتراحات" aria-label="شيل ${escapeHtml(c)} من الاقتراحات">×</button>` : ''}
        </span>`
    ).join('') + (canAdd ? '<button type="button" data-action="exp-cat-open" class="px-2.5 py-1 rounded-full border border-dashed border-slate-300 hover:border-blue-300 text-[11px] font-bold text-slate-500 hover:text-blue-700 transition">+ بند</button>' : '');

    const filterSelect = $('exp_category_filter');
    const currentFilter = filterSelect.value || 'ALL';
    filterSelect.innerHTML = '<option value="ALL">كل البنود</option>' +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    filterSelect.value = categories.includes(currentFilter) ? currentFilter : 'ALL';

    $('expenses-unsupported').classList.toggle('hidden', sheetSupportsExpenses || dataState !== 'ready');
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
                <td class="p-3.5 text-slate-500 text-xs">${escapeHtml(e.note || '-')}</td>
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
