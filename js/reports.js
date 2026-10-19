'use strict';

// فاست باي — التحليل الشهري والتقارير
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= التحليل الشهري (رسم بياني متحرك ومباشر) =================
const MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const LIVE_REFRESH_MS = 2 * 60 * 1000;

let analysisMonth = '';   // الشهر المختار YYYY-MM
let analysisFollowsCurrent = true; // يتبع الشهر الحالي تلقائياً (ينتقل للشهر الجديد عند بدايته)
let analysisRange = 6;    // عدد الأشهر في الرسم
// آخر شهر في الرسم: يبقى ثابتاً عند الضغط على شهر داخل الرسم، ولا يتحرك إلا إذا اخترت شهراً خارجه
let analysisWindowEnd = '';
let analysisSignature = { chart: '', cats: '', insights: '' };
let analysisChartData = [];

const monthKeyOf = (date) => String(date || '').slice(0, 7);
const currentMonthKey = () => localDateStr().slice(0, 7);

function monthLabel(key, withYear = true) {
    const [y, m] = key.split('-');
    return MONTH_NAMES[Number(m) - 1] + (withYear ? ' ' + y : '');
}

function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// اسم صفحة الجنيه في التقارير (غير مصدر "🇪🇬 جنيه مصري" في الحاسبة)
const EGP_REPORT_KEY = '🇪🇬 محافظ الجنيه';

function emptyMonth(month) {
    return { month, profit: 0, payout: 0, count: 0, expenses: 0, net: 0, byCategory: {}, byCountry: {} };
}

function monthlyStats() {
    const map = {};
    const get = (k) => (map[k] ??= emptyMonth(k));
    ledger.forEach(t => {
        if (t.status === CANCELLED || !t.date) return;
        const s = get(monthKeyOf(t.date));
        s.profit += t.profitIls;
        s.payout += t.clientIls;
        s.count++;
        const country = t.country || 'غير محدد';
        s.byCountry[country] = (s.byCountry[country] || 0) + t.profitIls;
    });
    // ربح USDT (إيداع وسحب) يُضاف لربح الشهر
    usdtMoves.forEach(m => {
        if (m.kind === 'adjust' || !m.date) return;
        const s = get(monthKeyOf(m.date));
        s.profit += m.profitIls;
        s.count++;
        s.byCountry['₮ USDT'] = (s.byCountry['₮ USDT'] || 0) + m.profitIls;
    });
    // ربح الجنيه (إرسال واستقبال) يُضاف لربح الشهر
    egpMoves.forEach(m => {
        if ((m.kind !== 'send' && m.kind !== 'receive') || !m.date) return;
        const s = get(monthKeyOf(m.date));
        s.profit += m.profitIls;
        s.count++;
        s.byCountry[EGP_REPORT_KEY] = (s.byCountry[EGP_REPORT_KEY] || 0) + m.profitIls;
    });
    expenses.forEach(e => {
        if (!e.date) return;
        const s = get(monthKeyOf(e.date));
        s.expenses += e.amount;
        s.byCategory[e.category] = (s.byCategory[e.category] || 0) + e.amount;
    });
    Object.values(map).forEach(s => { s.net = s.profit - s.expenses; });
    return map;
}

