'use strict';

// فاست باي — البحث الشامل (زر 🔍 فوق، أو ⌘K / Ctrl+K، أو /): بالاسم أو الجوال أو رقم الإيصال أو الحركة،
// بكل الأقسام اللي إلك صلاحية عليها. الضغط على نتيجة بيفتحها بمكانها
// الملفات تُحمَّل بالترتيب في index.html وتتشارك نفس المتغيرات العامة.

let searchResults = [];
let searchIndex = 0;

function openSearch() {
    if (document.body.classList.contains('locked')) return;
    $('global-search').value = '';
    renderSearchResults();
    openModal('searchModal');
    setTimeout(() => $('global-search').focus(), 30);
}

// أحدث أول، وأول 6 من كل قسم
const latestFirst = (list) => [...list].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);

function searchAll(raw) {
    const q = normName(raw.replace('#', ''));
    const digits = raw.replace(/\D/g, '');
    if (q.length < 2 && digits.length < 2) return [];
    const has = (...texts) => texts.some(t => q && normName(t).includes(q));
    // جزء من رقم (جوال، حساب، رقم حركة): 3 أرقام على الأقل
    const num = (...values) => digits.length >= 3 && values.some(v => normPhone(v).includes(digits));
    // رقم الإيصال أو الحركة بالضبط بيطلع أول
    const exact = (x) => !!digits && (String(x.serial) === digits || String(x.id) === digits);
    const out = [];
    const add = (group, list, make) => {
        const hits = list.slice().sort((a, b) => exact(b) - exact(a)).slice(0, 6);
        hits.forEach(x => out.push({ group, exact: exact(x), ...make(x) }));
    };

    if (customers.length) {
        add('الزبائن', customers.filter(c => has(c.name) || num(c.phone, c.account, c.bankAccount, c.iban)), c => ({
            icon: '👤', title: c.name, sub: [c.phone && `<bdi class="ltr-num">${escapeHtml(c.phone)}</bdi>`, c.account && escapeHtml(c.account)].filter(Boolean).join(' · ') || escapeHtml(c.payout),
            run: () => openCustomerProfile(c.id, c.name)
        }));
    }
    if (hasPerm('transactions')) {
        add('الحوالات', latestFirst(ledger.filter(t => has(t.recipient) || num(t.account, t.bankAccount, t.id, t.iban) || exact(t))), t => ({
            icon: '💸', title: t.recipient, sub: `${receiptNo(t)} · ${escapeHtml(t.date)} · ${t.currency === 'USD' ? moneyCur(t.clientUsd, 'USD') : moneyCur(t.clientIls, 'ILS')} · ${escapeHtml(t.status)}`,
            run: () => gotoRef('tx', t.id)
        }));
    }
    if (hasPerm('usdt')) {
        add('USDT', latestFirst(usdtMoves.filter(m => usdtTrade(m) && (has(m.customerName) || num(m.id) || exact(m)))), m => ({
            icon: '₮', title: m.customerName, sub: `${receiptNo(m)} · ${USDT_KINDS[m.kind]} ${fmt(m.amount)} USDT · ${escapeHtml(m.date)}`,
            run: () => gotoRef('usdt', m.id)
        }));
    }
    if (hasPerm('egp')) {
        add('الجنيه', latestFirst(egpMoves.filter(m => has(m.customerName, m.party) || num(m.partyNumber, m.id) || exact(m))), m => ({
            icon: '🇪🇬', title: egpPayWho(m), sub: `${receiptNo(m)} · ${EGP_KINDS[m.kind]} ${fmtEgp(Math.abs(m.egp))} جنيه · ${escapeHtml(m.date)}`,
            run: () => gotoRef('egp', m.id)
        }));
        add('محافظ الجنيه', egpWallets.filter(w => has(egpWalletName(w)) || num(w.number)), w => ({
            icon: '📱', title: egpWalletName(w), sub: `${fmtEgp(egpWalletBalances()[w.id] || 0)} جنيه`,
            run: () => { egpWalletFilter = w.id; switchTab('egp'); }
        }));
    }
    if (hasPerm('traders')) {
        add('التجار', traders.filter(t => has(t.name) || num(t.phone)), t => ({
            icon: '🤝', title: t.name, sub: Object.entries(traderBalances(t.id)).filter(([, v]) => !isZero(v)).map(([cur, v]) => `${balanceText(v)} ${fmt(Math.abs(v))} ${curSym(cur)}`).join(' · ') || 'متصفّر',
            run: () => openTraderPanel(t.id)
        }));
    }
    if (hasPerm('accounts')) {
        add('الحسابات', accounts.filter(a => has(accountName(a))), a => ({
            icon: '💳', title: accountName(a), sub: moneyCur(accountBalances()[a.id]?.ILS || 0, 'ILS'),
            run: () => { accountFilterId = a.id; switchTab('accounts'); }
        }));
    }
    if (hasPerm('ready')) {
        add('الحسابات الجاهزة', readyAccounts.filter(x => has(x.name, x.category) || num(x.details)), x => ({
            icon: '📋', title: x.name, sub: escapeHtml([x.category, x.paused ? 'موقوف' : ''].filter(Boolean).join(' · ') || 'حساب جاهز'),
            run: () => { readyFilter = 'all'; $('ready_search').value = x.name; switchTab('ready'); }
        }));
    }
    // تطابق رقم الإيصال بالضبط فوق الكل
    return out.sort((a, b) => b.exact - a.exact);
}

