'use strict';
/* Macro Tracker — vanilla JS PWA. All data lives in localStorage on this device. */
(() => {
const KEY = 'macrotracker.v1';
const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const r0 = n => Math.round(n);
const fmt = n => { const v = Math.round((n + Number.EPSILON) * 10) / 10; return String(v); };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dayKey(d); };
const longDay = k => parseKey(k).toLocaleDateString(undefined, { weekday: 'long' });
const shortDay = k => parseKey(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/* ---------- storage ---------- */
const defaults = () => ({ version: 1, settings: { targets: { cal: 2110, p: 150, c: 220, f: 70 }, calMode: 'auto', theme: 'system', lastExport: null, exercise: { on: true, pct: 100 } }, foods: {}, entries: {}, burned: {} });
let data = load();
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    return normalize(JSON.parse(raw));
  } catch (e) { return defaults(); }
}
function normalize(d) {
  const base = defaults();
  const out = { version: 1, settings: { ...base.settings, ...(d.settings || {}) }, foods: d.foods && typeof d.foods === 'object' ? d.foods : {}, entries: d.entries && typeof d.entries === 'object' ? d.entries : {}, burned: d.burned && typeof d.burned === 'object' ? d.burned : {} };
  out.settings.exercise = { ...base.settings.exercise, ...((d.settings || {}).exercise || {}) };
  out.settings.targets = { ...base.settings.targets, ...((d.settings || {}).targets || {}) };
  return out;
}
let saveFailed = false;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); saveFailed = false; }
  catch (e) { if (!saveFailed) toast('Could not save — storage is full or blocked'); saveFailed = true; }
}
const S = () => data.settings;
const autoCal = t => r0(4 * t.p + 4 * t.c + 9 * t.f);
const targets = () => { const t = S().targets; return { cal: S().calMode === 'auto' ? autoCal(t) : t.cal, p: t.p, c: t.c, f: t.f }; };
/* Exercise calories (active energy from Apple Watch via Shortcut, or typed in). Stored per day in data.burned; replace-not-add. */
const burnedOf = k => { const v = num((data.burned || {})[k]); return v > 0 ? v : 0; };
const exOn = () => !!S().exercise.on;
const exPct = () => clamp(num(S().exercise.pct) || 100, 0, 100);
const bonusOf = k => exOn() ? r0(burnedOf(k) * exPct() / 100) : 0;
const targetsFor = k => { const T = targets(); return { ...T, base: T.cal, bonus: bonusOf(k), cal: T.cal + bonusOf(k) }; };
const dayEntries = k => (data.entries[k] || []).slice().sort((a, b) => a.ts - b.ts);
const totalsOf = list => list.reduce((a, e) => { const s = e.servings; a.cal += e.cal * s; a.p += e.p * s; a.c += e.c * s; a.f += e.f * s; return a; }, { cal: 0, p: 0, c: 0, f: 0 });

/* xAI settings live under their own localStorage key (not inside the main data object). */
const XKEY = 'macrotracker.xai';
const XAI_URL = 'https://api.x.ai/v1';
const XAI_MODELS = [['grok-4.7', 'Grok 4.7 — recommended'], ['grok-4.6', 'Grok 4.6'], ['grok-4.5', 'Grok 4.5'], ['grok-4.3', 'Grok 4.3 (cheaper)']];
const GEM_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEM_MODELS = [['gemini-3.8-flash', 'Gemini 3.8 Flash — recommended'], ['gemini-3.6-flash', 'Gemini 3.6 Flash'], ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite (lightest)']];
const PV = { xai: { name: 'xAI Grok', host: 'api.x.ai' }, gemini: { name: 'Google Gemini', host: 'generativelanguage.googleapis.com' } };
const xai = (() => { const d = { key: '', model: 'grok-4.7', gKey: '', gModel: 'gemini-3.8-flash', provider: '', inBackup: false }; try { return { ...d, ...JSON.parse(localStorage.getItem(XKEY) || '{}') }; } catch (e) { return d; } })();
const aiKey = pv => pv === 'gemini' ? xai.gKey : xai.key;
const aiModel = pv => pv === 'gemini' ? xai.gModel : xai.model;
// Provider in use: the one picked, unless it has no key and the other does. With no explicit pick, Gemini wins only if it's the only key set.
const aiProv = () => { const want = xai.provider === 'gemini' || xai.provider === 'xai' ? xai.provider : (xai.gKey && !xai.key ? 'gemini' : 'xai'); const other = want === 'xai' ? 'gemini' : 'xai'; return !aiKey(want) && aiKey(other) ? other : want; };
const xaiSave = () => { try { localStorage.setItem(XKEY, JSON.stringify(xai)); } catch (e) { toast('Could not save — storage is full or blocked'); } };

/* ---------- state / ui helpers ---------- */
const ui = { addQ: '', tab: 'today', day: dayKey(), lastToday: dayKey(), histRange: 7, histScroll: 0 };
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }

function applyTheme() {
  const th = S().theme;
  if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme;
  $$('meta[name=theme-color]').forEach((m, i) => {
    if (th === 'system') { m.setAttribute('media', i === 0 ? '(prefers-color-scheme: light)' : '(prefers-color-scheme: dark)'); m.content = i === 0 ? '#f2f2f7' : '#000000'; }
    else { m.removeAttribute('media'); m.content = th === 'dark' ? '#000000' : '#f2f2f7'; }
  });
}

