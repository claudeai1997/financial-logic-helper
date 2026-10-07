// Pure calculation functions (no DOM), so they can be unit-tested and reused.
const YEAR_MS = 365.25 * 24 * 3600 * 1000;

// Years elapsed between an ISO date (YYYY-MM-DD) and `now`; never negative.
function yearsSince(dateStr, now) {
  const t = new Date(dateStr + 'T00:00:00').getTime();
  return Math.max(0, ((now || Date.now()) - t) / YEAR_MS);
}

// Compound a lump sum: amount * (1 + r)^years, r as a fraction (0.05).
function fv(amount, r, years) {
  return amount * Math.pow(1 + r, years);
}

// Asset value `years` after the decision, given value at decision date and yearly depreciation fraction.
function assetValue(entry, years) {
  if (!entry.asset) return 0;
  return entry.asset.value * Math.pow(1 - entry.asset.depreciationPct / 100, years);
}

// Value of one entry `h` years from now (h=0 -> today).
// mode 'lump': every entry counts as a single deposit of `amount` on its date.
// mode 'grow': a monthly entry repeats every month, indefinitely, first payment one month after its date
//              (end-of-month convention, identical to fvMonthly so the simulator and the tracker agree).
// Saved: grown money. Spent: opportunity lost = what the money would have become minus the asset(s) still held.
function entryAt(entry, rate, h, now, mode) {
  const t = yearsSince(entry.date, now) + h;
  const spend = entry.type === 'spend';
  let grown, asset = 0, contrib;
  if (entry.frequency === 'monthly' && mode === 'grow') {
    const n = Math.floor(t * 12 + 1e-9);
    grown = 0; contrib = entry.amount * n;
    for (let k = 1; k <= n; k++) {
      const age = t - k / 12;
      grown += fv(entry.amount, rate, age);
      if (spend) asset += assetValue(entry, age);
    }
  } else {
    grown = fv(entry.amount, rate, t); contrib = entry.amount;
    if (spend) asset = assetValue(entry, t);
  }
  return { grown, asset, contrib, net: spend ? grown - asset : grown };
}

function totalsAt(entries, rate, h, now, mode) {
  const o = { saveContrib: 0, saveFv: 0, spendAmt: 0, spendGrown: 0, spendAsset: 0, spendNet: 0 };
  for (const e of entries) {
    const v = entryAt(e, rate, h, now, mode);
    if (e.type === 'save') { o.saveContrib += v.contrib; o.saveFv += v.grown; }
    else { o.spendAmt += v.contrib; o.spendGrown += v.grown; o.spendAsset += v.asset; o.spendNet += v.net; }
  }
  return o;
}

// Monthly contributions at end of each month, effective annual rate r; returns balance after `years`.
function fvMonthly(pmt, r, years) {
  const n = Math.round(years * 12);
  if (r === 0) return pmt * n;
  const m = Math.pow(1 + r, 1 / 12) - 1;
  return pmt * (Math.pow(1 + m, n) - 1) / m;
}

// Yearly series 0..maxH for the chart.
function series(entries, rate, maxH, now, mode) {
  const pts = [];
  for (let h = 0; h <= maxH; h++) {
    const t = totalsAt(entries, rate, h, now, mode);
    pts.push({ h, save: t.saveFv, lost: t.spendNet });
  }
  return pts;
}

if (typeof module !== 'undefined') module.exports = { yearsSince, fv, fvMonthly, assetValue, entryAt, totalsAt, series };
