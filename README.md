# Future Me — spend vs save modeller (PWA)

Static, offline-capable web app. No build step, no backend, no dependencies.

Run locally:  `python3 -m http.server 8765`  → http://localhost:8765
Install on iPhone: host the folder over HTTPS, open in Safari → Share → Add to Home Screen. (Not deployed yet.)

## Files
- `calc.js`  pure maths (compounding, asset depreciation, series). Unit-testable in Node.
- `app.js`   UI + storage.  `style.css`, `index.html`, `sw.js` (offline cache), `manifest.webmanifest`.

## Data (localStorage key `futureme.v1`, also the JSON export format)
```
{ "schema": 1, "exportedAt": ISO, 
  "settings": { "annualReturnPct": 5, "currency": "S$", "horizons": [10,20,30] },
  "entries": [{
     "id": uuid, "createdAt": ISO, "date": "YYYY-MM-DD",
     "type": "save" | "spend", "amount": number,
     "label": str, "category": str, "note": str,
     "asset": { "value": number, "depreciationPct": number }   // spend only, optional
  }] }
```
CSV export has the same fields flattened (asset_value, asset_depreciation_pct).

## Maths
- Value after t years = amount × (1+r)^t, t = years since entry date + horizon.
- Spend, true loss = amount × (1+r)^t − asset.value × (1−dep)^t.
- Import merges by `id` (no duplicates).
