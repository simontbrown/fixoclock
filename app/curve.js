/* ------------------------------------------------------------------
   Curve bootstrap – turns SONIA OIS pillars into a monthly forward path.
   Simple money-market method:
     DF(T) = 1 / (1 + r(T)·T)      z(T) = -ln DF(T) / T   (linear in z)
     F(t1,t2) = (DF(t1)/DF(t2) - 1) / (t2 - t1)
   ------------------------------------------------------------------ */
window.Curve = (function () {
  const TENOR_YEARS = {
    "1D": 1 / 365, "1W": 7 / 365, "2W": 14 / 365,
    "1M": 1 / 12, "2M": 2 / 12, "3M": 3 / 12, "4M": 4 / 12, "5M": 5 / 12, "6M": 6 / 12,
    "7M": 7 / 12, "8M": 8 / 12, "9M": 9 / 12, "10M": 10 / 12, "11M": 11 / 12,
    "1Y": 1, "18M": 1.5, "2Y": 2, "3Y": 3, "4Y": 4, "5Y": 5,
  };

  // pillars: { "OIS_1M": 3.80, "OIS_2Y": 4.70, ... } or { "1M": ..., "2Y": ... }
  function bootstrap(pillars, months = 84) {
    const pts = [];
    for (const key of Object.keys(pillars)) {
      const tenor = key.replace(/^OIS_/, "");
      const T = TENOR_YEARS[tenor];
      const r = +pillars[key];
      if (T && isFinite(r)) pts.push({ T, z: -Math.log(1 / (1 + (r / 100) * T)) / T });
    }
    pts.sort((a, b) => a.T - b.T);
    if (!pts.length) throw new Error("no usable pillars");

    function z(T) {
      if (T <= pts[0].T) return pts[0].z;
      if (T >= pts[pts.length - 1].T) return pts[pts.length - 1].z;
      for (let i = 1; i < pts.length; i++) {
        if (T <= pts[i].T) {
          const a = pts[i - 1], b = pts[i];
          return a.z + (b.z - a.z) * (T - a.T) / (b.T - a.T);
        }
      }
      return pts[pts.length - 1].z;
    }
    const DF = T => Math.exp(-z(T) * T);

    const last = pts[pts.length - 1].T;
    const fwd = [];
    for (let m = 0; m < months; m++) {
      const t1 = m / 12, t2 = (m + 1) / 12;
      if (t2 <= last) {
        fwd.push(+(((DF(t1) / DF(t2) - 1) * 12) * 100).toFixed(4));
      } else {
        // Beyond the last pillar hold the final 3-month forward flat.
        const a = last - 0.25, b = last;
        fwd.push(+(((DF(a) / DF(b) - 1) / (b - a)) * 100).toFixed(4));
      }
    }
    // Linear-in-zero interpolation leaves saw-tooth kinks at each pillar.
    // A centred 5-month moving average removes them; period averages are
    // unchanged to within a basis point or two.
    const out = fwd.map((_, i) => {
      let s = 0, n = 0;
      for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < fwd.length) { s += fwd[j]; n++; } }
      return +(s / n).toFixed(4);
    });
    out[0] = fwd[0];
    return out;
  }

  const avg = (arr, from, to) => {
    let s = 0, n = 0;
    for (let m = Math.max(0, Math.floor(from)); m < Math.min(arr.length, Math.ceil(to)); m++) { s += arr[m]; n++; }
    return n ? s / n : arr[arr.length - 1];
  };

  return { bootstrap, avg, TENOR_YEARS };
})();
