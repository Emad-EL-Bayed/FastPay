'use strict';

// فاست باي — ربط الأحداث وبدء التشغيل (يُحمَّل أخيراً)
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

// ================= ربط الأحداث =================
const CLICK_ACTIONS = {
    'switch-tab': (el) => switchTab(el.dataset.tab),
    'refresh-rate': () => fetchLiveDollarRate({ manual: true }),
    'pin-rate': pinScreenRateManual,
    'export-csv': exportToCSV,
    'save-tx': saveNewTransaction,
    'clear-tx-filters': clearTxFilters,
    'toggle-status': (el) => toggleStatusFilter(el.dataset.status),
    'ledger-more': () => { ledgerLimit += LEDGER_PAGE; renderLedgerTable(); },
    'retry-sync': retryFailedSync,
    'select-customer': (el) => selectCustomerFromSearch(el.dataset.id),
    'edit-tx': (el) => openEditTxModal(toNum(el.dataset.id, NaN)),
    'delete-tx': (el) => { closeModal('txDetailsModal'); deleteTxPrompt(toNum(el.dataset.id, NaN)); },
    'tx-details': (el) => openTxDetails(toNum(el.dataset.id, NaN)),
    'open-notify': openNotifyPanel,
    'notify-compose': openNotifyCompose,
    'notify-send': sendNotifyCompose,
    'notify-reply': openNotifyReply,
    'notify-reply-send': sendNotifyReply,
    'notify-reply-cancel': () => { notifyReplyOpen = null; renderNotifyList(); },
    'notify-ack': ackImportant,
    'notify-delete': (el) => deleteNotification(el.dataset.id),
    'notify-alert-reply': replyFromAlert,
    'notify-sound': toggleNotifySound,
    'notify-permission': requestNotifyPermission,
    'txd-edit': (el) => { closeModal('txDetailsModal'); openEditTxModal(toNum(el.dataset.id, NaN)); },
    'txd-customer': () => {
        const t = ledger.find(x => x.id === txDetailsId);
        closeModal('txDetailsModal');
        if (t) openCustomerProfile(t.customerId, t.recipient);
    },
    'tx-copy': onTxCopy,
    'txd-copy': copyTxField,
    'copy-pick': (el) => pickCopyItem(toNum(el.dataset.i, -1)),
    'open-customer-modal': () => openCustomerModal(),
    'edit-customer': (el) => openCustomerModal(customers.find(c => c.id === el.dataset.id)),
    'delete-customer': (el) => deleteCustomerPrompt(el.dataset.id),
    'open-whatsapp': (el) => openWhatsapp(el.dataset.id),
    'open-trader-modal': () => openTraderModal(),
    'open-trader': (el) => openTraderPanel(el.dataset.id),
    'pick-trader-logo': () => $('tr_logo_input').click(),
    'remove-trader-logo': () => setTraderLogo(''),
    'edit-trader': (el) => openTraderModal(traders.find(t => t.id === el.dataset.id)),
    'delete-trader': (el) => deleteTraderPrompt(el.dataset.id),
    'new-tmove': (el) => openTmoveModal({ traderId: el.dataset.id, currency: el.dataset.cur, kind: el.dataset.kind || 'for_us' }),
    'edit-tmove': (el) => openTmoveModal({ move: traderMoves.find(m => m.id === toNum(el.dataset.id, NaN)) }),
    'delete-tmove': (el) => deleteTmovePrompt(toNum(el.dataset.id, NaN)),
    'settle-trader': (el) => settleTrader(el.dataset.id, el.dataset.cur),
    'tmove-kind': (el) => setTmoveKind(el.dataset.kind),
    'service-new': (el) => openServiceModal(el.dataset.id),
    'service-edit': (el) => openServiceModal(null, traderServices.find(x => x.id === el.dataset.id)),
    'service-tier-add': addServiceTier,
    'service-tier-remove': (el) => removeServiceTier(toNum(el.dataset.index, -1)),
    'service-parse': parseServicePaste,
    'delete-service': deleteServicePrompt,
    'service-logo-auto': () => setServiceLogoMode('auto'),
    'service-logo-none': () => setServiceLogoMode('none'),
    'service-logo-brand': (el) => toggleServiceBrand(el.dataset.key),
    'service-logo-upload': () => $('sv_logo_input').click(),
    'tmove-service': (el) => pickTmoveService(el.dataset.id),
    'trader-currency': (el) => { panelCurrency = el.dataset.cur; renderTraderPanel(); },
    'trader-period': (el) => { panelPeriod = el.dataset.period; renderTraderPanel(); },
    'trader-tab': (el) => { panelTab = el.dataset.tab; renderTraderPanel(); },
    'trader-back': closeTraderView,
    'trader-filter': (el) => { traderFilter = el.dataset.filter; renderTraders(); },
    'statement-png': () => exportStatement('png'),
    'statement-pdf': () => exportStatement('pdf'),
    'open-wa-trader': (el) => {
        const t = traders.find(x => x.id === el.dataset.id);
        if (t && hasWhatsapp(t)) window.open(`https://wa.me/${whatsappDigits(t.phone)}`, '_blank', 'noopener');
    },
    'open-country-modal': openCountryModal,
    'delete-country': (el) => deleteCountryPrompt(toNum(el.dataset.index, -1)),
    'save-settings': saveAllSettings,
    'reload-sheets': () => loadFromSheets({ manual: true }),
    'sync-now': () => liveCycle({ manual: true }),
    'open-customer': (el) => openCustomerProfile(el.dataset.id, el.dataset.name),
    'cust-new-tx': customerNewTransaction,
    'cust-show-ledger': customerShowLedger,
    'cust-goto-usdt': (el) => customerGotoUsdt(el.dataset.id),
    'select-source': (el) => selectSource(el.dataset.name, el.dataset.other === '1'),
    'open-receipt': (el) => openReceipt(toNum(el.dataset.id, NaN)),
    'open-last-receipt': () => lastSavedTxId && openReceipt(lastSavedTxId),
    'receipt-png': () => exportReceipt('png'),
    'toggle-receipt-rate': toggleReceiptRate,
    // الدخول والمستخدمين
    'user-menu': toggleUserMenu,
    'logout': logout,
    'change-password': openPasswordModal,
    'open-profile': openProfileModal,
    // البحث الشامل، أدوات المدير، والمركز المالي
    'open-search': openSearch,
    'search-pick': (el) => pickSearchResult(toNum(el.dataset.i, -1)),
    'open-edits': (el) => openEditsModal(el.dataset.id || ''),
    'edits-goto': (el) => { closeModal('editsModal'); gotoRef(el.dataset.type, el.dataset.id); },
    'open-reset': openResetModal,
    'reset-go': runReset,
    'open-restore': openRestoreModal,
    'restore-go': runRestore,
    'lock-save': () => saveLockDate(false),
    'lock-clear': () => saveLockDate(true),
    'debt-remind': (el) => remindDebt(el.dataset.key),
    // المظهر والحركات
    'toggle-theme': (el) => toggleTheme(el),
    'set-theme': (el) => setTheme(el.dataset.themeOpt, el),
    'toggle-motion': toggleMotion,
    'profile-remove-photo': removeProfilePhoto,
    'um-remove-photo': removeUserPhoto,
    'open-user-modal': () => openUserModal(),
    'edit-user': (el) => openUserModal(usersList.find(u => u.username === el.dataset.name)),
    'delete-user': (el) => deleteUserPrompt(el.dataset.name),
    'toggle-all-perms': toggleAllPerms,
    'goto-ref': (el) => gotoRef(el.dataset.type, el.dataset.id),
    'share-receipt': shareReceipt,
    'share-statement': shareStatement,
    'wa-open': waOpenChat,
    'wa-copy': waCopyAgain,
    'wa-download': waDownload,
    'wa-share-native': waShareNative,
    'wa-copy-msg': waCopyMessage,
    'open-closing': openClosingModal,
    'load-deleted': loadDeletedList,
    'restore-deleted': (el) => restoreDeletedPrompt(el.dataset.id),
    'mnav-more': toggleMobileMore,
    'edit-amove': (el) => openAmoveModal('manual', accountMoves.find(m => m.id === toNum(el.dataset.id, NaN))),
    // الحسابات
    'open-account-modal': () => openAccountModal(),
    'edit-account': (el) => openAccountModal(accounts.find(a => a.id === el.dataset.id)),
    'delete-account': deleteAccountPrompt,
    'filter-account': (el) => { accountFilterId = accountFilterId === el.dataset.id ? '' : el.dataset.id; renderAccountsPage(); },
    'clear-account-filter': () => { accountFilterId = ''; renderAccountsPage(); },
    'open-amove': () => openAmoveModal('manual'),
    'open-transfer': () => openAmoveModal('transfer'),
    'delete-amove': (el) => deleteAmovePrompt(toNum(el.dataset.id, NaN)),
    // الدفع
    'pay-fill': (el) => payFill(el.dataset.id),
    'pay-save': savePayModal,
    'pay-skip': skipPayModal,
    'pay-cancel': cancelPayModal,
    'tx-pay': (el) => { const tx = ledger.find(x => x.id === toNum(el.dataset.id, NaN)); if (tx && walletsReady()) openTxPayModal(tx, 'مكتمل', { afterCreate: true }); },
    // USDT
    'usdt-new': (el) => openUsdtModal(el.dataset.kind),
    'usdt-kind': (el) => { if (!editingUsdtId) setUsdtKind(el.dataset.kind); updateUsdtPreview(); },
    'usdt-currency': (el) => setUsdtCurrency(el.dataset.cur),
    'usdt-select-customer': (el) => selectUsdtCustomer(el.dataset.id),
    'usdt-pay': (el) => openUsdtPay(toNum(el.dataset.id, NaN)),
    'final-adjust': (el) => bumpFinalAdjust(el.dataset.target, toNum(el.dataset.step, 0)),
    'tx-final-adjust': (el) => bumpTxFinalAdjust(toNum(el.dataset.step, 0)),
    'usdt-receipt': (el) => openUsdtReceipt(toNum(el.dataset.id, NaN)),
    'edit-usdt': (el) => openUsdtModal('deposit', usdtMoves.find(m => m.id === toNum(el.dataset.id, NaN))),
    'delete-usdt': (el) => deleteUsdtPrompt(toNum(el.dataset.id, NaN)),
    'usdt-net-add': addUsdtNetwork,
    'usdt-net-remove': (el) => removeUsdtNetwork(toNum(el.dataset.index, -1)),
    'settings-card': (el) => openSettingsCard(el.dataset.target),
    'usdt-tier-add': (el) => addUsdtTier(el.dataset.kind === 'deposit' ? 'deposit' : 'withdraw'),
    'usdt-tier-remove': (el) => removeUsdtTier(el.dataset.kind === 'deposit' ? 'deposit' : 'withdraw', toNum(el.dataset.index, -1)),
    'egp-tier-add': (el) => addEgpTier(el.dataset.kind),
    'egp-tier-remove': (el) => removeEgpTier(el.dataset.kind, toNum(el.dataset.index, -1)),
    // الجنيه المصري
    'egp-new': (el) => openEgpModal(el.dataset.kind),
    'egp-kind': (el) => { if (!editingEgpId) setEgpKind(el.dataset.kind); updateEgpPreview(); },
    'egp-currency': (el) => setEgpCurrency(el.dataset.cur),
    'egp-select-customer': (el) => selectEgpCustomer(el.dataset.id),
    'egp-pay': (el) => openEgpPay(toNum(el.dataset.id, NaN)),
    'egp-rates-open': openEgpRatesModal,
    'egp-party-toggle': () => setEgpPartyOpen(true),
    'egp-receipt': (el) => openEgpReceipt(toNum(el.dataset.id, NaN)),
    'edit-egp': (el) => openEgpModal('send', egpMoves.find(m => m.id === toNum(el.dataset.id, NaN))),
    'delete-egp': (el) => deleteEgpPrompt(toNum(el.dataset.id, NaN)),
    'egp-transfer': openEgpTransfer,
    'egp-wallet-new': () => openEgpWalletModal(),
    'edit-egp-wallet': (el) => openEgpWalletModal(egpWallets.find(w => w.id === el.dataset.id)),
    'delete-egp-wallet': deleteEgpWalletPrompt,
    'egp-wallet-defaults': createDefaultEgpWallets,
    'filter-egp-wallet': (el) => toggleEgpWalletFilter(el.dataset.id),
    'clear-egp-wallet-filter': () => toggleEgpWalletFilter(''),
    'egp-rate-refresh': () => fetchEgpRate({ manual: true }),
    'egp-rate-pin': pinEgpRate,
    'egpq-dir': (el) => setEgpQuick({ dir: el.dataset.dir }),
    'egpq-unit': (el) => setEgpQuick({ unit: el.dataset.unit }),
    'egpq-record': recordEgpQuote,
    'cust-goto-egp': (el) => customerGotoEgp(el.dataset.id),
    'receipt-pdf': () => exportReceipt('pdf'),
    'set-payout': (el) => setPayout(el.dataset.payout),
    'set-provider': (el) => setProvider(el.dataset.provider),
    'set-currency': (el) => setCurrency(el.dataset.currency),
    'set-cost-mode': (el) => setCostMode(el.dataset.mode),
    'edit-country': (el) => openCountryModal(toNum(el.dataset.index, -1)),
    'pick-category': (el) => { $('exp_category').value = el.dataset.category; $('exp_amount').focus(); },
    'edit-expense': (el) => editExpense(toNum(el.dataset.id, NaN)),
    'delete-expense': (el) => deleteExpensePrompt(toNum(el.dataset.id, NaN)),
    'cancel-expense-edit': resetExpenseForm,
    'clear-expense-filters': () => { $('exp_month_filter').value = ''; $('exp_category_filter').value = 'ALL'; renderExpenses(); },
    'export-expenses-csv': exportExpensesCSV,
    'ana-month-step': (el) => setAnalysisMonth(shiftMonth(analysisMonth, toNum(el.dataset.step, 0))),
    'ana-range': (el) => { analysisRange = toNum(el.dataset.range, 6); renderMonthlyAnalysis(); },
    'ana-pick-month': (el) => setAnalysisMonth(el.dataset.month),
    'close-modal': (el) => closeModal(el.dataset.modal),
    'confirm-no': closeAppConfirm,
    'confirm-yes': () => {
        const cb = confirmCallback;
        closeAppConfirm();
        if (cb) cb();
    }
};

