(() => {
'use strict';
const KEY = 'futureme.v1';
const SCHEMA = 1;
const CATS = ['Food & drink', 'Shopping', 'Entertainment', 'Travel', 'Transport', 'Subscriptions', 'Gadgets', 'Health', 'Other'];
const DEFAULTS = { annualReturnPct: 5, currency: 'S$', horizons: [5, 10, 20, 30], categories: [] };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- storage ----------
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && d.schema === SCHEMA) return { settings: { ...DEFAULTS, ...d.settings }, entries: d.entries || [] };
  } catch (_) {}
  return { settings: { ...DEFAULTS }, entries: [] };
}
let db = load();
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify({ schema: SCHEMA, updatedAt: new Date().toISOString(), ...db })); }
  catch (e) { toast('Could not save: storage full or blocked'); }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- helpers ----------
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const rate = () => db.settings.annualReturnPct / 100;
const viewMode = () => (db.settings.view === 'lump' ? 'lump' : 'grow');
const hasMonthly = () => db.entries.some(e => e.frequency === 'monthly');
function money(n, dec) {
  const s = db.settings.currency;
  const neg = n < 0 ? '-' : '';
  const a = Math.abs(n);
  const d = dec ?? (a >= 1000 ? 0 : 2);
  return neg + s + a.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ---------- nav ----------
let view = 'home', horizon = db.settings.horizons[Math.min(1, db.settings.horizons.length - 1)] || 20;
const titles = { home: 'Financial Logic Helper', add: 'Log a decision', log: 'History', set: 'Settings' };
function go(v) {
  view = v;
  $$('.view').forEach(e => e.hidden = e.id !== 'v-' + v);
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.go === v));
  $('#title').textContent = titles[v];
  $('#hz').style.display = v === 'home' ? '' : 'none';
  if (v === 'add') { resetForm(); previewUpdate(); }
  render();
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

// ---------- render ----------
function render() {
  $$('.cur').forEach(e => e.textContent = '(' + db.settings.currency + ')');
  renderHz();
  if (view === 'home') renderHome();
  if (view === 'log') renderLog();
  if (view === 'set') renderSettings();
}
function renderHz() {
  const el = $('#hz');
  el.classList.toggle('dim', view === 'home' && viewMode() === 'grow'); // years only apply to the lump-sum view
  el.innerHTML = db.settings.horizons.map(h => `<button role="tab" data-h="${h}" class="${h === horizon ? 'on' : ''}">${h}y</button>`).join('');
}
$('#hz').addEventListener('click', e => {
  const b = e.target.closest('[data-h]'); if (!b) return;
  horizon = +b.dataset.h;
  if (view === 'home' && viewMode() === 'grow') { db.settings.view = 'lump'; persist(); } // picking a year = project that far ahead
  render();
});

