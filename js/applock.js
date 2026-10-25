'use strict';

// فاست باي — قفل البرنامج بالرمز أو البصمة (بطلب عماد 2026-10-25)
// لو الجوال ضاع أو حدا مسكه وهو مفتوح: البرنامج بيتقفل بعد كم دقيقة بدون استعمال، وبيفتح برمز 4 أرقام أو بالبصمة/Face ID.
// - كل إشي على الجهاز نفسه (localStorage)، ولكل مستخدم: الرمز مشفّر (SHA-256 مع ملح)، والبصمة WebAuthn (المتصفح بس بيأكد إنه صاحب الجهاز).
//   هاد قفل للشاشة مش حماية للبيانات بالشيت (الدخول بكلمة السر هو اللي بيحميها).
// - المدير بيقدر يخلّيه إجباري على كل الأجهزة (إعداد مشترك appLockForce + appLockMins)، فاللي ما عنده رمز بيطلب منه يحطه.
// - 5 مرات رمز غلط ← خروج من الحساب (بتدخل بكلمة السر من جديد).

const APPLOCK_KEY = 'fastpay_applock';
const APPLOCK_ACTIVE_KEY = 'fastpay_lastactive';
const APPLOCK_MAX_TRIES = 5;
const APPLOCK_MIN_OPTIONS = [0, 1, 5, 15, 30];

let appLockState = null;   // null = مش ظاهر، وإلا { mode: 'unlock' | 'setup' | 'confirm', entry, first, tries, forced }
let appLockLastWrite = 0;

function appLockAll() {
    try { return JSON.parse(localStorage.getItem(APPLOCK_KEY) || '{}') || {}; } catch (e) { return {}; }
}

// إعداد القفل للمستخدم الحالي على هالجهاز: { salt, pin, cred, mins }
function appLockMine() {
    const u = session?.username;
    return u ? appLockAll()[u] || null : null;
}

function appLockSaveMine(cfg) {
    const u = session?.username;
    if (!u) return;
    const all = appLockAll();
    if (cfg) all[u] = cfg; else delete all[u];
    try { localStorage.setItem(APPLOCK_KEY, JSON.stringify(all)); } catch (e) { /* محظور */ }
}

const appLockForced = () => globalConfig.appLockForce === 'yes';
const appLockOn = () => !!(session?.token && appLockMine()?.pin);

function appLockMins() {
    if (appLockForced()) {
        const m = toNum(globalConfig.appLockMins, 5);
        return m >= 0 ? m : 5;
    }
    const m = Number(appLockMine()?.mins);
    return Number.isFinite(m) && m >= 0 ? m : 5;
}

const appLockMinsText = (m) => (m === 0 ? 'فوراً لما تطلع من البرنامج' : `${m === 1 ? 'بعد دقيقة' : `بعد ${m} ${m <= 10 ? 'دقايق' : 'دقيقة'}`} بدون استعمال`);

// تشفير الرمز (crypto.subtle بيشتغل على https و localhost والملف؛ غير هيك احتياط بسيط)
async function appLockHash(salt, pin) {
    const text = `${salt}:${pin}`;
    try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        let h = 5381;
        for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
        return 'x' + (h >>> 0).toString(16);
    }
}

const appLockRandom = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));

// ---------- آخر استعمال ----------
function appLockTouch(force = false) {
    const now = Date.now();
    if (!force && now - appLockLastWrite < 15000) return;
    appLockLastWrite = now;
    try { localStorage.setItem(APPLOCK_ACTIVE_KEY, String(now)); } catch (e) { /* عادي */ }
}

function appLockIdleMs() {
    let last = 0;
    try { last = Number(localStorage.getItem(APPLOCK_ACTIVE_KEY)) || 0; } catch (e) { /* عادي */ }
    return last ? Date.now() - last : Infinity;
}

// لازم يتقفل هلّق؟ "فوراً" = غاب عن البرنامج أكتر من 10 ثواني (حتى نسخ رقم من واتساب ورجوع سريع ما يقفله)
function appLockDue() {
    if (!appLockOn() || appLockState) return false;
    const mins = appLockMins();
    return appLockIdleMs() > (mins === 0 ? 10000 : mins * 60000);
}

// سبب الخروج (نسي الرمز أو غلط كثير) بيبين بشاشة الدخول بعد إعادة الفتح
function takeLockReason() {
    try {
        const r = sessionStorage.getItem('fastpay_lock_reason') || '';
        sessionStorage.removeItem('fastpay_lock_reason');
        return r ? `${r}: ادخل باسمك وكلمة السر` : '';
    } catch (e) { return ''; }
}

