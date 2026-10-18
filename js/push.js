'use strict';

// فاست باي — إشعارات الجوال (Firebase Cloud Messaging، بطلب عماد 2026-10-18)
// الإشعار بيوصل على شاشة الجوال والبرنامج مسكّر. الشيت بيضل المصدر الوحيد، وفاير بيز بس بيوصّل:
// - الجهاز: "فعّل الإشعارات على هالجهاز" (بكبسة، لأن الآيفون ما بيسمح بطلب الإذن بدونها) ← إذن ← عامل الخلفية
//   firebase-messaging-sw.js ← رمز الجهاز من فاير بيز ← push_register للسكربت (ورقة "_أجهزة الإشعارات").
// - السكربت بيبعت لأجهزة اللي وصلهم الإشعار أو الرد (notify_send / notify_reply).
// - المدير بيجهّزها مرة من الإعدادات ← "إشعارات الجوال": إعداد الويب + مفتاح VAPID + ملف حساب الخدمة (push_setup).
// بيشتغل بس على رابط https (البرنامج المرفوع)، مش من الملف على الماك. الآيفون: من البرنامج المضاف للشاشة الرئيسية (iOS 16.4+).

const PUSH_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
// من رد list: { web: إعداد فاير بيز للمتصفح, ready, projectId?, devices? (للمدير) }
let pushState = null;
let pushBusy = false;
let pushAccountText = '';
let pushSetupWasReady = null;

function pushLocal() {
    const v = loadJSON(STORAGE.push, null);
    return v && typeof v === 'object' && v.token ? v : null;
}

function savePushLocal(v) {
    try {
        if (v) localStorage.setItem(STORAGE.push, JSON.stringify(v));
        else localStorage.removeItem(STORAGE.push);
    } catch (e) { /* التخزين محظور */ }
}

const isStandalone = () => !!(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);

// هالجهاز بيقدر يستقبل؟ 'ok' / 'file' (مش على https) / 'ios-browser' (آيفون من سفاري مش من الشاشة الرئيسية) / 'unsupported'
function pushSupport() {
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    if (location.protocol !== 'https:' && !local) return 'file';
    if (isIOS() && !isStandalone()) return 'ios-browser';
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
    return 'ok';
}

const PUSH_SUPPORT_TEXT = {
    file: 'إشعارات الجوال بتشتغل من رابط البرنامج المرفوع (https)، مش من الملف على الجهاز',
    'ios-browser': 'على الآيفون: افتح البرنامج من سفاري ← زر المشاركة ← "إضافة إلى الشاشة الرئيسية"، وافتحه من الأيقونة وفعّل من هناك',
    unsupported: 'هالمتصفح ما بيدعم إشعارات الجوال. جرّب كروم أو سفاري محدّث'
};

// إشعارات الجوال جاهزة لهالجهاز (السكربت مجهّز وفاير بيز مضبوط والجهاز بيدعم)
const pushUsable = () => !!pushState?.ready && sheetHas('push');

// من رد list (الكامل والسريع)
function applyPushState(state, full) {
    const before = JSON.stringify(pushState);
    pushState = state && typeof state === 'object' ? state : null;
    if (JSON.stringify(pushState) !== before) {
        renderPushControls();
        if (!pageHidden('settings')) renderPushSettings();
    }
    if (full) refreshPushToken();
}

// ---------- فاير بيز (بيتحمّل بس لما نحتاجه) ----------
const pushScripts = {};
function loadScriptOnce(src) {
    pushScripts[src] ??= new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => { delete pushScripts[src]; reject(new Error('sdk_load')); };
        document.head.appendChild(s);
    });
    return pushScripts[src];
}

async function pushMessaging() {
    const web = pushState?.web;
    if (!web?.apiKey) throw new Error('not_configured');
    await loadScriptOnce(PUSH_SDK + 'firebase-app-compat.js');
    await loadScriptOnce(PUSH_SDK + 'firebase-messaging-compat.js');
    const { vapidKey, ...cfg } = web;
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    // الإعداد بيوصل لعامل الخلفية بالرابط (ما بيقدر يقرا ذاكرة الصفحة)
    const reg = await navigator.serviceWorker.register('firebase-messaging-sw.js?cfg=' + encodeURIComponent(JSON.stringify(cfg)), { scope: './' });
    await navigator.serviceWorker.ready;
    return { messaging: firebase.messaging(app), reg, vapidKey };
}