// عدّاد متحرك: ينتقل الرقم من قيمته السابقة إلى الجديدة
function animateNumber(el, to, format = (v) => fmt(v, 0), duration = 900) {
    const from = toNum(el.dataset.value, 0);
    el.dataset.value = to;
    cancelAnimationFrame(el._raf);
    // بدون حركة: الحركات موقفة (الإعدادات أو الجهاز)، أو إذا كانت الصفحة مخفية (المتصفح يوقف الحركة فيها)
    if (motionReduced() || from === to || document.hidden) {
        el.textContent = format(to);
        return;
    }
    const start = performance.now();
    const step = (now) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = format(from + (to - from) * eased);
        if (p < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
}

// رقم بالشيكل يحافظ على إشارة السالب في مكانها داخل النص العربي
const moneyHtml = (v, digits = 0) => `<bdi class="ltr-num">${fmt(v, digits)}</bdi> ₪`;

function compactNumber(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(Math.round(v));
}

function setDelta(el, cur, prev, prevKey, upIsGood) {
    if (!prev) {
        el.textContent = 'لا توجد بيانات للشهر السابق';
        el.className = 'ana-delta flat';
        return;
    }
    const diff = cur - prev;
    if (Math.abs(diff) < 0.005) {
        el.textContent = `＝ نفس ${monthLabel(prevKey, false)}`;
        el.className = 'ana-delta flat';
        return;
    }
    const up = diff > 0;
    const amount = prev !== 0 ? fmt(Math.abs(diff / Math.abs(prev)) * 100, 0) + '%' : fmt(Math.abs(diff), 0) + ' ₪';
    el.textContent = `${up ? '▲' : '▼'} ${amount} ${up ? 'أعلى' : 'أقل'} من ${monthLabel(prevKey, false)}`;
    el.className = 'ana-delta ' + (up === upIsGood ? 'good' : 'bad');
}

function niceTicks(min, max, count = 5) {
    const span = max - min || 1;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => st >= raw) || 10 * mag;
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
    return ticks;
}

// عمود بزوايا علوية دائرية 4px وقاعدة مربعة على خط الصفر
function barPath(x, yTop, w, yBase) {
    const h = yBase - yTop;
    if (h <= 0.5) return '';
    const r = Math.min(4, w / 2, h);
    return `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yBase}Z`;
}

function renderMonthlyChart(data, { animate = true } = {}) {
    // الرسم بعرض الحاوية الفعلي حتى يبقى حجم الخط ثابتاً على الجوال والكمبيوتر
    const W = Math.max(300, Math.round($('ana-chart').clientWidth || 720));
    const H = W < 500 ? 240 : 300, padT = 16, padB = 40, padR = 44, padL = 4;
    const values = data.flatMap(d => [d.profit, d.expenses, d.net]);
    let max = Math.max(0, ...values);
    let min = Math.min(0, ...values);
    if (max === min) max = 100;
    const ticks = niceTicks(min, max, 4);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const plotW = W - padR - padL, plotH = H - padT - padB;
    const y = (v) => padT + ((y1 - v) / (y1 - y0)) * plotH;
    const band = plotW / data.length;
    // من اليمين لليسار: أقدم شهر على اليمين وأحدث شهر على اليسار
    const cx = (i) => W - padR - band * (i + 0.5);
    const barW = Math.max(6, Math.min(24, band * 0.28));
    const base = y(0);

    let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;

    // شبكة أفقية خفيفة وأرقام المحور
    ticks.forEach(t => {
        const ty = y(t);
        svg += `<line x1="${padL}" x2="${W - padR}" y1="${ty}" y2="${ty}" stroke="${t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}" stroke-width="1"/>`;
        svg += `<text x="${W - padR + 8}" y="${ty + 4}" font-size="11" fill="var(--chart-muted)" text-anchor="start" direction="ltr">${compactNumber(t)}</text>`;
    });

    // مناطق التفاعل لكل شهر (أكبر من الأعمدة)
    data.forEach((d, i) => {
        const selected = d.month === analysisMonth ? ' selected' : '';
        svg += `<rect class="ana-band${selected}" data-index="${i}" x="${cx(i) - band / 2}" y="${padT}" width="${band}" height="${plotH}" rx="6"/>`;
    });

    // الأعمدة: ربح الحوالات يمين، المصاريف يسار، بينهما فراغ 2px
    data.forEach((d, i) => {
        const delay = `--d:${i * 70}ms`;
        const pBar = barPath(cx(i) + 1, y(d.profit), barW, base);
        const eBar = barPath(cx(i) - 1 - barW, y(d.expenses), barW, base);
        if (pBar) svg += `<path class="ana-bar" style="${delay}" d="${pBar}" fill="var(--series-profit)" pointer-events="none"/>`;
        if (eBar) svg += `<path class="ana-bar" style="${delay}" d="${eBar}" fill="var(--series-expense)" pointer-events="none"/>`;
    });

    // خط صافي الربح مع نقاط بحلقة بلون الخلفية
    const pts = data.map((d, i) => [cx(i), y(d.net)]);
    svg += `<path class="ana-line" pathLength="1" d="M${pts.map(p => p.join(',')).join('L')}" fill="none" stroke="var(--series-net)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>`;
    pts.forEach(([px, py], i) => {
        svg += `<circle class="ana-dot" style="--d:${500 + i * 90}ms" cx="${px}" cy="${py}" r="4.5" fill="var(--series-net)" stroke="var(--chart-surface)" stroke-width="2" pointer-events="none"/>`;
    });

    // تسمية واحدة فقط: قيمة صافي الربح للشهر المختار
    const selIdx = data.findIndex(d => d.month === analysisMonth);
    if (selIdx >= 0) {
        const [sx, sy] = pts[selIdx];
        svg += `<text class="ana-dot" style="--d:900ms" x="${sx}" y="${sy - 12}" font-size="11" font-weight="700" fill="var(--chart-ink)" text-anchor="middle" direction="ltr" pointer-events="none">${compactNumber(data[selIdx].net)} ₪</text>`;
    }

    // أسماء الأشهر
    data.forEach((d, i) => {
        const [yr, mo] = d.month.split('-');
        const showYear = i === 0 || mo === '01';
        const weight = d.month === analysisMonth ? '700' : '500';
        const name = MONTH_NAMES[Number(mo) - 1];
        const label = band < 46 ? name.slice(0, 3) : name;
        svg += `<text x="${cx(i)}" y="${H - padB + 18}" font-size="11" font-weight="${weight}" fill="var(--chart-text)" text-anchor="middle" pointer-events="none">${label}</text>`;
        if (showYear) svg += `<text x="${cx(i)}" y="${H - padB + 32}" font-size="10" fill="var(--chart-muted)" text-anchor="middle" pointer-events="none">${yr}</text>`;
    });

    svg += '</svg>';

    const chart = $('ana-chart');
    analysisChartData = data;
    if (!animate) {
        chart.classList.add('static', 'in');
        chart.innerHTML = svg;
        return;
    }
    chart.classList.remove('in', 'static');
    chart.innerHTML = svg;
    // إعادة تشغيل الحركة: الأعمدة تنمو والخط يُرسم
    void chart.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(() => chart.classList.add('in')));
}