function initAppLock() {
    const onActivity = () => { if (!appLockState) appLockTouch(); };
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, onActivity, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { if (!appLockState) appLockTouch(true); return; }
        if (appLockDue()) showAppLock('unlock');
    });
    setInterval(() => { if (!document.hidden && appLockDue()) showAppLock('unlock'); }, 20000);
    // أول فتح: إذا صرله أكتر من المدة مسكّر
    if (appLockDue()) showAppLock('unlock');
    else appLockTouch(true);
    document.addEventListener('keydown', onAppLockKey, true);
    updateAppLockMenu();
}

// بعد ما توصل الإعدادات المشتركة: القفل إجباري وما في رمز ← لازم يحطه
function checkAppLockRequired() {
    if (!session?.token || appLockState || !appLockForced() || appLockMine()?.pin) return;
    if (!$('login-screen').classList.contains('hidden')) return;
    showAppLock('setup', { forced: true });
}

// ---------- الشاشة ----------
function showAppLock(mode, opts = {}) {
    appLockState = { mode, entry: '', first: '', tries: 0, forced: !!opts.forced };
    document.activeElement?.blur?.();
    const scr = $('applock-screen');
    scr.classList.remove('hidden');
    document.body.classList.add('locked', 'app-locked');
    $('applock-avatar').innerHTML = avatarHtml(myDisplayName(), myAvatarUrl(), 'avatar-lg', session?.username || '');
    renderAppLock();
    // البصمة لحالها لما تقفل (الأندرويد بيسمح؛ الآيفون بدّه كبسة فبيضل الزر)
    if (mode === 'unlock' && appLockMine()?.cred) setTimeout(() => unlockWithBiometric(true), 250);
}

function hideAppLock() {
    appLockState = null;
    $('applock-screen').classList.add('hidden');
    document.body.classList.remove('app-locked');
    if ($('login-screen').classList.contains('hidden')) document.body.classList.remove('locked');
    appLockTouch(true);
}

function renderAppLock() {
    const s = appLockState;
    if (!s) return;
    const cfg = appLockMine();
    const titles = {
        unlock: [`أهلاً ${escapeHtml(myDisplayName())}`, 'البرنامج مقفول · اكتب الرمز'],
        setup: [s.forced ? 'حط رمز للبرنامج' : 'رمز جديد', s.forced ? 'المدير شغّل قفل البرنامج على كل الأجهزة. اختار 4 أرقام بتفتح فيهم' : 'اختار 4 أرقام بتفتح فيهم البرنامج'],
        confirm: ['أكّد الرمز', 'اكتب نفس الأرقام مرة كمان']
    };
    $('applock-title').innerHTML = titles[s.mode][0];
    $('applock-sub').textContent = titles[s.mode][1];
    $('applock-dots').innerHTML = [0, 1, 2, 3].map(i => `<i class="${i < s.entry.length ? 'on' : ''}"></i>`).join('');
    $('applock-bio').classList.toggle('invisible', !(s.mode === 'unlock' && cfg?.cred));
    $('applock-forgot').classList.toggle('hidden', s.mode !== 'unlock');
    $('applock-cancel').classList.toggle('hidden', s.mode === 'unlock' || s.forced);
}

function appLockError(text) {
    const dots = $('applock-dots');
    $('applock-error').textContent = text;
    dots.classList.remove('shake');
    void dots.offsetWidth;
    dots.classList.add('shake');
    if (navigator.vibrate) try { navigator.vibrate(120); } catch (e) { /* عادي */ }
}

function onAppLockKey(e) {
    if (!appLockState) return;
    if (/^[0-9٠-٩]$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); appLockDigit(latinDigits(e.key)); }
    else if (e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); appLockBack(); }
    else if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); }
}

function appLockBack() {
    if (!appLockState) return;
    appLockState.entry = appLockState.entry.slice(0, -1);
    renderAppLock();
}

function appLockDigit(d) {
    const s = appLockState;
    if (!s || s.entry.length >= 4 || s.busy) return;
    s.entry += d;
    $('applock-error').textContent = '';
    renderAppLock();
    if (s.entry.length === 4) setTimeout(appLockComplete, 120);
}