// "آيفون · التطبيق" / "أندرويد · Chrome" / "ماك · Safari": حتى المدير يعرف أجهزة مين
function pushDeviceLabel() {
    const ua = navigator.userAgent;
    const os = isIOS() ? (/iPad/.test(ua) || isIPadOS() ? 'آيباد' : 'آيفون') : /Android/.test(ua) ? 'أندرويد' : /Mac/.test(ua) ? 'ماك' : /Windows/.test(ua) ? 'ويندوز' : 'جهاز';
    const browser = isStandalone() ? 'التطبيق' : /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '';
    return [os, browser].filter(Boolean).join(' · ');
}

// الكبسة على الإشعار بتفتح نفس الرابط اللي فعّلت منه
const pushLink = () => location.href.split('#')[0].split('?')[0];

async function registerPushToken(token, oldToken = '') {
    const r = await postToSheets({ action: 'push_register', pushToken: token, oldToken, device: pushDeviceLabel(), link: pushLink() });
    if (r.status !== 'ok' || !r.data?.ok) throw new Error(r.data?.error || r.error || 'failed');
    savePushLocal({ token, user: session?.username || '', at: Date.now() });
}

const PUSH_ERRORS = {
    sdk_load: 'ما قدر يحمّل فاير بيز. تأكد من النت',
    not_configured: 'المدير لازم يجهّز إشعارات الجوال من الإعدادات أول',
    network: 'ما وصل رد من الشيت. تأكد من النت',
    offline: 'ما في نت',
    unknown_action: 'حدّث السكربت أولاً'
};

function pushErrorText(err) {
    const msg = String(err?.message || err || '');
    if (PUSH_ERRORS[msg]) return PUSH_ERRORS[msg];
    if (/messaging\/permission-blocked|permission/i.test(msg)) return 'الإشعارات مسكّرة للبرنامج من إعدادات الجوال أو المتصفح';
    if (/ServiceWorker/i.test(msg)) return 'المتصفح ما سمح بتشغيل الإشعارات بالخلفية. جرّب كروم أو سفاري محدّث، ومن رابط البرنامج (https)';
    if (/messaging\/token-subscribe-failed|authentication|API key/i.test(msg)) return 'إعداد فاير بيز فيه غلط (المفتاح أو مفتاح VAPID). راجعه بالإعدادات';
    return 'صار خطأ: ' + msg.slice(0, 120);
}

// تفعيل على هالجهاز (لازم من كبسة)
async function enablePush() {
    if (pushBusy) return;
    const support = pushSupport();
    if (support !== 'ok') return showToast('إشعارات الجوال', PUSH_SUPPORT_TEXT[support], 'warning');
    if (!pushUsable()) return showToast('إشعارات الجوال مش مجهّزة', PUSH_ERRORS.not_configured, 'warning');
    pushBusy = true;
    renderPushControls();
    try {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return showToast('الإذن مرفوض', 'فعّل الإشعارات للبرنامج من إعدادات الجوال أو المتصفح، وجرّب مرة ثانية', 'warning');
        const { messaging, reg, vapidKey } = await pushMessaging();
        const token = await messaging.getToken({ vapidKey, serviceWorkerRegistration: reg });
        if (!token) throw new Error('no_token');
        const old = pushLocal();
        await registerPushToken(token, old && old.token !== token ? old.token : '');
        showToast('✓ الإشعارات شغّالة على هالجهاز', 'رح يوصلك الإشعار حتى والبرنامج مسكّر', 'success');
    } catch (err) {
        console.error('Push enable failed:', err);
        showToast('ما زبط تفعيل الإشعارات', pushErrorText(err), 'error');
    } finally {
        pushBusy = false;
        renderPushControls();
    }
}

async function disablePush() {
    const local = pushLocal();
    if (!local || pushBusy) return;
    pushBusy = true;
    renderPushControls();
    try {
        await postToSheets({ action: 'push_unregister', pushToken: local.token });
        try { (await pushMessaging()).messaging.deleteToken(); } catch (e) { /* مش ضروري */ }
        savePushLocal(null);
        showToast('انطفت إشعارات الجوال على هالجهاز', 'الإشعارات بتضل بالجرس جوّا البرنامج', 'info');
    } finally {
        pushBusy = false;
        renderPushControls();
    }
}

// بعد كل تحميل كامل: إذا الجهاز مفعّل، بنتأكد إنه الرمز ما تغيّر (فاير بيز بيجدده أحياناً) وإنه مسجّل للمستخدم الحالي.
// مرة باليوم على الأكثر، وبدون أي سؤال
async function refreshPushToken() {
    const local = pushLocal();
    if (!local || !pushUsable() || pushSupport() !== 'ok' || Notification.permission !== 'granted' || pushBusy) return;
    const sameUser = local.user === (session?.username || '');
    if (sameUser && Date.now() - (local.at || 0) < 86400000) return;
    try {
        const { messaging, reg, vapidKey } = await pushMessaging();
        const token = await messaging.getToken({ vapidKey, serviceWorkerRegistration: reg });
        if (token) await registerPushToken(token, token !== local.token ? local.token : '');
    } catch (err) {
        console.warn('Push refresh failed:', err);
    }
}

