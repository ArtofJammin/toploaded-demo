  /* ---------- hero + home ----------
     Hero: TL.tilt on the holo card, scroll parallax (aurora + card, rAF, transform only),
     aurora paused off-screen, intro plays once per page load (html.intro-done), inventory
     summary pill. Home: next-up countdowns (timer only while Home is active), the card wall
     from summary.wall, count-up case stats, testimonials from TL.config. */
  var heroEl = $("#hero"), heroStage = $("#stage"), heroHolo = $("#holo");
  var heroTiltOff = null, heroInView = true, homeActive = false, parallaxOn = false, pRaf = 0;
  function bindHeroTilt(){
    if(heroTiltOff){ heroTiltOff(); heroTiltOff = null; }
    if(heroEl && heroEl.classList.contains("collector-hero")) return;
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

  /* ---- play nights: one live countdown per game ----
     The owner asked for a clock to the next play event for EACH game, and for the
     card-show countdown to move to the Card Show page. Countdown digits sit in
     role="timer" aria-live="off" so a screen reader is never spammed by the tick. */
  var nuTimer = 0;
  function setText(el, s){ if(el && el.textContent !== s) el.textContent = s; }
  function setHtml(el, s){ if(el && el.innerHTML !== s) el.innerHTML = s; }
  function fmtWhen(d){
    try {
      return new Intl.DateTimeFormat("en-US", {timeZone: TL.config.timezone || "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}).format(d).replace(":00", "") + " Eastern";
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
  /* soonest upcoming event per game, using the shared schedule maths in 55-events.js */
  function playNightsByGame(){
    var events = (TL.config && TL.config.events) || [], next = {}, order = [];
    var occOf = (TL.calendar && TL.calendar.nextOccurrence) || null;
    for(var i = 0; i < events.length; i++){
      var ev = events[i];
      if(!ev || !ev.name) continue;
      var game = ev.game || "other", occ = null;
      try { occ = occOf ? occOf(ev) : null; } catch(e){ occ = null; }
      if(!occ) continue;
      var when = occ.when;
      var rank = occ.running ? -1 : occ.mins;
      if(!next[game]){ next[game] = {game: game, ev: ev, when: when, rank: rank, running: occ.running}; order.push(game); }
      else if(rank < next[game].rank){ next[game] = {game: game, ev: ev, when: when, rank: rank, running: occ.running}; }
    }
    return order.map(function(g){ return next[g]; }).sort(function(a, b){ return a.rank - b.rank; });
  }
  var pnKey = "";
  function renderPlayNow(){
    var grid = $("#playNowGrid"); if(!grid) return;
    var rows = playNightsByGame();
    if(!rows.length){
      if(pnKey !== "empty"){ pnKey = "empty"; grid.innerHTML = '<li class="playnow-empty">The weekly schedule is being set — <a href="#/events" data-go="events">see the play nights page</a>.</li>'; }
      return;
    }
    var key = rows.map(function(r){ return r.game + r.ev.name + r.when.getTime(); }).join("|");
    if(key !== pnKey){
      pnKey = key;
      grid.innerHTML = rows.map(function(r){
        var label = (TL.gameLabel ? TL.gameLabel(r.game) : r.game) || "Play night";
        var icon = document.getElementById("game-icon-" + r.game)
          ? '<svg class="game-icon" width="30" height="30" aria-hidden="true" focusable="false"><use href="#game-icon-' + esc(r.game) + '"></use></svg>' : "";
        return '<li class="playnow-card" data-game="' + esc(r.game) + '">' +
          '<a class="playnow-btn" href="#/events" data-go="events">' +
            '<span class="playnow-mark">' + icon + '</span>' +
            '<span class="playnow-game">' + esc(label) + '</span>' +
            '<span class="playnow-ev">' + esc(r.ev.name) + '</span>' +
            '<span class="playnow-when" data-when></span>' +
            '<span class="playnow-cd" data-cd role="timer" aria-live="off"></span>' +
            (r.ev.fee ? '<span class="playnow-fee">' + esc(/tbd/i.test(r.ev.fee) ? "Entry TBD" : "Entry " + r.ev.fee) + '</span>' : "") +
          '</a></li>';
      }).join("");
    }
    var cells = grid.querySelectorAll(".playnow-card");
    for(var i = 0; i < rows.length && i < cells.length; i++){
      setText(cells[i].querySelector("[data-when]"), fmtWhen(rows[i].when));
      renderCd(cells[i].querySelector("[data-cd]"), rows[i].when);
    }
  }
  function startNextUp(){
    stopNextUp();
    if(!$("#playNowGrid")) return;
    renderPlayNow();
    if(!document.hidden) nuTimer = setInterval(renderPlayNow, reduceMotion ? 60000 : 1000);
  }
  function stopNextUp(){ if(nuTimer){ clearInterval(nuTimer); nuTimer = 0; } }
  TL.on("motion:change",function(){if(homeActive)startNextUp();});
  document.addEventListener("visibilitychange", function(){ if(document.hidden) stopNextUp(); else if(homeActive) startNextUp(); });
  TL.on("config:change", function(){ if(homeActive){ pnKey = ""; renderPlayNow(); } });

  /* ---- the wall ---- */
  var wallLive = false, wallImagesStarted = false;
  function wallLoadImages(){
    wallImagesStarted = true;
    $$("#wallRows img[data-wall-src]").forEach(function(img){
      img.src = img.getAttribute("data-wall-src");
      img.removeAttribute("data-wall-src");
    });
  }
  function wallTile(w, dup){
    var art = w.item ? cardArt(w.item)
      : '<img class="card-img" data-wall-src="' + esc(w.img || ("https://tcgplayer-cdn.tcgplayer.com/product/" + w.id + "_in_200x200.jpg")) + '" alt="' + esc(w.name) + '" loading="eager" fetchpriority="low" decoding="async" referrerpolicy="no-referrer" width="110" height="154">';
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
    if(wallImagesStarted) wallLoadImages();
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
    if(wall){
      TL.motion.watch(wall, function(inView){ wall.classList.toggle("in-view", inView); if(inView) wallLoadImages(); });
      if("IntersectionObserver" in window){
        var preload = new IntersectionObserver(function(entries){
          if(entries.some(function(entry){ return entry.isIntersecting; })){ wallLoadImages(); preload.disconnect(); }
        }, {rootMargin:"400px"});
        preload.observe(wall);
      } else wallLoadImages();
    }
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

  /* ---- reviews ----
     The owner asked for real Google / TCGplayer reviews here. We render only what the
     shop has actually supplied (Admin → Reviews, or a Google Places pull once the
     Worker is deployed with a key). Nothing is ever invented: with no reviews on file
     the section invites customers to read and leave real ones instead. */
  var REVIEW_SOURCES = {
    google: {label: "Google review", link: function(){ return (TL.config.links && TL.config.links.googleMaps) || ""; }},
    tcgplayer: {label: "TCGplayer feedback", link: function(){ return (TL.config.links && TL.config.links.tcgplayer) || ""; }},
    shop: {label: "In the shop", link: function(){ return ""; }}
  };
  function reviewStars(n){
    n = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    if(!n) return "";
    return '<span class="review-stars" aria-label="' + n + ' out of 5">' + new Array(n + 1).join("★") + '</span>';
  }
  var reviewRemote=null,reviewFetchKey="";
  function reviewUrl(u){try{var p=new URL(u);return p.protocol==="https:"||p.protocol==="http:"?p.href:"";}catch(e){return "";}}
  function fetchReviews(){
    var cfg=TL.config.reviews||{},key=JSON.stringify(cfg);
    if(!TL.api.online||key===reviewFetchKey)return;
    reviewFetchKey=key;reviewRemote=null;
    TL.api.get("/reviews",{noAuth:true}).then(function(d){if(reviewFetchKey===key){reviewRemote=d;renderTestimonials();}}).catch(function(){reviewFetchKey="";});
  }
  function renderTestimonials(){
    var box = $("#testimonials"), tag = $("#testiTag");
    if(!box) return;
    var cfg = (TL.config && TL.config.reviews) || {};
    var min = Number(cfg.minRating || 0);
    var list = (reviewRemote ? reviewRemote.items : Array.isArray(cfg.items) ? cfg.items : []).map(function(t){
      return {q: t.quote || t.text || "", who: t.who || t.name || "", rating: Number(t.rating || 0),
        source: REVIEW_SOURCES[t.source] ? t.source : "shop", url: reviewUrl(t.url),authorUrl:reviewUrl(t.authorUrl),photo:reviewUrl(t.photo)};
    }).filter(function(t){ return t.q && t.rating >= min; }).slice(0, 6);

    if(!list.length){
      var g = (TL.config.links && TL.config.links.googleMaps) || "", tcg = (TL.config.links && TL.config.links.tcgplayer) || "";
      box.innerHTML = '<div class="panel review-empty">' +
        '<p class="quote">Reviews from Google and TCGplayer land here.</p>' +
        '<p class="p-set quote-who">Been in lately? Telling people what you thought is the best thing you can do for a small shop.</p>' +
        '<p class="review-links">' +
          (g ? '<a class="btn btn-ghost" href="' + esc(g) + '" target="_blank" rel="noopener noreferrer">Read &amp; leave a Google review ↗</a>' : "") +
          (tcg ? '<a class="btn btn-ghost" href="' + esc(tcg) + '" target="_blank" rel="noopener noreferrer">Our TCGplayer feedback ↗</a>' : "") +
        '</p></div>';
      if(tag){ tag.textContent = "No reviews published yet"; tag.hidden = false; }
      return;
    }
    box.innerHTML = list.map(function(t){
      var src = REVIEW_SOURCES[t.source], href = t.url || reviewUrl(src.link());
      var who = [t.who, src.label].filter(Boolean).join(" · ");
      return '<div class="panel review-card">' + reviewStars(t.rating) +
        (t.source==="google"&&reviewRemote&&reviewRemote.mode==="google"?'<p><span class="google-maps-attribution" translate="no">Google Maps</span></p>':'')+
        '<p class="quote">“' + esc(t.q) + '”</p>' +
        (t.authorUrl ? '<a class="review-author" href="'+esc(t.authorUrl)+'" target="_blank" rel="noopener noreferrer">'+(t.photo?'<img src="'+esc(t.photo)+'" alt="" width="32" height="32" loading="lazy">':'')+esc(t.who)+'</a>' : '')+
        '<p class="p-set quote-who">' + (href
          ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(who) + ' ↗</a>'
          : esc(who)) + '</p></div>';
    }).join("");
    if(reviewRemote && reviewRemote.mode==="google")box.insertAdjacentHTML("beforeend",'<p class="review-attribution">Google-selected reviews ordered by relevance, filtered to '+esc(min)+'+ stars. <a href="'+esc(reviewUrl(reviewRemote.allReviews))+'" target="_blank" rel="noopener">View all reviews</a> · <a href="'+esc(reviewUrl(reviewRemote.terms))+'">Terms</a> · <a href="'+esc(reviewUrl(reviewRemote.privacy))+'">Privacy</a></p>');
    if(tag){ tag.hidden = false;tag.textContent="Selected positive reviews · "+min+"+ stars, not an overall rating"; }
  }
  TL.on("config:change", function(){reviewRemote=null;renderTestimonials();fetchReviews();});
  TL.on("api:ready",fetchReviews);
