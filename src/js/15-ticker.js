  /* ---------- ticker + header chrome ----------
     Ticker: TL.config.ticker → #tickerTrack (rebuilt on config:change), a pause toggle,
     and an sr-only list for assistive tech. "sample offers" tag shows while the list still
     equals the built-in defaults (TL_DEFAULT_CONFIG.ticker), whatever else the shop has saved.
     Header: open/closed pill (TL.shopStatus, every 60 s + config:change), logo/title from
     TL.config, live nav dot only under html.is-live, mobile nav edge cue, scrolled shadow,
     and on phones html.nav-tuck (nav row hides on scroll-down, returns on scroll-up). */
  function sameAsDefault(key){
    var def = (window.TL_DEFAULT_CONFIG || {})[key], cur = TL.config && TL.config[key];
    try { return JSON.stringify(cur) === JSON.stringify(def); } catch(e){ return false; }
  }
  TL.sameAsDefault = sameAsDefault;
  /* "$85" / "85" / "$1,200+" are prices → "up to $85"; "ask" / "top rates" are notes → "· ask" */
  function isPrice(p){ return /^\s*\$?\s*\d/.test(String(p || "")); }
  function tickerItems(){
    var list = (TL.config && TL.config.ticker) || [];
    if(!Array.isArray(list)) return [];
    return list.map(function(b){
      if(Array.isArray(b)) return {n: String(b[0] || ""), p: String(b[1] || "")};
      if(b && typeof b === "object") return {n: String(b.name || ""), p: String(b.upTo || b.price || "")};
      return {n: String(b || ""), p: ""};
    }).filter(function(b){ return b.n; });
  }
  function renderTicker(){
    var track = $("#tickerTrack"), wrap = $("#ticker");
    if(!track) return;
    var items = tickerItems();
    if(wrap) wrap.hidden = !items.length;
    if(!items.length){ track.innerHTML = ""; return; }
    var half = items.map(function(b){
      return "<span>Buying now · <b>" + esc(b.n) + "</b>" + (b.p ? (isPrice(b.p) ? " up to " : " · ") + "<b>" + esc(b.p) + "</b>" : "") + "</span>";
    }).join("");
    track.innerHTML = reduceMotion ? half : half + half;
    var ul = $("#tickerList");
    if(ul) ul.innerHTML = items.map(function(b){ return "<li>" + esc(b.n) + (b.p ? (isPrice(b.p) ? " — up to " : " — ") + esc(b.p) : "") + "</li>"; }).join("");
    var tag = $("#tickerDemo");
    if(tag) tag.hidden = !sameAsDefault("ticker");
  }
  (function(){
    var btn = $("#tickerPause"), wrap = $("#ticker");
    if(!btn || !wrap) return;
    btn.addEventListener("click", function(){
      var on = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-label", on ? "Resume the buying desk ticker" : "Pause the buying desk ticker");
      wrap.classList.toggle("paused", on);
    });
  })();
  TL.on("init", renderTicker);
  TL.on("config:change", renderTicker);
  TL.on("motion:change", renderTicker);

  /* ---- open / closed pill ---- */
  var openTimer = 0, lastPillHtml = "";
  function shortSub(sub){
    sub = String(sub || "");
    var m;
    if((m = /^Closes in (\d+) min/.exec(sub))) return "closes in " + m[1] + " min";
    if((m = /^Closes at (.+)$/.exec(sub))) return "closes " + m[1];
    if((m = /^Opens today at (.+)$/.exec(sub))) return "opens " + m[1];
    if((m = /^Opens tomorrow at (.+)$/.exec(sub))) return "opens tomorrow " + m[1];
    if((m = /^Opens (\w+) at (.+)$/.exec(sub))) return "opens " + m[1].slice(0, 3) + " " + m[2];
    return sub.toLowerCase();
  }
  function renderOpenPill(){
    var pill = $("#openPill");
    if(!pill || typeof TL.shopStatus !== "function") return;
    var s;
    try { s = TL.shopStatus(); } catch(e){ return; }
    if(!s) return;
    var m = /Closes in (\d+) min/.exec(s.sub || ""), soon = !!(s.open && m && parseInt(m[1], 10) <= 45);
    pill.classList.toggle("is-open", !!s.open && !soon);
    pill.classList.toggle("is-soon", soon);
    pill.classList.toggle("is-closed", !s.open);
    var label = s.open ? (soon ? "Closing soon" : "Open now") : "Closed";
    var labelHtml = s.open ? (soon ? 'Closing<span class="open-now"> soon</span>' : 'Open<span class="open-now"> now</span>') : "Closed";
    var sub = shortSub(s.sub);
    var html = '<span class="dot" aria-hidden="true"></span><b>' + labelHtml + "</b>" + (sub ? '<span class="open-sub"> · ' + esc(sub) + "</span>" : "");
    if(lastPillHtml !== html){ pill.innerHTML = html; lastPillHtml = html; }
    pill.title = "Shop hours: " + label + (sub ? " · " + sub : "");
    pill.hidden = false;
  }
  function startOpenTimer(){ stopOpenTimer(); renderOpenPill(); openTimer = setInterval(renderOpenPill, 60000); }
  function stopOpenTimer(){ if(openTimer){ clearInterval(openTimer); openTimer = 0; } }
  document.addEventListener("visibilitychange", function(){ if(document.hidden) stopOpenTimer(); else startOpenTimer(); });
  TL.on("init", startOpenTimer);
  TL.on("config:change", renderOpenPill);

  /* ---- brand: logo (one <img>, src per theme or the admin's data URL) + title ---- */
  function applyBrand(){
    var cfg = TL.config || {};
    var theme = (typeof TL.theme === "function") ? TL.theme() : (document.documentElement.getAttribute("data-theme") || "tl");
    var fallback = theme === "light" ? "logo-light.png" : "logo-dark.png";
    var custom = (typeof cfg.logo === "string" && /^data:image\//.test(cfg.logo)) ? cfg.logo : null;
    $$(".brand-logo, .foot-logo").forEach(function(img){
      var themed = img.classList.contains("logo-d") || img.classList.contains("logo-l");
      var src = custom || (themed ? null : fallback);
      if(src && img.getAttribute("src") !== src) img.src = src;
    });
    if(custom) document.documentElement.classList.remove("no-logo");
    var bn = $("#brandName");
    if(bn && bn.firstChild && bn.firstChild.nodeType === 3 && cfg.title) bn.firstChild.nodeValue = cfg.title;
    var tag = $("#brandTag");
    if(tag && cfg.tagline) tag.textContent = cfg.tagline;
    var brand = $(".brand");
    if(brand) brand.setAttribute("aria-label", (cfg.title || "Top Loaded") + " home");
  }
  TL.on("init", applyBrand);
  TL.on("config:change", applyBrand);
  TL.on("theme:change", applyBrand);

  /* ---- live dot: pulses only while the shop is on air ---- */
  function applyLiveDot(){
    var on = !!(TL.config && TL.config.live && TL.config.live.on);
    document.documentElement.classList.toggle("is-live", on);
  }
  TL.on("init", applyLiveDot);
  TL.on("config:change", applyLiveDot);
  TL.on("live:change", applyLiveDot);

  /* ---- mobile nav: right-edge fade cue + keep the active item in view ---- */
  (function(){
    var nav = $("#mainnav");
    if(!nav) return;
    function edge(){
      var can = nav.scrollWidth > nav.clientWidth + 2;
      nav.classList.toggle("can-scroll", can);
      nav.classList.toggle("at-end", !can || nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2);
    }
    nav.addEventListener("scroll", edge, {passive: true});
    window.addEventListener("resize", TL.debounce(edge, 120));
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(edge, function(){});
    TL.on("init", edge);
    TL.on("view:change", function(d){
      edge();
      if(!(d && d.name) || d.paramsOnly) return;
      if(nav.scrollWidth <= nav.clientWidth + 2) return;
      var b = nav.querySelector('[data-go="' + d.name + '"]');
      if(!b) return;
      var left = Math.max(0, b.offsetLeft - 20);
      try { nav.scrollTo({left: left, behavior: reduceMotion ? "auto" : "smooth"}); } catch(e){ nav.scrollLeft = left; }
    });
  })();

  /* ---- scrolled header (shadow + logo condense) via a sentinel, no scroll handler ---- */
  (function(){
    var s = $("#scrollSentinel");
    if(!s || !("IntersectionObserver" in window)) return;
    new IntersectionObserver(function(entries){
      document.documentElement.classList.toggle("scrolled", !entries[0].isIntersecting);
    }, {threshold: 0}).observe(s);
  })();

  /* ---- phones: only the brand row stays on screen. Scrolling down tucks the nav row
     (html.nav-tuck → 10-header.css fades it, keeps its space), scrolling up, changing view,
     or tabbing into the nav brings it back. Bound only while the 640px query matches. ---- */
  (function(){
    var nav = $("#mainnav"), mq = window.matchMedia ? window.matchMedia("(max-width:640px)") : null;
    if(!nav || !mq) return;
    var lastY = 0, bound = false, tucked = false;
    function y(){ return window.scrollY || window.pageYOffset || 0; }
    function set(t){
      if(t === tucked) return;
      tucked = t; document.documentElement.classList.toggle("nav-tuck", t);
    }
    /* cheap enough to run inline (one scrollY read, one class toggle) — no layout reads, no rAF */
    function onScroll(){
      var cur = y(), dy = cur - lastY;
      if(cur < 96) set(false);
      else if(dy > 6) set(true);
      else if(dy < -6) set(false);
      lastY = cur;
    }
    function sync(){
      var want = mq.matches;
      if(want && !bound){ bound = true; lastY = y(); window.addEventListener("scroll", onScroll, {passive: true}); }
      else if(!want && bound){ bound = false; window.removeEventListener("scroll", onScroll); set(false); }
    }
    if(mq.addEventListener) mq.addEventListener("change", sync); else if(mq.addListener) mq.addListener(sync);
    sync();
    nav.addEventListener("focusin", function(){ set(false); });
    TL.on("view:change", function(d){ if(d && d.paramsOnly) return; set(false); lastY = y(); });
  })();
