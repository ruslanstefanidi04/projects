(function () {
  const ch = [
    ["/econ.html", "оглавление"],
    ["/econ-01.html", "1. выбор"],
    ["/econ-02.html", "2. цена"],
    ["/econ-03.html", "3. спрос"],
    ["/econ-04.html", "4. спред"],
    ["/econ-05.html", "5. издержки"],
    ["/econ-06.html", "6. ликвидность"],
    ["/econ-07.html", "7. информация"],
    ["/econ-08.html", "8. аукцион"],
    ["/econ-09.html", "9. риск"],
    ["/econ-10.html", "10. хайп"],
    ["/econ-11.html", "11. голова"],
    ["/econ-12.html", "12. практика"],
  ];
  const raw = location.pathname.replace(/\/$/, "") || "/";
  const here = raw === "/index.html" ? "/" : raw;
  const i = ch.findIndex(([href]) => here === href || here === href.replace(".html", ""));
  const el = document.querySelector("[data-econ-nav]");
  if (!el || i < 0) return;
  const prev = ch[i - 1];
  const next = ch[i + 1];
  el.innerHTML = `
    ${prev ? `<a href="${prev[0]}">← ${prev[1]}</a>` : "<span></span>"}
    ${next ? `<a href="${next[0]}">${next[1]} →</a>` : "<span></span>"}
  `;
})();
