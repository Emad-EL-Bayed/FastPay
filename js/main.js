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
    'notify-permission': onNotifyPermissionClick,
    'notify-push-off': disablePush,
    'push-save': savePushSettings,
    'push-test': testPush,
    'push-clear': clearPushSettings,
    'push-account-pick': () => $('push_account_input').click(),
    'conflict-mine': () => resolveConflict(true),
    'conflict-theirs': () => resolveConflict(false),
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
    // الحسابات الجاهزة
    'ready-new': () => openReadyModal(),
    'edit-ready': (el) => openReadyModal(readyAccounts.find(x => x.id === el.dataset.id)),
    'edit-ready-pause': (el) => toggleReadyPaused(el.dataset.id),
    'delete-ready': (el) => deleteReadyPrompt(el.dataset.id),
    'ready-copy': copyReady,
    'ready-send': (el) => openReadySend(el.dataset.id),
    'ready-send-go': () => sendReady(false),
    'ready-send-any': () => sendReady(true),
    'ready-select-customer': (el) => selectReadyCustomer(el.dataset.id),
    'ready-filter': (el) => { readyFilter = el.dataset.filter || 'all'; renderReadyPage(); },
    'edit-ready-renew': (el) => renewReady(el.dataset.id),
    'ready-token': (el) => insertReadyToken(el.dataset.token),
    'ready-expire': (el) => setReadyExpiry(toNum(el.dataset.hours, 0)),
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
    // كشف حساب الزبون
    'cst-open': (el) => openCustomerStatement(el.dataset.id, el.dataset.name),
    'cst-period': (el) => setCustomerStatementPeriod(el.dataset.period),
    'cst-png': () => exportCustomerStatement('png'),
    'cst-pdf': () => exportCustomerStatement('pdf'),
    'cst-share': shareCustomerStatement,
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
    'prices-toggle': () => savePricesCfg({ on: pricesCfg().on === 'yes' ? 'no' : 'yes' }, pricesCfg().on === 'yes' ? 'صفحة الأسعار مسكّرة للزبائن' : 'صفحة الأسعار صارت شغّالة'),
    'prices-sec': (el) => savePricesCfg({ [el.dataset.id]: pricesCfg()[el.dataset.id] === 'yes' ? 'no' : 'yes' }),
    'prices-countries-toggle': () => savePricesCfg({ countriesAuto: pricesCfg().countriesAuto === 'yes' ? 'no' : 'yes' }),
    'prices-country': (el) => togglePriceCountry(el.dataset.id),
    'prices-ready-toggle': () => savePricesCfg({ readyOn: pricesCfg().readyOn === 'yes' ? 'no' : 'yes' }),
    'pm-new': () => openMethodModal(),
    'pm-edit': (el) => openMethodModal(el.dataset.id),
    'pm-toggle': (el) => toggleMethodOn(el.dataset.id),
    'pm-auto': (el) => { methodDraft.auto = el.dataset.auto; renderMethodModal(); },
    'pm-brand': (el) => { methodDraft.brand = el.dataset.k; if (PROVIDER_COVERAGE[el.dataset.k]) methodDraft.auto = 'yes'; if (el.dataset.k && !$('pm_name').value.trim()) $('pm_name').value = SERVICE_BRANDS[el.dataset.k].name; renderMethodModal(); },
    'pm-mode': (el) => { methodDraft.mode = el.dataset.mode; renderMethodModal(); },
    'pm-country': (el) => toggleMethodCountry(el.dataset.c),
    'pm-save': saveMethod,
    'pm-delete': deleteMethod,
    'prices-ready': (el) => togglePricesList('ready', el.dataset.id),
    'prices-copy': (el) => copyPricesUrl(el),
    'closing-count': toggleClosingCount,
    'closing-count-clear': clearClosingCount,
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
    'open-notice': openNoticeModal,
    'black-add': addBlacklist,
    'rec-save': saveRecurring,
    'rec-cancel': resetRecurringForm,
    'rec-edit': (el) => editRecurring(el.dataset.id),
    'rec-toggle': (el) => toggleRecurring(el.dataset.id),
    'rec-remove': (el) => removeRecurring(el.dataset.id),
    'open-recurring': () => openSettingsCard('recurring-settings'),
    'receipt-qr-toggle': toggleReceiptQr,
    'toggle-goal': toggleGoal,
    'toggle-loyalty': toggleLoyalty,
    'loyalty-skip': () => setLoyaltySkip(true),
    'loyalty-unskip': () => setLoyaltySkip(false),
    'cust-gone-toggle': toggleGoneMode,
    'gone-wa': (el) => goneWhatsapp(el.dataset.id),
    'gone-contacted': (el) => markGoneContacted(el.dataset.id),
    'black-remove': (el) => removeBlacklist(el.dataset.i),
    'notice-pick': (el) => noticePick(el.dataset.type, el.dataset.id),
    'notice-manual': noticeManual,
    'pay-save': savePayModal,
    'pay-skip': skipPayModal,
    'pay-cancel': cancelPayModal,
    'tx-pay': (el) => {
        const tx = ledger.find(x => x.id === toNum(el.dataset.id, NaN));
        if (tx && txHeld(tx)) return approvalWarn(tx);
        if (tx && walletsReady()) openTxPayModal(tx, 'مكتمل', { afterCreate: true });
    },
    'tx-approve': (el) => approveTx(toNum(el.dataset.id, NaN)),
    'tx-flag-ok': (el) => clearTxFlag(toNum(el.dataset.id, NaN)),
    'fraud-ok': confirmFraud,
    'fraud-cancel': () => { fraudPending = null; closeModal('fraudModal'); },
    'txd-track-copy': copyTrackLink,
    'fraud-same-toggle': toggleFraudSame,
    'monthly-toggle': toggleMonthlyReport,
    'track-link-toggle': toggleTrackLink,
    'monthly-save': saveReportEmail,
    'monthly-test': testMonthlyReport,
    'tx-limit-toggle': toggleTxLimit,
    'daily-test': (el) => testDailyPush(el.dataset.job),
    // USDT
    'usdt-new': (el) => openUsdtModal(el.dataset.kind),
    'usdt-kind': (el) => { if (!editingUsdtId) setUsdtKind(el.dataset.kind); updateUsdtPreview(); },
    'usdt-currency': (el) => setUsdtCurrency(el.dataset.cur),
    'usdt-copy': (el) => copyUsdtQuote(el),
    'egp-copy': (el) => copyQuoteButton(el, egpFormQuoteText()),
    'egpq-copy': (el) => copyQuoteButton(el, egpQuickQuoteText()),
    'usdt-select-customer': (el) => selectUsdtCustomer(el.dataset.id),
    'usdt-pay': (el) => openUsdtPay(toNum(el.dataset.id, NaN)),
    'final-adjust': (el) => bumpFinalAdjust(el.dataset.target, toNum(el.dataset.step, 0)),
    'tx-final-adjust': (el) => bumpTxFinalAdjust(el.dataset.step),
    'calc-adjust': (el) => bumpCalcAdjust(el.dataset.step),
    'usdt-receipt': (el) => openUsdtReceipt(toNum(el.dataset.id, NaN)),
    'edit-usdt': (el) => {
        const m = usdtMoves.find(x => x.id === toNum(el.dataset.id, NaN));
        if (m?.kind === 'transfer') openUsdtTransfer(m); else openUsdtModal('deposit', m);
    },
    'usdt-wallet-new': () => openUsdtWalletModal(),
    'edit-usdt-wallet': (el) => openUsdtWalletModal(usdtWallets.find(w => w.id === el.dataset.id)),
    'delete-usdt-wallet': deleteUsdtWalletPrompt,
    'usdt-wallet-copy': (el) => copyUsdtWalletField(el),
    'usdt-wallet-copy-open': (el) => openUsdtCopy(el.dataset.id),
    'uw-type': (el) => setUsdtWalletType(el.dataset.type),
    'uw-logo-remove': removeUsdtWalletLogo,
    'us-wallet': (el) => pickUsdtWallet(el.dataset.id),
    'usdt-transfer': () => openUsdtTransfer(),
    'ut-wallet': (el) => pickUsdtTransferWallet(el.dataset.field, el.dataset.id),
    'ut-network': (el) => pickUsdtTransferNetwork(el.dataset.name),
    'delete-usdt': (el) => deleteUsdtPrompt(toNum(el.dataset.id, NaN)),
    'usdt-net-add': addUsdtNetwork,
    'usdt-net-remove': (el) => removeUsdtNetwork(toNum(el.dataset.index, -1)),
    'settings-card': (el) => openSettingsCard(el.dataset.target),
    'settings-tab': (el) => setSettingsTab(el.dataset.stab, { animate: true }),
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
    'calc-repeat': (el) => applyCalcRepeat(el.dataset.id),
    'np-payout': (el) => setNewPayout(el.dataset.prefix, el.dataset.payout),
    'sessions-refresh': () => loadSessions(),
    'toggle-payout-ready': togglePayoutReady,
    'receipt-track-copy': (el) => copyReceiptTrackLink(el),
    'track-expire-toggle': toggleTrackExpire,
    'sessions-out-others': askRevokeOtherSessions,
    'session-revoke': (el) => askRevokeSession(el.dataset.sid),
    'np-provider': (el) => setNewPayout(el.dataset.prefix, newPayoutState[el.dataset.prefix]?.payout, el.dataset.provider),
    'set-cost-mode': (el) => {
        calcRatesTouched = true;
        setCostMode(el.dataset.mode);
    },
    'calc-tier-reset': () => resetCalcTier(),
    'calc-copy': (el) => copyCalcQuote(el),
    'calc-rev-open': openCalcReverse,
    'calc-rev-close': closeCalcReverse,
    'calc-rev-apply': applyCalcReverse,
    'edit-country': (el) => openCountryModal(toNum(el.dataset.index, -1)),
    'country-tier-add': () => addCountryTier(),
    'country-tier-remove': (el) => removeCountryTier(el.dataset.i),
    'pick-category': (el) => { $('exp_category').value = el.dataset.category; $('exp_amount').focus(); },
    'exp-cat-open': () => { $('exp-cat-add').classList.remove('hidden'); $('exp_cat_new').focus(); },
    'exp-cat-save': addExpenseCategory,
    'exp-cat-cancel': () => { $('exp_cat_new').value = ''; $('exp-cat-add').classList.add('hidden'); },
    'exp-cat-remove': (el) => removeExpenseCategory(el.dataset.category),
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
    bindPushEvents();
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
    bindReadyEvents();
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
            // النسخة المحفوظة لسا ما تحدثت: تعديل وحذف الموجود بيستنى (cache.js)
            if (staleBlocks(el.dataset.action)) warnStale();
            else CLICK_ACTIONS[el.dataset.action](el);
        }

        if (!e.target.closest('#user-menu') && !e.target.closest('#user-chip')) closeUserMenu();
        if (!e.target.closest('#copy-menu') && !e.target.closest('[data-action="tx-copy"]')) closeCopyMenu();
        if (!e.target.closest('#mnav-more-menu') && !e.target.closest('#mnav-more')) $('mnav-more-menu').classList.add('hidden');

        if (!e.target.closest('#us-customer-dropdown') && e.target !== $('us_customer')) closeUsdtCustomerPicker();
        if (!e.target.closest('#eg-customer-dropdown') && e.target !== $('eg_customer')) closeEgpCustomerPicker();
        if (!e.target.closest('#rs-customer-dropdown') && e.target !== $('rs_customer')) closeReadyCustomerPicker();

        // إغلاق قائمة اقتراحات الزبائن عند الضغط خارجها
        const dropdown = $('customer-search-dropdown');
        if (!dropdown.contains(e.target) && e.target !== $('calc_recipient')) {
            dropdown.classList.add('hidden');
        }

        // النوافذ ما بتسكر بالضغط برّاها (بس زر الإغلاق أو Esc)، حتى ما يضيع اللي انكتب فيها
    });
    document.addEventListener('change', (e) => {
        const el = e.target;
        if (el.dataset.action !== 'change-status') return;
        if (staleBlocks('edit-tx')) { warnStale(); renderLedgerTable(); return; }
        changeOrderStatus(toNum(el.dataset.id, NaN), el.value);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // الإشعار المهم ما بيسكّر إلا بـ "قرأت"، و"مين عدّل قبلي" إلا بالاختيار
        if (!$('notifyAlertModal').classList.contains('hidden') || !$('conflictModal').classList.contains('hidden')) return;
        closeAppConfirm();
        // قائمة النسخ مفتوحة: Esc بيسكّرها هي بس
        if (!$('copy-menu').classList.contains('hidden')) return closeCopyMenu();
        // نغلق النافذة العليا فقط (مثلاً الفاتورة فوق ملف الزبون، أو الحركة فوق حساب التاجر)
        const top = topModalId();
        if (top) closeModal(top);
        // حساب التاجر (صفحة مش نافذة): Esc برّا الخانات بيرجع لقائمة التجار
        else if (traderViewOpen() && !e.target.closest?.('input, textarea, select')) closeTraderView();
        $('customer-search-dropdown').classList.add('hidden');
    });
}