function bindEvents() {
    bindGlobalEvents();
    bindIbanEvents();
    bindNotifyEvents();
    bindThemeEvents();
    bindAdminEvents();
    bindSearchEvents();
    bindCalculatorEvents();
    bindLedgerEvents();
    bindCustomerEvents();
    bindTraderEvents();
    bindAccountEvents();
    bindUsdtEvents();
    bindEgpEvents();
    bindUserEvents();
    bindSettingsEvents();
    bindExpenseEvents();
    bindReportEvents();
}

// على مستوى الصفحة: الأزرار (data-action)، إغلاق القوائم والنوافذ، Escape، عجلة الماوس
function bindGlobalEvents() {
    document.addEventListener('beforeinput', onArabicDigitsInput, true);
    document.addEventListener('beforeinput', onCommasDelete, true);
    // قبل مستمعات الخانة نفسها، فبتقرا القيمة مرتبة
    document.addEventListener('input', onCommasInput, true);
    // عجلة الماوس فوق حقل رقم مفعّل كانت تغيّر المبلغ بدل تحريك الصفحة: نلغي تفعيل الحقل فتتحرك الصفحة
    document.addEventListener('wheel', (e) => {
        const el = e.target;
        if (el instanceof HTMLInputElement && el.type === 'number' && document.activeElement === el) el.blur();
    }, { passive: true });
    document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-action]');
        if (el && el.tagName !== 'SELECT' && CLICK_ACTIONS[el.dataset.action]) {
            CLICK_ACTIONS[el.dataset.action](el);
        }

        if (!e.target.closest('#user-menu') && !e.target.closest('#user-chip')) closeUserMenu();
        if (!e.target.closest('#copy-menu') && !e.target.closest('[data-action="tx-copy"]')) closeCopyMenu();
        if (!e.target.closest('#mnav-more-menu') && !e.target.closest('#mnav-more')) $('mnav-more-menu').classList.add('hidden');

        if (!e.target.closest('#us-customer-dropdown') && e.target !== $('us_customer')) closeUsdtCustomerPicker();
        if (!e.target.closest('#eg-customer-dropdown') && e.target !== $('eg_customer')) closeEgpCustomerPicker();

        // إغلاق قائمة اقتراحات الزبائن عند الضغط خارجها
        const dropdown = $('customer-search-dropdown');
        if (!dropdown.contains(e.target) && e.target !== $('calc_recipient')) {
            dropdown.classList.add('hidden');
        }

        // النوافذ ما بتسكر بالضغط برّاها (بس زر الإغلاق أو Esc)، حتى ما يضيع اللي انكتب فيها
    });
    document.addEventListener('change', (e) => {
        const el = e.target;
        if (el.dataset.action === 'change-status') changeOrderStatus(toNum(el.dataset.id, NaN), el.value);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // الإشعار المهم ما بيسكّر إلا بـ "قرأت"
        if (!$('notifyAlertModal').classList.contains('hidden')) return;
        closeAppConfirm();
        // قائمة النسخ مفتوحة: Esc بيسكّرها هي بس
        if (!$('copy-menu').classList.contains('hidden')) return closeCopyMenu();
        // نغلق النافذة العليا فقط (مثلاً الفاتورة فوق ملف الزبون، أو الحركة فوق حساب التاجر)
        const top = ['searchModal', 'notifyComposeModal', 'notifyModal', 'resetModal', 'restoreModal', 'editsModal', 'waShareModal', 'closingModal', 'passwordModal', 'userModal', 'payModal', 'receiptModal', 'usdtModal', 'egpModal', 'egpWalletModal', 'egpRatesModal', 'accountModal', 'amoveModal', 'tmoveModal', 'serviceModal', 'traderModal', 'custModal', 'editTxModal', 'txDetailsModal', 'countryModal', 'customerModal']
            .find(id => !$(id).classList.contains('hidden'));
        if (top) closeModal(top);
        // حساب التاجر (صفحة مش نافذة): Esc برّا الخانات بيرجع لقائمة التجار
        else if (traderViewOpen() && !e.target.closest?.('input, textarea, select')) closeTraderView();
        $('customer-search-dropdown').classList.add('hidden');
    });
}

