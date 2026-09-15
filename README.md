# Fix o'clock (working title, fixoclock.co.uk)

Consumer remortgage-timing tool built on the live SONIA swap curve. Information only, no advice.

## Run it

```bash
python -m http.server 8765 --directory app
```

Then open http://localhost:8765. No build step, no dependencies.

Opening `app/index.html` directly from disk also works, but the live feed may be blocked by the browser, in which case the bundled snapshot is used and the page says so.

## What's in `app/`

| File | Purpose |
|---|---|
| `index.html` | Landing page: live market strip, implied Bank Rate chart, how it works, no-advice promise |
| `calculate.html` + `calculate.js` | The calculator: one form, four chart sections, reminder capture |
| `curve.js` | Bootstraps monthly forwards from SONIA OIS pillars |
| `data/market.js` | Snapshot pillars, consumer anchors (best-buy, SVR, LTV margins), MPC dates |
| `live.js` | Fetches the SONIA OIS feed (`feedUrl` in `data/market.js`) every 5 minutes and updates the market object |
| `engine.js` | All calculations: implied fixes, payments, 2-vs-5, ERC break-even, probabilities |
| `charts.js` | Small SVG line and bar charts, no libraries |
| `styles.css` | Look and feel |

## Model in one paragraph

Fixed mortgage rates are priced off swaps, which are priced off the SONIA forward curve. A `years`-year fix locked `t` months from now is estimated as the average forward over `[t, t + years]`, plus a lender margin. The margin is anchored so a 60% LTV 2-year fix today equals `bestBuy2y60` in `data/market.js`, then stepped up by LTV band. Uncertainty is a normal distribution with standard deviation `vol × √t` percentage points, which gives the "middle 50%" bands and the "chance it's higher" figures. Payments use standard amortisation.

## Things to keep updated

- `bestBuy2y60`, `avg2yr`, `avg5yr`, `svr` in `data/market.js` from Moneyfacts or best-buy tables.
- `mpcDates` once the Bank publishes the next year's schedule.
- `ltvBands` if lender pricing by LTV shifts.

## Wording rule

Nothing on the site says "you should". Every result is phrased as what the market implies, with ranges, and a visible note that it is not advice.
