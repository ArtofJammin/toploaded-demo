  /* ---------- hero + home ----------
     Hero: TL.tilt on the holo card, scroll parallax (aurora + card, rAF, transform only),
     aurora paused off-screen, intro plays once per page load (html.intro-done), inventory
     summary pill. Home: next-up countdowns (timer only while Home is active), the card wall
     from summary.wall, count-up case stats, testimonials from TL.config. */
  var heroEl = $("#hero"), heroStage = $("#stage"), heroHolo = $("#holo");
  var heroTiltOff = null, heroInView = true, homeActive = false, parallaxOn = false, pRaf = 0;
  function bindHeroTilt(){
    if(heroTiltOff){ heroTiltOff(); heroTiltOff = null; }
    if(heroHolo && heroStage && !reduceMotion) heroTiltOff = TL.tilt(heroHolo, {max: 14, area: heroStage, sheen: false});
  }
  function parallaxFrame(){
    pRaf = 0;
    var y = Math.max(0, Math.min(1200, window.scrollY || window.pageYOffset || 0));
    if(heroEl) heroEl.style.setProperty("--py", (y * 0.18).toFixed(1) + "px");
    if(heroStage && window.innerWidth > 960) heroStage.style.setProperty("--sy", (y * -0.1).toFixed(1) + "px");
  }
  function heroOnScroll(){ if(!pRaf) pRaf = requestAnimationFrame(parallaxFrame); }
  function syncParallax(){
    var want = homeActive && heroInView && !reduceMotion && !document.hidden && window.requestAnimationFrame;
    if(want && !parallaxOn){ parallaxOn = true; window.addEventListener("scroll", heroOnScroll, {passive: true}); parallaxFrame(); }
    else if(!want && parallaxOn){
      parallaxOn = false; window.removeEventListener("scroll", heroOnScroll);
      if(pRaf){ cancelAnimationFrame(pRaf); pRaf = 0; }
      if(heroEl) heroEl.style.removeProperty("--py");
      if(heroStage) heroStage.style.removeProperty("--sy");
    }
  }
  var introStarted = false;
  function introDone(){ document.documentElement.classList.add("intro-done"); }
  function startIntroClock(){
    if(introStarted) return;
    introStarted = true;
    if(reduceMotion){ introDone(); return; }
    var cap = $("#stageCaption");
    if(cap) cap.addEventListener("animationend", introDone, {once: true});
    setTimeout(introDone, 2900);
  }
  TL.on("init", function(){
    bindHeroTilt();
    if(heroEl) TL.motion.watch(heroEl, function(inView){
      heroInView = inView;
      heroEl.classList.toggle("aurora-off", !inView);
      syncParallax();
    });
  });
  TL.on("motion:change", function(){ bindHeroTilt(); syncParallax(); if(reduceMotion) introDone(); });
  document.addEventListener("visibilitychange", syncParallax);
  TL.on("view:change", function(d){
    if(!d || d.paramsOnly) return;
    homeActive = d.name === "home";
    if(homeActive){ startIntroClock(); startNextUp(); } else stopNextUp();
    syncParallax();
  });
  TL.on("view:leave", function(d){ if(d && d.name === "home"){ homeActive = false; stopNextUp(); syncParallax(); } });

  /* ---- inventory summary: hero pill, tri copy, case stats, wall ---- */
  var homeSummary = null;
  function heroFreshness(iso){
    var d = new Date(iso || "");
    if(isNaN(d)) return {cls: "idle", label: "every morning", when: ""};
    var h = (Date.now() - d.getTime()) / 36e5;
    var label = h < 1 ? "minutes ago" : h < 24 ? Math.round(h) + " h ago" : h < 48 ? "yesterday" : Math.round(h / 24) + " days ago";
    var when = "";
    try { when = new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric", hour: "numeric", timeZone: (TL.config && TL.config.timezone) || "America/New_York"}).format(d); } catch(e){}
    return {cls: h > 168 ? "crit" : h > 36 ? "warn" : "", label: label, when: when, hours: h};
  }
  function gamesInDepth(sum){
    var g = sum && sum.games || {}, n = 0;
    Object.keys(g).forEach(function(k){ if(g[k] >= 50) n++; });
    return n || Object.keys(g).length;
  }
  function setStat(id, val){
    var el = $("#" + id); if(!el) return;
    el.setAttribute("data-count", String(val));
    if(el.dataset.counted) TL.countUp(el, val); else observeCount(el);
  }
  function renderSummary(sum){
    if(!sum || typeof sum !== "object") return;
    homeSummary = sum;
    var f = heroFreshness(sum.generated);
    var pill = $("#heroInv");
    if(pill){
      pill.innerHTML = '<span class="dot ' + f.cls + '" aria-hidden="true"></span><span id="heroInvTxt"><b>' + fmtInt(sum.products) +
        "</b> products · <b>" + fmtInt(sum.units) + "</b> cards in the case · refreshed " + esc(f.label) + "</span>";
      pill.title = "Live from our TCGplayer store" + (f.when ? " · pulled " + f.when : "");
    }
    var tri = $("#triFresh");
    if(tri) tri.textContent = "last pulled " + (f.when ? f.when : f.label);
    var sf = $("#statFresh");
    if(sf) sf.innerHTML = '<span class="dot ' + f.cls + '" aria-hidden="true"></span>' + esc(f.label);
    setStat("statProducts", sum.products || 0);
    setStat("statUnits", sum.units || 0);
    setStat("statGames", gamesInDepth(sum));
    renderWall();
  }
  TL.on("inventory:summary", function(d){ renderSummary(d && d.summary); });
  TL.on("init", function(){
    if(TL.inventory && TL.inventory.summary) renderSummary(TL.inventory.summary);
    else renderWall();
    renderTestimonials();
  });
  /* if no inventory module ever delivers a summary, fetch the small file ourselves */
  TL.on("ready", function(){
    setTimeout(function(){
      if(homeSummary || !window.fetch) return;
      if(TL.inventory && (TL.inventory.summary || TL.inventory.loaded)) { if(TL.inventory.summary) renderSummary(TL.inventory.summary); return; }
      fetch("inventory-summary.json").then(function(r){ return r.ok ? r.json() : null; }).then(function(s){ if(s && !homeSummary) renderSummary(s); }).catch(function(){});
    }, 2500);
  });

  /* ---- next up strip ----
     Writes only when the string changes; the countdown digits live in role="timer" aria-live="off"
     elements and nothing in #nextUp is a live region, so a ticking clock is never announced. */
  var nuTimer = 0;
  function setText(el, s){ if(el && el.textContent !== s) el.textContent = s; }
  function setHtml(el, s){ if(el && el.innerHTML !== s) el.innerHTML = s; }
  function fmtWhen(d){
    try {
      return new Intl.DateTimeFormat("en-US", {weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}).format(d).replace(":00", "");
    } catch(e){ return d.toDateString(); }
  }
  function renderCd(el, when, windowMs){
    if(!el) return;
    var ms = when.getTime() - Date.now();
    if(ms <= 0 && ms > -(windowMs || 3 * 36e5)){ setHtml(el, '<span class="now">Happening now</span>'); return; }
    if(ms <= 0){ setHtml(el, ""); return; }
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var html = "";
    if(d) html += "<b>" + d + "</b><small>d</small>";
    html += "<b>" + TL.pad2(h) + "</b><small>h</small><b>" + TL.pad2(m) + "</b><small>m</small>";
    if(!reduceMotion && !d) html += "<b>" + TL.pad2(sec) + "</b><small>s</small>";
    setHtml(el, html);
  }
  function tickNextUp(){
    var ev = null, show = null;
    try { ev = TL.nextEvent && TL.nextEvent(); } catch(e){}
    try { show = TL.nextShow && TL.nextShow(); } catch(e){}
    var evCell = $("#nuEvCell");
    if(ev && ev.event && ev.when){
      setText($("#nuEvName"), ev.event.name || "Play night");
      setText($("#nuEvWhen"), fmtWhen(ev.when) + (ev.event.small ? " · " + ev.event.small.split(" · ")[0] : ""));
      renderCd($("#nuEvCd"), ev.when);
      if(evCell && evCell.hidden) evCell.hidden = false;
    } else if(evCell && !evCell.hidden) evCell.hidden = true;
    var showCell = $("#nuShowCell");
    if(show && !isNaN(show)){
      var cfg = (TL.config && TL.config.show) || {};
      setText($("#nuShowName"), "Card show · " + (cfg.venue ? cfg.venue.replace("Cincinnati Airport", "").trim() : "Hilton"));
      setText($("#nuShowWhen"), fmtWhen(show).replace(/,\s*\d{1,2}(:\d{2})?\s*(AM|PM)$/i, "") + " · " + (cfg.hours || "10 AM – 4 PM") + " · Turfway Rd");
      renderCd($("#nuShowCd"), show, 6 * 36e5);
      if(showCell && showCell.hidden) showCell.hidden = false;
    } else if(showCell && !showCell.hidden) showCell.hidden = true;
  }
  function startNextUp(){
    stopNextUp();
    if(!$("#nextUp")) return;
    tickNextUp();
    if(!document.hidden) nuTimer = setInterval(tickNextUp, reduceMotion ? 60000 : 1000);
  }
  function stopNextUp(){ if(nuTimer){ clearInterval(nuTimer); nuTimer = 0; } }
  document.addEventListener("visibilitychange", function(){ if(document.hidden) stopNextUp(); else if(homeActive) startNextUp(); });
  TL.on("config:change", function(){ if(homeActive) tickNextUp(); });

  /* ---- the wall ---- */
  var wallLive = false;
  function wallTile(w, dup){
    var art = w.item ? cardArt(w.item)
      : '<img src="' + esc(w.img || ("https://tcgplayer-cdn.tcgplayer.com/product/" + w.id + "_in_200x200.jpg")) + '" alt="" loading="lazy" decoding="async" width="110" height="154" onerror="this.style.visibility=\'hidden\'">';
    return '<button class="wall-card" type="button" data-wall="' + esc(w.key) + '" data-name="' + esc(w.name) + '" aria-label="' + esc(w.name) + ' · ' + money(w.price) + '"' +
      (dup ? ' tabindex="-1" aria-hidden="true"' : "") + ">" + art +
      '<span class="wc-price" aria-hidden="true">' + money(w.price) + '</span><span class="wc-sheen" aria-hidden="true"></span></button>';
  }
  function wallRow(items, dir, dur){
    var set = items.map(function(w){ return wallTile(w, false); }).join("");
    var dupe = reduceMotion ? "" : '<div class="wall-set" aria-hidden="true">' + items.map(function(w){ return wallTile(w, true); }).join("") + "</div>";
    return '<div class="wall-row" data-dir="' + dir + '" style="--wall-dur:' + dur + 's"><div class="wall-track"><div class="wall-set">' + set + "</div>" + dupe + "</div></div>";
  }
  function renderWall(){
    var rows = $("#wallRows"); if(!rows) return;
    var list = [];
    if(homeSummary && Array.isArray(homeSummary.wall) && homeSummary.wall.length){
      list = homeSummary.wall.filter(function(w){ return w && w.id && w.name; }).slice(0, 40).map(function(w){
        return {key: "tcg-" + w.id, id: w.id, name: w.name, price: Number(w.price) || 0, img: w.img};
      });
      wallLive = true;
    } else {
      list = ITEMS.filter(function(it){ return !it.live; }).map(function(it){ return {key: it.id, id: it.id, name: it.name, price: it.price, item: it}; });
      wallLive = false;
    }
    if(!list.length){ rows.innerHTML = ""; return; }
    var half = Math.ceil(list.length / 2);
    rows.innerHTML = wallRow(list.slice(0, half), "fwd", Math.max(40, half * 5)) + wallRow(list.slice(half), "rev", Math.max(48, half * 6));
  }
  function openWallItem(key, name){
    var inv = TL.inventory;
    function fallback(){ TL.go("shop", name ? {q: name} : {}); }
    if(key.indexOf("tcg-") !== 0){
      var it = ITEMS.find(function(x){ return x.id === key; });
      if(it) TL.openQuickView(it); else fallback();
      return;
    }
    if(!inv){ fallback(); return; }
    var hit = (typeof inv.byId === "function") ? inv.byId(key) : null;
    if(hit){ TL.openQuickView(hit); return; }
    if(typeof inv.load === "function"){
      toast("Opening the case…");
      inv.load().then(function(){
        var h2 = (typeof inv.byId === "function") ? inv.byId(key) : null;
        if(h2) TL.openQuickView(h2); else fallback();
      }).catch(fallback);
    } else fallback();
  }
  document.addEventListener("click", function(e){
    var b = e.target.closest("[data-wall]");
    if(!b) return;
    e.preventDefault();
    openWallItem(b.dataset.wall, b.dataset.name);
  });
  TL.on("init", function(){
    var wall = $("#wall");
    if(wall) TL.motion.watch(wall, function(inView){ wall.classList.toggle("in-view", inView); });
  });
  TL.on("motion:change", renderWall);
  /* pause / play for the marquee (mirrors #tickerPause); hover and focus-within pause it too via CSS */
  (function(){
    var btn = $("#wallPause"), wall = $("#wall");
    if(!btn || !wall) return;
    btn.addEventListener("click", function(){
      var on = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-label", on ? "Resume the card wall" : "Pause the card wall");
      wall.classList.toggle("paused", on);
    });
  })();

  /* ---- testimonials from config (sample quotes stay until the shop adds real ones) ---- */
  function renderTestimonials(){
    var list = TL.config && TL.config.testimonials, box = $("#testimonials"), tag = $("#testiTag");
    if(!box || !Array.isArray(list) || !list.length) return;
    var real = list.map(function(t){
      if(typeof t === "string") return {q: t, who: ""};
      return {q: t.quote || t.text || t.q || "", who: t.who || t.name || t.author || ""};
    }).filter(function(t){ return t.q; }).slice(0, 6);
    if(!real.length) return;
    box.innerHTML = real.map(function(t){
      return '<div class="panel"><p class="quote">“' + esc(t.q) + '”</p>' + (t.who ? '<p class="p-set quote-who">' + esc(t.who) + "</p>" : "") + "</div>";
    }).join("");
    /* the "sample quotes" tag only clears once the list differs from the built-in defaults */
    if(tag) tag.hidden = !(typeof TL.sameAsDefault === "function" && TL.sameAsDefault("testimonials"));
  }
  TL.on("config:change", renderTestimonials);
