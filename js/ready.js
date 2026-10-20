'use strict';

// فاست باي — الحسابات الجاهزة (بطلب عماد 2026-10-19)
// حسابات بنعطيها للزبائن (حساب سعودي مثلاً) مع شروطها: نسخ، أو إرسال على واتساب لزبون بتختاره، بكبسة.
// بالشيت (ورقة "الحسابات الجاهزة"). مرات النسخ والإرسال وآخر استعمال بيكتبها السكربت (use_ready)، والتعديل ما بيلمسها.
// صلاحية "الحسابات الجاهزة" (ready): القراءة والإضافة والتعديل والاستعمال، والحذف بصلاحية الحذف كمان.
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

let readyAccounts = [];
// مين انبعتله أي حساب (ورقة "إرسال الحسابات"، بيكتبها السكربت مع use_ready)، بتبين بالكرت وبملف الزبون
let readySends = [];
let readyFilter = 'all'; // all | paused (الموقوفة والمنتهية) | cat:<التصنيف>
let readySendId = null;
let readyPickerIndex = -1;
let readySendTouched = false; // عدّل الرسالة بإيده: اختيار الزبون ما بيكتب فوقها
let readyLastField = 'rd_details'; // وين بتنزل الكلمات ({الاسم}...) بنافذة الإضافة
let readyExpiryTimer = null;

const READY_SORTS = ['used', 'recent', 'newest', 'name'];

function normalizeReady(r) {
    return {
        id: String(r?.id ?? '').trim(),
        name: String(r?.name ?? '').trim(),
        category: String(r?.category ?? '').trim(),
        details: String(r?.details ?? '').replace(/\r\n?/g, '\n').trim(),
        terms: String(r?.terms ?? '').replace(/\r\n?/g, '\n').trim(),
        paused: r?.paused === 'yes' || r?.paused === true,
        expiresAt: String(r?.expiresAt ?? '').trim(),
        copies: Math.max(0, Math.round(toNum(r?.copies, 0))),
        sends: Math.max(0, Math.round(toNum(r?.sends, 0))),
        lastUsedAt: String(r?.lastUsedAt ?? '').trim(),
        lastUsedBy: String(r?.lastUsedBy ?? '').trim(),
        createdAt: String(r?.createdAt ?? '').slice(0, 10),
        createdBy: String(r?.createdBy ?? '').trim()
    };
}

function normalizeReadySend(r) {
    return {
        id: String(r?.id ?? '').trim(),
        at: String(r?.at ?? '').trim(),
        readyId: String(r?.readyId ?? '').trim(),
        readyName: String(r?.readyName ?? '').trim(),
        customerId: String(r?.customerId ?? '').trim(),
        customerName: String(r?.customerName ?? '').trim(),
        createdBy: String(r?.createdBy ?? '').trim()
    };
}

// للشيت: المحتوى بس (العدادات للسكربت)
const readyPayload = (x) => ({ id: x.id, name: x.name, category: x.category, details: x.details, terms: x.terms, paused: x.paused ? 'yes' : 'no', expiresAt: x.expiresAt || '', createdAt: x.createdAt });

// ---------- كلمات بتتعبّى لحالها بالرسالة (بطلب عماد 2026-10-19) ----------
// {الاسم} = اسم الزبون (بالنسخ بدون زبون بتنشال)، و{التاريخ}. الأسعار انشالت بقراره (2026-10-20): السعر بيتغير وبيختلف
// حسب الشريحة والمبلغ، فرقم بالرسالة كان يطلع غير الفاتورة؛ الأسعار من الحاسبة وصفحتي USDT والجنيه
const READY_TOKENS = [
    ['الاسم', 'اسم الزبون'],
    ['التاريخ', 'تاريخ اليوم']
];

function readyTokenValues() {
    const d = localDateStr().split('-');
    return { 'التاريخ': `${d[2]}/${d[1]}/${d[0]}` };
}

// name: اسم الزبون، أو '' (بتنشال)، أو null (بتضل علامة، للعرض بالكرت)
function fillReady(text, name) {
    const vals = readyTokenValues();
    let out = String(text || '').replace(/\{([^{}\n]{2,20})\}/g, (m, key) => {
        if (key === 'الاسم') return name === null ? '\u0001' : name;
        return key in vals ? vals[key] : m;
    });
    // اسم فاضي: بدون مسافات زيادة ("مرحبا ،" ← "مرحبا،")
    if (!name) out = out.replace(/[ \t]{2,}/g, ' ').replace(/ +([،,.!؟?:])/g, '$1').replace(/[ \t]+$/gm, '');
    return out;
}

