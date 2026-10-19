'use strict';

// فاست باي — الحسابات الجاهزة (بطلب عماد 2026-10-19)
// حسابات بنعطيها للزبائن (حساب سعودي مثلاً) مع شروطها: نسخ، أو إرسال على واتساب لزبون بتختاره، بكبسة.
// بالشيت (ورقة "الحسابات الجاهزة"). مرات النسخ والإرسال وآخر استعمال بيكتبها السكربت (use_ready)، والتعديل ما بيلمسها.
// صلاحية "الحسابات الجاهزة" (ready): القراءة والإضافة والتعديل والاستعمال، والحذف بصلاحية الحذف كمان.
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

let readyAccounts = [];
let readyFilter = 'all'; // all | paused | cat:<التصنيف>
let readySendId = null;
let readyPickerIndex = -1;

const READY_SORTS = ['used', 'recent', 'newest', 'name'];

function normalizeReady(r) {
    return {
        id: String(r?.id ?? '').trim(),
        name: String(r?.name ?? '').trim(),
        category: String(r?.category ?? '').trim(),
        details: String(r?.details ?? '').replace(/\r\n?/g, '\n').trim(),
        terms: String(r?.terms ?? '').replace(/\r\n?/g, '\n').trim(),
        paused: r?.paused === 'yes' || r?.paused === true,
        copies: Math.max(0, Math.round(toNum(r?.copies, 0))),
        sends: Math.max(0, Math.round(toNum(r?.sends, 0))),
        lastUsedAt: String(r?.lastUsedAt ?? '').trim(),
        lastUsedBy: String(r?.lastUsedBy ?? '').trim(),
        createdAt: String(r?.createdAt ?? '').slice(0, 10),
        createdBy: String(r?.createdBy ?? '').trim()
    };
}

// للشيت: المحتوى بس (العدادات للسكربت)
const readyPayload = (x) => ({ id: x.id, name: x.name, category: x.category, details: x.details, terms: x.terms, paused: x.paused ? 'yes' : 'no', createdAt: x.createdAt });

// اللي بيوصل للزبون: الحساب، وتحته الشروط
const readyMessage = (x) => [x.details, x.terms ? 'الشروط:\n' + x.terms : ''].filter(Boolean).join('\n\n');

