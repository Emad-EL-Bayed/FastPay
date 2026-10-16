'use strict';

// فاست باي — الإشعارات: رسالة من اللي معه صلاحية "إرسال إشعارات" لموظفين بيختارهم (أو "الكل")، والموظف بيرد.
// بتوصل مع التحديث الحيّ (كل دقيقتين، رد list فيه notifications)، وإذا الصفحة مخفية بطلب خفيف لحالها (notify_poll)
// حتى يطلع إشعار المتصفح. الجرس بالهيدر عليه عدد اللي لسا ما انقرت، و"مهم" بيطلع بنافذة لازم "قرأت".
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

const NOTIFY_ALL = 'الكل';
const NOTIFY_POLL_MS = 2 * 60 * 1000;
let notifications = [];   // {id, at, from, to: [..] أو 'الكل', text, important, replyTo, readBy: {user: at}}
let notifyTeam = [];      // [{u, n}] اللي بقدر أبعتلهم (لصاحب الصلاحية)
let notifyLoaded = false; // بعد أول تحميل: الجديد بيطلع تنبيه وصوت
let notifyCursor = null;
let notifyLastPoll = 0;
let notifyHighlight = new Set(); // اللي كانت مش مقروءة لما فتحت القائمة
let notifyReplyOpen = null;      // {root, to, draft}
let notifyAlertId = null;
const notifyDismissed = new Set();

const notifyMe = () => session?.username || '';
const notifyEnabled = () => authEnabled && !!notifyMe() && sheetHas('notify');
const notifyForMe = (n) => n.from !== notifyMe() && (n.to === NOTIFY_ALL || n.to.includes(notifyMe()));
const notifyUnread = (n) => notifyForMe(n) && !n.readBy[notifyMe()];

function normalizeNotification(n) {
    return {
        id: String(n?.id ?? '').trim(),
        at: String(n?.at ?? ''),
        from: String(n?.from ?? ''),
        to: n?.to === NOTIFY_ALL ? NOTIFY_ALL : (Array.isArray(n?.to) ? n.to.map(String) : []),
        text: String(n?.text ?? ''),
        important: !!n?.important,
        replyTo: String(n?.replyTo ?? ''),
        readBy: n?.readBy && typeof n.readBy === 'object' ? n.readBy : {}
    };
}

// من رد list أو notify_poll: دمج حسب الرقم، والجديد اللي إلي بيطلع تنبيه
function applyNotifications(list, { full = false } = {}) {
    if (!Array.isArray(list)) return;
    // المحذوف (أو المشال من عندي) من جهاز ثاني بيوصل {id, removed}
    const removed = new Set(list.filter(n => n?.removed).map(n => String(n.id)));
    const incoming = list.filter(n => !n?.removed).map(normalizeNotification).filter(n => n.id);
    const known = new Set(notifications.map(n => n.id));
    const byId = new Map(full ? [] : notifications.map(n => [n.id, n]));
    removed.forEach(id => byId.delete(id));
    incoming.forEach(n => byId.set(n.id, n));
    notifications = [...byId.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const fresh = notifyLoaded ? incoming.filter(n => !known.has(n.id) && notifyUnread(n)) : [];
    notifyLoaded = true;
    const panelOpen = !$('notifyModal').classList.contains('hidden');
    // القائمة مفتوحة قدامه: الجديد بينقرأ فوراً (وبيضل مميّز)
    if (panelOpen && !document.hidden && fresh.length) {
        fresh.forEach(n => notifyHighlight.add(n.id));
        markNotifyRead(fresh.map(n => n.id));
    }
    renderNotifyBadge();
    if (panelOpen) renderNotifyList();
    fresh.forEach(announceNotification);
    // نافذة "مهم" لرسالة انحذفت: بتتسكّر
    if (notifyAlertId && !notifications.some(n => n.id === notifyAlertId)) {
        notifyAlertId = null;
        closeModal('notifyAlertModal');
    }
    showNextImportant();
}

function renderNotifyBadge() {
    const on = notifyEnabled();
    $('notify-btn').classList.toggle('hidden', !on);
    const count = on ? notifications.filter(notifyUnread).length : 0;
    $('notify-count').textContent = count > 99 ? '99+' : String(count);
    $('notify-count').classList.toggle('hidden', !count);
    // عدد اللي ما انقرت بعنوان الصفحة، حتى يبين وإنت على صفحة ثانية
    document.title = (count ? `(${count}) ` : '') + (globalConfig.companyName || 'فاست باي');
}

// ---------- وصول إشعار جديد: تنبيه، صوت، وإشعار المتصفح إذا الصفحة مخفية ----------
function notifyTitle(n) {
    return `${n.replyTo ? 'رد من' : n.important ? 'إشعار مهم من' : 'إشعار من'} ${personName(n.from)}`;
}

function announceNotification(n) {
    showToast('🔔 ' + notifyTitle(n), n.text.length > 140 ? n.text.slice(0, 140) + '…' : n.text, n.important ? 'warning' : 'info');
    notifyBeep();
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        const sys = new Notification(notifyTitle(n), { body: n.text, icon: 'assets/icon-192.png', tag: 'fastpay-' + n.id });
        sys.onclick = () => { window.focus(); sys.close(); openNotifyPanel(); };
    } catch (e) { /* بعض الجوالات ما بتسمح بإشعار من الصفحة نفسها */ }
}

