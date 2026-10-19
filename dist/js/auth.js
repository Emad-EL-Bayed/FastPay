'use strict';

// فاست باي — تسجيل الدخول والصلاحيات والمستخدمين
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= تسجيل الدخول والصلاحيات =================
// السكربت هو الذي يفحص كل طلب ويرفض ما لا تسمح به الصلاحية؛ هنا نخفي ما لا يخص المستخدم فقط.
const PERM_LABELS = {
    calculator: 'الحاسبة',
    transactions: 'سجل الحوالات',
    usdt: 'USDT',
    egp: 'الجنيه',
    accounts: 'الحسابات',
    expenses: 'المصاريف',
    traders: 'التجار',
    customers: 'الزبائن',
    countries: 'تسعير الدول',
    reports: 'الأرباح والتقارير',
    settings: 'الإعدادات',
    users: 'المستخدمين',
    delete: 'الحذف',
    profit: 'رؤية الأرباح',
    unlock: 'تعديل الأيام المقفلة',
    notify: 'إرسال إشعارات'
};
const PAGE_PERMS = ['calculator', 'transactions', 'usdt', 'egp', 'accounts', 'expenses', 'traders', 'customers', 'countries', 'reports', 'settings', 'users'];
const EXTRA_PERMS = ['delete', 'profit', 'unlock', 'notify'];
const ALL_PERM_KEYS = [...PAGE_PERMS, ...EXTRA_PERMS];


function hasPerm(perm) {
    if (!authEnabled) return true;
    return !!session?.perms?.includes(perm);
}

function saveSession() {
    try {
        if (session) localStorage.setItem(STORAGE.session, JSON.stringify(session));
        else localStorage.removeItem(STORAGE.session);
    } catch (e) { /* التخزين محظور: يبقى الدخول لهذه الجلسة فقط */ }
}

// يُستدعى بعد كل قراءة: الصلاحيات والاسم والصورة قد تتغير من جهاز ثاني
function updateAuthFromServer(data) {
    authEnabled = !!data.authEnabled;
    if (data.people) peopleNames = data.people;
    if (!authEnabled) {
        if (session) { session = null; saveSession(); }
    } else if (data.me) {
        session = { ...(session || {}), ...meFields(data.me), auth: true };
        // السكربت القديم ما بيعرف صلاحية الجنيه: صاحب كل الصلاحيات يشوف الصفحة مع تنبيه "حدّث السكربت"
        if (!('egpMoves' in data) && !session.perms.includes('egp') && PAGE_PERMS.every(p => p === 'egp' || session.perms.includes(p))) {
            session.perms = [...session.perms, 'egp'];
        }
        saveSession();
        syncMyAvatar();
    }
    applyPermsUI();
}

// ما يرجعه السكربت عن المستخدم الحالي (السكربت القديم بدون اسم ظاهر أو صورة)
function meFields(me) {
    return { username: me.username, displayName: me.displayName || '', avatarSig: me.avatarSig || '', perms: me.perms };
}

// ---------- الاسم الظاهر والصورة الشخصية ----------
// الصورة تُحفظ في ورقة "المستخدمين" (عمود "الصورة")، ونسخة منها هنا حتى لا تُطلب كل مرة
let myAvatar = loadMyAvatar();

function loadMyAvatar() {
    try { return JSON.parse(localStorage.getItem(STORAGE.avatar) || 'null') || {}; } catch (e) { return {}; }
}

function setMyAvatar(user, sig, data) {
    myAvatar = { user, sig, data };
    try { localStorage.setItem(STORAGE.avatar, JSON.stringify(myAvatar)); } catch (e) { /* التخزين محظور: تبقى لهذه الجلسة */ }
}

const myDisplayName = () => session?.displayName || session?.username || '';
const myAvatarUrl = () => (session?.avatarSig && myAvatar.user === session.username && myAvatar.sig === session.avatarSig ? myAvatar.data : '');

// نطلب الصورة من الشيت فقط إذا تغيّرت بصمتها
let avatarFetching = false;
async function syncMyAvatar() {
    const sig = session?.avatarSig || '';
    if (!sig || avatarFetching || (myAvatar.user === session.username && myAvatar.sig === sig)) return;
    avatarFetching = true;
    try {
        const r = await postToSheets({ action: 'my_avatar' });
        if (r.status === 'ok' && typeof r.data?.avatar === 'string') {
            setMyAvatar(session.username, sig, r.data.avatar);
            renderUserChip();
        }
    } finally {
        avatarFetching = false;
    }
}