/* ---------- svg bits ---------- */
const ICON = {
  chevL: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevR: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  starO: '<svg viewBox="0 0 24 24"><path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  barcode: '<svg class="bcicon" viewBox="0 0 24 24"><path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14" stroke="currentColor" stroke-width="1.6"/></svg>',
};
function ring(size, stroke, consumed, target, color) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r;
  const frac = target > 0 ? clamp(consumed / target, 0, 1) : 0;
  const over = target > 0 && consumed > target + 0.0001;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
  <circle class="bar" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke="${over ? 'var(--over)' : color}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}" style="${frac === 0 ? 'opacity:0' : ''}"/></svg>`;
}

/* ---------- main render ---------- */
function render() {
  const v = $('#view'); const top = v.scrollTop;
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  v.innerHTML = ui.tab === 'today' ? viewToday() : ui.tab === 'history' ? viewHistory() : viewSettings();
  v.scrollTop = top;
  $('.fab')?.remove();
  if (ui.tab === 'today') {
    document.body.insertAdjacentHTML('beforeend', `<button class="fab" id="fab" aria-label="Add food">${ICON.plus}<span>Add Food</span></button>`);
    $('#fab').onclick = () => { ui.addQ = ''; openAdd(); };
  }
  if (ui.tab === 'today') bindToday(); else if (ui.tab === 'history') bindHistory(); else bindSettings();
}
$('#tabbar').addEventListener('click', e => { const b = e.target.closest('.tab'); if (!b) return; if (ui.tab !== b.dataset.tab) { $('#view').scrollTop = 0; ui.tab = b.dataset.tab; } render(); });

/* ---------- TODAY ---------- */
function viewToday() {
  const k = ui.day, today = dayKey(), isToday = k === today;
  const list = dayEntries(k), tot = totalsOf(list), T = targetsFor(k);
  const left = T.cal - tot.cal, overCal = left < 0;
  const dayLabel = isToday ? 'Today' : k === addDays(today, -1) ? 'Yesterday' : longDay(k);
  const lastExport = S().lastExport ? new Date(S().lastExport).getTime() : 0;
  const total = Object.values(data.entries).reduce((n, a) => n + a.length, 0);
  const needBackup = total >= 5 && Date.now() - lastExport > 14 * 864e5 && !sessionStorage.getItem('bk-dismiss');
  const mac = (key, name, color) => {
    const rem = T[key] - tot[key], over = rem < 0;
    return `<div class="macro"><div class="ring">${ring(84, 9, tot[key], T[key], color)}<div class="lbl"><div class="num">${r0(tot[key])}</div><div class="u">of ${T[key]}g</div></div></div>
      <div class="name" style="color:${color}">${name}</div><div class="left ${over ? 'over' : ''}">${over ? fmt(-rem) + 'g over' : fmt(rem) + 'g left'}</div></div>`;
  };
  return `<div class="page">
  ${needBackup ? `<div class="banner"><span>Back up your data — saved on this device only.</span><button id="bk">Export</button></div>` : ''}
  <div class="datenav">
    <button class="chev" id="prev" aria-label="Previous day">${ICON.chevL}</button>
    <div class="mid"><div class="d">${dayLabel}</div><div class="s">${shortDay(k)}</div><input type="date" id="pick" value="${k}" max="${today}" aria-label="Choose date"></div>
    <button class="chev" id="next" aria-label="Next day" ${isToday ? 'disabled' : ''}>${ICON.chevR}</button>
  </div>
  ${isToday ? '' : '<button class="todaylink" id="totoday">Jump to today</button>'}
  <div class="card summary">
    <div class="hero">
      <div class="ring">${ring(150, 15, tot.cal, T.cal, 'var(--cal)')}<div class="lbl"><div class="big" style="${overCal ? 'color:var(--over)' : ''}">${r0(Math.abs(left)).toLocaleString()}</div><div class="small">kcal ${overCal ? 'over' : 'remaining'}</div></div></div>
      <div class="herostats"><div><div class="k">Eaten</div><div class="v">${r0(tot.cal).toLocaleString()}</div></div><div><div class="k">${T.bonus ? 'Adjusted target' : 'Target'}</div><div class="v">${T.cal.toLocaleString()}</div></div></div>
    </div>
    <div class="macros">${mac('p', 'Protein', 'var(--pro)')}${mac('c', 'Carbs', 'var(--carb)')}${mac('f', 'Fat', 'var(--fat)')}</div>
  </div>
  ${exerciseCard(k, T)}
  <div class="section-title">Food log</div>
  <div class="card">${list.length ? `<ul class="list">${list.map(e => {
    const s = e.servings;
    return `<li><button class="row entry" data-id="${e.id}"><div class="grow"><div class="nm">${esc(e.name)}</div>
      <div class="meta">${e.barcode ? ICON.barcode : ''}${fmt(s)} × ${esc(e.serving || 'serving')} · P ${r0(e.p * s)} · C ${r0(e.c * s)} · F ${r0(e.f * s)}</div></div>
      <div class="kcal">${r0(e.cal * s)}<small>kcal</small></div></button></li>`;
  }).join('')}</ul>` : `<div class="empty">Nothing logged ${isToday ? 'yet today' : 'this day'}.<br>Tap <b>Add Food</b> to scan a barcode or enter a meal.</div>`}</div>
  </div>`;
}
function exerciseCard(k, T) {
  const b = burnedOf(k), on = exOn(), pct = exPct();
  if (!on && !b) return `<div class="exlink"><button id="exEdit">Add exercise calories…</button></div>`;
  return `<div class="card ex">
    <div class="exrow"><span>Base target</span><b>${T.base.toLocaleString()}</b></div>
    <div class="exrow"><span>Exercise<small>${b ? (on ? `${pct}% of ${r0(b).toLocaleString()} kcal active energy` : `${r0(b).toLocaleString()} kcal burned — not counted (off in Settings)`) : 'None recorded for this day'}</small></span><b class="${T.bonus ? 'plus' : ''}">${T.bonus ? '+' + T.bonus.toLocaleString() : '0'}</b></div>
    <div class="exrow total"><span>Adjusted target</span><b>${T.cal.toLocaleString()}</b></div>
    <div class="exbtns"><button id="exEdit">${b ? 'Edit burned' : 'Enter burned'}</button><button id="exPaste">Paste from Shortcut</button><button id="exHelp" aria-label="Setup help">Help</button></div>
  </div>`;
}
function bindToday() {
  $('#exEdit')?.addEventListener('click', () => openBurned(ui.day));
  $('#exPaste')?.addEventListener('click', () => openBurned(ui.day, true));
  $('#exHelp')?.addEventListener('click', openHelp);
  $('#prev').onclick = () => { ui.day = addDays(ui.day, -1); render(); };
  $('#next').onclick = () => { ui.day = addDays(ui.day, 1); render(); };
  $('#totoday')?.addEventListener('click', () => { ui.day = dayKey(); render(); });
  $('#pick').onchange = e => { if (e.target.value) { ui.day = e.target.value > dayKey() ? dayKey() : e.target.value; render(); } };
  $('#bk')?.addEventListener('click', () => exportData().then(ok => { if (ok) render(); }));
  $$('.entry').forEach(b => b.onclick = () => openEntry(b.dataset.id));
}

/* ---------- sheets ---------- */
let sheetOpen = false, pendingReload = false;
function sheet({ title, left, right, body, mount }) {
  const root = $('#sheetRoot');
  if (!sheetOpen) {
    root.innerHTML = `<div class="backdrop" id="bd"></div><div class="sheet" id="sh" role="dialog" aria-modal="true"><div class="grabber"></div><div class="sheet-head"></div><div class="sheet-body"></div></div>`;
    $('#bd').onclick = closeSheet;
    sheetOpen = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { $('#bd')?.classList.add('in'); $('#sh')?.classList.add('in'); }));
  }
  const head = $('.sheet-head', root);
  head.innerHTML = `<button class="l" id="shL">${esc(left?.label ?? 'Cancel')}</button><h2>${esc(title)}</h2><button class="r" id="shR" ${right ? '' : 'style="visibility:hidden"'}>${esc(right?.label ?? '')}</button>`;
  $('#shL').onclick = left?.fn || closeSheet;
  if (right) $('#shR').onclick = right.fn;
  const bodyEl = $('.sheet-body', root); bodyEl.innerHTML = body; bodyEl.scrollTop = 0;
  mount?.(bodyEl);
}
function closeSheet() {
  if (!sheetOpen) return; sheetOpen = false;
  const root = $('#sheetRoot'); $('#bd')?.classList.remove('in'); $('#sh')?.classList.remove('in');
  setTimeout(() => { if (!sheetOpen) root.innerHTML = ''; if (pendingReload && !sheetOpen && !scanner.running && !sessionStorage.getItem('sw-reloaded')) { sessionStorage.setItem('sw-reloaded', '1'); location.reload(); } }, 300);
}

/* ---------- ADD sheet (recent / favorites / scan / manual) ---------- */
function foodList(query = '') {
  const q = query.trim().toLowerCase();
  let all = Object.values(data.foods).filter(f => !q || f.name.toLowerCase().includes(q) || (f.brand || '').toLowerCase().includes(q) || (f.barcode || '').includes(q));
  const favs = all.filter(f => f.saved).sort((a, b) => a.name.localeCompare(b.name));
  const recent = all.filter(f => !f.saved).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)).slice(0, 40);
  const row = f => `<li><div class="row"><button class="grow pick" data-id="${f.id}" style="text-align:left;min-width:0"><div class="nm">${f.barcode ? ICON.barcode : ''}${esc(f.name)}</div><div class="meta">${esc(f.brand ? f.brand + ' · ' : '')}${esc(f.serving || 'serving')} · ${r0(f.cal)} kcal · P ${r0(f.p)} C ${r0(f.c)} F ${r0(f.f)}</div></button>
    <button class="star ${f.saved ? 'on' : ''}" data-star="${f.id}" aria-label="Favorite">${f.saved ? ICON.star : ICON.starO}</button><button class="mini quick" data-quick="${f.id}" aria-label="Quick add one serving">+</button></div></li>`;
  const sec = (t, a) => a.length ? `<div class="section-title">${t}</div><div class="card"><ul class="list">${a.map(row).join('')}</ul></div>` : '';
  const out = sec('Favorites', favs) + sec(q ? 'Matches' : 'Recent', recent);
  return out || `<div class="card" style="margin-top:14px"><div class="empty">${q ? 'No saved foods match.' : 'Foods you log will show up here for quick re-adding.'}</div></div>`;
}

/* ---------- food search: bundled USDA database + your own foods (offline) + Open Food Facts (online) ---------- */
const DB = (window.FOOD_DB && window.FOOD_DB.foods) || [];
const stemW = w => w.length > 3 ? (w.endsWith('ies') ? w.slice(0, -3) + 'y' : (w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)) : w;
const SYN = { yoghurt: 'yogurt', catsup: 'ketchup', coke: 'cola', soda: 'cola', pb: 'peanut butter', oj: 'orange juice', bbq: 'barbecue', mac: 'macaroni', fries: 'fry', chips: 'chip', garbanzo: 'chickpea', scallion: 'onion', courgette: 'zucchini', aubergine: 'eggplant', prawn: 'shrimp', beef: 'beef' };
function tokenize(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean).map(w => { const t = stemW(w); return SYN[t] || t; }).join(' ').split(' ').filter(Boolean);
}
function within1(a, b) { // true if edit distance <= 1 (insert/delete/substitute/transpose)
  if (a === b) return true; const la = a.length, lb = b.length; if (Math.abs(la - lb) > 1) return false;
  let i = 0; while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) { if (a.slice(i + 1) === b.slice(i + 1)) return true; return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); }
  return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}
const dbIndex = DB.map(e => ({ e, n: tokenize(e[0]), a: tokenize(e[7]), lower: e[0].toLowerCase() }));
function tokScore(qt, toks) {
  let best = 0;
  for (const t of toks) {
    if (t === qt) return 10;
    if (t.startsWith(qt)) best = Math.max(best, 8);
    else if (qt.length >= 4 && t.length >= 4 && (t.includes(qt))) best = Math.max(best, 4);
    else if (qt.length >= 4 && t.length >= 4 && within1(qt, t)) best = Math.max(best, 5);
    else if (qt.length >= 7 && t.length >= 6 && within1(qt.slice(0, 6), t.slice(0, 6))) best = Math.max(best, 3);
  }
  return best;
}
function scoreItem(qt, n, a, lowerName, qRaw) {
  let total = 0;
  for (const q of qt) {
    let s = tokScore(q, n);
    if (!s) { s = tokScore(q, a) * 0.45; }
    if (!s) return 0;
    total += s;
  }
  if (lowerName.startsWith(qRaw)) total += 6; else if (lowerName.includes(qRaw)) total += 3;
  if (n[0] === qt[0]) total += 2;
  return total - n.length * 0.05;
}
function searchFoods(query) {
  const qt = tokenize(query); const qRaw = query.trim().toLowerCase();
  if (!qt.length) return { mine: [], common: [] };
  const mine = Object.values(data.foods).map(f => ({ f, s: scoreItem(qt, tokenize(f.name + ' ' + (f.brand || '')), [], f.name.toLowerCase(), qRaw) })).filter(x => x.s > 0)
    .sort((a, b) => (b.s - a.s) || ((b.f.saved ? 1 : 0) - (a.f.saved ? 1 : 0)) || ((b.f.lastUsed || 0) - (a.f.lastUsed || 0))).slice(0, 20).map(x => x.f);
  const mineNames = new Set(Object.values(data.foods).map(f => f.name.trim().toLowerCase()));
  const common = dbIndex.filter(x => !mineNames.has(x.lower)).map((x, i) => ({ e: x.e, i, s: scoreItem(qt, x.n, x.a, x.lower, qRaw) })).filter(x => x.s > 0)
    .sort((a, b) => (b.s - a.s) || (a.i - b.i)).slice(0, 40).map(x => x.e);
  return { mine, common };
}
const portLabel = p => /\b(g|ml)\b/i.test(p[0]) ? p[0] : `${p[0]} (${fmt(p[1])} g)`;
function dbFood(e) {
  const [name, cal, p, c, f, ports, fdc] = e; const def = ports[0] || ['100 g', 100]; const g = def[1];
  return { name, per100: { cal, p, c, f }, servingG: g, servingText: def[0], serving: portLabel(def), cal: cal * g / 100, p: p * g / 100, c: c * g / 100, f: f * g / 100, portions: ports, src: 'USDA', fdcId: fdc };
}
const USDA_NOTE = 'USDA FoodData Central (SR Legacy). Pick a portion or enter grams — values are per 100 g.';
function foodRow(f) {
  return `<li><div class="row"><button class="grow pick" data-id="${f.id}" style="text-align:left;min-width:0"><div class="nm">${f.barcode ? ICON.barcode : ''}${esc(f.name)}</div><div class="meta">${esc(f.brand ? f.brand + ' · ' : '')}${esc(f.serving || 'serving')} · ${r0(f.cal)} kcal · P ${r0(f.p)} C ${r0(f.c)} F ${r0(f.f)}</div></button>
    <button class="star ${f.saved ? 'on' : ''}" data-star="${f.id}" aria-label="Favorite">${f.saved ? ICON.star : ICON.starO}</button><button class="mini quick" data-quick="${f.id}" aria-label="Quick add one serving">+</button></div></li>`;
}
function dbRow(e, i) {
  const d = dbFood(e);
  return `<li><div class="row"><button class="grow pickdb" data-db="${i}" style="text-align:left;min-width:0"><div class="nm">${esc(e[0])}</div><div class="meta">${esc(d.serving)} · ${r0(d.cal)} kcal · P ${r0(d.p)} C ${r0(d.c)} F ${r0(d.f)}</div></button>
    <button class="mini quickdb" data-quickdb="${i}" aria-label="Quick add one serving">+</button></div></li>`;
}
function searchResultsHtml(q) {
  const { mine, common } = searchFoods(q);
  const sec = (t, rows) => rows ? `<div class="section-title">${t}</div><div class="card"><ul class="list">${rows}</ul></div>` : '';
  const out = sec('Your foods', mine.map(foodRow).join('')) + sec('Common foods · USDA', common.map(e => dbRow(e, DB.indexOf(e))).join(''));
  const none = !mine.length && !common.length;
  return out + `<div id="more">${moreHtml(q)}</div>` + (none ? `<div class="foot" style="text-align:center;margin-top:10px">No match in your foods or the common-food list. Check the spelling, or try the online results above/below.</div>` : '');
}
/* Open Food Facts text search (online, secondary) */
const off = { cache: new Map(), timer: null, ctl: null, state: 'idle', q: '', items: [] };
function moreHtml(q) {
  if (q.trim().length < 3) return `<div class="foot" style="margin-top:14px">Type 3+ letters to also search Open Food Facts when you’re online.</div>`;
  if (off.state === 'loading' || off.state === 'idle') return `<div class="section-title">More results · Open Food Facts</div><div class="card"><div class="empty" style="padding:18px"><div class="spinner" style="width:22px;height:22px"></div></div></div>`;
  if (off.state === 'offline') return `<div class="foot" style="margin-top:14px">Offline — showing saved and common foods only. More results appear when you’re back online.</div>`;
  if (off.state === 'error') return `<div class="section-title">More results · Open Food Facts</div><div class="card"><div class="empty" style="padding:16px">Open Food Facts isn’t responding right now.<br><button id="offRetry" style="color:var(--accent);font-weight:600;margin-top:6px">Try again</button></div></div>`;
  if (off.state === 'done') {
    if (!off.items.length) return `<div class="foot" style="margin-top:14px">No extra results from Open Food Facts.</div>`;
    return `<div class="section-title">More results · Open Food Facts</div><div class="card"><ul class="list">${off.items.map((x, i) => `<li><button class="row pickoff" data-off="${i}"><div class="grow"><div class="nm">${esc(x.food.name)}</div><div class="meta">${esc(x.food.brand ? x.food.brand + ' · ' : '')}${esc(x.food.serving || '')} · ${r0(x.food.cal)} kcal · P ${r0(x.food.p)} C ${r0(x.food.c)} F ${r0(x.food.f)}</div></div></button></li>`).join('')}</ul></div>`;
  }
  return '';
}
async function offSearch(q, after) {
  const key = q.trim().toLowerCase();
  off.q = key;
  if (off.cache.has(key)) { off.items = off.cache.get(key); off.state = 'done'; after(); return; }
  if (navigator.onLine === false) { off.state = 'offline'; after(); return; }
  off.state = 'loading'; after();
  off.ctl?.abort(); const ctl = off.ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(key)}&search_simple=1&action=process&json=1&page_size=20&sort_by=unique_scans_n&fields=code,product_name,brands,serving_size,serving_quantity,nutriments`;
    let res = null; // Open Food Facts search is sometimes flaky: one quick retry
    for (let attempt = 0; attempt < 2; attempt++) {
      try { res = await fetch(url, { signal: ctl.signal }); if (res.ok) break; } catch (e) { if (ctl.signal.aborted) throw e; }
      res = null; if (attempt === 0) await new Promise(r => setTimeout(r, 1200));
    }
    if (!res) throw new Error('search failed');
    const j = await res.json();
    if (off.q !== key) return;
    const items = [];
    for (const p of (j.products || [])) {
      if (!p.product_name || !p.code) continue;
      let r; try { r = parseOFF(p, String(p.code)); } catch (e) { continue; }
      if (!r || r.nodata) continue;
      items.push({ food: r.food, note: r.note });
      if (items.length >= 12) break;
    }
    off.cache.set(key, items); off.items = items; off.state = 'done';
  } catch (e) {
    if (off.q !== key) return;
    off.state = navigator.onLine === false ? 'offline' : 'error';
  } finally { clearTimeout(timer); }
  if (off.q === key) after();
}

