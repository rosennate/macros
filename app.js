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
const defaults = () => ({ version: 1, settings: { targets: { cal: 2110, p: 150, c: 220, f: 70 }, calMode: 'auto', theme: 'system', lastExport: null }, foods: {}, entries: {} });
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
  const out = { version: 1, settings: { ...base.settings, ...(d.settings || {}) }, foods: d.foods && typeof d.foods === 'object' ? d.foods : {}, entries: d.entries && typeof d.entries === 'object' ? d.entries : {} };
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
const dayEntries = k => (data.entries[k] || []).slice().sort((a, b) => a.ts - b.ts);
const totalsOf = list => list.reduce((a, e) => { const s = e.servings; a.cal += e.cal * s; a.p += e.p * s; a.c += e.c * s; a.f += e.f * s; return a; }, { cal: 0, p: 0, c: 0, f: 0 });

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
  const list = dayEntries(k), tot = totalsOf(list), T = targets();
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
      <div class="herostats"><div><div class="k">Eaten</div><div class="v">${r0(tot.cal).toLocaleString()}</div></div><div><div class="k">Target</div><div class="v">${T.cal.toLocaleString()}</div></div></div>
    </div>
    <div class="macros">${mac('p', 'Protein', 'var(--pro)')}${mac('c', 'Carbs', 'var(--carb)')}${mac('f', 'Fat', 'var(--fat)')}</div>
  </div>
  <div class="section-title">Food log</div>
  <div class="card">${list.length ? `<ul class="list">${list.map(e => {
    const s = e.servings;
    return `<li><button class="row entry" data-id="${e.id}"><div class="grow"><div class="nm">${esc(e.name)}</div>
      <div class="meta">${e.barcode ? ICON.barcode : ''}${fmt(s)} × ${esc(e.serving || 'serving')} · P ${r0(e.p * s)} · C ${r0(e.c * s)} · F ${r0(e.f * s)}</div></div>
      <div class="kcal">${r0(e.cal * s)}<small>kcal</small></div></button></li>`;
  }).join('')}</ul>` : `<div class="empty">Nothing logged ${isToday ? 'yet today' : 'this day'}.<br>Tap <b>Add Food</b> to scan a barcode or enter a meal.</div>`}</div>
  </div>`;
}
function bindToday() {
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
      <div class="card" style="margin-top:12px"><div class="field"><input type="search" id="q" placeholder="Search foods — chicken breast, rice, banana…" style="text-align:left" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search"></div></div>
      <div id="foods">${foodList()}</div>
      <div class="card" style="margin-top:16px"><div class="field"><label for="bcIn">Barcode</label><input type="text" id="bcIn" inputmode="numeric" placeholder="Type UPC / EAN digits" autocomplete="off"><button id="bcGo" class="mini" style="width:auto;padding:0 12px;border-radius:17px;font-size:15px;font-weight:600">Look up</button></div></div>`,
    mount: b => {
      $('#scanBtn', b).onclick = startScan;
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
  const days = Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
  const rows = days.map(k => ({ k, e: dayEntries(k) })).map(r => ({ ...r, t: totalsOf(r.e) }));
  const logged = rows.filter(r => r.e.length);
  const avg = key => logged.length ? logged.reduce((a, r) => a + r.t[key], 0) / logged.length : 0;
  const maxV = Math.max(T.cal * 1.15, ...rows.map(r => r.t.cal), 1);
  const goalPct = T.cal / maxV * 100;
  const labelEvery = n === 7 ? 1 : 5;
  return `<div class="page"><h1 class="title">History</h1>
  <div class="seg" id="range" style="margin-bottom:14px"><button data-r="7" class="${n === 7 ? 'on' : ''}">7 Days</button><button data-r="30" class="${n === 30 ? 'on' : ''}">30 Days</button></div>
  <div class="card"><div class="avgs">
    <div><div class="n">${r0(avg('cal'))}</div><div class="l">kcal</div><div class="t">${logged.length ? `of ${T.cal}` : '—'}</div></div>
    <div><div class="n" style="color:var(--pro)">${r0(avg('p'))}g</div><div class="l">Protein</div><div class="t">of ${T.p}g</div></div>
    <div><div class="n" style="color:var(--carb)">${r0(avg('c'))}g</div><div class="l">Carbs</div><div class="t">of ${T.c}g</div></div>
    <div><div class="n" style="color:var(--fat)">${r0(avg('f'))}g</div><div class="l">Fat</div><div class="t">of ${T.f}g</div></div></div>
    <div class="foot" style="margin:-4px 16px 12px;text-align:center">Daily average across ${logged.length} logged day${logged.length === 1 ? '' : 's'} of ${n}</div></div>
  <div class="section-title">Calories per day</div>
  <div class="card chart"><div class="bars">
    ${rows.map(r => `<button class="b" data-day="${r.k}" aria-label="${shortDay(r.k)}: ${r0(r.t.cal)} kcal"><i class="${!r.e.length ? 'none' : r.t.cal > T.cal ? 'over' : ''}" style="height:${(r.t.cal / maxV * 100).toFixed(1)}%"></i></button>`).join('')}
    <div class="goal" style="bottom:${goalPct}%"><span>${T.cal}</span></div></div>
    <div class="xlabels">${rows.map((r, i) => `<span>${(rows.length - 1 - i) % labelEvery === 0 ? (n === 7 ? parseKey(r.k).toLocaleDateString(undefined, { weekday: 'narrow' }) : parseKey(r.k).getDate()) : ''}</span>`).join('')}</div></div>
  <div class="section-title">Days</div>
  <div class="card"><ul class="list">${rows.slice().reverse().map(r => `<li><button class="row" data-day="${r.k}"><div class="grow"><div class="nm">${r.k === today ? 'Today' : shortDay(r.k)} <span class="sub">${r.k === today ? '' : longDay(r.k)}</span></div>
    <div class="meta">${r.e.length ? `P ${r0(r.t.p)} · C ${r0(r.t.c)} · F ${r0(r.t.f)}` : 'Nothing logged'}</div></div>
    <div class="kcal" style="${r.t.cal > T.cal ? 'color:var(--over)' : ''}">${r.e.length ? r0(r.t.cal) : '—'}<small>${r.e.length ? 'kcal' : ''}</small></div></button></li>`).join('')}</ul></div></div>`;
}
function bindHistory() {
  $$('#range button').forEach(b => b.onclick = () => { ui.histRange = +b.dataset.r; render(); });
  $$('[data-day]').forEach(b => b.onclick = () => { ui.day = b.dataset.day; ui.tab = 'today'; $('#view').scrollTop = 0; render(); });
}