// بالهيدر الصورة فقط؛ الاسم داخل القائمة
function renderUserChip() {
    const show = authEnabled && !!session?.username;
    $('user-chip').classList.toggle('hidden', !show);
    if (!show) return $('user-menu').classList.add('hidden');
    const name = myDisplayName(), url = myAvatarUrl();
    $('user-chip').innerHTML = avatarHtml(name, url, 'avatar-md', session.username);
    $('user-chip').title = name;
    $('user-chip').setAttribute('aria-label', 'حسابي: ' + name);
    $('user-menu-avatar').innerHTML = avatarHtml(name, url, 'avatar-lg', session.username);
    $('user-menu-name').textContent = name;
    $('user-menu-username').textContent = '@' + session.username;
}

function applyPermsUI() {
    TABS.forEach(t => {
        const ok = tabVisible(t);
        $('nav-' + t)?.classList.toggle('hidden', !ok);
        $('mnav-' + t)?.classList.toggle('hidden', !ok);
    });
    document.body.classList.toggle('no-delete', !hasPerm('delete'));
    document.body.classList.toggle('no-profit', !hasPerm('profit'));
    renderUserChip();
    renderNotifyBadge();
    // مع الدخول بالمستخدمين لا حاجة لمفتاح الحماية اليدوي
    $('sync-token-wrap')?.classList.toggle('hidden', authEnabled);
    updateMobileNav();
    const current = TABS.find(t => !$('page-' + t).classList.contains('hidden'));
    if (current && !hasPerm(tabPerm(current))) {
        const first = TABS.find(t => hasPerm(tabPerm(t)));
        if (first) switchTab(first);
    }
}

// ---------- شاشة الدخول ----------
const LOGIN_ERRORS = {
    bad_credentials: 'اسم المستخدم أو كلمة السر غير صحيحة',
    locked: 'محاولات كثيرة خاطئة. جرّب بعد 15 دقيقة',
    inactive: 'هذا الحساب موقوف، راجع المدير',
    no_users: 'لا يوجد مستخدمون بعد في الشيت',
    offline: 'لا يوجد اتصال بالإنترنت'
};

function showLogin(message = '') {
    if (!$('login-screen').classList.contains('hidden')) {
        if (message) $('login-error').textContent = message;
        return;
    }
    $('login-error').textContent = message;
    $('login-screen').classList.remove('hidden');
    document.body.classList.add('locked');
    setTimeout(() => $(($('login-user').value ? 'login-pass' : 'login-user')).focus(), 50);
}

// السكربت رفض الجلسة (انتهت أو أُوقف المستخدم): نطلب الدخول ونحتفظ بالعمليات المعلقة
function onAuthRequired() {
    const hadSession = !!session?.token;
    authEnabled = true;
    session = { username: session?.username || '', auth: true };
    saveSession();
    applyPermsUI();
    if (session.username) $('login-user').value = session.username;
    showLogin(hadSession ? 'انتهت الجلسة، سجّل الدخول مرة أخرى' : '');
}

async function submitLogin(e) {
    e.preventDefault();
    const username = $('login-user').value.trim();
    const password = $('login-pass').value;
    if (!username || !password) return ($('login-error').textContent = 'اكتب اسم المستخدم وكلمة السر');
    const btn = $('login-btn');
    btn.disabled = true;
    $('login-error').textContent = '';
    try {
        const r = await postToSheets({ action: 'login', username, password }, { noSession: true });
        const data = r.data;
        if (r.status !== 'ok' || !data?.session) {
            $('login-error').textContent = LOGIN_ERRORS[r.error] || 'تعذر تسجيل الدخول، تأكد من الاتصال';
            return;
        }
        session = { token: data.session, ...meFields(data.me), auth: true };
        authEnabled = true;
        saveSession();
        syncMyAvatar();
        $('login-pass').value = '';
        $('login-screen').classList.add('hidden');
        document.body.classList.remove('locked');
        applyPermsUI();
        showToast(`أهلاً ${myDisplayName()}`, 'تم تسجيل الدخول', 'success');
        await loadFromSheets();
    } finally {
        btn.disabled = false;
    }
}

