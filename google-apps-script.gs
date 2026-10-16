/**
 * فاست باي - سكربت Google Sheets (الشيت هو المصدر الوحيد للزبائن والحوالات)
 *
 * أسماء الأعمدة في الشيت بالعربي، والسكربت يترجمها للبرنامج تلقائياً.
 * الأعمدة الإنجليزية القديمة (id, date, ...) تُعاد تسميتها بالعربي عند أول تشغيل.
 */

const TX_SHEET = 'الحوالات';
const CUST_SHEET = 'الزبائن';
const EXP_SHEET = 'المصاريف';
const TRADER_SHEET = 'التجار';
const TMOVE_SHEET = 'حركات التجار';
const COUNTRY_SHEET = 'تسعير الدول';
const ACCOUNT_SHEET = 'الحسابات';
const AMOVE_SHEET = 'حركات الحسابات';
const USDT_SHEET = 'حركات USDT';
const EGP_WALLET_SHEET = 'محافظ الجنيه';
const EGP_SHEET = 'حركات الجنيه';
const SETTINGS_SHEET = 'الإعدادات';
const CLOSING_SHEET = 'الجرد اليومي';
const USERS_SHEET = 'المستخدمين';
// سجل مخفي بالصفوف المحذوفة، حتى يعرف البرنامج ما حُذف منذ آخر تحديث
const DELETED_SHEET = '_المحذوفات';
const TIME_FORMAT = 'yyyy-MM-dd HH:mm:ss';

// [المفتاح الذي يستخدمه البرنامج، اسم العمود في الشيت]
const TX_FIELDS = [
  ['id', 'رقم الحوالة'],
  ['serial', 'رقم الإيصال'],
  ['date', 'التاريخ'],
  ['customerId', 'رقم الزبون'],
  ['recipient', 'اسم المستلم'],
  ['account', 'رقم الحساب / المحفظة'],
  ['iban', 'IBAN'],
  ['payout', 'طريقة الاستلام'],
  ['provider', 'الجهة'],
  ['country', 'الدولة'],
  ['type', 'نوع المعادلة'],
  ['orig', 'المبلغ الأصلي'],
  ['factor', 'معامل التحويل'],
  ['costMode', 'نوع التكلفة'],
  ['costPct', 'نسبة التكلفة %'],
  ['costFixed', 'التكلفة الثابتة $'],
  ['profitPct', 'نسبة الربح %'],
  ['minusIls', 'الخصم الإضافي ₪'],
  ['screenRate', 'سعر الشاشة'],
  ['currency', 'عملة التسليم'],
  ['clientIls', 'المسلّم للزبون ₪'],
  ['clientUsd', 'المسلّم للزبون $'],
  // ± على المسلّم بعد الحساب (بعملة التسليم)، والربح بيتبعه
  ['finalAdjust', 'تعديل على النهائي'],
  ['costIls', 'التكلفة ₪'],
  ['profitIls', 'صافي الربح ₪'],
  ['status', 'الحالة'],
  ['updatedAt', 'آخر تحديث']
];

// الزبون يُعرف برقم داخلي (id)، ورقم الواتساب يُضاف لاحقاً من صفحة الزبائن.
// البنك: "رقم الحساب / المحفظة" = رقم الجوال المربوط بالحساب (للتحويل)، و IBAN اختياري
const CUST_FIELDS = [
  ['id', 'رقم الزبون'],
  ['name', 'اسم الزبون'],
  ['phone', 'رقم الواتساب'],
  ['payout', 'طريقة الاستلام'],
  ['provider', 'الجهة'],
  ['account', 'رقم الحساب / المحفظة'],
  ['iban', 'IBAN'],
  ['createdAt', 'تاريخ الإضافة'],
  ['updatedAt', 'آخر تحديث']
];

const EXP_FIELDS = [
  ['id', 'رقم المصروف'],
  ['date', 'التاريخ'],
  ['category', 'البند'],
  ['amount', 'المبلغ ₪'],
  ['note', 'ملاحظات'],
  ['updatedAt', 'آخر تحديث']
];

// التجار: حساب جارٍ بين تاجر وتاجر، لكل عملة رصيدها
const TRADER_FIELDS = [
  ['id', 'رقم التاجر'],
  ['name', 'اسم التاجر'],
  ['phone', 'رقم الواتساب'],
  ['commissionPct', 'نسبته %'],
  ['myCommissionPct', 'نسبتي %'],
  ['note', 'ملاحظات'],
  ['createdAt', 'تاريخ الإضافة'],
  ['updatedAt', 'آخر تحديث'],
  ['logo', 'الشعار']
];

const TMOVE_FIELDS = [
  ['id', 'رقم الحركة'],
  ['date', 'التاريخ'],
  ['traderId', 'رقم التاجر'],
  ['traderName', 'اسم التاجر'],
  ['kind', 'نوع الحركة'],
  ['currency', 'العملة'],
  ['amount', 'المبلغ'],
  ['commissionPct', 'العمولة %'],
  ['commission', 'قيمة العمولة'],
  ['effect', 'الأثر على الرصيد'],
  ['note', 'ملاحظات'],
  ['updatedAt', 'آخر تحديث']
];

// تسعير الدول والمصادر: موحّد لكل الأجهزة
const COUNTRY_FIELDS = [
  ['id', 'رقم الدولة'],
  ['order', 'الترتيب'],
  ['name', 'الدولة / المصدر'],
  ['type', 'نوع المعادلة'],
  ['factor', 'المعامل'],
  ['costMode', 'نوع التكلفة'],
  ['costValue', 'التكلفة'],
  ['profitPct', 'نسبة الربح %'],
  ['updatedAt', 'آخر تحديث']
];

// حساباتنا (محافظ وبنوك وكاش): الرصيد = مجموع حركاتها
const ACCOUNT_FIELDS = [
  ['id', 'رقم الحساب'],
  ['accType', 'النوع'],
  ['holder', 'صاحب الحساب'],
  ['usd', 'فيه دولار'],
  ['alertBelow', 'نبّه تحت (₪)'],
  ['order', 'الترتيب'],
  ['note', 'ملاحظات'],
  ['createdAt', 'تاريخ الإضافة'],
  ['updatedAt', 'آخر تحديث']
];

// كل حركة على حساب: موجب = دخل للحساب، سالب = خرج منه
const AMOVE_FIELDS = [
  ['id', 'رقم الحركة'],
  ['date', 'التاريخ'],
  ['accountId', 'رقم الحساب'],
  ['accountName', 'الحساب'],
  ['currency', 'العملة'],
  ['amount', 'المبلغ'],
  ['reason', 'السبب'],
  ['refType', 'مرتبطة بـ'],
  ['refId', 'رقم المرتبط'],
  ['note', 'ملاحظات'],
  ['updatedAt', 'آخر تحديث']
];

// إيداع USDT (الزبون يشتري) وسحب USDT (الزبون يبيع) وتعديل الرصيد
const USDT_FIELDS = [
  ['id', 'رقم الحركة'],
  ['serial', 'رقم الإيصال'],
  ['date', 'التاريخ'],
  ['kind', 'النوع'],
  ['customerId', 'رقم الزبون'],
  ['customerName', 'اسم الزبون'],
  ['amount', 'المبلغ USDT'],
  ['network', 'الشبكة'],
  ['networkFee', 'رسوم الشبكة $'],
  ['pct', 'النسبة %'],
  ['rate', 'سعر الدولار'],
  ['currency', 'عملة الدفع'],
  ['discount', 'الخصم'],
  ['fixedTotal', 'مبلغ متفق عليه'],
  ['finalAdjust', 'تعديل على النهائي'],
  ['total', 'المبلغ النهائي'],
  ['settle', 'فرق مُسوّى'],
  ['profitIls', 'الربح ₪'],
  ['usdtEffect', 'الأثر على رصيد USDT'],
  ['address', 'عنوان المحفظة'],
  ['note', 'ملاحظات'],
  ['updatedAt', 'آخر تحديث']
];

// محافظ الجنيه المصري (فودافون كاش، انستا باي...): رصيد كل محفظة = مجموع حركات الجنيه عليها
const EGP_WALLET_FIELDS = [
  ['id', 'رقم المحفظة'],
  ['walletType', 'النوع'],
  ['holder', 'صاحبها'],
  ['number', 'رقم فودافون / عنوان انستا باي'],
  ['alertBelow', 'نبّه تحت (جنيه)'],
  ['order', 'الترتيب'],
  ['note', 'ملاحظات'],
  ['createdAt', 'تاريخ الإضافة'],
  ['updatedAt', 'آخر تحديث']
];

// حركات الجنيه: إرسال (الزبون يدفع ونحن نرسل جنيه)، استقبال (يصلنا جنيه وندفع للزبون)،
// شحن/بيع جنيه، تعديل رصيد، وتحويل بين المحافظ
const EGP_FIELDS = [
  ['id', 'رقم الحركة'],
  ['serial', 'رقم الإيصال'],
  ['date', 'التاريخ'],
  ['kind', 'النوع'],
  ['customerId', 'رقم الزبون'],
  ['customerName', 'اسم الزبون'],
  ['walletId', 'رقم المحفظة'],
  ['walletName', 'المحفظة'],
  ['toWalletId', 'إلى محفظة'],
  ['egp', 'المبلغ بالجنيه'],
  ['fee', 'رسوم التحويل (جنيه)'],
  ['rate', 'سعر الزبون (جنيه للدولار)'],
  ['screen', 'شاشة الجنيه'],
  ['usdRate', 'سعر الدولار ₪'],
  ['currency', 'عملة الدفع'],
  ['fixedTotal', 'مبلغ متفق عليه'],
  ['finalAdjust', 'تعديل على النهائي'],
  ['total', 'المبلغ النهائي'],
  ['settle', 'فرق مُسوّى'],
  ['profitIls', 'الربح ₪'],
  ['egpEffect', 'الأثر على رصيد الجنيه'],
  ['party', 'المستلم / المرسل / الجهة'],
  ['partyNumber', 'رقمه / عنوانه'],
  ['note', 'ملاحظات'],
  ['updatedAt', 'آخر تحديث']
];

// إعدادات مشتركة لكل الأجهزة: سطر لكل إعداد (القيمة نص أو JSON)
const SETTINGS_FIELDS = [
  ['id', 'الإعداد'],
  ['label', 'الوصف'],
  ['value', 'القيمة'],
  ['updatedAt', 'آخر تحديث']
];

// المستخدمون: كلمة السر تُكتب عادية وتُشفَّر تلقائياً (عند الكتابة في الشيت أو أول دخول)
// الصلاحيات: "الكل" أو أسماء الصفحات مفصولة بفاصلة، مثل: الحاسبة، سجل الحوالات، الحذف
// الاسم الظاهر: يظهر في البرنامج بدل اسم الدخول. الصورة: صورة شخصية صغيرة (نص data:image)
const USER_FIELDS = [
  ['username', 'اسم المستخدم'],
  ['displayName', 'الاسم الظاهر'],
  ['password', 'كلمة السر'],
  ['perms', 'الصلاحيات'],
  ['active', 'فعّال'],
  ['lastLogin', 'آخر دخول'],
  ['createdAt', 'تاريخ الإضافة'],
  ['updatedAt', 'آخر تحديث'],
  ['avatar', 'الصورة']
];
const MAX_AVATAR_CHARS = 45000; // خلية الشيت تتسع لـ 50 ألف حرف

// الجرد اليومي: لكل حساب وعملة رصيد البرنامج والرصيد الفعلي والفرق
const CLOSING_FIELDS = [
  ['id', 'رقم السطر'],
  ['date', 'التاريخ'],
  ['accountId', 'رقم الحساب'],
  ['accountName', 'الحساب'],
  ['currency', 'العملة'],
  ['system', 'رصيد البرنامج'],
  ['actual', 'الرصيد الفعلي'],
  ['diff', 'الفرق'],
  ['settled', 'سُوّي الفرق'],
  ['note', 'ملاحظات'],
  ['updatedAt', 'آخر تحديث']
];

