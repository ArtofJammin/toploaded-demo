  /* ---------- theme toggle ----------
     Cycles tl → light → dark. Emits 'theme:change' {theme} and keeps the button label
     and the browser theme-color in step. TL.theme() returns the current theme. */
  var THEME_NAMES = {tl: "Top Loaded theme", light: "Light mode", dark: "Dark mode"};
  var THEME_COLORS = {tl: "#0C0A06", light: "#EFF1F4", dark: "#0C0E12"};
  function applyThemeMeta(t){
    var btn = $("#themeBtn"), cycle = {tl: "light", light: "dark", dark: "tl"};
    if(btn){
      btn.setAttribute("aria-label", "Theme: " + THEME_NAMES[t] + ". Switch to " + THEME_NAMES[cycle[t]].toLowerCase());
      btn.title = THEME_NAMES[t] + " \u2192 " + THEME_NAMES[cycle[t]];
    }
    $$('meta[name="theme-color"]').forEach(function(m){ if(!m.media) m.setAttribute("content", THEME_COLORS[t] || THEME_COLORS.tl); });
  }
  TL.theme = function(){ return document.documentElement.getAttribute("data-theme") || "tl"; };
  TL.setTheme = function(next){
    if(!THEME_NAMES[next]) return;
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("tl-theme", next); } catch(e){}
    applyThemeMeta(next);
    TL.emit("theme:change", {theme: next});
  };
  $("#themeBtn").addEventListener("click", function(){
    var cycle = {tl: "light", light: "dark", dark: "tl"};
    var next = cycle[TL.theme()] || "tl";
    TL.setTheme(next);
    toast(THEME_NAMES[next]);
  });
  applyThemeMeta(TL.theme());