async function logout() {
    closeUserMenu();
    // العمليات المعلقة تُرسل باسم المستخدم الحالي قبل الخروج
    if (outbox.length) await flushOutbox();
    if (outbox.length) return showToast('لا يمكن الخروج الآن', 'في عمليات لم تصل للشيت بعد. تأكد من الاتصال ثم حاول مجدداً', 'warning');
    // جهاز الإشعارات بيطلع مع المستخدم (حتى ما توصله إشعارات غيره لو دخل حساب ثاني على نفس الجوال)
    await postToSheets({ action: 'logout', pushToken: pushLocal()?.token || '' });
    savePushLocal(null);
    // النسخة المحفوظة إلك بس: بتنمسح من الجهاز
    clearSnapshot();
    clearBackgroundOutbox();
    try { localStorage.removeItem(STORAGE.conflicts); } catch (e) { /* محظور */ }
    session = { username: session?.username || '', auth: true };
    saveSession();
    location.reload();
}

function toggleUserMenu() {
    const open = $('user-menu').classList.toggle('hidden') === false;
    $('user-chip').setAttribute('aria-expanded', String(open));
}

function closeUserMenu() {
    $('user-menu').classList.add('hidden');
    $('user-chip').setAttribute('aria-expanded', 'false');
}

// ---------- ملفي: كل مستخدم يغيّر اسمه الظاهر وصورته ----------
let profileDraft = { avatar: '', changed: false };

function openProfileModal() {
    closeUserMenu();
    $('pf_name').value = session?.displayName || '';
    $('pf_username').textContent = session?.username || '';
    profileDraft = { avatar: myAvatarUrl(), changed: false };
    renderProfilePreview();
    openModal('profileModal');
    $('pf_name').focus();
}

function renderProfilePreview() {
    $('pf_avatar').innerHTML = avatarHtml($('pf_name').value.trim() || session?.username, profileDraft.avatar, 'avatar-xl', session?.username);
    $('pf_remove_photo').classList.toggle('hidden', !profileDraft.avatar);
}

function onProfilePhoto(e) {
    const file = e.target.files[0];
    e.target.value = '';
    cropSquareImage(file, 160, (url) => {
        profileDraft = { avatar: url, changed: true };
        renderProfilePreview();
    });
}

function removeProfilePhoto() {
    profileDraft = { avatar: '', changed: true };
    renderProfilePreview();
}

async function saveProfile(e) {
    e.preventDefault();
    const displayName = $('pf_name').value.trim();
    const payload = { action: 'update_profile', displayName };
    // الصورة تُرسل فقط إذا تغيّرت (حتى لا نمسحها إن لم تكن وصلت لهذا الجهاز بعد)
    if (profileDraft.changed) payload.avatar = profileDraft.avatar;
    $('pf_save').disabled = true;
    try {
        const r = await postToSheets(payload);
        if (r.status !== 'ok' || !r.data?.me) {
            const msg = r.error === 'unknown_action' ? 'حدّث سكربت Google أولاً' : r.error === 'bad_avatar' ? 'الصورة كبيرة، جرّب صورة ثانية' : 'تأكد من الاتصال وحاول مجدداً';
            return showToast('لم يُحفظ', msg, 'error');
        }
        session = { ...session, ...meFields(r.data.me) };
        saveSession();
        if (profileDraft.changed) setMyAvatar(session.username, session.avatarSig, profileDraft.avatar);
        if (displayName) peopleNames[session.username] = displayName; else delete peopleNames[session.username];
        renderUserChip();
        closeModal('profileModal');
        showToast('تم حفظ ملفك', myDisplayName(), 'success');
    } finally {
        $('pf_save').disabled = false;
    }
}

function openPasswordModal() {
    closeUserMenu();
    ['pw_old', 'pw_new', 'pw_new2'].forEach(id => { $(id).value = ''; });
    openModal('passwordModal');
    $('pw_old').focus();
}

async function savePassword(e) {
    e.preventDefault();
    const oldPassword = $('pw_old').value, newPassword = $('pw_new').value;
    if (newPassword.length < 4) return showToast('تنبيه', 'كلمة السر الجديدة 4 أحرف على الأقل', 'warning');
    if (newPassword !== $('pw_new2').value) return showToast('تنبيه', 'كلمتا السر الجديدتان غير متطابقتين', 'warning');
    const r = await postToSheets({ action: 'change_password', oldPassword, newPassword });
    if (r.status !== 'ok') return showToast('لم تتغير كلمة السر', r.error === 'bad_credentials' ? 'كلمة السر الحالية غير صحيحة' : 'تأكد من الاتصال وحاول مجدداً', 'error');
    closeModal('passwordModal');
    showToast('تم تغيير كلمة السر', 'استخدمها في المرة القادمة', 'success');
}

// ---------- صفحة المستخدمين ----------
let usersList = [];