function renderHome() {
  // 'grow' = where you stand today (every-month entries add to it as time goes by);
  // 'lump' = the total after the chosen 5/10/20/30-year horizon, if every-month entries continue.
  const m = viewMode(), h = m === 'lump' ? horizon : 0;
  const t = totalsAt(db.entries, rate(), h, undefined, 'grow');
  const when = m === 'lump' ? `In ${horizon} years` : 'Today';
  $$('#h-view button').forEach(b => b.classList.toggle('on', b.dataset.v === m));
  $('#h-view-hint').textContent = m === 'grow'
    ? 'Your savings today. Every-month entries add to it as time goes by.'
    : `Total saved after ${horizon} years if your every-month entries continue. Change the years at the top.`;
  const perMonth = db.entries.filter(e => e.type === 'save' && e.frequency === 'monthly').reduce((s, e) => s + e.amount, 0);
  $('#h-save-fv').textContent = money(t.saveFv);
  $('#h-save-sub').innerHTML = `${when}<br>Put in ${money(t.saveContrib)} · growth +${money(t.saveFv - t.saveContrib)}` + (perMonth ? `<br>+${money(perMonth, perMonth % 1 ? 2 : 0)} added every month` : '');
  $('#h-spend-fv').textContent = money(t.spendNet);
  const assetLine = t.spendAsset > 0 ? `<br>${money(t.spendGrown)} forgone − ${money(t.spendAsset)} asset kept` : '';
  $('#h-spend-sub').innerHTML = `${when}<br>Spent ${money(t.spendAmt)}${assetLine}`;
  const net = t.saveFv - t.spendNet;
  const n = $('#h-net');
  n.hidden = !db.entries.length;
  if (db.entries.length) n.innerHTML = `<b>${money(t.saveFv)}</b> saved vs <b>${money(t.spendNet)}</b> lost: your future self is <b class="${net >= 0 ? 'pos' : 'neg'}">${money(Math.abs(net))} ${net >= 0 ? 'ahead' : 'behind'}</b> at ${db.settings.annualReturnPct}% ${m === 'lump' ? 'over ' + horizon + ' years' : 'today'}.`;
  $('.cur-sym').textContent = db.settings.currency;
  $('#chart').innerHTML = chartSvg(series(db.entries, rate(), Math.max(...db.settings.horizons), undefined, 'grow'));
}

$('#h-view').addEventListener('click', e => {
  const b = e.target.closest('[data-v]'); if (!b) return;
  db.settings.view = b.dataset.v; persist(); renderHome();
});

function chartSvg(pts) {
  const W = 320, H = 150, p = { l: 6, r: 6, t: 8, b: 18 };
  const max = Math.max(1, ...pts.map(d => Math.max(d.save, d.lost)));
  const x = h => p.l + (h / (pts.length - 1 || 1)) * (W - p.l - p.r);
  const y = v => H - p.b - (v / max) * (H - p.t - p.b);
  const path = k => pts.map((d, i) => (i ? 'L' : 'M') + x(d.h).toFixed(1) + ' ' + y(d[k]).toFixed(1)).join('');
  const ticks = db.settings.horizons.filter(h => h < pts.length).map(h => `<text x="${x(h)}" y="${H - 4}" text-anchor="${h === pts.length - 1 ? 'end' : 'middle'}">${h}y</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Saved versus lost over time">
    <line class="ax" x1="${p.l}" x2="${W - p.r}" y1="${H - p.b}" y2="${H - p.b}"/>
    <path class="ln g" d="${path('save')}"/><path class="ln r" d="${path('lost')}"/>${ticks}</svg>`;
}

function renderLog() {
  const f = $('#l-filter .on').dataset.f;
  const rows = db.entries.filter(e => f === 'all' || e.type === f).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  $('#l-empty').hidden = rows.length > 0;
  $('#l-list').innerHTML = rows.map(e => {
    const h = viewMode() === 'lump' ? horizon : 0, w = h ? `in ${h}y` : 'today';
    const v = entryAt(e, rate(), h, undefined, 'grow');
    const fut = e.type === 'save' ? `<span class="pos">${money(v.grown)}</span> ${w}` : `<span class="neg">−${money(v.net)}</span> ${w}`;
    const a = e.asset ? ` · asset ${money(e.asset.value)} @ ${e.asset.depreciationPct}%/yr` : '';
    return `<li class="${e.type}" data-edit="${e.id}"><div><b>${esc(e.label)}</b><small>${e.date}${e.frequency === 'monthly' ? ' · every month' : ''} · ${esc(e.category || '')}${a}${e.note ? '<br>' + esc(e.note) : ''}</small></div>
      <div class="r"><b>${e.type === 'save' ? '+' : '−'}${money(e.amount)}${e.frequency === 'monthly' ? '/mo' : ''}</b><small>${fut}</small><button class="del" data-del="${e.id}" aria-label="Delete">✕</button></div></li>`;
  }).join('');
}
$('#l-filter').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#l-filter button').forEach(x => x.classList.toggle('on', x === b)); renderLog();
});
$('#l-list').addEventListener('click', e => {
  const b = e.target.closest('[data-del]');
  if (!b) { const li = e.target.closest('[data-edit]'); if (li) openEdit(li.dataset.edit); return; }
  if (!confirm('Delete this entry?')) return;
  db.entries = db.entries.filter(x => x.id !== b.dataset.del); persist(); renderLog(); toast('Deleted');
});