// اللي بيوصل للزبون: الحساب، وتحته الشروط
const readyMessage = (x, name = '') => [fillReady(x.details, name), x.terms ? 'الشروط:\n' + fillReady(x.terms, name) : ''].filter(Boolean).join('\n\n');

// للكرت: القيم معبّاية، ومكان الاسم علامة صغيرة
const readyShownHtml = (text) => escapeHtml(fillReady(text, null)).replace(/\u0001/g, '<mark class="ready-token">اسم الزبون</mark>');

// ---------- الانتهاء (حساب فعّال 24 ساعة مثلاً): بعده بيتوقف لحاله ----------
const readyExpiryMs = (x) => { const t = x.expiresAt ? Date.parse(x.expiresAt) : NaN; return Number.isFinite(t) ? t : 0; };
const readyExpired = (x) => { const t = readyExpiryMs(x); return !!t && t <= Date.now(); };
const readyStopped = (x) => x.paused || readyExpired(x);

// "بعد 5 ساعات" / "بعد يومين"
function untilText(ms) {
    const min = Math.max(1, Math.round((ms - Date.now()) / 60000));
    if (min < 60) return `بعد ${min === 1 ? 'دقيقة' : min === 2 ? 'دقيقتين' : min + ' دقيقة'}`;
    const h = Math.round(min / 60);
    if (h < 24) return `بعد ${h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : h + ' ساعات'}`;
    const days = Math.round(h / 24);
    return `بعد ${days === 1 ? 'يوم' : days === 2 ? 'يومين' : days + ' أيام'}`;
}