// "2026-10-19 15:42:07" بوقت الجهاز (زي اللي بيكتبه السكربت)
function readyStamp(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${localDateStr(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const readyStampMs = (s) => {
    if (!s) return 0;
    const t = new Date(/T/.test(s) ? s : s.replace(' ', 'T')).getTime();
    return Number.isFinite(t) ? t : 0;
};

// علم الدولة من التصنيف أو الاسم (للشكل بس)
const READY_FLAGS = [
    [/سعود|saudi|\bksa\b/i, '🇸🇦'], [/[اإ]مارات|دبي|\buae\b|emirates/i, '🇦🇪'], [/قطر|qatar/i, '🇶🇦'],
    [/كويت|kuwait/i, '🇰🇼'], [/بحرين|bahrain/i, '🇧🇭'], [/سلطنة|oman/i, '🇴🇲'], [/[اأ]ردن|jordan/i, '🇯🇴'],
    [/مصر|egypt/i, '🇪🇬'], [/تركيا|turk/i, '🇹🇷'], [/فلسطين|palestin/i, '🇵🇸'], [/[اأ]مريكا|\busa?\b/i, '🇺🇸'],
    [/[اأ]لمانيا|germany/i, '🇩🇪'], [/بريطانيا|\buk\b|england/i, '🇬🇧'], [/[اأ]وروبا|europe|sepa/i, '🇪🇺'],
    [/usdt|tether|كريبتو/i, '₮']
];
const READY_BANK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 21h18"/></svg>';

function readyIcon(x) {
    const hit = READY_FLAGS.find(([re]) => re.test(x.category) || re.test(x.name));
    return hit ? `<span class="ready-icon ready-flag" aria-hidden="true">${hit[1]}</span>` : `<span class="ready-icon">${READY_BANK_ICON}</span>`;
}

// ---------- الصفحة ----------
function readyCategories() {
    const counts = new Map();
    readyAccounts.forEach(x => { if (x.category) counts.set(x.category, (counts.get(x.category) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar'));
}

function readyMatches(x, q, qDigits) {
    if (!q) return true;
    const text = normName([x.name, x.category, x.details, x.terms].join(' '));
    if (text.includes(q)) return true;
    // 3 أرقام من رقم الحساب (المسافات والشرطات ما بتفرق)
    return qDigits.length >= 3 && normPhone(x.details).includes(qDigits);
}

function sortedReady(list) {
    const sort = READY_SORTS.includes(globalConfig.readySort) ? globalConfig.readySort : 'used';
    const used = (x) => x.copies + x.sends;
    const cmp = {
        used: (a, b) => used(b) - used(a) || readyStampMs(b.lastUsedAt) - readyStampMs(a.lastUsedAt),
        recent: (a, b) => readyStampMs(b.lastUsedAt) - readyStampMs(a.lastUsedAt) || used(b) - used(a),
        newest: (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        name: (a, b) => a.name.localeCompare(b.name, 'ar')
    }[sort];
    // الموقوفة آخر إشي
    return [...list].sort((a, b) => (a.paused - b.paused) || cmp(a, b) || a.name.localeCompare(b.name, 'ar'));
}

function renderReadyPage() {
    if (pageHidden('ready')) return;
    const supported = sheetHas('ready');
    $('ready-old-script').classList.toggle('hidden', supported || dataState !== 'ready');
    $('ready-new-btn').disabled = !supported;
    if (READY_SORTS.includes(globalConfig.readySort)) $('ready_sort').value = globalConfig.readySort;

    // الفلاتر: الكل، كل تصنيف، والموقوفة
    const cats = readyCategories();
    const pausedCount = readyAccounts.filter(x => x.paused).length;
    if (readyFilter.startsWith('cat:') && !cats.some(([c]) => 'cat:' + c === readyFilter)) readyFilter = 'all';
    if (readyFilter === 'paused' && !pausedCount) readyFilter = 'all';
    const chip = (key, label, n) => `<button type="button" data-action="ready-filter" data-filter="${escapeHtml(key)}" class="tf-chip${readyFilter === key ? ' active' : ''}">${escapeHtml(label)} <b class="num">${n}</b></button>`;
    $('ready-filters').innerHTML = (readyAccounts.length ? chip('all', 'الكل', readyAccounts.length) : '')
        + cats.map(([c, n]) => chip('cat:' + c, c, n)).join('')
        + (pausedCount ? chip('paused', 'موقوفة', pausedCount) : '');
    $('ready-filters').classList.toggle('hidden', readyAccounts.length < 2 && !cats.length);

    const q = normName(latinDigits($('ready_search').value));
    const qDigits = normPhone($('ready_search').value).replace(/\D/g, '');
    const list = sortedReady(readyAccounts.filter(x =>
        (readyFilter === 'all' || (readyFilter === 'paused' ? x.paused : 'cat:' + x.category === readyFilter)) && readyMatches(x, q, qDigits)));

    const n = readyAccounts.length;
    $('ready-count').textContent = !n ? '' : n === 1 ? 'حساب واحد' : n === 2 ? 'حسابين' : `${n} ${n <= 10 ? 'حسابات' : 'حساب'}`;
    if (!list.length) {
        $('ready-grid').innerHTML = `<div class="ready-empty">${readyAccounts.length
            ? `<b>ما في نتيجة</b><span>جرّب كلمة ثانية، أو 3 أرقام من رقم الحساب</span>`
            : dataState === 'loading' ? skeletonLines()
            : `<span class="ready-empty-icon">${READY_BANK_ICON}</span><b>ضيف أول حساب جاهز</b><span>مثلاً "حساب سعودي": تكتب تفاصيله وشروطه مرة وحدة، وبعدها بتنسخه أو بتبعته للزبون على واتساب بكبسة.</span>${supported ? '<button type="button" data-action="ready-new" class="ready-btn ready-btn-copy mt-2">+ حساب جديد</button>' : ''}`}</div>`;
        return;
    }
    $('ready-grid').innerHTML = list.map(readyCardHtml).join('');
}

function readyUsageHtml(x) {
    const parts = [];
    if (x.copies) parts.push(`<span title="مرات النسخ">${COPY_ICON}<b class="num">${x.copies}</b> نسخ</span>`);
    if (x.sends) parts.push(`<span title="مرات الإرسال على واتساب">${WA_ICON}<b class="num">${x.sends}</b> إرسال</span>`);
    const ms = readyStampMs(x.lastUsedAt);
    if (ms) parts.push(`<span title="${escapeHtml(x.lastUsedAt)}">آخر استعمال ${escapeHtml(agoText(ms))}${x.lastUsedBy ? ' · ' + escapeHtml(personName(x.lastUsedBy)) : ''}</span>`);
    return parts.length ? parts.join('<i aria-hidden="true">·</i>') : '<span>لسا ما انستعمل</span>';
}

function readyCardHtml(x) {
    const id = escapeHtml(x.id);
    const added = x.createdAt ? x.createdAt.split('-').reverse().join('/') : '';
    return `
        <article class="ready-card${x.paused ? ' is-paused' : ''}" data-id="${id}">
            <header class="ready-head">
                ${readyIcon(x)}
                <div class="min-w-0 flex-1">
                    <h3 class="ready-name">${escapeHtml(x.name)}</h3>
                    <div class="ready-meta">
                        ${x.category ? `<span class="ready-cat">${escapeHtml(x.category)}</span>` : ''}
                        ${x.paused ? '<span class="ready-paused">⏸ موقوف</span>' : ''}
                    </div>
                </div>
                <div class="ready-tools">
                    <button type="button" data-action="edit-ready-pause" data-id="${id}" title="${x.paused ? 'رجّعه يشتغل' : 'إيقاف مؤقت'}" aria-label="${x.paused ? 'رجّعه يشتغل' : 'إيقاف مؤقت'}">${x.paused
                        ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>'
                        : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/></svg>'}</button>
                    <button type="button" data-action="edit-ready" data-id="${id}" title="تعديل" aria-label="تعديل"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
                    <button type="button" data-action="delete-ready" data-id="${id}" title="حذف" aria-label="حذف"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
                </div>
            </header>
            <div class="ready-details">
                <pre class="ready-text" dir="auto">${escapeHtml(x.details)}</pre>
                <button type="button" data-action="ready-copy" data-id="${id}" data-part="details" class="copy-btn ready-copy-mini" title="نسخ الحساب بس (بدون الشروط)" aria-label="نسخ الحساب بس">${COPY_ICON}</button>
            </div>
            ${x.terms ? `<div class="ready-terms"><span class="ready-terms-label">الشروط</span><p dir="auto">${escapeHtml(x.terms)}</p></div>` : ''}
            <div class="ready-actions">
                <button type="button" data-action="ready-copy" data-id="${id}" class="ready-btn ready-btn-copy"${x.paused ? ' disabled title="الحساب موقوف"' : ''}>${COPY_ICON}<span>نسخ${x.terms ? ' مع الشروط' : ''}</span></button>
                <button type="button" data-action="ready-send" data-id="${id}" class="ready-btn ready-btn-wa"${x.paused ? ' disabled title="الحساب موقوف"' : ''}>${WA_ICON}<span>إرسال لزبون</span></button>
            </div>
            <footer class="ready-foot">
                <div class="ready-usage">${readyUsageHtml(x)}</div>
                ${added ? `<span class="ready-added">أُضيف <bdi class="num">${added}</bdi>${x.createdBy ? ' · ' + escapeHtml(personName(x.createdBy)) : ''}</span>` : ''}
            </footer>
        </article>`;
}

// ---------- النسخ والإرسال (بيتعدّوا بالشيت) ----------
function recordReadyUse(x, kind) {
    x[kind === 'send' ? 'sends' : 'copies'] += 1;
    x.lastUsedAt = readyStamp();
    x.lastUsedBy = session?.username || '';
    if (sheetHas('ready')) {
        queueOps({ action: 'use_ready', id: x.id, kind, at: x.lastUsedAt });
        flushOutbox();
    }
    renderReadyPage();
}

async function copyReady(btn) {
    const x = readyAccounts.find(y => y.id === btn.dataset.id);
    if (!x) return;
    const onlyDetails = btn.dataset.part === 'details';
    const ok = await copyText(onlyDetails ? x.details : readyMessage(x));
    if (!ok) return showToast('ما زبط النسخ', 'المتصفح منع النسخ، انسخه بإيدك', 'warning');
    showToast('تم النسخ', onlyDetails || !x.terms ? `${x.name}: الحساب` : `${x.name}: الحساب مع الشروط`, 'success');
    recordReadyUse(x, 'copy');
    // الكرت انرسم من جديد: الزر الجديد بيخضر لحظة
    const live = document.querySelector(`.ready-card[data-id="${CSS.escape(x.id)}"] [data-action="ready-copy"]${onlyDetails ? '[data-part="details"]' : ':not([data-part])'}`);
    if (live) {
        live.classList.add('copied');
        setTimeout(() => live.classList.remove('copied'), 1200);
    }
}

function openReadySend(id) {
    const x = readyAccounts.find(y => y.id === id);
    if (!x) return;
    readySendId = id;
    $('rs_title').textContent = x.name;
    $('rs_customer').value = '';
    $('rs_customer_id').value = '';
    $('rs_phone').value = '';
    $('rs_message').value = readyMessage(x);
    syncReadyPhoneHint();
    closeReadyCustomerPicker();
    openModal('readySendModal');
    if (!isTouchDevice()) $('rs_customer').focus();
}

function onReadyCustomerInput() {
    const linked = customers.find(c => c.id === $('rs_customer_id').value);
    if (linked && normName(linked.name) !== normName($('rs_customer').value)) {
        $('rs_customer_id').value = '';
        $('rs_phone').value = '';
    }
    readyPickerIndex = -1;
    $('rs-customer-dropdown').innerHTML = customers.length
        ? customerPickerHtml($('rs_customer').value.trim(), 'ready-select-customer')
        : '<div class="p-3 text-xs text-slate-400 text-center">ما في زبائن بهالحساب. اكتب رقم الواتساب تحت</div>';
    $('rs-customer-dropdown').classList.remove('hidden');
    syncReadyPhoneHint();
}

function closeReadyCustomerPicker() {
    $('rs-customer-dropdown').classList.add('hidden');
}

function onReadyCustomerKey(e) {
    readyPickerIndex = pickerKeyNav(e, $('rs-customer-dropdown'), readyPickerIndex, selectReadyCustomer, closeReadyCustomerPicker);
}

function selectReadyCustomer(id) {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    $('rs_customer').value = c.name;
    $('rs_customer_id').value = c.id;
    $('rs_phone').value = hasWhatsapp(c) ? '+' + whatsappDigits(c.phone) : '';
    closeReadyCustomerPicker();
    syncReadyPhoneHint();
    if (!hasWhatsapp(c)) $('rs_phone').focus();
}

function syncReadyPhoneHint() {
    const c = customers.find(x => x.id === $('rs_customer_id').value);
    const hint = $('rs_phone_hint');
    hint.textContent = c && hasWhatsapp(c) ? `✓ رقم ${c.name} المحفوظ`
        : c ? `${c.name} ما إله رقم واتساب محفوظ: اكتبه مع المقدمة`
        : 'مع المقدمة، مثل 970599123456';
    hint.className = 'text-[10px] block mt-1 ' + (c && hasWhatsapp(c) ? 'text-emerald-600 font-bold' : 'text-slate-400');
}

// toAnyone: بدون زبون، واتساب بيفتح وإنت بتختار المحادثة
function sendReady(toAnyone = false) {
    const x = readyAccounts.find(y => y.id === readySendId);
    if (!x) return closeModal('readySendModal');
    const text = $('rs_message').value.trim() || readyMessage(x);
    const phone = toAnyone ? '' : $('rs_phone').value.trim();
    if (!toAnyone && !hasWhatsapp({ phone })) {
        $('rs_phone').focus();
        return showToast('رقم الواتساب ناقص', phone ? 'اكتبه مع المقدمة، مثل 970599123456' : 'اختار زبون إله رقم، أو اكتب الرقم، أو "افتح واتساب واختار المحادثة"', 'warning');
    }
    // لازم بنفس الكبسة (المتصفح بيمنع النوافذ بعد انتظار)
    window.open(waUrl(phone, text), '_blank', 'noopener');
    closeModal('readySendModal');
    recordReadyUse(x, 'send');
    const who = $('rs_customer').value.trim();
    showToast('انفتح واتساب', toAnyone ? 'اختار المحادثة واكبس إرسال' : `الرسالة جاهزة${who ? ' لـ ' + who : ''}، اكبس إرسال بواتساب`, 'success');
}

// ---------- الإضافة والتعديل ----------
function openReadyModal(x = null) {
    if (!sheetHas('ready')) return showToast('حدّث السكربت', 'الحسابات الجاهزة بدها سكربت Google Sheets الجديد', 'warning');
    $('readyModalTitle').textContent = x ? 'تعديل: ' + x.name : 'حساب جاهز جديد';
    $('rd_id').value = x ? x.id : '';
    $('rd_name').value = x ? x.name : '';
    $('rd_category').value = x ? x.category : '';
    $('rd_details').value = x ? x.details : '';
    $('rd_terms').value = x ? x.terms : '';
    $('rd_paused').checked = !!x?.paused;
    $('rd_categories').innerHTML = readyCategories().map(([c]) => `<option value="${escapeHtml(c)}"></option>`).join('');
    renderReadyPreview();
    openModal('readyModal');
    $('rd_name').focus();
}

function renderReadyPreview() {
    const text = readyMessage({ details: $('rd_details').value.trim(), terms: $('rd_terms').value.trim() });
    $('rd_preview').textContent = text || 'اكتب الحساب فوق وبيطلع هون زي ما بيوصل للزبون';
    $('rd_preview').classList.toggle('text-slate-400', !text);
}

async function saveReady(e) {
    e.preventDefault();
    const id = $('rd_id').value;
    const name = $('rd_name').value.trim();
    const details = $('rd_details').value.replace(/\r\n?/g, '\n').trim();
    if (!name) { $('rd_name').focus(); return showToast('تنبيه', 'اكتب اسم للحساب، مثلاً "حساب سعودي"', 'warning'); }
    if (!details) { $('rd_details').focus(); return showToast('تنبيه', 'اكتب تفاصيل الحساب اللي بتنبعت للزبون', 'warning'); }
    const same = readyAccounts.find(x => x.id !== id && normName(x.name) === normName(name));
    if (same) { $('rd_name').focus(); return showToast('الاسم موجود', `في حساب جاهز اسمه "${same.name}". زيد إشي بيميّزه (اسم البنك مثلاً)`, 'warning'); }
    const old = readyAccounts.find(x => x.id === id);
    const item = old || normalizeReady({ id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), createdAt: localDateStr(), createdBy: session?.username || '' });
    Object.assign(item, {
        name,
        category: $('rd_category').value.trim(),
        details,
        terms: $('rd_terms').value.replace(/\r\n?/g, '\n').trim(),
        paused: $('rd_paused').checked
    });
    if (!old) readyAccounts.push(item);
    queueOps({ action: 'upsert_ready', ready: readyPayload(item) });
    closeModal('readyModal');
    renderReadyPage();
    const status = await flushOutbox();
    showToast(old ? 'تم تعديل الحساب' : 'انضاف الحساب', `${item.name} — ${syncResultMessage(status)}`, syncToastType(status));
}

function toggleReadyPaused(id) {
    const x = readyAccounts.find(y => y.id === id);
    if (!x) return;
    x.paused = !x.paused;
    queueOps({ action: 'upsert_ready', ready: readyPayload(x) });
    renderReadyPage();
    flushOutbox();
    showToast(x.paused ? 'انوقف مؤقتاً' : 'رجع يشتغل', x.paused ? `${x.name}: النسخ والإرسال مسكّرين لحد ما ترجّعه` : x.name, 'info');
}

function deleteReadyPrompt(id) {
    const x = readyAccounts.find(y => y.id === id);
    if (!x) return;
    showAppConfirm('حذف الحساب الجاهز', `بدك تحذف "${x.name}"؟ (بيضل بسجل المحذوفات وبتقدر ترجّعه)`, async () => {
        readyAccounts = readyAccounts.filter(y => y.id !== id);
        queueOps({ action: 'delete_ready', id });
        renderReadyPage();
        const status = await flushOutbox();
        showToast('انحذف', `${x.name} — ${syncResultMessage(status)}`, syncToastType(status));
    });
}

function setReadySort(v) {
    globalConfig.readySort = READY_SORTS.includes(v) ? v : 'used';
    saveAll();
    renderReadyPage();
}

function bindReadyEvents() {
    $('ready_search').addEventListener('input', renderReadyPage);
    $('ready_sort').addEventListener('change', () => setReadySort($('ready_sort').value));
    $('readyForm').addEventListener('submit', saveReady);
    ['rd_details', 'rd_terms'].forEach(i => $(i).addEventListener('input', renderReadyPreview));
    ['input', 'focus', 'click'].forEach(ev => $('rs_customer').addEventListener(ev, onReadyCustomerInput));
    $('rs_customer').addEventListener('keydown', onReadyCustomerKey);
    $('rs_phone').addEventListener('input', () => {
        // رقم ثاني غير رقم الزبون المختار: بيبطل مربوط فيه
        const c = customers.find(x => x.id === $('rs_customer_id').value);
        if (c && whatsappDigits(c.phone) !== whatsappDigits($('rs_phone').value)) $('rs_phone_hint').textContent = 'رقم غير المحفوظ للزبون (لهالمرة بس)';
    });
}
