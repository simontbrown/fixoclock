"""
Fix o'clock news builder.

Reads PUBLIC, read-only JSON from the data site (the same files the browser
already fetches) and writes static pages into app/news/:

  app/news/index.html        evergreen "Mortgage rates today" page
  app/news/YYYY-MM-DD.html   one page per trading day
  app/news/feed.xml          RSS, one item per day

Every sentence of the "homeowner's read" is generated from numbers. Market
commentary sentences are taken from the Pulse feed only after a filter drops
anything written for council treasurers. Nothing here is advice.

Run:  python scripts/build_news.py
No dependencies beyond the standard library.
"""
from __future__ import annotations

import datetime as dt
import html
import json
import math
import os
import re
import sys
import urllib.request

DATA_HOST = "https://pwlbtoday.org"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
OUT = os.path.join(APP, "news")
SITE = "https://simontbrown.github.io/fixoclock"
LTV = 75            # "typical" borrower for the headline numbers
LOAN, TERM_Y = 200_000, 25
DAYS_TO_BUILD = 10  # trading days of daily pages

TENOR_YEARS = {
    "1D": 1 / 365, "1W": 7 / 365, "2W": 14 / 365,
    "1M": 1 / 12, "2M": 2 / 12, "3M": 3 / 12, "4M": 4 / 12, "5M": 5 / 12, "6M": 6 / 12,
    "7M": 7 / 12, "8M": 8 / 12, "9M": 9 / 12, "10M": 10 / 12, "11M": 11 / 12,
    "1Y": 1, "18M": 1.5, "2Y": 2, "3Y": 3, "4Y": 4, "5Y": 5,
}


