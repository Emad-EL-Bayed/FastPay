'use strict';

// فاست باي — التجار: الحساب الجاري وكشف الحساب
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= التجار (حساب جارٍ بين تاجر وتاجر) =================
// الرصيد الموجب = لنا عنده، والسالب = له عندنا. لكل عملة رصيد مستقل.
const TRADE_CURRENCIES = {
    USD: { sym: '$', name: 'دولار' },
    EUR: { sym: '€', name: 'يورو' },
    JOD: { sym: 'د.أ', name: 'دينار' },
    ILS: { sym: '₪', name: 'شيكل' }
};

// sign: اتجاه الأثر على الرصيد (+ لنا عنده، - له عندنا)، feeOp: العمولة تُخصم (-1) أو تُضاف (+1)
// النسبة تبدأ دائماً من صفر وتُكتب يدوياً لكل حركة، وتُخصم من مبلغ الحركة
// legacy: أنواع قديمة تبقى لقراءة الحركات السابقة فقط ولا تظهر كأزرار
// settle: التصفير، واتجاهه (he_paid / i_paid) يُحدَّد تلقائياً حسب الرصيد
const TMOVE_KINDS = {
    for_us: { label: 'لنا', hint: 'مبلغ لنا عنده، وتُخصم العمولة منه إن وُجدت', sign: 1, feeOp: -1 },
    for_him: { label: 'له', hint: 'مبلغ له عندنا، وتُخصم العمولة منه إن وُجدت', sign: -1, feeOp: -1 },
    he_paid: { label: 'تصفير (دفع لنا)', hint: 'دفع لنا دفعة لتسديد الرصيد، وتُخصم العمولة منها إن وُجدت', sign: -1, feeOp: -1, settle: true },
    i_paid: { label: 'تصفير (دفعنا له)', hint: 'دفعنا له دفعة لتسديد الرصيد، وتُخصم العمولة منها إن وُجدت', sign: 1, feeOp: -1, settle: true },
    recv_for_me: { label: 'استلم لنا', hint: 'استلم مبلغاً لحسابنا، وتُخصم عمولته', sign: 1, feeOp: -1, legacy: true },
    paid_for_me: { label: 'أرسل عنا', hint: 'أرسل مبلغاً لصالحنا، وتُضاف عمولته', sign: -1, feeOp: 1, legacy: true },
    recv_for_him: { label: 'استلمنا له', hint: 'استلمنا مبلغاً لحسابه، وتُخصم عمولتنا', sign: -1, feeOp: -1, legacy: true },
    paid_for_him: { label: 'أرسلنا عنه', hint: 'أرسلنا مبلغاً لصالحه، وتُضاف عمولتنا', sign: 1, feeOp: 1, legacy: true }
};

let traders = [];
let traderMoves = [];
let sheetSupportsTraders = true;

function normalizeTrader(t) {
    return {
        id: String(t?.id ?? '').trim(),
        name: String(t?.name ?? '').trim(),
        phone: String(t?.phone ?? '').trim(),
        commissionPct: Math.max(0, toNum(t?.commissionPct, 0)),
        myCommissionPct: Math.max(0, toNum(t?.myCommissionPct, 0)),
        note: String(t?.note ?? '').trim(),
        logo: /^data:image\//.test(String(t?.logo ?? '')) ? String(t.logo) : '',
        createdAt: String(t?.createdAt ?? '').slice(0, 10)
    };
}