// النوافذ من فوق لتحت: Esc وزر الرجوع بيسكّروا اللي فوق بس
// (الإشعار المهم و"مين عدّل قبلي" مش هون: ما بيتسكّروا إلا بالاختيار)
const MODAL_ORDER = ['searchModal', 'methodModal', 'fraudModal', 'custStatementModal', 'notifyComposeModal', 'notifyModal', 'resetModal', 'restoreModal', 'editsModal', 'readySendModal', 'readyModal', 'waShareModal', 'closingModal', 'passwordModal', 'userModal', 'payModal', 'receiptModal', 'usdtModal', 'egpModal', 'egpWalletModal', 'egpRatesModal', 'usdtCopyModal', 'usdtWalletModal', 'usdtTransferModal', 'accountModal', 'noticeModal', 'amoveModal', 'tmoveModal', 'serviceModal', 'traderModal', 'custModal', 'editTxModal', 'txDetailsModal', 'countryModal', 'customerModal'];
const topModalId = () => MODAL_ORDER.find(id => !$(id).classList.contains('hidden'));

// ================= زر الرجوع بالجوال (بطلب عماد 2026-10-19) =================
// كان بيطلّع من البرنامج كله. هلّق بالترتيب: بيسكّر النافذة أو القائمة المفتوحة، بيرجع من حساب التاجر لقائمة التجار،
// ومن أي صفحة للحاسبة (والصفحة الفرعية لأمها)، ومن الحاسبة: "اكبس رجوع كمان مرة" والثانية بتطلع.
// بالـ history حالتين: base وفوقها guard؛ الرجوع بيوصل base فبنرجع نحط guard إذا عملنا إشي
function handleBackButton() {
    if (!$('notifyAlertModal').classList.contains('hidden') || !$('conflictModal').classList.contains('hidden')) return true;
    if (!$('appConfirmModal').classList.contains('hidden')) { closeAppConfirm(); return true; }
    if (!$('copy-menu').classList.contains('hidden')) { closeCopyMenu(); return true; }
    if (!$('mnav-more-menu').classList.contains('hidden')) { $('mnav-more-menu').classList.add('hidden'); return true; }
    const open = [...document.querySelectorAll('.cust-dropdown:not(.hidden), #user-menu:not(.hidden)')];
    if (open.length) { open.forEach(el => el.classList.add('hidden')); return true; }
    const top = topModalId();
    if (top) { closeModal(top); return true; }
    if (traderViewOpen()) { closeTraderView(); return true; }
    const current = TABS.find(t => !$('page-' + t).classList.contains('hidden'));
    if (current && current !== 'calculator') { switchTab(SUB_TABS[current] || 'calculator'); return true; }
    return false;
}