// صوت قصير (نغمتين) بدون ملف. المتصفح ما بيسمح بالصوت قبل أول كبسة بالصفحة، فبنجهّزه معها
function notifyAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!notifyAudio.ctx) notifyAudio.ctx = new Ctx();
    return notifyAudio.ctx;
}

function notifyBeep() {
    if (globalConfig.notifySound === false) return;
    try {
        const ctx = notifyAudio();
        if (!ctx || ctx.state !== 'running') return;
        [[880, 0], [1175, 0.16]].forEach(([freq, delay]) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            const t = ctx.currentTime + delay;
            o.type = 'sine';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
            o.connect(g);
            g.connect(ctx.destination);
            o.start(t);
            o.stop(t + 0.32);
        });
    } catch (e) { /* بدون صوت */ }
}

// ---------- "مهم": نافذة ما بتسكّر إلا بـ "قرأت" ----------
function showNextImportant() {
    if (notifyAlertId || !$('notifyAlertModal').classList.contains('hidden')) return;
    const n = notifications.find(x => x.important && notifyUnread(x) && !notifyDismissed.has(x.id));
    if (!n) return;
    notifyAlertId = n.id;
    $('notify-alert-from').textContent = `${notifyTitle(n)} · ${notifyWhen(n.at)}`;
    $('notify-alert-from').title = notifyFullTime(n.at);
    $('notify-alert-text').textContent = n.text;
    openModal('notifyAlertModal');
}

// من نافذة "مهم": قرأت وبدي أرد
function replyFromAlert() {
    const id = notifyAlertId;
    ackImportant();
    openNotifyPanel();
    if (id) openNotifyReply({ dataset: { root: id, to: '' } });
}

function ackImportant() {
    const id = notifyAlertId;
    notifyAlertId = null;
    closeModal('notifyAlertModal');
    if (id) {
        notifyDismissed.add(id);
        markNotifyRead([id]);
    }
    setTimeout(showNextImportant, 250);
}

// ---------- قائمة الإشعارات ----------
function openNotifyPanel() {
    if (!notifyEnabled()) return;
    notifyHighlight = new Set(notifications.filter(notifyUnread).map(n => n.id));
    $('notify-new-btn').classList.toggle('hidden', !hasPerm('notify'));
    renderNotifyList();
    renderNotifyFoot();
    openModal('notifyModal');
    $('notify-list').scrollTop = 0;
    if (notifyHighlight.size) markNotifyRead([...notifyHighlight]);
}

