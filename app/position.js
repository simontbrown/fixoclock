/* ------------------------------------------------------------------
   "Which deal?" page. A deliberately small front end on the
   mortgage-position engine (position-engine.js). One answer, one
   chart, one slider. Plain English, pounds and percentages, never
   "you should". Break-evens, not verdicts.
   ------------------------------------------------------------------ */
(function () {
  const $ = id => document.getElementById(id);
  const num = id => parseFloat($(id).value);
  const E = window.PositionEngine, FX = window.Engine, M = () => window.MARKET;
  const gbp = x => (x < 0 ? "−" : "") + "£" + Math.abs(Math.round(x)).toLocaleString("en-GB");
  const pct = x => x.toFixed(2) + "%";
  const ppt = bp => Math.abs(bp / 100).toFixed(2) + "%";
  const PINK = "#f050f8", INK = "#180048", SUN = "#e0a800";
  const H = 60;                 // always compare over five years
  const KEY = "fixoclock.position2";
  let mode = "A", base = null, ltv = 75, extra = { 7: null, 10: null };
  const touched = new Set();
  const ids = ["bal", "term", "cur", "left", "erc", "o2", "o5", "fee"];

  const set = (id, v) => { $(id).value = v; };

  // Market inputs come straight from the live curve; nothing for the user to edit.
  const market = () => {
    const m = M(), p = m.pillars || {};
    return {
      ois: { 1: p.OIS_1Y, 2: p.OIS_2Y, 3: p.OIS_3Y, 4: p.OIS_4Y, 5: p.OIS_5Y, 7: extra[7] ?? p.OIS_5Y, 10: extra[10] ?? p.OIS_5Y },
      quoted: { 2: FX.impliedFix(0, 2, ltv), 3: FX.impliedFix(0, 3, ltv), 5: FX.impliedFix(0, 5, ltv) },
      spreadBp: Math.round((FX.spreadFor(ltv) + (m.termPremium[2] || 0)) * 100),
      svr: m.svr, relockBp: 25, relockFrictionBp: 5, applyRelock: true, discountRate: null,
    };
  };

  function fillFromCalculator() {
    try {
      const c = JSON.parse(localStorage.getItem("fixoclock.inputs") || "null");
      if (!c) return;
      if (c.balance) set("bal", c.balance);
      if (c.termYears) set("term", c.termYears);
      if (c.currentRate != null) set("cur", c.currentRate);
      if (c.dealEnd) set("left", Math.max(1, Math.round(FX.monthsBetween(M().asOf, c.dealEnd))));
      if (c.fee != null) set("fee", c.fee);
      if (c.ercPct != null) set("erc", c.ercPct);
      if (c.balance && c.value) ltv = c.balance / c.value * 100;
      $("prefill-note").classList.remove("hidden");
    } catch (_) {}
  }
  function fillOffers(force) {
    if (force || !touched.has("o2")) set("o2", FX.impliedFix(0, 2, ltv).toFixed(2));
    if (force || !touched.has("o5")) set("o5", FX.impliedFix(0, 5, ltv).toFixed(2));
    $("typical-note").textContent = `We've filled in today's typical rates for a ${Math.round(ltv)}% loan-to-value. Replace them with the rates you've actually been offered.`;
  }
  const save = () => { try { const s = { mode, ltv, touched: [...touched] }; ids.forEach(k => s[k] = $(k).value); localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} };
  const load = () => { try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (!s) return false; ids.forEach(k => { if (k in s) set(k, s[k]); }); (s.touched || []).forEach(k => touched.add(k)); if (s.ltv) ltv = s.ltv; if (s.mode) mode = s.mode; return true; } catch (_) { return false; } };

  const monthLabel = m => FX.addMonths(M().asOf, m).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const drawChart = (routes) => {
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
    let h = `<table class="ledger"><thead><tr><th>${title}</th><th>Rate</th><th>Months</th><th>Monthly</th><th>Fee</th></tr></thead><tbody>`;
    res.legs.forEach((l, i) => { if (i >= res.pays.length) return; const c = (l.fee || 0) + (l.upfront || 0); h += `<tr><td>${l.label || ""}${l.fwd ? ' <span class="muted">(market price today)</span>' : ""}</td><td>${pct(l.rate)}</td><td>${l.months}</td><td>${gbp(res.pays[i])}</td><td>${c ? gbp(c) : "—"}</td></tr>`; });
    h += `<tr><td>All the payments, in today's money</td><td></td><td></td><td colspan="2">${gbp(res.pvPayments)}</td></tr>`;
    h += `<tr><td>Fees paid upfront, in today's money</td><td></td><td></td><td colspan="2">${gbp(res.pvUpfront)}</td></tr>`;
    h += `<tr><td>Still owed at the end, in today's money</td><td></td><td></td><td colspan="2">${gbp(res.pvTerminal)}</td></tr>`;
    h += `<tr class="tot${win ? " win" : ""}"><td>Total cost</td><td></td><td></td><td colspan="2">${gbp(res.tco)}</td></tr></tbody></table>`;
    return h;
  };

  // ---------- A: deal ending, 2-year or 5-year ----------
  const runA = () => {
    const m = market(), loan = { balance: num("bal"), termMonths: Math.round(num("term") * 12) }, fee = num("fee") || 0;
    const five = [{ rate: num("o5"), months: 60, fee, feeAdded: true, label: "5-year deal at " + pct(num("o5")) }];
    const two = E.chain(m, { rate: num("o2"), months: 24, fee, feeAdded: true, label: "2-year deal at " + pct(num("o2")) }, [2, 1], fee, true, 0);
    const c = E.compare(loan, five, two, H, m);
    base = { c, two, five, loan, m };
    const fiveWins = c.advantageB < 0, adv = Math.abs(c.advantageB);
    const fwd2 = E.forwardMortgageRate(m, 2, 2), beRate = fwd2 + (c.breakevenBp || 0) / 100;
    $("lead").innerHTML = `The <b>${fiveWins ? "5-year" : "2-year"} deal</b> costs <b>${gbp(adv)} less</b> over five years.`;
    $("sub").innerHTML = fiveWins
      ? `That's because a 2-year deal means taking another deal in ${monthLabel(24)}, and the market currently prices that at about ${pct(fwd2)}.`
      : `That's even after taking another deal in ${monthLabel(24)} at the ${pct(fwd2)} the market currently prices.`;
    $("sub2").innerHTML = c.breakevenBp == null ? "" : fiveWins
      ? `The 2-year deal would only win if rates in ${monthLabel(24)} come in <b>${ppt(c.breakevenBp)} lower</b> than that, at ${pct(beRate)} or below. It's about ${gbp(-c.perMonth)} a month either way.`
      : `The 5-year deal would only win if rates in ${monthLabel(24)} come in <b>${ppt(c.breakevenBp)} higher</b> than that. It's about ${gbp(c.perMonth)} a month either way.`;
    $("wiq").textContent = `The market's price for deals in ${monthLabel(24)} is a best guess, not a promise. Slide to see what happens if it's wrong.`;
    $("chartTitle").textContent = "What you'd pay each month";
    $("chart-note").textContent = "The step in the pink line is where the 2-year deal ends and the next one starts, at today's market price for that date.";
    drawChart([
      { name: "5-year deal", sched: c.ra.sched, color: INK },
      { name: "2-year deal, then another", sched: c.rb.sched, color: PINK },
    ]);
    $("ledger").innerHTML = ledger("5-year deal", c.ra, fiveWins) + ledger("2-year deal, then another", c.rb, !fiveWins);
    whatIf();
  };

  // ---------- B: still in a deal, leave or stay ----------
  const runB = () => {
    const m = market(), loan = { balance: num("bal"), termMonths: Math.round(num("term") * 12) }, fee = num("fee") || 0;
    const left = Math.max(1, Math.round(num("left"))), cur = num("cur"), off = num("o5"), ercPct = num("erc") || 0;
    const erc = loan.balance * ercPct / 100;
    const stayShort = [{ rate: cur, months: left, label: "Stay at " + pct(cur) + " until the deal ends" }];
    const offer = { rate: off, months: 60, fee, feeAdded: true, upfront: 0, label: "Leave now, 5-year deal at " + pct(off) };
    const sw = [{ ...offer, upfront: erc }];
    const cS = E.compare(loan, stayShort, sw, left, m);
    const beRate = E.breakevenSwitchRate(loan, stayShort, offer, erc, left, m);
    const rest = [2, 1, 2, 2].reduce((acc, ty) => (acc.reduce((s, x) => s + x, 0) * 12 + left < H ? [...acc, ty] : acc), []);
    const stayLong = E.chain(m, stayShort[0], rest, fee, true, 0);
    const cL = E.compare(loan, stayLong, sw, H, m);
    base = { c: cL, loan, m, sw, stayLong };
    const stayWins = cS.advantageB < 0;
    const payNow = E.annuity(loan.balance, cur, loan.termMonths), payNew = E.annuity(loan.balance + fee, off, loan.termMonths);
    $("lead").innerHTML = stayWins
      ? `<b>Staying</b> costs <b>${gbp(-cS.advantageB)} less</b> than leaving now.`
      : `<b>Leaving now</b> costs <b>${gbp(cS.advantageB)} less</b> than staying.`;
    $("sub").innerHTML = `Leaving would ${payNew < payNow ? "cut" : "raise"} your payment by ${gbp(Math.abs(payNow - payNew))} a month, but it costs ${gbp(erc)} in charges${fee ? ` plus a ${gbp(fee)} fee` : ""}, and your current deal only has ${left} month${left === 1 ? "" : "s"} left.`;
    $("sub2").innerHTML = beRate == null
      ? `No new rate would make leaving pay before your deal ends. Looking five years out, ${cL.advantageB < 0 ? "staying" : "leaving"} still comes out ${gbp(Math.abs(cL.advantageB))} cheaper.`
      : `Leaving would break even if the new deal were <b>${pct(beRate)}</b>. Looking five years out, ${cL.advantageB < 0 ? "staying" : "leaving"} comes out ${gbp(Math.abs(cL.advantageB))} cheaper.`;
    $("wiq").textContent = "If you stay, you'll need a new deal when this one ends. The market's price for that is a best guess. Slide to see what happens if it's wrong.";
    $("chartTitle").textContent = "What you'd pay each month: stay or leave";
    $("chart-note").textContent = "The step in the pink line is where your current deal ends and the next one starts, at today's market price for that date.";
    drawChart([
      { name: "Stay, then a new deal", sched: cL.ra.sched, color: PINK },
      { name: "Leave now, 5-year deal", sched: cL.rb.sched, color: INK },
    ]);
    $("ledger").innerHTML = ledger("Stay, then a new deal", cL.ra, cL.advantageB < 0) + ledger("Leave now", cL.rb, cL.advantageB >= 0);
    whatIf();
  };

  const whatIf = () => {
    if (!base) return;
    const dl = parseInt($("wi").value);
    $("wiv").textContent = dl === 0 ? "as the market expects" : ppt(dl) + (dl > 0 ? " higher" : " lower");
    const { loan, m } = base, d = E.disc(m);
    const shift = legs => legs.map(l => l.fwd ? { ...l, rate: l.rate + dl / 100 } : l);
    let adv, txt;
    if (mode === "A") { const ra = E.simulate(loan, base.five, H, d, m.svr), rb = E.simulate(loan, shift(base.two), H, d, m.svr); adv = ra.tco - rb.tco; txt = adv < 0 ? `the 5-year deal costs <b>${gbp(-adv)} less</b>.` : `the 2-year deal costs <b>${gbp(adv)} less</b>.`; }
    else { const ra = E.simulate(loan, shift(base.stayLong), H, d, m.svr), rb = E.simulate(loan, base.sw, H, d, m.svr); adv = ra.tco - rb.tco; txt = adv < 0 ? `staying costs <b>${gbp(-adv)} less</b> over five years.` : `leaving now costs <b>${gbp(adv)} less</b> over five years.`; }
    $("wia").innerHTML = (dl === 0 ? "At the market's price, " : `If rates come in ${ppt(dl)} ${dl > 0 ? "higher" : "lower"}, `) + txt;
  };

  // ---------- wiring ----------
  const run = () => { try { $("results").classList.remove("hidden"); mode === "A" ? runA() : runB(); } catch (e) { $("lead").textContent = "Check the numbers: " + e.message; $("sub").textContent = ""; $("sub2").textContent = ""; } save(); };
  const setMode = m => {
    mode = m;
    $("modeA").setAttribute("aria-pressed", m === "A"); $("modeB").setAttribute("aria-pressed", m === "B");
    document.querySelectorAll(".onlyA").forEach(el => el.classList.toggle("hidden", m !== "A"));
    document.querySelectorAll(".onlyB").forEach(el => el.classList.toggle("hidden", m !== "B"));
    $("o5-label").textContent = m === "A" ? "5-year deal you've been offered" : "5-year deal you could move to";
    $("wi").value = 0; run();
  };
  async function loadLongSwaps() {
    try {
      const r = await fetch(M().feedUrl.replace(/\/api\/.*$/, "/api/data/sonia-history"), { cache: "no-store", credentials: "omit" });
      const rows = (await r.json()).data.values, head = rows[0], last = rows[rows.length - 1];
      const i7 = head.indexOf("7Y"), i10 = head.indexOf("10Y");
      if (i7 > 0) extra[7] = parseFloat(last[i7]);
      if (i10 > 0) extra[10] = parseFloat(last[i10]);
      if (base) run();
    } catch (_) {}
  }
  ids.forEach(k => $(k).addEventListener("input", () => { touched.add(k); $("wi").value = 0; run(); }));
  $("wi").addEventListener("input", whatIf);
  $("modeA").addEventListener("click", () => setMode("A"));
  $("modeB").addEventListener("click", () => setMode("B"));
  document.addEventListener("market:updated", () => { fillOffers(false); if (base) run(); });

  if (!load()) fillFromCalculator();
  fillOffers(false);
  loadLongSwaps();
  setMode(mode);
})();
