/* ------------------------------------------------------------------
   Live market data
   GET MARKET.feedUrl → latest intraday SONIA OIS pillars (1D … 5Y).
   On success the MARKET object is updated in place; on failure the
   bundled snapshot stays and the page says so.
   ------------------------------------------------------------------ */
window.Live = (function (M) {
  const URL = M.feedUrl;

  function label(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
      ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  async function load() {
    try {
      const r = await fetch(URL, { cache: "no-store", credentials: "omit" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const day = j.current_day || [];
      if (!day.length) throw new Error("empty feed");
      const last = day[day.length - 1];
      const v = last.values;
      M.pillars = v;
      M.forward = window.Curve.bootstrap(v, 84);
      M.asOf = j.current_date || M.asOf;
      M.asOfLabel = label(last.timestamp_iso);
      M.previousPillars = j.previous_day_close ? j.previous_day_close.values : null;
      M.previousDate = j.previous_date || null;
      M.bankRate = Math.round(v.OIS_1D * 4) / 4;
      M.swap2y = v.OIS_2Y;
      M.swap5y = v.OIS_5Y;
      M.source = "live";
      document.dispatchEvent(new CustomEvent("market:updated", { detail: { ok: true } }));
      return { ok: true };
    } catch (e) {
      M.source = "snapshot";
      document.dispatchEvent(new CustomEvent("market:updated", { detail: { ok: false, error: String(e) } }));
      return { ok: false, error: String(e) };
    }
  }

  function nextMpc() {
    const today = new Date(M.asOf);
    for (const d of M.mpcDates) if (new Date(d) >= today) return d;
    return null;
  }

  const ready = load();
  // Feed updates roughly every 15 minutes on business days.
  setInterval(load, 5 * 60 * 1000);
  return { load, ready, nextMpc, URL };
})(window.MARKET);
