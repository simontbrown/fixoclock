/* ------------------------------------------------------------------
   Calculator page. Reads the form, runs Engine.calculate, draws charts.
   Wording rule: describe what the market implies. Never "you should".
   ------------------------------------------------------------------ */
(function () {
  const $ = id => document.getElementById(id);
  const E = window.Engine, C = window.Charts;
  const gbp = n => "£" + Math.round(Math.abs(n)).toLocaleString("en-GB");
  const gbpSigned = n => (n < 0 ? "−" : "") + gbp(n);
  const pct = x => x.toFixed(2) + "%";
  const pc = p => Math.round(p * 100) + "%";
  const PINK = "#f050f8", INK = "#180048", MINT = "#4ef0c0", LILAC = "#b9a7ea", SUN = "#ffd84d";
  const FIELDS = ["balance", "value", "dealEnd", "currentRate", "termYears", "ercPct", "fee"];
  const KEY = "fixoclock.inputs";

  function readForm() {
    const v = {};
    FIELDS.forEach(f => { v[f] = f === "dealEnd" ? $(f).value : parseFloat($(f).value); });
    return v;
  }
  function restore() {
    try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s) FIELDS.forEach(f => { if (s[f] != null) $(f).value = s[f]; }); } catch (_) {}
  }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {} }

  function ltvNote() {
    const b = parseFloat($("balance").value), h = parseFloat($("value").value);
    if (b > 0 && h > 0) $("ltv-note").textContent = "That's a loan-to-value of about " + Math.round(b / h * 100) + "%.";
  }

  function render() {
    const inp = readForm();
    if (!(inp.balance > 0 && inp.value > 0 && inp.dealEnd && inp.currentRate >= 0 && inp.termYears > 0)) return;
    save(inp);
    const R = E.calculate(inp);
    const M = window.MARKET, r = R.rates, P = R.payments, T = R.twoFive;
    $("results").classList.remove("hidden");
    $("live-note").textContent = M.source === "live" ? "Live market curve, " + M.asOfLabel + "." : "Using a saved curve from " + M.asOfLabel + ".";
    $("ltv-chip").textContent = Math.round(R.ltv) + "% LTV";

    // ---- The one number ----
    if (r.ended) {
      $("one-n").textContent = gbp(P.svr - P.current) + " a month";
      $("one-k").textContent = "is roughly what a typical variable rate costs on top of your old deal.";
      $("one-s").textContent = `Your old payment was about ${gbp(P.current)}. A typical 2-year fix today for your loan-to-value would be about ${gbp(P.fix2)}, a 5-year fix about ${gbp(P.fix5)}.`;
    } else {
      $("one-n").textContent = "about " + gbp(r.payEnd2) + " a month";
      $("one-k").textContent = `is what the market implies for a typical 2-year fix when your deal ends, against ${gbp(P.current)} now.`;
      $("one-s").textContent = `Middle half of outcomes: ${gbp(r.payEnd2lo)} to ${gbp(r.payEnd2hi)}. Doing nothing and rolling onto a typical variable rate would be about ${gbp(P.svr)}.`;
    }

    // ---- Rates ahead ----
    const endLabel = E.fmtDate(inp.dealEnd);
    let plain;
    if (r.ended) {
      plain = `Your deal ended on <b>${endLabel}</b>, so you may already be on your lender's variable rate. Today a typical 2-year fix for your loan-to-value is <b>${pct(r.now2)}</b> and a 5-year fix is <b>${pct(r.now5)}</b>.`;
    } else if (r.inWindow) {
      plain = `Your deal ends on <b>${endLabel}</b>, which is inside the six-month window most lenders allow for reserving a new rate. Today's typical 2-year fix for your loan-to-value is <b>${pct(r.now2)}</b>. By your deal end the market implies about <b>${pct(r.end2)}</b>, with the middle half of outcomes between ${pct(r.end2lo)} and ${pct(r.end2hi)}.`;
    } else {
      plain = `Your deal ends on <b>${endLabel}</b>. Most lenders let you reserve a new rate from <b>${E.fmtDate(r.windowOpens)}</b>. Today's typical 2-year fix for your loan-to-value is <b>${pct(r.now2)}</b>; the market implies about <b>${pct(r.end2)}</b> at your deal end, with the middle half of outcomes between ${pct(r.end2lo)} and ${pct(r.end2hi)}.`;
    }
    $("p-rates").innerHTML = plain;
    $("v-now2").textContent = pct(r.now2);
    $("v-end2").textContent = r.ended ? pct(r.now2) : pct(r.end2);
    $("k-end2").textContent = r.ended ? "Typical 5-year fix today: " + pct(r.now5) : "Market-implied 2-year fix at your deal end";
    $("v-p2").textContent = r.ended ? "–" : pc(r.pHigher2);
    $("n-rates").textContent = r.ended ? "" :
      `In monthly terms, the implied rate at your deal end works out at about ${gbp(r.payEnd2)} a month against ${gbp(r.payNow2)} on today's rate (middle-half range ${gbp(r.payEnd2lo)} to ${gbp(r.payEnd2hi)}). Many lenders let a reserved rate be swapped for a lower one before completion; check yours.`;
    const ticks = r.path.filter(p => p.t % (r.H > 12 ? 6 : 2) === 0 || p.t === r.H).map(p => ({ x: p.t, label: E.fmtMonth(p.date) }));
    const vlines = (!r.ended && r.tEnd <= r.H) ? [{ x: r.tEnd, label: "Deal ends" }] : [];
    C.line($("c-rates"), {
      series: [
        { name: "5-yr", points: r.path.map(p => ({ x: p.t, y: p.r5 })), color: INK, width: 3 },
        { name: "2-yr", points: r.path.map(p => ({ x: p.t, y: p.r2 })), color: PINK },
      ],
      bands: [{ points: r.path.map(p => ({ x: p.t, lo: p.r2lo, hi: p.r2hi })), color: PINK, opacity: .18 }],
      vlines, xTicks: ticks, yLabel: y => y.toFixed(1) + "%", height: 320, aria: "Implied fixed mortgage rates ahead",
    });

    // ---- Monthly payment ----
    const doNothing = P.svr - P.current;
    $("p-pay").innerHTML = `You pay about <b>${gbp(P.current)}</b> a month now. If nothing changed at deal end and you moved to a typical variable rate of ${pct(M.svr)}, that would be about <b>${gbp(P.svr)}</b>, ${gbp(doNothing)} ${doNothing >= 0 ? "more" : "less"}. A typical 2-year fix today would be about <b>${gbp(P.fix2)}</b>; a 5-year fix about <b>${gbp(P.fix5)}</b>.`;
    C.bars($("c-pay"), {
      fmt: gbp, aria: "Monthly payments compared",
      items: [
        { label: "Now", note: pct(inp.currentRate), value: P.current, color: LILAC },
        { label: "Do nothing (SVR)", note: pct(M.svr), value: P.svr, color: SUN },
        { label: "Typical 2-yr fix", note: pct(r.now2), value: P.fix2, color: PINK },
        { label: "Typical 5-yr fix", note: pct(r.now5), value: P.fix5, color: INK },
      ],
    });

    // ---- 2 vs 5 ----
    const diff = T.cost23 - T.cost5;
    $("p-25").innerHTML = `Over five years, one 5-year fix at ${pct(T.now5)} would cost about <b>${gbp(T.cost5)}</b> in interest and fees. A 2-year fix at ${pct(T.now2)} followed by a 3-year fix at the market-implied ${pct(T.r3at24)} would cost about <b>${gbp(T.cost23)}</b>, so the two routes are <b>${gbp(diff)} apart</b> (the ${diff > 0 ? "5-year" : "2-then-3"} route is lower on today's curve). The 2-then-3 route would come out cheaper if the 3-year rate in two years is below <b>${pct(T.breakeven3)}</b>.`;
    C.bars($("c-25"), {
      fmt: gbp, aria: "Five-year cost compared",
      items: [
        { label: "One 5-yr fix", note: "1 fee", value: T.cost5, color: INK },
        { label: "2-yr then 3-yr fix", note: "2 fees", value: T.cost23, color: PINK },
      ],
    });
    $("v-be3").textContent = pct(T.breakeven3);
    $("v-r3").textContent = pct(T.r3lo) + " – " + pct(T.r3hi);
    $("v-p23").textContent = pc(T.pCheaper23);

    // ---- ERC ----
    const ercSec = $("r-erc");
    if (R.erc) {
      const x = R.erc;
      ercSec.classList.remove("hidden");
      const beTxt = isFinite(x.breakevenMonths) ? Math.ceil(x.breakevenMonths) + " months" : "never";
      $("p-erc").innerHTML = x.monthlySaving > 0
        ? `Leaving now would cost about <b>${gbp(x.ercCost)}</b> in early repayment charge plus a ${gbp(x.fee)} fee. Moving from ${pct(inp.currentRate)} to a typical 5-year fix at ${pct(x.newRate)} would lower your payment by about <b>${gbp(x.monthlySaving)} a month</b>, so the exit cost is recovered in about <b>${beTxt}</b>. You have <b>${x.mLeft} months</b> left, so over the rest of your deal the net effect is <b>${gbpSigned(x.net)}</b>.`
        : `Leaving now would cost about <b>${gbp(x.ercCost)}</b> in early repayment charge plus a ${gbp(x.fee)} fee, and a typical 5-year fix today (${pct(x.newRate)}) is higher than your current ${pct(inp.currentRate)}, so your monthly payment would rise by about <b>${gbp(-x.monthlySaving)}</b>. Over the rest of your deal the net effect is <b>${gbpSigned(x.net)}</b>.`;
      C.bars($("c-erc"), {
        fmt: gbp, aria: "Cost of leaving early compared",
        items: [
          { label: "Exit cost", note: "ERC + fee", value: x.ercCost + x.fee, color: SUN },
          x.savingOverDeal >= 0
            ? { label: "Interest saved", note: `over ${x.mLeft} months`, value: x.savingOverDeal, color: MINT }
            : { label: "Extra interest", note: `over ${x.mLeft} months`, value: -x.savingOverDeal, color: "#e0908a" },
        ],
      });
      $("v-ercm").textContent = beTxt;
      $("v-ercleft").textContent = x.mLeft + " months";
      $("v-ercnet").textContent = gbpSigned(x.net);
      $("v-ercnet").style.color = x.net >= 0 ? "#0f9a75" : "#b3261e";
    } else {
      ercSec.classList.add("hidden");
    }

    // ---- Reminder copy ----
    $("remind-text").textContent = r.ended
      ? "Your deal has already ended. We can still send a one-off nudge, and nothing else."
      : r.inWindow ? "Your window is already open. We can nudge you again a month before your deal ends, and nothing else."
      : `Most lenders let you reserve a new rate up to six months before your deal ends. For you that's around ${E.fmtDate(r.windowOpens)}. We can remind you then, and nothing else.`;
  }

  // ---- wiring ----
  restore(); ltvNote();
  $("form").addEventListener("submit", e => { e.preventDefault(); render(); $("results").scrollIntoView({ behavior: "smooth", block: "start" }); });
  $("form").addEventListener("input", () => { ltvNote(); if (!$("results").classList.contains("hidden")) render(); });
  document.addEventListener("market:updated", () => { if (!$("results").classList.contains("hidden")) render(); });
  $("remind-btn").addEventListener("click", () => {
    const email = $("email").value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $("email").focus(); return; }
    try { localStorage.setItem("fixoclock.reminder", JSON.stringify({ email, broker: $("broker").checked, dealEnd: $("dealEnd").value, saved: new Date().toISOString() })); } catch (_) {}
    $("remind-ok").classList.remove("hidden");
  });
  const q = new URLSearchParams(location.search);
  if (q.get("dealEnd")) { $("dealEnd").value = q.get("dealEnd"); ltvNote(); render(); setTimeout(() => $("results").scrollIntoView({ behavior: "smooth", block: "start" }), 150); }
  else if (location.hash === "#results" || localStorage.getItem(KEY)) render();
})();