function showChartTooltip(index) {
    const d = analysisChartData[index];
    const band = $('ana-chart').querySelector(`.ana-band[data-index="${index}"]`);
    if (!d || !band) return;
    const tip = $('ana-tooltip');
    const wrap = $('ana-chart-wrap').getBoundingClientRect();
    const r = band.getBoundingClientRect();
    tip.innerHTML = `
        <div class="font-bold text-slate-900 mb-1">${monthLabel(d.month)}</div>
        <div class="ana-tooltip-row"><span class="inline-flex items-center gap-1.5 text-slate-600"><span class="ana-key" style="background:var(--series-profit)"></span>ربح الحوالات</span><b class="num text-slate-900">${fmt(d.profit)} ₪</b></div>
        <div class="ana-tooltip-row"><span class="inline-flex items-center gap-1.5 text-slate-600"><span class="ana-key" style="background:var(--series-expense)"></span>المصاريف</span><b class="num text-slate-900">${fmt(d.expenses)} ₪</b></div>
        <div class="ana-tooltip-row border-t border-slate-100 mt-1 pt-1"><span class="inline-flex items-center gap-1.5 text-slate-600"><span class="ana-key ana-key-line" style="background:var(--series-net)"></span>صافي الربح</span><b class="num text-slate-900">${moneyHtml(d.net, 2)}</b></div>
        <div class="text-[10px] text-slate-400 mt-1">${d.count} حوالة</div>
    `;
    tip.classList.remove('hidden');
    const tipW = tip.offsetWidth;
    let left = r.left - wrap.left + r.width / 2;
    left = Math.max(tipW / 2, Math.min(wrap.width - tipW / 2, left));
    tip.style.left = left + 'px';
    tip.style.top = '4px';
}