function openAdd() {
  sheet({
    title: `Add to ${ui.day === dayKey() ? 'Today' : shortDay(ui.day)}`, left: { label: 'Close' },
    body: `<div class="btn-row" style="margin-top:6px"><button class="btn" id="scanBtn">📷 Scan Barcode</button><button class="btn gray" id="manBtn">Enter Manually</button></div>
      <button class="btn secondary" id="photoBtn" style="margin-top:10px">✨ Photo — AI estimate</button>
      <input type="file" id="photoIn" accept="image/*" class="hidden"><input type="file" id="photoCam" accept="image/*" capture="environment" class="hidden">
      <div class="card" style="margin-top:12px"><div class="field"><input type="search" id="q" placeholder="Search foods — chicken breast, rice, banana…" style="text-align:left" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search"></div></div>
      <div id="foods">${foodList()}</div>
      <div class="card" style="margin-top:16px"><div class="field"><label for="bcIn">Barcode</label><input type="text" id="bcIn" inputmode="numeric" placeholder="Type UPC / EAN digits" autocomplete="off"><button id="bcGo" class="mini" style="width:auto;padding:0 12px;border-radius:17px;font-size:15px;font-weight:600">Look up</button></div></div>`,
    mount: b => {
      $('#scanBtn', b).onclick = startScan;
      $('#photoBtn', b).onclick = () => $('#photoIn', b).click(); // no `capture`: iOS offers Take Photo / Photo Library / Files
      $('#photoIn', b).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) startPhoto(f); };
      $('#photoCam', b).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) startPhoto(f); };
      $('#manBtn', b).onclick = () => openFood({ mode: 'new', food: { name: '', cal: 0, p: 0, c: 0, f: 0 } });
      const go = () => { const c = $('#bcIn', b).value.trim(); if (!c) return; handleBarcode(c); };
      $('#bcGo', b).onclick = go; $('#bcIn', b).onkeydown = e => { if (e.key === 'Enter') go(); };
      const holder = $('#foods', b), qIn = $('#q', b);
      const bindList = () => {
        $$('.pick', holder).forEach(x => x.onclick = () => openFood({ mode: 'log', food: data.foods[x.dataset.id], back: openAdd }));
        $$('[data-star]', holder).forEach(x => x.onclick = () => { const f = data.foods[x.dataset.star]; f.saved = !f.saved; save(); refresh(false); });
        $$('[data-quick]', holder).forEach(x => x.onclick = () => { const f = data.foods[x.dataset.quick]; logFood(f, 1, ui.day); toast(`Added ${f.name}`); closeSheet(); render(); });
        $$('.pickdb', holder).forEach(x => x.onclick = () => openFood({ mode: 'log', food: dbFood(DB[+x.dataset.db]), note: USDA_NOTE, back: () => { openAdd(); } }));
        $$('.quickdb', holder).forEach(x => x.onclick = () => { const d = dbFood(DB[+x.dataset.quickdb]); logFood(d, 1, ui.day); toast(`Added ${d.name}`); closeSheet(); render(); });
        bindMore();
      };
      const bindMore = () => {
        $$('.pickoff', holder).forEach(x => x.onclick = () => { const it = off.items[+x.dataset.off]; openFood({ mode: 'scan', food: it.food, note: it.note, back: () => openAdd() }); });
        $('#offRetry', holder)?.addEventListener('click', () => { off.cache.delete(off.q); offSearch(qIn.value, updateMore); });
      };
      const updateMore = () => { const m = $('#more', holder); if (m) { m.innerHTML = moreHtml(qIn.value); bindMore(); } };
      const refresh = (fromTyping) => {
        const q = qIn.value, key = q.trim().toLowerCase(); ui.addQ = q;
        let start = false;
        if (fromTyping) {
          clearTimeout(off.timer); off.ctl?.abort(); off.q = key;
          if (key.length < 3) off.state = 'idle';
          else if (off.cache.has(key)) { off.items = off.cache.get(key); off.state = 'done'; }
          else if (navigator.onLine === false) off.state = 'offline';
          else { off.state = 'idle'; start = true; }
        }
        holder.innerHTML = key ? searchResultsHtml(q) : foodList();
        bindList();
        if (start) off.timer = setTimeout(() => offSearch(q, updateMore), 450);
      };
      qIn.oninput = () => refresh(true);
      qIn.onkeydown = e => { if (e.key === 'Enter') qIn.blur(); };
      bindList();
      if (ui.addQ) { qIn.value = ui.addQ; refresh(true); }
    },
  });
}

/* ---------- food / entry form ---------- */
function upsertFood(f, extra = {}) {
  const key = f.barcode ? n => (n.barcode && normCode(n.barcode) === normCode(f.barcode)) : n => !n.barcode && n.name.trim().toLowerCase() === f.name.trim().toLowerCase();
  let ex = f.id && data.foods[f.id] ? data.foods[f.id] : Object.values(data.foods).find(key);
  const id = ex ? ex.id : uid();
  const rec = { ...(ex || {}), id, name: f.name, brand: f.brand || '', serving: f.serving || '', cal: f.cal, p: f.p, c: f.c, f: f.f, per100: f.per100 || null, servingG: f.servingG || null, servingText: f.servingText || '', portions: f.portions || null, src: f.src || '', barcode: f.barcode || '', saved: ex ? ex.saved : false, lastUsed: Date.now(), uses: (ex?.uses || 0), ...extra };
  data.foods[id] = rec;
  const unsaved = Object.values(data.foods).filter(x => !x.saved).sort((a, b) => b.lastUsed - a.lastUsed);
  unsaved.slice(300).forEach(x => { if (!x.barcode) delete data.foods[x.id]; });
  return rec;
}
function logFood(food, servings, day) {
  const rec = upsertFood(food); rec.uses++; rec.lastUsed = Date.now();
  (data.entries[day] = data.entries[day] || []).push({ id: uid(), name: rec.name, serving: rec.serving, servings, cal: rec.cal, p: rec.p, c: rec.c, f: rec.f, barcode: rec.barcode || '', foodId: rec.id, g: rec.servingG || null, ts: Date.now() });
  save();
}

function openEntry(id) {
  const e = (data.entries[ui.day] || []).find(x => x.id === id); if (!e) return;
  const food = data.foods[e.foodId];
  openFood({ mode: 'edit', entry: e, food: { ...(food || {}), id: food?.id, name: e.name, serving: e.serving, cal: e.cal, p: e.p, c: e.c, f: e.f, barcode: e.barcode || food?.barcode || '', ...(e.g && food?.per100 ? { servingG: e.g } : {}) }, servings: e.servings });
}

function openFood({ mode, food, servings = 1, entry, note, noteWarn, back }) {
  const hasGrams = !!(food.per100);
  const ports = hasGrams ? ((food.portions && food.portions.length ? food.portions : (food.servingText && food.servingG ? [[food.servingText, food.servingG]] : [])).slice()) : [];
  if (hasGrams && !ports.some(p => p[1] === 100)) ports.push(['100 g', 100]);
  const hasPorts = hasGrams && ports.length > 1;
  const gramsStart = hasGrams ? (food.servingG || 100) : 0;
  const portOpts = ports.map((p, i) => `<option value="${i}" ${p[1] === gramsStart ? 'selected' : ''}>${esc(p[0])}${/\b(g|ml)\b/i.test(p[0]) ? '' : ' (' + fmt(p[1]) + ' g)'}</option>`).join('') + `<option value="custom" ${ports.some(p => p[1] === gramsStart) ? '' : 'selected'}>Custom grams</option>`;
  const f = { ...food };
  let calTouched = mode !== 'new' || num(food.cal) > 0;
  const grams0 = hasGrams ? (food.servingG || 100) : 0;
  const title = mode === 'edit' ? 'Edit Entry' : mode === 'scan' ? 'Scanned Food' : mode === 'log' ? 'Log Food' : 'New Food';
  const dayName = ui.day === dayKey() ? 'Today' : shortDay(ui.day);
  const saveLabel = mode === 'edit' ? 'Save' : 'Add';
  const noteHtml = note ? `<div class="note ${noteWarn ? 'warn' : ''}" style="margin-top:6px">${esc(note)}</div>` : '';
  const row = (id, label, val, dot, unit) => `<div class="field"><label for="${id}">${dot ? `<span class="dot" style="background:${dot}"></span>` : ''}${label}</label><input type="text" inputmode="decimal" id="${id}" value="${esc(val)}" autocomplete="off"><span class="unit">${unit}</span></div>`;
  sheet({
    title, left: back ? { label: 'Back', fn: back } : { label: 'Cancel' }, right: { label: saveLabel, fn: submit },
    body: `<div class="stack" style="margin-top:6px">${noteHtml}
      <div class="card">
        <div class="field"><label for="fName">Name</label><input type="text" id="fName" value="${esc(f.name)}" placeholder="e.g. Chicken bowl" autocomplete="off" autocapitalize="words"></div>
        <div class="field"><label for="fBc">Barcode</label><input type="text" inputmode="numeric" id="fBc" value="${esc(f.barcode || '')}" placeholder="Optional — remembers this food" autocomplete="off"></div>
        <div class="field"><label for="fSrv">Servings</label><div class="stepper"><button type="button" id="sMinus" aria-label="Fewer">−</button><input type="text" inputmode="decimal" id="fSrv" value="${fmt(servings)}"><button type="button" id="sPlus" aria-label="More">+</button></div></div>
        ${hasPorts ? `<div class="field"><label for="fPort">Portion</label><select id="fPort">${portOpts}</select></div>` : ''}${hasGrams ? row('fG', 'Serving size', fmt(grams0), '', 'g') : `<div class="field"><label for="fSrvL">Serving</label><input type="text" id="fSrvL" value="${esc(f.serving || '')}" placeholder="e.g. 1 cup" autocomplete="off"></div>`}
      </div>
      <div class="section-title" style="margin:6px 16px 0">Macros per serving</div>
      <div class="card">
        ${row('fCal', 'Calories', r0(num(f.cal)), 'var(--cal)', 'kcal')}${row('fP', 'Protein', fmt(num(f.p)), 'var(--pro)', 'g')}${row('fC', 'Carbs', fmt(num(f.c)), 'var(--carb)', 'g')}${row('fF', 'Fat', fmt(num(f.f)), 'var(--fat)', 'g')}
      </div>
      ${hasGrams ? `<div class="foot" style="margin-top:-4px">Per 100 g: ${r0(f.per100.cal)} kcal · P ${fmt(f.per100.p)} · C ${fmt(f.per100.c)} · F ${fmt(f.per100.f)}. Change the serving size and macros update.</div>` : ''}
      <div class="card"><div class="preview" id="pv"></div></div>
      <div class="card"><div class="field"><label for="fFav">Keep in Favorites</label><span class="switch"><input type="checkbox" id="fFav" ${(f.saved || (f.id && data.foods[f.id]?.saved)) ? 'checked' : ''}></span></div></div>
      ${mode === 'edit' ? '<button class="btn danger" id="del">Delete Entry</button>' : ''}
      ${mode !== 'edit' ? `<p class="foot" style="text-align:center">Will be logged to ${esc(dayName)}</p>` : ''}
    </div>`,
    mount: b => {
      const g = id => $('#' + id, b);
      const updatePv = () => {
        const s = num(g('fSrv').value);
        g('pv').innerHTML = [['kcal', s * num(g('fCal').value), 0], ['Protein', s * num(g('fP').value), 1], ['Carbs', s * num(g('fC').value), 1], ['Fat', s * num(g('fF').value), 1]]
          .map(([l, v, d]) => `<div><div class="n">${d ? fmt(v) + 'g' : r0(v)}</div><div class="l">${l}</div></div>`).join('');
      };
      const autoCalc = () => { if (!calTouched) g('fCal').value = r0(4 * num(g('fP').value) + 4 * num(g('fC').value) + 9 * num(g('fF').value)); };
      ['fP', 'fC', 'fF'].forEach(id => g(id).addEventListener('input', () => { autoCalc(); updatePv(); }));
      g('fCal').addEventListener('input', () => { calTouched = true; updatePv(); });
      g('fSrv').addEventListener('input', updatePv);
      const step = d => { g('fSrv').value = fmt(Math.max(0, Math.round((num(g('fSrv').value) + d) * 100) / 100)); updatePv(); };
      g('sMinus').onclick = () => step(-0.5); g('sPlus').onclick = () => step(0.5);
      const syncPort = gm => { const sel = g('fPort'); if (!sel) return; const i = ports.findIndex(p => p[1] === gm); sel.value = i >= 0 ? String(i) : 'custom'; };
      if (hasPorts) g('fPort').addEventListener('change', e => { if (e.target.value === 'custom') { g('fG').focus(); g('fG').select(); return; } g('fG').value = fmt(ports[+e.target.value][1]); g('fG').dispatchEvent(new Event('input')); });
      if (hasGrams) g('fG').addEventListener('input', () => {
        const gm = num(g('fG').value), p = f.per100; syncPort(gm);
        g('fCal').value = r0(p.cal * gm / 100); g('fP').value = fmt(p.p * gm / 100); g('fC').value = fmt(p.c * gm / 100); g('fF').value = fmt(p.f * gm / 100); calTouched = true; updatePv();
      });
      updatePv();
      if (mode === 'edit') g('del').onclick = () => {
        if (!confirm('Delete this entry?')) return;
        data.entries[ui.day] = (data.entries[ui.day] || []).filter(x => x.id !== entry.id);
        if (!data.entries[ui.day].length) delete data.entries[ui.day];
        save(); closeSheet(); render();
      };
      if (mode === 'log') setTimeout(() => { try { g('fSrv').focus(); g('fSrv').select(); } catch (e) { } }, 350);
      else if (mode === 'new') setTimeout(() => { try { g('fName').focus(); } catch (e) { } }, 350);
    },
  });
  function submit() {
    const b = $('#sheetRoot'); const g = id => $('#' + id, b);
    const name = g('fName').value.trim() || 'Quick add';
    const s = num(g('fSrv').value);
    if (s <= 0) { toast('Servings must be more than 0'); return; }
    let serving;
    if (hasGrams) {
      const gm = num(g('fG').value); const hit = ports.find(p => p[1] === gm && p[0] !== '100 g');
      serving = !gm ? 'serving' : hit ? (/\b(g|ml)\b/i.test(hit[0]) ? hit[0] : `${hit[0]} (${fmt(gm)} g)`) : fmt(gm) + ' g';
    }
    else serving = g('fSrvL').value.trim();
    const rec = {
      id: food.id, name, brand: food.brand || '', serving, cal: r0(num(g('fCal').value)), p: num(g('fP').value), c: num(g('fC').value), f: num(g('fF').value),
      barcode: (g('fBc').value || '').replace(/\D/g, ''), per100: hasGrams ? f.per100 : null, servingG: hasGrams ? num(g('fG').value) || null : null,
      servingText: food.servingText || '', portions: food.portions || null, src: food.src || '',
    };
    const fav = g('fFav').checked;
    if (mode === 'edit') {
      Object.assign(entry, { name, serving, servings: s, cal: rec.cal, p: rec.p, c: rec.c, f: rec.f, barcode: rec.barcode });
      if (fav || data.foods[entry.foodId]?.saved) { const fr = upsertFood({ ...rec, id: entry.foodId }, { saved: fav }); entry.foodId = fr.id; }
      save(); toast('Saved');
    } else {
      logFood(rec, s, ui.day);
      if (fav) { const fr = upsertFood(rec, { saved: true }); }
      save(); toast(`Added ${name}`);
    }
    closeSheet(); render();
  }
}