function initBackButton() {
    if (!window.history?.pushState) return;
    try {
        history.replaceState({ fp: 'base' }, '');
        history.pushState({ fp: 'guard' }, '');
    } catch (e) { return; /* بعض المتصفحات بالملف (file://) */ }
    window.addEventListener('popstate', () => {
        if (handleBackButton()) pushBackGuard();
        else showToast('اكبس رجوع كمان مرة للخروج', '', 'info');
    });
    // رجع لـ base وبعدين اشتغل بالبرنامج: الرجوع الجاي بيسكّر مش بيطلع
    document.addEventListener('click', () => { if (history.state?.fp === 'base') pushBackGuard(); }, true);
}

function pushBackGuard() {
    try { history.pushState({ fp: 'guard' }, ''); } catch (e) { /* ما بيضر */ }
}

// الحاسبة
function bindCalculatorEvents() {
    $('calc_recipient').addEventListener('input', onCustomerSearchInput);
    $('calc_recipient').addEventListener('focus', onCustomerSearchInput);
    $('calc_recipient').addEventListener('click', onCustomerSearchInput);
    $('calc_recipient').addEventListener('keydown', onCustomerPickerKey);
    ['calc_recipient', 'calc_account', 'calc_bank_account', 'calc_iban', 'calc_phone'].forEach(id => $(id).addEventListener('input', renderCalcBlackNote));
    $('calc_rev_target').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCalcReverse(); } });
    // كتابة المبلغ بإيدك بتشيل سطر "بيبعت… بيستلم…" القديم
    $('calc_orig_amount').addEventListener('input', () => $('calc-rev-note').classList.add('hidden'));
    $('source-search').addEventListener('input', renderSourceGrid);
    $('calc_other_name').addEventListener('input', updateSourceBadge);
    // كتابة التكلفة أو الربح بإيدك بتوقف شريحة المبلغ لهالحوالة (قبل runLiveCalc)
    ['calc_cost_pct', 'calc_profit_pct'].forEach(id => $(id).addEventListener('input', () => { calcRatesTouched = true; }));
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
    $('closing-rows').addEventListener('input', onClosingInput);
    $('amoveForm').addEventListener('submit', saveAmove);
    $('acc_type').addEventListener('change', () => { $('acc_usd').checked = ACCOUNT_TYPES[$('acc_type').value].usd; syncAccountUsdField(); syncAccountLimitFields(); });
    $('acc_usd').addEventListener('change', syncAccountUsdField);
    $('am_currency').addEventListener('change', fillAmoveAccounts);
    $('am_account').addEventListener('change', fillAmoveAccounts);
    $('pay-accounts').addEventListener('input', updatePaySummary);
    $('nt_text').addEventListener('input', onNoticeText);
    $('nt_text').addEventListener('paste', onNoticePaste);
    $('nt_text').addEventListener('dragover', (e) => e.preventDefault());
    $('nt_text').addEventListener('drop', onNoticeDrop);
    $('nt_image').addEventListener('change', () => readNoticeImage($('nt_image').files[0]));
    $('nt_amount').addEventListener('input', renderNoticeMatches);
    ['nt_dir', 'nt_account'].forEach(id => $(id).addEventListener('change', renderNoticeMatches));
    $('nt_currency').addEventListener('change', () => { fillNoticeAccounts(''); renderNoticeMatches(); });
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
    ['us_phone', 'us_np_account'].forEach(id => $(id).addEventListener('input', renderUsdtBlackNote));
    $('usdt_search').addEventListener('input', (e) => { usdtSearch = e.target.value; renderUsdtPage(); });
    ['usdt_kind_filter', 'usdt_month_filter', 'usdt_date_filter', 'usdt_wallet_filter'].forEach(id => $(id).addEventListener('change', renderUsdtPage));
    $('usdtWalletForm').addEventListener('submit', saveUsdtWallet);
    $('usdtTransferForm').addEventListener('submit', saveUsdtTransfer);
    ['ut_amount', 'ut_fee'].forEach(id => $(id).addEventListener('input', renderUsdtTransferForm));
    $('uw_holder').addEventListener('input', renderUsdtWalletTypeChips);
    $('uw_logo_file').addEventListener('change', (e) => onUsdtWalletLogoFile(e.target.files[0]));
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
    ['eg_phone', 'eg_np_account', 'eg_party', 'eg_party_number'].forEach(id => $(id).addEventListener('input', renderEgpBlackNote));
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
    bindPricesSettingsEvents();
    $('tx_limit').addEventListener('change', saveTxLimit);
    $('late_hours').addEventListener('change', saveLateHours);
    $('goal_amount').addEventListener('change', saveGoalAmount);
    ['loyalty_every', 'loyalty_type', 'loyalty_value'].forEach(id => $(id).addEventListener('change', saveLoyaltySettings));
    ['rec_name', 'rec_category', 'rec_amount', 'rec_day'].forEach(id => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveRecurring(); } }));
    $('black_value').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBlacklist(); } });
    $('black_reason').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBlacklist(); } });
    $('track_days').addEventListener('change', saveTrackDays);
    ['fraud_new_ils', 'fraud_daily'].forEach(id => $(id).addEventListener('change', saveFraudLimits));
    $('report_email').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveReportEmail(); } });
    $('push_debts_hour').addEventListener('change', () => saveDailyPushHour('pushDebtsHour', $('push_debts_hour').value));
    $('push_summary_hour').addEventListener('change', () => saveDailyPushHour('pushSummaryHour', $('push_summary_hour').value));
    ['set_screen_rate', 'set_sell_offset', 'set_buy_offset'].forEach(id => $(id).addEventListener('input', updateSellBuyPreview));
    $('countryForm').addEventListener('submit', saveCountry);
    $('c_tier_rows').addEventListener('input', onCountryTierInput);
    ['c_cost_value', 'c_profit_pct'].forEach(id => $(id).addEventListener('input', updateCountryTierHints));
    $('c_cost_mode').addEventListener('change', updateCountryTierHints);
}

