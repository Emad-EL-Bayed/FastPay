'use strict';

// فاست باي — "مين عدّل قبلي" (بطلب عماد 2026-10-18)
// كل تعديل أو حذف بيبعت معه آخر تحديث شفناه للسطر (sync.js queueOps). إذا حدا عدّل السطر بعدها (موظف ثاني،
// أو تعديل بإيد بالشيت، أو تعديلك وصل متأخر لأنه النت كان مقطوع) السكربت ما بيكتب فوقه وبيرجّع conflict:
// العملية (ومجموعتها، زي دفعات الحوالة) بتطلع من الانتظار لهون، والنافذة بتسأل: تعديله ولا تعديلي.
// القائمة محفوظة على الجهاز (STORAGE.conflicts) حتى لو انسكّر البرنامج قبل ما تختار.

let conflictQueue = (() => {
    const v = loadJSON(STORAGE.conflicts, []);
    return Array.isArray(v) ? v.filter(x => x && Array.isArray(x.ops) && x.ops.length) : [];
})();
let conflictOpen = null;

function saveConflicts() {
    try { localStorage.setItem(STORAGE.conflicts, JSON.stringify(conflictQueue)); } catch (e) { /* التخزين ممتلئ */ }
}

// العملية المتعارضة (conflict) أو وحدة من مجموعتها (conflict_group): بنجمعهم تحت نفس المجموعة
function holdConflict(op, res) {
    if (!op) return;
    const group = op._grp || 'k:' + (opRowKey(op) || op.action + Date.now());
    let entry = conflictQueue.find(e => e.group === group);
    if (!entry) {
        entry = { group, ops: [], info: null, at: Date.now() };
        conflictQueue.push(entry);
    }
    entry.ops.push(op);
    if (res?.error === 'conflict') entry.info = res;
    saveConflicts();
}

// عملية لسا بالانتظار على سطر من المتعارضة ('@prev' ورا وحدة منهم) كانت رح تنبعت وتكتب فوقه: بتستنى مع مجموعتها
function holdChainedConflicts() {
    let moved = true;
    while (moved) {
        moved = false;
        const held = new Set(conflictQueue.flatMap(e => e.ops.map(opRowKey)).filter(Boolean));
        const i = outbox.findIndex(op => held.has(opRowKey(op)));
        if (i < 0) break;
        const key = opRowKey(outbox[i]);
        const entry = conflictQueue.find(e => e.ops.some(o => opRowKey(o) === key));
        const grp = outbox[i]._grp;
        // المجموعة كلها بتروح مع العملية
        const take = grp ? outbox.filter(op => op._grp === grp) : [outbox[i]];
        outbox = outbox.filter(op => !take.includes(op));
        entry.ops.push(...take);
        moved = true;
    }
    saveConflicts();
}

// ---------- النافذة ----------
// "2026-10-18 15:42:10" ← "اليوم 3:42 م" / "17/10 · 3:42 م"
function conflictTimeText(at) {
    const m = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    if (!m) return '';
    const h = Number(m[4]);
    const time = `${h % 12 || 12}:${m[5]} ${h < 12 ? 'ص' : 'م'}`;
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    return day === localDateStr() ? `اليوم ${time}` : `${Number(m[3])}/${Number(m[2])} · ${time}`;
}

function showNextConflict() {
    if (conflictOpen || !conflictQueue.length || $('conflictModal') === null) return;
    // لحد ما يكون في بيانات من الشيت (حتى "عنده هلّق" يكون صح)
    if (dataState !== 'ready') return;
    conflictOpen = conflictQueue[0];
    renderConflict(conflictOpen);
    openModal('conflictModal');
}

// "عدّل هالحوالة" / "حذف هالزبون"
const CONFLICT_NOUNS = {
    ledger: 'هالحوالة', customers: 'هالزبون', expenses: 'هالمصروف', traders: 'هالتاجر', traderMoves: 'هالحركة عند التاجر',
    traderServices: 'هالخدمة', countries: 'تسعير هالدولة', accounts: 'هالحساب', accountMoves: 'هالحركة على الحساب',
    usdtMoves: 'حركة الـ USDT هاي', egpWallets: 'هالمحفظة', egpMoves: 'حركة الجنيه هاي', closings: 'هالجرد'
};
// فرق مش حقيقي: فاضي و 0 (عمود جديد ما انعبّى)، أو نفس الرقم بكتابة ثانية
const sameCell = (a, b) => {
    const x = String(a ?? '').trim(), y = String(b ?? '').trim();
    if (x === y) return true;
    if ((x === '' || x === '0') && (y === '' || y === '0')) return true;
    return x !== '' && y !== '' && Number.isFinite(Number(x)) && Number(x) === Number(y);
};

