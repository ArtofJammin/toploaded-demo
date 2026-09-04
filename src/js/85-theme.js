  /* ---------- theme toggle ---------- */
  $("#themeBtn").addEventListener("click", function(){
    var root = document.documentElement;
    var cycle = { tl: "light", light: "dark", dark: "tl" };
    var next = cycle[root.getAttribute("data-theme")] || "tl";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("tl-theme", next); } catch(e){}
    toast(next === "tl" ? "Top Loaded theme" : (next === "light" ? "Light mode" : "Dark mode"));
  });