// الحاسبة
function bindCalculatorEvents() {
    $('calc_recipient').addEventListener('input', onCustomerSearchInput);
    $('calc_recipient').addEventListener('focus', onCustomerSearchInput);
    $('calc_recipient').addEventListener('click', onCustomerSearchInput);
    $('calc_recipient').addEventListener('keydown', onCustomerPickerKey);
    $('source-search').addEventListener('input', renderSourceGrid);
    $('calc_other_name').addEventListener('input', updateSourceBadge);
    ['calc_orig_amount', 'calc_factor', 'calc_cost_pct', 'calc_profit_pct'].forEach(id => $(id).addEventListener('input', runLiveCalc));
    $('calc_screen_rate').addEventListener('input', () => {
        calcRateTouched = true;
        runLiveCalc();
    });
}

// سجل الحوالات وتعديل الحوالة
function bindLedgerEvents() {
    $('edit_tx_payout').addEventListener('change', () => {
        fillProviderSelect($('edit_tx_provider'), $('edit_tx_payout').value);
        syncEditTxPayoutFields();
    });
    $('edit_tx_currency').addEventListener('change', recalcEditModal);
    $('edit_tx_cost_mode').addEventListener('change', recalcEditModal);
    $('tx_search').addEventListener('input', resetLedgerAndRender);
    ['tx_date_filter', 'tx_month_filter'].forEach(id => $(id).addEventListener('change', resetLedgerAndRender));
    $('editTxForm').addEventListener('submit', saveEditedTransaction);
    // قائمة النسخ ثابتة بمكانها: بتتسكّر لما الصفحة أو الجدول يتحرك
    document.addEventListener('scroll', () => { if (!$('copy-menu').classList.contains('hidden')) closeCopyMenu(); }, { passive: true, capture: true });
    window.addEventListener('resize', closeCopyMenu);
    $('edit_tx_country').addEventListener('change', onEditCountrySelect);
    ['edit_tx_orig', 'edit_tx_factor', 'edit_tx_cost_pct', 'edit_tx_profit_pct', 'edit_tx_minus', 'edit_tx_screen', 'edit_tx_final_adjust']
        .forEach(id => $(id).addEventListener('input', recalcEditModal));
}

