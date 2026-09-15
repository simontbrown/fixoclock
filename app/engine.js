/* ------------------------------------------------------------------
   Fix o'clock engine
   Pure functions. No DOM. Everything here is "what the market implies",
   never a recommendation. Reads window.MARKET at call time so live
   updates flow through automatically.
   ------------------------------------------------------------------ */
window.Engine = (function () {
  const M = () => window.MARKET;

  // ---------- maths helpers ----------
  function erf(x) { // Abramowitz & Stegun 7.1.26
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const Phi = z => 0.5 * (1 + erf(z / Math.SQRT2));
  const phi = z => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

  function pmt(B, r, n) {
    const i = r / 100 / 12;
    if (n <= 0) return 0;
    if (i === 0) return B / n;
    return B * i / (1 - Math.pow(1 + i, -n));
  }

  // Month-by-month simulation with a rate schedule [{from, rate}].
  function simulate(B, termMonths, months, schedule) {
    let bal = B, interest = 0, paid = 0, idx = 0;
    let rate = schedule[0].rate, payment = pmt(bal, rate, termMonths);
    for (let m = 0; m < months; m++) {
      while (idx + 1 < schedule.length && schedule[idx + 1].from <= m) {
        idx++; rate = schedule[idx].rate; payment = pmt(bal, rate, termMonths - m);
      }
      const i = bal * rate / 100 / 12;
      const principal = Math.min(bal, payment - i);
      interest += i; paid += payment; bal -= principal;
    }
    return { interest, paid, balance: bal };
  }

  // ---------- curve helpers ----------
  const avgForward = (from, to) => window.Curve.avg(M().forward, from, to);

  // Lender margin over the curve: anchored so a 60% LTV 2-yr fix today equals
  // the observed best-buy level, then stepped up by LTV band.
  function spreadFor(ltv) {
    const m = M();
    const base = m.bestBuy2y60 - avgForward(0, 24);
    for (const band of m.ltvBands) if (ltv <= band.maxLtv) return base + band.add;
    return base + m.ltvBands[m.ltvBands.length - 1].add + 0.6;
  }
  function impliedFix(t, years, ltv) {
    return avgForward(t, t + years * 12) + spreadFor(ltv) + (M().termPremium[years] ?? 0.05);
  }
  const sigma = t => M().vol * Math.sqrt(Math.max(0, t));

  // ---------- dates ----------
  const DAY = 1000 * 60 * 60 * 24;
  const monthsBetween = (a, b) => (new Date(b) - new Date(a)) / (DAY * 30.4375);
  function addMonths(iso, n) { const d = new Date(iso); d.setMonth(d.getMonth() + n); return d; }
  const fmtDate = d => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const fmtMonth = d => new Date(d).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

  // ---------- the calculation ----------
  // inp: { balance, value, dealEnd(ISO), currentRate, termYears, ercPct, fee }
  function calculate(inp) {
    const m = M();
    const today = m.asOf;
    const ltv = inp.value > 0 ? (inp.balance / inp.value) * 100 : 75;
    const termM = Math.max(12, Math.round(inp.termYears * 12));
    const mToEnd = monthsBetween(today, inp.dealEnd);
    const windowOpens = addMonths(inp.dealEnd, -6);
    const inWindow = mToEnd <= 6 && mToEnd > 0;
    const ended = mToEnd <= 0;
    const fee = isFinite(inp.fee) ? inp.fee : m.productFee;

    // 1. Rates ahead
    const H = Math.max(6, Math.min(24, Math.ceil(mToEnd)));
    const path = [];
    for (let t = 0; t <= H; t++) {
      const s = sigma(t), r2 = impliedFix(t, 2, ltv), r5 = impliedFix(t, 5, ltv);
      path.push({ t, date: addMonths(today, t), r2, r5,
        r2lo: r2 - 0.674 * s, r2hi: r2 + 0.674 * s,
        r5lo: r5 - 0.674 * s, r5hi: r5 + 0.674 * s });
    }
    const tEnd = Math.max(0, Math.min(H, mToEnd));
    const now2 = impliedFix(0, 2, ltv), now5 = impliedFix(0, 5, ltv);
    const end2 = impliedFix(tEnd, 2, ltv), end5 = impliedFix(tEnd, 5, ltv);
    const sEnd = sigma(tEnd);
    const pHigher2 = sEnd > 0 ? Phi((end2 - now2) / sEnd) : 0.5;
    const pHigher5 = sEnd > 0 ? Phi((end5 - now5) / sEnd) : 0.5;
    const rates = {
      ltv, H, path, mToEnd, tEnd, inWindow, ended, windowOpens,
      now2, now5, end2, end5, sEnd,
      end2lo: end2 - 0.674 * sEnd, end2hi: end2 + 0.674 * sEnd,
      end5lo: end5 - 0.674 * sEnd, end5hi: end5 + 0.674 * sEnd,
      pHigher2, pHigher5,
      // Monthly payment on the implied rate at deal end vs today's implied rate.
      payNow2: pmt(inp.balance, now2, termM), payEnd2: pmt(inp.balance, end2, termM),
      payEnd2lo: pmt(inp.balance, end2 - 0.674 * sEnd, termM), payEnd2hi: pmt(inp.balance, end2 + 0.674 * sEnd, termM),
    };

    // 2. Monthly payments
    const payments = {
      current: pmt(inp.balance, inp.currentRate, termM),
      svr: pmt(inp.balance, m.svr, termM),
      fix2: pmt(inp.balance, now2, termM),
      fix5: pmt(inp.balance, now5, termM),
    };

    // 3. Two-year vs five-year, 60-month horizon, interest + fees
    const r3at24 = impliedFix(24, 3, ltv), s24 = sigma(24);
    const route5 = simulate(inp.balance, termM, 60, [{ from: 0, rate: now5 }]);
    const route23 = simulate(inp.balance, termM, 60, [{ from: 0, rate: now2 }, { from: 24, rate: r3at24 }]);
    const cost5 = route5.interest + fee, cost23 = route23.interest + 2 * fee;
    let lo = 0, hi = 15;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      const c = simulate(inp.balance, termM, 60, [{ from: 0, rate: now2 }, { from: 24, rate: mid }]).interest + 2 * fee;
      if (c < cost5) lo = mid; else hi = mid;
    }
    const breakeven3 = (lo + hi) / 2;
    const twoFive = {
      now2, now5, r3at24, fee, cost5, cost23, breakeven3,
      interest5: route5.interest, interest23: route23.interest,
      pCheaper23: s24 > 0 ? Phi((breakeven3 - r3at24) / s24) : 0.5,
      r3lo: r3at24 - 0.674 * s24, r3hi: r3at24 + 0.674 * s24,
    };

    // 4. Leaving early (ERC)
    let erc = null;
    if (mToEnd > 0 && inp.ercPct > 0) {
      const mLeft = Math.max(1, Math.round(mToEnd));
      const ercCost = inp.balance * inp.ercPct / 100;
      const newRate = now5;
      const stay = simulate(inp.balance, termM, mLeft, [{ from: 0, rate: inp.currentRate }]);
      const go = simulate(inp.balance, termM, mLeft, [{ from: 0, rate: newRate }]);
      const monthlySaving = payments.current - pmt(inp.balance, newRate, termM);
      const savingOverDeal = stay.interest - go.interest;
      const net = savingOverDeal - ercCost - fee;
      const breakevenMonths = monthlySaving > 0 ? (ercCost + fee) / monthlySaving : Infinity;
      erc = { mLeft, ercCost, fee, newRate, monthlySaving, savingOverDeal, net, breakevenMonths };
    }

    return { input: inp, ltv, termM, rates, payments, twoFive, erc };
  }

  // Market-implied Bank Rate path, stepped at MPC dates (for the market panel).
  function bankRatePath(months = 24) {
    const m = M();
    const out = [];
    for (let t = 0; t <= months; t++) out.push({ t, date: addMonths(m.asOf, t), r: m.forward[Math.min(t, m.forward.length - 1)] });
    return out;
  }

  return { calculate, pmt, impliedFix, spreadFor, sigma, bankRatePath, fmtDate, fmtMonth, addMonths, monthsBetween, Phi, avgForward };
})();
