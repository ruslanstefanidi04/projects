const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
}

function money(n) {
  if (n == null) return "-";
  const v = Number(n);
  const fat = Math.abs(v) >= 100;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fat ? 0 : 2,
    maximumFractionDigits: fat ? 0 : 2,
  });
}

function signedMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return "";
  const v = Number(n);
  if (v > 0) return `+${money(v)}`;
  if (v < 0) return `−${money(Math.abs(v))}`;
  return money(0);
}

function listingView(l) {
  const src = String(l.source || "");
  const p2p = src && src !== "skinport" && src !== "steam";
  if (p2p && (l.netVia === "ask" || l.netVia === "thin")) {
    return { ...l, netSame: null, netSamePct: null };
  }
  if (p2p && l.netVia !== "ask" && (l.netSamePct ?? 0) > 35 && l.sellAsk == null) {
    return { ...l, netSame: null, netSamePct: null, netVia: "thin", netFeeNote: "ask copied as median, not a sale" };
  }
  return l;
}

function netHtml(l) {
  const thin = l.netVia === "ask" || l.netVia === "thin";
  const netCls = (l.netSame ?? 0) >= 0 ? "up" : "dn";
  const netLine = thin
    ? "no fill"
    : l.netSame != null
      ? `<span class="gain ${netCls}">${signedMoney(l.netSame)}</span>${
          l.netSamePct != null ? ` <b class="gainpct">${l.netSame >= 0 ? "+" : ""}${l.netSamePct}%</b>` : ""
        }`
      : "-";
  const sell = thin
    ? `thin ask ${l.sellAsk != null ? money(l.sellAsk) : "-"} ignored`
    : `${esc(l.sellVenue || l.source || "-")} ${esc(l.netVia || "mark")} ${l.sellAt != null ? money(l.sellAt) : "-"}`;
  return `<dl class="econ">
    <div><dt>buy</dt><dd>${esc(l.source || "-")} ${money(l.minPrice)}</dd></div>
    <div><dt>sell</dt><dd>${sell}</dd></div>
    <div><dt>fee</dt><dd>${esc(l.netFeeNote || "-")}</dd></div>
    <div><dt>net</dt><dd>${netLine}</dd></div>
  </dl>`;
}

function othersHtml(l) {
  const qs = l.quotes || [];
  const bits = [];
  if (l.minHold != null) {
    bits.push(`<span class="mkt dim"><span>locked</span><b>${money(l.minHold)}</b></span>`);
  }
  const rows = qs
    .filter((q) => q.url !== l.url)
    .slice()
    .sort((a, b) => a.price - b.price);
  for (const q of rows) {
    const label = q.version ? `${q.source} ${q.version}` : q.source;
    bits.push(
      `<a class="mkt" href="${esc(q.url)}" target="_blank" rel="noreferrer"><span>buy ${esc(label)}</span><b>${money(q.price)}</b></a>`,
    );
  }
  if (!bits.length) {
    return `<div class="mkts thin"><span class="mkt dim"><span>no other asks</span><b></b></span></div>`;
  }
  while (bits.length < 4) bits.push(`<span class="mkt ghost"><span>&nbsp;</span><b>&nbsp;</b></span>`);
  return `<div class="mkts">${bits.slice(0, 4).join("")}</div>`;
}

const WEAR = [
  { key: "fn", label: "FN", re: /factory new/i, lo: 0, hi: 0.07 },
  { key: "mw", label: "MW", re: /minimal wear/i, lo: 0.07, hi: 0.15 },
  { key: "ft", label: "FT", re: /field-tested/i, lo: 0.15, hi: 0.38 },
  { key: "ww", label: "WW", re: /well-worn/i, lo: 0.38, hi: 0.45 },
  { key: "bs", label: "BS", re: /battle-scarred/i, lo: 0.45, hi: 1 },
];

function wearFromName(name) {
  const n = String(name || "");
  return WEAR.find((w) => w.re.test(n)) ?? null;
}

