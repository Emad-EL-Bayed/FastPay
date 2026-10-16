'use strict';

// فاست باي — المظهر (فاتح / داكن / حسب الجهاز) والحركات: دخول الصفحات، إغلاق النوافذ، تموّج الأزرار، عدّ الأرقام، مؤشر القائمة
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= المظهر =================
// الاختيار محفوظ على هذا الجهاز فقط (globalConfig.theme: light | dark | auto، globalConfig.motion: false = بدون حركات).
// سكربت صغير بأول index.html بيطبّقه قبل أول رسم حتى ما تومض الصفحة. الألوان نفسها في tailwind.config.js و styles.css
const THEMES = ['light', 'dark', 'auto'];
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

const themeIsDark = () => globalConfig.theme === 'dark' || (globalConfig.theme === 'auto' && darkQuery.matches);
// الحركات موقفة من الإعدادات أو من الجهاز (تقليل الحركة)
const motionReduced = () => globalConfig.motion === false || reduceMotionQuery.matches;

function applyTheme() {
    const dark = themeIsDark();
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.classList.toggle('motion-off', globalConfig.motion === false);
    $('theme-color-meta').setAttribute('content', dark ? '#080d19' : '#f8fafc');
    renderThemeControls();
}

function renderThemeControls() {
    const theme = THEMES.includes(globalConfig.theme) ? globalConfig.theme : 'light';
    document.querySelectorAll('#theme-seg [data-theme-opt]').forEach(b => {
        b.classList.toggle('active', b.dataset.themeOpt === theme);
        b.setAttribute('aria-checked', String(b.dataset.themeOpt === theme));
    });
    const motion = globalConfig.motion !== false;
    $('motion-toggle').classList.toggle('on', motion);
    $('motion-toggle').setAttribute('aria-pressed', String(motion));
    $('theme-menu-btn').textContent = themeIsDark() ? '☀️ الوضع الفاتح' : '🌙 الوضع الداكن';
}

function setTheme(theme, from) {
    if (!THEMES.includes(theme)) return;
    const wasDark = themeIsDark();
    globalConfig.theme = theme;
    saveAll();
    if (themeIsDark() === wasDark) return renderThemeControls();
    switchThemeAnimated(from);
}

// زر القائمة: فاتح ↔ داكن (حتى لو كان "حسب الجهاز")
function toggleTheme(from) {
    setTheme(themeIsDark() ? 'light' : 'dark', from);
}

function toggleMotion() {
    globalConfig.motion = globalConfig.motion === false;
    saveAll();
    applyTheme();
}

// المظهر الجديد بينتشر كدائرة من الزر اللي انضغط (View Transitions). المتصفح اللي ما بيدعمها بيبدّل عادي
function switchThemeAnimated(from) {
    if (!document.startViewTransition || motionReduced()) return applyTheme();
    const r = from?.getBoundingClientRect?.();
    const x = r ? r.left + r.width / 2 : innerWidth / 2;
    const y = r ? r.top + r.height / 2 : 0;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const vt = document.startViewTransition(applyTheme);
    vt.ready.then(() => {
        document.documentElement.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
            { duration: 600, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' }
        );
    }).catch(() => {});
}

darkQuery.addEventListener('change', () => { if (globalConfig.theme === 'auto') applyTheme(); });

// يعيد تشغيل حركة الكلاس من أولها (لو كان عليه من قبل)
function replayClass(el, cls) {
    if (motionReduced()) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
}

// ================= دخول الصفحة =================
// أقسام الصفحة بتطلع وحدة ورا الثانية، والأرقام الكبيرة بتعدّ لقيمتها
let pageEnterTimer = null;
function playPageEnter(page) {
    if (motionReduced() || !page) return;
    document.querySelectorAll('.page-enter').forEach(p => p.classList.remove('page-enter'));
    replayClass(page, 'page-enter');
    // الكلاس بينشال بعد الحركة، حتى ما تتحرك العناصر اللي بتنرسم من جديد بعدين (التحديث الحيّ)
    clearTimeout(pageEnterTimer);
    pageEnterTimer = setTimeout(() => page.classList.remove('page-enter'), 1200);
    countUpIn(page);
}

// ================= عدّ الأرقام =================
const COUNT_UP_SEL = '.count-up, .acc-balance';
function countUpIn(root) {
    if (motionReduced() || !root) return;
    root.querySelectorAll(COUNT_UP_SEL).forEach(countUp);
}