// الزبائن
function bindCustomerEvents() {
    $('m_cust_payout').addEventListener('change', () => {
        fillProviderSelect($('m_cust_provider'), $('m_cust_payout').value);
        syncCustPayoutFields();
    });
    $('cust_search').addEventListener('input', renderCustomersTable);
    $('cust_sort').addEventListener('change', renderCustomersTable);
    $('custForm').addEventListener('submit', saveCustomerManual);
}

// التجار
function bindTraderEvents() {
    $('tr_logo_input').addEventListener('change', (e) => {
        resizeImageFile(e.target.files[0], 128, setTraderLogo, 40000);
        e.target.value = '';
    });
    $('tr_name').addEventListener('input', () => { if (!traderFormLogo) setTraderLogo(''); });
    $('traderForm').addEventListener('submit', saveTrader);
    $('tmoveForm').addEventListener('submit', saveTmove);
    $('trader_search').addEventListener('input', renderTraders);
    $('tm_amount').addEventListener('input', updateTmovePreview);
    $('tm_buy_pct').addEventListener('input', updateTmovePreview);
    // كتابة العمولة بإيدك بتوقف تعبئتها من جدول الخدمة
    ['tm_commission', 'tm_commission_fixed'].forEach(id => $(id).addEventListener('input', () => { tmoveFeeTouched = true; updateTmovePreview(); }));
    $('tm_service').addEventListener('change', onTmoveServiceChange);
    $('tm_currency').addEventListener('change', onTmoveCurrencyChange);
    $('trader_sort').addEventListener('change', () => { traderSort = $('trader_sort').value; renderTraders(); });
    // حساب التاجر: البحث بالكشف، "جرّب مبلغ"، التواريخ، وإضافة عملة
    $('trader-profile').addEventListener('input', onTraderViewInput);
    $('trader-profile').addEventListener('change', onTraderViewChange);
    $('serviceForm').addEventListener('submit', saveService);
    $('sv_name').addEventListener('input', () => { if (!svLogo) renderServiceLogoPicker(); });
    $('sv_logo_input').addEventListener('change', (e) => {
        onServiceLogoFile(e.target.files[0]);
        e.target.value = '';
    });
    $('sv_tiers').addEventListener('input', (e) => { if (e.target.dataset?.svTier !== undefined) onServiceTierInput(e.target); });
}