function markNotifyRead(ids) {
    const me = notifyMe();
    const list = ids.filter(id => { const n = notifications.find(x => x.id === id); return n && notifyUnread(n); });
    if (!list.length) return;
    const now = localDateStr() + ' ' + new Date().toTimeString().slice(0, 8);
    list.forEach(id => { notifications.find(x => x.id === id).readBy[me] = now; });
    renderNotifyBadge();
    postToSheets({ action: 'notify_read', ids: list });
}

// الوقت: "الآن"، "قبل 5 دقايق"، "قبل ساعتين"، "أمس 3:45 م"، وأقدم "14/10 · 3:45 م".
// الوقف بالماوس بيعطي اليوم والتاريخ والساعة كاملة (notifyFullTime). الوقت من السكربت بتوقيت فلسطين
const notifyDate = (at) => { const d = new Date(String(at).replace(' ', 'T')); return isNaN(d) ? null : d; };

function clock12(d) {
    const h = d.getHours();
    return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
}

function notifyWhen(at) {
    const d = notifyDate(at);
    if (!d) return String(at);
    const mins = Math.floor((Date.now() - d) / 60000);
    if (mins < 1) return 'الآن';
    if (mins < 60) return mins === 1 ? 'قبل دقيقة' : mins === 2 ? 'قبل دقيقتين' : `قبل ${mins} ${mins <= 10 ? 'دقايق' : 'دقيقة'}`;
    if (localDateStr(d) === localDateStr()) {
        const h = Math.floor(mins / 60);
        return h === 1 ? 'قبل ساعة' : h === 2 ? 'قبل ساعتين' : `قبل ${h} ${h <= 10 ? 'ساعات' : 'ساعة'}`;
    }
    const y = new Date();
    y.setDate(y.getDate() - 1);
    if (localDateStr(d) === localDateStr(y)) return `أمس ${clock12(d)}`;
    return `${d.getDate()}/${d.getMonth() + 1} · ${clock12(d)}`;
}

function notifyFullTime(at) {
    const d = notifyDate(at);
    return d ? `${d.toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long' })} ${localDateStr(d)} · ${clock12(d)}` : String(at);
}

const notifyAtHtml = (at) => `<span class="notify-at" title="${escapeHtml(notifyFullTime(at))}">${escapeHtml(notifyWhen(at))}</span>`;

// الرسائل كمحادثات: الرسالة الأصلية والردود تحتها، الأحدث نشاطاً فوق
function notifyThreads() {
    const roots = notifications.filter(n => !n.replyTo);
    const rootIds = new Set(roots.map(n => n.id));
    const threads = roots.map(root => ({ root, replies: notifications.filter(x => x.replyTo === root.id) }));
    // رد رسالته الأصلية قديمة (مش محمّلة): لحاله
    notifications.filter(x => x.replyTo && !rootIds.has(x.replyTo)).forEach(x => threads.push({ root: x, replies: [], orphan: true }));
    const last = (t) => t.replies.reduce((m, x) => (x.at > m ? x.at : m), t.root.at);
    return threads.sort((a, b) => last(b).localeCompare(last(a)));
}

const notifyName = (u) => (u === notifyMe() ? 'إنت' : personName(u));

// زر الحذف: على الرسالة الأصلية (صاحبها بيحذفها عند الكل، غيره بيشيلها من عنده) وعلى ردّي (بينحذف عند الطرفين)
function notifyDelBtn(n) {
    if (!sheetHas('notifyDelete') || (n.replyTo && n.from !== notifyMe())) return '';
    return `<button type="button" data-action="notify-delete" data-id="${escapeHtml(n.id)}" class="notify-del" title="حذف" aria-label="حذف">🗑</button>`;
}

function notifyMsgHtml(n, extra = '') {
    const mine = n.from === notifyMe();
    return `<div class="notify-msg${mine ? ' mine' : ''}${notifyHighlight.has(n.id) ? ' unread' : ''}">
        <div class="notify-meta"><b>${escapeHtml(notifyName(n.from))}</b>${n.important ? '<span class="notify-imp">مهم</span>' : ''}${notifyAtHtml(n.at)}${notifyDelBtn(n)}</div>
        <div class="notify-text">${escapeHtml(n.text)}</div>
        ${extra}
    </div>`;
}