// مين أضاف ومين عدّل: يكتبها السكربت من جلسة الدخول (لا يمكن تزويرها من البرنامج)
const AUDIT_FIELDS = [['createdBy', 'أُضيفت بواسطة'], ['updatedBy', 'آخر تعديل بواسطة']];
[TX_FIELDS, CUST_FIELDS, EXP_FIELDS, TRADER_FIELDS, TMOVE_FIELDS, COUNTRY_FIELDS, ACCOUNT_FIELDS, AMOVE_FIELDS, USDT_FIELDS, EGP_WALLET_FIELDS, EGP_FIELDS, SETTINGS_FIELDS, CLOSING_FIELDS]
  .forEach(f => { if (!f.some(x => x[0] === 'createdBy')) f.push(...AUDIT_FIELDS); });

// أعمدة لم يعد البرنامج يستخدمها: تُحذف عند ترتيب الشيت
const OBSOLETE_LABELS = {
  [TX_SHEET]: ['رقم الجوال', 'phone']
};

// غيّر هذا الرقم عند أي تغيير في الأعمدة ليُعاد ترتيب الشيت مرة واحدة تلقائياً
const LAYOUT_VERSION = '9';

// أسماء أعمدة قديمة تُعاد تسميتها تلقائياً
const LEGACY_LABELS = {
  [CUST_SHEET]: { 'رقم الجوال': 'رقم الواتساب' }
};

const DATE_FIELDS = ['date', 'createdAt'];

// كل ورقة: اسمها في الرد، أعمدتها، العمود الذي يلزم وجوده حتى يُعطى الصف رقماً،
// والصلاحيات التي تسمح بقراءتها (يكفي واحدة منها؛ null = الكل)
const COLLECTIONS = [
  { name: 'ledger', sheet: TX_SHEET, fields: TX_FIELDS, read: ['calculator', 'transactions', 'customers', 'reports'] },
  { name: 'customers', sheet: CUST_SHEET, fields: CUST_FIELDS, required: 'name', read: ['calculator', 'transactions', 'customers', 'usdt', 'egp'] },
  { name: 'expenses', sheet: EXP_SHEET, fields: EXP_FIELDS, read: ['expenses', 'reports'] },
  { name: 'traders', sheet: TRADER_SHEET, fields: TRADER_FIELDS, read: ['traders'] },
  { name: 'traderMoves', sheet: TMOVE_SHEET, fields: TMOVE_FIELDS, read: ['traders'] },
  { name: 'countries', sheet: COUNTRY_SHEET, fields: COUNTRY_FIELDS, read: ['calculator', 'transactions', 'countries'] },
  { name: 'accounts', sheet: ACCOUNT_SHEET, fields: ACCOUNT_FIELDS, read: ['accounts', 'transactions', 'usdt', 'egp', 'calculator'] },
  { name: 'accountMoves', sheet: AMOVE_SHEET, fields: AMOVE_FIELDS, read: ['accounts', 'transactions', 'usdt', 'egp', 'calculator'] },
  { name: 'usdtMoves', sheet: USDT_SHEET, fields: USDT_FIELDS, read: ['usdt', 'reports'] },
  { name: 'egpWallets', sheet: EGP_WALLET_SHEET, fields: EGP_WALLET_FIELDS, read: ['egp'] },
  { name: 'egpMoves', sheet: EGP_SHEET, fields: EGP_FIELDS, read: ['egp', 'reports'] },
  { name: 'settings', sheet: SETTINGS_SHEET, fields: SETTINGS_FIELDS, read: null },
  { name: 'closings', sheet: CLOSING_SHEET, fields: CLOSING_FIELDS, read: ['accounts'] }
];

// الصلاحيات: المفتاح الذي يستخدمه البرنامج واسمه في الشيت
const PERMS = {
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
  delete: 'الحذف',
  profit: 'رؤية الأرباح',
  users: 'إدارة المستخدمين',
  unlock: 'تعديل الأيام المقفلة',
  notify: 'إرسال إشعارات'
};
const ALL_PERMS = Object.keys(PERMS);

// كل عملية والصلاحية المطلوبة لها (يكفي واحدة من any)، وdel = تحتاج صلاحية الحذف أيضاً
const ACTION_PERMS = {
  upsert: { any: ['calculator', 'transactions'] },
  delete: { any: ['transactions'], del: true },
  upsert_customer: { any: ['calculator', 'customers', 'usdt', 'egp'] },
  delete_customer: { any: ['customers'], del: true },
  upsert_expense: { any: ['expenses'] },
  delete_expense: { any: ['expenses'], del: true },
  upsert_trader: { any: ['traders'] },
  delete_trader: { any: ['traders'], del: true },
  upsert_tmove: { any: ['traders'] },
  delete_tmove: { any: ['traders'], del: true },
  upsert_country: { any: ['countries'] },
  delete_country: { any: ['countries'], del: true },
  upsert_account: { any: ['accounts'] },
  delete_account: { any: ['accounts'], del: true },
  upsert_usdt: { any: ['usdt'] },
  delete_usdt: { any: ['usdt'], del: true },
  upsert_egp_wallet: { any: ['egp'] },
  delete_egp_wallet: { any: ['egp'], del: true },
  upsert_egp: { any: ['egp'] },
  delete_egp: { any: ['egp'], del: true },
  upsert_setting: { any: ['settings'] },
  upsert_closing: { any: ['accounts'] },
  deleted_list: { any: ['settings'], del: true },
  edits_list: { any: ['settings'] },
  reset_data: { any: ['settings'], del: true },
  notify_send: { any: ['notify'] },
  backups_list: { any: ['settings'], del: true },
  backup_info: { any: ['settings'], del: true },
  restore_backup: { any: ['settings'], del: true },
  restore_deleted: { any: ['settings'], del: true },
  logos: { any: ['traders'] },
  users_list: { any: ['users'] },
  upsert_user: { any: ['users'] },
  delete_user: { any: ['users'], del: true }
};

// قيم تُكتب بالعربي في الشيت وتُترجم للبرنامج عند القراءة
const TYPE_LABELS = { div: 'تقسيم', mul: 'ضرب', direct_percent: 'نسبة' };
const VALUE_LABELS = {
  type: TYPE_LABELS,
  currency: { ILS: 'شيكل', USD: 'دولار', EUR: 'يورو', JOD: 'دينار' },
  kind: {
    for_us: 'لنا',
    for_him: 'له',
    recv_for_me: 'استلم لي',
    paid_for_me: 'أرسل عني',
    recv_for_him: 'استلمت له',
    paid_for_him: 'أرسلت عنه',
    he_paid: 'دفع لي',
    i_paid: 'دفعت له',
    deposit: 'إيداع',
    withdraw: 'سحب',
    adjust: 'تعديل رصيد',
    send: 'إرسال جنيه',
    receive: 'استقبال جنيه',
    topup: 'شحن/بيع جنيه',
    transfer: 'تحويل بين المحافظ'
  },
  walletType: { vodafone: 'فودافون كاش', instapay: 'انستا باي', etisalat: 'اتصالات كاش', orange: 'أورنج كاش', bank: 'بنك مصري', cash: 'كاش جنيه', other: 'أخرى' },
  accType: { jawwal: 'جوال باي', palpay: 'بال باي', malchat: 'مالتشات', bank: 'بنك فلسطين', cash: 'كاش', other: 'أخرى' },
  usd: { yes: 'نعم', no: 'لا' },
  settled: { yes: 'نعم', no: 'لا' },
  reason: { manual: 'يدوي', transfer: 'تحويل بين الحسابات', usdt: 'USDT', tx: 'حوالة', egp: 'جنيه' },
  refType: { usdt: 'USDT', tx: 'حوالة', transfer: 'تحويل', egp: 'جنيه' },
  costMode: { pct: 'نسبة', fixed: 'مبلغ ثابت' }
};

// أسماء قديمة في الشيت تُقرأ صحيحة
const LEGACY_VALUES = {
  accType: { 'مالشات': 'malchat' }
};

// المستخدم الحالي (من جلسة الدخول) لتسجيل "بواسطة"، وصلاحياته لقفل الأيام
let CURRENT_USER = '';
let CURRENT_AUTH = null;

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'bad_json' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    migrateLayoutIfNeeded();
    if (data.action === 'login') return json(login(data.username, data.password));

    const auth = authenticate(data);
    if (auth.error) return json({ ok: false, error: auth.error });
    CURRENT_USER = auth.username || '';
    CURRENT_AUTH = auth;
    delete data.token;
    delete data.session;

    const need = ACTION_PERMS[data.action];
    if (need && !allowed(auth, need)) return json({ ok: false, error: 'forbidden' });

    switch (data.action) {
      case 'list':
        return json(listData(data.since, auth));
      case 'batch':
        return json(withPendingLock(applyBatch(data.ops, auth)));
      case 'logout':
        if (auth.token) deleteSession(auth.token);
        return json({ ok: true });
      case 'change_password':
        return json(changePassword(auth, data.oldPassword, data.newPassword));
      case 'my_avatar':
        return json({ ok: true, avatar: auth.avatar || '' });
      case 'update_profile':
        return json(updateProfile(auth, data));
      case 'users_list':
        return json({ ok: true, users: listUsers() });
      case 'upsert_user':
        return json(upsertUser(auth, data.user));
      case 'delete_user':
        return json(deleteUser(auth, data.username));
      case 'logos':
        return json({ ok: true, logos: readLogos(data.ids) });
      case 'deleted_list':
        return json({ ok: true, items: listDeletions(200) });
      case 'edits_list':
        return json({ ok: true, items: listEdits(data.id, 300) });
      case 'reset_data':
        return json(resetData(auth, data.what));
      case 'notify_send':
        return json(sendNotify(auth, data));
      case 'notify_reply':
        return json(replyNotify(auth, data));
      case 'notify_read':
        return json(readNotify(auth, data.ids));
      case 'notify_delete':
        return json(deleteNotify(auth, data.id));
      case 'notify_poll':
        return json({ ok: true, serverTime: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), TIME_FORMAT), notifications: auth.authEnabled ? listNotifications(auth.username, typeof data.since === 'string' && data.since.length >= 16 ? data.since : '') : [] });
      case 'backups_list':
        return json(hasPerm(auth, 'users') ? { ok: true, items: listBackups() } : { ok: false, error: 'forbidden' });
      case 'backup_info':
        return json(backupInfo(auth, data.fileId));
      case 'restore_backup':
        return json(restoreBackup(auth, data.fileId, data.what));
      case 'restore_deleted':
        return json(restoreDeletion(data.logId));
      default:
        return json(withPendingLock(applyWrite(data, auth)));
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// عدة عمليات كتابة في طلب واحد (أسرع بكثير من طلب لكل عملية).
// نتوقف عند أول خطأ حتى يعيد البرنامج إرسال الباقي بالترتيب؛ المرفوضة بالصلاحية تُتجاوز.
function applyBatch(ops, auth) {
  const results = [];
  for (let i = 0; i < (ops || []).length; i++) {
    let r;
    try { r = applyWrite(ops[i] || {}, auth); } catch (err) { r = { ok: false, error: String(err) }; }
    results.push(r);
    if (!r.ok && r.error !== 'forbidden' && r.error !== 'day_locked') break;
  }
  return { ok: true, results: results };
}

