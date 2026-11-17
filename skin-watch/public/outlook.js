const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
}

function wearBar(name) {
  const bands = [
    { label: "FN", re: /factory new/i, mid: 3.5 },
    { label: "MW", re: /minimal wear/i, mid: 11 },
    { label: "FT", re: /field-tested/i, mid: 26.5 },
    { label: "WW", re: /well-worn/i, mid: 41.5 },
    { label: "BS", re: /battle-scarred/i, mid: 72.5 },
  ];
  const hit = bands.find((w) => w.re.test(String(name || "")));
  if (!hit) return "";
  return `<div class="wear">
    <div class="wear-track"><i class="wear-mark" style="left:${hit.mid}%"></i></div>
    <div class="wear-meta"><span>${hit.label}</span><span></span></div>
  </div>`;
}

function money(n) {
  if (n == null) return "-";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function render(payload) {
  const report = payload.report;
  $("flash").classList.add("hidden");
  if (!payload.configured) {
    $("meta").textContent = "no OPENROUTER_API_KEY";
    $("flash").textContent = "вставь ключ OpenRouter в env (локально .env, на проде Vercel). модель по умолчанию gpt-4o-mini:online.";
    $("flash").classList.remove("hidden");
  } else {
    $("meta").textContent = report
      ? `${payload.model} · ${report.at.slice(0, 16).replace("T", " ")} · fed ${report.fed}/${report.catalogSize}`
      : `${payload.model} · no report yet`;
  }
  if (!report) {
    $("picks").innerHTML = `<p class="hint">ещё нет прогона. локально жми run now. прод: каждый понедельник 08:00 UTC.</p>`;
    $("regime").classList.add("hidden");
    $("news").classList.add("hidden");
    return;
  }
  try {
    localStorage.setItem("skin-outlook", JSON.stringify(payload));
  } catch {
    // ignore
  }
  $("regime").textContent = report.regime;
  $("regime").classList.toggle("hidden", !report.regime);
  $("news").textContent = report.newsNotes;
  $("news").classList.toggle("hidden", !report.newsNotes);
  const rows = report.picks || [];
  $("picks").innerHTML =
    rows
      .map((p) => {
        const img = `/api/img?n=${encodeURIComponent(p.name)}`;
        const href = p.url || `https://skinport.com/market?search=${encodeURIComponent(p.name)}`;
        return `<article class="deal ${p.stance}">
          <div class="shot"><img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()" />${wearBar(p.name)}</div>
          <div class="meta">
            <div class="badges">
              <span class="kind ${p.stance}">${esc(p.stance)}</span>
              <span class="qty">${esc(p.confidence)}%</span>
            </div>
            <div class="name">${esc(p.name)}</div>
            <div class="price"><b>${money(p.minPrice)}</b></div>
            <p class="why">${esc(p.thesis)}</p>
            <p class="why">${esc(p.risks)}</p>
            <a class="buy" href="${esc(href)}" target="_blank" rel="noreferrer">open lot</a>
          </div>
        </article>`;
      })
      .join("") || `<p class="hint">модель не вернула валидные имена из ленты</p>`;
  if (report.disclaimer) {
    $("picks").insertAdjacentHTML("beforeend", `<p class="hint">${esc(report.disclaimer)}</p>`);
  }
}

async function load() {
  try {
    const res = await fetch("/api/outlook", { cache: "no-store" });
    const data = await res.json();
    if (data.report) {
      render(data);
      return;
    }
    const cached = localStorage.getItem("skin-outlook");
    if (cached) render(JSON.parse(cached));
    else render(data);
  } catch {
    const cached = localStorage.getItem("skin-outlook");
    if (cached) render(JSON.parse(cached));
    else {
      $("meta").textContent = "outlook offline";
    }
  }
}

$("run").onclick = async () => {
  $("run").disabled = true;
  $("meta").textContent = "running…";
  try {
    const res = await fetch("/api/outlook", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    render({ configured: true, model: data.report?.model, report: data.report });
  } catch (err) {
    $("flash").textContent = String(err.message || err);
    $("flash").classList.remove("hidden");
    $("meta").textContent = "run failed";
  }
  $("run").disabled = false;
};

load();
