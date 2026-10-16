'use strict';

// فاست باي — الفاتورة وكشف التاجر (PNG و PDF)، والمشاركة على واتساب
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= الفاتورة (عرض + تحميل PDF و PNG) =================
// المكتبات تُحمَّل عند أول تحميل فقط حتى تبقى الصفحة خفيفة
// html-to-image يرسم بمحرك المتصفح نفسه، فلا ينزاح النص العربي عن مكانه (مشكلة html2canvas)
const RECEIPT_LIBS = {
    htmlToImage: 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
};
const loadedScripts = {};

function loadScript(url) {
    return loadedScripts[url] ??= new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = url;
        el.onload = resolve;
        el.onerror = () => {
            delete loadedScripts[url];
            el.remove();
            reject(new Error('script load failed: ' + url));
        };
        document.head.appendChild(el);
    });
}

// خطوط الصفحة (Cairo و IBM Plex) مضمّنة في الصورة، وإلا بتطلع بخط النظام.
// كبيرة، فنحسبها مرة وحدة ونخلي بس الحروف العربية واللاتينية الأساسية
let receiptFontCSS = '';
async function receiptFontEmbedCSS(el) {
    if (receiptFontCSS) return receiptFontCSS;
    try {
        const css = await window.htmlToImage.getFontEmbedCSS(el);
        const faces = css.match(/@font-face\s*{[^}]*}/g) || [];
        // العربي (U+600-6FF) واللاتيني الأساسي (U+0-FF)، بأي صيغة كتابة للمدى
        const needed = faces.filter(f => /unicode-range:\s*U\+0*(600-0*6FF|0-0*FF)\b/i.test(f));
        receiptFontCSS = (needed.length ? needed : faces).join('\n');
    } catch (e) {
        console.warn('Could not embed fonts:', e);
    }
    return receiptFontCSS;
}

// يحوّل عنصراً إلى canvas، والعناصر التي عليها data-export-ignore لا تظهر في الصورة
async function captureElement(el, pixelRatio) {
    await loadScript(RECEIPT_LIBS.htmlToImage);
    if (document.fonts?.ready) await document.fonts.ready;
    const fontEmbedCSS = await receiptFontEmbedCSS(el);
    // الهامش الخارجي للعنصر (مثل space-y) يزيح المحتوى داخل الصورة فيُقص أسفلها، لذلك نلغيه ونثبّت المقاس
    const opts = {
        pixelRatio, backgroundColor: '#ffffff',
        // صورة لا يمكن قراءتها لا توقف الفاتورة كلها
        imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
        width: el.offsetWidth, height: el.offsetHeight,
        style: { margin: '0', animation: 'none', transform: 'none' },
        filter: (n) => !n.dataset?.exportIgnore,
        ...(fontEmbedCSS ? { fontEmbedCSS } : {})
    };
    // سفاري لا يرسم الخطوط والصور في المحاولة الأولى أحياناً، فنسخّنه بمحاولة مسبقة
    if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) await window.htmlToImage.toCanvas(el, opts);
    return window.htmlToImage.toCanvas(el, opts);
}