// أول رقم بنص العنصر بيعدّ من الصفر لقيمته، بنفس عدد الخانات والفواصل
function countUp(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !/\d/.test(node.nodeValue)) node = walker.nextNode();
    const m = node?.nodeValue.match(/-?\d[\d,]*(\.\d+)?/);
    if (!m) return;
    const target = parseFloat(m[0].replace(/,/g, ''));
    if (!Number.isFinite(target) || Math.abs(target) < 1) return;
    const digits = m[1] ? m[1].length - 1 : 0;
    const grouping = m[0].includes(',');
    const before = node.nodeValue.slice(0, m.index);
    const after = node.nodeValue.slice(m.index + m[0].length);
    const format = (v) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: grouping });
    const start = performance.now();
    const step = (now) => {
        // انرسم العنصر من جديد أثناء العدّ: خلص
        if (!node.isConnected) return;
        const p = Math.min(1, (now - start) / 750);
        node.nodeValue = before + format(target * (1 - Math.pow(1 - p, 3))) + after;
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

// ================= النوافذ =================
// النافذة بتتلاشى قبل ما تختفي. حالتها بتصير "مخفية" فوراً (hidden) عشان باقي الكود،
// و modal-leaving بيخليها ظاهرة لحظة الحركة بس (styles.css)
const modalLeaveTimers = {};
function animateModalOut(el) {
    if (motionReduced()) return;
    el.classList.add('modal-leaving');
    clearTimeout(modalLeaveTimers[el.id]);
    modalLeaveTimers[el.id] = setTimeout(() => el.classList.remove('modal-leaving'), 200);
}

function cancelModalOut(el) {
    clearTimeout(modalLeaveTimers[el.id]);
    el.classList.remove('modal-leaving');
}

// ================= تموّج الأزرار =================
// دائرة خفيفة بتنتشر من مكان الضغطة على الأزرار الملونة
const RIPPLE_SEL = 'button.bg-slate-900, button.bg-blue-600, button.bg-emerald-500, button.bg-emerald-600, button.bg-rose-600, button.bg-amber-500, .save-btn, .receipt-btn, .cp-action';
function onRipplePointer(e) {
    const btn = e.target.closest?.(RIPPLE_SEL);
    if (!btn || btn.disabled || motionReduced()) return;
    if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const wrap = document.createElement('span');
    wrap.className = 'ripple-wrap';
    wrap.innerHTML = `<span class="ripple" style="width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px"></span>`;
    btn.appendChild(wrap);
    setTimeout(() => wrap.remove(), 700);
}

// ================= مؤشر القائمة الجانبية =================
// خلفية الزر المختار بتنزلق لمكانه الجديد
function moveNavIndicator() {
    const ind = $('nav-indicator');
    const active = document.querySelector('#side-nav .nav-item.active');
    if (!active || !active.offsetHeight) return;
    const first = !ind.classList.contains('ready');
    ind.style.transform = `translateY(${active.offsetTop}px)`;
    ind.style.height = active.offsetHeight + 'px';
    if (first) {
        // أول مرة بيظهر بمكانه بدون انزلاق من فوق
        void ind.offsetWidth;
        ind.classList.add('ready');
        $('side-nav').classList.add('has-indicator');
    }
}

// ================= ومضة سعر الشاشة =================
// لما يتغير سعر الشاشة بالتحديث الحيّ: أخضر إذا طلع، أحمر إذا نزل
let lastLiveRate = null;
function flashLiveRate(rate) {
    const prev = lastLiveRate;
    lastLiveRate = rate;
    if (prev === null || Math.abs(rate - prev) < 0.0005 || motionReduced()) return;
    const card = $('live-card');
    card.classList.remove('rate-up', 'rate-down');
    replayClass(card, rate > prev ? 'rate-up' : 'rate-down');
    setTimeout(() => card.classList.remove('rate-up', 'rate-down'), 2200);
}

function bindThemeEvents() {
    document.addEventListener('pointerdown', onRipplePointer, { passive: true });
    // القائمة بتتغير لما تظهر (عرض الشاشة) أو تختفي أزرار حسب الصلاحيات
    if (window.ResizeObserver) new ResizeObserver(moveNavIndicator).observe($('side-nav'));
}