// "yyyy-MM-ddTHH:mm" بوقت الجهاز (قيمة خانة datetime-local)
function localStampAfter(hours) {
    const d = new Date(Date.now() + hours * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    return `${localDateStr(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// لما حساب يخلص والصفحة مفتوحة: بترجع تنرسم لحالها
function scheduleReadyExpiry() {
    clearTimeout(readyExpiryTimer);
    const next = readyAccounts.map(readyExpiryMs).filter(t => t > Date.now()).sort((a, b) => a - b)[0];
    if (next) readyExpiryTimer = setTimeout(renderReadyPage, Math.min(next - Date.now() + 500, 3600000));
}

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
    // الموقوفة والمنتهية آخر إشي
    return [...list].sort((a, b) => (readyStopped(a) - readyStopped(b)) || cmp(a, b) || a.name.localeCompare(b.name, 'ar'));
}

function renderReadyPage() {
    if (pageHidden('ready')) return;
    const supported = sheetHas('ready');
    $('ready-old-script').classList.toggle('hidden', supported || dataState !== 'ready');
    $('ready-new-btn').disabled = !supported;
    if (READY_SORTS.includes(globalConfig.readySort)) $('ready_sort').value = globalConfig.readySort;

    // الفلاتر: الكل، كل تصنيف، والموقوفة
    const cats = readyCategories();
    const pausedCount = readyAccounts.filter(readyStopped).length;
    scheduleReadyExpiry();
    if (readyFilter.startsWith('cat:') && !cats.some(([c]) => 'cat:' + c === readyFilter)) readyFilter = 'all';
    if (readyFilter === 'paused' && !pausedCount) readyFilter = 'all';
    const chip = (key, label, n) => `<button type="button" data-action="ready-filter" data-filter="${escapeHtml(key)}" class="tf-chip${readyFilter === key ? ' active' : ''}">${escapeHtml(label)} <b class="num">${n}</b></button>`;
    $('ready-filters').innerHTML = (readyAccounts.length ? chip('all', 'الكل', readyAccounts.length) : '')
        + cats.map(([c, n]) => chip('cat:' + c, c, n)).join('')
        + (pausedCount ? chip('paused', 'موقوفة ومنتهية', pausedCount) : '');
    $('ready-filters').classList.toggle('hidden', readyAccounts.length < 2 && !cats.length);

    const q = normName(latinDigits($('ready_search').value));
    const qDigits = normPhone($('ready_search').value).replace(/\D/g, '');
    const list = sortedReady(readyAccounts.filter(x =>
        (readyFilter === 'all' || (readyFilter === 'paused' ? readyStopped(x) : 'cat:' + x.category === readyFilter)) && readyMatches(x, q, qDigits)));

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
    const last = readySends.filter(s => s.readyId === x.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (last) parts.push(`<span title="${escapeHtml(last.at)}">آخر إرسال لـ ${escapeHtml(last.customerName)}</span>`);
    return parts.length ? parts.join('<i aria-hidden="true">·</i>') : '<span>لسا ما انستعمل</span>';
}

function readyCardHtml(x) {
    const id = escapeHtml(x.id);
    const added = x.createdAt ? x.createdAt.split('-').reverse().join('/') : '';
    const expired = readyExpired(x);
    const stopped = readyStopped(x);
    const exp = readyExpiryMs(x);
    const stopTitle = expired ? ' disabled title="الحساب انتهى"' : x.paused ? ' disabled title="الحساب موقوف"' : '';
    return `
        <article class="ready-card${stopped ? ' is-paused' : ''}" data-id="${id}">
            <header class="ready-head">
                ${readyIcon(x)}
                <div class="min-w-0 flex-1">
                    <h3 class="ready-name">${escapeHtml(x.name)}</h3>
                    <div class="ready-meta">
                        ${x.category ? `<span class="ready-cat">${escapeHtml(x.category)}</span>` : ''}
                        ${x.paused ? '<span class="ready-paused">⏸ موقوف</span>' : ''}
                        ${expired ? '<span class="ready-expired">⌛ انتهى</span>' : exp ? `<span class="ready-expiry" title="${escapeHtml(x.expiresAt.replace('T', ' '))}">⏳ بينتهي ${escapeHtml(untilText(exp))}</span>` : ''}
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
                <pre class="ready-text" dir="auto">${readyShownHtml(x.details)}</pre>
                <button type="button" data-action="ready-copy" data-id="${id}" data-part="details" class="copy-btn ready-copy-mini" title="نسخ الحساب بس (بدون الشروط)" aria-label="نسخ الحساب بس">${COPY_ICON}</button>
            </div>
            ${x.terms ? `<div class="ready-terms"><span class="ready-terms-label">الشروط</span><p dir="auto">${readyShownHtml(x.terms)}</p></div>` : ''}
            ${expired && !x.paused ? `<button type="button" data-action="edit-ready-renew" data-id="${id}" class="ready-renew">⌛ انتهى · جدّده 24 ساعة</button>` : `
            <div class="ready-actions">
                <button type="button" data-action="ready-copy" data-id="${id}" class="ready-btn ready-btn-copy"${stopTitle}>${COPY_ICON}<span>نسخ${x.terms ? ' مع الشروط' : ''}</span></button>
                <button type="button" data-action="ready-send" data-id="${id}" class="ready-btn ready-btn-wa"${stopTitle}>${WA_ICON}<span>إرسال لزبون</span></button>
            </div>`}
            <footer class="ready-foot">
                <div class="ready-usage">${readyUsageHtml(x)}</div>
                ${added ? `<span class="ready-added">أُضيف <bdi class="num">${added}</bdi>${x.createdBy ? ' · ' + escapeHtml(personName(x.createdBy)) : ''}</span>` : ''}
            </footer>
        </article>`;
}

// ---------- النسخ والإرسال (بيتعدّوا بالشيت) ----------
// log: {customerId, customerName, phone} للإرسال لزبون (بينكتب بملفه)
function recordReadyUse(x, kind, log = null) {
    x[kind === 'send' ? 'sends' : 'copies'] += 1;
    x.lastUsedAt = readyStamp();
    x.lastUsedBy = session?.username || '';
    if (sheetHas('ready')) {
        const op = { action: 'use_ready', id: x.id, kind, at: x.lastUsedAt };
        if (log && sheetHas('readyExtra')) {
            op.log = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...log };
            readySends.push(normalizeReadySend({ ...op.log, at: x.lastUsedAt, readyId: x.id, readyName: x.name, createdBy: x.lastUsedBy }));
        }
        queueOps(op);
        flushOutbox();
    }
    renderReadyPage();
}

async function copyReady(btn) {
    const x = readyAccounts.find(y => y.id === btn.dataset.id);
    if (!x) return;
    if (readyStopped(x)) return showToast(readyExpired(x) ? 'الحساب انتهى' : 'الحساب موقوف', 'جدّده أو رجّعه يشتغل أول', 'warning');
    const onlyDetails = btn.dataset.part === 'details';
    const ok = await copyText(onlyDetails ? fillReady(x.details, '') : readyMessage(x));
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
    if (readyStopped(x)) return showToast(readyExpired(x) ? 'الحساب انتهى' : 'الحساب موقوف', 'جدّده أو رجّعه يشتغل أول', 'warning');
    readySendId = id;
    readySendTouched = false;
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
    refillReadyMessage();
}

// الرسالة بالاسم ({الاسم}) لحد ما يعدّلها بإيده
function refillReadyMessage() {
    const x = readyAccounts.find(y => y.id === readySendId);
    if (x && !readySendTouched) $('rs_message').value = readyMessage(x, $('rs_customer').value.trim());
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
    refillReadyMessage();
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
    const who = $('rs_customer').value.trim();
    const customerId = $('rs_customer_id').value;
    // بملف الزبون: مين انبعتله شو (بس لما في زبون)
    recordReadyUse(x, 'send', !toAnyone && (who || customerId) ? { customerId, customerName: who, phone: whatsappDigits(phone) } : null);
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
    $('rd_expires').value = x?.expiresAt ? x.expiresAt.slice(0, 16) : '';
    $('rd_expires_wrap').classList.toggle('hidden', !sheetHas('readyExtra'));
    readyLastField = 'rd_details';
    $('rd_categories').innerHTML = readyCategories().map(([c]) => `<option value="${escapeHtml(c)}"></option>`).join('');
    renderReadyPreview();
    openModal('readyModal');
    $('rd_name').focus();
}

// الكلمة ({الاسم}...) بتنزل بمكان المؤشر بآخر خانة كنت فيها (الحساب أو الشروط)
function insertReadyToken(token) {
    const el = $(readyLastField) || $('rd_details');
    const t = '{' + token + '}';
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + t + el.value.slice(end);
    el.focus();
    el.setSelectionRange(start + t.length, start + t.length);
    renderReadyPreview();
}

function setReadyExpiry(hours) {
    $('rd_expires').value = hours ? localStampAfter(hours) : '';
}

function renderReadyPreview() {
    const text = readyMessage({ details: $('rd_details').value.trim(), terms: $('rd_terms').value.trim() }, '«الاسم»');
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
        paused: $('rd_paused').checked,
        expiresAt: sheetHas('readyExtra') ? $('rd_expires').value : item.expiresAt
    });
    if (!old) readyAccounts.push(item);
    queueOps({ action: 'upsert_ready', ready: readyPayload(item) });
    closeModal('readyModal');
    renderReadyPage();
    const status = await flushOutbox();
    showToast(old ? 'تم تعديل الحساب' : 'انضاف الحساب', `${item.name} — ${syncResultMessage(status)}`, syncToastType(status));
}

function renewReady(id) {
    const x = readyAccounts.find(y => y.id === id);
    if (!x) return;
    x.expiresAt = localStampAfter(24);
    queueOps({ action: 'upsert_ready', ready: readyPayload(x) });
    renderReadyPage();
    flushOutbox();
    showToast('تجدّد 24 ساعة', `${x.name}: بينتهي ${x.expiresAt.slice(11)} بكرا`, 'success');
}

// ملف الزبون: الحسابات اللي انبعتتله
function customerReadySendsHtml(c) {
    const list = readySends.filter(s => (c.id && s.customerId === c.id) || (!s.customerId && normName(s.customerName) === normName(c.name)))
        .sort((a, b) => b.at.localeCompare(a.at));
    if (!list.length) return '';
    return `<div class="bg-slate-50 border border-slate-200/80 rounded-xl p-4">
        <h4 class="text-xs font-bold text-slate-800 mb-2">📋 حسابات انبعتتله</h4>
        ${list.slice(0, 8).map(s => `<div class="flex justify-between gap-3 text-xs py-1.5 border-t border-slate-200/70 first:border-0">
            <b class="text-slate-700 min-w-0 truncate">${escapeHtml(s.readyName)}</b>
            <span class="text-slate-400 shrink-0">${escapeHtml(agoText(readyStampMs(s.at)))}${s.createdBy ? ' · ' + escapeHtml(personName(s.createdBy)) : ''}</span>
        </div>`).join('')}
    </div>`;
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
    ['rd_details', 'rd_terms'].forEach(i => {
        $(i).addEventListener('input', renderReadyPreview);
        $(i).addEventListener('focus', () => { readyLastField = i; });
    });
    $('rs_message').addEventListener('input', () => { readySendTouched = true; });
    ['input', 'focus', 'click'].forEach(ev => $('rs_customer').addEventListener(ev, onReadyCustomerInput));
    $('rs_customer').addEventListener('keydown', onReadyCustomerKey);
    $('rs_phone').addEventListener('input', () => {
        // رقم ثاني غير رقم الزبون المختار: بيبطل مربوط فيه
        const c = customers.find(x => x.id === $('rs_customer_id').value);
        if (c && whatsappDigits(c.phone) !== whatsappDigits($('rs_phone').value)) $('rs_phone_hint').textContent = 'رقم غير المحفوظ للزبون (لهالمرة بس)';
    });
}