// format: png | pdf — صفحة الـ PDF بنفس مقاس العنصر على الشاشة
async function exportElement(el, format, filename, pixelRatio = 3) {
    const canvas = await captureElement(el, pixelRatio);
    const safeName = filename.replace(/[\\/:*?"<>|]/g, '');
    if (format === 'pdf') {
        await loadScript(RECEIPT_LIBS.jspdf);
        const w = canvas.width / pixelRatio * 0.75, h = canvas.height / pixelRatio * 0.75;
        const pdf = new window.jspdf.jsPDF({ orientation: w > h ? 'l' : 'p', unit: 'pt', format: [w, h], compress: true });
        pdf.addImage(canvas, 'PNG', 0, 0, w, h);
        downloadBlob(pdf.output('blob'), 'application/pdf', safeName + '.pdf');
    } else {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        downloadBlob(blob, 'image/png', safeName + '.png');
    }
}

const RECEIPT_STATUS_STYLE = {
    'مكتمل': 'background:#d1fae5;color:#047857',
    'قيد الإنتظار': 'background:#fef3c7;color:#b45309',
    'جزئي': 'background:#e0f2fe;color:#0369a1',
    'غير مدفوعة': 'background:#fef3c7;color:#b45309',
    'مدفوعة': 'background:#d1fae5;color:#047857',
    'فحص': 'background:#e2e8f0;color:#334155',
    'ملغي': 'background:#ffe4e6;color:#be123c'
};

// الفاتورة المفتوحة: حوالة أو حركة USDT أو جنيه
let receiptCtx = null; // { kind: 'tx' | 'usdt' | 'egp', id }

const statusPill = (label, style) => `<span class="rc-status" style="${style || ''}">${escapeHtml(label)}</span>`;
const ltr = (v) => `<bdi class="ltr-num">${v}</bdi>`;

// لون وأيقونة الحالة بأعلى الفاتورة
const RECEIPT_TONE = {
    'مكتمل': 'ok', 'مدفوعة': 'ok',
    'قيد الإنتظار': 'wait', 'غير مدفوعة': 'wait',
    'جزئي': 'part', 'ملغي': 'bad', 'فحص': 'info'
};
const RECEIPT_ICONS = {
    ok: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    wait: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    part: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" stroke="none"/>',
    bad: '<path d="M7 7l10 10M17 7L7 17"/>',
    info: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'
};

// قالب واحد لكل الفواتير. status: اسم الحالة (أو فاضي)، party: { label, name } الزبون تحت المبلغ
function receiptHtml({ title, no, dateLabel, date, amountLabel, amount, rows, status, party }) {
    const now = new Date();
    const issued = `${localDateStr(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const tone = RECEIPT_TONE[status] || 'info';
    return `
        <div class="rc-top">
            <div class="rc-brand">
                <div class="rc-logo">${logoHtml()}</div>
                <div class="min-w-0">
                    <div class="rc-company">${escapeHtml(globalConfig.companyName || 'فاست باي')}</div>
                    ${globalConfig.companySubtitle ? `<div class="rc-sub">${escapeHtml(globalConfig.companySubtitle)}</div>` : ''}
                </div>
            </div>
            <div class="rc-doc">${title}</div>
        </div>
        <div class="rc-hero rc-tone-${tone}">
            <div class="rc-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${RECEIPT_ICONS[tone]}</svg></div>
            <div class="rc-amount-label">${amountLabel}</div>
            <div class="rc-amount-value">${amount}</div>
            ${party?.name ? `<div class="rc-party">${party.label} <b>${escapeHtml(party.name)}</b></div>` : ''}
            ${status ? statusPill(status, RECEIPT_STATUS_STYLE[status]) : ''}
        </div>
        <div class="rc-details">
            ${rows.map(([label, value]) => `<div class="rc-row"><span>${label}</span><span>${value}</span></div>`).join('')}
        </div>
        <div class="rc-meta">
            <div><span>${dateLabel}</span><b>${ltr(escapeHtml(date))}</b></div>
            <div><span>رقم الإيصال</span><b>${ltr(escapeHtml(no))}</b></div>
        </div>
        <div class="rc-foot">
            ${globalConfig.receiptFooter ? `<div class="rc-thanks">${escapeHtml(globalConfig.receiptFooter)}</div>` : ''}
            <div class="rc-issued">أُصدرت: ${ltr(escapeHtml(issued))}</div>
        </div>
        <div class="rc-bar"></div>`;
}

const showRate = () => globalConfig.receiptShowRate !== false;

function renderReceipt(t) {
    const amount = t.currency === 'USD' ? `$ ${fmt(t.clientUsd)}` : `${fmt(t.clientIls)} ₪`;
    const rows = [['طريقة الاستلام', escapeHtml(payoutLabel(t))]];
    if (t.payout !== 'كاش' && t.account) rows.push([t.payout === 'بنكي' ? 'رقم الحساب' : 'رقم المحفظة', ltr(escapeHtml(t.account))]);
    rows.push(['مصدر الحوالة', escapeHtml(t.country)]);
    rows.push(['المبلغ المرسل', ltr(fmt(t.orig))]);
    if (t.currency !== 'USD' && showRate()) rows.push(['سعر الدولار', `${ltr(fmt(t.screenRate, 3))} ₪`]);
    rows.push(['عملة التسليم', t.currency === 'USD' ? 'دولار أمريكي' : 'شيكل']);
    if (t.status === 'جزئي') {
        const paid = txPaid(t);
        rows.push(['المدفوع', moneyCur(paid, t.currency)]);
        rows.push(['الباقي', moneyCur(Math.max(0, txDue(t) - paid), t.currency)]);
    }
    $('receipt-paper').innerHTML = receiptHtml({
        title: 'إيصال تسليم حوالة', no: receiptNo(t), dateLabel: 'تاريخ الحوالة', date: t.date,
        amountLabel: 'المبلغ المسلّم للزبون', amount, rows,
        status: t.status, party: { label: 'إلى', name: t.recipient }
    });
}

function renderUsdtReceipt(m) {
    const cur = m.currency;
    const st = usdtPayState(m);
    const deposit = m.kind === 'deposit';
    const rows = [[deposit ? 'المبلغ المطلوب USDT' : 'المبلغ المستلم USDT', `${ltr(fmt(m.amount))} USDT`]];
    if (deposit && m.network) rows.push(['الشبكة', `${escapeHtml(m.network)} · رسوم ${ltr(fmt(m.networkFee))} $`]);
    if (m.pct) rows.push(['العمولة', `${ltr(m.pct + '%')} (${ltr(fmt(m.amount * m.pct / 100))} $)`]);
    if (cur === 'ILS' && showRate()) rows.push(['سعر الدولار', `${ltr(fmt(m.rate, 3))} ₪`]);
    if (m.discount) rows.push(['خصم', `− ${moneyCur(m.discount, cur)}`]);
    if (m.address) rows.push(['عنوان المحفظة', `<bdi class="ltr-num" style="font-size:0.65rem;word-break:break-all;white-space:normal">${escapeHtml(m.address)}</bdi>`]);
    rows.push(['عملة الدفع', cur === 'USD' ? 'دولار' : 'شيكل']);
    if (st.state === 'partial') {
        rows.push(['المدفوع', moneyCur(st.paid, cur)]);
        rows.push(['الباقي', moneyCur(st.remaining, cur)]);
    }
    $('receipt-paper').innerHTML = receiptHtml({
        title: deposit ? 'فاتورة إيداع USDT' : 'إيصال سحب USDT', no: receiptNo(m), dateLabel: 'التاريخ', date: m.date,
        amountLabel: deposit ? 'المبلغ المطلوب من الزبون' : 'المبلغ المسلّم للزبون',
        amount: cur === 'USD' ? `$ ${fmt(m.total - m.settle)}` : `${fmt(m.total - m.settle)} ₪`, rows,
        status: PAY_STATE[st.state].label, party: { label: 'الزبون:', name: m.customerName }
    });
}

// إيصال إرسال/استلام جنيه: المبلغ بالجنيه، المحفظة والرقم، وسعر الألف
function renderEgpReceipt(m) {
    const cur = m.currency;
    const st = egpPayState(m);
    const send = m.kind === 'send';
    const w = egpWallets.find(x => x.id === m.walletId);
    const rows = [[send ? 'المبلغ المرسل' : 'المبلغ المستلم', `${ltr(fmtEgp(m.egp))} جنيه`]];
    rows.push([send ? 'عن طريق' : 'وصل على', escapeHtml(EGP_WALLET_TYPES[w?.walletType || 'other'].label)]);
    if (m.party || m.partyNumber) rows.push([send ? 'المستلم' : 'المرسل', [escapeHtml(m.party), m.partyNumber ? ltr(escapeHtml(m.partyNumber)) : ''].filter(Boolean).join(' · ')]);
    if (showRate()) rows.push(['سعر الألف جنيه', `${ltr(fmt(egpPerThousand(m.rate, m.usdRate, cur)))} ${CUR_SYM[cur]}`]);
    rows.push(['عملة الدفع', cur === 'USD' ? 'دولار' : 'شيكل']);
    if (st && st.state === 'partial') {
        rows.push(['المدفوع', moneyCur(st.paid, cur)]);
        rows.push(['الباقي', moneyCur(st.remaining, cur)]);
    }
    $('receipt-paper').innerHTML = receiptHtml({
        title: send ? 'إيصال إرسال جنيه' : 'إيصال استلام جنيه', no: receiptNo(m), dateLabel: 'التاريخ', date: m.date,
        amountLabel: send ? 'المبلغ المطلوب من الزبون' : 'المبلغ المسلّم للزبون',
        amount: cur === 'USD' ? `$ ${fmt(m.total - m.settle)}` : `${fmt(m.total - m.settle)} ₪`, rows,
        status: st ? PAY_STATE[st.state].label : '', party: { label: 'الزبون:', name: m.customerName }
    });
}

function renderCurrentReceipt() {
    if (receiptCtx?.kind === 'egp') {
        const m = egpMoves.find(x => x.id === receiptCtx.id);
        if (m) renderEgpReceipt(m);
    } else if (receiptCtx?.kind === 'usdt') {
        const m = usdtMoves.find(x => x.id === receiptCtx.id);
        if (m) renderUsdtReceipt(m);
    } else {
        const t = ledger.find(x => x.id === receiptCtx?.id);
        if (t) renderReceipt(t);
    }
}

function toggleReceiptRate() {
    globalConfig.receiptShowRate = globalConfig.receiptShowRate === false;
    saveAll();
    updateReceiptRateToggle();
    renderCurrentReceipt();
    const target = receiptShareTarget();
    if (target) prepareShareImage(target.key, $('receipt-paper'));
}

function updateReceiptRateToggle() {
    const on = globalConfig.receiptShowRate !== false;
    $('receipt-rate-toggle').classList.toggle('on', on);
    $('receipt-rate-toggle').setAttribute('aria-pressed', String(on));
}

function openReceipt(id) {
    const t = ledger.find(x => x.id === id);
    if (!t) return showToast('الحوالة غير موجودة', '', 'warning');
    receiptCtx = { kind: 'tx', id };
    updateReceiptRateToggle();
    renderReceipt(t);
    openModal('receiptModal');
    prepareShareImage('tx:' + id, $('receipt-paper'));
}

function openUsdtReceipt(id) {
    const m = usdtMoves.find(x => x.id === id);
    if (!m) return;
    receiptCtx = { kind: 'usdt', id };
    updateReceiptRateToggle();
    renderUsdtReceipt(m);
    openModal('receiptModal');
    prepareShareImage('usdt:' + id, $('receipt-paper'));
}

function openEgpReceipt(id) {
    const m = egpMoves.find(x => x.id === id);
    if (!m || (m.kind !== 'send' && m.kind !== 'receive')) return;
    receiptCtx = { kind: 'egp', id };
    updateReceiptRateToggle();
    renderEgpReceipt(m);
    openModal('receiptModal');
    prepareShareImage('egp:' + id, $('receipt-paper'));
}

async function exportReceipt(format) {
    const filename = receiptShareTarget()?.filename;
    if (!filename) return;
    const buttons = document.querySelectorAll('[data-action^="receipt-"]');
    buttons.forEach(b => { b.disabled = true; });
    try {
        await exportElement($('receipt-paper'), format, filename);
        showToast('تم تحميل الفاتورة', format === 'pdf' ? 'ملف PDF' : 'صورة PNG', 'info');
    } catch (err) {
        console.error('Receipt export failed:', err);
        showToast('تعذر إنشاء الفاتورة', 'تأكد من الاتصال بالإنترنت ثم حاول مجدداً', 'error');
    } finally {
        buttons.forEach(b => { b.disabled = false; });
    }
}

// ================= مشاركة الفاتورة والكشف على واتساب =================
// واتساب لا يسمح بإرفاق صورة عبر رابط، فـ:
// - الجوال: نافذة المشاركة (تختار واتساب والصورة جاهزة).
// - الكمبيوتر: ننسخ الصورة لحظة الضغط (سفاري يرفض النسخ بعد أي انتظار)، ثم نافذة بخطوات واضحة: فتح واتساب ← لصق.
// الصورة تُجهَّز مسبقاً عند فتح الفاتورة حتى تكون جاهزة لحظة الضغط.
let shareCache = null; // { key, promise }

function prepareShareImage(key, el) {
    shareCache = {
        key,
        promise: captureElement(el, 3)
            .then(c => new Promise(resolve => c.toBlob(resolve, 'image/png')))
            .catch(err => { console.error('Share image failed:', err); return null; })
    };
}

const waUrl = (phone, text) => `https://wa.me/${phone ? whatsappDigits(phone) : ''}${text ? '?text=' + encodeURIComponent(text) : ''}`;
const isTouchDevice = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const isMac = () => /Mac/i.test(navigator.platform || navigator.userAgent);

// ليست async عمداً: النسخ للحافظة يجب أن يبدأ داخل نفس الضغطة
function shareToWhatsapp({ key, el, filename, phone, text }) {
    if (!shareCache || shareCache.key !== key) prepareShareImage(key, el);
    // إن فشل التجهيز المسبق (مثلاً كانت الفاتورة لسا تفتح) نحاول مرة ثانية
    const blobPromise = shareCache.promise.then(b => {
        if (b) return b;
        prepareShareImage(key, el);
        return shareCache.promise;
    });
    const safe = filename.replace(/[\\/:*?"<>|]/g, '');
    const target = { blobPromise, filename: safe, phone, text };
    if (isTouchDevice()) return shareOnPhone(target);
    openWaShareModal({ ...target, copy: copyImageNow(blobPromise) });
}

// نسخ الصورة للحافظة. يرجع true إذا نجح
function copyImageNow(blobPromise) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return Promise.resolve(false);
    try {
        const item = new ClipboardItem({ 'image/png': blobPromise.then(b => { if (!b) throw new Error('no image'); return b; }) });
        return navigator.clipboard.write([item]).then(() => true, () => false);
    } catch (e) {
        // متصفح لا يقبل صورة "قيد التجهيز": ننسخ بعد التجهيز (وإن رفض يظهر زر النسخ في النافذة)
        return blobPromise.then(b => (b ? navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).then(() => true, () => false) : false));
    }
}

async function shareOnPhone(target) {
    const blob = await target.blobPromise;
    if (!blob) return showToast('تعذر تجهيز الصورة', 'تأكد من الاتصال بالإنترنت ثم حاول مجدداً', 'error');
    const file = new File([blob], target.filename + '.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], text: target.text });
            return;
        } catch (e) {
            if (e.name === 'AbortError') return; // المستخدم أغلق نافذة المشاركة
        }
    }
    // المشاركة غير متاحة على هذا الجوال: نفس خطوات الكمبيوتر
    openWaShareModal({ ...target, blobPromise: Promise.resolve(blob), copy: Promise.resolve(false) });
}

// ---------- نافذة "إرسال على واتساب" (الكمبيوتر) ----------
let waShare = null; // { blob, url, filename, phone, text }

async function openWaShareModal({ blobPromise, copy, filename, phone, text }) {
    if (waShare?.url) URL.revokeObjectURL(waShare.url);
    waShare = { blob: null, url: '', filename, phone, text };
    $('wa-preview').removeAttribute('src');
    $('wa-preview-wrap').classList.add('loading');
    $('wa-copy-status').textContent = 'جاري تجهيز الصورة ونسخها...';
    $('wa-copy-status').className = 'wa-status';
    setWaCopyBtn('idle');
    $('wa-paste-key').textContent = isMac() ? '⌘ + V' : 'Ctrl + V';
    $('wa-open').textContent = phone ? 'فتح محادثة الزبون على واتساب' : 'فتح واتساب';
    $('wa-share-native').classList.add('hidden');
    openModal('waShareModal');
    const blob = await blobPromise;
    if (!blob) {
        closeModal('waShareModal');
        return showToast('تعذر تجهيز الصورة', 'تأكد من الاتصال بالإنترنت ثم حاول مجدداً', 'error');
    }
    waShare.blob = blob;
    waShare.url = URL.createObjectURL(blob);
    $('wa-preview').src = waShare.url;
    $('wa-preview-wrap').classList.remove('loading');
    // لا ننتظر النسخ للأبد (بعض المتصفحات تعلّقه إذا تغيّرت النافذة)
    setWaCopyStatus(await Promise.race([copy, new Promise(r => setTimeout(() => r(false), 6000))]));
    const file = new File([blob], filename + '.png', { type: 'image/png' });
    $('wa-share-native').classList.toggle('hidden', !navigator.canShare?.({ files: [file] }));
}

function setWaCopyStatus(ok) {
    $('wa-copy-status').textContent = ok
        ? '✓ الصورة منسوخة وجاهزة للصق'
        : 'المتصفح ما سمح بالنسخ التلقائي — اكبس "نسخ الصورة" تحت';
    $('wa-copy-status').className = 'wa-status ' + (ok ? 'ok' : 'warn');
    setWaCopyBtn(ok ? 'done' : 'idle');
}

// زر "نسخ الصورة": يصير "✓ تم النسخ" لثانيتين ثم يرجع
function setWaCopyBtn(state) {
    const btn = $('wa-copy-btn');
    clearTimeout(setWaCopyBtn.timer);
    btn.textContent = state === 'done' ? '✓ تم النسخ' : state === 'busy' ? 'جاري النسخ...' : 'نسخ الصورة';
    btn.classList.toggle('wa-copied', state === 'done');
    btn.disabled = state === 'busy';
    if (state === 'done') setWaCopyBtn.timer = setTimeout(() => setWaCopyBtn('idle'), 2000);
}

async function waCopyAgain() {
    if (!waShare?.blob) return;
    setWaCopyBtn('busy');
    const ok = await copyImageNow(Promise.resolve(waShare.blob));
    setWaCopyStatus(ok);
    if (!ok) showToast('المتصفح منع النسخ', 'اكبس "تنزيل الصورة" وأرفقها بالمحادثة', 'warning');
}

function waOpenChat() {
    // محادثة الزبون مباشرة (بدون نص حتى لا يُرسل الرقم لوحده)، وبدون رقم: واتساب يطلب اختيار المحادثة
    window.open(waUrl(waShare?.phone, waShare?.phone ? '' : waShare?.text), '_blank', 'noopener');
}

function waDownload() {
    if (waShare?.blob) downloadBlob(waShare.blob, 'image/png', waShare.filename + '.png');
}

async function waShareNative() {
    if (!waShare?.blob) return;
    try {
        await navigator.share({ files: [new File([waShare.blob], waShare.filename + '.png', { type: 'image/png' })] });
        closeModal('waShareModal');
    } catch (e) { /* أُغلقت نافذة المشاركة */ }
}

function receiptShareTarget() {
    if (receiptCtx?.kind === 'egp') {
        const m = egpMoves.find(x => x.id === receiptCtx.id);
        if (!m) return null;
        const c = customers.find(x => (m.customerId && x.id === m.customerId) || normName(x.name) === normName(m.customerName));
        return { key: 'egp:' + m.id, filename: `فاتورة_جنيه_${m.customerName}_${m.serial || m.id}`, phone: hasWhatsapp(c) ? c.phone : '', text: `${m.kind === 'send' ? 'إيصال إرسال' : 'إيصال استلام'} جنيه ${receiptNo(m)}` };
    }
    if (receiptCtx?.kind === 'usdt') {
        const m = usdtMoves.find(x => x.id === receiptCtx.id);
        if (!m) return null;
        const c = customers.find(x => (m.customerId && x.id === m.customerId) || normName(x.name) === normName(m.customerName));
        return { key: 'usdt:' + m.id, filename: `فاتورة_USDT_${m.customerName}_${m.serial || m.id}`, phone: hasWhatsapp(c) ? c.phone : '', text: `${m.kind === 'deposit' ? 'فاتورة إيداع' : 'إيصال سحب'} USDT ${receiptNo(m)}` };
    }
    const t = ledger.find(x => x.id === receiptCtx?.id);
    if (!t) return null;
    const c = customerOfTx(t);
    return { key: 'tx:' + t.id, filename: `فاتورة_${t.recipient}_${t.serial || t.id}`, phone: hasWhatsapp(c) ? c.phone : '', text: `إيصال تسليم حوالة ${receiptNo(t)}` };
}

function shareReceipt() {
    const target = receiptShareTarget();
    if (target) shareToWhatsapp({ ...target, el: $('receipt-paper') });
}

function shareStatement() {
    const t = traders.find(x => x.id === panelTraderId);
    if (!t) return;
    shareToWhatsapp({
        key: `st:${t.id}:${panelCurrency}:${panelPeriod}:${traderMoves.length}`,
        el: $('trader-statement'),
        filename: `كشف_${t.name}_${panelCurrency}_${localDateStr()}`,
        phone: hasWhatsapp(t) ? t.phone : '',
        text: `كشف حساب ${t.name} · ${TRADE_CURRENCIES[panelCurrency].name}`
    });
}