// لصاحب الرسالة: لمين راحت، مين قرأ وإمتى، ومين لسا
function notifyReadHtml(root) {
    const team = notifyTeam.map(t => t.u);
    const recips = root.to === NOTIFY_ALL ? (team.length ? team : Object.keys(root.readBy)) : root.to;
    const read = recips.filter(u => root.readBy[u]).map(u => `${escapeHtml(personName(u))} ${notifyAtHtml(root.readBy[u])}`);
    const unread = recips.filter(u => !root.readBy[u]).map(u => escapeHtml(personName(u)));
    return `<div class="notify-read">
        <span>لـ: ${root.to === NOTIFY_ALL ? 'الكل' : recips.map(u => escapeHtml(personName(u))).join('، ')}</span>
        ${read.length ? `<span class="ok">✓✓ قرأه: ${read.join('، ')}</span>` : ''}
        ${unread.length ? `<span>لسا: ${unread.join('، ')}</span>` : ''}
    </div>`;
}

function notifyReplyBox(rootId, to) {
    const open = notifyReplyOpen && notifyReplyOpen.root === rootId && notifyReplyOpen.to === to;
    if (!open) return '';
    return `<div class="notify-reply-box">
        <textarea id="notify-reply-text" rows="2" maxlength="1000" class="w-full field text-xs" placeholder="${to ? `ردك على ${escapeHtml(personName(to))}...` : 'ردك...'}"></textarea>
        <div class="flex gap-2 mt-1.5">
            <button data-action="notify-reply-send" class="text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg">إرسال الرد</button>
            <button data-action="notify-reply-cancel" class="text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg">إلغاء</button>
        </div>
    </div>`;
}

const replyBtn = (rootId, to, label) => `<button data-action="notify-reply" data-root="${escapeHtml(rootId)}" data-to="${escapeHtml(to)}" class="notify-reply-btn">↩ ${label}</button>`;

function renderNotifyList() {
    // الرد اللي عم ينكتب بيضل لو وصل إشعار جديد بالنص
    const ta = $('notify-reply-text');
    const typing = ta && document.activeElement === ta;
    if (ta && notifyReplyOpen) notifyReplyOpen.draft = ta.value;
    const me = notifyMe();
    const threads = notifyThreads();
    $('notify-list').innerHTML = threads.length === 0
        ? `<div class="notify-empty">ما في إشعارات لسا${hasPerm('notify') ? '. اكبس "+ إشعار جديد" لتبعت للموظفين.' : '.'}</div>`
        : threads.map(({ root, replies, orphan }) => {
            const mineRoot = root.from === me;
            // صاحب الرسالة بيرد على كل موظف رد عليه، والموظف بيرد على صاحبها
            const repliers = mineRoot ? [...new Set(replies.filter(r => r.from !== me).map(r => r.from))] : [];
            const rootExtra = !orphan && mineRoot ? notifyReadHtml(root) : '';
            const actions = orphan ? '' : mineRoot
                ? repliers.map(u => replyBtn(root.id, u, `رد على ${escapeHtml(personName(u))}`)).join('')
                : replyBtn(root.id, '', 'رد');
            const box = orphan ? '' : (mineRoot ? repliers.map(u => notifyReplyBox(root.id, u)).join('') : notifyReplyBox(root.id, ''));
            return `<div class="notify-thread">
                ${notifyMsgHtml(root, rootExtra)}
                ${replies.length ? `<div class="notify-replies">${replies.map(r => notifyMsgHtml(r, r.from === me && r.to !== NOTIFY_ALL && r.to.every(u => r.readBy[u]) ? '<div class="notify-read"><span class="ok">✓✓ انقرأ</span></div>' : '')).join('')}</div>` : ''}
                ${actions ? `<div class="notify-actions">${actions}</div>` : ''}
                ${box}
            </div>`;
        }).join('');
    const box = $('notify-reply-text');
    if (box && notifyReplyOpen) {
        box.value = notifyReplyOpen.draft || '';
        if (typing || notifyReplyOpen.focus) {
            box.focus();
            notifyReplyOpen.focus = false;
        }
    }
}