async function renderUsersPage() {
    if (pageHidden('users')) return;
    $('users-auth-note').classList.toggle('hidden', authEnabled);
    $('users-body').innerHTML = '<tr><td colspan="5" class="p-6 text-center text-xs text-slate-400">جاري التحميل...</td></tr>';
    const r = await postToSheets({ action: 'users_list' });
    if (r.status !== 'ok' || !Array.isArray(r.data?.users)) {
        $('users-body').innerHTML = `<tr><td colspan="5" class="p-6 text-center text-xs text-rose-600">${r.error === 'unknown_action' ? 'حدّث السكربت أولاً لإدارة المستخدمين' : 'تعذر تحميل المستخدمين'}</td></tr>`;
        return;
    }
    usersList = r.data.users;
    renderUsersTable();
}

function permsSummary(perms) {
    if (ALL_PERM_KEYS.every(k => perms.includes(k))) return '<span class="badge bg-slate-900 text-white">الكل</span>';
    return perms.map(k => `<span class="badge bg-slate-100 text-slate-700">${escapeHtml(PERM_LABELS[k] || k)}</span>`).join(' ') || '<span class="text-slate-400">بدون صلاحيات</span>';
}

function renderUsersTable() {
    $('users-body').innerHTML = usersList.length === 0
        ? '<tr><td colspan="5" class="p-6 text-center text-xs text-slate-400">لا يوجد مستخدمون بعد. أضف أول مستخدم (المدير) وأعطه كل الصلاحيات.</td></tr>'
        : usersList.map(u => `
            <tr class="hover:bg-slate-50">
                <td class="p-3 whitespace-nowrap">
                    <span class="flex items-center gap-2.5">
                        ${avatarHtml(u.displayName || u.username, u.avatar, 'avatar-sm', u.username)}
                        <span>
                            <b class="font-black text-slate-900 block">${escapeHtml(u.displayName || u.username)}${u.username === session?.username ? ' <span class="text-[10px] text-blue-600">(أنت)</span>' : ''}</b>
                            ${u.displayName ? `<small class="text-[10px] text-slate-400 block" dir="ltr">@${escapeHtml(u.username)}</small>` : ''}
                        </span>
                    </span>
                </td>
                <td class="p-3"><div class="flex flex-wrap gap-1 max-w-md">${permsSummary(u.perms)}</div></td>
                <td class="p-3 whitespace-nowrap">${u.active ? '<span class="badge bg-emerald-50 text-emerald-700">فعّال</span>' : '<span class="badge bg-rose-50 text-rose-700">موقوف</span>'}</td>
                <td class="p-3 text-xs text-slate-500 whitespace-nowrap num">${escapeHtml(u.lastLogin || '—')}</td>
                <td class="p-3 text-center whitespace-nowrap">
                    <button data-action="edit-user" data-name="${escapeHtml(u.username)}" class="text-blue-600 font-bold text-xs px-2.5 py-1 bg-blue-50 rounded-lg">تعديل</button>
                    ${u.username === session?.username ? '' : `<button data-action="delete-user" data-name="${escapeHtml(u.username)}" class="text-slate-400 hover:text-red-600 font-bold text-xs p-1">✕</button>`}
                </td>
            </tr>`).join('');
}

let userDraft = { avatar: '', changed: false };

function openUserModal(u = null) {
    $('userModalTitle').textContent = u ? `تعديل ${u.displayName || u.username}` : 'مستخدم جديد';
    $('um_is_new').value = u ? '' : '1';
    $('um_display').value = u ? u.displayName || '' : '';
    userDraft = { avatar: u ? u.avatar || '' : '', changed: false };
    renderUserDraftAvatar();
    $('um_username').value = u ? u.username : '';
    $('um_username').readOnly = !!u;
    $('um_password').value = '';
    $('um_password').placeholder = u ? 'اتركها فارغة للإبقاء على الحالية' : 'كلمة السر';
    $('um_active').checked = u ? u.active : true;
    const perms = u ? u.perms : [];
    $('um_perms_pages').innerHTML = PAGE_PERMS.map(k => permCheckbox(k, perms)).join('');
    $('um_perms_extra').innerHTML = EXTRA_PERMS.map(k => permCheckbox(k, perms)).join('');
    updateSelectAllLabel();
    openModal('userModal');
    $(u ? 'um_display' : 'um_username').focus();
}