// الحسابات، الدفع، والجرد
function bindAccountEvents() {
    $('accountForm').addEventListener('submit', saveAccount);
    $('closingForm').addEventListener('submit', saveClosing);
    $('closing-rows').addEventListener('input', updateClosingDiffs);
    $('amoveForm').addEventListener('submit', saveAmove);
    $('acc_type').addEventListener('change', () => { $('acc_usd').checked = ACCOUNT_TYPES[$('acc_type').value].usd; syncAccountUsdField(); });
    $('acc_usd').addEventListener('change', syncAccountUsdField);
    $('am_currency').addEventListener('change', fillAmoveAccounts);
    $('am_account').addEventListener('change', fillAmoveAccounts);
    $('pay-accounts').addEventListener('input', updatePaySummary);
    $('pay_settle').addEventListener('change', updatePaySummary);
}

// USDT
function bindUsdtEvents() {
    $('usdtForm').addEventListener('submit', saveUsdt);
    ['us_fee', 'us_rate', 'us_final_adjust', 'us_adjust_dir', 'us_money'].forEach(id => $(id).addEventListener('input', updateUsdtPreview));
    // كتابة كمية الـ USDT بيدك تلغي المبلغ المتفق عليه
    $('us_amount').addEventListener('input', () => { $('us_money').value = ''; updateUsdtPreview(); });
    $('us_adjust_dir').addEventListener('change', updateUsdtPreview);
    $('us_pct').addEventListener('input', () => { usdtPctTouched = true; updateUsdtPreview(); });
    $('us_network').addEventListener('change', () => { $('us_fee').value = toNum($('us_network').selectedOptions[0]?.dataset.fee, 0); updateUsdtPreview(); });
    ['input', 'focus', 'click'].forEach(ev => $('us_customer').addEventListener(ev, onUsdtCustomerInput));
    $('us_customer').addEventListener('keydown', onUsdtCustomerKey);
    $('usdt_search').addEventListener('input', (e) => { usdtSearch = e.target.value; renderUsdtPage(); });
    ['usdt_kind_filter', 'usdt_month_filter'].forEach(id => $(id).addEventListener('change', renderUsdtPage));
    $('usdt-settings').addEventListener('change', (e) => onUsdtSettingInput(e.target));
}