function hideChartTooltip() {
    $('ana-tooltip').classList.add('hidden');
}

function renderCategoryBars(sel) {
    $('ana-cat-month').textContent = monthLabel(sel.month, false);
    const entries = Object.entries(sel.byCategory).sort((a, b) => b[1] - a[1]);
    const signature = JSON.stringify(entries);
    if (signature === analysisSignature.cats) return;
    analysisSignature.cats = signature;

    const box = $('ana-categories');
    if (!entries.length) {
        box.innerHTML = '<div class="text-xs text-slate-400 py-4 text-center">لا توجد مصاريف في هذا الشهر</div>';
        return;
    }
    const max = entries[0][1];
    const total = entries.reduce((s, [, v]) => s + v, 0);
    box.innerHTML = entries.map(([cat, sum], i) => `
        <div>
            <div class="flex justify-between text-xs mb-1">
                <span class="font-bold text-slate-700">${escapeHtml(cat)}</span>
                <span class="text-slate-600"><b class="num text-slate-900">${fmt(sum, 0)} ₪</b> · ${Math.round(sum / total * 100)}%</span>
            </div>
            <div class="ana-cat-track"><div class="ana-cat-fill" style="--d:${i * 80}ms" data-width="${(sum / max) * 100}"></div></div>
        </div>
    `).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
        box.querySelectorAll('.ana-cat-fill').forEach(el => { el.style.width = el.dataset.width + '%'; });
    }));
}

function buildInsights(sel, prev, rangeData, isCurrent) {
    const items = [];
    const prevKey = shiftMonth(sel.month, -1);

    if (!sel.count && !sel.expenses) {
        return [{ icon: 'ℹ', text: `لا توجد حوالات أو مصاريف مسجلة في ${monthLabel(sel.month)}.` }];
    }

    // صافي الربح مقارنة بالشهر السابق
    if (prev.count || prev.expenses) {
        const diff = sel.net - prev.net;
        const pct = prev.net !== 0 ? Math.abs(diff / Math.abs(prev.net)) * 100 : null;
        items.push(diff >= 0
            ? { icon: '📈', text: `صافي الربح ${isCurrent ? 'حتى الآن ' : ''}أعلى من ${monthLabel(prevKey, false)} بـ <b>${fmt(Math.abs(diff), 0)} ₪</b>${pct !== null ? ` (${fmt(pct, 0)}%)` : ''}.` }
            : { icon: '📉', text: `صافي الربح ${isCurrent ? 'حتى الآن ' : ''}أقل من ${monthLabel(prevKey, false)} بـ <b>${fmt(Math.abs(diff), 0)} ₪</b>${pct !== null ? ` (${fmt(pct, 0)}%)` : ''}.` });
    }

    // توقع نهاية الشهر الحالي بناءً على المعدل اليومي
    if (isCurrent && sel.count) {
        const today = new Date();
        const day = today.getDate();
        const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        if (day < daysInMonth) {
            const projectedProfit = (sel.profit / day) * daysInMonth;
            const projectedNet = projectedProfit - sel.expenses;
            items.push({ icon: '🔮', text: `بمعدل ربح يومي <b>${fmt(sel.profit / day, 0)} ₪</b>، صافي الربح المتوقع لنهاية الشهر حوالي <b>${moneyHtml(projectedNet)}</b> (إذا لم تُضف مصاريف جديدة).` });
        }
    }

    // نسبة المصاريف من الربح
    if (sel.profit > 0 && sel.expenses > 0) {
        const ratio = (sel.expenses / sel.profit) * 100;
        items.push({
            icon: ratio > 60 ? '⚠️' : '💡',
            text: `المصاريف تستهلك <b>${fmt(ratio, 0)}%</b> من ربح الحوالات${ratio > 100 ? ' — الشهر بخسارة' : ratio > 60 ? ' — نسبة مرتفعة' : ''}.`
        });
    } else if (sel.expenses > 0 && sel.profit <= 0) {
        items.push({ icon: '⚠️', text: `يوجد <b>${fmt(sel.expenses, 0)} ₪</b> مصاريف بدون أرباح حوالات في هذا الشهر.` });
    }

    // أكبر بند مصاريف
    const topCat = Object.entries(sel.byCategory).sort((a, b) => b[1] - a[1])[0];
    if (topCat && sel.expenses > 0) {
        items.push({ icon: '🧾', text: `أكبر بند مصاريف: <b>${escapeHtml(topCat[0])}</b> بقيمة ${fmt(topCat[1], 0)} ₪ (${Math.round(topCat[1] / sel.expenses * 100)}% من المصاريف).` });
    }

    // أفضل دولة ربحاً
    const topCountry = Object.entries(sel.byCountry).sort((a, b) => b[1] - a[1])[0];
    if (topCountry && sel.profit > 0) {
        items.push({ icon: '🌍', text: `أكثر مصدر ربحاً: <b>${escapeHtml(topCountry[0])}</b> بـ ${fmt(topCountry[1], 0)} ₪ (${Math.round(topCountry[1] / sel.profit * 100)}% من الربح).` });
    }

    // متوسط الربح لكل حوالة
    if (sel.count) {
        items.push({ icon: '💱', text: `${sel.count} حوالة بمتوسط ربح <b>${fmt(sel.profit / sel.count, 1)} ₪</b> للحوالة.` });
    }

    // أفضل شهر في الفترة
    const withData = rangeData.filter(d => d.count || d.expenses);
    if (withData.length > 1) {
        const best = withData.reduce((a, b) => (b.net > a.net ? b : a));
        items.push({ icon: '🏆', text: best.month === sel.month
            ? `هذا أفضل شهر في آخر ${rangeData.length} أشهر من حيث صافي الربح.`
            : `أفضل شهر في الفترة: <b>${monthLabel(best.month)}</b> بصافي ربح ${moneyHtml(best.net)}.` });
    }

    return items;
}

