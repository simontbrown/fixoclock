/* ------------------------------------------------------------------
   Tiny dependency-free SVG charts. Friendly, rounded, readable.
   ------------------------------------------------------------------ */
window.Charts = (function () {
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, text) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  };
  const nice = (lo, hi) => {
    const span = hi - lo || 1, step = Math.pow(10, Math.floor(Math.log10(span / 4)));
    const s = [1, 2, 2.5, 5, 10].map(x => x * step).find(x => span / x <= 5) || step * 10;
    return { lo: Math.floor(lo / s) * s, hi: Math.ceil(hi / s) * s, step: s };
  };

  // Line chart with optional shaded bands.
  // opts: { series:[{name, points:[{x,y}], color, dash}], bands:[{points:[{x,lo,hi}], color}],
  //         xLabel(x), yLabel(y), hlines:[{y,label,color}], vlines:[{x,label}], height }
  function line(container, o) {
    container.innerHTML = "";
    const W = 720, H = o.height || 300, P = { t: 22, r: 24, b: 40, l: 56 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": o.aria || "chart" });
    const xs = [], ys = [];
    (o.series || []).forEach(s => s.points.forEach(p => { xs.push(p.x); ys.push(p.y); }));
    (o.bands || []).forEach(b => b.points.forEach(p => { xs.push(p.x); ys.push(p.lo, p.hi); }));
    (o.hlines || []).forEach(h => ys.push(h.y));
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const yn = nice(Math.min(...ys) - 0.05, Math.max(...ys) + 0.05);
    const X = x => P.l + (x - x0) / ((x1 - x0) || 1) * (W - P.l - P.r);
    const Y = y => H - P.b - (y - yn.lo) / ((yn.hi - yn.lo) || 1) * (H - P.t - P.b);

    // grid + y labels
    for (let y = yn.lo; y <= yn.hi + 1e-9; y += yn.step) {
      svg.appendChild(el("line", { x1: P.l, x2: W - P.r, y1: Y(y), y2: Y(y), class: "grid" }));
      svg.appendChild(el("text", { x: P.l - 10, y: Y(y) + 4, class: "tick", "text-anchor": "end" }, o.yLabel ? o.yLabel(y) : y));
    }
    // x labels
    const ticks = o.xTicks || [];
    ticks.forEach(t => svg.appendChild(el("text", { x: X(t.x), y: H - P.b + 22, class: "tick", "text-anchor": "middle" }, t.label)));

    (o.bands || []).forEach(b => {
      const up = b.points.map(p => `${X(p.x)},${Y(p.hi)}`), down = b.points.slice().reverse().map(p => `${X(p.x)},${Y(p.lo)}`);
      svg.appendChild(el("path", { d: `M${up.join("L")}L${down.join("L")}Z`, fill: b.color, opacity: b.opacity ?? 0.18 }));
    });
    (o.vlines || []).forEach(v => {
      svg.appendChild(el("line", { x1: X(v.x), x2: X(v.x), y1: P.t, y2: H - P.b, class: "vline" }));
      svg.appendChild(el("text", { x: X(v.x) + 6, y: P.t + 12, class: "vlabel" }, v.label));
    });
    (o.hlines || []).forEach(h => {
      svg.appendChild(el("line", { x1: P.l, x2: W - P.r, y1: Y(h.y), y2: Y(h.y), class: "hline", stroke: h.color || "#180048" }));
      svg.appendChild(el("text", { x: W - P.r, y: Y(h.y) - 6, class: "hlabel", "text-anchor": "end", fill: h.color || "#180048" }, h.label));
    });
    (o.series || []).forEach(s => {
      const d = s.points.map((p, i) => `${i ? "L" : "M"}${X(p.x)},${Y(p.y)}`).join("");
      svg.appendChild(el("path", { d, fill: "none", stroke: s.color, "stroke-width": s.width || 3.5, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": s.dash || "none" }));
      const last = s.points[s.points.length - 1];
      svg.appendChild(el("circle", { cx: X(last.x), cy: Y(last.y), r: 5, fill: s.color }));
      if (s.name) svg.appendChild(el("text", { x: X(last.x) - 8, y: Y(last.y) - 10, class: "slabel", "text-anchor": "end", fill: s.color }, s.name));
    });
    container.appendChild(svg);
  }

  // Horizontal bar chart: items [{label, value, color, note}]
  function bars(container, o) {
    container.innerHTML = "";
    const items = o.items, rowH = 54, W = 720, P = { l: 190, r: 110, t: 8, b: 8 };
    const H = P.t + P.b + rowH * items.length;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": o.aria || "bar chart" });
    const max = Math.max(...items.map(i => Math.abs(i.value)), 1e-9);
    const X = v => P.l + Math.abs(v) / max * (W - P.l - P.r);
    items.forEach((it, i) => {
      const y = P.t + i * rowH + 10;
      svg.appendChild(el("text", { x: P.l - 14, y: y + 22, class: "blabel", "text-anchor": "end" }, it.label));
      if (it.note) svg.appendChild(el("text", { x: P.l - 14, y: y + 38, class: "bnote", "text-anchor": "end" }, it.note));
      svg.appendChild(el("rect", { x: P.l, y, width: Math.max(4, X(it.value) - P.l), height: 34, rx: 10, fill: it.color }));
      svg.appendChild(el("text", { x: X(it.value) + 12, y: y + 22, class: "bvalue" }, o.fmt ? o.fmt(it.value) : it.value));
    });
    container.appendChild(svg);
  }

  return { line, bars };
})();