// الجنيه المصري: نموذج الحركة، المحافظ، الفلاتر، الحاسبة السريعة، وأسعار الجنيه
function bindEgpEvents() {
    $('egpForm').addEventListener('submit', saveEgp);
    $('egpWalletForm').addEventListener('submit', saveEgpWallet);
    // كتابة الجنيه بيدك تلغي المبلغ المتفق عليه
    $('eg_egp').addEventListener('input', () => { $('eg_money').value = ''; updateEgpPreview(); });
    ['eg_money', 'eg_usd_rate', 'eg_fee', 'eg_total', 'eg_final_adjust'].forEach(id => $(id).addEventListener('input', updateEgpPreview));
    $('eg_pct').addEventListener('input', () => { egpPctTouched = true; updateEgpPreview(); });
    ['eg_wallet', 'eg_to_wallet', 'eg_dir'].forEach(id => $(id).addEventListener('change', () => { syncEgpDirFields(); updateEgpPreview(); }));
    ['input', 'focus', 'click'].forEach(ev => $('eg_customer').addEventListener(ev, onEgpCustomerInput));
    $('eg_customer').addEventListener('keydown', onEgpCustomerKey);
    $('egp_search').addEventListener('input', (e) => { egpSearch = e.target.value; renderEgpLog(); });
    ['egp_kind_filter', 'egp_month_filter'].forEach(id => $(id).addEventListener('change', renderEgpLog));
    $('egpq_amount').addEventListener('input', renderEgpQuick);
    ['egp_set_send_pct', 'egp_set_receive_pct', 'egp_set_send_price', 'egp_set_receive_price'].forEach(id => $(id).addEventListener('change', (e) => onEgpPctChange(e.target)));
    $('egp_set_screen').addEventListener('keydown', (e) => { if (e.key === 'Enter') pinEgpRate(); });
    $('egp-settings').addEventListener('change', (e) => onEgpTierInput(e.target));
}

