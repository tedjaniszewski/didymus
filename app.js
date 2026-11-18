/* Didymus — daily memorization of poems and Scripture.
 * All data lives in this browser (localStorage). No server, no accounts.
 */
(() => {
  'use strict';

  // ---------- helpers ----------
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => isoOf(new Date());
  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoOf(new Date(y, m - 1, d + n)); };
  const daysBetween = (a, b) => { const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5); };
  const fmtDate = iso => { const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}); };
  const clone = o => JSON.parse(JSON.stringify(o));
  const fmtInterval = n => n < 1 ? 'today' : n === 1 ? '1 day' : n < 30 ? n + ' days' : n < 365 ? Math.round(n / 30) + ' mo' : (n / 365).toFixed(1) + ' yr';
  const uid = () => 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const KINDS = ['poem', 'verse'];

  $('#date').textContent = new Date().toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'});

  // ---------- library ----------
  const LIB = window.DIDYMUS_LIBRARY || {poems: [], verses: []};
  const builtin = {poem: LIB.poems || [], verse: LIB.verses || []};

  // ---------- persistent state (localStorage) ----------
  const KEY = 'didymus.v1';
  let state = null, storageOK = true;

  function freshState(){
    const s = {v: 1, created: today(), custom: {poem: [], verse: []}, queue: {poem: [], verse: []}, seen: [],
               poem: {current: null, startedOn: today()}, verse: {current: null, startedOn: today()},
               bank: {}, settings: {practice: 'full'}, lastBackup: null};
    return s;
  }
  // bring any built-in items not yet seen into the queue (also handles first run and future library additions)
  function reconcile(s){
    s.custom = s.custom || {poem: [], verse: []};
    s.queue = s.queue || {poem: [], verse: []};
    s.seen = s.seen || [];
    s.bank = s.bank || {};
    s.settings = s.settings || {practice: 'full'};
    const seen = new Set(s.seen);
    for (const k of KINDS) {
      s[k] = s[k] || {current: null, startedOn: today()};
      for (const it of builtin[k]) if (!seen.has(it.id)) { s.queue[k].push(it.id); s.seen.push(it.id); }
      // drop ids that no longer resolve, or are already memorized / current
      s.queue[k] = s.queue[k].filter((id, i, a) => byIdIn(s, id) && !s.bank[id] && id !== s[k].current && a.indexOf(id) === i);
      if (s[k].current && (!byIdIn(s, s[k].current) || s.bank[s[k].current])) s[k].current = null;
      if (!s[k].current && s.queue[k].length) { s[k].current = s.queue[k].shift(); s[k].startedOn = today(); }
    }
    return s;
  }
  function load(){
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { storageOK = false; }
    let s = null;
    if (raw) { try { s = JSON.parse(raw); } catch (e) { s = null; } }
    state = reconcile(s || freshState());
    if (!raw) persist();
  }
  function persist(){
    try { localStorage.setItem(KEY, JSON.stringify(state)); storageOK = true; }
    catch (e) { storageOK = false; toast('Couldn’t save in this browser — export a backup.'); }
    if (navigator.storage && navigator.storage.persist && !persist.asked) {
      persist.asked = true; navigator.storage.persist().catch(() => {});
    }
  }
  function commit(mutator, undoable){
    const before = clone(state);
    mutator(state);
    reconcile(state);
    persist();
    if (undoable) undoState = before;
    render();
  }
  // other tabs/windows of the app stay in step
  addEventListener('storage', e => { if (e.key === KEY && e.newValue) { try { state = reconcile(JSON.parse(e.newValue)); render(); } catch (_) {} } });

  function byIdIn(s, id){
    for (const k of KINDS) {
      const c = (s.custom && s.custom[k] || []).find(x => x.id === id); if (c) return c;
      const b = builtin[k].find(x => x.id === id); if (b) return b;
    }
    return null;
  }
  const byId = id => byIdIn(state, id);
  const kindOf = id => { const it = byId(id); return it ? (it.kind || (it.lines ? 'poem' : 'verse')) : null; };
  const isCustom = id => /^u-/.test(id);
  const nameOf = id => { const it = byId(id); return it ? (it.title || it.ref) : id; };
  const subOf = it => it.kind === 'poem' || it.lines ? (it.author || '') : [it.topic, it.translation].filter(Boolean).join(' · ');

  // ---------- UI state (not saved) ----------
  let practice = 'full', view = 'poem', pendingConfirm = null, undoState = null;
  let reviewQ = null, reviewIdx = 0, revealed = false, reviewDone = 0, bankDetail = null;
  let draft = null, draftErr = '', importMsg = '', resetArmed = false;
  const qExpanded = {poem: false, verse: false};
  const Q_SHOW = 8;

  // ---------- text rendering ----------
  // A "unit" is one line of verse (or, for prose Scripture, a run of roughly a poetic line's length).
  const isLetter = ch => /\p{L}/u.test(ch);
  const hasLetters = t => /\p{L}/u.test(t);
  const hideMap = {};
  const hiddenSet = id => (hideMap[id] = hideMap[id] || new Set());

  // mode: 'full' | 'first' | 'hide'
  function renderWord(tok, mode){
    let lord = false;
    if (tok.includes('⟦')) { lord = true; tok = tok.replace(/[⟦⟧]/g, ''); }
    if (mode === 'full') return lord ? '<span class="lord">' + esc(tok) + '</span>' : esc(tok);
    let out = '', atPartStart = true;
    for (const ch of tok) {
      if (isLetter(ch)) {
        out += (mode === 'first' && atPartStart) ? esc(ch) : '<span class="u">' + esc(ch) + '</span>';
        atPartStart = false;
      } else {
        out += esc(ch);
        if (ch === '-' || ch === '—') atPartStart = true;
      }
    }
    out = '<span class="w">' + out + '</span>';
    return lord ? '<span class="lord">' + out + '</span>' : out;
  }
  function renderUnit(text, unitIdx, itemId, mode, ctx){
    const hid = itemId && !ctx ? hiddenSet(itemId) : null;
    let wi = 0;
    return text.split(/(\s+)/).map(t => {
      if (!t || /^\s+$/.test(t)) return t;
      const w = wi++;
      if (ctx && hasLetters(t)) {
        const gi = ctx.gi++;
        if (gi < game.idx) return '<span class="gw ok">' + renderWord(t, 'full') + '</span>';
        return '<span class="gw todo' + (gi === game.idx ? ' cur' : '') + (gi === game.idx && game.miss ? ' miss' : '') + '"'
             + (gi === game.idx ? ' id="gcur"' : '') + '>' + renderWord(t, mode) + '</span>';
      }
      return renderWord(t, (hid && hid.has(unitIdx + ':' + w)) ? 'hide' : mode);
    }).join('');
  }
  function chunkProse(text){
    const words = text.split(/\s+/).filter(Boolean), out = []; let cur = [];
    for (const w of words) {
      if (cur.length && cur.join(' ').length + 1 + w.replace(/[⟦⟧]/g, '').length > 44) { out.push(cur.join(' ')); cur = []; }
      cur.push(w);
    }
    if (cur.length) out.push(cur.join(' '));
    return out;
  }
  const lvlOf = l => (l.match(/^>+/) || [''])[0].length;
  function unitsOf(item){
    const units = [];
    if (item.lines) {
      let stz = false;
      for (const l of item.lines) {
        if (l === '') { stz = true; continue; }
        units.push({text: l.replace(/^>+/, ''), lvl: lvlOf(l), before: stz ? 'stanza' : null}); stz = false;
      }
      return {kind: 'lines', units};
    }
    const vs = item.verses || [];
    const multi = vs.length > 1;
    vs.forEach((v, i) => {
      if (item.poetry) {
        v.lines.forEach((l, j) => units.push({text: l.replace(/^>+/, ''), lvl: lvlOf(l),
          vn: multi && j === 0 ? v.n : null, before: (i && j === 0 && item.gap) ? 'gap' : null}));
      } else {
        chunkProse(v.lines.join(' ')).forEach((c, j) => units.push({text: c, vn: multi && j === 0 ? v.n : null}));
      }
    });
    return {kind: item.poetry ? 'lines' : 'prose', units};
  }
  function itemBody(item, mode, withHides){
    const {kind, units} = unitsOf(item);
    const id = withHides ? item.id : null;
    const ctx = (withHides && game.on && game.itemId === item.id) ? {gi: 0} : null;
    const vn = u => u.vn ? '<sup class="vn">' + esc(u.vn) + '</sup>' : '';
    if (kind === 'prose') {
      return '<div class="prose"><p>' + units.map((u, i) => vn(u) + renderUnit(u.text, i, id, mode, ctx)).join(' ') + '</p></div>';
    }
    return '<div class="poem"><div class="body">' + units.map((u, i) =>
      (u.before === 'stanza' ? '<div class="stz"></div>' : u.before === 'gap' ? '<p class="gapmark">· · ·</p>' : '')
      + '<p class="l' + (u.lvl ? ' i' + Math.min(u.lvl, 2) : '') + '">' + vn(u) + renderUnit(u.text, i, id, mode, ctx) + '</p>').join('')
      + '</div></div>';
  }
  const authorLine = p => '<div class="author">' + esc(p.author) + (p.firstPub ? ' <span class="yr">(' + esc(p.firstPub) + ')</span>' : '') + '</div>';
  function itemHead(it){
    if (it.lines) return '<div class="title">' + esc(it.title) + '</div>' + authorLine(it);
    return '<div class="ref">' + esc(it.ref) + '</div><div class="topic">' + esc([it.topic, it.translation].filter(Boolean).join(' · ')) + '</div>';
  }

  // ---------- recitation game ----------
  const game = {on: false, itemId: null, idx: 0, words: [], miss: false, done: false, tries: 1, best: 0};
  const firstLetterOf = t => { const m = t.replace(/[⟦⟧]/g, '').normalize('NFD').match(/\p{L}/u); return m ? m[0].toLowerCase() : ''; };
  function gameWords(item){
    const out = [];
    unitsOf(item).units.forEach(u => u.text.split(/\s+/).forEach(t => { if (t && hasLetters(t)) out.push(firstLetterOf(t)); }));
    return out;
  }
  const kin = $('#keyIn');
  function focusKeys(){ kin.value = ''; try { kin.focus({preventScroll: true}); } catch (_) { kin.focus(); } }
  function startGame(item){
    Object.assign(game, {on: true, itemId: item.id, idx: 0, words: gameWords(item), miss: false, done: false, tries: 1, best: 0});
    focusKeys(); render(); scrollToCur();
  }
  function stopGame(){ game.on = false; game.done = false; kin.blur(); render(); }
  function scrollToCur(){
    const c = document.getElementById('gcur'); if (!c) return;
    const r = c.getBoundingClientRect(), vh = window.visualViewport ? window.visualViewport.height : innerHeight;
    if (r.top < 70 || r.bottom > vh - 90) c.scrollIntoView({block: 'center', behavior: 'smooth'});
  }
  function gameKey(ch){
    if (!game.on || game.done) return;
    ch = ch.normalize('NFD').replace(/[^\p{L}]/gu, '').toLowerCase();
    if (!ch) return;
    if (ch === game.words[game.idx]) {
      game.idx++; game.miss = false; game.best = Math.max(game.best, game.idx);
      if (game.idx >= game.words.length) { game.done = true; kin.blur(); }
    } else { game.idx = 0; game.miss = true; game.tries++; }
    render(); if (game.miss) setTimeout(scrollToCur, 30); else scrollToCur();
  }
  function gameBar(item){
    if (!game.on || game.itemId !== item.id)
      return '<div class="practice hidebar"><button class="seg play" data-act="play" data-id="' + esc(item.id) + '">▶&#xFE0E; Play</button></div>';
    if (game.done)
      return '<p class="gstat ok">Complete — ' + game.words.length + ' words' + (game.tries === 1 ? ', first try.' : ', on attempt ' + game.tries + '.') + '</p>'
           + '<div class="practice hidebar"><button class="seg" data-act="play" data-id="' + esc(item.id) + '">Play again</button>'
           + '<button class="seg" data-act="stop">Done</button></div>';
    return '<p class="gstat">' + (game.miss ? '<span class="bad">Missed — back to the beginning.</span> ' : '')
         + game.idx + ' / ' + game.words.length + (game.tries > 1 ? ' · attempt ' + game.tries + ' · best ' + game.best : '') + '</p>'
         + '<div class="practice hidebar"><button class="seg" data-act="refocus">Keyboard</button><button class="seg" data-act="stop">■&#xFE0E; Stop</button></div>';
  }
  function hideOneMore(item){
    const set = hiddenSet(item.id);
    unitsOf(item).units.forEach((u, i) => {
      const cand = []; let wi = 0;
      u.text.split(/\s+/).forEach(t => { if (!t) return; const w = wi++; if (hasLetters(t) && !set.has(i + ':' + w)) cand.push(w); });
      if (cand.length) set.add(i + ':' + cand[Math.floor(Math.random() * cand.length)]);
    });
  }
  const practiceBar = () => '<div class="practice">' + [['full', 'Full text'], ['first', 'First letters'], ['hide', 'Hidden']]
      .map(([k, l]) => '<button class="seg" data-practice="' + k + '" aria-pressed="' + (practice === k) + '">' + l + '</button>').join('') + '</div>';

  // ---------- spaced repetition ----------
  // A modified SM-2. Each memorized item carries interval (days), ease, reps, lapses, lastReviewed, due.
  //  • Reviewing late gives credit for the extra time it was remembered (half for Good, full for Easy).
  //  • Reviewing early never shortens the schedule, but also doesn't reward the early recall as if it were on time.
  //  • Intervals of a week or more get ±5% jitter so items memorized together drift apart; capped at one year.
  const FIRST_INTERVAL = 3, MAX_INTERVAL = 365, SESSION_CAP = 20;
  function srsNext(b, g, jitter){
    const ease = b.ease || 2.5, iv = Math.max(1, b.interval || FIRST_INTERVAL);
    const elapsed = Math.max(0, daysBetween(b.lastReviewed || b.memorizedOn, today()));
    const early = elapsed < iv, late = Math.max(0, elapsed - iv);
    let interval, e = ease;
    if (g === 'again') { interval = 1; e = Math.max(1.3, ease - 0.2); }
    else if (g === 'hard') { interval = Math.max(1, Math.round((early ? Math.max(1, elapsed) : iv) * 1.2)); e = Math.max(1.3, ease - 0.15); }
    else {
      const good = early ? Math.max(iv, Math.round(Math.max(1, elapsed) * ease))
                         : Math.max(iv + 1, Math.round((iv + late / 2) * ease));
      if (g === 'good') interval = good;
      else { interval = Math.max(good + 1, Math.round((early ? Math.max(1, elapsed) : iv + late) * ease * 1.3)); e = ease + 0.15; }
    }
    if (jitter && interval >= 7) interval = Math.round(interval * (0.95 + Math.random() * 0.1));
    return {interval: Math.min(MAX_INTERVAL, interval), ease: +e.toFixed(2)};
  }
  // overdue ratio: how far past its interval an item is (most-forgotten-risk first)
  function overdueRatio(b){
    const el = daysBetween(b.lastReviewed || b.memorizedOn, today());
    return el / Math.max(1, b.interval || FIRST_INTERVAL);
  }
  const dueList = () => Object.entries(state.bank).filter(([id, b]) => b.due <= today() && byId(id))
      .sort((a, b) => overdueRatio(b[1]) - overdueRatio(a[1])).map(([id]) => id);

  // ---------- views ----------
  function viewToday(kind){
    const t = state[kind];
    const item = t.current ? byId(t.current) : null;
    if (!item) return '<p class="note">' + (kind === 'poem' ? 'No poem in your queue.' : 'No passage in your queue.') + '</p>'
      + '<div class="actions"><a class="btn ghost" href="#add" data-go="add" data-kind="' + kind + '">Add ' + (kind === 'poem' ? 'a poem' : 'a passage') + '</a></div>';
    const notYet = t.startedOn > today();
    const day = notYet ? 0 : daysBetween(t.startedOn, today()) + 1;
    const meta = (notYet ? 'Begins tomorrow' : 'Day ' + day)
      + (item.series ? ' · <span class="sc">' + esc(item.series) + '</span> · ' + esc(item.seriesName) : '');
    let html = '<div class="meta">' + meta + '</div>' + itemHead(item);
    if (notYet) {
      const prev = Object.entries(state.bank).filter(([, b]) => b.kind === kind).sort((a, b) => a[1].memorizedOn < b[1].memorizedOn ? 1 : -1)[0];
      return html + '<p class="note">' + (prev ? '<em>' + esc(nameOf(prev[0])) + '</em> is in your memory bank.<br>' : '')
        + 'The next ' + (kind === 'poem' ? 'poem' : 'passage') + ' starts tomorrow morning.</p>'
        + '<div class="actions"><button class="btn ghost" data-act="startnow" data-kind="' + kind + '">Start it now</button></div>';
    }
    html += practiceBar() + '<div class="' + (game.on && game.itemId === item.id ? 'gamearea' : '') + '" data-act="' + (game.on && !game.done ? 'refocus' : '') + '">'
          + itemBody(item, practice, true) + '</div>';
    if (item.source) html += '<div class="src">' + esc(item.source) + '</div>';
    if (practice !== 'full') html += gameBar(item);
    else html += '<div class="practice hidebar"><button class="seg" data-act="hidemore" data-id="' + esc(item.id) + '">Hide a word per line</button>'
          + '<button class="seg" data-act="restore" data-id="' + esc(item.id) + '"' + (hiddenSet(item.id).size ? '' : ' disabled') + '>Restore all</button></div>';
    html += '<div class="actions">';
    if (pendingConfirm === kind)
      html += '<p class="confirm">Move <em>' + esc(nameOf(item.id)) + '</em> to your memory bank and begin the next one tomorrow?</p>'
            + '<div><button class="btn" data-act="memorized" data-kind="' + kind + '">Yes, memorized</button> '
            + '<button class="btn quiet" data-act="cancel">Not yet</button></div>';
    else html += '<button class="btn" data-act="askmem" data-kind="' + kind + '">I have this memorized</button>';
    return html + '</div>';
  }

  function viewBank(){
    if (bankDetail) {
      const it = byId(bankDetail), b = state.bank[bankDetail];
      if (!it || !b) { bankDetail = null; return viewBank(); }
      return '<a class="back" data-act="bankback">‹ Memory bank</a>' + itemHead(it) + itemBody(it, 'full', false)
        + '<div class="src">Memorized ' + fmtDate(b.memorizedOn) + ' · reviewed ' + (b.reps || 0) + '× · next review ' + fmtDate(b.due) + '</div>'
        + '<div class="actions"><button class="btn quiet" data-act="unbank" data-id="' + esc(bankDetail) + '">Return to the queue to relearn</button></div>';
    }
    const ent = Object.entries(state.bank).filter(([id]) => byId(id));
    if (!ent.length) return '<p class="note">Nothing here yet. When you mark a poem or passage memorized, it comes to rest here.</p>';
    const sec = (kind, label) => {
      const rows = ent.filter(([, b]) => b.kind === kind).sort((a, b) => a[1].memorizedOn < b[1].memorizedOn ? 1 : -1);
      if (!rows.length) return '';
      return '<h2>' + label + ' <span style="float:right">' + rows.length + '</span></h2>' + rows.map(([id, b]) => {
        const it = byId(id);
        return '<div class="row" data-act="bankopen" data-id="' + esc(id) + '"><div><div class="rname">' + esc(it.title || it.ref) + '</div><div class="rsub">'
          + esc(subOf(it)) + '</div></div><div class="rdate">' + fmtDate(b.memorizedOn) + '</div></div>';
      }).join('');
    };
    return '<div class="bank">' + sec('poem', 'Poems') + sec('verse', 'Scripture') + '</div>';
  }

  function viewReview(){
    if (!reviewQ) {
      const due = dueList();
      const total = Object.keys(state.bank).filter(id => byId(id)).length;
      if (!total) return '<p class="note">Your memory bank is empty for now. Review opens once you’ve memorized something.</p>';
      const n = Math.min(due.length, SESSION_CAP);
      return '<div class="card" style="text-align:center"><div class="title" style="font-size:23px">' + (due.length ? due.length + ' due for review' : 'Nothing due today') + '</div>'
        + '<p class="rsub" style="margin:8px 0 18px">Recite each from memory, then reveal the text and grade yourself honestly. '
        + 'The most overdue come first' + (due.length > SESSION_CAP ? '; sessions run ' + SESSION_CAP + ' at a time' : '') + '.</p>'
        + (due.length ? '<button class="btn" data-act="startreview">Review ' + n + '</button>'
                      : '<button class="btn ghost" data-act="startreview" data-early="1">Review the soonest anyway</button>')
        + '</div>';
    }
    if (reviewIdx >= reviewQ.length) {
      const more = dueList().length;
      return '<div class="card" style="text-align:center"><div class="title" style="font-size:23px">Review finished</div>'
        + '<p class="rsub">' + reviewDone + ' reviewed. <em>Gratias.</em>' + (more ? ' ' + more + ' still due.' : '') + '</p>'
        + '<div class="actions" style="margin-top:14px">' + (more ? '<button class="btn" data-act="startreview">Review ' + Math.min(more, SESSION_CAP) + ' more</button>' : '')
        + '<button class="btn ghost" data-act="endreview">Done</button></div></div>';
    }
    const id = reviewQ[reviewIdx], it = byId(id), b = state.bank[id];
    let html = '<div class="progress">' + (reviewIdx + 1) + ' of ' + reviewQ.length + '</div><div class="card">';
    if (it.lines) {
      html += itemHead(it);
      const first = it.lines.find(l => l !== '') || '';
      html += revealed ? itemBody(it, 'full', false) : '<p class="note" style="margin:10px 0">Begins: <em>' + renderUnit(first.replace(/^>+/, ''), 0, null, 'full') + '</em></p>';
    } else {
      html += itemHead(it).replace('class="topic"', 'class="topic" style="margin-bottom:12px"');
      if (revealed) html += itemBody(it, 'full', false);
    }
    html += '</div>';
    if (!revealed) html += '<div class="actions"><button class="btn" data-act="reveal">Reveal</button></div>';
    else html += '<div class="grades">' + [['again', 'Again'], ['hard', 'Hard'], ['good', 'Good'], ['easy', 'Easy']].map(([g, l]) =>
        '<button class="grade ' + g + '" data-act="grade" data-g="' + g + '">' + l + '<small>' + fmtInterval(srsNext(b, g, false).interval) + '</small></button>').join('') + '</div>';
    return html + '<div class="actions"><button class="btn quiet" data-act="endreview">End review</button></div>';
  }

  // ----- queue -----
  function viewQueue(){
    const sec = kind => {
      const label = kind === 'poem' ? 'Poems' : 'Scripture';
      const cur = state[kind].current ? byId(state[kind].current) : null;
      const q = state.queue[kind];
      const memorized = Object.values(state.bank).filter(b => b.kind === kind).length;
      let html = '<div class="qsec"><h2>' + label + ' <small>' + q.length + ' waiting · ' + memorized + ' memorized</small></h2>';
      if (cur) html += '<div class="qrow now"><div class="qtxt"><div class="rname"><span class="tag">Now</span>' + esc(cur.title || cur.ref) + '</div><div class="rsub">'
        + esc(subOf(cur)) + '</div></div>' + (isCustom(cur.id) ? '<button class="ib" data-act="edit" data-id="' + esc(cur.id) + '" aria-label="Edit">✎</button>' : '') + '</div>';
      q.forEach((id, i) => {
        if (i >= Q_SHOW && !qExpanded[kind]) return;
        const it = byId(id); if (!it) return;
        html += '<div class="qrow"><span class="qnum">' + (i + 1) + '</span><div class="qtxt"><div class="rname">' + esc(it.title || it.ref) + '</div><div class="rsub">' + esc(subOf(it)) + '</div></div>'
          + '<button class="ib" data-act="qup" data-kind="' + kind + '" data-i="' + i + '"' + (i ? '' : ' disabled') + ' aria-label="Move up">↑</button>'
          + '<button class="ib" data-act="qdown" data-kind="' + kind + '" data-i="' + i + '"' + (i < q.length - 1 ? '' : ' disabled') + ' aria-label="Move down">↓</button>'
          + '<button class="ib txt" data-act="qnow" data-kind="' + kind + '" data-i="' + i + '" aria-label="Study this now">now</button>'
          + (isCustom(id) ? '<button class="ib" data-act="edit" data-id="' + esc(id) + '" aria-label="Edit">✎</button>' : '')
          + '<button class="ib" data-act="qremove" data-kind="' + kind + '" data-i="' + i + '" aria-label="Remove">✕</button></div>';
      });
      if (!q.length) html += '<p class="muted" style="text-align:center;font-style:italic">Nothing waiting.</p>';
      if (q.length > Q_SHOW) html += '<div class="addrow"><button class="btn quiet" data-act="qexpand" data-kind="' + kind + '">'
        + (qExpanded[kind] ? 'Show fewer' : 'Show all ' + q.length) + '</button></div>';
      html += '<div class="addrow"><a class="btn small ghost" href="#add" data-go="add" data-kind="' + kind + '">+ Add ' + (kind === 'poem' ? 'a poem' : 'a passage') + '</a></div>';
      // built-in items set aside
      const aside = builtin[kind].filter(it => !state.bank[it.id] && it.id !== state[kind].current && !q.includes(it.id));
      if (aside.length) html += '<details class="aside"><summary>Set aside (' + aside.length + ')</summary>' + aside.map(it =>
        '<div class="qrow"><div class="qtxt"><div class="rname">' + esc(it.title || it.ref) + '</div><div class="rsub">' + esc(subOf(it)) + '</div></div>'
        + '<button class="ib txt" data-act="qrestore" data-id="' + esc(it.id) + '">restore</button></div>').join('') + '</details>';
      return html + '</div>';
    };
    return '<p class="muted" style="text-align:center;font-style:italic;margin-top:-6px">When you mark the current item memorized, the next one in line begins the following morning.</p>'
      + sec('poem') + sec('verse');
  }

  // ----- add / edit -----
  const SPACES_PER_INDENT = 4;
  function indentLevel(ws){
    const n = ws.replace(/\t/g, ' '.repeat(SPACES_PER_INDENT)).length;
    return n < 2 ? 0 : Math.min(3, Math.max(1, Math.round(n / SPACES_PER_INDENT)));
  }
  const smallCaps = s => s.replace(/\bLORD\b/g, '⟦Lord⟧').replace(/\bGOD\b/g, '⟦God⟧');
  function parseLines(text){
    const out = []; let blank = false;
    for (const raw of text.replace(/\r/g, '').split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { if (out.length) blank = true; continue; }
      if (blank) { out.push(''); blank = false; }
      const m = line.match(/^[ \t ]*/)[0];
      out.push('>'.repeat(indentLevel(m.replace(/ /g, ' '))) + smallCaps(line.slice(m.length)));
    }
    return out;
  }
  function parseVerses(text, poetry){
    // "[7]" marks the start of verse 7; optional
    const vs = []; let cur = {n: '', lines: []};
    const push = () => { if (cur.lines.length) vs.push(cur); };
    if (poetry) {
      for (const l of parseLines(text)) {
        if (l === '') continue;
        const lv = lvlOf(l), body = l.replace(/^>+/, '');
        const m = body.match(/^\[(\d+[a-z]?)\]\s*/);
        if (m) { push(); cur = {n: m[1], lines: []}; }
        cur.lines.push('>'.repeat(lv) + body.replace(/^\[(\d+[a-z]?)\]\s*/, ''));
      }
    } else {
      const flat = smallCaps(text.replace(/\s+/g, ' ').trim());
      flat.split(/(\[\d+[a-z]?\])/).forEach(part => {
        const m = part.match(/^\[(\d+[a-z]?)\]$/);
        if (m) { push(); cur = {n: m[1], lines: []}; }
        else if (part.trim()) cur.lines.push(part.trim());
      });
      vs.forEach(v => v.lines = [v.lines.join(' ')]);
      if (cur.lines.length) cur.lines = [cur.lines.join(' ')];
    }
    push();
    return vs;
  }
  function textOf(it){
    const unparse = l => l === '' ? '' : ' '.repeat(SPACES_PER_INDENT * lvlOf(l)) + l.replace(/^>+/, '').replace(/⟦(.*?)⟧/g, (m, w) => w.toUpperCase());
    if (it.lines) return it.lines.map(unparse).join('\n');
    const multi = it.verses.length > 1;
    if (it.poetry) return it.verses.map(v => v.lines.map((l, j) => j === 0 && multi
      ? unparse(l).replace(/^(\s*)/, '$1[' + v.n + '] ') : unparse(l)).join('\n')).join('\n');
    return it.verses.map(v => (multi ? '[' + v.n + '] ' : '') + unparse(v.lines.join(' '))).join(' ');
  }
  function newDraft(kind){
    return kind === 'poem'
      ? {kind: 'poem', id: null, title: '', author: '', firstPub: '', source: '', text: '', place: 'end'}
      : {kind: 'verse', id: null, ref: '', translation: 'RSVCE', topic: '', poetry: false, text: '', place: 'end'};
  }
  function draftFrom(it){
    const d = newDraft(it.lines ? 'poem' : 'verse');
    Object.assign(d, {id: it.id, text: textOf(it), place: 'keep'});
    if (d.kind === 'poem') Object.assign(d, {title: it.title || '', author: it.author || '', firstPub: it.firstPub || '', source: it.source || ''});
    else Object.assign(d, {ref: it.ref || '', translation: it.translation || '', topic: it.topic || '', poetry: !!it.poetry});
    return d;
  }
  function itemFromDraft(d){
    if (d.kind === 'poem') {
      return {id: d.id || uid(), kind: 'poem', title: d.title.trim(), author: d.author.trim(), firstPub: d.firstPub.trim() || undefined,
              source: d.source.trim() || undefined, lines: parseLines(d.text)};
    }
    return {id: d.id || uid(), kind: 'verse', ref: d.ref.trim(), translation: d.translation.trim() || undefined, topic: d.topic.trim() || undefined,
            poetry: !!d.poetry, verses: parseVerses(d.text, d.poetry)};
  }
  function validate(d){
    if (d.kind === 'poem' && !d.title.trim()) return 'Give the poem a title.';
    if (d.kind === 'verse' && !d.ref.trim()) return 'Give the passage a reference.';
    if (!d.text.trim()) return 'Paste or type the text.';
    return '';
  }
  function viewAdd(){
    if (!draft) draft = newDraft('poem');
    const d = draft, editing = !!d.id;
    const fld = (name, label, val, extra) => '<div class="fld"><label for="f-' + name + '">' + label + '</label><input class="tx" id="f-' + name + '" name="' + name + '" value="' + esc(val) + '"' + (extra || '') + '></div>';
    let html = '<a class="back" href="#queue" data-go="queue">‹ Queue</a>'
      + '<div class="title" style="font-size:23px">' + (editing ? 'Edit ' : 'Add ') + (d.kind === 'poem' ? 'a poem' : 'a passage') + '</div>';
    if (!editing) html += '<div class="practice" style="margin-top:12px">'
      + '<button class="seg" data-act="dkind" data-kind="poem" aria-pressed="' + (d.kind === 'poem') + '">Poem</button>'
      + '<button class="seg" data-act="dkind" data-kind="verse" aria-pressed="' + (d.kind === 'verse') + '">Scripture</button></div>';
    html += '<form class="entry" id="entry" autocomplete="off">';
    if (d.kind === 'poem') {
      html += fld('title', 'Title', d.title)
        + '<div class="row2">' + fld('author', 'Author', d.author) + fld('firstPub', 'First published', d.firstPub, ' inputmode="numeric" placeholder="e.g. 1818"') + '</div>'
        + fld('source', 'Edition / source <span class="hint">(optional)</span>', d.source)
        + '<div class="fld"><label for="f-text">Text</label><textarea class="tx" id="f-text" name="text" spellcheck="false">' + esc(d.text) + '</textarea>'
        + '<span class="hint">One line per line of verse. Indent with spaces or a tab (4 spaces = one level). Leave a blank line between stanzas.</span></div>';
    } else {
      html += '<div class="row2">' + fld('ref', 'Reference', d.ref, ' placeholder="e.g. Romans 8:28"') + fld('translation', 'Translation', d.translation) + '</div>'
        + fld('topic', 'Topic <span class="hint">(optional)</span>', d.topic)
        + '<div class="fld"><span class="lbl">Layout</span><div class="practice" style="justify-content:flex-start;margin:0">'
        + '<button type="button" class="seg" data-act="dpoetry" data-v="0" aria-pressed="' + !d.poetry + '">Prose</button>'
        + '<button type="button" class="seg" data-act="dpoetry" data-v="1" aria-pressed="' + !!d.poetry + '">Poetry (lines)</button></div></div>'
        + '<div class="fld"><label for="f-text">Text</label><textarea class="tx" id="f-text" name="text" spellcheck="false" style="' + (d.poetry ? '' : 'white-space:pre-wrap;min-height:160px') + '">' + esc(d.text) + '</textarea>'
        + '<span class="hint">Optional verse numbers in brackets — <em>[6] Have no anxiety … [7] And the peace …</em>. '
        + (d.poetry ? 'One line per line; indent with spaces or a tab. ' : '') + 'Type LORD in capitals for small caps.</span></div>';
    }
    if (!editing) html += '<div class="fld"><label for="f-place">Place in queue</label><select class="tx" id="f-place" name="place">'
      + [['end', 'At the end of the queue'], ['next', 'Next in line'], ['now', 'Start it today (current item returns to the front of the queue)']]
        .map(([v, l]) => '<option value="' + v + '"' + (d.place === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>';
    html += (draftErr ? '<p class="err">' + esc(draftErr) + '</p>' : '')
      + '<div class="actions" style="margin-top:6px"><button class="btn" type="submit">' + (editing ? 'Save changes' : 'Add to queue') + '</button>'
      + (editing ? '<button class="btn quiet" type="button" data-act="cancelEdit">Cancel</button>' : '') + '</div></form>'
      + '<div class="preview"><span class="lbl">Preview</span><div id="pv"></div></div>';
    return html;
  }
  function renderPreview(){
    const pv = $('#pv'); if (!pv || !draft) return;
    if (!draft.text.trim()) { pv.innerHTML = '<p class="muted" style="text-align:center;font-style:italic">The text will appear here as it will on your daily page.</p>'; return; }
    const it = itemFromDraft(draft);
    pv.innerHTML = itemHead(it) + itemBody(it, 'full', false);
  }
  function saveDraft(){
    const err = validate(draft);
    if (err) { draftErr = err; render(); return; }
    draftErr = '';
    const it = itemFromDraft(draft), kind = it.kind, editing = !!draft.id;
    const place = draft.place;
    commit(s => {
      const list = s.custom[kind];
      const i = list.findIndex(x => x.id === it.id);
      if (i >= 0) list[i] = it; else list.push(it);
      if (!editing) {
        if (place === 'end') s.queue[kind].push(it.id);
        else if (place === 'next') s.queue[kind].unshift(it.id);
        else { if (s[kind].current) s.queue[kind].unshift(s[kind].current); s[kind] = {current: it.id, startedOn: today()}; }
      }
    });
    toast(editing ? 'Saved.' : '“' + (it.title || it.ref) + '” added' + (place === 'now' ? ' — it’s today’s ' + (kind === 'poem' ? 'poem.' : 'passage.') : ' to the queue.'));
    draft = null; go(place === 'now' && !editing ? kind : 'queue');
  }

  // ----- backup & settings -----
  function backupBlob(){
    return JSON.stringify({app: 'didymus', exported: new Date().toISOString(), state}, null, 1);
  }
  function viewBackup(){
    const n = Object.keys(state.bank).length, c = state.custom.poem.length + state.custom.verse.length;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    return '<div class="bk">'
      + '<h2>Your data</h2><p>Everything — your queue, your own entries, the memory bank and review schedule — is saved in this browser on this device only. '
      + 'Nothing is sent anywhere. Currently: ' + n + ' memorized, ' + c + ' of your own entries.</p>'
      + (storageOK ? '' : '<p class="err">This browser is refusing to save. Export a backup now.</p>')
      + '<p>Last backup: <strong>' + (state.lastBackup ? fmtDate(state.lastBackup) : 'never') + '</strong>. '
      + 'Export now and then — and before switching phones or clearing browser data. Import the file on another device to move everything there.</p>'
      + '<div class="btns"><button class="btn small" data-act="export">Export backup</button>'
      + '<button class="btn small ghost" data-act="copyexport">Copy backup text</button>'
      + '<label class="btn small ghost" style="display:inline-block">Import backup<input type="file" id="importFile" accept="application/json,.json" hidden></label></div>'
      + (importMsg ? '<p class="' + (/^Imported/.test(importMsg) ? 'muted' : 'err') + '" style="text-align:left">' + esc(importMsg) + '</p>' : '')
      + '<h2>Install</h2><p>' + (standalone ? 'Didymus is installed on this device.' :
        'For the best experience, add Didymus to your home screen: on iPhone, tap <em>Share → Add to Home Screen</em> in Safari; on Android, <em>⋮ → Install app</em> in Chrome. '
        + 'Installed, it opens full-screen, works offline, and iOS keeps its data safe from Safari’s automatic clean-up of unused sites.') + '</p>'
      + '<h2>Morning reminder</h2><p>A web page can’t wake your phone on a schedule, but your phone can open it. On iPhone: <em>Shortcuts → Automation → Time of Day</em> (7:00, daily) → '
      + '<em>Open URLs</em> (this page’s address), set to run immediately. On Android, a daily Routine or alarm that opens the link does the same.</p>'
      + '<h2>Start over</h2><p>Erase all progress and your own entries on this device.</p>'
      + (resetArmed ? '<div class="btns"><button class="btn small danger" data-act="resetgo">Yes, erase everything</button><button class="btn small quiet" data-act="resetno">Cancel</button></div>'
                    : '<div class="btns"><button class="btn small danger" data-act="reset">Erase…</button></div>')
      + '<h2>About</h2><p class="legal">Didymus is named for Didymus the Blind (c. 313–398), head of the catechetical school of Alexandria, who is said to have known the whole of Scripture by heart. '
      + 'Poems in the default library are in the public domain; editions are noted with each poem. Default verse list: the Navigators’ Topical Memory System. '
      + 'Scripture quotations are from the Revised Standard Version of the Bible: Catholic Edition, copyright © 1965, 1966 the Division of Christian Education of the National Council '
      + 'of the Churches of Christ in the United States of America. Used by permission. All rights reserved.</p></div>';
  }
  function exportBackup(){
    const blob = new Blob([backupBlob()], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'didymus-backup-' + today() + '.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    commit(s => { s.lastBackup = today(); });
  }
  function importBackup(text){
    let data;
    try { data = JSON.parse(text); } catch (e) { importMsg = 'That file isn’t a Didymus backup (not valid JSON).'; return render(); }
    const s = data && data.app === 'didymus' && data.state ? data.state : (data && data.bank && data.queue ? data : null);
    if (!s || typeof s.bank !== 'object') { importMsg = 'That file isn’t a Didymus backup.'; return render(); }
    commit(cur => { Object.keys(cur).forEach(k => delete cur[k]); Object.assign(cur, clone(s)); }, true);
    importMsg = 'Imported: ' + Object.keys(state.bank).length + ' memorized, ' + (state.custom.poem.length + state.custom.verse.length) + ' of your own entries.';
    practice = state.settings.practice || practice;
    render(); toast('Backup imported.', true);
  }

  // ---------- routing & render ----------
  const VIEWS = ['poem', 'verse', 'bank', 'review', 'queue', 'add', 'backup'];
  function fromHash(){ const h = location.hash.slice(1); return VIEWS.includes(h) ? h : null; }
  view = fromHash() || 'poem';
  addEventListener('hashchange', () => { const h = fromHash(); if (h && h !== view) { leave(); view = h; render(); scrollTo(0, 0); } });
  function leave(){ if (game.on) { game.on = false; game.done = false; kin.blur(); } bankDetail = null; pendingConfirm = null; resetArmed = false; importMsg = ''; }
  function go(v){ leave(); view = v; try { if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v); } catch (e) {} render(); scrollTo(0, 0); }

  function render(){
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === view)));
    document.querySelectorAll('.sublinks a').forEach(a => a.setAttribute('aria-pressed', String(a.dataset.view === view || (view === 'add' && a.dataset.view === 'queue'))));
    const nb = Object.keys(state.bank).filter(id => byId(id)).length, nd = dueList().length;
    $('#bankCount').textContent = nb ? ' (' + nb + ')' : '';
    $('#dueBadge').innerHTML = nd ? '<span class="badge">' + nd + '</span>' : '';
    const stale = nb && (!state.lastBackup || daysBetween(state.lastBackup, today()) > 30);
    $('#backupDot').innerHTML = stale ? '<span class="dot" title="No backup in the last month"></span>' : '';
    const main = $('#main');
    main.innerHTML = view === 'bank' ? viewBank() : view === 'review' ? viewReview() : view === 'queue' ? viewQueue()
      : view === 'add' ? viewAdd() : view === 'backup' ? viewBackup() : viewToday(view);
    if (view === 'add') renderPreview();
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const tab = e.target.closest('.tab'); if (tab) return go(tab.dataset.view);
    const nav = e.target.closest('[data-go]');
    if (nav) { e.preventDefault(); if (nav.dataset.go === 'add') { draft = newDraft(nav.dataset.kind || 'poem'); draftErr = ''; } return go(nav.dataset.go); }
    const sl = e.target.closest('.sublinks a, footer a[data-view]'); if (sl) { e.preventDefault(); return go(sl.dataset.view); }
    const pr = e.target.closest('[data-practice]');
    if (pr) { if (game.on) { game.on = false; kin.blur(); } practice = pr.dataset.practice; state.settings.practice = practice; persist(); return render(); }
    const el = e.target.closest('[data-act]'); if (!el || !el.dataset.act) return;
    const act = el.dataset.act, kind = el.dataset.kind, i = +el.dataset.i;
    switch (act) {
      case 'askmem': pendingConfirm = kind; render(); break;
      case 'cancel': pendingConfirm = null; render(); break;
      case 'memorized': {
        if (game.on) { game.on = false; kin.blur(); }
        pendingConfirm = null;
        const cur = state[kind].current;
        commit(s => {
          s.bank[cur] = {kind, memorizedOn: today(), due: addDays(today(), FIRST_INTERVAL), interval: FIRST_INTERVAL, ease: 2.5, reps: 0, lapses: 0, lastReviewed: today()};
          const nxt = s.queue[kind].shift() || null;
          s[kind] = {current: nxt, startedOn: addDays(today(), 1)};
        }, true);
        toast('“' + nameOf(cur) + '” added to your memory bank.', true);
        break;
      }
      case 'startnow': commit(s => { s[kind].startedOn = today(); }); break;
      case 'play': { const it = byId(el.dataset.id); if (it) startGame(it); break; }
      case 'stop': stopGame(); break;
      case 'refocus': if (game.on && !game.done) focusKeys(); break;
      case 'hidemore': { const it = byId(el.dataset.id); if (it) hideOneMore(it); render(); break; }
      case 'restore': hiddenSet(el.dataset.id).clear(); render(); break;
      case 'bankopen': bankDetail = el.dataset.id; render(); scrollTo(0, 0); break;
      case 'bankback': bankDetail = null; render(); break;
      case 'unbank': {
        const id = el.dataset.id, k = state.bank[id].kind;
        commit(s => { delete s.bank[id]; s.queue[k].unshift(id); }, true);
        bankDetail = null; toast('“' + nameOf(id) + '” is next in your queue.', true); break;
      }
      case 'startreview': {
        let q = dueList().slice(0, SESSION_CAP);
        if (!q.length && el.dataset.early) q = Object.entries(state.bank).filter(([id]) => byId(id)).sort((a, b) => a[1].due < b[1].due ? -1 : 1).slice(0, 5).map(([id]) => id);
        reviewQ = q; reviewIdx = 0; revealed = false; reviewDone = 0; render(); break;
      }
      case 'reveal': revealed = true; render(); break;
      case 'grade': {
        const id = reviewQ[reviewIdx], g = el.dataset.g;
        commit(s => {
          const b = s.bank[id], r = srsNext(b, g, true);
          s.bank[id] = Object.assign({}, b, {interval: r.interval, ease: r.ease, due: addDays(today(), r.interval), reps: (b.reps || 0) + 1,
                        lapses: (b.lapses || 0) + (g === 'again' ? 1 : 0), lastReviewed: today()});
        });
        if (g === 'again') reviewQ.push(id);           // once more before the session ends
        else reviewDone++;
        reviewIdx++; revealed = false; render(); scrollTo(0, 0); break;
      }
      case 'endreview': reviewQ = null; render(); break;
      // queue
      case 'qup': case 'qdown': commit(s => { const q = s.queue[kind], j = act === 'qup' ? i - 1 : i + 1; [q[i], q[j]] = [q[j], q[i]]; }); break;
      case 'qnow': {
        const id = state.queue[kind][i];
        commit(s => { s.queue[kind].splice(i, 1); if (s[kind].current) s.queue[kind].unshift(s[kind].current); s[kind] = {current: id, startedOn: today()}; }, true);
        toast('“' + nameOf(id) + '” is today’s ' + (kind === 'poem' ? 'poem.' : 'passage.'), true); break;
      }
      case 'qremove': {
        const id = state.queue[kind][i], name = nameOf(id);
        commit(s => { s.queue[kind].splice(i, 1); if (isCustom(id)) s.custom[kind] = s.custom[kind].filter(x => x.id !== id); }, true);
        toast('“' + name + '” ' + (isCustom(id) ? 'deleted.' : 'set aside.'), true);
        break;
      }
      case 'qexpand': qExpanded[kind] = !qExpanded[kind]; render(); break;
      case 'qrestore': { const id = el.dataset.id; commit(s => { s.queue[kindOf(id)].push(id); }); break; }
      case 'edit': { const it = byId(el.dataset.id); if (it) { draft = draftFrom(it); draftErr = ''; go('add'); } break; }
      case 'cancelEdit': draft = null; go('queue'); break;
      case 'dkind': { const keep = draft && draft.text; draft = newDraft(kind); if (keep) draft.text = keep; render(); break; }
      case 'dpoetry': draft.poetry = el.dataset.v === '1'; render(); break;
      // backup
      case 'export': exportBackup(); toast('Backup downloaded.'); break;
      case 'copyexport':
        navigator.clipboard.writeText(backupBlob()).then(() => { commit(s => { s.lastBackup = today(); }); toast('Backup copied — paste it somewhere safe.'); },
          () => toast('Couldn’t copy in this browser.'));
        break;
      case 'reset': resetArmed = true; render(); break;
      case 'resetno': resetArmed = false; render(); break;
      case 'resetgo': {
        resetArmed = false;
        commit(s => { const f = reconcile(freshState()); Object.keys(s).forEach(k => delete s[k]); Object.assign(s, f); }, true);
        toast('Erased.', true); go('poem'); break;
      }
    }
  });
  // add/edit form
  document.addEventListener('input', e => {
    if (!draft || !e.target.closest('#entry')) return;
    const n = e.target.name; if (!n) return;
    draft[n] = e.target.value;
    if (draftErr) { draftErr = ''; const er = $('#entry .err'); if (er) er.remove(); }
    renderPreview();
  });
  document.addEventListener('submit', e => { if (e.target.id === 'entry') { e.preventDefault(); saveDraft(); } });
  // a tab in the text box indents instead of leaving the field
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab' && e.target.id === 'f-text') {
      e.preventDefault();
      const ta = e.target, s = ta.selectionStart;
      ta.setRangeText('    ', s, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input', {bubbles: true}));
    }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'importFile' && e.target.files[0]) {
      const r = new FileReader(); r.onload = () => importBackup(String(r.result)); r.readAsText(e.target.files[0]);
    }
  });

  let toastTimer;
  function toast(msg, undoable){
    $('#toastMsg').textContent = msg; $('#toastUndo').style.display = undoable ? '' : 'none';
    $('#toast').style.display = 'flex'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').style.display = 'none'; }, 7000);
  }
  $('#toastUndo').addEventListener('click', () => {
    $('#toast').style.display = 'none';
    if (undoState) { state = reconcile(undoState); undoState = null; persist(); render(); }
  });

  kin.addEventListener('input', () => { const v = kin.value; kin.value = ''; for (const ch of v) gameKey(ch); });
  kin.addEventListener('keydown', e => { if (e.key === 'Escape') stopGame(); });
  document.addEventListener('keydown', e => {
    if (!game.on || e.target === kin || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { stopGame(); return; }
    if (e.key.length === 1 && /\p{L}/u.test(e.key)) { e.preventDefault(); gameKey(e.key); focusKeys(); }
  });

  // a new day may have begun while the app sat open in the background
  let lastDay = today();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && today() !== lastDay) { lastDay = today(); $('#date').textContent = new Date().toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'}); render(); }
  });

  // ---------- start ----------
  load();
  practice = state.settings.practice || 'full';
  render();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
