'use strict';

// فاست باي — تسعير الدول
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= إدارة الدول =================
function renderCountriesTable() {
    $('countries-table-body').innerHTML = countries.length === 0
        ? '<tr><td colspan="6" class="p-6 text-center text-xs text-slate-400">لا توجد دول، أضف دولة للبدء</td></tr>'
        : countries.map((c, i) => `
            <tr class="hover:bg-slate-50">
                <td class="p-3.5 font-bold text-slate-900">${escapeHtml(c.name)}</td>
                <td class="p-3.5 text-slate-500">${TYPE_LABEL[c.type]}</td>
                <td class="p-3.5 font-mono font-bold text-slate-900 num">${escapeHtml(c.factor)}</td>
                <td class="p-3.5 text-slate-700 font-bold whitespace-nowrap">${escapeHtml(costLabel(c.costMode, c.costValue))}</td>
                <td class="p-3.5 text-emerald-700 font-bold num">${escapeHtml(c.profitPct)}%</td>
                <td class="p-3.5 text-center whitespace-nowrap">
                    <button data-action="edit-country" data-index="${i}" class="text-blue-600 hover:text-blue-800 font-bold text-xs px-2.5 py-1 bg-blue-50 rounded-lg ml-1">تعديل</button>
                    <button data-action="delete-country" data-index="${i}" class="text-slate-400 hover:text-red-600 font-bold text-xs p-1">حذف</button>
                </td>
            </tr>
        `).join('');
}

function openCountryModal(idx = -1) {
    const c = countries[idx];
    $('c_index').value = c ? idx : -1;
    $('countryModalTitle').textContent = c ? `تعديل ${c.name}` : 'إضافة دولة / مصدر جديد';
    $('countrySaveBtn').textContent = c ? 'حفظ التعديل' : 'حفظ';
    $('c_name').value = c ? c.name : '';
    $('c_factor').value = c ? c.factor : '';
    $('c_type').value = c ? c.type : 'div';
    $('c_cost_mode').value = c ? c.costMode : 'pct';
    $('c_cost_value').value = c ? c.costValue : globalConfig.costPct;
    $('c_profit_pct').value = c ? c.profitPct : globalConfig.profitPct;
    openModal('countryModal');
    (c ? $('c_factor') : $('c_name')).focus();
}

async function saveCountry(e) {
    e.preventDefault();
    const idx = toNum($('c_index').value, -1);
    const editing = countries[idx];
    const country = normalizeCountry({
        id: editing?.id,
        order: editing ? editing.order : countries.reduce((m, c) => Math.max(m, c.order), -1) + 1,
        name: $('c_name').value, type: $('c_type').value, factor: $('c_factor').value,
        costMode: $('c_cost_mode').value, costValue: $('c_cost_value').value, profitPct: $('c_profit_pct').value
    });
    if (country.costMode === 'pct' && country.costValue + country.profitPct >= 100) {
        return showToast('تنبيه', 'مجموع التكلفة والربح يجب أن يكون أقل من 100%', 'warning');
    }
    if (!country.name) return showToast('تنبيه', 'اكتب اسم الدولة أو المصدر', 'warning');
    if (!(country.factor > 0)) return showToast('تنبيه', 'المعامل يجب أن يكون أكبر من صفر', 'warning');
    if (countries.some((c, i) => c.name === country.name && i !== idx)) return showToast('تنبيه', 'هذا الاسم موجود مسبقاً', 'warning');

    if (editing) {
        // إذا كان هذا المصدر مختاراً في الحاسبة نحدّث معامله فوراً
        if (calcSource && calcSource.name === editing.name) {
            calcSource = { ...country };
            applySourceToInputs();
            runLiveCalc();
        }
        countries[idx] = country;
    } else {
        countries.push(country);
    }
    saveAll();
    closeModal('countryModal');
    renderCountriesTable();
    renderSourceGrid();
    const msg = `${country.name}: ${factorLabel(country)} · تكلفة ${costLabel(country.costMode, country.costValue)} · ربح ${country.profitPct}%. الحوالات السابقة لا تتأثر.`;
    if (!sheetSupportsCountries) return showToast(editing ? 'تم تعديل التسعير' : 'تمت الإضافة', msg + ' (محفوظ في هذا المتصفح فقط)');
    queueOps({ action: 'upsert_country', country });
    const status = await flushOutbox();
    showToast(editing ? 'تم تعديل التسعير' : 'تمت الإضافة', `${msg} — ${syncResultMessage(status)}`, syncToastType(status));
}

function deleteCountryPrompt(idx) {
    const c = countries[idx];
    if (!c) return;
    showAppConfirm('تأكيد حذف الدولة', `هل أنت متأكد من حذف ${c.name} من قائمة التسعير؟ الحوالات السابقة لن تتأثر.`, async () => {
        countries.splice(idx, 1);
        saveAll();
        renderCountriesTable();
        renderSourceGrid();
        if (!sheetSupportsCountries) return showToast('تم الحذف بنجاح', 'تم حذف الدولة من قائمة التسعير');
        queueOps({ action: 'delete_country', id: c.id });
        const status = await flushOutbox();
        showToast('تم الحذف بنجاح', syncResultMessage(status), syncToastType(status));
    });
}
