'use strict';

// فاست باي — تسعير الدول
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= إدارة الدول =================
function renderCountriesTable() {
    $('countries-table-body').innerHTML = countries.length === 0
        ? '<tr><td colspan="6" class="p-6 text-center text-xs text-slate-400">لا توجد دول، أضف دولة للبدء</td></tr>'
        : countries.map((c, i) => `
            <tr class="hover:bg-slate-50">
                <td class="p-3.5 font-bold text-slate-900">${escapeHtml(c.name)}${c.tiers.length ? `<span class="ct-chip" title="${escapeHtml(countryTiersTitle(c))}">${c.tiers.length + 1} شرائح</span>` : ''}</td>
                <td class="p-3.5 text-slate-500">${TYPE_LABEL[c.type]}</td>
                <td class="p-3.5 font-mono font-bold text-slate-900 num">${escapeHtml(c.factor)}</td>
                <td class="p-3.5 text-slate-700 font-bold whitespace-nowrap">${escapeHtml(countryRangeText(c, 'cost'))}</td>
                <td class="p-3.5 text-emerald-700 font-bold num whitespace-nowrap">${escapeHtml(countryRangeText(c, 'profit'))}</td>
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
    ctTiers = c ? c.tiers.map(t => ({ ...t })) : [];
    renderCountryTiers();
    openModal('countryModal');
    (c ? $('c_factor') : $('c_name')).focus();
}

async function saveCountry(e) {
    e.preventDefault();
    const idx = toNum($('c_index').value, -1);
    const editing = countries[idx];
    const read = readCountryTiers();
    if (read.error) return showToast('تنبيه', read.error, 'warning');
    const country = normalizeCountry({
        id: editing?.id,
        order: editing ? editing.order : countries.reduce((m, c) => Math.max(m, c.order), -1) + 1,
        name: $('c_name').value, type: $('c_type').value, factor: $('c_factor').value,
        costMode: $('c_cost_mode').value, costValue: $('c_cost_value').value, profitPct: $('c_profit_pct').value,
        tiers: read.tiers
    });
    if (country.costMode === 'pct' && countryTierList(country).some(t => t.cost + t.profit >= 100)) {
        return showToast('تنبيه', 'مجموع التكلفة والربح يجب أن يكون أقل من 100%' + (country.tiers.length ? ' بكل شريحة' : ''), 'warning');
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
    const tiersText = country.tiers.length ? ` · ${country.tiers.length + 1} شرائح حسب المبلغ` : '';
    const msg = `${country.name}: ${factorLabel(country)} · تكلفة ${countryRangeText(country, 'cost')} · ربح ${countryRangeText(country, 'profit')}${tiersText}. الحوالات السابقة لا تتأثر.`;
    if (!sheetSupportsCountries) return showToast(editing ? 'تم تعديل التسعير' : 'تمت الإضافة', msg + ' (محفوظ في هذا المتصفح فقط)');
    queueOps(countryOp(country));
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

// ================= شرائح الدولة حسب المبلغ (بطلب عماد 2026-10-22) =================
// بنافذة الدولة: الشريحة الأولى (من 0) هي خانات التكلفة والربح فوق، وكل شريحة بعدها: من كم $، التكلفة، الربح.
// التكلفة بنفس نوع تكلفة الدولة (% أو $ ثابت). الحاسبة بتختار الشريحة حسب المبلغ بالدولار (calculator.js applyCalcTier)
let ctTiers = []; // الخانات كما هي لحد الحفظ

// "4.4%" / "6% – 10%" / "$5 ثابت" (للجدول والتنبيه)
function countryRangeText(c, key) {
    const vals = countryTierList(c).map(t => t[key]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    // الوحدة على الرقمين حتى يتقرا صح بالعربي ("6% – 10%" مش "10%–6")
    if (key === 'cost') return lo === hi ? costLabel(c.costMode, lo) : (c.costMode === 'fixed' ? `$${fmtTrim(lo)} – $${fmtTrim(hi)} ثابت` : `${fmtTrim(lo)}% – ${fmtTrim(hi)}%`);
    return lo === hi ? `${fmtTrim(lo)}%` : `${fmtTrim(lo)}% – ${fmtTrim(hi)}%`;
}

// سطر لكل شريحة (للوقوف بالماوس على "3 شرائح")
function countryTiersTitle(c) {
    const list = countryTierList(c);
    return list.map(t => `${tierRangeText(list, t.min, '$')}: تكلفة ${costLabel(c.costMode, t.cost)} · ربح ${fmtTrim(t.profit)}%`).join('\n');
}

function renderCountryTiers() {
    const on = sheetHas('countryTiers');
    $('c_tiers_wrap').classList.toggle('hidden', !on);
    $('c_tiers_old').classList.toggle('hidden', on);
    const list = on ? ctTiers : [];
    $('c_rates_box').classList.toggle('has-tiers', list.length > 0);
    // نوع التكلفة: جنب خانة التكلفة بدون شرائح، وفوق الجدول معها (بالجوال ما بيضل مكان لخانة الشريحة الأولى)
    const sel = $('c_cost_mode');
    const host = list.length ? $('c_cost_mode_slot') : $('c_cost_cell');
    if (sel.parentElement !== host) host.appendChild(sel);
    $('c_tier_rows').innerHTML = list.map((t, i) => `
        <div class="relative min-w-0"><input type="text" inputmode="decimal" data-commas data-ct="${i}" data-k="min" class="w-full field font-bold ct-in" placeholder="100" aria-label="الشريحة ${i + 2}: من كم $"><span class="ct-suffix">$</span></div>
        <div class="relative min-w-0"><input type="number" step="any" min="0" data-ct="${i}" data-k="cost" value="${escapeHtml(t.cost)}" class="w-full field font-bold ct-in" aria-label="تكلفة الشريحة ${i + 2}"><span class="ct-suffix ct-cost-unit"></span></div>
        <input type="number" step="any" min="0" data-ct="${i}" data-k="profit" value="${escapeHtml(t.profit)}" class="w-full min-w-0 field font-bold text-emerald-700" aria-label="ربح الشريحة ${i + 2} %">
        <button type="button" data-action="country-tier-remove" data-i="${i}" class="ct-x" aria-label="احذف الشريحة">✕</button>`).join('');
    // بالخاصية (مش بالـ HTML) حتى تنكتب الفاصلة: 1,000
    $('c_tier_rows').querySelectorAll('[data-k="min"]').forEach(el => { el.value = list[toNum(el.dataset.ct, 0)].min; });
    updateCountryTierHints();
}

// وحدة التكلفة بالشرائح، والتنبيه إذا الزبون بياخد أقل لما يبعت أكتر عند حد شريحة
function updateCountryTierHints() {
    const fixed = $('c_cost_mode').value === 'fixed';
    document.querySelectorAll('#c_rates_box .ct-cost-unit').forEach(el => { el.textContent = fixed ? '$' : '%'; });
    const warn = $('c_tiers_warn');
    const list = [{ min: 0, cost: toNum($('c_cost_value').value, 0), profit: toNum($('c_profit_pct').value, 0) }]
        .concat(ctTiers.map(t => ({ min: toNum(t.min, 0), cost: toNum(t.cost, 0), profit: toNum(t.profit, 0) })).filter(t => t.min > 0))
        .sort((a, b) => a.min - b.min);
    const gets = (t, x) => x - (fixed ? Math.min(t.cost, x) : x * t.cost / 100) - x * t.profit / 100;
    const drop = list.find((t, i) => i > 0 && gets(t, t.min) < gets(list[i - 1], t.min - 0.01) - 0.005);
    warn.classList.toggle('hidden', !drop);
    if (drop) {
        const prev = list[list.indexOf(drop) - 1];
        warn.textContent = `⚠️ على ${fmtTrim(drop.min)}$ الزبون بياخد ${fmt(gets(drop, drop.min))}$، أقل من اللي بياخده على ${fmt(drop.min - 0.01)}$ (${fmt(gets(prev, drop.min - 0.01))}$). خلّي نسبة الشريحة الأعلى أقل.`;
    }
}

function onCountryTierInput(e) {
    const el = e.target.closest('[data-ct]');
    if (!el) return;
    const t = ctTiers[toNum(el.dataset.ct, -1)];
    if (t) t[el.dataset.k] = el.value;
    updateCountryTierHints();
}

// شريحة جديدة: نفس تكلفة اللي قبلها (عماد بيكتب نفس التكلفة وبيغيّر الربح)، والحد والربح بيكتبهم
function addCountryTier() {
    const last = ctTiers[ctTiers.length - 1];
    ctTiers.push({ min: '', cost: last ? last.cost : $('c_cost_value').value, profit: '' });
    renderCountryTiers();
    const inputs = $('c_tier_rows').querySelectorAll('[data-k="min"]');
    inputs[inputs.length - 1]?.focus();
}

function removeCountryTier(i) {
    ctTiers.splice(toNum(i, -1), 1);
    renderCountryTiers();
}

// للحفظ: السطر الفاضي كله بينشال، والناقص أو المكرر بيوقف الحفظ
function readCountryTiers() {
    if (!sheetHas('countryTiers')) return { tiers: [] };
    const blank = (v) => String(v ?? '').trim() === '';
    const rows = ctTiers.filter(t => !(blank(t.min) && blank(t.profit)));
    for (let i = 0; i < rows.length; i++) {
        const t = rows[i];
        if (!(toNum(t.min, 0) > 0)) return { error: 'اكتب "من كم $" لكل شريحة (أكبر من صفر)' };
        if (blank(t.profit)) return { error: `اكتب نسبة الربح لشريحة ${fmtTrim(toNum(t.min, 0))}$` };
    }
    const mins = rows.map(t => tierNum(t.min));
    if (new Set(mins).size !== mins.length) return { error: 'في شريحتين بنفس المبلغ' };
    return { tiers: normalizeCountryTiers(rows) };
}