async function appLockComplete() {
    const s = appLockState;
    if (!s || s.entry.length !== 4) return;
    if (s.mode === 'setup') {
        s.first = s.entry; s.entry = ''; s.mode = 'confirm';
        return renderAppLock();
    }
    if (s.mode === 'confirm') {
        if (s.entry !== s.first) {
            s.entry = ''; s.first = ''; s.mode = 'setup';
            renderAppLock();
            return appLockError('الرمزين مش نفس الشي، جرّب من جديد');
        }
        const salt = b64url(appLockRandom(12));
        const prev = appLockMine() || {};
        appLockSaveMine({ salt, pin: await appLockHash(salt, s.entry), cred: prev.cred || '', mins: prev.mins ?? 5 });
        hideAppLock();
        renderAppLockProfile();
        updateAppLockMenu();
        showToast('انحفظ الرمز', `البرنامج بيتقفل ${appLockMinsText(appLockMins())}`, 'success');
        // البصمة اختيارية بعد الرمز
        if (!prev.cred && await biometricAvailable()) offerBiometric();
        return;
    }
    // فتح
    const cfg = appLockMine();
    s.busy = true;
    const ok = cfg && (await appLockHash(cfg.salt, s.entry)) === cfg.pin;
    s.busy = false;
    if (ok) return hideAppLock();
    s.tries++;
    s.entry = '';
    renderAppLock();
    const left = APPLOCK_MAX_TRIES - s.tries;
    if (left <= 0) return appLockSignOut('5 مرات رمز غلط');
    appLockError(`الرمز غلط · ضايل ${left === 1 ? 'محاولة وحدة' : left === 2 ? 'محاولتين' : `${left} محاولات`}`);
}

// نسي الرمز أو غلط كثير: خروج من الحساب على هالجهاز (العمليات المعلقة بتضل وبتنبعت بعد الدخول)
async function appLockSignOut(reason = '') {
    appLockSaveMine(null);
    try { await Promise.race([postToSheets({ action: 'logout', pushToken: pushLocal()?.token || '' }), new Promise(r => setTimeout(r, 3000))]); } catch (e) { /* عادي */ }
    savePushLocal(null);
    clearSnapshot();
    session = { username: session?.username || '', auth: true };
    saveSession();
    try { sessionStorage.setItem('fastpay_lock_reason', reason || 'نسيت رمز القفل'); } catch (e) { /* عادي */ }
    location.reload();
}

function askAppLockForgot() {
    showAppConfirm('نسيت الرمز؟', 'بنطلّعك من الحساب على هالجهاز، وبتدخل من جديد باسمك وكلمة السر. العمليات اللي ما وصلت بتضل وبتنبعت بعد الدخول.', () => appLockSignOut('نسيت رمز القفل'));
}