// عملية كتابة واحدة (إضافة / تعديل / حذف) بعد فحص صلاحيتها
function applyWrite(data, auth) {
  const action = data.action || 'upsert';
  const need = ACTION_PERMS[action];
  if (!need && action !== 'upsert_amove' && action !== 'delete_amove') return { ok: false, error: 'unknown_action' };
  if (need && !allowed(auth, need)) return { ok: false, error: 'forbidden' };
  switch (action) {
    case 'upsert': {
      const tx = Object.assign({}, data);
      delete tx.action;
      return writeRow('ledger', tx);
    }
    case 'delete': return removeRow('ledger', data.id);
    case 'upsert_customer': return writeRow('customers', data.customer);
    case 'delete_customer': return removeRow('customers', data.id);
    case 'upsert_expense': return writeRow('expenses', data.expense);
    case 'delete_expense': return removeRow('expenses', data.id);
    case 'upsert_trader': return writeRow('traders', data.trader);
    case 'delete_trader': return removeRow('traders', data.id);
    case 'upsert_tmove': return writeRow('traderMoves', data.move);
    case 'delete_tmove': return removeRow('traderMoves', data.id);
    case 'upsert_country': return writeRow('countries', data.country);
    case 'delete_country': return removeRow('countries', data.id);
    case 'upsert_account': return writeRow('accounts', data.account);
    case 'delete_account': return removeRow('accounts', data.id);
    case 'upsert_amove': {
      const sheet = getSheet(AMOVE_SHEET, AMOVE_FIELDS);
      if (!amoveAllowed(auth, sheet, data.move && data.move.id, data.move && data.move.refType, false)) return { ok: false, error: 'forbidden' };
      return writeRow('accountMoves', data.move);
    }
    case 'delete_amove': {
      const sheet = getSheet(AMOVE_SHEET, AMOVE_FIELDS);
      if (!amoveAllowed(auth, sheet, data.id, null, true)) return { ok: false, error: 'forbidden' };
      return removeRow('accountMoves', data.id);
    }
    case 'upsert_usdt': return writeRow('usdtMoves', data.move);
    case 'delete_usdt': return removeRow('usdtMoves', data.id);
    case 'upsert_egp_wallet': return writeRow('egpWallets', data.wallet);
    case 'delete_egp_wallet': return removeRow('egpWallets', data.id);
    case 'upsert_egp': return writeRow('egpMoves', data.move);
    case 'delete_egp': return removeRow('egpMoves', data.id);
    case 'upsert_setting': {
      const r = writeRow('settings', data.setting);
      LOCK_CACHE = null;
      return r;
    }
    case 'upsert_closing': {
      const r = writeRow('closings', data.closing);
      // الجرد بيقفل يومه (والأيام اللي قبله): بعد ما تخلص العمليات كلها (withPendingLock)
      const d = String(data.closing && data.closing.date || '').slice(0, 10);
      if (r.ok && /^\d{4}-\d{2}-\d{2}$/.test(d) && d > (PENDING_LOCK || lockedThrough())) PENDING_LOCK = d;
      return r;
    }
    default:
      return { ok: false, error: 'unknown_action' };
  }
}

const collectionByName = (name) => COLLECTIONS.filter(c => c.name === name)[0];

function writeRow(name, obj) {
  const c = collectionByName(name);
  return upsertRow(getSheet(c.sheet, c.fields), c.fields, 'id', obj, name);
}

function removeRow(name, id) {
  const c = collectionByName(name);
  return deleteRow(getSheet(c.sheet, c.fields), c.fields, 'id', id, name);
}

// ================= تسجيل الدخول والصلاحيات =================
// إذا كانت ورقة المستخدمين فارغة يعمل السكربت كما كان (مفتاح SYNC_TOKEN اختياري).
// أول ما تضيف مستخدماً يصبح الدخول إجبارياً لكل الطلبات.
const SESSION_DAYS = 30;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

function usersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const isNew = !ss.getSheetByName(USERS_SHEET);
  const sheet = getSheet(USERS_SHEET, USER_FIELDS);
  // نص عادي حتى لا تضيع الأصفار في بداية كلمات السر مثل 0123
  if (isNew) sheet.getRange(1, 1, 1000, USER_FIELDS.length).setNumberFormat('@');
  return sheet;
}

// تُقرأ مرة واحدة لكل طلب، وتُمسح عند أي كتابة على ورقة المستخدمين
let USERS_CACHE = null;

function readUsers() {
  if (USERS_CACHE) return USERS_CACHE;
  const sheet = usersSheet();
  const keys = columnKeys(sheet, USER_FIELDS);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const rows = sheet.getRange(2, 1, last - 1, keys.length).getDisplayValues();
  USERS_CACHE = rows.map((r, i) => {
    const u = { row: i + 2 };
    keys.forEach((k, j) => { if (k) u[k] = String(r[j]).trim(); });
    u.perms = parsePerms(u.perms);
    u.active = !/^(لا|no|false|0|موقوف)$/i.test(u.active || '');
    if (u.avatar && u.avatar.indexOf('data:image/') !== 0) u.avatar = '';
    return u;
  }).filter(u => u.username);
  return USERS_CACHE;
}

// بيانات المستخدم التي يعرفها البرنامج عن نفسه (الصورة كبيرة: بصمتها فقط، وتُطلب بـ my_avatar)
function meOf(u) {
  return { username: u.username, displayName: u.displayName || '', avatarSig: logoSig(u.avatar), perms: u.perms };
}

// الاسم الظاهر لكل مستخدم، لعرض "بواسطة" بالاسم
function peopleNames() {
  const out = {};
  readUsers().forEach(u => { if (u.displayName) out[u.username] = u.displayName; });
  return out;
}

function cleanDisplayName(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

// صورة صالحة: data:image وبحجم يتسع في الخلية. '' = حذف الصورة
function cleanAvatar(v) {
  const s = String(v || '');
  if (!s) return { ok: true, value: '' };
  if (s.indexOf('data:image/') !== 0 || s.length > MAX_AVATAR_CHARS) return { ok: false };
  return { ok: true, value: s };
}

function parsePerms(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (/^(الكل|all|\*)$/i.test(t)) return ALL_PERMS.slice();
  const parts = t.split(/[،,]/).map(x => x.trim()).filter(Boolean);
  return ALL_PERMS.filter(k => parts.indexOf(PERMS[k]) >= 0 || parts.indexOf(k) >= 0);
}

function permsText(perms) {
  if (ALL_PERMS.every(k => perms.indexOf(k) >= 0)) return 'الكل';
  return perms.map(k => PERMS[k]).filter(Boolean).join('، ');
}

function hasPerm(auth, perm) {
  return auth.perms.indexOf(perm) >= 0;
}

function allowed(auth, need) {
  if (need.del && !hasPerm(auth, 'delete')) return false;
  return !need.any || need.any.some(p => hasPerm(auth, p));
}

// حركات الحسابات: صاحب صلاحية الحسابات يعدّل كل شيء (والحذف يحتاج صلاحية الحذف)،
// ودفعات الحوالات و USDT مسموحة لأصحاب تلك الصفحات (حتى يسجّلوا الدفع ويُرجعوه)
function amoveAllowed(auth, sheet, id, incomingRefType, isDelete) {
  let refType = incomingRefType;
  if (id !== undefined && id !== null && id !== '') {
    const keys = columnKeys(sheet, AMOVE_FIELDS);
    const r = findRow(sheet, keys, 'id', id);
    if (r > 0) refType = fromSheetValue('refType', sheet.getRange(r, keys.indexOf('refType') + 1).getValue());
  }
  if (hasPerm(auth, 'accounts') && (!isDelete || hasPerm(auth, 'delete'))) return true;
  if (refType === 'tx') return hasPerm(auth, 'transactions') || hasPerm(auth, 'calculator');
  if (refType === 'usdt') return hasPerm(auth, 'usdt');
  if (refType === 'egp') return hasPerm(auth, 'egp');
  return false;
}

function authenticate(data) {
  const users = readUsers();
  if (!users.length) {
    const expected = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
    if (expected && data.token !== expected) return { error: 'unauthorized' };
    return { username: '', perms: ALL_PERMS.slice(), authEnabled: false };
  }
  const token = String(data.session || '');
  const sess = token ? getSession(token) : null;
  if (!sess) return { error: 'auth_required' };
  const u = users.filter(x => x.username === sess.u)[0];
  if (!u || !u.active) {
    deleteSession(token);
    return { error: 'auth_required' };
  }
  return { username: u.username, perms: u.perms, authEnabled: true, token: token, displayName: u.displayName || '', avatar: u.avatar || '' };
}

function login(username, password) {
  const name = String(username || '').trim();
  const pw = String(password || '');
  const users = readUsers();
  if (!users.length) return { ok: false, error: 'no_users' };
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + name;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_FAILS) return { ok: false, error: 'locked', minutes: LOCK_MINUTES };

  const u = users.filter(x => x.username === name)[0];
  const check = u ? verifyPassword(pw, u.password) : { ok: false };
  if (!u || !check.ok || !u.active) {
    cache.put(failKey, String(fails + 1), LOCK_MINUTES * 60);
    return { ok: false, error: u && !u.active ? 'inactive' : 'bad_credentials' };
  }
  cache.remove(failKey);

  const sheet = usersSheet();
  const keys = columnKeys(sheet, USER_FIELDS);
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), TIME_FORMAT);
  // كلمة سر مكتوبة عادية: نشفّرها الآن
  if (check.plain) setUserCell(sheet, keys, u.row, 'password', hashPassword(pw));
  setUserCell(sheet, keys, u.row, 'lastLogin', now);

  cleanupSessions();
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('sess_' + token, JSON.stringify({ u: u.username, exp: Date.now() + SESSION_DAYS * 86400000 }));
  return { ok: true, session: token, me: meOf(u) };
}

function setUserCell(sheet, keys, row, key, value) {
  USERS_CACHE = null;
  const col = keys.indexOf(key) + 1;
  if (col < 1) return;
  const cell = sheet.getRange(row, col);
  cell.setNumberFormat('@');
  cell.setValue(value);
}

function getSession(token) {
  const raw = PropertiesService.getScriptProperties().getProperty('sess_' + token);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (s.exp < Date.now()) { deleteSession(token); return null; }
    return s;
  } catch (e) { return null; }
}

function deleteSession(token) {
  PropertiesService.getScriptProperties().deleteProperty('sess_' + token);
}

function cleanupSessions(username) {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(k => {
    if (k.indexOf('sess_') !== 0) return;
    try {
      const s = JSON.parse(all[k]);
      if (s.exp < Date.now() || (username && s.u === username)) props.deleteProperty(k);
    } catch (e) { props.deleteProperty(k); }
  });
}

// تشفير كلمة السر: SHA-256 مع ملح عشوائي، مكرر 100 مرة
function hashPassword(pw, salt) {
  const s = salt || Utilities.getUuid().replace(/-/g, '');
  let h = s + '|' + pw;
  for (let i = 0; i < 100; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8)
      .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  }
  return 'sha256$' + s + '$' + h;
}

function isHashed(v) {
  return String(v || '').indexOf('sha256$') === 0;
}

function verifyPassword(pw, stored) {
  const v = String(stored || '');
  if (!v) return { ok: false };
  if (!isHashed(v)) return { ok: v === String(pw), plain: true };
  const salt = v.split('$')[1];
  return { ok: hashPassword(pw, salt) === v };
}

function listUsers() {
  return readUsers().map(u => ({ username: u.username, displayName: u.displayName || '', avatar: u.avatar || '', perms: u.perms, active: u.active, lastLogin: u.lastLogin || '', createdAt: u.createdAt || '' }));
}

// إضافة / تعديل مستخدم من البرنامج. لا يمكن إيقاف نفسك أو سحب صلاحية المستخدمين منك (حتى لا يُقفل النظام)
function upsertUser(auth, user) {
  const name = String(user && user.username || '').trim();
  if (!name) return { ok: false, error: 'bad_user' };
  const perms = ALL_PERMS.filter(k => (user.perms || []).indexOf(k) >= 0);
  const active = user.active !== false;
  if (name === auth.username && (!active || perms.indexOf('users') < 0)) return { ok: false, error: 'self_lock' };
  const sheet = usersSheet();
  const keys = columnKeys(sheet, USER_FIELDS);
  const existing = readUsers().filter(u => u.username === name)[0];
  if (!existing && !user.password) return { ok: false, error: 'password_required' };
  if (user.isNew && existing) return { ok: false, error: 'exists' };
  const avatar = user.avatar === undefined ? null : cleanAvatar(user.avatar);
  if (avatar && !avatar.ok) return { ok: false, error: 'bad_avatar' };
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), TIME_FORMAT);
  const row = existing ? existing.row : sheet.getLastRow() + 1;
  setUserCell(sheet, keys, row, 'username', name);
  if (user.password) setUserCell(sheet, keys, row, 'password', hashPassword(String(user.password)));
  setUserCell(sheet, keys, row, 'perms', permsText(perms));
  setUserCell(sheet, keys, row, 'active', active ? 'نعم' : 'لا');
  if (user.displayName !== undefined) setUserCell(sheet, keys, row, 'displayName', cleanDisplayName(user.displayName));
  if (avatar) setUserCell(sheet, keys, row, 'avatar', avatar.value);
  if (!existing) setUserCell(sheet, keys, row, 'createdAt', now.slice(0, 10));
  setUserCell(sheet, keys, row, 'updatedAt', now);
  // كلمة سر جديدة أو إيقاف: نخرجه من كل أجهزته
  if (existing && (user.password || !active)) cleanupSessions(name);
  const self = name === auth.username ? readUsers().filter(u => u.username === name)[0] : null;
  return self ? { ok: true, me: meOf(self) } : { ok: true };
}