function wearPct(listing) {
  const fv = listing.floatValue;
  if (typeof fv === "number" && fv >= 0 && fv <= 1) return Math.min(100, Math.max(0, fv * 100));
  const wear = wearFromName(listing.marketHashName);
  if (!wear) return null;
  return ((wear.lo + wear.hi) / 2) * 100;
}

function wearHtml(listing) {
  const wear = wearFromName(listing.marketHashName);
  const pct = wearPct(listing);
  if (!wear && pct == null) return "";
  const tag = listing.patternTag || listing.version || "";
  const right =
    typeof listing.floatValue === "number"
      ? listing.floatValue < 0.01 || listing.floatValue >= 0.99
        ? listing.floatValue.toFixed(6)
        : listing.floatValue.toFixed(4)
      : tag
        ? esc(tag)
        : "";
  const left = wear ? wear.label : "wear";
  const pin = pct == null ? "" : `<i class="wear-mark" style="left:${pct.toFixed(2)}%"></i>`;
  return `<div class="wear">
    <div class="wear-track">${pin}</div>
    <div class="wear-meta"><span>${left}</span><span>${right === left ? "" : right}</span></div>
  </div>`;
}

function sellVenueOf(l) {
  if (l.sellVenue) return l.sellVenue;
  const s = String(l.source || "").toLowerCase();
  if (s === "skinport" || s === "steam") return s;
  return "skinport";
}

function feePctOf(source) {
  const s = String(source || "").toLowerCase();
  if (s === "steam") return 15;
  if (s === "skinport") return 6;
  if (s === "csfloat") return 2;
  if (s === "dmarket") return 5;
  if (s === "waxpeer" || s === "lis") return 2;
  if (s === "csgotm" || s === "white" || s === "skinplace") return 5;
  if (s === "skins" || s === "aim") return 0;
  return 0;
}

function sellLink(l) {
  const sell = sellVenueOf(l);
  if (l.sellUrl) return l.sellUrl;
  if (sell === l.source) return l.url;
  const name = l.marketHashName || "";
  if (sell === "skinport") return `https://skinport.com/market?search=${encodeURIComponent(name)}`;
  if (sell === "steam") return `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`;
  return l.url;
}

function chainNet(l) {
  if (l.netVia === "ask") return { profit: null, pct: null };
  const buy = Number(l.minPrice);
  const gross = Number(l.sellAt);
  if (!(buy > 0) || !(gross > 0)) return { profit: l.netSame, pct: l.netSamePct };
  const fee = feePctOf(sellVenueOf(l)) / 100;
  const profit = Math.round((gross * (1 - fee) - buy) * 100) / 100;
  const pct = Math.round((profit / buy) * 1000) / 10;
  return { profit, pct };
}