// الدخول والمستخدمين وملفي
function bindUserEvents() {
    $('loginForm').addEventListener('submit', submitLogin);
    $('passwordForm').addEventListener('submit', savePassword);
    $('userForm').addEventListener('submit', saveUser);
    $('profileForm').addEventListener('submit', saveProfile);
    $('pf_file').addEventListener('change', onProfilePhoto);
    $('pf_name').addEventListener('input', renderProfilePreview);
    $('um_file').addEventListener('change', onUserPhoto);
    $('um_display').addEventListener('input', renderUserDraftAvatar);
    $('um_username').addEventListener('input', renderUserDraftAvatar);
    $('userModal').addEventListener('change', (e) => { if (e.target.closest('.perm-check')) updateSelectAllLabel(); });
}

// الإعدادات وتسعير الدول
function bindSettingsEvents() {
    ['set_screen_rate', 'set_sell_offset', 'set_buy_offset'].forEach(id => $(id).addEventListener('input', updateSellBuyPreview));
    $('countryForm').addEventListener('submit', saveCountry);
}

// المصاريف
function bindExpenseEvents() {
    $('expenseForm').addEventListener('submit', saveExpense);
    ['exp_month_filter', 'exp_category_filter'].forEach(id => $(id).addEventListener('change', renderExpenses));
}