# ----------------------------------------------------------------------------
# fetch helpers
# ----------------------------------------------------------------------------
def get_json(path: str):
    req = urllib.request.Request(DATA_HOST + path, headers={"User-Agent": "fixoclock-news-builder/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


# ----------------------------------------------------------------------------
# model: mirrors app/curve.js + app/engine.js, constants read from market.js
# ----------------------------------------------------------------------------
def read_market_constants():
    src = open(os.path.join(APP, "data", "market.js"), encoding="utf-8").read()
    num = lambda key: float(re.search(rf"{key}:\s*(-?[\d.]+)", src).group(1))
    bands = [(int(a), float(b)) for a, b in re.findall(r"\{\s*maxLtv:\s*(\d+),\s*add:\s*([\d.]+)\s*\}", src)]
    prem = {int(k): float(v) for k, v in re.findall(r"(\d):\s*([\d.]+)", re.search(r"termPremium:\s*\{([^}]*)\}", src).group(1))}
    mpc = re.findall(r'"(\d{4}-\d{2}-\d{2})"', re.search(r"mpcDates:\s*\[([^\]]*)\]", src, re.S).group(1))
    return {"spread60": num("spread60"), "svr": num("svr"), "bands": bands, "prem": prem, "mpc": mpc}


def bootstrap(pillars: dict, months: int = 84) -> list[float]:
    pts = []
    for key, r in pillars.items():
        tenor = key.replace("OIS_", "")
        T = TENOR_YEARS.get(tenor)
        try:
            r = float(r)
        except (TypeError, ValueError):
            continue
        if T and math.isfinite(r):
            pts.append((T, -math.log(1 / (1 + (r / 100) * T)) / T))
    pts.sort()
    if not pts:
        raise ValueError("no usable pillars")

    def z(T):
        if T <= pts[0][0]:
            return pts[0][1]
        if T >= pts[-1][0]:
            return pts[-1][1]
        for i in range(1, len(pts)):
            if T <= pts[i][0]:
                (a, za), (b, zb) = pts[i - 1], pts[i]
                return za + (zb - za) * (T - a) / (b - a)
        return pts[-1][1]

    DF = lambda T: math.exp(-z(T) * T)
    last = pts[-1][0]
    fwd = []
    for m in range(months):
        t1, t2 = m / 12, (m + 1) / 12
        if t2 <= last:
            fwd.append((DF(t1) / DF(t2) - 1) * 12 * 100)
        else:
            a, b = last - 0.25, last
            fwd.append((DF(a) / DF(b) - 1) / (b - a) * 100)
    out = []
    for i in range(len(fwd)):
        w = [fwd[j] for j in range(i - 2, i + 3) if 0 <= j < len(fwd)]
        out.append(sum(w) / len(w))
    out[0] = fwd[0]
    return out


def avg(arr, a, b):
    seg = arr[max(0, int(math.floor(a))):min(len(arr), int(math.ceil(b)))]
    return sum(seg) / len(seg) if seg else arr[-1]


class Model:
    def __init__(self, consts):
        self.c = consts

    def implied(self, fwd, t, years, ltv=LTV):
        base = self.c["spread60"]
        add = next((a for mx, a in self.c["bands"] if ltv <= mx), self.c["bands"][-1][1] + 0.6)
        return avg(fwd, t, t + years * 12) + base + add + self.c["prem"].get(years, 0.05)


def pmt(B, r, n):
    i = r / 100 / 12
    return B / n if i == 0 else B * i / (1 - (1 + i) ** -n)


# ----------------------------------------------------------------------------
# data assembly
# ----------------------------------------------------------------------------
def load_history():
    """EOD pillars by date from the history sheet: {date: {"1D": 3.73, ...}}."""
    j = get_json("/api/data/sonia-history")
    rows = j["data"]["values"]
    head = rows[0]
    out = {}
    for row in rows[1:]:
        if not row or not row[0]:
            continue
        pill = {}
        for k, v in zip(head[1:], row[1:]):
            if k in TENOR_YEARS and v not in ("", None):
                try:
                    pill[k] = float(v)
                except ValueError:
                    pass
        if len(pill) >= 6:
            out[row[0]] = pill
    return out


def load_live():
    j = get_json("/api/sonia-ois")
    last = j["current_day"][-1]
    return {
        "date": j["current_date"],
        "ts": last["timestamp_iso"],
        "pillars": last["values"],
        "prev_date": j.get("previous_date"),
        "prev_pillars": (j.get("previous_day_close") or {}).get("values"),
    }


TREASURY_WORDS = re.compile(
    r"\b(pwlb|council|councils|treasur|dmo|gilt|gilts|auction|setting|settings|reset|fixing|maturit|"
    r"basis points?|bp\b|ladder|annuity|lump.sum|fifty.year|ten.year|two.year money|five.year money|"
    r"certainty|discount|the wrap|wires|wire\b|edition|brief\b|yields?)\b", re.I)


def homeowner_sentences(entries):
    """Pick plain-English market context sentences from Pulse bodies."""
    out, seen = [], set()
    for e in entries:
        ts = e.get("ts_uk", "")[-5:]
        body = re.sub(r"\s+", " ", e.get("body_md", "") or "")
        for s in re.split(r"(?<=[.!?])\s+", body):
            s = s.strip()
            if len(s) < 40 or len(s) > 220 or TREASURY_WORDS.search(s):
                continue
            if s.lower() in seen:
                continue
            seen.add(s.lower())
            out.append((ts, s))
    return out[:8]


def latest_path(entries):
    for e in reversed(entries):
        p = (e.get("data") or {}).get("path") or {}
        if p.get("meetings"):
            return p
    return None


MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def expand_mpc(label):  # "Nov 26" -> "November 2026"
    m, y = label.split()
    return dt.date(2000 + int(y), MONTHS[m], 1).strftime("%B %Y")


# ----------------------------------------------------------------------------
# text
# ----------------------------------------------------------------------------
def fmt(d, f):
    """strftime with a portable day-without-leading-zero token (%-d)."""
    return d.strftime(f.replace("%-d", "\x00")).replace("\x00", str(d.day))


def gbp(n):
    return "£" + f"{abs(round(n)):,}"


def pct(x):
    return f"{x:.2f}%"


def describe_move(d):
    a = abs(d)
    if a < 0.02:
        return "barely moved", "flat"
    if a < 0.06:
        return ("edged up" if d > 0 else "edged down"), ("up" if d > 0 else "down")
    if a < 0.12:
        return ("moved up" if d > 0 else "moved down"), ("up" if d > 0 else "down")
    return ("jumped" if d > 0 else "dropped"), ("up" if d > 0 else "down")


def build_day(date, pillars, prev_pillars, week_pillars, month_pillars, path, entries, model, consts, ts_label):
    fwd = bootstrap(pillars)
    fix2, fix5 = model.implied(fwd, 0, 2), model.implied(fwd, 0, 5)
    pm2, pm5 = pmt(LOAN, fix2, TERM_Y * 12), pmt(LOAN, fix5, TERM_Y * 12)
    br = round(fwd[0] * 4) / 4

    d2 = d5 = dpm2 = None
    if prev_pillars:
        pf = bootstrap(prev_pillars)
        p2, p5 = model.implied(pf, 0, 2), model.implied(pf, 0, 5)
        d2, d5, dpm2 = fix2 - p2, fix5 - p5, pm2 - pmt(LOAN, p2, TERM_Y * 12)
    w2 = model.implied(bootstrap(week_pillars), 0, 2) if week_pillars else None
    m2 = model.implied(bootstrap(month_pillars), 0, 2) if month_pillars else None

    day = dt.date.fromisoformat(date)
    weekday = day.strftime("%A")
    next_mpc = next((d for d in consts["mpc"] if d >= date), None)
    next_mpc_label = fmt(dt.date.fromisoformat(next_mpc), "%-d %B") if next_mpc else None

    # --- homeowner's read -----------------------------------------------
    paras = []
    if d2 is None:
        paras.append(f"A typical 2-year fixed deal is implied at <b>{pct(fix2)}</b> today and a 5-year fix at <b>{pct(fix5)}</b>, based on the rates lenders use to price fixed deals.")
    else:
        verb, direction = describe_move(d2)
        chg = "unchanged" if abs(d2) < 0.005 else f"{'+' if d2 > 0 else '−'}{abs(d2):.2f}"
        paras.append(
            f"The rates lenders use to price fixed deals <b>{verb}</b> on {weekday}. "
            f"A typical 2-year fixed deal is now implied at <b>{pct(fix2)}</b> ({chg} on the previous day) and a 5-year fix at <b>{pct(fix5)}</b>.")
        if abs(dpm2) < 1:
            money = "about the same as the day before"
        else:
            money = f"{gbp(dpm2)} a month {'more' if dpm2 > 0 else 'less'} than the day before"
        paras.append(f"On a {gbp(LOAN)} repayment mortgage over {TERM_Y} years, the 2-year deal works out at about <b>{gbp(pm2)} a month</b>, {money}. The 5-year deal is about {gbp(pm5)} a month.")

    if path:
        meetings = path["meetings"]
        nxt = meetings[0] if meetings else None
        peak = max(meetings, key=lambda m: m["br"])
        exp = "no change" if not nxt or nxt["step_bp"] == 0 else (f"a rise to {nxt['br']:.2f}%" if nxt["step_bp"] > 0 else f"a cut to {nxt['br']:.2f}%")
        when = f" on {next_mpc_label}" if next_mpc_label else ""
        peak_txt = f", and see it topping out at about {peak['br']:.2f}% around {expand_mpc(peak['mpc'])}" if peak["br"] > br + 0.1 else ""
        paras.append(f"The Bank of England rate is <b>{br:.2f}%</b>. Markets expect <b>{exp}</b> at the next decision{when}{peak_txt}.")
    else:
        paras.append(f"The Bank of England rate is <b>{br:.2f}%</b>." + (f" The next decision is on {next_mpc_label}." if next_mpc_label else ""))

    trend = []
    if w2 is not None and abs(fix2 - w2) >= 0.02:
        trend.append(f"{'up' if fix2 > w2 else 'down'} {abs(fix2 - w2):.2f}% over the past week")
    if m2 is not None and abs(fix2 - m2) >= 0.02:
        trend.append(f"{'up' if fix2 > m2 else 'down'} {abs(fix2 - m2):.2f}% over the past month")
    if trend:
        paras.append("Bigger picture, the implied 2-year deal is " + " and ".join(trend) + ".")
    if d2 is not None and abs(d2) >= 0.06:
        paras.append("Lenders usually take a few days to pass a move like this into the deals they actually offer, so today's best buys may not reflect it yet.")

    return {
        "date": date, "day": day, "ts_label": ts_label,
        "fix2": fix2, "fix5": fix5, "pm2": pm2, "pm5": pm5, "d2": d2, "d5": d5, "dpm2": dpm2, "br": br,
        "path": path, "next_mpc": next_mpc_label, "paras": paras,
        "context": homeowner_sentences(entries),
    }


# ----------------------------------------------------------------------------
# html
# ----------------------------------------------------------------------------
HEAD = """<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{canonical}">
<link rel="alternate" type="application/rss+xml" title="Fix o'clock – mortgage rates today" href="{site}/news/feed.xml">
<link rel="stylesheet" href="../styles.css?v=5">
<script type="application/ld+json">{ld}</script>
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="logo" href="../index.html">
      <svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#f050f8"/><circle cx="20" cy="20" r="14" fill="#180048"/><path d="M20 20V11M20 20l7 4" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><circle cx="20" cy="20" r="2" fill="#f050f8"/></svg>
      Fix <em>o'clock</em>
    </a>
    <nav>
      <a href="index.html">Rates today</a>
      <a href="../position.html">Which deal?</a>
      <a href="../index.html#how">How it works</a>
      <a class="cta" href="../calculate.html">Run my numbers</a>
    </nav>
  </div>
</header>
"""

FOOT = """
<footer>
  <div class="wrap">
    <div><strong>Fix o'clock</strong> is an information service. It does not provide financial advice and is not a substitute for advice from a regulated mortgage adviser.</div>
    <div>Market data: live SONIA swap curve. "Typical" deals assume a 75% loan-to-value and are an estimate from published best-buy tables; actual offers differ by lender and borrower.</div>
  </div>
</footer>
</body>
</html>
"""


def sparkline(points):
    if len(points) < 2:
        return ""
    W, H, P = 320, 70, 6
    lo, hi = min(points), max(points)
    span = (hi - lo) or 0.1
    xs = [P + i * (W - 2 * P) / (len(points) - 1) for i in range(len(points))]
    ys = [H - P - (v - lo) / span * (H - 2 * P) for v in points]
    d = "M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in zip(xs, ys))
    return (f'<svg class="spark" viewBox="0 0 {W} {H}" aria-label="Implied 2-year fix, last {len(points)} trading days">'
            f'<path d="{d}" fill="none" stroke="#f050f8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="{xs[-1]:.1f}" cy="{ys[-1]:.1f}" r="4" fill="#180048"/></svg>')


def chip(d):
    if d is None:
        return ""
    if abs(d) < 0.005:
        return '<span class="flat">unchanged</span>'
    return f'<span class="{"up" if d > 0 else "down"}">{"▲" if d > 0 else "▼"} {abs(d):.2f}%</span>'


def render_day(x, spark_points, evergreen, all_days):
    date_long = fmt(x["day"], "%-d %B %Y")
    title = ("Mortgage rates today" if evergreen else f"Mortgage rates on {date_long}") + " – Fix o'clock"
    h1 = "Mortgage rates today" if evergreen else f"Mortgage rates on {date_long}"
    canonical = f"{SITE}/news/" if evergreen else f"{SITE}/news/{x['date']}.html"
    desc = f"Typical 2-year fix implied at {pct(x['fix2'])}, 5-year at {pct(x['fix5'])}. Bank of England rate {x['br']:.2f}%. Updated {x['ts_label']}."
    ld = json.dumps({
        "@context": "https://schema.org", "@type": "NewsArticle", "headline": h1,
        "datePublished": x["date"], "dateModified": x["date"], "description": desc,
        "author": {"@type": "Organization", "name": "Fix o'clock"},
        "publisher": {"@type": "Organization", "name": "Fix o'clock"},
    })
    paras = "".join(f"<p>{p}</p>" for p in x["paras"])
    ctx = "".join(f'<li><span class="t">{t}</span>{html.escape(s)}</li>' for t, s in x["context"])
    ctx_block = f'<section class="card"><h2>What moved the market</h2><ul class="ctx">{ctx}</ul><p class="foot-note">Plain-language notes from the day\'s market commentary. Times are UK.</p></section>' if ctx else ""
    others = "".join(
        f'<li><a href="{d["date"]}.html">{fmt(d["day"], "%A %-d %B")}</a> <span class="muted">2-yr {pct(d["fix2"])} {chip(d["d2"])}</span></li>'
        for d in all_days if d["date"] != x["date"])
    body = f"""
<section class="page-head">
  <div class="narrow">
    <span class="eyebrow">{"Updated " + x["ts_label"] if evergreen else date_long}</span>
    <h1 style="font-size:clamp(1.9rem,4.5vw,3rem)">{h1}</h1>
    <p>What the money markets imply for fixed mortgage deals, in plain English. Not advice.</p>
  </div>
</section>
<main class="narrow lift">
  <section class="card">
    <div class="tiles">
      <div class="stat"><div class="n">{pct(x["fix2"])}</div><div class="l">Typical 2-year fixed deal</div><div class="d">{chip(x["d2"])} on the day before</div></div>
      <div class="stat"><div class="n">{pct(x["fix5"])}</div><div class="l">Typical 5-year fixed deal</div><div class="d">{chip(x["d5"])} on the day before</div></div>
      <div class="stat"><div class="n">{gbp(x["pm2"])}</div><div class="l">A month on £200k over 25 years, 2-year deal</div><div class="d">{("about the same" if x["dpm2"] is None or abs(x["dpm2"]) < 1 else (("+" if x["dpm2"] > 0 else "−") + gbp(x["dpm2"]))) } vs day before</div></div>
      <div class="stat"><div class="n">{x["br"]:.2f}%</div><div class="l">Bank of England rate</div><div class="d">{"Next decision " + x["next_mpc"] if x["next_mpc"] else ""}</div></div>
    </div>
    <div class="spark-row">{sparkline(spark_points)}<span class="muted">Implied 2-year deal, last {len(spark_points)} trading days</span></div>
  </section>

  <section class="card">
    <h2>Homeowner's read</h2>
    <div class="read">{paras}</div>
    <p class="foot-note">Generated from market prices, not opinion. "Typical" assumes a 75% loan-to-value. What the market implies today is not a prediction and not advice.</p>
    <a class="btn btn-pink" href="../calculate.html">See what this means for my mortgage →</a>
  </section>

  {ctx_block}

  <section class="card">
    <h2>{"Previous days" if evergreen else "Other days"}</h2>
    <ul class="days">{others}</ul>
    <p class="foot-note"><a href="feed.xml">RSS feed</a>{"" if evergreen else ' · <a href="index.html">Today</a>'}</p>
  </section>
</main>
"""
    return HEAD.format(title=html.escape(title), desc=html.escape(desc), canonical=canonical, site=SITE, ld=ld) + body + FOOT


def render_feed(days):
    items = []
    for d in days:
        link = f"{SITE}/news/{d['date']}.html"
        text = html.escape(re.sub(r"<[^>]+>", "", " ".join(d["paras"])))
        pub = dt.datetime.combine(d["day"], dt.time(18, 0)).strftime("%a, %d %b %Y %H:%M:%S +0000")
        items.append(f"<item><title>Mortgage rates on {fmt(d['day'], '%-d %B %Y')}: 2-year fix implied at {pct(d['fix2'])}</title>"
                     f"<link>{link}</link><guid>{link}</guid><pubDate>{pub}</pubDate><description>{text}</description></item>")
    return ('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'
            f"<title>Fix o'clock – mortgage rates today</title><link>{SITE}/news/</link>"
            "<description>What the money markets imply for fixed mortgage deals, in plain English. Not advice.</description>"
            + "".join(items) + "</channel></rss>")


# ----------------------------------------------------------------------------
def main():
    consts = read_market_constants()
    model = Model(consts)
    history = load_history()
    live = load_live()
    index = get_json("/pulse-data/index.json")
    pulse_days = index.get("days", [])[:DAYS_TO_BUILD]

    # Trading-day list: pulse days plus today's live date, newest first.
    days = sorted(set(pulse_days) | {live["date"]}, reverse=True)[:DAYS_TO_BUILD]
    hist_dates = sorted(history)

    def pillars_for(date):
        if date == live["date"]:
            return live["pillars"], live["ts"]
        if date in history:
            return history[date], date + " close"
        return None, None

    def prior(date, n):  # pillars n trading days before `date`
        earlier = [d for d in hist_dates if d < date]
        return history[earlier[-n]] if len(earlier) >= n else None

    built = []
    for date in days:
        pill, ts = pillars_for(date)
        if not pill:
            continue
        try:
            entries = get_json(f"/pulse-data/{date}.json").get("entries", [])
        except Exception:
            entries = []
        prev = live["prev_pillars"] if date == live["date"] and live["prev_pillars"] else prior(date, 1)
        ts_label = (fmt(dt.datetime.fromisoformat(ts), "%-d %b %Y, %H:%M") if "T" in ts else ts)
        built.append(build_day(date, pill, prev, prior(date, 5), prior(date, 21), latest_path(entries), entries, model, consts, ts_label))

    if not built:
        sys.exit("nothing to build")

    # Sparkline: implied 2-yr at each EOD for the last 30 trading days, plus live today.
    spark = []
    for d in hist_dates[-30:]:
        try:
            spark.append(model.implied(bootstrap(history[d]), 0, 2))
        except Exception:
            pass
    if live["date"] not in history:
        spark.append(built[0]["fix2"])

    os.makedirs(OUT, exist_ok=True)
    for x in built:
        open(os.path.join(OUT, f"{x['date']}.html"), "w", encoding="utf-8").write(render_day(x, spark, False, built))
    open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(render_day(built[0], spark, True, built))
    open(os.path.join(OUT, "feed.xml"), "w", encoding="utf-8").write(render_feed(built))
    print(f"built {len(built)} day pages + index + feed; latest {built[0]['date']} 2y {built[0]['fix2']:.2f}% 5y {built[0]['fix5']:.2f}%")


if __name__ == "__main__":
    main()