// المصاريف
function bindExpenseEvents() {
    $('expenseForm').addEventListener('submit', saveExpense);
    // Enter بخانة البند الجديد بيضيفه (مش بيحفظ المصروف)
    $('exp_cat_new').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        addExpenseCategory();
    });
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

    // آخر نسخة محفوظة على الجهاز فوراً (إذا في)، وبنفس اللحظة من Google Sheets (cache.js)
    startDataLoad();
    initBackButton();

    fetchLiveDollarRate();
    fetchEgpRate();


    // إعادة إرسال العمليات المعلقة تلقائياً كل دقيقة وعند عودة الإنترنت
    setInterval(() => { if (outbox.length) flushOutbox(); }, 60 * 1000);
    window.addEventListener('online', () => {
        renderOfflineBanner();
        if (dataState === 'stale' || dataState === 'error') loadFromSheets();
        else if (outbox.length) flushOutbox();
    });
    window.addEventListener('offline', () => { renderOfflineBanner(); updateSyncPendingBar(); });

    // تحديث حيّ واحد كل دقيقتين (سعر الشاشة + الشيت معاً)، وعند الرجوع للصفحة
    setInterval(liveCycle, LIVE_REFRESH_MS);
    setInterval(lateTick, 60 * 1000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            // اللي انبعت بالخلفية وإحنا مسكّرين (الأندرويد)
            absorbBackgroundSync();
            liveCycle();
        } else if (outbox.length) {
            // رايح للخلفية وفي إشي معلّق: الأندرويد بيكمّل لحاله لما يرجع النت
            scheduleOutboxMirror();
            requestBackgroundSync();
        }
    });
});