// Edit = reopen the Log form filled with the entry; submitting updates it in place (same id, createdAt kept).
function openEdit(id) {
  const e = db.entries.find(x => x.id === id); if (!e) return;
  go('add'); editingId = id;
  $('#title').textContent = 'Edit decision';
  $('#f-submit').textContent = 'Update decision'; $('#f-cancel').hidden = false;
  setType(e.type); setFreq(e.frequency === 'monthly' ? 'monthly' : 'once');
  $('#f-amt').value = e.amount; $('#f-label').value = e.label || ''; $('#f-cat').value = e.category || ''; renderChips();
  $('#f-note').value = e.note || ''; $('#f-date').value = e.date;
  const has = !!e.asset;
  $('#f-has-asset').checked = has; $('#f-asset-fields').hidden = !has;
  if (has) { $('#f-asset-val').value = e.asset.value; $('#f-asset-dep').value = e.asset.depreciationPct; }
  previewUpdate();
}
$('#f-cancel').addEventListener('click', () => go('log'));

// ---------- quick simulator (nothing is saved) ----------
let qmode = 'once';
const parseAmt = s => parseFloat(String(s).replace(/[^0-9.]/g, '')) || 0;
function clearSim(msg) { $('#q-echo').textContent = ''; $('#q-out').innerHTML = ''; $('#q-note').textContent = msg || ''; }
function renderSim() { // runs only when "Simulate" is pressed
  $('.cur-sym').textContent = db.settings.currency;
  const amt = parseAmt($('#q-amt').value), r = rate();
  if (!(amt > 0)) { clearSim('Enter an amount first, then tap Simulate.'); return; }
  $('#q-amt').blur();
  const per = qmode === 'once' ? 'invested once' : 'invested every month';
  $('#q-echo').textContent = `${money(amt, amt % 1 ? 2 : 0)} ${per} at ${db.settings.annualReturnPct}% a year`;
  $('#q-out').innerHTML = db.settings.horizons.map(h => {
    const v = qmode === 'once' ? fv(amt, r, h) : fvMonthly(amt, r, h);
    const put = qmode === 'once' ? amt : amt * 12 * h;
    return `<div class="qrow"><span>${h} years</span><b class="pos">${money(v)}</b><small>You put in ${money(put, put % 1 ? 2 : 0)} · growth +${money(v - put)}</small></div>`;
  }).join('');
  $('#q-note').textContent = qmode === 'month' ? 'Payments at the start of each month, the first one today.' : '';
  $('#q-echo').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#q-go').addEventListener('click', renderSim);
// carry the simulated amount into the Log form
$('#q-log').addEventListener('click', () => {
  const v = parseAmt($('#q-amt').value);
  go('add');
  setFreq(qmode === 'month' ? 'monthly' : 'once');
  if (v > 0) { $('#f-amt').value = v; previewUpdate(); }
});
$('#q-amt').addEventListener('input', () => clearSim(''));
$('#q-amt').addEventListener('keydown', e => { if (e.key === 'Enter') renderSim(); });
$('#q-amt').addEventListener('focus', e => e.target.select());
$('#q-mode').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  qmode = b.dataset.m; $$('#q-mode button').forEach(x => x.classList.toggle('on', x === b)); clearSim('');
});