// ---------- زر الجهاز (بقائمة الإشعارات) ----------
// بيحل محل "فعّل إشعارات المتصفح" لما إشعارات الجوال مجهّزة
function renderPushControls() {
    const btn = $('notify-perm-btn');
    const off = $('notify-push-off');
    if (!btn) return;
    if (!pushUsable()) {
        off.classList.add('hidden');
        return renderBrowserNotifyButton();
    }
    const support = pushSupport();
    const on = support === 'ok' && !!pushLocal() && Notification.permission === 'granted';
    btn.classList.remove('hidden');
    btn.disabled = pushBusy || on || support !== 'ok';
    btn.textContent = pushBusy ? '…' : on ? '✓ الإشعارات شغّالة على هالجهاز'
        : support === 'ok' ? (Notification.permission === 'denied' ? 'الإشعارات ممنوعة من إعدادات الجهاز' : '📲 فعّل الإشعارات على هالجهاز')
        : support === 'ios-browser' ? '📲 أضف البرنامج للشاشة الرئيسية أول' : 'هالجهاز ما بيدعم إشعارات الجوال';
    btn.title = support === 'ok' ? '' : PUSH_SUPPORT_TEXT[support];
    off.classList.toggle('hidden', !on);
    off.disabled = pushBusy;
}

function onNotifyPermissionClick() {
    if (!pushUsable()) return requestNotifyPermission();
    const support = pushSupport();
    if (support !== 'ok') return showToast('إشعارات الجوال', PUSH_SUPPORT_TEXT[support], 'warning');
    return enablePush();
}

// ---------- الإعدادات ← إشعارات الجوال (للمدير: الإعدادات + المستخدمين) ----------
// إعداد الويب من فاير بيز (const firebaseConfig = {...}) أو JSON
function parseFirebaseConfig(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) {
        obj = {};
        const re = /([A-Za-z]+)\s*:\s*["']([^"']+)["']/g;
        let m;
        while ((m = re.exec(raw))) obj[m[1]] = m[2];
    }
    return obj && obj.apiKey ? obj : null;
}

function renderPushSettings() {
    const card = $('push-settings');
    if (!card) return;
    const admin = hasPerm('settings') && hasPerm('users');
    card.classList.toggle('hidden', !admin || !authEnabled);
    if (!admin) return;
    const scriptOk = sheetHas('push');
    const st = pushState || {};
    $('push-script-note').classList.toggle('hidden', scriptOk);
    $('push-status').innerHTML = !scriptOk ? '<span class="text-amber-700 font-bold">السكربت المنشور قديم: انشر السكربت الجديد أول</span>'
        : st.ready ? `<span class="text-emerald-700 font-bold">✓ مجهّزة</span> · المشروع <bdi class="ltr-num">${escapeHtml(st.projectId || st.web?.projectId || '')}</bdi> · ${st.devices || 0} جهاز مفعّل`
        : st.web ? '<span class="text-amber-700 font-bold">ناقص ملف حساب الخدمة (الخطوة 3)</span>'
        : st.projectId ? '<span class="text-amber-700 font-bold">ناقص إعداد الويب ومفتاح VAPID (الخطوة 2)</span>'
        : '<span class="text-slate-500 font-bold">مش مجهّزة لسا</span>';
    // الخطوات بتتسكّر لحالها أول ما يكتمل الإعداد (بتضل تحت "تغيير إعداد فاير بيز")
    if (st.ready !== pushSetupWasReady) {
        $('push-setup-box').open = !st.ready;
        pushSetupWasReady = !!st.ready;
    }
    if (st.web && !$('push_web_config').value) $('push_web_config').placeholder = `مضبوط (${st.web.projectId}). الصق إعداد جديد بس إذا بدك تغيّره`;
    if (st.web?.vapidKey && !$('push_vapid').value) $('push_vapid').placeholder = 'مضبوط. الصق مفتاح جديد بس إذا بدك تغيّره';
    $('push_account_name').textContent = pushAccountText ? '✓ ' + (pushAccountProject() || 'ملف') : st.ready || st.projectId ? 'مرفوع للسكربت (ما بيرجع للبرنامج)' : 'ما انختار ملف';
    ['push-save-btn', 'push-test-btn', 'push-clear-btn'].forEach(id => { $(id).disabled = !scriptOk; });
    $('push-test-btn').classList.toggle('hidden', !st.ready);
    $('push-clear-btn').classList.toggle('hidden', !st.web && !st.projectId);
}