function deleteUser(auth, username) {
  const name = String(username || '').trim();
  if (name === auth.username) return { ok: false, error: 'self_lock' };
  const u = readUsers().filter(x => x.username === name)[0];
  if (!u) return { ok: true };
  USERS_CACHE = null;
  usersSheet().deleteRow(u.row);
  cleanupSessions(name);
  return { ok: true };
}

function changePassword(auth, oldPassword, newPassword) {
  if (!auth.authEnabled) return { ok: false, error: 'no_users' };
  const pw = String(newPassword || '');
  if (pw.length < 4) return { ok: false, error: 'weak_password' };
  const u = readUsers().filter(x => x.username === auth.username)[0];
  if (!u || !verifyPassword(String(oldPassword || ''), u.password).ok) return { ok: false, error: 'bad_credentials' };
  const sheet = usersSheet();
  setUserCell(sheet, columnKeys(sheet, USER_FIELDS), u.row, 'password', hashPassword(pw));
  return { ok: true };
}

// كل مستخدم يغيّر اسمه الظاهر وصورته بنفسه (اسم الدخول والصلاحيات من المدير فقط)
function updateProfile(auth, data) {
  if (!auth.authEnabled) return { ok: false, error: 'no_users' };
  const u = readUsers().filter(x => x.username === auth.username)[0];
  if (!u) return { ok: false, error: 'auth_required' };
  const sheet = usersSheet();
  const keys = columnKeys(sheet, USER_FIELDS);
  if (data.displayName !== undefined) setUserCell(sheet, keys, u.row, 'displayName', cleanDisplayName(data.displayName));
  if (data.avatar !== undefined) {
    const avatar = cleanAvatar(data.avatar);
    if (!avatar.ok) return { ok: false, error: 'bad_avatar' };
    setUserCell(sheet, keys, u.row, 'avatar', avatar.value);
  }
  setUserCell(sheet, keys, u.row, 'updatedAt', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), TIME_FORMAT));
  const me = readUsers().filter(x => x.username === auth.username)[0];
  return { ok: true, me: meOf(me) };
}

// ================= ترتيب الشيت ليطابق البرنامج =================
// يعمل تلقائياً مرة واحدة بعد كل تحديث للأعمدة، ويمكن تشغيله يدوياً من المحرر: اختر "رتّب_الشيت" ثم Run.
// قبل الترتيب: نسخة كاملة بمجلد النسخ بـ Drive ("قبل ترتيب الأعمدة")، فما بتنعمل أوراق "- نسخة" جوّا الملف.
// إذا النسخ على Drive ما زبط: نسخة من كل ورقة جوّا الملف زي قبل
function رتّب_الشيت() {
  let copyInFile = false;
  try {
    dailyBackup('قبل ترتيب الأعمدة');
  } catch (err) {
    copyInFile = true;
  }
  [[TX_SHEET, TX_FIELDS], [CUST_SHEET, CUST_FIELDS], [EXP_SHEET, EXP_FIELDS], [TRADER_SHEET, TRADER_FIELDS], [TMOVE_SHEET, TMOVE_FIELDS], [COUNTRY_SHEET, COUNTRY_FIELDS], [ACCOUNT_SHEET, ACCOUNT_FIELDS], [AMOVE_SHEET, AMOVE_FIELDS], [USDT_SHEET, USDT_FIELDS], [EGP_WALLET_SHEET, EGP_WALLET_FIELDS], [EGP_SHEET, EGP_FIELDS], [SETTINGS_SHEET, SETTINGS_FIELDS], [CLOSING_SHEET, CLOSING_FIELDS]].forEach(([name, fields]) => {
    reorderSheet(getSheet(name, fields), name, fields, copyInFile);
  });
  ensureIds(getSheet(CUST_SHEET, CUST_FIELDS), CUST_FIELDS, 'name');
  fillMissingSerials();
  PropertiesService.getScriptProperties().setProperty('LAYOUT_VERSION', LAYOUT_VERSION);
}

function migrateLayoutIfNeeded() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('LAYOUT_VERSION') !== LAYOUT_VERSION) رتّب_الشيت();
}

// يرتّب الأعمدة بنفس ترتيب البرنامج، يحذف الأعمدة الملغاة، ويُبقي أي عمود أضفته بنفسك في الآخر.
// copyInFile: نسخة من الورقة جوّا الملف قبل الترتيب (بس إذا النسخة على Drive ما زبطت)
function reorderSheet(sheet, name, fields, copyInFile) {
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (!lastCol) return;
  const tz = Session.getScriptTimeZone();
  const values = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  const headers = values[0].map(h => String(h).trim());
  const obsolete = OBSOLETE_LABELS[name] || [];
  const labels = fields.map(f => f[1]);
  const keyOfLabel = {};
  fields.forEach(([key, label]) => { keyOfLabel[label] = key; });

  const order = labels.map(l => headers.indexOf(l));
  headers.forEach((h, i) => {
    if (h && !labels.includes(h) && !obsolete.includes(h)) order.push(i);
  });
  const newHeaders = order.map((i, n) => (n < labels.length ? labels[n] : headers[i]));

  const rows = values.slice(1)
    .filter(r => r.some(v => String(v).trim() !== ''))
    .map(r => order.map((i, n) => {
      if (i < 0) return '';
      const v = r[i];
      if (v instanceof Date) {
        const key = n < labels.length ? keyOfLabel[labels[n]] : '';
        return Utilities.formatDate(v, tz, DATE_FIELDS.includes(key) ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm');
      }
      return String(v);
    }));

  // نسخة احتياطية من الورقة قبل الترتيب (يمكن حذفها لاحقاً)
  if (rows.length && copyInFile) {
    const backup = sheet.copyTo(SpreadsheetApp.getActiveSpreadsheet());
    backup.setName(name + ' - نسخة ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH-mm'));
  }

  sheet.clearContents();
  const headerRange = sheet.getRange(1, 1, 1, newHeaders.length);
  headerRange.setValues([newHeaders]);
  headerRange.setFontWeight('bold');
  if (rows.length) {
    const range = sheet.getRange(2, 1, rows.length, newHeaders.length);
    range.setNumberFormat('@');
    range.setValues(rows);
  }
  sheet.setFrozenRows(1);
  sheet.setRightToLeft(true);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// يُنشئ الورقة إن لم تكن موجودة، يحوّل العناوين الإنجليزية القديمة للعربي، ويضيف أي عمود ناقص
function getSheet(name, fields) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.setRightToLeft(true);
  }

  const headers = headersOf(sheet);
  const englishToArabic = Object.assign({}, LEGACY_LABELS[name] || {});
  fields.forEach(([key, label]) => { englishToArabic[key] = label; });

  let renamed = false;
  const fixed = headers.map(h => {
    if (englishToArabic[h]) { renamed = true; return englishToArabic[h]; }
    return h;
  });
  if (renamed) sheet.getRange(1, 1, 1, fixed.length).setValues([fixed]);

  const missing = fields.map(f => f[1]).filter(label => !fixed.includes(label));
  if (missing.length) {
    sheet.getRange(1, fixed.length + 1, 1, missing.length).setValues([missing]);
  }
  if (renamed || missing.length) {
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
  }
  return sheet;
}

function headersOf(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  const row = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
  while (row.length && !row[row.length - 1]) row.pop();
  return row;
}

// مفتاح البرنامج لكل عمود حسب اسمه العربي (الأعمدة الإضافية التي أضفتها بنفسك تبقى كما هي)
function columnKeys(sheet, fields) {
  const labelToKey = {};
  fields.forEach(([key, label]) => { labelToKey[label] = key; });
  return headersOf(sheet).map(h => labelToKey[h] || null);
}

function findRow(sheet, keys, key, value) {
  const col = keys.indexOf(key) + 1;
  const last = sheet.getLastRow();
  if (col < 1 || last < 2) return -1;
  const values = sheet.getRange(2, col, last - 1, 1).getDisplayValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(value).trim()) return i + 2;
  }
  return -1;
}

// صفوف بدون رقم (أُضيفت يدوياً في الشيت مثلاً) تأخذ رقماً حتى يمكن تعديلها من البرنامج
function ensureIds(sheet, fields, requiredKey) {
  const keys = columnKeys(sheet, fields);
  const idCol = keys.indexOf('id') + 1;
  const reqCol = keys.indexOf(requiredKey) + 1;
  const last = sheet.getLastRow();
  if (idCol < 1 || last < 2) return;
  const ids = sheet.getRange(2, idCol, last - 1, 1).getDisplayValues();
  const req = reqCol > 0 ? sheet.getRange(2, reqCol, last - 1, 1).getDisplayValues() : ids;
  const changedRows = [];
  const base = Date.now();
  ids.forEach((row, i) => {
    if (!String(row[0]).trim() && String(req[i][0]).trim()) { row[0] = 'c' + (base + i); changedRows.push(i + 2); }
  });
  if (!changedRows.length) return;
  const range = sheet.getRange(2, idCol, last - 1, 1);
  range.setNumberFormat('@');
  range.setValues(ids);
  // حتى يظهر الصف في التحديث السريع للبرنامج
  const updCol = keys.indexOf('updatedAt') + 1;
  if (updCol < 1) return;
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), TIME_FORMAT);
  changedRows.forEach(r => stampCell(sheet.getRange(r, updCol), now));
}

// يحوّل القيم القديمة (div / mul / direct_percent) في عمود نوع المعادلة إلى العربي
function translateTypeColumn(sheet) {
  const col = columnKeys(sheet, TX_FIELDS).indexOf('type') + 1;
  const last = sheet.getLastRow();
  if (col < 1 || last < 2) return;
  const range = sheet.getRange(2, col, last - 1, 1);
  const values = range.getValues();
  let changed = false;
  values.forEach(row => {
    const label = TYPE_LABELS[String(row[0]).trim()];
    if (label) { row[0] = label; changed = true; }
  });
  if (changed) range.setValues(values);
}

function toSheetValue(key, value) {
  const labels = VALUE_LABELS[key];
  if (labels && labels[value]) return labels[value];
  return String(value);
}

function fromSheetValue(key, value, tz) {
  if (value instanceof Date) {
    return DATE_FIELDS.includes(key) ? Utilities.formatDate(value, tz, 'yyyy-MM-dd') : value.toISOString();
  }
  const labels = VALUE_LABELS[key];
  if (labels) {
    for (const code in labels) {
      if (labels[code] === String(value).trim()) return code;
    }
  }
  const legacy = LEGACY_VALUES[key];
  if (legacy && legacy[String(value).trim()]) return legacy[String(value).trim()];
  return value;
}