// ---------- add form ----------
let ftype = 'save', ffreq = 'once';
function setFreq(q) {
  ffreq = q;
  $$('#f-freq button').forEach(b => b.classList.toggle('on', b.dataset.q === q));
  $('#f-amt-lbl').textContent = q === 'monthly' ? 'Amount every month' : 'Amount';
  previewUpdate();
}
$('#f-freq').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setFreq(b.dataset.q); });
// Known categories = built-ins + any saved in settings + any used by entries (so imports are covered).
function allCats() {
  const seen = new Map();
  [...CATS, ...(db.settings.categories || []), ...db.entries.map(e => e.category)].forEach(c => {
    c = (c || '').trim(); if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  });
  return [...seen.values()];
}
function renderChips() {
  const cur = $('#f-cat').value.trim().toLowerCase();
  $('#f-chips').innerHTML = allCats().map(c => `<button type="button" class="${c.toLowerCase() === cur ? 'on' : ''}" data-cat="${esc(c).replace(/"/g, '&quot;')}">${esc(c)}</button>`).join('');
}
$('#f-chips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) { $('#f-cat').value = b.dataset.cat; renderChips(); } });
$('#f-cat').addEventListener('input', renderChips);
let editingId = null;
function resetForm() {
  editingId = null; $('#f-submit').textContent = 'Save decision'; $('#f-cancel').hidden = true;
  $('#f').reset(); renderChips(); $('#f-date').value = today(); setType('save'); setFreq('once'); $('#f-asset-fields').hidden = true; $('#f-asset-dep').value = 20; }
function setType(t) {
  ftype = t;
  $$('#f-type button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('#f-asset-box').hidden = t !== 'spend';
  $('#f').dataset.type = t;
  previewUpdate();
}
$('#f-type').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setType(b.dataset.t); });
$('#f-has-asset').addEventListener('change', e => { $('#f-asset-fields').hidden = !e.target.checked; previewUpdate(); });
$('#f').addEventListener('input', previewUpdate);

function draft() {
  const amount = parseFloat($('#f-amt').value);
  if (!(amount > 0)) return null;
  const e = { type: ftype, frequency: ffreq, amount, date: $('#f-date').value || today() };
  if (ftype === 'spend' && $('#f-has-asset').checked) {
    const value = parseFloat($('#f-asset-val').value) || 0;
    const dep = parseFloat($('#f-asset-dep').value);
    e.asset = { value, depreciationPct: isNaN(dep) ? 0 : dep };
  }
  return e;
}
function previewUpdate() {
  const d = draft(), el = $('#f-prev');
  if (!d) { el.innerHTML = 'Enter an amount to see what this decision means for future you.'; return; }
  const cells = db.settings.horizons.map(h => {
    const v = entryAt({ ...d, date: today() }, rate(), h, new Date(today() + 'T00:00:00').getTime(), 'grow'); // "now" = start of today, so the preview matches the simulator exactly
    return `<div><small>${h}y</small><b class="${d.type === 'save' ? 'pos' : 'neg'}">${d.type === 'save' ? '+' : '−'}${money(v.net)}</b></div>`;
  }).join('');
  const per = d.frequency === 'monthly' ? ' every month, indefinitely,' : '';
  el.innerHTML = `<div class="lbl">${d.type === 'save' ? 'Saving' : 'Spending'} ${money(d.amount)}${per} at ${db.settings.annualReturnPct}% ${d.type === 'save' ? 'grows to' : 'really costs you'}</div><div class="cells">${cells}</div>` +
    (d.asset ? `<small>after counting the asset you keep (${money(d.asset.value)} today, ${d.asset.depreciationPct}%/yr)</small>` : '');
}
$('#f').addEventListener('submit', e => {
  e.preventDefault();
  const d = draft(); if (!d) return;
  let cat = $('#f-cat').value.trim();
  const known = allCats().find(c => c.toLowerCase() === cat.toLowerCase());
  if (known) cat = known; else db.settings.categories = [...(db.settings.categories || []), cat];
  const fields = { label: $('#f-label').value.trim(), category: cat, note: $('#f-note').value.trim(), ...d };
  if (editingId) {
    const i = db.entries.findIndex(x => x.id === editingId);
    if (i >= 0) {
      const upd = { ...db.entries[i], ...fields, updatedAt: new Date().toISOString() };
      if (!d.asset) delete upd.asset; // asset box was cleared or the entry became a save
      db.entries[i] = upd;
    }
    persist(); toast('Entry updated'); go('log');
    return;
  }
  db.entries.push({ id: uid(), createdAt: new Date().toISOString(), ...fields });
  persist(); toast(d.type === 'save' ? 'Saved for future you' : 'Spend logged'); go('home');
});