// ---------- نسخة الشعارات في المتصفح ----------
function loadTraderLogos() {
    const v = loadJSON(STORAGE.traderLogos, {});
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function saveTraderLogo(id, logo) {
    const logos = loadTraderLogos();
    if (logo) logos[id] = logo; else delete logos[id];
    try {
        localStorage.setItem(STORAGE.traderLogos, JSON.stringify(logos));
    } catch (e) {
        console.error('Logo storage error:', e);
        showToast('تعذر حفظ نسخة الشعار', 'مساحة المتصفح ممتلئة', 'warning');
    }
}

// بصمة الشعار: نفس طريقة السكربت (طوله + آخر حروفه)
function logoSig(logo) {
    const v = String(logo || '');
    return v ? v.length + ':' + v.slice(-16) : '';
}

// الشيت يرسل بصمة الشعار فقط (logoSig)، فنعرض النسخة المحفوظة عندنا ونطلب من الشيت فقط الشعار الذي تغيّر.
// السكربت الأقدم يرسل الشعار كاملاً (logo) أو لا يرسله أبداً (بلا عمود) فنعرض النسخة المحفوظة.
// شعار محفوظ عندنا وناقص في الشيت يُرفع له مرة واحدة.
async function syncTraderLogos(rawTraders) {
    const cache = loadTraderLogos();
    const need = [];
    const backfill = [];
    const pending = (id) => outbox.some(op => op.action === 'upsert_trader' && op.trader?.id === id);
    rawTraders.forEach(r => {
        const t = traders.find(x => x.id === String(r?.id ?? '').trim());
        if (!t || pending(t.id)) return;
        const cached = cache[t.id] || '';
        if ('logoSig' in r || 'logo' in r) {
            const sig = 'logoSig' in r ? String(r.logoSig || '') : logoSig(r.logo);
            if (!sig) {
                t.logo = cached;
                if (cached) backfill.push({ action: 'upsert_trader', trader: { ...t } });
            } else if (logoSig(cached) === sig) {
                t.logo = cached;
            } else if ('logo' in r) {
                t.logo = String(r.logo);
                saveTraderLogo(t.id, t.logo);
            } else if (logoSig(t.logo) === sig) {
                saveTraderLogo(t.id, t.logo);
            } else {
                need.push(t.id);
            }
        } else if (!t.logo) {
            t.logo = cached;
        }
    });
    if (backfill.length) { queueOps(...backfill); flushOutbox(); }
    if (!need.length) return;
    const res = await postToSheets({ action: 'logos', ids: need });
    const logos = res.status === 'ok' ? res.data?.logos : null;
    if (!logos) return;
    Object.entries(logos).forEach(([id, logo]) => {
        const t = traders.find(x => x.id === id);
        if (!t) return;
        t.logo = /^data:image\//.test(logo) ? logo : '';
        saveTraderLogo(id, t.logo);
    });
    renderTraders();
    if (panelTraderId && !$('traderPanel').classList.contains('hidden')) renderTraderPanel();
}

// شعار التاجر أو أول حرف من اسمه
function traderAvatar(t) {
    return t.logo
        ? `<img src="${escapeHtml(t.logo)}" alt="" class="w-full h-full object-contain bg-white">`
        : escapeHtml(t.name.charAt(0) || '؟');
}

function moveEffect(kind, amount, pct) {
    const k = TMOVE_KINDS[kind] || TMOVE_KINDS.for_us;
    const commission = amount * (pct / 100);
    return { commission, effect: k.sign * (amount + k.feeOp * commission) };
}

function normalizeTmove(m) {
    const kind = TMOVE_KINDS[m?.kind] ? m.kind : 'for_us';
    const amount = Math.max(0, toNum(m?.amount, 0));
    const pct = Math.max(0, toNum(m?.commissionPct, 0));
    const { commission, effect } = moveEffect(kind, amount, pct);
    return {
        id: toNum(m?.id, 0),
        date: String(m?.date ?? '').slice(0, 10),
        traderId: String(m?.traderId ?? '').trim(),
        traderName: String(m?.traderName ?? '').trim(),
        kind,
        currency: TRADE_CURRENCIES[m?.currency] ? m.currency : 'USD',
        amount,
        commissionPct: pct,
        commission: round2(commission),
        effect: round2(effect),
        note: String(m?.note ?? '').trim()
    };
}

const curSym = (c) => TRADE_CURRENCIES[c]?.sym || c;
const tradeMoney = (v, c, digits = 2) => `<bdi class="ltr-num">${fmt(Math.abs(v), digits)} ${curSym(c)}</bdi>`;
const isZero = (v) => Math.abs(v) < 0.005;
// المبلغ مع إشارته داخل نفس الاتجاه (حتى لا تنقلب الإشارة في الصفحة العربية)
const signedMoney = (v, c) => `<bdi class="ltr-num">${isZero(v) ? '' : v > 0 ? '+' : '−'}${fmt(Math.abs(v))} ${curSym(c)}</bdi>`;

function traderMovesOf(id, currency) {
    return traderMoves
        .filter(m => m.traderId === id && (!currency || m.currency === currency))
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

function traderBalances(id) {
    const bal = {};
    traderMoves.forEach(m => {
        if (m.traderId !== id) return;
        bal[m.currency] = round2((bal[m.currency] || 0) + m.effect);
    });
    return bal;
}

function balanceText(v) {
    if (isZero(v)) return 'متصفّر';
    return v > 0 ? 'لنا عنده' : 'له عندنا';
}

function balanceChip(cur, v, big = false) {
    const cls = isZero(v) ? 'zero' : (v > 0 ? 'mine' : 'his');
    return `<span class="bal-chip ${cls}${big ? ' big' : ''}">
        <span class="bal-chip-label">${balanceText(v)}</span>
        <b>${tradeMoney(v, cur)}</b>
    </span>`;
}

function traderWhatsapp(t) {
    if (!hasWhatsapp(t)) return '';
    return `<button data-action="open-wa-trader" data-id="${escapeHtml(t.id)}" class="wa-btn" title="فتح محادثة واتساب">${WA_ICON}<bdi class="ltr-num">+${escapeHtml(whatsappDigits(t.phone))}</bdi></button>`;
}

// ---------- صفحة التجار ----------
function renderTraders() {
    if (pageHidden('traders')) return;
    $('traders-unsupported').classList.toggle('hidden', sheetSupportsTraders || dataState !== 'ready');

    // المجموع لكل عملة: كم لنا عند التجار وكم لهم عندنا
    const totals = {};
    traders.forEach(t => Object.entries(traderBalances(t.id)).forEach(([c, v]) => {
        totals[c] ??= { mine: 0, his: 0 };
        if (v > 0) totals[c].mine += v; else totals[c].his += -v;
    }));
    const curs = Object.keys(totals);
    $('traders-totals').innerHTML = curs.length === 0 ? '' : curs.map((c, i) => `
        <div class="ana-tile" style="--d:${i * 60}ms">
            <span class="ana-tile-label">${TRADE_CURRENCIES[c].name}</span>
            <span class="text-xs text-emerald-700 font-bold">لنا عند التجار: ${tradeMoney(totals[c].mine, c)}</span>
            <span class="text-xs text-rose-700 font-bold">للتجار عندنا: ${tradeMoney(totals[c].his, c)}</span>
            <span class="text-[11px] text-slate-500">الصافي: ${balanceText(totals[c].mine - totals[c].his)} ${tradeMoney(totals[c].mine - totals[c].his, c)}</span>
        </div>
    `).join('');

    const q = normName($('trader_search').value);
    const list = traders.filter(t => !q || normName(t.name).includes(q));
    if (!list.length) {
        $('traders-grid').innerHTML = `<div class="col-span-full section-card p-8 text-center text-sm text-slate-400">${emptyMessage(traders.length, 'لا يوجد تاجر بهذا الاسم', 'لا يوجد تجار بعد. أضف أول تاجر للبدء.')}</div>`;
        return;
    }
    $('traders-grid').innerHTML = list.map((t, i) => {
        const bal = traderBalances(t.id);
        const moves = traderMovesOf(t.id);
        const last = moves[moves.length - 1];
        const chips = Object.entries(bal).map(([c, v]) => balanceChip(c, v)).join('') || '<span class="text-xs text-slate-400">لا توجد حركات بعد</span>';
        return `
            <div class="trader-card" data-action="open-trader" data-id="${escapeHtml(t.id)}" style="--d:${i * 50}ms">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <span class="cust-avatar overflow-hidden">${traderAvatar(t)}</span>
                        <div class="min-w-0">
                            <div class="font-black text-slate-900 truncate">${escapeHtml(t.name)}</div>
                            <div class="text-[11px] text-slate-400">نسبته ${t.commissionPct}% · نسبتي ${t.myCommissionPct}%${t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
                        </div>
                    </div>
                    <button data-action="new-tmove" data-id="${escapeHtml(t.id)}" class="shrink-0 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg">+ حركة</button>
                </div>
                <div class="flex flex-wrap gap-1.5 mt-3">${chips}</div>
                <div class="text-[11px] text-slate-400 mt-2">${last ? `آخر حركة ${relativeDays(last.date)} · ${moves.length} حركة` : ''}</div>
            </div>`;
    }).join('');
}

function openTraderModal(t = null) {
    $('traderModalTitle').textContent = t ? 'تعديل التاجر: ' + t.name : 'تاجر جديد';
    $('tr_id').value = t ? t.id : '';
    $('tr_name').value = t ? t.name : '';
    $('tr_phone').value = t ? t.phone : '';
    $('tr_commission').value = t ? t.commissionPct : 7;
    $('tr_my_commission').value = t ? t.myCommissionPct : 0;
    $('tr_note').value = t ? t.note : '';
    setTraderLogo(t ? t.logo : '');
    traderFormLogoInitial = traderFormLogo;
    openModal('traderModal');
    $('tr_name').focus();
}

// الشعار المختار في نموذج التاجر (يُحفظ مع التاجر في الشيت)
let traderFormLogo = '';
let traderFormLogoInitial = '';
function setTraderLogo(url) {
    traderFormLogo = url || '';
    $('tr_logo_preview').innerHTML = traderFormLogo
        ? `<img src="${escapeHtml(traderFormLogo)}" alt="" class="w-full h-full object-contain bg-white">`
        : (escapeHtml($('tr_name').value.trim().charAt(0)) || '🏪');
    $('tr_logo_remove').classList.toggle('hidden', !traderFormLogo);
}

async function saveTrader(e) {
    e.preventDefault();
    if (!sheetSupportsTraders) return showToast('حدّث السكربت أولاً', 'سكربت Google Sheets الحالي لا يدعم التجار', 'warning');
    const editId = $('tr_id').value;
    const t = normalizeTrader({
        id: editId || 't' + Date.now(),
        name: $('tr_name').value, phone: $('tr_phone').value,
        commissionPct: $('tr_commission').value, myCommissionPct: $('tr_my_commission').value,
        note: $('tr_note').value, logo: traderFormLogo
    });
    if (!t.name) return showToast('تنبيه', 'اسم التاجر مطلوب', 'warning');
    if (t.phone && !hasWhatsapp(t)) return showToast('رقم الواتساب غير مكتمل', 'اكتبه مع المقدمة، مثل 970599123456', 'warning');
    if (traders.some(x => normName(x.name) === normName(t.name) && x.id !== editId)) return showToast('تنبيه', 'يوجد تاجر بنفس الاسم', 'warning');

    const existing = traders.find(x => x.id === editId);
    // الشعار يُرسل للشيت فقط إن تغيّر، حتى لا نمسحه إن لم يكن قد وصل بعد
    const logoChanged = traderFormLogo !== traderFormLogoInitial;
    if (logoChanged) saveTraderLogo(t.id, t.logo);
    if (existing) Object.assign(existing, { ...t, createdAt: existing.createdAt });
    else traders.unshift({ ...t, createdAt: localDateStr() });
    const payload = { ...(existing || traders[0]) };
    if (!logoChanged) delete payload.logo;
    queueOps({ action: 'upsert_trader', trader: payload });
    closeModal('traderModal');
    renderTraders();
    if (panelTraderId === t.id) renderTraderPanel();
    const status = await flushOutbox();
    showToast('تم حفظ التاجر', `${t.name} — ${syncResultMessage(status)}`, syncToastType(status));
}

function deleteTraderPrompt(id) {
    const t = traders.find(x => x.id === id);
    if (!t) return;
    const count = traderMoves.filter(m => m.traderId === id).length;
    showAppConfirm('حذف التاجر', `سيُحذف "${t.name}"${count ? ` و${count} حركة على حسابه` : ''} من الشيت. متابعة؟`, async () => {
        const ops = traderMoves.filter(m => m.traderId === id).map(m => ({ action: 'delete_tmove', id: m.id }));
        traderMoves = traderMoves.filter(m => m.traderId !== id);
        traders = traders.filter(x => x.id !== id);
        saveTraderLogo(id, '');
        queueOps(...ops, { action: 'delete_trader', id });
        closeModal('traderPanel');
        renderTraders();
        const status = await flushOutbox();
        showToast('تم حذف التاجر', syncResultMessage(status), syncToastType(status));
    });
}

// ---------- حساب التاجر (كشف الحساب) ----------
let panelTraderId = null;
let panelCurrency = 'USD';
let panelPeriod = 'since_zero';

const PERIODS = {
    since_zero: 'منذ آخر تصفير',
    today: 'اليوم',
    week: 'آخر 7 أيام',
    month: 'هذا الشهر',
    all: 'كل الحركات'
};

function openTraderPanel(id, currency) {
    const t = traders.find(x => x.id === id);
    if (!t) return;
    panelTraderId = id;
    const bal = traderBalances(id);
    const used = Object.keys(bal);
    panelCurrency = currency || (used.find(c => !isZero(bal[c])) || used[0] || 'USD');
    panelPeriod = 'since_zero';
    renderTraderPanel();
    openModal('traderPanel');
    $('trader-profile').scrollTop = 0;
}

// حركات الفترة مع الرصيد الجاري قبل وبعد كل حركة
function statementFor(id, currency, period) {
    const all = traderMovesOf(id, currency);
    let running = 0;
    const rows = all.map(m => {
        const before = running;
        running = round2(running + m.effect);
        return { m, before, after: running };
    });

    let start = 0;
    if (period === 'since_zero') {
        // آخر نقطة صار فيها الرصيد صفراً (قبل آخر حركة)، فيظهر الحساب الحالي من بدايته
        for (let i = rows.length - 2; i >= 0; i--) {
            if (isZero(rows[i].after)) { start = i + 1; break; }
        }
    }
    const today = localDateStr();
    const weekAgo = localDateStr(new Date(Date.now() - 6 * 86400000));
    const shown = rows.slice(start).filter(r =>
        period === 'today' ? r.m.date === today
        : period === 'week' ? r.m.date >= weekAgo
        : period === 'month' ? r.m.date.startsWith(today.slice(0, 7))
        : true
    );
    const opening = shown.length ? shown[0].before : running;
    return { rows: shown, opening, closing: running, total: rows.length };
}

// لون الرصيد/الأثر: لنا أخضر، له أحمر، صفر رمادي
const traderEffClass = (v) => (isZero(v) ? 'text-slate-400' : v > 0 ? 'text-emerald-700' : 'text-rose-700');

function renderTraderPanel() {
    const t = traders.find(x => x.id === panelTraderId);
    if (!t) return;
    const bal = traderBalances(t.id);
    const st = statementFor(t.id, panelCurrency, panelPeriod);

    $('trader-profile').innerHTML = `
        ${traderPanelHeadHtml(t)}

        <div class="p-4 sm:p-5 space-y-4">
            <!-- الأرصدة: اضغط على عملة لعرض كشفها -->
            ${traderBalanceTabsHtml(bal)}

            ${traderPanelActionsHtml(t, bal[panelCurrency] || 0)}

            ${traderPanelToolbarHtml()}

            <!-- الكشف (هذا الجزء يُحوَّل إلى صورة) -->
            ${statementHtml(t, st)}
        </div>
    `;
    $('tp_add_currency').addEventListener('change', (e) => {
        if (!e.target.value) return;
        panelCurrency = e.target.value;
        renderTraderPanel();
    });
}

function traderPanelHeadHtml(t) {
    return `
        <div class="cp-head">
            <button data-action="close-modal" data-modal="traderPanel" class="cp-close" aria-label="إغلاق">✕</button>
            <div class="flex items-center gap-3.5">
                <div class="cp-avatar overflow-hidden">${traderAvatar(t)}</div>
                <div class="min-w-0">
                    <h3 class="text-lg font-black text-white truncate">${escapeHtml(t.name)}</h3>
                    <div class="text-xs text-slate-300 mt-0.5">نسبته ${t.commissionPct}% · نسبتي ${t.myCommissionPct}%${t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 mt-3">
                ${traderWhatsapp(t)}
                <button data-action="edit-trader" data-id="${escapeHtml(t.id)}" class="cp-chip hover:bg-white/20">تعديل</button>
                <button data-action="delete-trader" data-id="${escapeHtml(t.id)}" class="cp-chip hover:bg-white/20">حذف</button>
            </div>
        </div>`;
}

function traderBalanceTabsHtml(bal) {
    const curList = [...new Set([...Object.keys(bal), panelCurrency])];
    return `
        <div class="flex flex-wrap gap-2">
            ${curList.map(c => `
                <button data-action="trader-currency" data-cur="${c}" class="cur-tab${c === panelCurrency ? ' active' : ''}">
                    <span class="text-[11px] text-slate-500 block">${TRADE_CURRENCIES[c].name}</span>
                    ${balanceChip(c, bal[c] || 0, true)}
                </button>`).join('')}
            <select id="tp_add_currency" class="cur-add" aria-label="إضافة عملة">
                <option value="">+ عملة</option>
                ${Object.keys(TRADE_CURRENCIES).filter(c => !curList.includes(c)).map(c => `<option value="${c}">${TRADE_CURRENCIES[c].name}</option>`).join('')}
            </select>
        </div>`;
}

function traderPanelActionsHtml(t, current) {
    return `
        <div class="grid grid-cols-2 gap-2">
            <button data-action="new-tmove" data-id="${escapeHtml(t.id)}" data-cur="${panelCurrency}" class="cp-action bg-slate-900 text-white">+ حركة جديدة</button>
            <button data-action="settle-trader" data-id="${escapeHtml(t.id)}" data-cur="${panelCurrency}" class="cp-action ${isZero(current) ? 'bg-slate-100 text-slate-400' : 'bg-emerald-600 text-white'}" ${isZero(current) ? 'disabled' : ''}>
                ${isZero(current) ? 'الحساب متصفّر' : `تصفير الحساب (${tradeMoney(current, panelCurrency, 0)})`}
            </button>
        </div>`;
}

// الفترة + تحميل الكشف ومشاركته
function traderPanelToolbarHtml() {
    return `
        <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="inline-flex bg-slate-100 rounded-lg p-0.5 text-xs" role="group" aria-label="الفترة">
                ${Object.entries(PERIODS).map(([k, l]) => `<button data-action="trader-period" data-period="${k}" class="ana-range-btn px-2.5 py-1 rounded-md font-bold text-slate-500${k === panelPeriod ? ' active' : ''}">${l}</button>`).join('')}
            </div>
            <div class="flex gap-1.5">
                <button data-action="statement-pdf" class="text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg">تحميل PDF</button>
                <button data-action="statement-png" class="text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg">صورة PNG</button>
                <button data-action="share-statement" class="text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg">واتساب</button>
            </div>
        </div>`;
}

// الكشف: الطرفان، العنوان، الملخص، والحركات يوماً بيوم
function statementHtml(t, st) {
    return `
        <div id="trader-statement" class="statement-paper">
            <!-- الطرفان: شركتنا يميناً والتاجر يساراً -->
            <div class="st-head">
                <div class="st-party">
                    <div class="st-logo">${logoHtml()}</div>
                    <div class="min-w-0">
                        <div class="font-black text-white text-sm truncate">${escapeHtml(globalConfig.companyName || 'فاست باي')}</div>
                        <div class="text-[11px] text-slate-400 truncate">${escapeHtml(globalConfig.companySubtitle || '')}</div>
                    </div>
                </div>
                <div class="st-party">
                    <div class="min-w-0 text-left">
                        <div class="font-black text-white text-sm truncate">${escapeHtml(t.name)}</div>
                        <div class="text-[11px] text-slate-400 truncate">${t.phone ? `<bdi class="ltr-num">${escapeHtml(t.phone)}</bdi>` : 'التاجر'}</div>
                    </div>
                    <div class="st-logo">${traderAvatar(t)}</div>
                </div>
            </div>
            <div class="st-title">
                <b>كشف حساب · ${TRADE_CURRENCIES[panelCurrency].name}</b>
                <span>${PERIODS[panelPeriod]} · <bdi class="ltr-num">${localDateStr()}</bdi></span>
            </div>
            <div class="st-summary">
                <div><span>رصيد أول الفترة</span><b class="${traderEffClass(st.opening)}">${balanceText(st.opening)} ${tradeMoney(st.opening, panelCurrency)}</b></div>
                <div><span>عدد الحركات</span><b>${st.rows.length}</b></div>
                <div class="st-final"><span>الرصيد الحالي</span><b class="${traderEffClass(st.closing)}">${balanceText(st.closing)} ${tradeMoney(st.closing, panelCurrency)}</b></div>
            </div>
            ${statementDaysHtml(st.rows)}
        </div>`;
}

// تجميع حركات الكشف حسب اليوم، مع صافي كل يوم
function statementDaysHtml(rows) {
    const days = [];
    rows.forEach(r => {
        let d = days[days.length - 1];
        if (!d || d.date !== r.m.date) { d = { date: r.m.date, rows: [], net: 0 }; days.push(d); }
        d.rows.push(r);
        d.net = round2(d.net + r.m.effect);
    });
    if (days.length === 0) return '<div class="text-xs text-slate-400 text-center py-8">لا توجد حركات في هذه الفترة</div>';
    return days.map(d => `
        <div class="st-day">
            <div class="st-day-head"><bdi class="ltr-num">${escapeHtml(d.date)}</bdi><span class="${traderEffClass(d.net)}">صافي اليوم ${signedMoney(d.net, panelCurrency)}</span></div>
            ${d.rows.map(({ m, after }) => `
                <div class="st-row">
                    <div class="min-w-0 flex-1">
                        <div class="font-bold text-slate-800">${TMOVE_KINDS[m.kind].label}${m.note ? ` <span class="font-medium text-slate-400">· ${escapeHtml(m.note)}</span>` : ''}</div>
                        <div class="text-[11px] text-slate-500">${tradeMoney(m.amount, m.currency)}${m.commission ? ` · عمولة ${m.commissionPct}% = ${tradeMoney(m.commission, m.currency)}` : ''}</div>
                    </div>
                    <div class="text-left shrink-0">
                        <div class="font-black ${traderEffClass(m.effect)}">${signedMoney(m.effect, m.currency)}</div>
                        <div class="text-[10px] text-slate-400">الرصيد ${isZero(after) ? '0' : (after > 0 ? 'لنا ' : 'له ')}${isZero(after) ? '' : tradeMoney(after, m.currency)}</div>
                    </div>
                    <div class="st-row-actions" data-export-ignore="true">
                        <button data-action="edit-tmove" data-id="${m.id}" title="تعديل">✎</button>
                        <button data-action="delete-tmove" data-id="${m.id}" title="حذف">✕</button>
                    </div>
                </div>`).join('')}
        </div>`).join('');
}

// ---------- الحركات ----------
// أزرار: لنا / له / تصفير (+ زر النوع القديم عند تعديل حركة قديمة)
function renderTmoveKinds() {
    const current = $('tm_kind').value;
    const ck = TMOVE_KINDS[current];
    const btns = [
        { key: 'for_us', label: 'لنا', sub: 'يزيد ما لنا عنده', cls: 'mine', active: current === 'for_us' },
        { key: 'for_him', label: 'له', sub: 'يزيد ما له عندنا', cls: 'his', active: current === 'for_him' },
        { key: 'settle', label: 'تصفير', sub: ck.settle ? (current === 'he_paid' ? 'دفع لنا' : 'دفعنا له') : 'يقلّل الرصيد', cls: 'settle', active: !!ck.settle }
    ];
    if (ck.legacy) btns.push({ key: current, label: ck.label, sub: 'نوع قديم', cls: ck.sign > 0 ? 'mine' : 'his', active: true });
    $('tm_kinds').style.gridTemplateColumns = `repeat(${btns.length}, minmax(0, 1fr))`;
    $('tm_kinds').innerHTML = btns.map(b => `
        <button type="button" data-action="tmove-kind" data-kind="${b.key}" class="kind-btn${b.active ? ' active' : ''} ${b.cls}">
            ${b.label}<span>${b.sub}</span>
        </button>`).join('');
}

// اتجاه التصفير حسب الرصيد: لنا عنده → دفع لنا، له عندنا → دفعنا له
function settleKindFor() {
    const t = traders.find(x => x.id === $('tm_trader').value);
    const bal = ((t && traderBalances(t.id)[$('tm_currency').value]) || 0) - editingMoveEffect();
    return bal < 0 && !isZero(bal) ? 'i_paid' : 'he_paid';
}

function setTmoveKind(kind) {
    $('tm_kind').value = kind === 'settle' ? settleKindFor() : kind;
    renderTmoveKinds();
    updateTmovePreview();
}

function updateTmovePreview() {
    if (TMOVE_KINDS[$('tm_kind').value].settle && $('tm_kind').value !== settleKindFor()) {
        $('tm_kind').value = settleKindFor();
        renderTmoveKinds();
    }
    const kind = $('tm_kind').value;
    const k = TMOVE_KINDS[kind];
    const cur = $('tm_currency').value;
    const amount = toNum($('tm_amount').value, 0);
    const { commission, effect } = moveEffect(kind, amount, toNum($('tm_commission').value, 0));
    const t = traders.find(x => x.id === $('tm_trader').value);
    const after = round2(((t && traderBalances(t.id)[cur]) || 0) - editingMoveEffect() + effect);
    $('tm_preview').innerHTML = `
        <div class="text-[11px] text-slate-500 mb-1">${escapeHtml(k.hint)}</div>
        <div class="flex justify-between"><span>${commission ? `العمولة: ${tradeMoney(commission, cur)}` : 'بدون عمولة'}</span>
        <b class="${!k.settle ? (effect >= 0 ? 'text-emerald-700' : 'text-rose-700') : 'text-slate-800'}">${k.settle ? 'تسديد ' : effect >= 0 ? 'لنا عنده +' : 'له عندنا +'}${tradeMoney(effect, cur)}</b></div>
        <div class="flex justify-between text-[11px] mt-1"><span>الرصيد بعد الحركة</span><b>${balanceText(after)} ${tradeMoney(after, cur)}</b></div>`;
}

// عند التعديل: نطرح أثر الحركة القديمة من الرصيد في المعاينة
function editingMoveEffect() {
    const m = traderMoves.find(x => x.id === toNum($('tm_id').value, -1));
    return m && m.currency === $('tm_currency').value ? m.effect : 0;
}

function openTmoveModal({ traderId, kind = 'for_us', currency, amount = '', move = null } = {}) {
    if (!sheetSupportsTraders) return showToast('حدّث السكربت أولاً', 'سكربت Google Sheets الحالي لا يدعم التجار', 'warning');
    const t = traders.find(x => x.id === (move ? move.traderId : traderId));
    if (!t) return;
    $('tmoveModalTitle').textContent = (move ? 'تعديل حركة' : 'حركة جديدة') + ' — ' + t.name;
    $('tm_id').value = move ? move.id : '';
    $('tm_trader').value = t.id;
    $('tm_currency').value = move ? move.currency : (currency || panelCurrency || 'USD');
    $('tm_amount').value = move ? move.amount : amount;
    $('tm_date').value = move ? move.date : localDateStr();
    $('tm_note').value = move ? move.note : '';
    $('tm_commission').value = move ? move.commissionPct : 0;
    setTmoveKind(move ? move.kind : kind);
    updateTmovePreview();
    openModal('tmoveModal');
    $('tm_amount').focus();
}

// التصفير: حركة تسديد بقيمة الرصيد الحالي، ويمكن تعديل المبلغ لتسديد جزئي
function settleTrader(id, currency) {
    const v = traderBalances(id)[currency] || 0;
    if (isZero(v)) return;
    openTmoveModal({ traderId: id, currency, kind: 'settle', amount: Math.abs(v) });
    $('tm_note').value = 'تصفير الحساب';
}

async function saveTmove(e) {
    e.preventDefault();
    const t = traders.find(x => x.id === $('tm_trader').value);
    if (!t) return;
    const editId = toNum($('tm_id').value, 0);
    const move = normalizeTmove({
        id: editId || Math.max(Date.now(), traderMoves.reduce((m, x) => Math.max(m, x.id), 0) + 1),
        date: $('tm_date').value || localDateStr(),
        traderId: t.id, traderName: t.name,
        kind: $('tm_kind').value, currency: $('tm_currency').value,
        amount: $('tm_amount').value, commissionPct: $('tm_commission').value,
        note: $('tm_note').value
    });
    if (!(move.amount > 0)) return showToast('تنبيه', 'اكتب المبلغ', 'warning');
    if (editLocked('traderMoves', traderMoves.find(x => x.id === move.id), move)) return lockWarn();

    const i = traderMoves.findIndex(x => x.id === move.id);
    if (i >= 0) traderMoves[i] = move; else traderMoves.push(move);
    queueOps({ action: 'upsert_tmove', move });
    closeModal('tmoveModal');
    panelCurrency = move.currency;
    renderTraders();
    if (!$('traderPanel').classList.contains('hidden')) renderTraderPanel();

    const bal = traderBalances(t.id)[move.currency] || 0;
    const status = await flushOutbox();
    showToast(isZero(bal) ? 'تم تصفير الحساب ✓' : 'تم حفظ الحركة',
        `${t.name}: ${balanceText(bal)} ${fmt(Math.abs(bal))} ${curSym(move.currency)} — ${syncResultMessage(status)}`, syncToastType(status));
}

function deleteTmovePrompt(id) {
    const m = traderMoves.find(x => x.id === id);
    if (!m) return;
    if (dayLocked(m.date)) return lockWarn();
    showAppConfirm('حذف الحركة', `حذف "${TMOVE_KINDS[m.kind].label}" بمبلغ ${fmt(m.amount)} ${curSym(m.currency)}؟`, async () => {
        traderMoves = traderMoves.filter(x => x.id !== id);
        queueOps({ action: 'delete_tmove', id });
        renderTraders();
        renderTraderPanel();
        const status = await flushOutbox();
        showToast('تم حذف الحركة', syncResultMessage(status), syncToastType(status));
    });
}

async function exportStatement(format) {
    const t = traders.find(x => x.id === panelTraderId);
    if (!t) return;
    const buttons = document.querySelectorAll('[data-action^="statement-"]');
    buttons.forEach(b => { b.disabled = true; });
    try {
        await exportElement($('trader-statement'), format, `كشف_${t.name}_${panelCurrency}_${localDateStr()}`, 2.5);
        showToast('تم تحميل الكشف', (format === 'pdf' ? 'ملف PDF' : 'صورة PNG') + ' — أرسله للتاجر على واتساب', 'info');
    } catch (err) {
        console.error('Statement export failed:', err);
        showToast('تعذر إنشاء الصورة', 'تأكد من الاتصال بالإنترنت ثم حاول مجدداً', 'error');
    } finally {
        buttons.forEach(b => { b.disabled = false; });
    }
}