// collection: اسم القائمة، لقفل الأيام وسجل التعديلات ورقم الإيصال (بدونه كتابة عادية)
function upsertRow(sheet, fields, key, obj, collection) {
  if (!obj || obj[key] === undefined || obj[key] === '') return { ok: true };
  const keys = columnKeys(sheet, fields);
  const r = findRow(sheet, keys, key, obj[key]);
  const rowIndex = r > 0 ? r : sheet.getLastRow() + 1;
  const range = sheet.getRange(rowIndex, 1, 1, keys.length);
  const tz = Session.getScriptTimeZone();

  // نحدّث فقط الحقول المرسلة ونحافظ على باقي الأعمدة كما هي
  const old = r > 0 ? range.getValues()[0].map((v, i) => (v instanceof Date ? fromSheetValue(keys[i], v, tz) : v)) : null;
  const row = old ? old.slice() : keys.map(() => '');
  keys.forEach((k, i) => {
    if (!k) return;
    if (k === 'updatedAt') row[i] = Utilities.formatDate(new Date(), tz, TIME_FORMAT);
    // مين أضاف ومين عدّل: من الجلسة فقط، ونتجاهل ما يرسله البرنامج
    else if (k === 'createdBy') { if (r < 0 && CURRENT_USER) row[i] = CURRENT_USER; }
    else if (k === 'updatedBy') { if (CURRENT_USER) row[i] = CURRENT_USER; }
    // رقم الإيصال يعطيه السكربت بس (تحت)
    else if (k === 'serial') return;
    else if (obj[k] !== undefined && obj[k] !== null) row[i] = toSheetValue(k, obj[k]);
  });

  const changes = old && collection ? rowChanges(keys, fields, old, row) : [];
  if (collection && lockViolation(collection, keys, old, row, changes)) return { ok: false, error: 'day_locked' };

  const result = { ok: true };
  const sIdx = keys.indexOf('serial');
  const wantsSerial = SERIAL_RULES[collection];
  if (sIdx >= 0 && wantsSerial && wantsSerial(fromSheetValue('kind', row[keys.indexOf('kind')] || '', tz)) && !String(row[sIdx]).trim()) {
    // المسترجَع من المحذوفات برجع برقمه القديم
    row[sIdx] = String(RESTORING && obj.serial ? obj.serial : nextSerial());
  }
  if (sIdx >= 0 && String(row[sIdx]).trim()) result.serial = Number(row[sIdx]) || String(row[sIdx]);

  // تنسيق نصي حتى لا تضيع الأصفار في بداية أرقام الجوالات
  range.setNumberFormat('@');
  range.setValues([row]);
  if (changes.length) logEdit(collection, obj[key], keys, row, changes);
  return result;
}

function deleteRow(sheet, fields, key, value, collection) {
  if (value === undefined || value === '') return { ok: true };
  const keys = columnKeys(sheet, fields);
  const r = findRow(sheet, keys, key, value);
  // نسخة من السطر قبل حذفه حتى يمكن استرجاعه من "سجل المحذوفات"
  let snapshot = null;
  if (r > 0) {
    const tz = Session.getScriptTimeZone();
    const row = sheet.getRange(r, 1, 1, keys.length).getValues()[0];
    snapshot = {};
    keys.forEach((k, i) => { if (k && k !== 'logo') snapshot[k] = fromSheetValue(k, row[i], tz); });
    if (collection && dayIsLocked(collection, String(snapshot.date || '').slice(0, 10))) return { ok: false, error: 'day_locked' };
    sheet.deleteRow(r);
  }
  if (collection) logDeletion(collection, value, snapshot);
  return { ok: true };
}

// ================= رقم الإيصال المتسلسل =================
// رقم قصير (1001، 1002...) للحوالات وحركات USDT والجنيه اللي إلها فاتورة، بدل رقم الحركة الطويل.
// عدّاد واحد للكل بـ ScriptProperties، والسكربت بيعطيه وهو ماسك القفل فما بيتكرر
const SERIAL_START = 1000;
const SERIAL_RULES = {
  ledger: () => true,
  usdtMoves: (kind) => kind === 'deposit' || kind === 'withdraw',
  egpMoves: (kind) => kind === 'send' || kind === 'receive'
};
// الاسترجاع من المحذوفات برجّع رقم الإيصال القديم
let RESTORING = false;

function nextSerial() {
  const props = PropertiesService.getScriptProperties();
  const n = Math.max(Number(props.getProperty('RECEIPT_SERIAL') || 0), SERIAL_START) + 1;
  props.setProperty('RECEIPT_SERIAL', String(n));
  return n;
}

// الصفوف القديمة بدون رقم إيصال: بترتيب إنشائها (رقم الحركة مبني على الوقت)
function fillMissingSerials() {
  const tz = Session.getScriptTimeZone();
  const items = [];
  Object.keys(SERIAL_RULES).forEach(name => {
    const c = collectionByName(name);
    const sheet = getSheet(c.sheet, c.fields);
    const keys = columnKeys(sheet, c.fields);
    const last = sheet.getLastRow();
    const sIdx = keys.indexOf('serial'), idIdx = keys.indexOf('id'), kIdx = keys.indexOf('kind');
    if (last < 2 || sIdx < 0 || idIdx < 0) return;
    sheet.getRange(2, 1, last - 1, keys.length).getValues().forEach((r, i) => {
      if (String(r[idIdx]).trim() === '' || String(r[sIdx]).trim() !== '') return;
      if (!SERIAL_RULES[name](kIdx >= 0 ? fromSheetValue('kind', r[kIdx], tz) : '')) return;
      items.push({ sheet: sheet, row: i + 2, col: sIdx + 1, upd: keys.indexOf('updatedAt') + 1, id: Number(r[idIdx]) || 0 });
    });
  });
  items.sort((a, b) => a.id - b.id);
  const now = Utilities.formatDate(new Date(), tz, TIME_FORMAT);
  items.forEach(it => {
    stampCell(it.sheet.getRange(it.row, it.col), String(nextSerial()));
    if (it.upd > 0) stampCell(it.sheet.getRange(it.row, it.upd), now);
  });
}

// ================= قفل الأيام بعد الجرد =================
// الجرد بيقفل يومه واللي قبله (إعداد lockedThrough بورقة الإعدادات، والمدير بيقدر يغيّره من البرنامج).
// اللي ما معه صلاحية "تعديل الأيام المقفلة": ما بيعدّل ولا بيحذف حركة تاريخها مقفل، وما بيضيف حركة بتاريخ قبل آخر يوم مجرود
// (بنفس يوم الجرد مسموح: زبون إجا بعد الجرد). الحقول الحرة بتتغير عادي: الحالة (إلا الإلغاء)، اسم الزبون، الملاحظة
const LOCK_FREE_FIELDS = {
  ledger: ['status', 'recipient', 'customerId'],
  usdtMoves: ['customerName', 'customerId'],
  egpMoves: ['customerName', 'customerId'],
  accountMoves: ['note', 'accountName'],
  traderMoves: ['traderName'],
  expenses: []
};
const LOCK_SETTING = 'lockedThrough';
let LOCK_CACHE = null;
let PENDING_LOCK = '';

function lockedThrough() {
  if (LOCK_CACHE !== null) return LOCK_CACHE;
  const sheet = getSheet(SETTINGS_SHEET, SETTINGS_FIELDS);
  const keys = columnKeys(sheet, SETTINGS_FIELDS);
  const r = findRow(sheet, keys, 'id', LOCK_SETTING);
  let v = r > 0 ? sheet.getRange(r, keys.indexOf('value') + 1).getValue() : '';
  if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  v = String(v || '').trim().slice(0, 10);
  LOCK_CACHE = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  return LOCK_CACHE;
}

function canEditLockedDays() {
  return !CURRENT_AUTH || hasPerm(CURRENT_AUTH, 'unlock');
}

function dayIsLocked(collection, date) {
  if (!LOCK_FREE_FIELDS[collection] || canEditLockedDays()) return false;
  const lock = lockedThrough();
  return !!(lock && date && date <= lock);
}

function lockViolation(collection, keys, old, row, changes) {
  const free = LOCK_FREE_FIELDS[collection];
  if (!free || canEditLockedDays()) return false;
  const lock = lockedThrough();
  const dIdx = keys.indexOf('date');
  if (!lock || dIdx < 0) return false;
  const newDate = String(row[dIdx]).slice(0, 10);
  if (!old) return !!newDate && newDate < lock;
  const oldDate = String(old[dIdx]).slice(0, 10);
  if (!oldDate || oldDate > lock) return !!newDate && newDate < lock;
  const sIdx = keys.indexOf('status');
  return changes.some(c => free.indexOf(c[0]) < 0 || (c[0] === 'status' && String(row[sIdx]).trim() === 'ملغي'));
}

function setLockedThrough(date) {
  upsertRow(getSheet(SETTINGS_SHEET, SETTINGS_FIELDS), SETTINGS_FIELDS, 'id',
    { id: LOCK_SETTING, label: 'قفل الأيام: الحركات لحد هاد التاريخ ما بتتعدل (بيتحدث مع كل جرد)', value: date }, 'settings');
  LOCK_CACHE = date;
}

// بعد ما تخلص عمليات الطلب: الجرد اللي انحفظ بيقفل يومه
function withPendingLock(result) {
  if (PENDING_LOCK) {
    setLockedThrough(PENDING_LOCK);
    PENDING_LOCK = '';
  }
  return result;
}

// ================= سجل التعديلات =================
// كل تعديل على صف موجود: القائمة، الرقم، الوقت، مين، ملخص، والتغييرات [[الحقل، قبل، بعد]...]
const EDITS_SHEET = '_سجل التعديلات';
const EDITS_HEADERS = ['القائمة', 'الرقم', 'الوقت', 'بواسطة', 'ملخص', 'التغييرات'];
// حقول ما بنسجّل تغييرها (بيكتبها السكربت، أو كبيرة)
const EDIT_SKIP = ['updatedAt', 'updatedBy', 'createdBy', 'serial', 'logo', 'label'];

function editsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(EDITS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(EDITS_SHEET);
    sheet.getRange(1, 1, 1, EDITS_HEADERS.length).setValues([EDITS_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

// نص للمقارنة: الأرقام بقيمتها (500 = 500.00)
function cellText(v) {
  const t = String(v === null || v === undefined ? '' : v).trim();
  const n = Number(t);
  return t !== '' && isFinite(n) ? String(n) : t;
}

function rowChanges(keys, fields, old, row) {
  const labelOf = {};
  fields.forEach(([k, l]) => { labelOf[k] = l; });
  const out = [];
  keys.forEach((k, i) => {
    if (!k || EDIT_SKIP.indexOf(k) >= 0) return;
    if (cellText(old[i]) !== cellText(row[i])) out.push([k, labelOf[k] || k, String(old[i]).slice(0, 200), String(row[i]).slice(0, 200)]);
  });
  return out;
}

function logEdit(collection, id, keys, row, changes) {
  const tz = Session.getScriptTimeZone();
  const snap = {};
  keys.forEach((k, i) => { if (k && k !== 'logo') snap[k] = fromSheetValue(k, row[i], tz); });
  logEvent(collection, id, collection === 'settings' ? String(snap.id || '') : deletionSummary(collection, snap),
    changes.map(c => [c[1], c[2], c[3]]));
}

// changes: [[الحقل، قبل، بعد]...]
function logEvent(collection, id, summary, changes) {
  const sheet = editsSheet();
  const n = sheet.getLastRow() + 1;
  const range = sheet.getRange(n, 1, 1, EDITS_HEADERS.length);
  range.setNumberFormat('@');
  range.setValues([[collection, String(id), Utilities.formatDate(new Date(), Session.getScriptTimeZone(), TIME_FORMAT), CURRENT_USER || '',
    summary, JSON.stringify(changes).slice(0, 45000)]]);
  // نحتفظ بآخر 3000 تعديل
  if (n > 3500) sheet.deleteRows(2, n - 3001);
}

function listEdits(id, limit) {
  const sheet = editsSheet();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const tz = Session.getScriptTimeZone();
  const fmt = (v) => (v instanceof Date ? Utilities.formatDate(v, tz, TIME_FORMAT) : String(v));
  const want = id === undefined || id === null || id === '' ? '' : String(id);
  return sheet.getRange(2, 1, last - 1, EDITS_HEADERS.length).getValues()
    .filter(r => !want || String(r[1]) === want)
    .reverse().slice(0, limit)
    .map(r => {
      let changes = [];
      try { changes = JSON.parse(String(r[5] || '[]')); } catch (e) { /* سطر تالف */ }
      return { c: String(r[0]), label: COLLECTION_LABELS[String(r[0])] || String(r[0]), id: String(r[1]), at: fmt(r[2]), by: String(r[3] || ''), summary: String(r[4] || ''), changes: changes };
    });
}

// ================= مسح البيانات التجريبية =================
// قبل البدء بالشغل الحقيقي: بيمسح الأوراق المختارة (بعد نسخة احتياطية كاملة)، وبيضل: المستخدمين، الإعدادات،
// تسعير الدول، قائمة الحسابات ومحافظ الجنيه. صلاحية الإعدادات والحذف وإدارة المستخدمين (المدير بس).
// لمرة وحدة: بعدها الزر بيختفي والسكربت بيرفض (RESET_DONE). لترجعه شغّل "اسمح_بالمسح_مرة_ثانية" من المحرر
const RESET_GROUPS = {
  ledger: [TX_SHEET],
  usdt: [USDT_SHEET],
  egp: [EGP_SHEET],
  amoves: [AMOVE_SHEET],
  expenses: [EXP_SHEET],
  customers: [CUST_SHEET],
  traders: [TRADER_SHEET, TMOVE_SHEET],
  closings: [CLOSING_SHEET],
  logs: [DELETED_SHEET, EDITS_SHEET, '_الإشعارات']
};

function resetData(auth, what) {
  if (!hasPerm(auth, 'users')) return { ok: false, error: 'forbidden' };
  if (resetDoneInfo()) return { ok: false, error: 'reset_used' };
  const groups = (Array.isArray(what) ? what : []).filter(g => RESET_GROUPS[g]);
  if (!groups.length) return { ok: false, error: 'nothing_selected' };
  try {
    dailyBackup('قبل المسح');
  } catch (err) {
    return { ok: false, error: 'backup_failed', detail: String(err) };
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const counts = {};
  groups.forEach(g => RESET_GROUPS[g].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const last = sheet.getLastRow();
    counts[name] = Math.max(0, last - 1);
    if (last > 1) sheet.getRange(2, 1, last - 1, Math.max(sheet.getLastColumn(), 1)).clearContent();
  }));
  const props = PropertiesService.getScriptProperties();
  if (['ledger', 'usdt', 'egp'].every(g => groups.indexOf(g) >= 0)) props.deleteProperty('RECEIPT_SERIAL');
  setLockedThrough('');
  // الأجهزة الثانية بتعرف إنه البيانات انمسحت فبتعمل تحميل كامل
  props.setProperty('DATA_EPOCH', String(Date.now()));
  const done = { at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), TIME_FORMAT), by: CURRENT_USER || '' };
  props.setProperty('RESET_DONE', JSON.stringify(done));
  return { ok: true, counts: counts, backup: props.getProperty('LAST_BACKUP') || '', resetDone: done };
}

// {at, by} إذا المسح انعمل، وإلا null
function resetDoneInfo() {
  const raw = PropertiesService.getScriptProperties().getProperty('RESET_DONE');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return { at: String(raw), by: '' }; }
}

// المسح لمرة وحدة. إذا رجعت بدك تمسح كمان مرة (مثلاً رجعت تجرّب): اختر هاي الدالة من المحرر واضغط Run،
// وبيرجع زر المسح بالبرنامج لمرة وحدة كمان
function اسمح_بالمسح_مرة_ثانية() {
  PropertiesService.getScriptProperties().deleteProperty('RESET_DONE');
}

// ================= استرجاع نسخة احتياطية =================
// المدير بيختار نسخة من مجلد النسخ وشو يرجّع منها. أول إشي نسخة من الوضع الحالي (وإذا فشلت ما بيتغير شي)،
// وبعدها الأوراق المختارة بترجع زي ما كانت بالنسخة، عمود عمود حسب اسمه (النسخة ممكن تكون بترتيب أعمدة أقدم).
// الأوراق المخفية (المحذوفات وسجل التعديلات) ما بترجع، والاسترجاع نفسه بينكتب بسجل التعديلات.
// بعدها كل الأجهزة بتعمل تحميل كامل (DATA_EPOCH)، وأرقام الإيصالات بتكمل بعد أكبر رقم فما بيتكرر رقم
const RESTORE_GROUPS = {
  ledger: [TX_SHEET],
  usdt: [USDT_SHEET],
  egp: [EGP_WALLET_SHEET, EGP_SHEET],
  accounts: [ACCOUNT_SHEET, AMOVE_SHEET],
  expenses: [EXP_SHEET],
  customers: [CUST_SHEET],
  traders: [TRADER_SHEET, TMOVE_SHEET],
  closings: [CLOSING_SHEET],
  settings: [SETTINGS_SHEET, COUNTRY_SHEET],
  users: [USERS_SHEET]
};

const fieldsOfSheet = (name) => (name === USERS_SHEET ? USER_FIELDS : COLLECTIONS.filter(c => c.sheet === name)[0].fields);

function backupFolder() {
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  return folders.hasNext() ? folders.next() : null;
}

// ملفات الشيت بمجلد النسخ، الأحدث أول. note: "قبل المسح" / "قبل الاسترجاع" (فاضي = النسخة اليومية)
function listBackups() {
  const folder = backupFolder();
  if (!folder) return [];
  const tz = Session.getScriptTimeZone();
  const out = [];
  const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed()) continue;
    const m = f.getName().match(/ - نسخة \d{4}-\d{2}-\d{2} \d{2}-\d{2}(?: - (.+))?$/);
    out.push({ id: f.getId(), name: f.getName(), at: Utilities.formatDate(f.getDateCreated(), tz, TIME_FORMAT), note: m && m[1] ? m[1] : '' });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// الملف لازم يكون بمجلد النسخ (ما بنفتح أي ملف ثاني حتى لو انبعت رقمه)
function backupFile(id) {
  const folder = backupFolder();
  if (!folder || !id) return null;
  const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (files.hasNext()) {
    const f = files.next();
    if (f.getId() === String(id)) return f.isTrashed() ? null : f;
  }
  return null;
}

// كم سطر بكل مجموعة بالنسخة (null = الورقة مش موجودة فيها)، حتى يعرف المدير شو فيها قبل ما يرجّعها
function backupInfo(auth, fileId) {
  if (!hasPerm(auth, 'users')) return { ok: false, error: 'forbidden' };
  const f = backupFile(fileId);
  if (!f) return { ok: false, error: 'not_found' };
  const copy = SpreadsheetApp.openById(f.getId());
  const rows = {};
  Object.keys(RESTORE_GROUPS).forEach(g => {
    let n = null;
    RESTORE_GROUPS[g].forEach(name => {
      const sh = copy.getSheetByName(name);
      if (sh) n = (n || 0) + backupRows(sh).rows.length;
    });
    rows[g] = n;
  });
  return { ok: true, rows: rows };
}

// صفوف ورقة من النسخة مع اسم كل عمود بالعربي (العناوين الإنجليزية والقديمة بتتحول)
function backupRows(sh) {
  const name = sh.getName();
  const fields = fieldsOfSheet(name);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (!lastRow || !lastCol) return { labels: [], rows: [] };
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const rename = Object.assign({}, LEGACY_LABELS[name] || {});
  fields.forEach(([key, label]) => { rename[key] = label; });
  const labels = values[0].map(h => { const t = String(h).trim(); return rename[t] || t; });
  return { labels: labels, rows: values.slice(1).filter(r => r.some(v => String(v).trim() !== '')) };
}

// المستخدمين: لازم إنت تكون بالنسخة فعّال ومعك إدارة المستخدمين، وإلا بتسكّر البرنامج على حالك
function restoredUserOk(copy, username) {
  const sh = copy.getSheetByName(USERS_SHEET);
  if (!sh) return true;
  const b = backupRows(sh);
  const col = (key) => b.labels.indexOf(USER_FIELDS.filter(f => f[0] === key)[0][1]);
  const iName = col('username'), iPerms = col('perms'), iActive = col('active');
  return b.rows.some(r => iName >= 0 && String(r[iName]).trim() === username
    && !/^(لا|no|false|0|موقوف)$/i.test(iActive >= 0 ? String(r[iActive]).trim() : '')
    && iPerms >= 0 && parsePerms(r[iPerms]).indexOf('users') >= 0);
}

// بيبدّل صفوف الورقة هون بصفوف النسخة. عمود موجود بالنسخة بس (أضفته بإيدك) بينضاف بالآخر.
// بترجع عدد الأسطر قبل وبعد
function copySheetRows(src, name) {
  const fields = fieldsOfSheet(name);
  const target = name === USERS_SHEET ? usersSheet() : getSheet(name, fields);
  const tz = Session.getScriptTimeZone();
  const b = backupRows(src);
  const obsolete = OBSOLETE_LABELS[name] || [];
  let headers = headersOf(target);
  const extra = b.labels.filter((h, i) => h && headers.indexOf(h) < 0 && obsolete.indexOf(h) < 0 && b.labels.indexOf(h) === i);
  if (extra.length) {
    target.getRange(1, headers.length + 1, 1, extra.length).setValues([extra]);
    headers = headers.concat(extra);
  }
  const keyOfLabel = {};
  fields.forEach(([key, label]) => { keyOfLabel[label] = key; });
  const rows = b.rows.map(r => headers.map(h => {
    const i = b.labels.indexOf(h);
    if (i < 0) return '';
    const v = r[i];
    if (v instanceof Date) return Utilities.formatDate(v, tz, DATE_FIELDS.indexOf(keyOfLabel[h]) >= 0 ? 'yyyy-MM-dd' : TIME_FORMAT);
    return v === null || v === undefined ? '' : String(v);
  }));
  const last = target.getLastRow();
  if (last > 1) target.getRange(2, 1, last - 1, Math.max(target.getLastColumn(), headers.length)).clearContent();
  if (rows.length) {
    const range = target.getRange(2, 1, rows.length, headers.length);
    range.setNumberFormat('@');
    range.setValues(rows);
  }
  return { before: Math.max(0, last - 1), after: rows.length };
}

// عدّاد الإيصالات ما بيرجع لورا: بيكمل بعد أكبر رقم بالأوراق (مثلاً لما ترجع بيانات قبل المسح)
function raiseSerialToMax() {
  let max = 0;
  Object.keys(SERIAL_RULES).forEach(name => {
    const c = collectionByName(name);
    const sheet = getSheet(c.sheet, c.fields);
    const col = columnKeys(sheet, c.fields).indexOf('serial') + 1;
    const last = sheet.getLastRow();
    if (col < 1 || last < 2) return;
    sheet.getRange(2, col, last - 1, 1).getValues().forEach(r => { max = Math.max(max, Number(r[0]) || 0); });
  });
  const props = PropertiesService.getScriptProperties();
  if (max > Number(props.getProperty('RECEIPT_SERIAL') || 0)) props.setProperty('RECEIPT_SERIAL', String(max));
}

function restoreBackup(auth, fileId, what) {
  if (!hasPerm(auth, 'users')) return { ok: false, error: 'forbidden' };
  const groups = (Array.isArray(what) ? what : []).filter(g => RESTORE_GROUPS[g]);
  if (!groups.length) return { ok: false, error: 'nothing_selected' };
  const f = backupFile(fileId);
  if (!f) return { ok: false, error: 'not_found' };
  const copy = SpreadsheetApp.openById(f.getId());
  if (groups.indexOf('users') >= 0 && auth.authEnabled && !restoredUserOk(copy, auth.username)) return { ok: false, error: 'self_lock' };
  let before;
  try {
    before = dailyBackup('قبل الاسترجاع');
  } catch (err) {
    return { ok: false, error: 'backup_failed', detail: String(err) };
  }
  const counts = {};
  const changes = [];
  const missing = [];
  groups.forEach(g => RESTORE_GROUPS[g].forEach(name => {
    const src = copy.getSheetByName(name);
    if (!src) return missing.push(name);
    const n = copySheetRows(src, name);
    counts[name] = n.after;
    changes.push([name, n.before + ' سطر', n.after + ' سطر']);
  }));
  USERS_CACHE = null;
  LOCK_CACHE = null;
  raiseSerialToMax();
  // نسخة قديمة قبل رقم الإيصال: صفوفها بتاخد أرقام جديدة
  fillMissingSerials();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('DATA_EPOCH', String(Date.now()));
  logEvent('backup', '', 'استرجاع نسخة · ' + f.getName(), changes);
  return { ok: true, counts: counts, missing: missing, backup: before };
}