function renderConflict(entry) {
    const info = entry.info || {};
    const who = info.by ? personName(info.by) : 'حدا ثاني';
    const when = conflictTimeText(info.at);
    const main = entry.ops.find(op => op._base && op._base !== '@prev') || entry.ops[0];
    const isDelete = info.isDelete || opIsDelete(main);
    const others = entry.ops.length - 1;
    const noun = CONFLICT_NOUNS[info.collection] || 'هالحركة';
    $('conflict-title').textContent = info.gone ? `${who} حذف ${noun}` : `${who} عدّل ${noun} قبلك`;
    $('conflict-summary').innerHTML = [
        info.summary ? `<b>${escapeHtml(info.summary)}</b>` : '',
        info.gone ? `انحذفت${when ? ' ' + escapeHtml(when) : ''}، وتعديلك كان رح يرجّعها.`
            : isDelete ? `تعدّلت${when ? ' ' + escapeHtml(when) : ''} بعد ما إنت شفتها، وإنت بدك تحذفها.`
            : `تعدّلت${when ? ' ' + escapeHtml(when) : ''} وإنت ما كنت شايف تعديله، فتعديلك ما انحفظ لسا.`,
        others > 0 ? `<span class="text-slate-500">ومعها ${others} ${others === 1 ? 'عملية مرتبطة' : 'عمليات مرتبطة'} (زي الدفعات) بتمشي معها.</span>` : ''
    ].filter(Boolean).join('<br>');
    const diff = (Array.isArray(info.diff) ? info.diff : []).filter(([, theirs, mine]) => !sameCell(theirs, mine));
    $('conflict-diff').classList.toggle('hidden', !diff.length);
    $('conflict-diff-body').innerHTML = diff.map(([label, theirs, mine]) => `
        <tr>
            <td class="font-bold text-slate-600">${escapeHtml(label)}</td>
            <td><bdi>${escapeHtml(String(theirs) || '—')}</bdi></td>
            <td class="font-bold text-slate-900"><bdi>${escapeHtml(String(mine) || '—')}</bdi></td>
        </tr>`).join('');
    $('conflict-theirs-label').textContent = `عند ${who} هلّق`;
    $('conflict-keep-theirs').textContent = info.gone ? 'خلّيها محذوفة' : isDelete ? 'لا، خلّيها' : `خلّي تعديل ${who}`;
    $('conflict-keep-mine').textContent = info.gone ? 'رجّعها بتعديلي' : isDelete ? 'احذفها برضو' : 'احفظ تعديلي فوقه';
    $('conflict-left').textContent = conflictQueue.length > 1 ? `وفي ${conflictQueue.length - 1} غيرها بعدها` : '';
}

async function resolveConflict(keepMine) {
    const entry = conflictOpen;
    if (!entry) return;
    conflictQueue = conflictQueue.filter(e => e !== entry);
    conflictOpen = null;
    saveConflicts();
    closeModal('conflictModal');
    if (keepMine) {
        // بترجع لأول الانتظار بنفس ترتيبها، وبتنكتب فوقه (_force)
        const ops = entry.ops.map(op => ({ ...op, _force: true }));
        outbox.unshift(...ops);
        saveAll();
        ops.forEach(applyOpLocally);
        renderDataViews();
        const status = await flushOutbox();
        showToast('انحفظ تعديلك', syncResultMessage(status), syncToastType(status));
    } else {
        showToast('تمام، ضل تعديله', 'تعديلك انلغى، واللي قدامك هلّق هو اللي بالشيت', 'info');
    }
    // اللي قدامك يرجع زي الشيت
    lastFullLoadMs = 0;
    await loadFromSheets({ silent: true });
    showNextConflict();
}