function renderSearchResults() {
    const raw = latinDigits($('global-search').value.trim());
    searchResults = searchAll(raw);
    searchIndex = 0;
    if (!raw) {
        $('search-results').innerHTML = '<div class="search-empty">اكتب اسم زبون، رقم جوال، أو رقم إيصال (#1042)</div>';
        return;
    }
    if (!searchResults.length) {
        $('search-results').innerHTML = `<div class="search-empty">${raw.length < 2 ? 'كمّل الكتابة...' : 'ما في نتائج'}</div>`;
        return;
    }
    let lastGroup = '';
    $('search-results').innerHTML = searchResults.map((r, i) => {
        const head = r.group !== lastGroup ? `<div class="search-group">${r.group}</div>` : '';
        lastGroup = r.group;
        return `${head}<button type="button" data-action="search-pick" data-i="${i}" class="search-item${i === 0 ? ' active' : ''}">
            <span class="search-icon">${r.icon}</span>
            <span class="min-w-0 flex-1 text-right"><b class="block truncate">${escapeHtml(r.title || '—')}</b><span class="block text-[11px] text-slate-400 truncate">${r.sub || ''}</span></span>
        </button>`;
    }).join('');
}

function moveSearchIndex(step) {
    if (!searchResults.length) return;
    searchIndex = (searchIndex + step + searchResults.length) % searchResults.length;
    document.querySelectorAll('#search-results .search-item').forEach((b, i) => b.classList.toggle('active', i === searchIndex));
    document.querySelector('#search-results .search-item.active')?.scrollIntoView({ block: 'nearest' });
}

function pickSearchResult(i) {
    const r = searchResults[i];
    if (!r) return;
    closeModal('searchModal');
    r.run();
}

function bindSearchEvents() {
    $('global-search').addEventListener('input', renderSearchResults);
    $('global-search').addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchIndex(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearchIndex(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); pickSearchResult(searchIndex); }
    });
    // ⌘K / Ctrl+K من أي مكان، و / إذا مش عم تكتب بخانة
    document.addEventListener('keydown', (e) => {
        const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            openSearch();
        } else if (e.key === '/' && !typing && !document.querySelector('.modal:not(.hidden)')) {
            e.preventDefault();
            openSearch();
        }
    });
}