function openChain(a) {
  const l = listingView(a.listing || a);
  const buy = l.source;
  const sell = sellVenueOf(l);
  const same = buy === sell;
  const net = chainNet(l);
  const netCls = (net.profit ?? 0) >= 0 ? "up" : "dn";
  const hold =
    buy === "skinport"
      ? "Stay on Skinport to relist. Withdraw to Steam is ~7d hold, not a ban."
      : "P2P buy: Steam trade hold ~7d after you receive it. Then list on the sell site.";
  $("chainBody").innerHTML = `
    <p class="modal-kicker">${esc(a.kind || "deal")} · ${esc(l.version || l.patternTag || "lot")}</p>
    <h3>${esc(l.marketHashName)}</h3>
    <ol class="steps">
      <li>
        <span class="step-tag">1 buy</span>
        <p>Pay the ask on <b>${esc(buy)}</b> ${money(l.minPrice)}. You click buy yourself.</p>
        <a class="buy" href="${esc(l.url)}" target="_blank" rel="noreferrer">open ${esc(buy)}</a>
      </li>
      <li>
        <span class="step-tag">2 hold</span>
        <p>${esc(hold)}</p>
      </li>
      <li>
        <span class="step-tag">3 sell</span>
        <p>${
          l.netVia === "ask"
            ? `Skinport has ${esc(String(l.sellQty ?? "?"))} lot at ${l.sellAt != null ? money(l.sellAt) : "-"}. That is a seller ask, not a last sale. Do not count it as your exit.`
            : `List on <b>${esc(sell)}</b> at ${esc(l.netVia || "mark")} ${l.sellAt != null ? money(l.sellAt) : "-"}. Fee ${feePctOf(sell)}%${same ? " same site" : ""}.`
        }</p>
        <a class="buy" href="${esc(sellLink(l))}" target="_blank" rel="noreferrer">open ${esc(sell)}</a>
      </li>
      <li>
        <span class="step-tag">4 net</span>
        <p>${
          l.netVia === "ask"
            ? "No net. Liquid stock is on the buy site. Skinport median here copies the ask."
            : `<span class="gain ${netCls}">${signedMoney(net.profit)}</span>${
                net.pct != null ? ` <b class="gainpct">${net.profit >= 0 ? "+" : ""}${net.pct}%</b>` : ""
              } after sell fee. Not last sale. Check the phase on both pages.`
        }</p>
      </li>
    </ol>
  `;
  $("chain").classList.remove("hidden");
}

function closeChain() {
  $("chain").classList.add("hidden");
}

