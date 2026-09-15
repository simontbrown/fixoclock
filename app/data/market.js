/* ------------------------------------------------------------------
   Fix o'clock – market snapshot (fallback when the live API is unreachable)
   Live values come from `feedUrl` via live.js. Pillars below are the
   14 Sept 2026 17:59 close from that feed.
   ------------------------------------------------------------------ */
window.MARKET = (function () {
  // Live SONIA OIS feed. Point this at your own proxy if you don't want
  // the upstream host visible to visitors.
  const feedUrl = "https://pwlbtoday.org/api/sonia-ois";
  const pillars = {
    OIS_1D: 3.73, OIS_1W: 3.7735, OIS_2W: 3.7903, OIS_1M: 3.802, OIS_2M: 3.8513,
    OIS_3M: 3.9152, OIS_4M: 3.9967, OIS_5M: 4.0677, OIS_6M: 4.1321, OIS_7M: 4.2,
    OIS_8M: 4.27, OIS_9M: 4.335, OIS_10M: 4.3968, OIS_11M: 4.4548, OIS_1Y: 4.5007,
    OIS_18M: 4.6302, OIS_2Y: 4.7026, OIS_3Y: 4.7341, OIS_4Y: 4.7438, OIS_5Y: 4.7546,
  };
  return {
    feedUrl,
    source: "snapshot",
    asOf: "2026-09-14",
    asOfLabel: "14 Sept 2026, close",
    pillars,
    previousPillars: null,
    forward: window.Curve.bootstrap(pillars, 84),
    bankRate: 3.75,
    swap2y: pillars.OIS_2Y,
    swap5y: pillars.OIS_5Y,

    // Consumer-facing anchors – update these from Moneyfacts / best-buy tables.
    avg2yr: 5.52,          // Moneyfacts average 2-yr fix, 1 Sept 2026
    avg5yr: 5.65,
    svr: 7.35,             // typical reversion rate
    bestBuy2y60: 4.45,     // typical competitive 2-yr fix at 60% LTV, mid Sept 2026
    // Extra lender margin by LTV band, on top of the 60% LTV anchor.
    ltvBands: [
      { maxLtv: 60, add: 0.00 },
      { maxLtv: 75, add: 0.20 },
      { maxLtv: 85, add: 0.55 },
      { maxLtv: 90, add: 0.95 },
      { maxLtv: 95, add: 1.45 },
    ],
    termPremium: { 2: 0.00, 3: 0.03, 5: 0.05 },
    productFee: 999,
    // One standard deviation of swap-rate moves, percentage points per √month.
    vol: 0.18,

    mpcDates: [
      "2026-09-17", "2026-11-05", "2026-12-17",
      "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-17", "2027-07-29", "2027-09-16", "2027-11-04", "2027-12-16",
    ],
  };
})();