function renderNotifyFoot() {
    const sound = globalConfig.notifySound !== false;
    $('notify-sound-btn').textContent = sound ? '🔊 الصوت شغّال' : '🔇 الصوت مسكّر';
    const supported = 'Notification' in window;
    const perm = supported ? Notification.permission : 'unsupported';
    const btn = $('notify-perm-btn');
    btn.classList.toggle('hidden', !supported);
    btn.disabled = perm !== 'default';
    btn.textContent = perm === 'granted' ? '✓ إشعارات المتصفح شغّالة' : perm === 'denied' ? 'المتصفح مانع الإشعارات (من إعداداته)' : '🔔 فعّل إشعارات المتصفح';
}

function toggleNotifySound() {
    globalConfig.notifySound = globalConfig.notifySound === false;
    saveAll();
    renderNotifyFoot();
    if (globalConfig.notifySound) notifyBeep();
}

async function requestNotifyPermission() {
    try { await Notification.requestPermission(); } catch (e) { /* متصفح قديم */ }
    renderNotifyFoot();
}

// ---------- الرد ----------
function openNotifyReply(el) {
    notifyReplyOpen = { root: el.dataset.root, to: el.dataset.to || '', draft: '', focus: true };
    renderNotifyList();
}

async function sendNotifyReply() {
    if (!notifyReplyOpen) return;
    const text = $('notify-reply-text')?.value.trim() || '';
    if (!text) return showToast('اكتب الرد أول', '', 'warning');
    const btn = document.querySelector('[data-action="notify-reply-send"]');
    if (btn) { btn.disabled = true; btn.textContent = 'جاري الإرسال...'; }
    const r = await postToSheets({ action: 'notify_reply', replyTo: notifyReplyOpen.root, text, ...(notifyReplyOpen.to ? { to: notifyReplyOpen.to } : {}) });
    if (r.status !== 'ok' || !r.data?.ok) {
        if (btn) { btn.disabled = false; btn.textContent = 'إرسال الرد'; }
        return showToast('ما انبعت الرد', r.error === 'not_found' ? 'الرسالة الأصلية مش موجودة' : 'تأكد من الاتصال وجرّب مرة ثانية', 'error');
    }
    notifyReplyOpen = null;
    applyNotifications([r.data.item]);
    renderNotifyList();
    showToast('انبعت الرد', '', 'success');
}

// ---------- إشعار جديد (صلاحية "إرسال إشعارات") ----------
function openNotifyCompose() {
    if (!hasPerm('notify')) return;
    $('nc_text').value = '';
    $('nc_important').checked = false;
    $('nc-recipients').innerHTML = `
        <label class="perm-check"><input type="checkbox" value="${NOTIFY_ALL}" checked><span>الكل</span></label>
        ${notifyTeam.map(t => `<label class="perm-check"><input type="checkbox" value="${escapeHtml(t.u)}" checked disabled><span>${escapeHtml(t.n || t.u)}</span></label>`).join('')}`;
    $('nc-team-empty').classList.toggle('hidden', notifyTeam.length > 0);
    openModal('notifyComposeModal');
    setTimeout(() => $('nc_text').focus(), 30);
}

// "الكل" بيعلّم الكل وبيسكّرهم؛ شيله واختار بإيدك
function onNotifyRecipientsChange(e) {
    if (e.target.value !== NOTIFY_ALL) return;
    document.querySelectorAll('#nc-recipients input').forEach(i => {
        if (i.value === NOTIFY_ALL) return;
        i.disabled = e.target.checked;
        i.checked = e.target.checked;
    });
}