function renderUserDraftAvatar() {
    const seed = $('um_username').value.trim();
    $('um_avatar').innerHTML = avatarHtml($('um_display').value.trim() || seed, userDraft.avatar, 'avatar-xl', seed);
    $('um_remove_photo').classList.toggle('hidden', !userDraft.avatar);
}

function onUserPhoto(e) {
    const file = e.target.files[0];
    e.target.value = '';
    cropSquareImage(file, 160, (url) => {
        userDraft = { avatar: url, changed: true };
        renderUserDraftAvatar();
    });
}

function removeUserPhoto() {
    userDraft = { avatar: '', changed: true };
    renderUserDraftAvatar();
}

function permCheckbox(k, perms) {
    const hint = k === 'delete' ? 'يظهر زر الحذف' : k === 'profit' ? 'أعمدة وأرقام الربح' : k === 'unlock' ? 'تعديل وحذف حركات أيام انعمل إلها جرد' : k === 'notify' ? 'رسائل للموظفين من الجرس 🔔 (الرد مسموح للكل)' : '';
    return `<label class="perm-check"><input type="checkbox" value="${k}" ${perms.includes(k) ? 'checked' : ''}><span>${PERM_LABELS[k]}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
}

const permInputs = () => [...document.querySelectorAll('#userModal .perm-check input')];

function toggleAllPerms() {
    const all = permInputs();
    const allOn = all.every(i => i.checked);
    all.forEach(i => { i.checked = !allOn; });
    updateSelectAllLabel();
}

function updateSelectAllLabel() {
    $('um_select_all').textContent = permInputs().every(i => i.checked) ? 'إلغاء تحديد الكل' : 'تحديد الكل';
}

const USER_ERRORS = {
    self_lock: 'لا يمكنك إيقاف نفسك أو إزالة صلاحية المستخدمين عن نفسك',
    exists: 'يوجد مستخدم بنفس الاسم',
    password_required: 'اكتب كلمة السر للمستخدم الجديد',
    bad_user: 'اكتب اسم المستخدم',
    bad_avatar: 'الصورة كبيرة، جرّب صورة ثانية',
    forbidden: 'لا تملك صلاحية إدارة المستخدمين'
};

async function saveUser(e) {
    e.preventDefault();
    const user = {
        username: $('um_username').value.trim(),
        password: $('um_password').value,
        perms: permInputs().filter(i => i.checked).map(i => i.value),
        active: $('um_active').checked,
        isNew: $('um_is_new').value === '1',
        displayName: $('um_display').value.trim()
    };
    if (userDraft.changed) user.avatar = userDraft.avatar;
    if (!user.username) return showToast('تنبيه', USER_ERRORS.bad_user, 'warning');
    if (user.isNew && !user.password) return showToast('تنبيه', USER_ERRORS.password_required, 'warning');
    if (user.password && user.password.length < 4) return showToast('تنبيه', 'كلمة السر 4 أحرف على الأقل', 'warning');
    if (!user.perms.length) return showToast('تنبيه', 'اختر صلاحية واحدة على الأقل', 'warning');
    const firstUser = !authEnabled;
    const r = await postToSheets({ action: 'upsert_user', user });
    if (r.status !== 'ok') return showToast('لم يُحفظ المستخدم', USER_ERRORS[r.error] || 'تأكد من الاتصال وحاول مجدداً', 'error');
    closeModal('userModal');
    showToast('تم حفظ المستخدم', user.displayName || user.username, 'success');
    if (user.displayName) peopleNames[user.username] = user.displayName; else delete peopleNames[user.username];
    // عدّلت نفسك: الاسم والصورة يتحدثان فوراً بالهيدر
    if (r.data?.me && user.username === session?.username) {
        session = { ...session, ...meFields(r.data.me) };
        saveSession();
        if (userDraft.changed) setMyAvatar(session.username, session.avatarSig, userDraft.avatar);
        renderUserChip();
    }
    // أول مستخدم: من الآن الدخول إجباري، فنسجّل الدخول به
    if (firstUser) {
        $('login-user').value = user.username;
        return onAuthRequired();
    }
    renderUsersPage();
}

function deleteUserPrompt(name) {
    showAppConfirm('حذف المستخدم', `حذف "${name}"؟ سيخرج من كل أجهزته فوراً.`, async () => {
        const r = await postToSheets({ action: 'delete_user', username: name });
        if (r.status !== 'ok') return showToast('لم يُحذف', USER_ERRORS[r.error] || 'تأكد من الاتصال', 'error');
        showToast('تم حذف المستخدم', name, 'info');
        renderUsersPage();
    });
}
