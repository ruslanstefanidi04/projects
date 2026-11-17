(function () {
  const raw = location.pathname.replace(/\/$/, "") || "/";
  const here = raw === "/index.html" ? "/" : raw;
  const docs = [
    ["/use.html", "how"],
    ["/econ.html", "econ"],
    ["/cs.html", "steam / cs"],
  ];
  const docOn = docs.some(([href]) => here === href || here === href.replace(".html", ""));
  const el = document.querySelector("[data-nav]");
  if (!el) return;
  const tapeOn = here === "/";
  const outlookOn = here === "/outlook.html" || here === "/outlook";
  el.innerHTML = `
    <a href="/" class="${tapeOn ? "on" : ""}">tape</a>
    <div class="docs">
      <button type="button" class="docs-btn${docOn ? " on" : ""}" id="docsBtn">docs</button>
      <div class="docs-menu hidden" id="docsMenu">
        ${docs
          .map(([href, label]) => {
            const on = here === href || here === href.replace(".html", "");
            return `<a href="${href}" class="${on ? "on" : ""}">${label}</a>`;
          })
          .join("")}
      </div>
    </div>
    <a href="/outlook.html" class="${outlookOn ? "on" : ""}">outlook</a>
  `;
  const btn = document.getElementById("docsBtn");
  const menu = document.getElementById("docsMenu");
  const box = el.querySelector(".docs");
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    menu.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (box && !box.contains(e.target)) menu.classList.add("hidden");
  });
})();