function renderInsights(items) {
    const signature = JSON.stringify(items);
    if (signature === analysisSignature.insights) return;
    analysisSignature.insights = signature;
    $('ana-insights').innerHTML = items.map((it, i) => `
        <li class="ana-insight" style="--d:${i * 90}ms">
            <span class="ana-insight-icon" aria-hidden="true">${it.icon}</span>
            <span>${it.text}</span>
        </li>
    `).join('');
}

function renderMonthlyTable(rangeData) {
    $('ana-table-body').innerHTML = [...rangeData].reverse().map(d => {
        const margin = d.profit > 0 ? Math.round((d.net / d.profit) * 100) + '%' : '—';
        return `
            <tr class="${d.month === analysisMonth ? 'selected' : ''} cursor-pointer hover:bg-slate-50" data-action="ana-pick-month" data-month="${d.month}">
                <td class="p-3 font-bold text-slate-900 whitespace-nowrap">${monthLabel(d.month)}</td>
                <td class="p-3 num text-slate-800">${fmt(d.profit)} ₪</td>
                <td class="p-3 num text-slate-800">${fmt(d.expenses)} ₪</td>
                <td class="p-3 num font-black ${d.net < 0 ? 'text-rose-700' : 'text-slate-900'}">${moneyHtml(d.net, 2)}</td>
                <td class="p-3 num text-slate-600"><bdi class="ltr-num">${margin}</bdi></td>
                <td class="p-3 num text-center text-slate-600">${d.count}</td>
            </tr>
        `;
    }).join('');
}

function renderMonthSelect(stats) {
    const current = currentMonthKey();
    const keys = Object.keys(stats).filter(k => /^\d{4}-\d{2}$/.test(k));
    let earliest = keys.length ? keys.sort()[0] : current;
    if (earliest > current) earliest = current;
    const options = [];
    for (let k = current; k >= earliest; k = shiftMonth(k, -1)) {
        options.push(k);
        if (options.length > 60) break;
    }
    const sel = $('ana_month');
    sel.innerHTML = options.map(k => `<option value="${k}">${monthLabel(k)}</option>`).join('');
    sel.value = analysisMonth;
}