/* ---------- SETTINGS ---------- */
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
  $$('#theme button').forEach(b => b.onclick = () => { S().theme = b.dataset.t; save(); applyTheme(); render(); });
  $('#exp').onclick = () => exportData().then(ok => ok && render());
  $('#imp').onclick = () => $('#impFile').click();
  $('#impFile').onchange = e => { const f = e.target.files[0]; if (f) f.text().then(importText).catch(() => toast('Could not read that file')); e.target.value = ''; };
  $('#wipe').onclick = () => { if (confirm('Delete ALL entries, foods and settings from this device? This cannot be undone.') && confirm('Really delete everything? Export a backup first if unsure.')) { data = defaults(); save(); applyTheme(); ui.day = dayKey(); render(); toast('All data deleted'); } };
}

/* ---------- export / import ---------- */
async function exportData() {
  const stamp = new Date().toISOString();
  const payload = JSON.stringify({ app: 'macro-tracker', version: 1, exportedAt: stamp, settings: S(), foods: data.foods, entries: data.entries }, null, 2);
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
        save(); closeSheet(); render(); toast('Merged backup');
      };
      $('#rp', b).onclick = () => { if (!confirm('Replace all current data with this backup?')) return; data = inc; save(); applyTheme(); closeSheet(); render(); toast('Backup restored'); };
    },
  });
}

/* ---------- boot ---------- */
applyTheme(); render();
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