// ---------- البصمة / Face ID (WebAuthn على الجهاز نفسه) ----------
async function biometricAvailable() {
    try {
        return !!(window.isSecureContext && window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    } catch (e) { return false; }
}

async function enableBiometric() {
    const cfg = appLockMine();
    if (!cfg?.pin) return showToast('حط رمز أول', 'البصمة بتشتغل مع الرمز', 'warning');
    if (!(await biometricAvailable())) return showToast('ما بينفع هون', 'هالجهاز أو المتصفح ما بيدعم البصمة للمواقع', 'warning');
    try {
        const cred = await navigator.credentials.create({
            publicKey: {
                challenge: appLockRandom(32),
                rp: { name: 'فاست باي' },
                user: { id: appLockRandom(16), name: session.username, displayName: myDisplayName() },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
                timeout: 60000
            }
        });
        if (!cred) return;
        appLockSaveMine({ ...appLockMine(), cred: b64url(cred.rawId) });
        renderAppLockProfile();
        showToast('تمام', 'بتقدر تفتح البرنامج بالبصمة / Face ID', 'success');
    } catch (e) {
        if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') showToast('ما زبطت البصمة', 'جرّب كمان مرة، أو ضل عالرمز', 'warning');
    }
}

function offerBiometric() {
    showAppConfirm('تفتح بالبصمة؟', 'بدل ما تكتب الرمز كل مرة، بتفتح البرنامج ببصمتك أو وجهك. الرمز بيضل احتياط.', enableBiometric);
}

function disableBiometric() {
    appLockSaveMine({ ...appLockMine(), cred: '' });
    renderAppLockProfile();
}

async function unlockWithBiometric(auto = false) {
    const cfg = appLockMine();
    if (!appLockState || appLockState.mode !== 'unlock' || !cfg?.cred || appLockState.bioBusy) return;
    appLockState.bioBusy = true;
    try {
        const r = await navigator.credentials.get({
            publicKey: {
                challenge: appLockRandom(32),
                allowCredentials: [{ type: 'public-key', id: unb64url(cfg.cred), transports: ['internal'] }],
                userVerification: 'required',
                timeout: 60000
            }
        });
        if (r && appLockState) hideAppLock();
    } catch (e) {
        if (!auto && appLockState) appLockError('ما زبطت البصمة، اكتب الرمز');
    } finally {
        if (appLockState) appLockState.bioBusy = false;
    }
}

// ---------- "ملفي": قفل هالجهاز ----------
async function renderAppLockProfile() {
    const box = $('pf_lock');
    if (!box) return;
    const wrap = $('pf_lock_wrap');
    wrap.classList.toggle('hidden', !session?.token);
    if (!session?.token) return;
    const cfg = appLockMine();
    const forced = appLockForced();
    const bio = await biometricAvailable();
    const mins = appLockMins();
    const minsSelect = forced
        ? `<span class="text-slate-500">بيتقفل ${appLockMinsText(mins)} (المدير محدّدها)</span>`
        : `<label class="flex flex-wrap items-center gap-2"><span class="text-slate-600">يتقفل</span>
               <select data-applock-mins class="field text-xs font-bold py-1.5">
                   ${APPLOCK_MIN_OPTIONS.map(m => `<option value="${m}" ${m === mins ? 'selected' : ''}>${m === 0 ? 'فوراً لما أطلع منه' : m === 1 ? 'بعد دقيقة' : `بعد ${m} ${m <= 10 ? 'دقايق' : 'دقيقة'}`}</option>`).join('')}
               </select></label>`;
    if (!cfg?.pin) {
        box.innerHTML = `
            <p class="text-slate-500 leading-5">لو الجوال ضاع أو حدا مسكه وهو مفتوح: البرنامج بيتقفل لحاله وبيفتح برمز 4 أرقام${bio ? ' أو بالبصمة' : ''}.</p>
            <button type="button" data-action="applock-setup" class="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-lg">🔒 حط رمز للبرنامج</button>`;
        return;
    }
    box.innerHTML = `
        <div class="applock-status">✓ شغّال على هالجهاز${cfg.cred ? ' · بالبصمة والرمز' : ' · بالرمز'}</div>
        ${minsSelect}
        <div class="flex flex-wrap gap-2">
            <button type="button" data-action="applock-now" class="applock-btn">🔒 اقفل هلّق</button>
            <button type="button" data-action="applock-setup" class="applock-btn">غيّر الرمز</button>
            ${bio ? (cfg.cred
                ? '<button type="button" data-action="applock-bio-off" class="applock-btn">شيل البصمة</button>'
                : '<button type="button" data-action="applock-bio-on" class="applock-btn">☝️ فعّل البصمة / Face ID</button>') : ''}
            ${forced ? '' : '<button type="button" data-action="applock-off" class="applock-btn text-rose-600">شيل القفل</button>'}
        </div>`;
}

function onAppLockMinsChange(e) {
    if (!e.target.matches('[data-applock-mins]')) return;
    appLockSaveMine({ ...appLockMine(), mins: Number(e.target.value) });
    showToast('انحفظ', `البرنامج بيتقفل ${appLockMinsText(appLockMins())}`, 'success');
}

function removeAppLock() {
    showAppConfirm('تشيل القفل؟', 'البرنامج ما رح يطلب رمز على هالجهاز.', () => {
        appLockSaveMine(null);
        renderAppLockProfile();
        updateAppLockMenu();
        showToast('انشال القفل', '', 'success');
    });
}

function lockAppNow() {
    if (!appLockOn()) return;
    closeModal('profileModal');
    closeUserMenu();
    showAppLock('unlock');
}

// زر "اقفل هلّق" بقائمة الصورة الشخصية
function updateAppLockMenu() {
    $('applock-menu-btn')?.classList.toggle('hidden', !appLockOn());
}

// ---------- إعداد المدير (الإعدادات ← الحماية) ----------
function renderAppLockSettings() {
    const sec = $('applock-section');
    if (!sec) return;
    const on = appLockForced();
    const btn = $('applock-force-toggle');
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.lastChild.textContent = on ? 'شغّال' : 'مسكّر';
    $('applock_mins').value = String(APPLOCK_MIN_OPTIONS.includes(toNum(globalConfig.appLockMins, 5)) ? toNum(globalConfig.appLockMins, 5) : 5);
    $('applock_mins_row').classList.toggle('hidden', !on);
}

function toggleAppLockForce() {
    globalConfig.appLockForce = appLockForced() ? 'no' : 'yes';
    if (globalConfig.appLockMins === undefined || globalConfig.appLockMins === '') globalConfig.appLockMins = 5;
    saveAll();
    renderAppLockSettings();
    showToast('انحفظ', appLockForced() ? 'كل موظف لازم يحط رمز على جهازه أول ما يفتح البرنامج' : 'القفل صار اختياري لكل واحد من "ملفي"', 'success');
    checkAppLockRequired();
}

function saveAppLockMins() {
    globalConfig.appLockMins = Number($('applock_mins').value);
    saveAll();
    showToast('انحفظ', `البرنامج بيتقفل ${appLockMinsText(appLockMins())}`, 'success');
}

function bindAppLockEvents() {
    $('applock-keys').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-k]');
        if (!b) return;
        const k = b.dataset.k;
        if (k === 'back') appLockBack();
        else if (k === 'bio') unlockWithBiometric();
        else appLockDigit(k);
    });
    $('profileModal').addEventListener('change', onAppLockMinsChange);
    $('applock_mins')?.addEventListener('change', saveAppLockMins);
}