function renderMonthlyAnalysis({ replay = false } = {}) {
    if ($('page-reports').classList.contains('hidden')) return;

    const stats = monthlyStats();
    const current = currentMonthKey();
    if (!analysisMonth || analysisMonth > current || analysisFollowsCurrent) analysisMonth = current;

    renderMonthSelect(stats);
    document.querySelectorAll('.ana-range-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.range) === analysisRange));

    const sel = stats[analysisMonth] || emptyMonth(analysisMonth);
    const prevKey = shiftMonth(analysisMonth, -1);
    const prev = stats[prevKey] || emptyMonth(prevKey);
    const hasPrev = !!(prev.count || prev.expenses);

    const money = (v) => fmt(v, 0);
    animateNumber($('ana-profit'), sel.profit, money);
    animateNumber($('ana-expenses'), sel.expenses, money);
    animateNumber($('ana-net'), sel.net, money);
    setDelta($('ana-profit-delta'), sel.profit, hasPrev ? prev.profit : null, prevKey, true);
    setDelta($('ana-expenses-delta'), sel.expenses, hasPrev ? prev.expenses : null, prevKey, false);
    setDelta($('ana-net-delta'), sel.net, hasPrev ? prev.net : null, prevKey, true);

    // آخر N أشهر تنتهي بنهاية النافذة (الأقدم أولاً)، والشهر المختار مظلّل داخلها
    if (!analysisWindowEnd || analysisFollowsCurrent || analysisWindowEnd > current) analysisWindowEnd = current;
    if (analysisMonth > analysisWindowEnd) analysisWindowEnd = analysisMonth;
    const windowStart = shiftMonth(analysisWindowEnd, -(analysisRange - 1));
    if (analysisMonth < windowStart) {
        const end = shiftMonth(analysisMonth, analysisRange - 1);
        analysisWindowEnd = end > current ? current : end;
    }
    const rangeData = [];
    for (let i = analysisRange - 1; i >= 0; i--) {
        const k = shiftMonth(analysisWindowEnd, -i);
        rangeData.push(stats[k] || emptyMonth(k));
    }

    // الحركة تُعاد فقط عند تغيّر البيانات أو عرض الشاشة؛ تغيير الشهر المختار يحدّث التظليل بدون حركة
    const chartSig = JSON.stringify([$('ana-chart').clientWidth, rangeData.map(d => [d.month, d.profit, d.expenses, d.count])]);
    if (replay || chartSig !== analysisSignature.chart) {
        analysisSignature.chart = chartSig;
        analysisSignature.chartMonth = analysisMonth;
        hideChartTooltip();
        renderMonthlyChart(rangeData);
    } else if (analysisSignature.chartMonth !== analysisMonth) {
        analysisSignature.chartMonth = analysisMonth;
        renderMonthlyChart(rangeData, { animate: false });
    }
    if (replay) analysisSignature.cats = analysisSignature.insights = '';

    renderCategoryBars(sel);
    renderInsights(buildInsights(sel, prev, rangeData, analysisMonth === current));
    renderMonthlyTable(rangeData);
}

function setAnalysisMonth(key) {
    if (!/^\d{4}-\d{2}$/.test(key || '')) return;
    analysisMonth = key > currentMonthKey() ? currentMonthKey() : key;
    analysisFollowsCurrent = analysisMonth === currentMonthKey();
    renderMonthlyAnalysis();
}

function setLiveIndicator(ok) {
    $('ana-live-dot').classList.toggle('off', !ok);
    $('ana-live-text').textContent = ok ? `مباشر · ${nowTimeLabel()}` : 'غير متصل';
}

// ================= التقارير =================
function updateReportsData() {
    if (pageHidden('reports')) return;
    const todayStr = localDateStr();
    const currentMonth = todayStr.slice(0, 7);

    let profitToday = 0, countToday = 0, profitMonth = 0, countMonth = 0, payoutMonth = 0, profitTotal = 0;
    const byCountry = {};

    ledger.forEach(t => {
        if (t.status === CANCELLED) return;
        profitTotal += t.profitIls;

        const key = t.country || 'غير محدد';
        byCountry[key] ??= { count: 0, profit: 0, payout: 0 };
        byCountry[key].count++;
        byCountry[key].profit += t.profitIls;
        byCountry[key].payout += t.clientIls;

        if (t.date === todayStr) {
            profitToday += t.profitIls;
            countToday++;
        }
        if (t.date.startsWith(currentMonth)) {
            profitMonth += t.profitIls;
            countMonth++;
            payoutMonth += t.clientIls;
        }
    });

    usdtMoves.forEach(m => {
        if (m.kind === 'adjust') return;
        profitTotal += m.profitIls;
        byCountry['₮ USDT'] ??= { count: 0, profit: 0, payout: 0 };
        byCountry['₮ USDT'].count++;
        byCountry['₮ USDT'].profit += m.profitIls;
        if (m.kind === 'withdraw' && m.currency === 'ILS') byCountry['₮ USDT'].payout += m.total - m.settle;
        if (m.date === todayStr) { profitToday += m.profitIls; countToday++; }
        if (m.date.startsWith(currentMonth)) { profitMonth += m.profitIls; countMonth++; }
    });

    egpMoves.forEach(m => {
        if (m.kind !== 'send' && m.kind !== 'receive') return;
        profitTotal += m.profitIls;
        byCountry[EGP_REPORT_KEY] ??= { count: 0, profit: 0, payout: 0 };
        byCountry[EGP_REPORT_KEY].count++;
        byCountry[EGP_REPORT_KEY].profit += m.profitIls;
        if (m.kind === 'receive' && m.currency === 'ILS') byCountry[EGP_REPORT_KEY].payout += m.total - m.settle;
        if (m.date === todayStr) { profitToday += m.profitIls; countToday++; }
        if (m.date.startsWith(currentMonth)) { profitMonth += m.profitIls; countMonth++; }
    });

    $('rep-profit-today').textContent = '+' + fmt(profitToday, 1) + ' ₪';
    $('rep-count-today').textContent = countToday;
    $('rep-profit-month').textContent = '+' + fmt(profitMonth, 1) + ' ₪';
    $('rep-count-month').textContent = countMonth;
    const payoutMonthUsd = ledger
        .filter(t => t.status !== CANCELLED && t.currency === 'USD' && t.date.startsWith(currentMonth))
        .reduce((sum, t) => sum + t.clientUsd, 0);
    $('rep-payout-month').textContent = fmt(payoutMonth, 1) + ' ₪' + (payoutMonthUsd ? ` + $${fmt(payoutMonthUsd, 0)}` : '');
    $('rep-profit-total').textContent = '+' + fmt(profitTotal, 1) + ' ₪';

    renderMonthlyAnalysis();

    const entries = Object.entries(byCountry).sort((a, b) => b[1].profit - a[1].profit);
    $('reports-countries-grid').innerHTML = entries.length === 0
        ? '<div class="col-span-full text-slate-400 text-xs py-4 text-center">لا توجد عمليات مسجلة بعد</div>'
        : entries.map(([country, d]) => `
            <div class="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1 text-xs">
                <div class="flex justify-between items-center font-bold text-slate-800">
                    <span>${escapeHtml(country)}</span>
                    <span class="text-[11px] text-slate-400 font-normal">${d.count} عملية</span>
                </div>
                <div class="flex justify-between pt-1">
                    <span class="text-slate-500">المسلّم للزبائن:</span>
                    <span class="font-mono font-bold text-slate-700">${fmt(d.payout, 1)} ₪</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-slate-500">صافي الربح:</span>
                    <span class="font-mono font-black text-emerald-600">+${fmt(d.profit, 1)} ₪</span>
                </div>
            </div>
        `).join('');
}