function pushAccountProject() {
    try { return JSON.parse(pushAccountText).project_id || ''; } catch (e) { return ''; }
}

function onPushAccountFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const text = String(reader.result || '');
        let a = null;
        try { a = JSON.parse(text); } catch (e) { a = null; }
        if (!a || a.type !== 'service_account' || !a.private_key) {
            pushAccountText = '';
            showToast('هاد مش ملف حساب الخدمة', 'من فاير بيز: إعدادات المشروع ← Service accounts ← Generate new private key', 'warning');
        } else pushAccountText = text;
        renderPushSettings();
    };
    reader.readAsText(file);
}

const PUSH_SETUP_ERRORS = {
    bad_web_config: 'إعداد الويب ناقص: الصق كل اللي جوّا firebaseConfig (فيه apiKey و projectId و messagingSenderId و appId)',
    bad_vapid: 'مفتاح VAPID غلط: من Cloud Messaging ← Web Push certificates ← Key pair',
    bad_account: 'ملف حساب الخدمة غلط',
    project_mismatch: 'إعداد الويب وملف حساب الخدمة من مشروعين مختلفين بفاير بيز',
    forbidden: 'بدها صلاحية الإعدادات والمستخدمين',
    unknown_action: 'حدّث السكربت أولاً'
};

async function savePushSettings() {
    const webText = $('push_web_config').value.trim();
    const vapid = $('push_vapid').value.trim();
    const payload = { action: 'push_setup' };
    if (webText || vapid) {
        const cfg = webText ? parseFirebaseConfig(webText) : { ...(pushState?.web || {}) };
        if (!cfg?.apiKey) return showToast('إعداد الويب مش واضح', PUSH_SETUP_ERRORS.bad_web_config, 'warning');
        cfg.vapidKey = vapid || pushState?.web?.vapidKey || '';
        payload.web = cfg;
    }
    if (pushAccountText) payload.account = pushAccountText;
    if (!payload.web && !payload.account) return showToast('ما في إشي جديد', 'الصق إعداد الويب ومفتاح VAPID، واختار ملف حساب الخدمة', 'info');
    const btn = $('push-save-btn');
    btn.disabled = true;
    try {
        const r = await postToSheets(payload);
        if (r.status !== 'ok' || !r.data?.ok) {
            return showToast('ما انحفظ', PUSH_SETUP_ERRORS[r.data?.error || r.error] || PUSH_ERRORS[r.error] || 'تأكد من النت وجرّب مرة ثانية', 'error');
        }
        pushAccountText = '';
        $('push_web_config').value = '';
        $('push_vapid').value = '';
        applyPushState(r.data.push);
        renderPushSettings();
        showToast(r.data.push?.ready ? '✓ إشعارات الجوال جاهزة' : 'انحفظ', r.data.push?.ready ? 'هلّق كل موظف بيفعّلها على جواله من قائمة الإشعارات 🔔' : 'كمّل الخطوات الناقصة', 'success');
    } finally {
        btn.disabled = false;
    }
}

async function testPush() {
    const r = await postToSheets({ action: 'push_test' });
    if (r.status === 'ok' && r.data?.ok) return showToast('انبعت إشعار تجربة', `لـ ${r.data.sent} من أجهزتك. إذا ما وصل خلال دقيقة، فعّل الإشعارات على الجهاز من جديد`, 'success');
    const e = r.data?.error || r.error;
    showToast('ما انبعت', e === 'no_devices' ? 'ما في جهاز مفعّل إلك. فعّل من قائمة الإشعارات 🔔 على الجوال أول'
        : e === 'send_failed' ? 'فاير بيز رفض: راجع ملف حساب الخدمة، أو فعّل الجهاز من جديد' : PUSH_ERRORS[e] || 'تأكد من النت', 'error');
}

function clearPushSettings() {
    showAppConfirm('إيقاف إشعارات الجوال', 'بينمسح إعداد فاير بيز من السكربت، وبتوقف إشعارات الجوال عند الكل (الجرس جوّا البرنامج بيضل شغّال).', async () => {
        const r = await postToSheets({ action: 'push_setup', clear: true });
        if (r.status !== 'ok' || !r.data?.ok) return showToast('ما انمسح', PUSH_ERRORS[r.error] || 'تأكد من النت', 'error');
        applyPushState(r.data.push);
        renderPushSettings();
        showToast('انمسح إعداد إشعارات الجوال', '', 'info');
    });
}

function bindPushEvents() {
    $('push_account_input').addEventListener('change', (e) => {
        onPushAccountFile(e.target.files[0]);
        e.target.value = '';
    });
}