// ================= القراءة: كاملة أو السريعة (ما تغيّر فقط) =================
// since: وقت آخر قراءة من الرد السابق (serverTime). بدونه تُرجع كل البيانات.
function listData(since, auth) {
  const tz = Session.getScriptTimeZone();
  const serverTime = Utilities.formatDate(new Date(), tz, TIME_FORMAT);
  const incremental = typeof since === 'string' && since.length >= 16;
  const out = { ok: true, serverTime: serverTime, incremental: incremental };
  out.me = auth.authEnabled ? meOf(auth) : null;
  if (auth.authEnabled) out.people = peopleNames();
  if (hasPerm(auth, 'settings')) {
    out.lastBackup = PropertiesService.getScriptProperties().getProperty('LAST_BACKUP') || '';
    out.resetDone = resetDoneInfo();
  }
  out.authEnabled = !!auth.authEnabled;
  // ميزات هالنسخة من السكربت: البرنامج يفعّل الخانات اللي بتحتاج أعمدة جديدة بس إذا السكربت بيدعمها
  out.features = ['finalAdjust', 'serial', 'editLog', 'dayLock', 'resetData', 'alerts', 'restore', 'iban', 'notify', 'txAdjust', 'notifyDelete'];
  // الإشعارات: اللي إلي (أو بعتها). مع الدخول بالمستخدمين بس
  if (auth.authEnabled) {
    out.notifications = listNotifications(auth.username, incremental ? since : '');
    if (hasPerm(auth, 'notify')) out.team = readUsers().filter(u => u.active && u.username !== auth.username).map(u => ({ u: u.username, n: u.displayName || '' }));
  }
  // يتغير لما تنمسح البيانات التجريبية أو تسترجع نسخة: الأجهزة الثانية بتعمل تحميل كامل
  out.dataEpoch = PropertiesService.getScriptProperties().getProperty('DATA_EPOCH') || '';

  COLLECTIONS.forEach(c => {
    // ورقة لا يملك المستخدم صلاحية قراءتها: ترجع فارغة
    if (c.read && !c.read.some(p => hasPerm(auth, p))) { out[c.name] = []; return; }
    const sheet = getSheet(c.sheet, c.fields);
    if (c.name === 'ledger' && !incremental) translateTypeColumn(sheet);
    if (c.required) ensureIds(sheet, c.fields, c.required);
    out[c.name] = incremental ? readChanged(sheet, c.fields, 'id', since) : readAll(sheet, c.fields, 'id');
  });
  // الشعارات كبيرة: نرسل بصمة صغيرة فقط، والبرنامج يطلب الشعار عند تغيّرها (action: logos)
  out.traders.forEach(t => {
    t.logoSig = logoSig(t.logo);
    delete t.logo;
  });
  if (incremental) {
    const readable = {};
    COLLECTIONS.forEach(c => { readable[c.name] = !c.read || c.read.some(p => hasPerm(auth, p)); });
    out.deleted = readDeletions(since).filter(d => readable[d.c]);
  }
  return out;
}

// ================= الإشعارات =================
// رسالة من اللي معه صلاحية "إرسال إشعارات" لموظفين بيختارهم (أو "الكل")، والموظف بيرد.
// الرد: "رد على" = رقم الرسالة الأصلية، ورايح لصاحبها؛ وصاحب الرسالة بيرد على موظف معيّن من اللي وصلتهم.
// كل واحد بيشوف اللي إله واللي بعته. "قرأها" = {المستخدم: الوقت}. ورقة مخفية، آخر 500.
// الحذف: صاحب الرسالة بيحذفها عند الكل (مع ردودها إذا أصلية) = "محذوف"؛ اللي وصلته بيشيلها من عنده بس = "مخفي عند".
// الصف بيضل (مع "آخر تحديث") حتى الأجهزة الثانية تعرف بالتحديث السريع وتشيله
const NOTIFY_SHEET = '_الإشعارات';
const NOTIFY_HEADERS = ['رقم', 'الوقت', 'من', 'إلى', 'النص', 'مهم', 'رد على', 'قرأها', 'آخر تحديث', 'محذوف', 'مخفي عند'];
const NOTIFY_COL = { readBy: 8, updatedAt: 9, deleted: 10, hiddenFor: 11 };
const NOTIFY_ALL = 'الكل';
const NOTIFY_KEEP = 500;
const NOTIFY_MAX_CHARS = 1000;

function notifySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(NOTIFY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(NOTIFY_SHEET);
    sheet.getRange(1, 1, 1, NOTIFY_HEADERS.length).setValues([NOTIFY_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  // ورقة من نسخة أقدم (بدون أعمدة الحذف): نكمل العناوين
  if (sheet.getLastColumn() < NOTIFY_HEADERS.length) sheet.getRange(1, 1, 1, NOTIFY_HEADERS.length).setValues([NOTIFY_HEADERS]);
  return sheet;
}

function notifyRows() {
  const sheet = notifySheet();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const tz = Session.getScriptTimeZone();
  const fmt = (v) => (v instanceof Date ? Utilities.formatDate(v, tz, TIME_FORMAT) : String(v || ''));
  return sheet.getRange(2, 1, last - 1, NOTIFY_HEADERS.length).getValues().map((r, i) => {
    let readBy = {};
    try { readBy = JSON.parse(String(r[7] || '{}')) || {}; } catch (e) { readBy = {}; }
    let hiddenFor = [];
    try { hiddenFor = JSON.parse(String(r[10] || '[]')) || []; } catch (e) { hiddenFor = []; }
    const to = String(r[3] || '').trim();
    return {
      row: i + 2, id: String(r[0]).trim(), at: fmt(r[1]), from: String(r[2] || ''), text: String(r[4] || ''),
      to: to === NOTIFY_ALL ? NOTIFY_ALL : to.split(',').map(x => x.trim()).filter(Boolean),
      important: String(r[5]).trim() === 'نعم', replyTo: String(r[6] || '').trim(), readBy: readBy, updatedAt: fmt(r[8]),
      deleted: !!String(r[9] || '').trim(), hiddenFor: Array.isArray(hiddenFor) ? hiddenFor : []
    };
  }).filter(n => n.id);
}

const notifyVisible = (n, user) => n.from === user || n.to === NOTIFY_ALL || n.to.indexOf(user) >= 0;
const notifyPublic = (n) => ({ id: n.id, at: n.at, from: n.from, to: n.to, text: n.text, important: n.important, replyTo: n.replyTo, readBy: n.readBy });

// الكاملة: آخر 150 إلي (بدون المحذوف والمخفي عندي). السريعة: اللي انضاف أو انقرأ أو انحذف بعد since؛
// المحذوف أو المخفي عندي بيرجع {id, removed} حتى البرنامج يشيله
const notifyGone = (n, user) => n.deleted || n.hiddenFor.indexOf(user) >= 0;

function listNotifications(user, since) {
  if (!user) return [];
  const mine = notifyRows().filter(n => notifyVisible(n, user));
  if (since) return mine.filter(n => n.updatedAt >= since).map(n => (notifyGone(n, user) ? { id: n.id, removed: true } : notifyPublic(n)));
  return mine.filter(n => !notifyGone(n, user)).slice(-150).map(notifyPublic);
}

function setNotifyCell(sheet, row, key, value) {
  const cell = sheet.getRange(row, NOTIFY_COL[key]);
  cell.setNumberFormat('@');
  cell.setValue(value);
}

// صاحب الرسالة: بتنحذف عند الكل (والأصلية مع ردودها). غيره: بتنشال من عنده بس (والأصلية مع ردودها اللي بيشوفها)
function deleteNotify(auth, id) {
  if (!auth.authEnabled) return { ok: false, error: 'no_users' };
  const user = auth.username;
  const rows = notifyRows();
  const n = rows.filter(x => x.id === String(id || '') && !notifyGone(x, user))[0];
  if (!n || !notifyVisible(n, user)) return { ok: false, error: 'not_found' };
  const sheet = notifySheet();
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), TIME_FORMAT);
  const family = rows.filter(x => !x.deleted && (x.id === n.id || (!n.replyTo && x.replyTo === n.id)));
  if (n.from === user) {
    family.forEach(x => {
      setNotifyCell(sheet, x.row, 'deleted', now + ' · ' + user);
      setNotifyCell(sheet, x.row, 'updatedAt', now);
    });
    return { ok: true, scope: 'all', count: family.length };
  }
  const mine = family.filter(x => notifyVisible(x, user) && x.hiddenFor.indexOf(user) < 0);
  mine.forEach(x => {
    setNotifyCell(sheet, x.row, 'hiddenFor', JSON.stringify(x.hiddenFor.concat([user])));
    setNotifyCell(sheet, x.row, 'updatedAt', now);
  });
  return { ok: true, scope: 'me', count: mine.length };
}

function appendNotify(obj) {
  const sheet = notifySheet();
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), TIME_FORMAT);
  const id = String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  const n = sheet.getLastRow() + 1;
  const range = sheet.getRange(n, 1, 1, NOTIFY_HEADERS.length);
  range.setNumberFormat('@');
  range.setValues([[id, now, obj.from, obj.to === NOTIFY_ALL ? NOTIFY_ALL : obj.to.join(','), obj.text, obj.important ? 'نعم' : '', obj.replyTo || '', '{}', now, '', '[]']]);
  if (n > NOTIFY_KEEP + 100) sheet.deleteRows(2, n - NOTIFY_KEEP - 1);
  return notifyPublic({ id: id, at: now, from: obj.from, to: obj.to, text: obj.text, important: !!obj.important, replyTo: obj.replyTo || '', readBy: {} });
}

const notifyText = (v) => String(v || '').trim().slice(0, NOTIFY_MAX_CHARS);

function sendNotify(auth, data) {
  if (!auth.authEnabled) return { ok: false, error: 'no_users' };
  const text = notifyText(data.text);
  if (!text) return { ok: false, error: 'empty' };
  let to = NOTIFY_ALL;
  if (data.to !== NOTIFY_ALL) {
    const team = readUsers().filter(u => u.active && u.username !== auth.username).map(u => u.username);
    to = (Array.isArray(data.to) ? data.to : []).map(String).filter((u, i, all) => team.indexOf(u) >= 0 && all.indexOf(u) === i);
    if (!to.length) return { ok: false, error: 'no_recipients' };
  }
  return { ok: true, item: appendNotify({ from: auth.username, to: to, text: text, important: !!data.important }) };
}

function replyNotify(auth, data) {
  if (!auth.authEnabled) return { ok: false, error: 'no_users' };
  const text = notifyText(data.text);
  if (!text) return { ok: false, error: 'empty' };
  const root = notifyRows().filter(n => n.id === String(data.replyTo || '') && !n.replyTo && !notifyGone(n, auth.username))[0];
  if (!root || !notifyVisible(root, auth.username)) return { ok: false, error: 'not_found' };
  let to = [root.from];
  if (root.from === auth.username) {
    // صاحب الرسالة بيرد على واحد من اللي وصلتهم
    const target = String(data.to || '');
    const recipients = root.to === NOTIFY_ALL ? readUsers().filter(u => u.active).map(u => u.username) : root.to;
    if (!target || target === auth.username || recipients.indexOf(target) < 0) return { ok: false, error: 'bad_target' };
    to = [target];
  }
  return { ok: true, item: appendNotify({ from: auth.username, to: to, text: text, replyTo: root.id }) };
}