function cardHtml(a, heatMin, i) {
  const l = listingView(a.listing);
  const o = filterOpts();
  const tab = kindFilter();
  const kind = tab && matchesKindTab(a, tab, o) ? tab : liveKind(a, o);
  const thin = l.netVia === "ask" || l.netVia === "thin";
  const d = thin ? discountOf(a) : a.discountPct;
  const off = d == null ? "" : `-${Number(d).toFixed(0)}%`;
  const gain = thin || l.netSame == null ? "" : signedMoney(l.netSame);
  const gainCls = thin || l.netSame == null ? "empty" : l.netSame >= 0 ? "up" : "dn";
  const hot = (l.heatScore ?? 0) >= heatMin;
  const phase = String(l.version || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const img = l.image
    ? `<img class="${phase ? `v-${phase}` : ""}" src="${esc(l.image)}" alt="" title="stock icon, not this listing" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />`
    : "";
  return `<article class="deal ${kind}${hot ? " rise" : ""}${l.onHold ? " held" : ""}" data-i="${i}">
    <button type="button" class="shot">${img}${wearHtml(l)}</button>
    <div class="meta">
      <div class="badges">
        <span class="kind ${kind}">${kind}</span>
        ${hot ? `<span class="kind rise">rise ${l.heatScore}</span>` : ""}
        ${l.stickerWhy ? `<span class="qty">${esc(l.stickerWhy)}</span>` : ""}
        ${l.patternTag ? `<span class="qty">${esc(l.patternTag)}</span>` : ""}
        ${l.version && l.version !== l.patternTag ? `<span class="qty">${esc(l.version)}</span>` : ""}
        ${l.onHold ? `<span class="kind hold">hold</span>` : ""}
        ${l.source ? `<span class="qty">${esc(l.source)}</span>` : ""}
        ${l.patternTag ? "" : `<span class="qty">×${l.quantity}</span>`}
        ${l.paintSeed != null ? `<span class="qty">#${l.paintSeed}</span>` : ""}
        ${l.floatValue != null ? `<span class="qty">${l.floatValue < 0.01 || l.floatValue >= 0.99 ? l.floatValue.toFixed(6) : l.floatValue.toFixed(4)}</span>` : ""}
      </div>
      <div class="name">${esc(l.marketHashName)}</div>
      <div class="price">
        <b>${money(l.minPrice)}</b>
        <span class="gain ${gainCls}">${gain}</span>
        <span class="off">${off}</span>
      </div>
      <p class="why">${
        l.stickers?.length
          ? l.stickers
              .slice(0, 4)
              .map((s) => esc(s.name.replace(/^sticker \| /i, "")))
              .join(" · ")
          : ""
      }</p>
      ${netHtml(l)}
      ${othersHtml(l)}
      <div class="row">
        <a class="buy" href="${esc(l.url)}" target="_blank" rel="noreferrer">buy on ${esc(l.source)}</a>
      </div>
    </div>
  </article>`;
}

const CLASS_MATCH = {
  knives: (n) =>
    (n.includes("★") && !n.includes("gloves") && !n.includes("wraps")) ||
    /\b(knife|karambit|bayonet|shadow daggers|ursus|kukri)\b/.test(n),
  gloves: (n) => n.includes("gloves") || n.includes("wraps"),
  rifles: (n) => /ak-47|m4a1|m4a4|famas|galil|aug|sg 553/.test(n),
  snipers: (n) => /awp|ssg 08|g3sg1|scar-20/.test(n),
  pistols: (n) => /glock|usp-s|p2000|p250|desert eagle|five-seve|tec-9|cz75|r8 revolver|dual berettas/.test(n),
  smgs: (n) => /mac-10|mp9|mp7|mp5|ump-45|p90|pp-bizon/.test(n),
  lmgs: (n) => /negev|m249/.test(n),
  cases: (n) => /\bcase\b/.test(n) && !n.includes("|"),
};

function nameMatchesWatch(name, watch) {
  const tokens = (watch || []).map((w) => String(w).toLowerCase()).filter(Boolean);
  if (!tokens.length) return true;
  const n = String(name || "").toLowerCase();
  const classes = tokens.filter((w) => CLASS_MATCH[w]);
  const finishes = tokens.filter((w) => w.startsWith("finish:")).map((w) => w.slice(7));
  const extra = tokens.filter((w) => !CLASS_MATCH[w] && !w.startsWith("finish:"));
  const classHit = !classes.length || classes.some((c) => CLASS_MATCH[c](n));
  const finishHit = !finishes.length || finishes.some((f) => n.includes(f));
  const extraHit = !extra.length || extra.some((w) => n.includes(w));
  if (classes.length || finishes.length) return classHit && finishHit && (!extra.length || extraHit);
  return extraHit;
}

let lastBoard = [];
let lastHeat = 56;
let lastShown = [];
let page = 1;
const PAGE = 12;
let booted = false;
let ticking = false;
let pulseBusy = false;
const BOARD_KEY = "skin-desk-board";

function saveBoardCache(board, heatMin) {
  if (!board?.length) return;
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify({ board, heatMin, at: Date.now() }));
  } catch {
    /* quota */
  }
}

function loadBoardCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(BOARD_KEY) || "null");
    if (!raw?.board?.length) return null;
    if (Date.now() - raw.at > 6 * 60 * 60 * 1000) return null;
    return raw;
  } catch {
    return null;
  }
}
const VIEW_KEY = "skin-desk-tape-view";

function tapeView() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveTapeView(partial) {
  localStorage.setItem(VIEW_KEY, JSON.stringify({ ...tapeView(), ...partial }));
}

function filterOpts() {
  const f = $("cfg");
  return {
    spreadPct: Number(f?.spreadPct?.value),
    snipePct: Number(f?.snipePct?.value),
    snipeMaxQty: Number(f?.snipeMaxQty?.value),
    extremePct: Number(f?.extremePct?.value),
    floor: Number(f?.floor?.value),
    heatMin: Number(f?.heatMin?.value),
  };
}

function streetMark(l) {
  const src = String(l.source || "").toLowerCase();
  const ask = Number(l.sellAsk);
  const sug = Number(l.suggestedPrice);
  const med = Number(l.medianPrice);
  const mean = Number(l.meanPrice);
  const p2p = src && src !== "skinport" && src !== "steam";
  const ok = (p) => p > 0 && (!p2p || !(ask > 0) || p < ask * 0.95);
  if (ok(med) && ok(sug)) return sug > med * 1.08 ? med : Math.min(sug, med);
  if (ok(med)) return med;
  if (ok(mean)) return mean;
  if (ok(sug)) return sug;
  return null;
}

function discountOf(a) {
  const l = a?.listing || {};
  const stale = l.netVia === "ask" || l.netVia === "thin";
  if (!stale) {
    const d = Number(a?.discountPct);
    if (Number.isFinite(d)) return d;
  }
  const min = Number(l.minPrice);
  const mark = streetMark(l);
  if (!(min > 0) || !(mark > 0)) return null;
  return ((mark - min) / mark) * 100;
}

function liveKind(a, o) {
  const l = a?.listing || {};
  if (l.stickerWhy) return "sticker";
  if (l.patternTag) return "pattern";
  const min = Number(l.minPrice);
  if (!(min > 0)) return "list";
  if (o.floor > 0 && min <= o.floor) return "floor";
  const d = discountOf(a);
  if (d == null) return "list";
  if (d >= o.extremePct) return "extreme";
  if (d >= o.snipePct) return "snipe";
  if (d >= o.spreadPct) return "spread";
  if ((l.heatScore ?? 0) >= o.heatMin) return "rise";
  return "list";
}

function matchesKindTab(a, kind, o) {
  if (!kind) return true;
  const l = a?.listing || {};
  const min = Number(l.minPrice);
  const d = discountOf(a);
  if (kind === "pattern") return !!l.patternTag;
  if (kind === "sticker") return !!l.stickerWhy;
  if (kind === "rise") return (l.heatScore ?? 0) >= o.heatMin;
  if (kind === "floor") return o.floor > 0 && min > 0 && min <= o.floor;
  if (kind === "extreme") return d != null && d >= o.extremePct;
  if (kind === "snipe") return d != null && d >= o.snipePct && d < o.extremePct;
  if (kind === "spread") return d != null && d >= o.spreadPct && d < o.snipePct;
  return liveKind(a, o) === kind;
}

function kindFilter() {
  return String(tapeView().kind || "");
}

function sortMode() {
  return String(tapeView().sort || "board");
}

function applyTapeView() {
  const kind = kindFilter();
  for (const btn of document.querySelectorAll("#kindBar [data-kind]")) {
    btn.classList.toggle("on", (btn.getAttribute("data-kind") || "") === kind);
  }
  const sel = $("sortBy");
  if (sel) sel.value = sortMode();
}

function sortedRows(rows) {
  const mode = sortMode();
  const copy = [...rows];
  if (mode === "spread") copy.sort((a, b) => (b.discountPct ?? -1) - (a.discountPct ?? -1));
  if (mode === "price") copy.sort((a, b) => (a.listing?.minPrice ?? 0) - (b.listing?.minPrice ?? 0));
  if (mode === "pricehi") copy.sort((a, b) => (b.listing?.minPrice ?? 0) - (a.listing?.minPrice ?? 0));
  if (mode === "net") copy.sort((a, b) => (b.listing?.netSame ?? b.listing?.netBest ?? -9999) - (a.listing?.netSame ?? a.listing?.netBest ?? -9999));
  return copy;
}

function loaderHtml(msg) {
  return `<div class="loader" role="status"><i></i><span>${esc(msg)}</span></div>`;
}

function paintPager(pages, total) {
  const el = $("pager");
  if (!el) return;
  if (!total) {
    el.innerHTML = "";
    return;
  }
  if (pages <= 1) {
    el.innerHTML = `<span>1 / 1</span>`;
    return;
  }
  el.innerHTML = `
    <button type="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>prev</button>
    <span>${page} / ${pages}</span>
    <button type="button" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>next</button>`;
}

function renderBoard(board, heatMin = lastHeat) {
  if (board) lastBoard = board;
  lastHeat = heatMin;
  const watch = watchTokens();
  const kind = kindFilter();
  const o = filterOpts();
  let rows = lastBoard.filter((a) => nameMatchesWatch(a.listing?.marketHashName, watch));
  if (kind) rows = rows.filter((a) => matchesKindTab(a, kind, o));
  rows = sortedRows(rows);
  lastShown = rows;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE) || 1);
  if (page > pages) page = pages;
  if (page < 1) page = 1;
  if (!rows.length) {
    if (!lastBoard.length && (ticking || !booted)) {
      $("cards").innerHTML = loaderHtml(ticking ? "scanning markets…" : "loading tape…");
    } else {
      $("cards").innerHTML = `<p class="hint">no deals in this tab.</p>`;
    }
  } else {
    const start = (page - 1) * PAGE;
    const slice = rows.slice(start, start + PAGE);
    $("cards").innerHTML = slice.map((a, i) => cardHtml(a, heatMin, start + i)).join("");
    saveBoardCache(lastBoard, lastHeat);
  }
  paintPager(pages, rows.length);
  if ($("tickmeta")) paintStatus(rows.length);
}

const FILTER_KEY = "skin-desk-filters";

function readLocalFilters() {
  try {
    return JSON.parse(localStorage.getItem(FILTER_KEY) || "null");
  } catch {
    return null;
  }
}

function writeLocalFilters() {
  const fd = new FormData($("cfg"));
  localStorage.setItem(
    FILTER_KEY,
    JSON.stringify({
      watch: watchTokens(),
      patternText: fd.get("patternText") || "",
      seedText: fd.get("seedText") || "",
      maxFloat: Number(fd.get("maxFloat")),
      spreadPct: Number(fd.get("spreadPct")),
      snipePct: Number(fd.get("snipePct")),
      snipeMaxQty: Number(fd.get("snipeMaxQty")),
      extremePct: Number(fd.get("extremePct")),
      floor: Number(fd.get("floor")),
      heatMin: Number(fd.get("heatMin")),
    }),
  );
  writeQuery();
}

function parseWatchParam(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s === "none" || s === "all") return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function queryFilters() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return null;
  const out = {};
  if (q.has("watch")) out.watch = parseWatchParam(q.get("watch"));
  if (q.has("kind")) out.kind = q.get("kind") || "";
  if (q.has("sort")) out.sort = q.get("sort") || "board";
  if (q.has("p")) {
    const n = Number(q.get("p"));
    if (Number.isInteger(n) && n > 0) out.page = n;
  }
  if (q.has("pattern")) out.patternText = q.get("pattern") || "";
  if (q.has("seeds")) out.seedText = q.get("seeds") || "";
  const nums = [
    ["spread", "spreadPct"],
    ["snipe", "snipePct"],
    ["qty", "snipeMaxQty"],
    ["extreme", "extremePct"],
    ["floor", "floor"],
    ["float", "maxFloat"],
    ["heat", "heatMin"],
  ];
  for (const [key, field] of nums) {
    if (!q.has(key)) continue;
    const n = Number(q.get(key));
    if (Number.isFinite(n)) out[field] = n;
  }
  return out;
}

function writeQuery() {
  const q = new URLSearchParams();
  const w = watchTokens();
  q.set("watch", w.length ? w.join(",") : "all");
  const kind = kindFilter();
  if (kind) q.set("kind", kind);
  const sort = sortMode();
  if (sort && sort !== "board") q.set("sort", sort);
  if (page > 1) q.set("p", String(page));
  const fd = new FormData($("cfg"));
  const put = (key, val) => {
    const s = String(val ?? "").trim();
    if (s) q.set(key, s);
  };
  put("pattern", fd.get("patternText"));
  put("seeds", fd.get("seedText"));
  put("spread", fd.get("spreadPct"));
  put("snipe", fd.get("snipePct"));
  put("qty", fd.get("snipeMaxQty"));
  put("extreme", fd.get("extremePct"));
  put("floor", fd.get("floor"));
  put("float", fd.get("maxFloat"));
  put("heat", fd.get("heatMin"));
  const qs = q.toString();
  history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
}

function applyQueryFilters(q) {
  if (!q) return;
  const f = $("cfg");
  if ("watch" in q) fillWatch(q.watch);
  if (q.kind != null) saveTapeView({ kind: q.kind });
  if (q.sort) saveTapeView({ sort: q.sort });
  if (q.page) page = q.page;
  if (q.patternText != null) f.patternText.value = q.patternText;
  if (q.seedText != null) f.seedText.value = q.seedText;
  for (const key of ["spreadPct", "snipePct", "snipeMaxQty", "extremePct", "floor", "maxFloat", "heatMin"]) {
    if (q[key] != null) f[key].value = q[key];
  }
  applyTapeView();
}

function payloadFromForm() {
  const fd = new FormData($("cfg"));
  return {
    watch: watchTokens(),
    watchText: watchTokens().join(","),
    patternText: fd.get("patternText"),
    seedText: fd.get("seedText"),
    maxFloat: Number(fd.get("maxFloat")),
    spreadPct: Number(fd.get("spreadPct")),
    snipePct: Number(fd.get("snipePct")),
    snipeMaxQty: Number(fd.get("snipeMaxQty")),
    extremePct: Number(fd.get("extremePct")),
    floor: Number(fd.get("floor")),
    heatMin: Number(fd.get("heatMin")),
  };
}

async function pushFilters() {
  writeLocalFilters();
  const s = await (
    await fetch("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadFromForm()),
    })
  ).json();
  fillBook(s);
  if (s.board) renderBoard(s.board, s.heatMin);
}

function watchTokens() {
  return [...document.querySelectorAll("#watchMenu [data-watch]:checked")].map((el) => el.getAttribute("data-watch"));
}

function paintWatchBtn() {
  const picked = watchTokens();
  $("watchBtn").textContent = picked.length
    ? picked.map((w) => w.replace("finish:", "")).join(", ")
    : "all";
}

function fillWatch(watch) {
  const set = new Set((watch || []).map((w) => String(w).toLowerCase()).filter(Boolean));
  for (const el of document.querySelectorAll("#watchMenu [data-watch]")) {
    const key = el.getAttribute("data-watch").toLowerCase();
    el.checked = set.has(key);
  }
  paintWatchBtn();
}

function fillCfg(s) {
  const f = $("cfg");
  fillWatch(s.watch);
  f.patternText.value = (s.patternNames || []).join(", ");
  f.seedText.value = (s.patternSeeds || []).join(", ");
  f.spreadPct.value = s.spreadPct;
  f.snipePct.value = s.snipePct;
  f.snipeMaxQty.value = s.snipeMaxQty;
  f.extremePct.value = s.extremePct;
  f.floor.value = s.floor;
  f.maxFloat.value = s.maxFloat ?? 0;
  f.heatMin.value = s.heatMin ?? 56;
  $("pulse").className = `pulse ${ticking ? "wait" : "on"}`;
  $("chats").textContent = `telegram chats: ${s.chats}. /start on the bot.`;
}

function fillBook(s) {
  const p = s.pnl || { bought: 0, sold: 0, paper: 0 };
  $("pnl").textContent = `in ${p.bought} · out ${p.sold} · paper ${p.paper}`;
  $("journal").innerHTML = (s.journal || [])
    .slice(-12)
    .reverse()
    .map((r) => `<li>${r.side} ${esc(r.name)} ${r.price}</li>`)
    .join("");
}

async function refresh() {
  const s = await (await fetch("/api/state")).json();
  fillCfg(s);
  const q = queryFilters();
  const local = readLocalFilters();
  if (q && "watch" in q) fillWatch(q.watch);
  else if (local && "watch" in local) fillWatch(local.watch);
  if (q) applyQueryFilters(q);
  fillBook(s);
  if (s.board?.length) renderBoard(s.board, s.heatMin);
  else if (!lastBoard.length) renderBoard(s.board, s.heatMin);
  paintStatus(lastBoard.length);
  writeQuery();
  return s;
}

$("cfg").addEventListener("submit", async (e) => {
  e.preventDefault();
  await pushFilters();
  await pulse();
});

$("log").addEventListener("submit", async (e) => {
  e.preventDefault();
  const side = e.submitter?.dataset.side || "buy";
  const fd = new FormData($("log"));
  await fetch("/api/journal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      side,
      name: fd.get("name"),
      price: Number(fd.get("price")),
    }),
  });
  $("log").reset();
  await refresh();
});

function paintStatus(n) {
  const count = n ?? lastShown.length;
  $("pulse").className = `pulse ${ticking ? "wait" : "on"}`;
  if (ticking) $("tickmeta").textContent = `refresh · ${count}`;
  else $("tickmeta").textContent = `live · ${count}`;
}

async function pulse() {
  if (pulseBusy) return;
  pulseBusy = true;
  ticking = true;
  paintStatus();
  if (!lastBoard.length) renderBoard();
  try {
    const s = await (
      await fetch("/api/tick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payloadFromForm(), enabled: true }),
      })
    ).json();
    fillBook(s);
    if (s.board?.length) renderBoard(s.board, s.heatMin);
    if (s.alerts?.[0]) {
      const first = s.alerts[0];
      const box = $("flash");
      box.classList.remove("hidden");
      box.textContent = `${first.kind}  ${first.listing.marketHashName}  ${first.listing.minPrice}`;
    }
  } catch (err) {
    console.error(err);
  } finally {
    ticking = false;
    pulseBusy = false;
    booted = true;
    paintStatus();
    if (!lastBoard.length) renderBoard();
  }
}

setInterval(() => {
  pulse();
}, 60000);

document.getElementById("kindBar").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-kind]");
  if (!btn) return;
  saveTapeView({ kind: btn.getAttribute("data-kind") || "" });
  page = 1;
  applyTapeView();
  writeQuery();
  renderBoard();
});
$("sortBy").addEventListener("change", () => {
  saveTapeView({ sort: $("sortBy").value });
  page = 1;
  writeQuery();
  renderBoard();
});

$("watchBtn").addEventListener("click", (e) => {
  e.preventDefault();
  $("watchMenu").classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  const box = document.querySelector(".watchbox");
  if (box && !box.contains(e.target)) $("watchMenu").classList.add("hidden");
});
document.getElementById("watchMenu").addEventListener("change", async () => {
  paintWatchBtn();
  page = 1;
  writeQuery();
  renderBoard();
  await pushFilters();
});
$("pager").addEventListener("click", (e) => {
  const go = e.target.closest("[data-page]");
  if (!go || go.disabled) return;
  const n = Number(go.getAttribute("data-page"));
  if (!Number.isInteger(n) || n < 1) return;
  page = n;
  writeQuery();
  renderBoard();
});
$("cards").addEventListener("click", (e) => {
  const shot = e.target.closest(".shot");
  if (!shot) return;
  const art = shot.closest("[data-i]");
  if (!art) return;
  const i = Number(art.dataset.i);
  if (lastShown[i]) openChain(lastShown[i]);
});
$("chainX").addEventListener("click", closeChain);
$("chain").addEventListener("click", (e) => {
  if (e.target === $("chain")) closeChain();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeChain();
});

(async function boot() {
  const q = queryFilters();
  applyTapeView();
  if (q) applyQueryFilters(q);
  else {
    const local = readLocalFilters();
    if (local && "watch" in local) {
      fillWatch(local.watch);
      if (local.patternText != null) $("cfg").patternText.value = local.patternText;
    }
  }
  writeQuery();
  const cached = loadBoardCache();
  if (cached) {
    booted = true;
    renderBoard(cached.board, cached.heatMin);
  }
  if (q || readLocalFilters()) await pushFilters();
  await refresh();
  pulse();
})().catch(console.error);
