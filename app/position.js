/* ------------------------------------------------------------------
   "Which deal?" page. Consumer front end on the mortgage-position
   engine (position-engine.js). Wording rule: plain English, pounds and
   percentages, never "you should". Break-evens, not verdicts.
   ------------------------------------------------------------------ */
(function () {
  const $ = id => document.getElementById(id);
  const num = id => parseFloat($(id).value);
  const E = window.PositionEngine, FX = window.Engine, M = () => window.MARKET;
  const gbp = x => (x < 0 ? "−" : "") + "£" + Math.abs(Math.round(x)).toLocaleString("en-GB");
  const pct = x => x.toFixed(2) + "%";
  const ppt = bp => Math.abs(bp / 100).toFixed(2) + "%";           // basis points → percentage points, unsigned
  const PINK = "#f050f8", INK = "#180048", SUN = "#e0a800";
  const KEY = "fixoclock.position";
  let mode = "A", base = null, extra = { 7: null, 10: null };
  const touched = new Set();

  const ids = ["bal", "value", "term", "cur", "left", "into", "erc", "o2", "o5", "fee", "oth", "feeAdded", "hz",
    "q2", "q3", "q5", "svr", "s1", "s2", "s3", "s4", "s5", "s7", "s10", "spr", "rl", "fr", "applyRl", "dr"];
  const marketIds = ["q2", "q3", "q5", "svr", "s1", "s2", "s3", "s4", "s5", "s7", "s10", "spr"];

  // ---------- defaults ----------
  const ltv = () => { const v = num("value"); return v > 0 ? num("bal") / v * 100 : 75; };
  const set = (id, v) => { const el = $(id); if (el.type === "checkbox") el.checked = !!v; else el.value = v; };

  function fillMarketFromLive(force) {
    const m = M(), p = m.pillars || {}, l = ltv();
    const live = { s1: p.OIS_1Y, s2: p.OIS_2Y, s3: p.OIS_3Y, s4: p.OIS_4Y, s5: p.OIS_5Y, s7: extra[7] ?? p.OIS_5Y, s10: extra[10] ?? p.OIS_5Y };
    for (const k in live) if ((force || !touched.has(k)) && isFinite(live[k])) set(k, (+live[k]).toFixed(3));
    const typical = { q2: FX.impliedFix(0, 2, l), q3: FX.impliedFix(0, 3, l), q5: FX.impliedFix(0, 5, l) };
    for (const k in typical) if (force || !touched.has(k)) set(k, typical[k].toFixed(2));
    if (force || !touched.has("svr")) set("svr", m.svr.toFixed(2));
    if (force || !touched.has("spr")) set("spr", Math.round((FX.spreadFor(l) + (m.termPremium[2] || 0)) * 100));
    $("mkt-src").textContent = (m.source === "live" ? "Live swap curve, " : "Saved swap curve, ") + m.asOfLabel + ". Typical deal rates use our loan-to-value pricing for your " + Math.round(l) + "% LTV.";
  }

  function fillFromCalculator() {
    let c = null;
    try { c = JSON.parse(localStorage.getItem("fixoclock.inputs") || "null"); } catch (_) {}
    if (!c) return false;
    if (c.balance) set("bal", c.balance);
    if (c.value) set("value", c.value);
    if (c.termYears) set("term", c.termYears);
    if (c.currentRate != null) set("cur", c.currentRate);
    if (c.dealEnd) set("left", Math.max(0, Math.round(FX.monthsBetween(M().asOf, c.dealEnd))));
    if (c.fee != null) set("fee", c.fee);
    if (c.ercPct != null) set("erc", c.ercPct);
    $("prefill-note").classList.remove("hidden");
    return true;
  }

  function fillOffersFromTypical(force) {
    const l = ltv();
    if (force || !touched.has("o2")) set("o2", FX.impliedFix(0, 2, l).toFixed(2));
    if (force || !touched.has("o5")) set("o5", FX.impliedFix(0, 5, l).toFixed(2));
  }

  const save = () => { try { const s = { mode }; ids.forEach(k => { const el = $(k); s[k] = el.type === "checkbox" ? el.checked : el.value; }); s.touched = [...touched]; localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} };
  const load = () => { try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (!s) return false; ids.forEach(k => { if (k in s) set(k, s[k]); }); (s.touched || []).forEach(k => touched.add(k)); if (s.mode) mode = s.mode; return true; } catch (_) { return false; } };

  const market = () => ({
    ois: { 1: num("s1"), 2: num("s2"), 3: num("s3"), 4: num("s4"), 5: num("s5"), 7: num("s7"), 10: num("s10") },
    quoted: { 2: num("q2"), 3: num("q3"), 5: num("q5") },
    spreadBp: num("spr"), svr: num("svr"), relockBp: num("rl"), relockFrictionBp: num("fr"),
    applyRelock: $("applyRl").checked, discountRate: $("dr").value === "" ? null : num("dr"),
  });

  const monthLabel = m => { const d = FX.addMonths(M().asOf, m); return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }); };

  // ---------- rendering helpers ----------
  const tile = (cls, value, label, sub, why) => {
    const d = document.createElement("div");
    d.className = "readout " + cls;
    d.innerHTML = `<div class="v">${value}</div><div class="k">${label}</div>${sub ? `<div class="s">${sub}</div>` : ""}${why ? `<details><summary>What this means</summary><p>${why}</p></details>` : ""}`;
    return d;
  };

  const drawChart = (routes, H) => {
    const svg = $("svg"), W = 720, Hh = 300, pl = 60, pr = 16, pt = 18, pb = 34;
    const all = routes.flatMap(r => r.sched.map(p => p.pmt));
    const lo = Math.floor(Math.min(...all) / 100) * 100 - 50, hi = Math.ceil(Math.max(...all) / 100) * 100 + 50;
    const x = t => pl + (W - pl - pr) * t / H, y = v => pt + (Hh - pt - pb) * (1 - (v - lo) / (hi - lo));
    let g = "";
    for (let i = 0; i <= 5; i++) { const v = lo + (hi - lo) * i / 5; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end" class="tick">£${Math.round(v).toLocaleString()}</text>`; }
    for (let m = 0; m <= H; m += 12) g += `<text x="${x(m)}" y="${Hh - 10}" text-anchor="middle" class="tick">${m === 0 ? "now" : "yr " + m / 12}</text>`;
    for (const r of routes) {
      let d = `M ${x(0)} ${y(r.sched[0].pmt)}`, prev = r.sched[0].pmt;
      r.sched.forEach(p => { if (p.pmt !== prev) { d += ` L ${x(p.t - 1)} ${y(prev)} L ${x(p.t - 1)} ${y(p.pmt)}`; prev = p.pmt; } });
      d += ` L ${x(r.sched[r.sched.length - 1].t)} ${y(prev)}`;
      g += `<path d="${d}" fill="none" stroke="${r.color}" stroke-width="${r.w || 3.5}" stroke-dasharray="${r.dash || ""}" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    svg.innerHTML = g;
    $("legend").innerHTML = routes.map(r => `<span><i style="background:${r.color}"></i>${r.name}</span>`).join("");
  };

  const ledger = (title, res, win) => {
    let h = `<table class="ledger"><thead><tr><th>${title}</th><th>Rate</th><th>Months</th><th>Monthly</th><th>Fees</th></tr></thead><tbody>`;
    res.legs.forEach((l, i) => { if (i >= res.pays.length) return; const c = (l.fee || 0) + (l.upfront || 0); h += `<tr><td>${l.label || ""}${l.fwd ? ' <span class="muted">(market-implied)</span>' : ""}</td><td>${pct(l.rate)}</td><td>${l.months}</td><td>${gbp(res.pays[i])}</td><td>${c ? gbp(c) : "—"}</td></tr>`; });
    h += `<tr><td>All the payments, in today's money</td><td></td><td></td><td colspan="2">${gbp(res.pvPayments)}</td></tr>`;
    h += `<tr><td>Fees paid upfront, in today's money</td><td></td><td></td><td colspan="2">${gbp(res.pvUpfront)}</td></tr>`;
    h += `<tr><td>Still owed at the end, in today's money</td><td></td><td></td><td colspan="2">${gbp(res.pvTerminal)} <span class="muted">(${gbp(res.terminal)} owed)</span></td></tr>`;
    h += `<tr class="tot${win ? " win" : ""}"><td>Total cost</td><td></td><td></td><td colspan="2">${gbp(res.tco)}</td></tr></tbody></table>`;
    return h;
  };

  // ---------- mode A: deal ending, 2-year or 5-year ----------
  const runA = () => {
    const m = market(), loan = { balance: num("bal"), termMonths: Math.round(num("term") * 12) };
    const H = parseInt($("hz").value), fee = num("fee"), oth = num("oth") || 0, fa = $("feeAdded").checked, left = Math.max(0, Math.round(num("left")));
    const yrs = H / 12;
    const five = [{ rate: num("o5"), months: 60, fee, feeAdded: fa, upfront: oth, label: "5-year fix at " + pct(num("o5")) }];
    if (H > 60) five.push(...E.chain(m, five[0], [5], fee, fa, oth).slice(1));
    const rest = H <= 24 ? [] : H === 36 ? [1] : H === 60 ? [2, 1] : [2, 2, 2, 2];
    const two = E.chain(m, { rate: num("o2"), months: 24, fee, feeAdded: fa, upfront: oth, label: "2-year fix at " + pct(num("o2")) }, rest, fee, fa, oth);
    const c = E.compare(loan, five, two, H, m);
    const ps = E.paymentShock(loan, num("cur"), left, m, 2);
    const svrRoute = E.chain(m, { rate: m.svr, months: 24, fee: 0, label: "Variable rate " + pct(m.svr) }, rest, fee, fa, oth);
    const inertia = E.compare(loan, svrRoute, five, H, m);
    const rl2 = E.relockValue(loan, 2, m), rl5 = E.relockValue(loan, 5, m);
    base = { c, two, five, loan, m, H };

    const fiveWins = c.advantageB < 0, adv = Math.abs(c.advantageB);
    $("lead").innerHTML = `On today's prices, the <b>${fiveWins ? "5-year" : "2-year"} route</b> costs <b>${gbp(adv)} less</b> over ${yrs} years, once every payment, fee and what you'd still owe are counted.`;
    if (c.breakevenBp != null) {
      const fwd2 = E.forwardMortgageRate(m, 2, 2), beRate = fwd2 + c.breakevenBp / 100;
      $("sub").innerHTML = fiveWins
        ? `For the 2-year route to come out ahead instead, 2-year deals in ${monthLabel(24)} would need to be <b>${pct(beRate)} or lower</b>. That's ${ppt(c.breakevenBp)} below what the market is pricing today. In money terms, about ${gbp(-c.perMonth)} a month either way.`
        : `The 2-year route stays ahead unless 2-year deals in ${monthLabel(24)} come in more than <b>${ppt(c.breakevenBp)} above</b> the market's price of ${pct(fwd2)}. In money terms, about ${gbp(c.perMonth)} a month either way.`;
    } else $("sub").textContent = "";
    $("wiq").textContent = "What if 2-year deals in " + monthLabel(24) + " turn out different from what the market expects?";
    whatIf();

    const f = $("figs"); f.innerHTML = "";
    f.append(
      tile("", (ps.payQuoted - ps.now >= 0 ? "+" : "") + gbp(ps.payQuoted - ps.now) + "/mo", "Your payment when the deal ends", `${gbp(ps.now)} now, about ${gbp(ps.payQuoted)} on today's typical 2-year deal`,
        `Your deal ends in ${left} month${left === 1 ? "" : "s"}. By then your balance will have come down to about ${gbp(ps.balance)}. This is the change in your monthly payment if you moved onto today's typical 2-year rate. It's the jump most people are bracing for.`),
      tile("", "+" + gbp(ps.paySvr - ps.now) + "/mo", "If you do nothing", `${gbp(ps.paySvr)} a month on the variable rate. ${gbp(inertia.advantageB)} more over ${yrs} years than the 5-year fix`,
        `If you let the deal end without arranging a new one, your lender moves you onto its standard variable rate of ${pct(m.svr)}. Over ${yrs} years that path costs ${gbp(inertia.advantageB)} more than taking the 5-year fix now. That's the price of doing nothing.`),
      tile("", gbp(fiveWins ? rl5.pv : rl2.pv), "Your free “lock early” option is worth", `Lock up to 6 months early, switch if a cheaper deal appears. Worth about ${(rl5.netBp / 100).toFixed(2)}% on the rate, more than the ${gbp(fee)} fee`,
        `You can arrange your next deal up to six months before this one ends. If a cheaper deal appears before it starts, you can switch to it. It costs nothing, and on Bank of England data since 2009 it has been worth about a quarter of a percent on the rate. This is what that's worth on your loan, in today's money.`),
      tile("", pct(E.forwardMortgageRate(m, 2, 2, false)), "What the market expects a 2-year deal to cost in 2 years", `Market rate ${pct(E.forwardZero(m.ois, 2, 2))} plus a ${(m.spreadBp / 100).toFixed(2)}% lender margin`,
        `Today's swap prices imply where the market expects 2-year rates to be in two years' time. Add the usual lender margin and you get the rate the 2-year route assumes you'd move onto. It's the market's own price, not our opinion. It can be wrong, and the line above says by how much it would have to be.`)
    );
    $("chartTitle").textContent = "Your monthly payment, route by route";
    const svrRes = E.simulate(loan, svrRoute, H, E.disc(m), m.svr);
    drawChart([
      { name: "5-year fix", sched: c.ra.sched, color: INK },
      { name: "2-year fix, then whatever the market implies", sched: c.rb.sched, color: PINK },
      { name: "Do nothing, then refinance", sched: svrRes.sched, color: SUN, dash: "6 6", w: 2.5 },
    ], H);
    $("ledger").innerHTML = ledger("5-year route", c.ra, fiveWins) + ledger("2-year route", c.rb, !fiveWins);
  };

  // ---------- mode B: mid-deal, leave early or stay ----------
  const runB = () => {
    const m = market(), loan = { balance: num("bal"), termMonths: Math.round(num("term") * 12) };
    const H = parseInt($("hz").value), fee = num("fee"), oth = num("oth") || 0, fa = $("feeAdded").checked;
    const left = Math.max(1, Math.round(num("left"))), into = Math.max(0, Math.round(num("into")));
    const sched = String($("erc").value).split(",").map(s => parseFloat(s)).filter(x => isFinite(x));
    const erc = E.ercNow(loan.balance, sched, into), cur = num("cur"), off = num("o5");
    const stayShort = [{ rate: cur, months: left, label: "Stay at " + pct(cur) + " until the deal ends" }];
    const offer = { rate: off, months: 60, fee, feeAdded: fa, upfront: oth, label: "Leave now, 5-year fix at " + pct(off) };
    const sw = [{ ...offer, upfront: oth + erc }];
    const cS = E.compare(loan, stayShort, sw, left, m);
    const beRate = E.breakevenSwitchRate(loan, stayShort, offer, erc, left, m);
    const rest = H <= left ? [] : [2, 1, 2, 2, 2, 2].reduce((acc, ty) => (acc.reduce((s, x) => s + x, 0) * 12 + left < H ? [...acc, ty] : acc), []);
    const stayLong = E.chain(m, stayShort[0], rest, fee, fa, oth);
    const cL = E.compare(loan, stayLong, sw, H, m);
    base = { c: cL, loan, m, H, sw, stayLong, cS };

    const stayWins = cS.advantageB < 0;
    $("lead").innerHTML = stayWins
      ? `Staying put costs <b>${gbp(-cS.advantageB)} less</b> than leaving now, measured to the end of your current deal.`
      : `Leaving now costs <b>${gbp(cS.advantageB)} less</b> than staying, measured to the end of your current deal.`;
    const beTxt = beRate == null
      ? `No offer rate would make leaving pay before your deal ends: the charge outweighs any saving over ${left} months.`
      : `Leaving would break even if the new deal were <b>${pct(beRate)}</b>. Your offer of ${pct(off)} is ${ppt((beRate - off) * 100)} ${beRate > off ? "better than that" : "short of that"}.`;
    $("sub").innerHTML = beTxt + ` Looking further out, over ${H / 12} years, ${cL.advantageB < 0 ? "staying" : "leaving"} comes out ${gbp(Math.abs(cL.advantageB))} cheaper.`;
    $("wiq").textContent = "What if the deals you move onto after this one turn out different from what the market expects?";
    whatIf();

    const f = $("figs"); f.innerHTML = "";
    const yr = Math.min(Math.floor(into / 12), sched.length - 1);
    f.append(
      tile("", gbp(erc), "Charge to leave today", `${sched[yr] || 0}% of your balance, year ${Math.floor(into / 12) + 1} of the deal`,
        `What your lender charges you for leaving early. It's a fixed percentage of your balance, so it doesn't change when rates move. Any saving from leaving has to clear this first.`),
      tile("", beRate == null ? "—" : pct(beRate), "Break-even offer rate", beRate == null ? "No rate pays for the charge before your deal ends" : "The new rate at which leaving exactly pays for itself",
        `If your new deal were exactly this rate, the interest you'd save by the end of your current deal would just cover the charge and the fee. An offer below it means leaving pays; above it, staying is cheaper.`),
      tile("", gbp(Math.abs(cL.advantageB)), (cL.advantageB < 0 ? "Staying" : "Leaving") + " is cheaper over " + H / 12 + " years by", cL.breakevenBp != null ? `Flips if future deals come in ${ppt(cL.breakevenBp)} ${cL.breakevenBp > 0 ? "higher" : "lower"} than the market expects` : "",
        `The headline only looks to the end of your current deal. This looks further. If you stay, you'll need a new deal when it ends, so we assume you take one at the rate the market implies. If you leave now, you hold the new 5-year fix for its full term. This is the fairer, longer comparison.`),
      tile("", gbp(E.annuity(loan.balance, cur, loan.termMonths) - E.annuity(loan.balance + (fa ? fee : 0), off, loan.termMonths)) + "/mo", "Lower payment if you leave", `${gbp(E.annuity(loan.balance, cur, loan.termMonths))} now vs ${gbp(E.annuity(loan.balance + (fa ? fee : 0), off, loan.termMonths))} on the offer`,
        `This is the number that feels good: a lower payment from next month. But the charge and fee have to be paid back out of it, and only ${left} months of the saving arrive before your deal would have ended anyway. That's why the headline can say "stay" even when this says "save".`)
    );
    $("chartTitle").textContent = "Your monthly payment: stay vs leave now";
    drawChart([
      { name: "Stay, then whatever the market implies", sched: cL.ra.sched, color: PINK },
      { name: "Leave now, 5-year fix", sched: cL.rb.sched, color: INK },
    ], H);
    $("ledger").innerHTML = ledger("Stay until the deal ends, then a new deal", cL.ra, cL.advantageB < 0) + ledger("Leave now", cL.rb, cL.advantageB >= 0);
  };

  const whatIf = () => {
    if (!base) return;
    const dl = parseInt($("wi").value);
    $("wiv").textContent = dl === 0 ? "as the market expects" : ppt(dl) + (dl > 0 ? " higher" : " lower");
    const { loan, m, H } = base, d = E.disc(m);
    const shift = legs => legs.map(l => l.fwd ? { ...l, rate: l.rate + dl / 100 } : l);
    let adv, txt;
    if (mode === "A") { const ra = E.simulate(loan, base.five, H, d, m.svr), rb = E.simulate(loan, shift(base.two), H, d, m.svr); adv = ra.tco - rb.tco; txt = adv < 0 ? `the 5-year route costs <b>${gbp(-adv)} less</b>.` : `the 2-year route costs <b>${gbp(adv)} less</b>.`; }
    else { const ra = E.simulate(loan, shift(base.stayLong), H, d, m.svr), rb = E.simulate(loan, base.sw, H, d, m.svr); adv = ra.tco - rb.tco; txt = adv < 0 ? `staying costs <b>${gbp(-adv)} less</b> over ${H / 12} years.` : `leaving now costs <b>${gbp(adv)} less</b> over ${H / 12} years.`; }
    $("wia").innerHTML = (dl === 0 ? "At the market's own price, " : `If they come in ${ppt(dl)} ${dl > 0 ? "higher" : "lower"}, `) + txt;
  };

  // ---------- wiring ----------
  const run = () => { try { $("results").classList.remove("hidden"); mode === "A" ? runA() : runB(); } catch (e) { $("lead").textContent = "Check the inputs: " + e.message; $("sub").textContent = ""; } save(); };
  const setMode = m => {
    mode = m;
    $("modeA").setAttribute("aria-pressed", m === "A"); $("modeB").setAttribute("aria-pressed", m === "B");
    $("ercBlock").classList.toggle("hidden", m !== "B");
    $("offers-title").textContent = m === "A" ? "The deals you've been offered" : "The deal you could move to";
    $("o2-wrap").classList.toggle("hidden", m !== "B" ? false : true);
    $("wi").value = 0; run();
  };

  async function loadLongSwaps() {
    try {
      const r = await fetch(M().feedUrl.replace(/\/api\/.*$/, "/api/data/sonia-history"), { cache: "no-store", credentials: "omit" });
      const rows = (await r.json()).data.values, head = rows[0], last = rows[rows.length - 1];
      const i7 = head.indexOf("7Y"), i10 = head.indexOf("10Y");
      if (i7 > 0) extra[7] = parseFloat(last[i7]);
      if (i10 > 0) extra[10] = parseFloat(last[i10]);
      fillMarketFromLive(false); if (base) run();
    } catch (_) { /* keep 5y flat extrapolation */ }
  }

  ids.forEach(k => $(k).addEventListener("input", () => {
    touched.add(k);
    if (k === "bal" || k === "value") { fillMarketFromLive(false); fillOffersFromTypical(false); }
    $("wi").value = 0; run();
  }));
  $("wi").addEventListener("input", whatIf);
  $("modeA").addEventListener("click", () => setMode("A"));
  $("modeB").addEventListener("click", () => setMode("B"));
  $("reset-mkt").addEventListener("click", () => { marketIds.forEach(k => touched.delete(k)); fillMarketFromLive(true); run(); });
  document.addEventListener("market:updated", () => { fillMarketFromLive(false); fillOffersFromTypical(false); if (base) run(); });

  const restored = load();
  if (!restored) fillFromCalculator();
  fillMarketFromLive(false);
  fillOffersFromTypical(false);
  loadLongSwaps();
  setMode(mode);
})();