// ---------- settings & data ----------
function renderSettings() {
  $('#s-rate').value = db.settings.annualReturnPct;
  $('#s-cur').value = db.settings.currency;
  $('#s-hz').value = db.settings.horizons.join(',');
}
$('#s-form').addEventListener('submit', e => {
  e.preventDefault();
  const r = parseFloat($('#s-rate').value);
  const hz = [...new Set($('#s-hz').value.split(',').map(s => parseInt(s, 10)).filter(n => n > 0 && n <= 100))].sort((a, b) => a - b);
  if (isNaN(r) || !hz.length) { toast('Check rate and horizons'); return; }
  db.settings = { ...db.settings, annualReturnPct: r, currency: $('#s-cur').value.trim() || '$', horizons: hz };
  if (!hz.includes(horizon)) horizon = hz[Math.min(1, hz.length - 1)];
  persist(); render(); toast('Settings saved');
});
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const stamp = () => new Date().toISOString().slice(0, 10);
$('#x-json').onclick = () => {
  download(`futureme-${stamp()}.json`, JSON.stringify({ schema: SCHEMA, exportedAt: new Date().toISOString(), ...db }, null, 2), 'application/json');
  $('#x-status').textContent = `Exported ${db.entries.length} entries.`;
};
$('#x-csv').onclick = () => {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['id', 'date', 'type', 'amount', 'frequency', 'label', 'category', 'note', 'asset_value', 'asset_depreciation_pct', 'created_at'];
  const rows = db.entries.map(e => [e.id, e.date, e.type, e.amount, e.frequency || 'once', e.label, e.category, e.note, e.asset?.value, e.asset?.depreciationPct, e.createdAt].map(q).join(','));
  download(`futureme-${stamp()}.csv`, [head.join(','), ...rows].join('\n'), 'text/csv');
  $('#x-status').textContent = `Exported ${db.entries.length} entries.`;
};
$('#x-import').onclick = () => $('#x-file').click();
$('#x-file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.schema !== SCHEMA || !Array.isArray(d.entries)) throw new Error('Unrecognised file');
    const have = new Set(db.entries.map(x => x.id));
    const add = d.entries.filter(x => x.id && !have.has(x.id) && x.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && (x.type === 'save' || x.type === 'spend'));
    add.forEach(x => { if (x.frequency !== 'monthly') x.frequency = 'once'; });
    db.entries.push(...add); persist(); render();
    $('#x-status').textContent = `Imported ${add.length} new entries (${d.entries.length - add.length} skipped).`;
  } catch (err) { $('#x-status').textContent = 'Import failed: ' + err.message; }
};
$('#x-wipe').onclick = () => {
  if (!confirm('Erase ALL entries and settings? Export first if unsure.')) return;
  if (!confirm('This cannot be undone. Erase everything?')) return;
  db = { settings: { ...DEFAULTS }, entries: [] }; persist(); render(); toast('All data erased');
};

// Reload the newest code: drop the offline cache and service worker (entries live in localStorage and are kept).
const APP_VERSION = '18';
$('#app-ver').textContent = APP_VERSION;
$('#x-update').onclick = async () => {
  try {
    if (navigator.serviceWorker) (await navigator.serviceWorker.getRegistrations()).forEach(r => r.unregister());
    if (window.caches) (await caches.keys()).forEach(k => caches.delete(k));
  } catch (_) {}
  location.href = location.pathname + '?r=' + Date.now();
};

// ---------- boot ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
go('home');
})();