// قرأها: بيتسجل وقتها، و"آخر تحديث" بيتغير حتى يشوفها اللي بعت بالتحديث السريع
function readNotify(auth, ids) {
  const want = (Array.isArray(ids) ? ids : []).map(String);
  if (!auth.authEnabled || !want.length) return { ok: true, count: 0 };
  const sheet = notifySheet();
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), TIME_FORMAT);
  let count = 0;
  notifyRows().forEach(n => {
    if (want.indexOf(n.id) < 0 || n.deleted || n.from === auth.username || !notifyVisible(n, auth.username) || n.readBy[auth.username]) return;
    n.readBy[auth.username] = now;
    setNotifyCell(sheet, n.row, 'readBy', JSON.stringify(n.readBy));
    setNotifyCell(sheet, n.row, 'updatedAt', now);
    count++;
  });
  return { ok: true, count: count, at: now };
}

// بصمة الشعار: طوله + آخر حروفه (تتغير عند تغيّر الصورة)
function logoSig(logo) {
  const v = String(logo || '');
  return v ? v.length + ':' + v.slice(-16) : '';
}

function readLogos(ids) {
  const wanted = (Array.isArray(ids) ? ids : []).map(String);
  const logos = {};
  if (!wanted.length) return logos;
  readAll(getSheet(TRADER_SHEET, TRADER_FIELDS), TRADER_FIELDS, 'id').forEach(t => {
    if (wanted.indexOf(String(t.id)) >= 0) logos[t.id] = String(t.logo || '');
  });
  return logos;
}

// يقرأ عمود "آخر تحديث" فقط، ثم الصفوف التي تغيّرت بعد since
function readChanged(sheet, fields, key, since) {
  const keys = columnKeys(sheet, fields);
  const last = sheet.getLastRow();
  const updCol = keys.indexOf('updatedAt') + 1;
  if (last < 2 || updCol < 1) return [];
  const tz = Session.getScriptTimeZone();
  const stamps = sheet.getRange(2, updCol, last - 1, 1).getValues();
  const rows = [];
  stamps.forEach((r, i) => {
    const v = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, TIME_FORMAT) : String(r[0]).trim();
    if (v && v >= since) rows.push(i + 2);
  });
  if (!rows.length) return [];

  const keyIdx = keys.indexOf(key);
  const toObj = (r) => {
    const obj = {};
    keys.forEach((k, i) => { if (k) obj[k] = fromSheetValue(k, r[i], tz); });
    return obj;
  };
  // صفوف قليلة: نقرأها واحداً واحداً، وإلا نقرأ الورقة مرة واحدة
  const values = rows.length <= 25
    ? rows.map(n => sheet.getRange(n, 1, 1, keys.length).getValues()[0])
    : (() => { const all = sheet.getRange(2, 1, last - 1, keys.length).getValues(); return rows.map(n => all[n - 2]); })();
  return values.filter(r => keyIdx < 0 || String(r[keyIdx]).trim() !== '').map(toObj);
}

// الأعمدة: القائمة، الرقم، وقت الحذف، بواسطة، ملخص، البيانات (نسخة السطر)، رقم السجل، استُرجع
const DELETED_HEADERS = ['القائمة', 'الرقم', 'وقت الحذف', 'بواسطة', 'ملخص', 'البيانات', 'رقم السجل', 'استُرجع'];
const COLLECTION_LABELS = { ledger: 'حوالة', customers: 'زبون', expenses: 'مصروف', traders: 'تاجر', traderMoves: 'حركة تاجر', countries: 'دولة', accounts: 'حساب', accountMoves: 'حركة حساب', usdtMoves: 'حركة USDT', egpWallets: 'محفظة جنيه', egpMoves: 'حركة جنيه', settings: 'إعداد', closings: 'جرد', backup: 'استرجاع نسخة' };

function deletedSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(DELETED_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DELETED_SHEET);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  // الورقة القديمة كانت 3 أعمدة: نكمل العناوين
  if (sheet.getLastColumn() < DELETED_HEADERS.length) sheet.getRange(1, 1, 1, DELETED_HEADERS.length).setValues([DELETED_HEADERS]);
  return sheet;
}

// وصف قصير يُفهم بدون فتح البيانات
function deletionSummary(collection, snap) {
  if (!snap) return '';
  const name = snap.recipient || snap.name || snap.customerName || snap.traderName || snap.accountName || snap.category || snap.holder || '';
  const amount = collection === 'egpMoves' ? (snap.egp ? snap.egp + ' جنيه' : '') : snap.clientIls || snap.amount || snap.total || '';
  return [COLLECTION_LABELS[collection] || collection, name, amount].filter(x => String(x).trim() !== '').join(' · ');
}

function logDeletion(collection, id, snapshot) {
  const sheet = deletedSheet();
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), TIME_FORMAT);
  const row = sheet.getLastRow() + 1;
  const range = sheet.getRange(row, 1, 1, DELETED_HEADERS.length);
  range.setNumberFormat('@');
  range.setValues([[collection, String(id), now, CURRENT_USER || '', deletionSummary(collection, snapshot),
    snapshot ? JSON.stringify(snapshot).slice(0, 45000) : '', Utilities.getUuid().slice(0, 8), '']]);
  // نحتفظ بآخر 1000 عملية حذف فقط
  if (row > 1200) sheet.deleteRows(2, row - 1001);
}

function deletionRows() {
  const sheet = deletedSheet();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const tz = Session.getScriptTimeZone();
  const fmt = (v) => (v instanceof Date ? Utilities.formatDate(v, tz, TIME_FORMAT) : String(v));
  return sheet.getRange(2, 1, last - 1, DELETED_HEADERS.length).getValues().map((r, i) => ({
    row: i + 2, c: String(r[0]), id: String(r[1]), at: fmt(r[2]), by: String(r[3] || ''), summary: String(r[4] || ''),
    data: String(r[5] || ''), logId: String(r[6] || ''), restored: fmt(r[7] || '')
  }));
}

// للتحديث السريع: ما حُذف بعد since (والمسترجَع لا يُعتبر محذوفاً)
function readDeletions(since) {
  return deletionRows().filter(d => d.at >= since && !d.restored).map(d => ({ c: d.c, id: d.id }));
}

function listDeletions(limit) {
  return deletionRows().reverse().slice(0, limit).map(d => ({
    logId: d.logId, c: d.c, label: COLLECTION_LABELS[d.c] || d.c, id: d.id, at: d.at, by: d.by,
    summary: d.summary, restored: d.restored, canRestore: !!d.data && !!d.logId && !d.restored
  }));
}

// يرجّع السطر المحذوف كما كان (نفس الرقم)
function restoreDeletion(logId) {
  const d = deletionRows().filter(x => x.logId && x.logId === String(logId || ''))[0];
  if (!d || !d.data) return { ok: false, error: 'not_found' };
  if (d.restored) return { ok: false, error: 'already_restored' };
  const c = COLLECTIONS.filter(x => x.name === d.c)[0];
  if (!c) return { ok: false, error: 'not_found' };
  let snapshot;
  try { snapshot = JSON.parse(d.data); } catch (e) { return { ok: false, error: 'bad_data' }; }
  RESTORING = true;
  try {
    upsertRow(getSheet(c.sheet, c.fields), c.fields, 'id', snapshot, c.name);
  } finally {
    RESTORING = false;
  }
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), TIME_FORMAT);
  stampCell(deletedSheet().getRange(d.row, 8), now + (CURRENT_USER ? ' · ' + CURRENT_USER : ''));
  return { ok: true, c: d.c, id: d.id };
}

// ================= النسخ الاحتياطي اليومي =================
// شغّل "فعّل_النسخ_الاحتياطي" مرة واحدة من المحرر: ينشئ مجلداً في Google Drive وينسخ الشيت كل يوم الساعة 12 بالليل،
// ويحتفظ بآخر 30 يوماً (الأقدم يذهب لسلة المهملات).
const BACKUP_FOLDER = 'فاست باي - نسخ احتياطية';
const BACKUP_KEEP_DAYS = 30;

function فعّل_النسخ_الاحتياطي() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyBackup')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(0).create();
  dailyBackup(); // نسخة أولى الآن للتأكد أن كل شيء يعمل
}

// النسخة ملف جديد فيه الأوراق فقط: نسخ ملف الشيت كاملاً ينسخ السكربت المربوط معه،
// فيظهر مشروع جديد في Apps Script مع كل نسخة.
// label: بيتزاد على الاسم ("قبل المسح"، "قبل الاسترجاع"). الـ trigger بيبعت كائن، فبنتجاهله. بترجع اسم الملف
function dailyBackup(label) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();
  const folder = backupFolder() || DriveApp.createFolder(BACKUP_FOLDER);
  const note = typeof label === 'string' && label ? ' - ' + label : '';
  const name = ss.getName() + ' - نسخة ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH-mm') + note;
  const copy = SpreadsheetApp.create(name);
  copy.setSpreadsheetTimeZone(ss.getSpreadsheetTimeZone());
  const blank = copy.getSheets()[0];
  blank.setName('_' + Date.now()); // حتى لا يتعارض اسمها مع ورقة منسوخة
  ss.getSheets().forEach(sheet => {
    const c = sheet.copyTo(copy);
    c.setName(sheet.getName());
    if (sheet.isSheetHidden()) c.hideSheet();
  });
  copy.deleteSheet(blank);
  DriveApp.getFileById(copy.getId()).moveTo(folder);
  const limit = Date.now() - BACKUP_KEEP_DAYS * 86400000;
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.getDateCreated().getTime() < limit) f.setTrashed(true);
  }
  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP', Utilities.formatDate(new Date(), tz, TIME_FORMAT));
  return name;
}

function stampCell(cell, value) {
  cell.setNumberFormat('@');
  cell.setValue(value);
}

// ================= تعديلاتك اليدوية في الشيت =================
// يعمل تلقائياً عند تعديل أي خلية بيدك: يحدّث "آخر تحديث" للصف حتى يظهر التعديل في البرنامج
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() === USERS_SHEET) return hashEditedPasswords(sheet, e.range);
  const c = COLLECTIONS.filter(x => x.sheet === sheet.getName())[0];
  if (!c) return;
  const first = Math.max(e.range.getRow(), 2);
  const lastRow = e.range.getRow() + e.range.getNumRows() - 1;
  if (lastRow < first) return;
  const updCol = columnKeys(sheet, c.fields).indexOf('updatedAt') + 1;
  if (updCol < 1) return;
  // لا نعيد الختم إن كان التعديل على عمود "آخر تحديث" نفسه
  if (e.range.getColumn() === updCol && e.range.getNumColumns() === 1) return;
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), TIME_FORMAT);
  const range = sheet.getRange(first, updCol, lastRow - first + 1, 1);
  range.setNumberFormat('@');
  range.setValues(Array(lastRow - first + 1).fill([now]));
}

// كلمة سر كُتبت بيدك في ورقة المستخدمين: تُشفَّر فوراً حتى لا تبقى مقروءة
function hashEditedPasswords(sheet, range) {
  const col = columnKeys(sheet, USER_FIELDS).indexOf('password') + 1;
  if (col < 1 || col < range.getColumn() || col > range.getColumn() + range.getNumColumns() - 1) return;
  const first = Math.max(range.getRow(), 2);
  const last = range.getRow() + range.getNumRows() - 1;
  for (let r = first; r <= last; r++) {
    const cell = sheet.getRange(r, col);
    const v = String(cell.getDisplayValue()).trim();
    if (v && !isHashed(v)) {
      cell.setNumberFormat('@');
      cell.setValue(hashPassword(v));
    }
  }
}

function readAll(sheet, fields, key) {
  const keys = columnKeys(sheet, fields);
  const last = sheet.getLastRow();
  if (last < 2 || !keys.length) return [];
  const tz = Session.getScriptTimeZone();
  const keyIdx = keys.indexOf(key);

  return sheet.getRange(2, 1, last - 1, keys.length).getValues()
    .filter(r => keyIdx < 0 || String(r[keyIdx]).trim() !== '')
    .map(r => {
      const obj = {};
      keys.forEach((k, i) => {
        if (k) obj[k] = fromSheetValue(k, r[i], tz);
      });
      return obj;
    });
}