async function sendNotifyCompose() {
    const text = $('nc_text').value.trim();
    if (!text) return showToast('اكتب الرسالة أول', '', 'warning');
    const all = document.querySelector(`#nc-recipients input[value="${NOTIFY_ALL}"]`)?.checked;
    const to = all ? NOTIFY_ALL : [...document.querySelectorAll('#nc-recipients input:checked')].map(i => i.value).filter(v => v !== NOTIFY_ALL);
    if (!all && !to.length) return showToast('اختار لمين يوصل', '', 'warning');
    const btn = $('nc-send');
    btn.disabled = true;
    btn.textContent = 'جاري الإرسال...';
    try {
        const r = await postToSheets({ action: 'notify_send', text, to, important: $('nc_important').checked });
        if (r.status !== 'ok' || !r.data?.ok) {
            return showToast('ما انبعت الإشعار', r.error === 'forbidden' ? 'ما معك صلاحية "إرسال إشعارات"' : r.error === 'unknown_action' ? 'حدّث السكربت أولاً' : 'تأكد من الاتصال وجرّب مرة ثانية', 'error');
        }
        closeModal('notifyComposeModal');
        applyNotifications([r.data.item]);
        showToast('انبعت الإشعار', all ? 'لكل الموظفين' : to.map(personName).join('، '), 'success');
    } finally {
        btn.disabled = false;
        btn.textContent = 'إرسال';
    }
}

// ---------- لما الصفحة مخفية: طلب خفيف للإشعارات بس (التحديث الحيّ بيوقف وهي مخفية) ----------
async function pollNotificationsHidden() {
    if (!document.hidden || !notifyEnabled() || !notifyCursor || Date.now() - notifyLastPoll < NOTIFY_POLL_MS - 5000) return;
    notifyLastPoll = Date.now();
    const r = await postToSheets({ action: 'notify_poll', since: notifyCursor });
    if (r.status !== 'ok' || !r.data?.ok) return;
    if (r.data.serverTime) notifyCursor = r.data.serverTime;
    applyNotifications(r.data.notifications);
}

// ---------- الحذف ----------
function deleteNotification(id) {
    const n = notifications.find(x => x.id === id);
    if (!n) return;
    const mine = n.from === notifyMe();
    const [title, msg] = !mine ? ['حذف الإشعار؟', 'بينشال من عندك بس، وما بيأثر على حدا ثاني.']
        : n.replyTo ? ['حذف ردّك؟', 'بينحذف عندك وعند اللي وصله.']
            : ['حذف الإشعار عند الكل؟', 'بينحذف عندك وعند كل اللي وصلهم، مع الردود عليه.'];
    showAppConfirm(title, msg, async () => {
        const before = notifications;
        // الأصلية بتروح مع ردودها
        notifications = notifications.filter(x => x.id !== id && (n.replyTo || x.replyTo !== id));
        renderNotifyBadge();
        renderNotifyList();
        const r = await postToSheets({ action: 'notify_delete', id });
        if (r.status !== 'ok' || !r.data?.ok) {
            notifications = before;
            renderNotifyBadge();
            renderNotifyList();
            return showToast('ما انحذف', r.error === 'not_found' ? 'الإشعار مش موجود (يمكن انحذف من قبل)' : 'تأكد من الاتصال وجرّب مرة ثانية', 'error');
        }
        showToast(mine ? 'انحذف' : 'انشال من عندك', '', 'success');
    });
}

function bindNotifyEvents() {
    $('nc-recipients').addEventListener('change', onNotifyRecipientsChange);
    setInterval(() => {
        pollNotificationsHidden();
        // "قبل 5 دقايق" بتتحدث والقائمة مفتوحة
        if (!document.hidden && !$('notifyModal').classList.contains('hidden')) renderNotifyList();
    }, 30000);
    // الصوت بيحتاج كبسة بالصفحة قبل ما يشتغل
    const unlock = () => {
        try { const ctx = notifyAudio(); if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) { /* بدون صوت */ }
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
}