/* ---------- barcode: normalise, lookup (local first, then Open Food Facts) ---------- */
const normCode = c => String(c).replace(/\D/g, '').replace(/^0+/, '');
function gtinOk(c) {
  if (![8, 12, 13, 14].includes(c.length)) return false;
  const d = c.split('').map(Number); const chk = d.pop(); let sum = 0;
  d.reverse().forEach((x, i) => sum += x * (i % 2 === 0 ? 3 : 1));
  return (10 - (sum % 10)) % 10 === chk;
}
function upceToUpca(c) { // 8-digit UPC-E -> 12-digit UPC-A
  const [ns, a, b, cc, d, e, f, chk] = c.split('');
  let body;
  if ('012'.includes(f)) body = ns + a + b + f + '0000' + cc + d + e;
  else if (f === '3') body = ns + a + b + cc + '00000' + d + e;
  else if (f === '4') body = ns + a + b + cc + d + '00000' + e;
  else body = ns + a + b + cc + d + e + '0000' + f;
  return body + chk;
}
function localByBarcode(code) { const n = normCode(code); return Object.values(data.foods).find(f => f.barcode && normCode(f.barcode) === n); }

function parseOFF(p, code) {
  const n = p.nutriments || {};
  const g = k => (n[k] === undefined || n[k] === null || n[k] === '' || !Number.isFinite(Number(n[k]))) ? null : Number(n[k]);
  const kcal = suffix => { const v = g('energy-kcal_' + suffix); if (v != null) return v; const kj = g('energy_' + suffix); return kj != null ? kj / 4.184 : null; };
  const vals = suffix => ({ cal: kcal(suffix), p: g('proteins_' + suffix), c: g('carbohydrates_' + suffix), f: g('fat_' + suffix) });
  const usable = v => v.cal != null || (v.p != null && v.c != null && v.f != null);
  const fill = v => { const o = { p: v.p ?? 0, c: v.c ?? 0, f: v.f ?? 0 }; o.cal = v.cal ?? (4 * o.p + 4 * o.c + 9 * o.f); return o; };
  const v100 = vals('100g'), vSrv = vals('serving');
  const per100 = usable(v100) ? fill(v100) : null;
  const perSrv = usable(vSrv) ? fill(vSrv) : null;
  const servingText = (p.serving_size || '').trim();
  let servingG = Number(p.serving_quantity) || null;
  if (!servingG && servingText) { const m = servingText.match(/(\d+(?:[.,]\d+)?)\s*(?:g|ml|gr)\b/i); if (m) servingG = parseFloat(m[1].replace(',', '.')); }
  const name = (p.product_name || p.generic_name || '').trim() || 'Unknown product';
  const brand = (p.brands || '').split(',')[0].trim();
  if (!per100 && !perSrv) return { nodata: true, food: { name, brand, barcode: code, cal: 0, p: 0, c: 0, f: 0 } };
  const food = { name, brand, barcode: code };
  let note;
  if (per100) {
    food.per100 = per100; food.servingText = servingText;
    if (servingG) {
      food.servingG = servingG;
      const m = perSrv || { cal: per100.cal * servingG / 100, p: per100.p * servingG / 100, c: per100.c * servingG / 100, f: per100.f * servingG / 100 };
      Object.assign(food, { cal: m.cal, p: m.p, c: m.c, f: m.f, serving: servingText || fmt(servingG) + ' g' });
      note = `Open Food Facts · per serving (${servingText || fmt(servingG) + ' g'}). Adjust the serving size or servings if you ate a different amount.`;
    } else {
      food.servingG = 100;
      Object.assign(food, { cal: per100.cal, p: per100.p, c: per100.c, f: per100.f, serving: '100 g' });
      note = 'Open Food Facts only lists values per 100 g. Set the serving size in grams to what you ate.';
    }
  } else {
    Object.assign(food, perSrv, { serving: servingText || 'serving' });
    note = `Open Food Facts · per serving (${servingText || 'serving'}).`;
  }
  return { food, note };
}
async function fetchOff(code) {
  const tryCode = async c => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch(`${OFF_URL}${encodeURIComponent(c)}.json?fields=code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments`, { signal: ctl.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('http ' + res.status);
      const j = await res.json();
      return j && j.status === 1 && j.product ? j.product : null;
    } finally { clearTimeout(t); }
  };
  let p = await tryCode(code);
  if (!p && code.length === 12) p = await tryCode('0' + code);
  if (!p && code.length === 13 && code[0] === '0') p = await tryCode(code.slice(1));
  return p ? parseOFF(p, code) : null;
}
async function handleBarcode(raw) {
  const code = String(raw).replace(/\D/g, '');
  if (code.length < 8 || code.length > 14) { toast('Enter 8–14 digits from the barcode'); return; }
  const local = localByBarcode(code);
  if (local) { openFood({ mode: 'log', food: local, note: 'Remembered from a food you logged before.' }); return; }
  const cancel = { label: 'Cancel', fn: () => { token++; closeSheet(); } };
  let mine = ++token;
  sheet({ title: 'Looking up…', left: cancel, body: `<div style="padding:50px 0"><div class="spinner"></div><p class="sub" style="text-align:center;margin-top:16px">Checking Open Food Facts for ${esc(code)}</p></div>` });
  const manual = (extra = {}) => openFood({ mode: 'new', food: { name: '', barcode: code, cal: 0, p: 0, c: 0, f: 0, ...extra }, note: extra.note, noteWarn: !!extra.noteWarn });
  const fail = (title, msg, canRetry) => sheet({
    title, left: cancel,
    body: `<div class="stack" style="margin-top:14px"><div class="note ${canRetry ? 'warn' : ''}">${esc(msg)}</div><div class="note">Barcode <b>${esc(code)}</b>. Enter the macros yourself and this food will be remembered for next time you scan it.</div>
      <button class="btn" id="mn">Enter Manually</button>${canRetry ? '<button class="btn gray" id="rt">Try Again</button>' : ''}<button class="btn gray" id="sc2">Scan Another</button></div>`,
    mount: b => { $('#mn', b).onclick = () => manual(); $('#rt', b)?.addEventListener('click', () => handleBarcode(code)); $('#sc2', b).onclick = startScan; },
  });
  try {
    const r = await fetchOff(code);
    if (mine !== token) return;
    if (!r) return fail('Not Found', 'This product isn’t in Open Food Facts yet.', false);
    if (r.nodata) return manual({ name: r.food.name, brand: r.food.brand, note: `Found “${r.food.name}” on Open Food Facts, but it has no nutrition info. Enter the macros from the label.`, noteWarn: true });
    openFood({ mode: 'scan', food: r.food, note: r.note, back: () => openAdd() });
  } catch (e) {
    if (mine !== token) return;
    fail('Can’t Reach Open Food Facts', navigator.onLine === false ? 'You appear to be offline. Previously scanned foods still work offline.' : 'The lookup timed out or failed. Check your connection and try again.', true);
  }
}
let token = 0;

/* ---------- barcode: camera scanner ---------- */
const scanner = { stream: null, timer: null, running: false, reader: null, detector: null };
function stopScan() {
  scanner.running = false; clearTimeout(scanner.timer);
  scanner.stream?.getTracks().forEach(t => t.stop()); scanner.stream = null;
  const v = $('#scanRoot video'); if (v) { v.srcObject = null; }
  $('#scanRoot').innerHTML = '';
}
function loadZXing() {
  if (window.ZXing) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/zxing.min.js'; s.onload = res; s.onerror = () => rej(new Error('zxing')); document.head.appendChild(s); });
}
async function makeDecoder() {
  if ('BarcodeDetector' in window) {
    try {
      const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
      const sup = await BarcodeDetector.getSupportedFormats();
      const formats = want.filter(f => sup.includes(f));
      if (formats.length) { const d = new BarcodeDetector({ formats }); return { kind: 'native', decode: async v => { const r = await d.detect(v); return r.length ? { text: r[0].rawValue, fmt: r[0].format } : null; } }; }
    } catch (e) { /* fall through to ZXing */ }
  }
  await loadZXing();
  const Z = window.ZXing;
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader(); reader.setHints(hints);
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return { kind: 'zxing', decode: async v => {
    const vw = v.videoWidth, vh = v.videoHeight; if (!vw) return null;
    const sc = Math.min(1, 960 / vw); canvas.width = Math.round(vw * sc); canvas.height = Math.round(vh * sc);
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    try {
      const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      const r = reader.decode(bmp);
      return { text: r.getText(), fmt: r.getBarcodeFormat() === Z.BarcodeFormat.UPC_E ? 'upc_e' : 'x' };
    } catch (e) { return null; }
  } };
}
async function startScan() {
  closeSheet(); token++;
  const root = $('#scanRoot');
  root.innerHTML = `<div class="scan"><video playsinline muted autoplay></video>
    <div class="top"><span style="font-weight:600;text-shadow:0 1px 3px #000a">Scan barcode</span><button id="scClose">Cancel</button></div>
    <div class="reticle"><div class="frame"></div></div>
    <div class="bottom"><div class="msg" id="scMsg">Starting camera…</div>
      <div class="manual"><input type="text" id="scIn" inputmode="numeric" placeholder="Or type the barcode number" autocomplete="off"><button id="scGo">Look up</button></div></div></div>`;
  const msg = t => { const m = $('#scMsg'); if (m) m.textContent = t; };
  const leave = (after) => { stopScan(); after?.(); };
  $('#scClose').onclick = () => leave(openAdd);
  const go = () => { const c = $('#scIn').value.trim(); if (!c) return; leave(() => handleBarcode(c)); };
  $('#scGo').onclick = go; $('#scIn').onkeydown = e => { if (e.key === 'Enter') go(); };
  if (!navigator.mediaDevices?.getUserMedia) { msg(window.isSecureContext ? 'Camera isn’t available here — type the barcode below.' : 'Camera needs a secure (https) page — type the barcode below.'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
  catch (e) {
    msg(e.name === 'NotAllowedError' ? 'Camera access was denied. Allow it in Settings › Safari (or the app), or type the barcode below.' : 'Couldn’t start the camera — type the barcode below.');
    return;
  }
  if (!$('#scanRoot video')) { stream.getTracks().forEach(t => t.stop()); return; } // cancelled meanwhile
  scanner.stream = stream; scanner.running = true;
  const video = $('#scanRoot video'); video.srcObject = stream; video.setAttribute('playsinline', ''); video.muted = true;
  try { await video.play(); } catch (e) { }
  try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { }
  let dec;
  try { dec = await makeDecoder(); } catch (e) { msg('Scanner failed to load — type the barcode below.'); return; }
  msg('Point at a barcode — hold steady');
  const seen = {};
  const tick = async () => {
    if (!scanner.running) return;
    let hit = null;
    try { if (video.readyState >= 2) hit = await dec.decode(video); } catch (e) { }
    if (hit && /^\d{8,14}$/.test(hit.text)) {
      let code = hit.text;
      if (hit.fmt === 'upc_e' && code.length === 8) code = upceToUpca(code);
      if (gtinOk(code) || gtinOk(hit.text)) {
        seen[code] = (seen[code] || 0) + 1;
        if (seen[code] >= 1) { navigator.vibrate?.(60); leave(() => handleBarcode(code)); return; }
      }
    }
    scanner.timer = setTimeout(tick, 130);
  };
  tick();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && scanner.running) { stopScan(); openAdd(); }
  if (!document.hidden && dayKey() !== ui.lastToday) { if (ui.day === ui.lastToday) ui.day = dayKey(); ui.lastToday = dayKey(); if (!sheetOpen) render(); }
});

/* ---------- HISTORY ---------- */
function viewHistory() {
  const n = ui.histRange, today = dayKey(), T = targets();
  const TF = k => targetsFor(k).cal;
  const days = Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
  const rows = days.map(k => ({ k, e: dayEntries(k), tc: TF(k), bonus: bonusOf(k) })).map(r => ({ ...r, t: totalsOf(r.e) }));
  const anyBonus = rows.some(r => r.bonus > 0);
  const logged = rows.filter(r => r.e.length);
  const avg = key => logged.length ? logged.reduce((a, r) => a + r.t[key], 0) / logged.length : 0;
  const maxV = Math.max(...rows.map(r => r.tc * 1.15), ...rows.map(r => r.t.cal), 1);
  const goalPct = T.cal / maxV * 100;
  const avgT = logged.length ? r0(logged.reduce((a, r) => a + r.tc, 0) / logged.length) : T.cal;
  const labelEvery = n === 7 ? 1 : 5;
  return `<div class="page"><h1 class="title">History</h1>
  <div class="seg" id="range" style="margin-bottom:14px"><button data-r="7" class="${n === 7 ? 'on' : ''}">7 Days</button><button data-r="30" class="${n === 30 ? 'on' : ''}">30 Days</button></div>
  <div class="card"><div class="avgs">
    <div><div class="n">${r0(avg('cal'))}</div><div class="l">kcal</div><div class="t">${logged.length ? `of ${avgT}` : '—'}</div></div>
    <div><div class="n" style="color:var(--pro)">${r0(avg('p'))}g</div><div class="l">Protein</div><div class="t">of ${T.p}g</div></div>
    <div><div class="n" style="color:var(--carb)">${r0(avg('c'))}g</div><div class="l">Carbs</div><div class="t">of ${T.c}g</div></div>
    <div><div class="n" style="color:var(--fat)">${r0(avg('f'))}g</div><div class="l">Fat</div><div class="t">of ${T.f}g</div></div></div>
    <div class="foot" style="margin:-4px 16px 12px;text-align:center">Daily average across ${logged.length} logged day${logged.length === 1 ? '' : 's'} of ${n}</div></div>
  <div class="section-title">Calories per day</div>
  <div class="card chart"><div class="bars">
    ${rows.map(r => `<button class="b" data-day="${r.k}" aria-label="${shortDay(r.k)}: ${r0(r.t.cal)} kcal"><i class="${!r.e.length ? 'none' : r.t.cal > r.tc ? 'over' : ''}" style="height:${(r.t.cal / maxV * 100).toFixed(1)}%"></i>${anyBonus ? `<u class="gt" style="bottom:${(r.tc / maxV * 100).toFixed(1)}%"></u>` : ''}</button>`).join('')}
    ${anyBonus ? '' : `<div class="goal" style="bottom:${goalPct}%"><span>${T.cal}</span></div>`}</div>
    <div class="xlabels">${rows.map((r, i) => `<span>${(rows.length - 1 - i) % labelEvery === 0 ? (n === 7 ? parseKey(r.k).toLocaleDateString(undefined, { weekday: 'narrow' }) : parseKey(r.k).getDate()) : ''}</span>`).join('')}</div></div>
  ${anyBonus ? '<div class="foot" style="margin:6px 16px 0">Dashes mark each day’s adjusted target (base + exercise).</div>' : ''}
  <div class="section-title">Days</div>
  <div class="card"><ul class="list">${rows.slice().reverse().map(r => `<li><button class="row" data-day="${r.k}"><div class="grow"><div class="nm">${r.k === today ? 'Today' : shortDay(r.k)} <span class="sub">${r.k === today ? '' : longDay(r.k)}</span></div>
    <div class="meta">${r.e.length ? `P ${r0(r.t.p)} · C ${r0(r.t.c)} · F ${r0(r.t.f)}` : 'Nothing logged'}${r.bonus ? ` · target ${r.tc} (+${r.bonus} ex.)` : ''}</div></div>
    <div class="kcal" style="${r.t.cal > r.tc ? 'color:var(--over)' : ''}">${r.e.length ? r0(r.t.cal) : '—'}<small>${r.e.length ? 'kcal' : ''}</small></div></button></li>`).join('')}</ul></div></div>`;
}
function bindHistory() {
  $$('#range button').forEach(b => b.onclick = () => { ui.histRange = +b.dataset.r; render(); });
  $$('[data-day]').forEach(b => b.onclick = () => { ui.day = b.dataset.day; ui.tab = 'today'; $('#view').scrollTop = 0; render(); });
}