// التحليل الشهري: اختيار الشهر، والتلميح عند المرور على الرسم
function bindReportEvents() {
    $('ana_month').addEventListener('change', (e) => setAnalysisMonth(e.target.value));
    const chart = $('ana-chart');
    chart.addEventListener('pointermove', (e) => {
        const band = e.target.closest('.ana-band');
        if (band) showChartTooltip(toNum(band.dataset.index, -1)); else hideChartTooltip();
    });
    chart.addEventListener('pointerleave', hideChartTooltip);
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => renderMonthlyAnalysis(), 250);
    });
    chart.addEventListener('click', (e) => {
        const band = e.target.closest('.ana-band');
        const d = band && analysisChartData[toNum(band.dataset.index, -1)];
        if (d) setAnalysisMonth(d.month);
    });
}

// ================= بدء التشغيل =================
function refreshAllViews() {
    applyScreenRateToUI();
    applyBranding();
    renderSourceGrid();
    setPayout($('calc_payout_type').value, $('calc_provider').value);
    setCurrency($('calc_currency').value);
    renderRecentTx();
    renderLedgerTable();
    renderCustomersTable();
    renderCountriesTable();
    updateReportsData();
    updateSyncPendingBar();
    loadSettingsPage();
}

document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    bindEvents();
    watchResultCard();
    lastSeenDay = localDateStr();
    $('calc_date').value = localDateStr();
    $('exp_date').value = localDateStr();
    $('exp_month_filter').value = localDateStr().slice(0, 7);

    saveAll();
    applyPermsUI();
    refreshAllViews();
    moveNavIndicator();
    if (authEnabled && !session?.token) showLogin();

    // الزبائن والحوالات تُقرأ من Google Sheets عند كل فتح
    loadFromSheets();

    fetchLiveDollarRate();
    fetchEgpRate();


    // إعادة إرسال العمليات المعلقة تلقائياً كل دقيقة وعند عودة الإنترنت
    setInterval(() => { if (outbox.length) flushOutbox(); }, 60 * 1000);
    window.addEventListener('online', () => { if (outbox.length) flushOutbox(); });

    // تحديث حيّ واحد كل دقيقتين (سعر الشاشة + الشيت معاً)، وعند الرجوع للصفحة
    setInterval(liveCycle, LIVE_REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) liveCycle(); });
});