/* ---------- SETTINGS ---------- */
function pvNote() {
  const v = aiProv(), picked = xai.provider === 'gemini' || xai.provider === 'xai' ? xai.provider : null;
  if (!aiKey('xai') && !aiKey('gemini')) return 'No key yet — add one below to use the Photo button.';
  return `Photo estimates use <b>${PV[v].name}</b>${picked && picked !== v ? ` (${PV[picked].name} has no key yet)` : !picked && v === 'gemini' ? ' (the only key you’ve added)' : ''}.`;
}
function provBlock(v) {
  const g = v === 'gemini', list = g ? GEM_MODELS : XAI_MODELS, cur = aiModel(v), key = aiKey(v);
  return `<div class="section-title" style="margin-top:14px">${PV[v].name}${g ? ' <span style="text-transform:none;letter-spacing:0">— free tier available</span>' : ''}</div>
  <div class="card"><div class="field"><label for="${v}Key">API key</label><input type="password" id="${v}Key" value="${esc(key)}" placeholder="${g ? 'AIza…' : 'xai-…'}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
    <div class="field"><label for="${v}Model">Model</label><select id="${v}Model">${list.map(([m, l]) => `<option value="${m}" ${cur === m ? 'selected' : ''}>${l}</option>`).join('')}${list.some(m => m[0] === cur) ? '' : `<option selected value="${esc(cur)}">${esc(cur)}</option>`}</select></div></div>
  <div class="btn-row" style="margin-top:8px"><button class="btn secondary" id="${v}Test">Test key</button><button class="btn danger" id="${v}Clear">Clear key</button></div>
  <div class="foot" id="${v}Status">${key ? 'Key saved on this device only.' : 'No key yet.'}</div>`;
}
function viewSettings() {
  const t = S().targets, auto = S().calMode === 'auto';
  const total = Object.values(data.entries).reduce((n, a) => n + a.length, 0);
  const le = S().lastExport ? new Date(S().lastExport).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';
  const row = (id, label, val, dot, unit, ro) => `<div class="field"><label for="${id}"><span class="dot" style="background:${dot}"></span>${label}</label><input type="text" inputmode="decimal" id="${id}" value="${esc(val)}" ${ro ? 'readonly' : ''} autocomplete="off"><span class="unit">${unit}</span></div>`;
  return `<div class="page"><h1 class="title">Settings</h1>
  <div class="section-title">Daily targets</div>
  <div class="card">${row('tP', 'Protein', t.p, 'var(--pro)', 'g')}${row('tC', 'Carbs', t.c, 'var(--carb)', 'g')}${row('tF', 'Fat', t.f, 'var(--fat)', 'g')}
    ${row('tCal', 'Calories', auto ? autoCal(t) : t.cal, 'var(--cal)', 'kcal', auto)}</div>
  <div class="card" style="margin-top:12px"><div class="field" style="padding:8px 16px"><div class="seg" id="calMode" style="flex:1"><button data-m="auto" class="${auto ? 'on' : ''}">Auto (4/4/9)</button><button data-m="manual" class="${auto ? '' : 'on'}">Enter manually</button></div></div></div>
  <div class="foot">${auto ? 'Calories = 4 × protein + 4 × carbs + 9 × fat.' : 'Calories are set independently of your macro grams.'}</div>
  <div class="section-title">Exercise calories</div>
  <div class="card"><div class="field"><label for="exOn">Add exercise calories to target</label><span class="switch"><input type="checkbox" id="exOn" ${exOn() ? 'checked' : ''}></span></div>
    <div class="field"><span>Active energy only</span><span class="unit">Resting excluded</span></div>
    <div class="field" style="padding:8px 16px"><span style="flex:none">Count</span><div class="seg" id="exPct" style="flex:1;margin-left:12px">${[50, 75, 100].map(x => `<button data-p="${x}" class="${exPct() === x ? 'on' : ''}">${x}%</button>`).join('')}</div></div></div>
  <div class="foot">Your daily target goes up by this share of the active calories burned that day. Watch estimates tend to run high, so 50–75% is a common, safer choice. Resting energy is never added — your base target already covers it.</div>
  <div class="stack" style="margin-top:12px"><button class="btn secondary" id="exHelpS">Apple Watch / Shortcut setup…</button></div>
  <div class="section-title">AI photo estimates</div>
  <div class="card"><div class="field" style="padding:8px 16px"><div class="seg" id="aiProv" style="flex:1">${['xai', 'gemini'].map(v => `<button data-pv="${v}" class="${aiProv() === v ? 'on' : ''}">${PV[v].name}</button>`).join('')}</div></div></div>
  <div class="foot" id="pvNote">${pvNote()}</div>
  ${provBlock('xai')}${provBlock('gemini')}
  <div class="card" style="margin-top:12px"><div class="field"><label for="xBk">Include keys in backup file</label><span class="switch"><input type="checkbox" id="xBk" ${xai.inBackup ? 'checked' : ''}></span></div></div>
  <div class="foot">Keys are stored only in this app’s on-device storage (never in the data backup unless the switch above is on) and sent only to the provider they belong to. Photos you analyze are sent to that provider. <button id="xHelp" style="color:var(--accent)">How to get a key…</button></div>
  <div class="foot" style="text-align:center">App version ${APP_VERSION}</div>
    <div class="section-title">Appearance</div>
  <div class="card"><div class="field" style="padding:8px 16px"><div class="seg" id="theme" style="flex:1">${['system', 'light', 'dark'].map(x => `<button data-t="${x}" class="${S().theme === x ? 'on' : ''}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div></div></div>
  <div class="section-title">Backup</div>
  <div class="card"><div class="field"><span>Last backup</span><span class="unit">${le}</span></div><div class="field"><span>Logged entries</span><span class="unit">${total} · ${Object.keys(data.foods).length} foods</span></div></div>
  <div class="stack" style="margin-top:12px"><button class="btn" id="exp">Export Backup (JSON)</button><button class="btn secondary" id="imp">Import Backup…</button><input type="file" id="impFile" accept=".json,application/json" class="hidden"></div>
  <div class="foot">Everything is stored only on this iPhone. iOS can clear a web app’s storage if it goes unused for weeks, so export a backup now and then (it can be saved to Files or iCloud Drive).</div>
  <div class="section-title">Data</div>
  <button class="btn danger" id="wipe">Delete All Data…</button>
  <div class="foot" style="text-align:center;margin-top:24px">Macro Tracker · works offline · food data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (ODbL)</div></div>`;
}
function bindSettings() {
  const upd = () => { const t = S().targets; $('#tCal').value = S().calMode === 'auto' ? autoCal(t) : t.cal; };
  [['tP', 'p'], ['tC', 'c'], ['tF', 'f'], ['tCal', 'cal']].forEach(([id, k]) => $('#' + id).addEventListener('input', e => { S().targets[k] = Math.max(0, num(e.target.value)); save(); if (k !== 'cal') upd(); }));
  $$('#calMode button').forEach(b => b.onclick = () => { S().calMode = b.dataset.m; if (b.dataset.m === 'manual') S().targets.cal = autoCal(S().targets); save(); render(); });
  $('#exOn').onchange = e => { S().exercise.on = e.target.checked; save(); render(); };
  $$('#exPct button').forEach(b => b.onclick = () => { S().exercise.pct = +b.dataset.p; save(); render(); });
  $('#exHelpS').onclick = openHelp;
  const refreshNote = () => { $('#pvNote').innerHTML = pvNote(); $$('#aiProv button').forEach(x => x.classList.toggle('on', x.dataset.pv === aiProv())); };
  $$('#aiProv button').forEach(x => x.onclick = () => { xai.provider = x.dataset.pv; xaiSave(); refreshNote(); });
  $('#xBk').onchange = e => { xai.inBackup = e.target.checked; xaiSave(); };
  $('#xHelp').onclick = openAiHelp;
  ['xai', 'gemini'].forEach(v => {
    const g = v === 'gemini', kf = g ? 'gKey' : 'key', mf = g ? 'gModel' : 'model', st = $('#' + v + 'Status');
    $('#' + v + 'Key').addEventListener('input', e => { xai[kf] = e.target.value.trim(); xaiSave(); st.textContent = xai[kf] ? 'Key saved on this device only.' : 'No key yet.'; refreshNote(); });
    $('#' + v + 'Model').onchange = e => { xai[mf] = e.target.value; xaiSave(); };
    $('#' + v + 'Clear').onclick = () => { xai[kf] = ''; xaiSave(); $('#' + v + 'Key').value = ''; st.textContent = 'Key cleared.'; refreshNote(); };
    $('#' + v + 'Test').onclick = async () => {
      if (!xai[kf]) { st.textContent = 'Enter a key first.'; return; }
      st.textContent = 'Testing…';
      try {
        const r = g ? await fetch(GEM_URL + '/models?pageSize=1000', { headers: { 'x-goog-api-key': xai[kf] } }) : await fetch(XAI_URL + '/models', { headers: { Authorization: 'Bearer ' + xai[kf] } });
        if (r.ok) {
          const j = await r.json().catch(() => ({})); const ids = g ? (j.models || []).map(m => String(m.name).replace(/^models\//, '')) : (j.data || []).map(m => m.id);
          const miss = ids.length && !ids.includes(xai[mf]) && !(g && j.nextPageToken);
          st.textContent = '✓ Key works.' + (miss ? ` Note: “${xai[mf]}” isn’t in this key’s model list — pick another model.` : '');
        } else {
          const t = await r.text().catch(() => '');
          st.textContent = /api key/i.test(t) || r.status === 401 ? '✗ This key was rejected. Check it was copied in full.' : r.status === 429 ? '✗ Quota reached (429) — wait and retry.' : `✗ ${PV[v].name} answered ${r.status}.`;
        }
      } catch (e) { st.textContent = '✗ Couldn’t reach ' + PV[v].name + ' — check your connection.'; }
    };
  });
  $$('#theme button').forEach(b => b.onclick = () => { S().theme = b.dataset.t; save(); applyTheme(); render(); });
  $('#exp').onclick = () => exportData().then(ok => ok && render());
  $('#imp').onclick = () => $('#impFile').click();
  $('#impFile').onchange = e => { const f = e.target.files[0]; if (f) f.text().then(importText).catch(() => toast('Could not read that file')); e.target.value = ''; };
  $('#wipe').onclick = () => { if (confirm('Delete ALL entries, foods and settings from this device? This cannot be undone.') && confirm('Really delete everything? Export a backup first if unsure.')) { data = defaults(); xai.key = ''; xai.model = 'grok-4.7'; xai.gKey = ''; xai.gModel = 'gemini-3.8-flash'; xai.provider = ''; xai.inBackup = false; xaiSave(); save(); applyTheme(); ui.day = dayKey(); render(); toast('All data deleted'); } };
}

/* ---------- exercise calories: import / edit / help ---------- */
const validKey = k => /^\d{4}-\d{2}-\d{2}$/.test(k) && dayKey(parseKey(k)) === k;
// Accepts: "macros-burned:<kcal>[:<YYYY-MM-DD>]", a URL containing ?burned=<kcal>&date=<YYYY-MM-DD>, or a bare number (= today).
function parseBurned(text) {
  text = String(text || '').trim(); let kcal = null, date = null, m;
  if ((m = text.match(/macros-burned:\s*(\d+(?:[.,]\d+)?)(?:\s*[:\s]\s*(\d{4}-\d{2}-\d{2}))?/i))) { kcal = num(m[1]); date = m[2] || null; }
  else if ((m = text.match(/[?&#]burned=(\d+(?:[.,]\d+)?)/i))) { kcal = num(m[1]); const d = text.match(/[?&#]date=(\d{4}-\d{2}-\d{2})/i); date = d ? d[1] : null; }
  else if ((m = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:kcal|cal)?$/i))) kcal = num(m[1]);
  if (kcal === null) return null;
  date = date || dayKey();
  if (!validKey(date) || date > dayKey() || kcal > 20000) return null;
  return { kcal: r0(kcal), date };
}
function setBurned(date, kcal) { // replace (not add) so running the Shortcut repeatedly is idempotent
  if (kcal > 0) data.burned[date] = r0(kcal); else delete data.burned[date];
  save();
}
function applyBurned(p, via) {
  setBurned(p.date, p.kcal); if (p.date <= dayKey()) ui.day = p.date;
  ui.tab = 'today'; render();
  toast(`${p.kcal} kcal burned saved for ${p.date === dayKey() ? 'today' : shortDay(p.date)}${exOn() ? '' : ' (exercise is off in Settings)'}`);
}
function openBurned(day, autoPaste) {
  const cur = burnedOf(day);
  sheet({
    title: 'Calories burned', left: { label: 'Cancel' }, right: { label: 'Save', fn: () => {
      const v = $('#bKcal').value.trim();
      if (v === '') { setBurned(day, 0); } else { const n = num(v); if (n < 0 || n > 20000) { toast('Enter 0–20,000 kcal'); return; } setBurned(day, n); }
      closeSheet(); render(); toast('Saved');
    } },
    body: `<div class="stack" style="margin-top:10px"><div class="note">${day === dayKey() ? 'Today' : shortDay(day)} — active energy burned. Saving replaces the value for this day (it never adds up). Leave blank to clear.</div>
      <div class="card"><div class="field"><label for="bKcal">Active calories</label><input type="text" inputmode="numeric" id="bKcal" value="${cur ? r0(cur) : ''}" placeholder="0" autocomplete="off"><span class="unit">kcal</span></div></div>
      <button class="btn secondary" id="bPaste">Paste from Shortcut</button>
      <div id="bFall" class="hidden stack"><div class="note warn">Couldn’t read the clipboard automatically. Long-press below, tap Paste, then tap Import.</div>
        <div class="card"><div class="field"><textarea id="bTxt" rows="2" placeholder="macros-burned:482:${dayKey()}" style="width:100%;background:none;border:0;outline:0;font-size:16px;padding:12px 0;resize:none"></textarea></div></div>
        <button class="btn" id="bImp">Import</button></div>
      <div class="foot" style="text-align:center"><button id="bHelp" style="color:var(--accent)">How do I set up the Apple Watch Shortcut?</button></div></div>`,
    mount: b => {
      const fromText = t => { const p = parseBurned(t); if (!p) { toast('No burned-calories value found in that text'); return false; } closeSheet(); applyBurned(p); return true; };
      const doPaste = async () => {
        try { const t = await navigator.clipboard.readText(); if (!fromText(t) && !parseBurned(t)) $('#bFall', b).classList.remove('hidden'); }
        catch (e) { $('#bFall', b).classList.remove('hidden'); $('#bTxt', b).focus(); }
      };
      $('#bPaste', b).onclick = doPaste;
      $('#bImp', b).onclick = () => fromText($('#bTxt', b).value);
      $('#bHelp', b).onclick = openHelp;
      if (autoPaste) $('#bFall', b).classList.remove('hidden'); // iOS needs a tap for clipboard access; make the manual path visible too
    },
  });
}
const SHORTCUT_STEPS = [
  ['Create the shortcut', 'Open the <b>Shortcuts</b> app → tap <b>+</b> (top right) → name it <b>Macros Burned</b>.'],
  ['Action 1: Find Health Samples', 'Tap <b>Add Action</b>, search <b>Find Health Samples</b>. Add filters: <b>Type</b> is <b>Active Energy</b>, and <b>Start Date</b> is <b>Today</b>. Turn <b>Limit</b> off. (On older iOS this action is called “Get Health Sample”.)'],
  ['Action 2: Calculate Statistics', 'Add <b>Calculate Statistics</b>. Set the operation to <b>Sum</b> and its input to <b>Health Samples</b>. If Shortcuts complains about the input type, insert <b>Get Details of Health Samples</b> (detail: <b>Value</b>) before this step and sum that instead.'],
  ['Action 3: Round Number', 'Add <b>Round Number</b> → input <b>Statistics</b>, round to <b>Ones Place</b>.'],
  ['Action 4: Format Date', 'Add <b>Format Date</b> → Date: <b>Current Date</b>, Date Format: <b>Custom</b>, format string <code>yyyy-MM-dd</code>.'],
  ['Action 5: Text', 'Add <b>Text</b> and type exactly: <code>macros-burned:</code> then tap the <b>Rounded Number</b> variable, type <code>:</code>, then tap the <b>Formatted Date</b> variable. Result looks like <code>macros-burned:482:' + '2026-11-11</code>.'],
  ['Action 6: Copy to Clipboard', 'Add <b>Copy to Clipboard</b> → input <b>Text</b>.'],
  ['Action 7: Show Notification', 'Add <b>Show Notification</b>: “Burned kcal copied — open Macros and tap Paste from Shortcut”. (Optional but a good reminder.)'],
  ['Allow Health access', 'Tap ▶ to run it once. When iOS asks for Health access to <b>Active Energy</b>, tap <b>Allow</b> (and <b>Always Allow</b> for automations).'],
  ['Hand off to this app', 'Open <b>Macros</b> from your Home Screen → Today → <b>Paste from Shortcut</b> → tap the <b>Paste</b> bubble iOS shows. Your calories-burned for today are replaced and the target updates. Running it again later in the day just replaces the number.'],
];
function helpHtml() {
  return `<div class="help"><div class="note"><b>Why not a link?</b> A Shortcut’s “Open URL” opens Safari, and iOS keeps Safari’s storage separate from this Home Screen app, so a link can’t write into it. Instead the Shortcut puts the number on the clipboard and you paste it here with one tap.</div>
  <h3>One-time setup (≈3 min)</h3><ol>${SHORTCUT_STEPS.map(([t, d]) => `<li><b>${t}.</b> ${d}</li>`).join('')}</ol>
  <h3>Run it automatically</h3><ol>
   <li>Shortcuts → <b>Automation</b> → <b>+</b> → <b>Time of Day</b> → e.g. <b>8:00 PM</b>, Daily → <b>Next</b> → <b>Run Shortcut</b> → <b>Macros Burned</b> → Next → set <b>Run Immediately</b> → Done.</li>
   <li>The shortcut copies your burned calories at 8 PM and shows a notification. Open Macros and tap <b>Paste from Shortcut</b>. (The clipboard keeps the value until you copy something else.)</li>
   <li>Want it any time? Add <b>Macros Burned</b> to your Home Screen or Lock Screen widget / Action Button, run it, then paste in Macros.</li></ol>
  <h3>Good to know</h3><ul>
   <li>Only <b>Active Energy</b> is used — resting energy is already inside your base target.</li>
   <li>Pasting <i>replaces</i> that day’s value; it never double-counts.</li>
   <li>You can also type calories burned by hand (Today → Enter burned).</li>
   <li>Accepted paste formats: <code>macros-burned:482:YYYY-MM-DD</code>, <code>macros-burned:482</code> (today), or just <code>482</code>.</li>
   <li>If you open <code>…/macros/?burned=482&amp;date=YYYY-MM-DD</code> in a Safari tab, the numbers are saved in <i>Safari’s</i> copy of the app only — not the Home Screen app.</li></ul></div>`;
}
function openHelp() { sheet({ title: 'Apple Watch setup', left: { label: 'Close' }, body: helpHtml() }); }

/* ---------- AI photo estimate (xAI Grok vision) ---------- */
const AI_SYS = 'You are a careful nutrition estimator. You look at a photo of a meal and estimate what is on the plate. Reply with ONLY one JSON object, no prose, no markdown fences.';
const AI_PROMPT = `Identify each distinct food or drink in the photo and estimate the portion actually shown.
Return exactly this JSON shape:
{"items":[{"name":"string","portion_household":"e.g. 1 cup, 2 slices, 1 medium","portion_grams":number,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"confidence":"low|medium|high"}],"totals":{"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number},"notes":"short string"}
Rules: numbers are for the whole portion shown (not per 100 g); calories should roughly equal 4*protein + 4*carbs + 9*fat; include cooking fats/sauces you can reasonably infer; split mixed plates into separate items; if the photo has no food return {"items":[],"totals":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0},"notes":"no food found"}.`;
const APP_VERSION = 'v7';
const AIT = { first: 60000, retry: 40000, xai: 75000, decode: 15000, ...(window.__AIT || {}) }; // request timeouts (ms)
class AiErr extends Error { constructor(kind, msg, info = {}) { super(msg); this.kind = kind; this.info = info; } }
const withTimeout = (p, ms, kind, msg) => new Promise((res, rej) => { const t = setTimeout(() => rej(new AiErr(kind, msg)), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
// Decode a picked photo. Tries <img> first, then createImageBitmap; each guarded by a timeout so a stuck HEIC decode can't hang the UI.
async function decodeImage(file) {
  const tryImg = () => new Promise((res, rej) => { const url = URL.createObjectURL(file), img = new Image(); img.onload = () => res({ src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) }); img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode failed')); }; img.src = url; });
  let why = 'unreadable';
  try { return await withTimeout(tryImg(), AIT.decode, 'imgtimeout', 'timeout'); } catch (e) { why = e.kind === 'imgtimeout' ? 'decoder stuck >' + AIT.decode / 1000 + 's' : 'decode error'; }
  if (typeof createImageBitmap === 'function') { try { const bm = await withTimeout(createImageBitmap(file), AIT.decode, 'imgtimeout', 'timeout'); return { src: bm, w: bm.width, h: bm.height, done: () => bm.close && bm.close() }; } catch (e) { why += ' / bitmap failed'; } }
  throw new AiErr('image', `This photo couldn’t be read (${file.type || 'unknown type'}, ${(file.size / 1048576).toFixed(1)} MB; ${why}). Try choosing it from Photo Library again, or set iPhone Settings → Camera → Formats → Most Compatible.`);
}
async function downscale(file, max = 1024, onStatus = () => { }) {
  if (!file.size) throw new AiErr('image', 'That photo is empty (0 bytes). Pick it again.');
  onStatus(`Reading photo (${(file.size / 1048576).toFixed(1)} MB${file.type ? ', ' + file.type.replace('image/', '') : ''})…`);
  const d = await decodeImage(file);
  onStatus(`Resizing ${d.w}×${d.h} photo to ${max}px…`);
  const sc = Math.min(1, max / Math.max(d.w, d.h)), w = Math.max(1, Math.round(d.w * sc)), h = Math.max(1, Math.round(d.h * sc));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(d.src, 0, 0, w, h); d.done();
  const url = cv.toDataURL('image/jpeg', 0.8);
  if (!/^data:image\/jpeg;base64,.{200,}/.test(url)) throw new AiErr('image', 'The photo couldn’t be converted to JPEG on this device. Try a different photo.');
  return { url, w, h, kb: Math.round(url.length * 0.75 / 1024), orig: `${d.w}×${d.h}, ${(file.size / 1048576).toFixed(1)} MB` };
}
// fetch with a hard timeout covering headers AND body, so a stalled connection can't hang forever.
async function fetchT(url, opts, ms, outer, who) {
  const ctl = new AbortController(); let timedOut = false; const onAbort = () => ctl.abort();
  if (outer) { if (outer.aborted) throw new DOMException('Aborted', 'AbortError'); outer.addEventListener('abort', onAbort); }
  const t = setTimeout(() => { timedOut = true; ctl.abort(); }, ms), t0 = Date.now();
  try { const r = await fetch(url, { ...opts, signal: ctl.signal }); const text = await r.text(); return { ok: r.ok, status: r.status, text, ms: Date.now() - t0 }; }
  catch (e) {
    if (timedOut) throw new AiErr('timeout', `${who} didn’t answer within ${Math.round(ms / 1000)} s.`, { status: 'timeout' });
    if (outer?.aborted) throw e;
    throw new AiErr('network', `Couldn’t reach ${who} (${e && e.message ? e.message : 'network error'}). Check your connection and try again.`, { status: 'network' });
  } finally { clearTimeout(t); outer?.removeEventListener('abort', onAbort); }
}
const jsonOr = t => { try { return JSON.parse(t); } catch (e) { return null; } };
async function xaiPost(body, signal) {
  const r = await fetchT(XAI_URL + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + xai.key }, body: JSON.stringify(body) }, AIT.xai, signal, 'xAI');
  const j = jsonOr(r.text);
  if (r.ok) { if (!j) throw new AiErr('parse', 'xAI sent a reply that wasn’t JSON.', { status: r.status, raw: r.text.slice(0, 200) }); return j; }
  const m = j ? (j.error?.message || j.error || j.message || '') : r.text;
  throw aiHttpErr('xai', r.status, typeof m === 'string' ? m : JSON.stringify(m));
}
function parseMealJson(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim(), j;
  try { j = JSON.parse(t); } catch (e) { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) { try { j = JSON.parse(t.slice(a, b + 1)); } catch (e2) { } } }
  if (!j || !Array.isArray(j.items)) throw new AiErr('parse', 'Couldn’t read the model’s answer (it wasn’t valid JSON).');
  const n = v => { const x = num(v); return x > 0 && x < 1e5 ? x : 0; };
  const items = j.items.filter(i => i && typeof i === 'object').map(i => {
    const g = n(i.portion_grams), hh = String(i.portion_household || '').trim();
    let conf = i.confidence; if (typeof conf === 'number') conf = conf >= .75 ? 'high' : conf >= .45 ? 'medium' : 'low'; conf = /^(low|medium|high)$/i.test(conf) ? conf.toLowerCase() : 'medium';
    return { on: true, name: String(i.name || 'Food').trim().slice(0, 80) || 'Food', port: [hh, g ? `${r0(g)} g` : ''].filter(Boolean).join(' · ') || '1 serving', cal: r0(n(i.calories)), p: Math.round(n(i.protein_g) * 10) / 10, c: Math.round(n(i.carbs_g) * 10) / 10, f: Math.round(n(i.fat_g) * 10) / 10, conf, mult: 1 };
  });
  return { items, notes: String(j.notes || '').slice(0, 300) };
}
function aiHttpErr(pv, status, m) {
  const nm = PV[pv].name; const raw = String(m || '').slice(0, 400), info = { status, raw, model: aiModel(pv) };
  const E = (k, msg) => new AiErr(k, msg, info);
  if (status === 401 || /api key (not valid|rejected)|incorrect api key|API_KEY_INVALID/i.test(raw)) return E('badkey', `${nm} rejected your API key. Check it in Settings (copy the whole key).`);
  if (status === 403) return E('forbidden', `${nm} refused the request (403). The key may lack access${pv === 'gemini' ? ', or the Gemini API may not be available in your region' : ' or the account may be out of credits'}.`);
  if (status === 429) return E('rate', pv === 'gemini'
    ? 'Gemini’s free-tier quota is used up (429). Free keys have per-minute and per-day request limits (the daily count resets at midnight Pacific). Wait a minute and tap Try again — or try again later, switch model in Settings, or check your usage in Google AI Studio.'
    : 'xAI says you’re sending too many requests or are out of credits (429). Wait a moment and retry.');
  if (status === 404) return E('nomodel', `${nm} doesn’t know the model “${aiModel(pv)}” (404).`);
  if (status >= 500) return E('server', `${nm} had a problem (HTTP ${status}). It may be overloaded — try again in a minute.`);
  return E('http' + status, `${nm} couldn’t process this request (HTTP ${status}).`);
}
async function geminiPost(model, body, signal, ms) {
  const r = await fetchT(`${GEM_URL}/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': xai.gKey }, body: JSON.stringify(body) }, ms, signal, 'Google Gemini');
  const j = jsonOr(r.text);
  if (r.ok) { if (!j) throw new AiErr('parse', 'Gemini sent a reply that wasn’t JSON.', { status: r.status, model, raw: r.text.slice(0, 200) }); return { j, ms: r.ms }; }
  const e = aiHttpErr('gemini', r.status, j ? (j.error?.message || '') : r.text); e.info.model = model; e.message = e.message.replace(/“[^”]*”/, `“${model}”`); throw e;
}
const GEM_FALLBACKS = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'];
const FALLBACK_KINDS = new Set(['timeout', 'nomodel', 'rate', 'server']);
async function estimateMeal(img, notes, signal, onStatus = () => { }) {
  const pv = aiProv(), dataUrl = img.url;
  if (!aiKey(pv)) throw new AiErr('nokey', `Add your ${PV[pv].name} API key in Settings first.`);
  if (navigator.onLine === false) throw new AiErr('offline', 'You’re offline. Photo estimates need an internet connection.');
  const text = AI_PROMPT + (notes ? `\nUser notes about this meal (trust these): ${notes}` : '');
  if (pv === 'gemini') {
    const models = [xai.gModel, ...GEM_FALLBACKS.filter(m => m !== xai.gModel)].slice(0, 3), tried = [];
    for (let k = 0; k < models.length; k++) {
      const model = models[k], ms = k ? AIT.retry : AIT.first;
      const body = { systemInstruction: { parts: [{ text: AI_SYS }] }, contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'image/jpeg', data: dataUrl.split(',')[1] } }, { text }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'low' } } };
      onStatus(`Sending to Gemini (${model}) — ${img.kb} KB…`);
      try {
        let res;
        try { res = await geminiPost(model, body, signal, ms); }
        catch (e) { if (e instanceof AiErr && e.kind === 'http400' && !/api key/i.test(e.info.raw || '')) { delete body.generationConfig.thinkingConfig; onStatus(`Retrying ${model} without thinking options…`); res = await geminiPost(model, body, signal, ms); } else throw e; }
        onStatus(`Reading result (${(res.ms / 1000).toFixed(1)} s)…`);
        const cand = res.j?.candidates?.[0];
        if (!cand) throw new AiErr('parse', res.j?.promptFeedback?.blockReason ? `Google blocked this photo (${res.j.promptFeedback.blockReason}). Try a different one.` : 'Gemini returned no answer. Try again.', { model, raw: JSON.stringify(res.j).slice(0, 300) });
        let out;
        try { out = parseMealJson((cand.content?.parts || []).filter(x => !x.thought).map(x => x.text || '').join('')); }
        catch (e) { if (e instanceof AiErr) { e.info = { ...e.info, model, raw: JSON.stringify(cand).slice(0, 300), status: 'finish=' + (cand.finishReason || '?') }; } throw e; }
        out.model = model; if (tried.length) out.via = `Used ${model} — ${tried.join('; ')}.`;
        return out;
      } catch (e) {
        if (!(e instanceof AiErr)) throw e;
        e.info = { ...e.info, model: e.info.model || model }; tried.push(`${model}: ${e.kind === 'timeout' ? 'timed out' : e.info.status || e.kind}`);
        e.info.tried = tried.slice();
        if (FALLBACK_KINDS.has(e.kind) && k < models.length - 1) { onStatus(`${model} failed (${e.kind === 'timeout' ? 'no answer in ' + Math.round(ms / 1000) + ' s' : e.info.status}) — trying ${models[k + 1]}…`); continue; }
        throw e;
      }
    }
  }
  const body = { model: xai.model, stream: false, max_completion_tokens: 4000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: AI_SYS }, { role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }, { type: 'text', text }] }] };
  if (/^grok-4\.[567]/.test(xai.model)) body.reasoning_effort = 'low';
  onStatus(`Sending to xAI (${xai.model}) — ${img.kb} KB…`);
  let res;
  try { res = await xaiPost(body, signal); }
  catch (e) { if (e instanceof AiErr && e.kind === 'http400' && !/api key/i.test(e.info.raw || '')) { delete body.response_format; delete body.reasoning_effort; res = await xaiPost(body, signal); } else { if (e instanceof AiErr) e.info.model = xai.model; throw e; } }
  onStatus('Reading result…');
  const msg = res?.choices?.[0]?.message?.content;
  const out = parseMealJson(Array.isArray(msg) ? msg.map(x => x.text || '').join('') : msg);
  out.model = res.model || xai.model; return out;
}
let aiCtl = null;
let aiStat = null; // live status line for the wait sheet
const setStat = t => { if (aiStat) { aiStat.txt = t; tickStat(); } };
const tickStat = () => { const el = $('#aiStat'); if (el && aiStat) el.innerHTML = `${esc(aiStat.txt)}<br><small>${Math.round((Date.now() - aiStat.t0) / 1000)} s elapsed</small>`; };
function waitSheet(title, first, onCancel) {
  aiStat = { txt: first, t0: Date.now() }; clearInterval(aiStat.iv);
  sheet({ title: 'Photo estimate', left: { label: 'Cancel', fn: () => { endStat(); onCancel?.(); closeSheet(); } }, body: `<div class="aiwait"><div class="spin"></div><div id="aiStat"></div><small>${esc(title)}</small></div>` });
  tickStat(); aiStat.iv = setInterval(tickStat, 1000);
}
const endStat = () => { if (aiStat) { clearInterval(aiStat.iv); aiStat = null; } };
function startPhoto(file) {
  if (!aiKey(aiProv())) {
    sheet({ title: 'Photo estimate', left: { label: 'Close' }, body: `<div class="stack" style="margin-top:10px"><div class="note warn">Add an API key (free Google Gemini key, or xAI Grok) to use photo estimates. It stays on this device.</div>
      <button class="btn" id="aiToSet">Open Settings</button><button class="btn secondary" id="aiHelp0">How do I get a key?</button></div>`,
      mount: b => { $('#aiToSet', b).onclick = () => { closeSheet(); ui.tab = 'settings'; render(); }; $('#aiHelp0', b).onclick = openAiHelp; } });
    return;
  }
  let cancelled = false;
  waitSheet('Step 1 of 2: preparing the photo on your phone', 'Preparing photo…', () => { cancelled = true; });
  downscale(file, 1024, setStat).then(img => { endStat(); if (!cancelled && sheetOpen) openPhotoPrep(img, ''); }, e => { endStat(); if (!cancelled && sheetOpen) aiError(e, null, null, '', 'prepare'); });
}
function openPhotoPrep(img, notes) {
  sheet({ title: 'Photo estimate', left: { label: 'Cancel' }, body: `<div class="stack" style="margin-top:10px">
    <img class="aithumb" src="${img.url}" alt="Meal photo">
    <div class="card"><div class="field"><input type="text" id="aiNotes" placeholder="Notes (optional) — e.g. cooked in olive oil" value="${esc(notes)}" style="text-align:left" autocomplete="off" enterkeyhint="go"></div></div>
    <button class="btn" id="aiGo">Estimate calories &amp; macros</button>
    <div class="foot" style="text-align:center">Photo ready: ${img.w}×${img.h} JPEG, ${img.kb} KB (from ${esc(img.orig)}). Will be sent to ${PV[aiProv()].name} (${esc(aiModel(aiProv()))}).${aiProv() === 'gemini' ? ' Free-tier requests may be used by Google to improve its products.' : ''} Estimates can be off — you’ll review before logging.</div></div>`,
    mount: b => { const go = () => runEstimate(img, $('#aiNotes', b).value.trim()); $('#aiGo', b).onclick = go; $('#aiNotes', b).onkeydown = e => { if (e.key === 'Enter') go(); }; } });
}
async function runEstimate(img, notes) {
  aiCtl?.abort(); const ctl = aiCtl = new AbortController();
  waitSheet(`Step 2 of 2: asking ${PV[aiProv()].name}`, 'Starting…', () => ctl.abort());
  try { const out = await estimateMeal(img, notes, ctl.signal, setStat); endStat(); if (!sheetOpen || ctl.signal.aborted) return; openAiReview(img, notes, out); }
  catch (e) { endStat(); if (e && e.name === 'AbortError') return; if (sheetOpen) aiError(e, () => runEstimate(img, notes), img, notes, 'estimate'); }
}
function aiError(e, retry, img, notes, stage) {
  const kind = e instanceof AiErr ? e.kind : 'unknown'; let msg = e instanceof AiErr ? e.message : 'Something went wrong: ' + (e && e.message ? e.message : e);
  if (e instanceof AiErr && e.info?.tried?.length > 1) msg += ` (Tried ${e.info.tried.length} models.)`;
  if (kind === 'timeout' && aiProv() === 'gemini') msg += ' Tip: pick “Gemini 3.5 Flash-Lite” in Settings for faster answers, or try again in a minute.';
  const needKey = kind === 'badkey' || kind === 'nokey', info = (e instanceof AiErr ? e.info : {}) || {}, pv = aiProv();
  const detail = [`app ${APP_VERSION}`, `stage: ${stage || '?'}`, `provider: ${PV[pv].name}`, `model: ${info.model || aiModel(pv)}`, `error: ${kind}${info.status ? ' / ' + info.status : ''}`, info.raw ? `api says: ${info.raw}` : '', info.tried?.length ? `tried: ${info.tried.join('; ')}` : '', `time: ${new Date().toISOString()}`].filter(Boolean).join('\n');
  sheet({ title: 'Photo estimate', left: { label: 'Close' }, body: `<div class="stack" style="margin-top:10px"><div class="note warn">${esc(msg)}</div>
    ${needKey ? '<button class="btn" id="aiToSet">Open Settings</button><button class="btn secondary" id="aiH">How to get a key</button>' : (retry ? '<button class="btn" id="aiRetry">Try again</button>' : '')}
    ${img ? '<button class="btn gray" id="aiBack">Edit notes / photo</button>' : ''}<button class="btn gray" id="aiManual">Enter food manually</button>
    <div class="note" style="white-space:pre-wrap;word-break:break-word;font-size:12px;font-family:ui-monospace,Menlo,monospace" id="aiDetail">${esc(detail)}</div>
    <button class="btn gray" id="aiCopy">Copy error details</button></div>`,
    mount: b => {
      $('#aiToSet', b)?.addEventListener('click', () => { closeSheet(); ui.tab = 'settings'; render(); }); $('#aiH', b)?.addEventListener('click', openAiHelp);
      $('#aiRetry', b)?.addEventListener('click', retry); $('#aiBack', b)?.addEventListener('click', () => openPhotoPrep(img, notes));
      $('#aiManual', b).onclick = () => openFood({ mode: 'new', food: { name: '', cal: 0, p: 0, c: 0, f: 0 }, back: openAdd });
      $('#aiCopy', b).onclick = async () => { try { await navigator.clipboard.writeText(detail); toast('Copied'); } catch (er) { const r = document.createRange(); r.selectNodeContents($('#aiDetail', b)); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Selected — tap Copy'); } };
    } });
}

function openAiReview(img, notes, out) {
  const items = out.items;
  if (!items.length) { aiError(new AiErr('empty', 'The AI didn’t see any food in that photo' + (out.notes ? ` (“${out.notes}”)` : '') + '. Try a closer, brighter shot.'), null, img, notes, 'review'); return; }
  const st = { mode: 'sep', meal: '' };
  const line = i => ({ cal: i.cal * i.mult, p: i.p * i.mult, c: i.c * i.mult, f: i.f * i.mult });
  const tots = () => items.filter(i => i.on).reduce((a, i) => { const l = line(i); a.cal += l.cal; a.p += l.p; a.c += l.c; a.f += l.f; a.n++; return a; }, { cal: 0, p: 0, c: 0, f: 0, n: 0 });
  const rowHtml = (i, k) => `<div class="aiitem ${i.on ? '' : 'off'}" data-i="${k}">
    <div class="aihead"><span class="switch"><input type="checkbox" class="aiOn" ${i.on ? 'checked' : ''} aria-label="Include ${esc(i.name)}"></span><input class="aiName" value="${esc(i.name)}" aria-label="Name"><span class="conf ${i.conf}">${i.conf}</span></div>
    <input class="aiPort" value="${esc(i.port)}" aria-label="Portion">
    <div class="aimac">${[['cal', 'kcal'], ['p', 'P g'], ['c', 'C g'], ['f', 'F g']].map(([key, l]) => `<label><input type="text" inputmode="decimal" class="aiM" data-k="${key}" value="${i[key]}"><span>${l}</span></label>`).join('')}</div>
    <div class="aimult"><span>Portion ×</span><button class="mini aiMinus" aria-label="Less">−</button><input type="text" inputmode="decimal" class="aiMult" value="${i.mult}"><button class="mini aiPlus" aria-label="More">+</button><span class="aicount"></span></div></div>`;
  const body = `<div class="aireview">
    <div class="airow-top"><img class="aithumb sm" src="${img.url}" alt=""><div class="note warn" style="flex:1"><b>AI estimate — may be off.</b> Check portions and edit anything that looks wrong before logging.${out.notes ? `<br><i>${esc(out.notes)}</i>` : ''}${out.via ? `<br><small>${esc(out.via)}</small>` : ''}</div></div>
    <div class="aitot card" id="aiTot"></div>
    <div id="aiItems">${items.map(rowHtml).join('')}</div>
    <div class="seg" id="aiMode" style="margin:14px 0 8px"><button data-m="sep" class="on">Separate entries</button><button data-m="one">One combined meal</button></div>
    <div class="card hidden" id="aiMealWrap"><div class="field"><label for="aiMeal">Meal name</label><input type="text" id="aiMeal" placeholder="Photo meal" autocomplete="off"></div></div>
    <button class="btn" id="aiLog" style="margin-top:12px">Log</button>
    <button class="btn gray" id="aiRe" style="margin-top:10px">Re-run with different notes</button></div>`;
  const doLog = () => {
    const on = items.filter(i => i.on); if (!on.length) { toast('Turn on at least one item'); return; }
    const arr = data.entries[ui.day] = data.entries[ui.day] || [], ts = Date.now();
    if (st.mode === 'sep') on.forEach((i, k) => arr.push({ id: uid(), name: i.name.trim() || 'Food', serving: i.port.trim() || '1 serving', servings: i.mult, cal: i.cal, p: i.p, c: i.c, f: i.f, barcode: '', foodId: '', g: null, ai: true, ts: ts + k }));
    else { const t = tots(); const nm = ($('#aiMeal').value.trim()) || ('Photo meal: ' + on.map(i => i.name.trim()).join(', ')).slice(0, 80); arr.push({ id: uid(), name: nm, serving: `${on.length} item${on.length > 1 ? 's' : ''} (AI estimate)`, servings: 1, cal: r0(t.cal), p: Math.round(t.p * 10) / 10, c: Math.round(t.c * 10) / 10, f: Math.round(t.f * 10) / 10, barcode: '', foodId: '', g: null, ai: true, ts }); }
    save(); closeSheet(); render(); toast(`Logged ${st.mode === 'sep' ? on.length + ' item' + (on.length > 1 ? 's' : '') : 'meal'} · ${r0(tots().cal)} kcal`);
  };
  sheet({ title: 'Review estimate', left: { label: 'Back', fn: () => openPhotoPrep(img, notes) }, right: { label: 'Log', fn: doLog }, body,
    mount: b => {
      const upd = () => {
        const t = tots();
        $('#aiTot', b).innerHTML = `<div class="aitotin"><div><b>${r0(t.cal)}</b><small>kcal</small></div><div><b style="color:var(--pro)">${r0(t.p)}g</b><small>protein</small></div><div><b style="color:var(--carb)">${r0(t.c)}g</b><small>carbs</small></div><div><b style="color:var(--fat)">${r0(t.f)}g</b><small>fat</small></div></div>`;
        $$('.aiitem', b).forEach(el => { const i = items[+el.dataset.i], l = line(i); el.classList.toggle('off', !i.on); $('.aicount', el).textContent = `= ${r0(l.cal)} kcal · P ${r0(l.p)} · C ${r0(l.c)} · F ${r0(l.f)}`; });
        const lbl = st.mode === 'sep' ? `Log ${t.n} item${t.n === 1 ? '' : 's'} · ${r0(t.cal)} kcal` : `Log meal · ${r0(t.cal)} kcal`;
        $('#aiLog', b).textContent = lbl; $('#aiLog', b).disabled = !t.n;
      };
      $$('.aiitem', b).forEach(el => {
        const i = items[+el.dataset.i];
        $('.aiOn', el).onchange = e => { i.on = e.target.checked; upd(); };
        $('.aiName', el).oninput = e => { i.name = e.target.value; };
        $('.aiPort', el).oninput = e => { i.port = e.target.value; };
        $$('.aiM', el).forEach(inp => inp.oninput = () => { i[inp.dataset.k] = Math.max(0, num(inp.value)); upd(); });
        const mi = $('.aiMult', el), setM = v => { i.mult = Math.round(clamp(v, 0.05, 20) * 100) / 100; mi.value = i.mult; upd(); };
        mi.oninput = () => { const v = num(mi.value); if (v > 0) { i.mult = clamp(v, 0.05, 20); upd(); } };
        mi.onblur = () => { mi.value = i.mult; };
        $('.aiMinus', el).onclick = () => setM(i.mult - 0.25 < 0.05 ? 0.25 : i.mult - 0.25); $('.aiPlus', el).onclick = () => setM(i.mult + 0.25);
      });
      $$('#aiMode button', b).forEach(x => x.onclick = () => { st.mode = x.dataset.m; $$('#aiMode button', b).forEach(y => y.classList.toggle('on', y === x)); $('#aiMealWrap', b).classList.toggle('hidden', st.mode !== 'one'); upd(); });
      $('#aiLog', b).onclick = doLog; $('#aiRe', b).onclick = () => openPhotoPrep(img, notes);
      upd();
    } });
}
function openAiHelp() {
  sheet({ title: 'AI photo setup', left: { label: 'Close' }, body: `<div class="help"><div class="note">Take or choose a photo of a meal and an AI vision model (Google Gemini or xAI Grok) estimates calories and macros. You review and edit the result before anything is logged. It’s an estimate — portions and hidden oils are hard to see.</div>
  <h3>Free option: Google Gemini</h3><ol>
   <li>Open <b>aistudio.google.com/apikey</b> in Safari and sign in with a Google account.</li>
   <li>Tap <b>Create API key</b> (pick or create a project when asked) and copy the key (starts with <code>AIza</code>).</li>
   <li>Here: <b>Settings → AI photo estimates → Google Gemini → API key</b>, paste, tap <b>Test key</b>. If Gemini is your only key it’s used automatically; otherwise choose it in the provider picker.</li>
   <li>Model: leave <b>Gemini 3.8 Flash</b>, or pick <b>3.5 Flash-Lite</b> if you hit limits.</li></ol>
  <ul><li><b>Free-tier limits:</b> Google applies per-minute and per-day request limits per project (not per key); the daily count resets at midnight Pacific time. Google’s docs don’t print the numbers — they’re shown in AI Studio for your account and can change. When you hit them the app shows “quota used up (429)”: wait a minute, or try later.</li>
   <li><b>Privacy:</b> on the free tier Google may use your prompts and photos to improve its products. The paid tier doesn’t. Don’t send photos you wouldn’t want used that way.</li>
   <li>Free-tier availability can vary by region/account; a 403 can mean the API isn’t available for your account.</li></ul>
  <h3>Alternative: xAI Grok (pay-as-you-go)</h3><ol>
   <li>Go to <b>console.x.ai</b>, sign in, add credit under <b>Billing</b> if asked.</li>
   <li><b>API Keys → Create API key</b>; copy it (starts with <code>xai-</code>) — shown only once.</li>
   <li>Paste into <b>Settings → AI photo estimates → xAI Grok</b> and tap <b>Test key</b>. Leave the model on <b>Grok 4.7</b>.</li></ol>
  <h3>Use it</h3><ol><li>Today → <b>Add Food</b> → <b>Photo — AI estimate</b> → Take Photo or Photo Library.</li>
   <li>Optionally add notes (“cooked in olive oil”, “half portion”) → <b>Estimate</b>.</li>
   <li>Review: switch items off, edit names/numbers, change <b>Portion ×</b>, and choose separate entries or one combined meal → <b>Log</b>.</li></ol>
  <h3>Privacy &amp; keys</h3><ul><li>Keys are stored only in this app’s on-device storage and sent only to their own provider. They’re left out of backup files unless you switch on “Include keys in backup file”.</li>
   <li>The photo (downscaled to ~1024 px) and your notes are sent to the chosen provider for each estimate. Nothing else is sent.</li>
   <li>Anyone who can unlock this phone and open the app could see a key in Settings.</li></ul></div>` });
}

/* ---------- export / import ---------- */
async function exportData() {
  const stamp = new Date().toISOString();
  const payload = JSON.stringify({ app: 'macro-tracker', version: 1, exportedAt: stamp, settings: S(), foods: data.foods, entries: data.entries, burned: data.burned, ...(xai.inBackup && (xai.key || xai.gKey) ? { xai: { key: xai.key, model: xai.model, gKey: xai.gKey, gModel: xai.gModel, provider: xai.provider } } : {}) }, null, 2);
  const name = `macro-tracker-backup-${dayKey()}.json`;
  const file = new File([payload], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Macro Tracker backup' }); }
    else {
      const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  } catch (e) { if (e && e.name === 'AbortError') return false; toast('Export failed'); return false; }
  S().lastExport = stamp; save(); toast('Backup exported'); return true;
}
function importText(text) {
  let j; try { j = JSON.parse(text); } catch (e) { toast('That file isn’t valid JSON'); return; }
  if (!j || typeof j !== 'object' || typeof j.entries !== 'object' || j.entries === null) { toast('That doesn’t look like a Macro Tracker backup'); return; }
  const inc = normalize(j);
  if (j.xai && typeof j.xai === 'object') { const x = j.xai, ok = v => typeof v === 'string'; let ch = false;
    if (ok(x.key) && x.key && !xai.key) { xai.key = x.key; if (ok(x.model) && x.model) xai.model = x.model; ch = true; }
    if (ok(x.gKey) && x.gKey && !xai.gKey) { xai.gKey = x.gKey; if (ok(x.gModel) && x.gModel) xai.gModel = x.gModel; ch = true; }
    if (ch) xaiSave(); }
  const nE = Object.values(inc.entries).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0);
  sheet({
    title: 'Import Backup', left: { label: 'Cancel' },
    body: `<div class="stack" style="margin-top:10px"><div class="note">Backup contains <b>${nE}</b> entries across <b>${Object.keys(inc.entries).length}</b> days and <b>${Object.keys(inc.foods).length}</b> saved foods${j.exportedAt ? ` (exported ${esc(new Date(j.exportedAt).toLocaleDateString())})` : ''}.</div>
      <button class="btn" id="mg">Merge with Current Data</button><button class="btn danger" id="rp">Replace Current Data</button>
      <p class="foot">Merge keeps your current targets and adds any entries and foods you don’t already have. Replace swaps everything for the backup.</p></div>`,
    mount: b => {
      $('#mg', b).onclick = () => {
        Object.entries(inc.entries).forEach(([k, arr]) => { if (!Array.isArray(arr)) return; const cur = data.entries[k] = data.entries[k] || []; const ids = new Set(cur.map(e => e.id)); arr.forEach(e => { if (!ids.has(e.id)) cur.push(e); }); });
        Object.entries(inc.foods).forEach(([id, f]) => { if (!data.foods[id] && !(f.barcode && localByBarcode(f.barcode))) data.foods[id] = f; });
        Object.entries(inc.burned).forEach(([k, v]) => { if (!(k in data.burned)) data.burned[k] = v; });
        save(); closeSheet(); render(); toast('Merged backup');
      };
      $('#rp', b).onclick = () => { if (!confirm('Replace all current data with this backup?')) return; data = inc; save(); applyTheme(); closeSheet(); render(); toast('Backup restored'); };
    },
  });
}

/* ---------- boot ---------- */
applyTheme(); render();
(() => { // ?burned=<kcal>&date=YYYY-MM-DD (date optional). Applies, then strips the params so a reload doesn't re-run it.
  const q = new URLSearchParams(location.search);
  if (!q.has('burned')) return;
  const p = parseBurned(`?burned=${q.get('burned')}${q.get('date') ? '&date=' + q.get('date') : ''}`);
  q.delete('burned'); q.delete('date');
  try { history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); } catch (e) { }
  if (p) applyBurned(p); else toast('Couldn’t read that burned-calories link');
})();
const markBadge = () => { if (document.querySelector('a[href*="deed.page"]')) document.documentElement.classList.add('badged'); };
markBadge(); window.addEventListener('load', markBadge);
try { navigator.storage?.persist?.(); } catch (e) { }
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { // a new version just took over: refresh once so it shows right away
    if (!hadController || sessionStorage.getItem('sw-reloaded')) return;
    if (sheetOpen || scanner.running) { pendingReload = true; return; }
    sessionStorage.setItem('sw-reloaded', '1'); location.reload();
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
}
})();
