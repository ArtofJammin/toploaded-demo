  /* ---------- "What's my card worth?" buylist estimator ----------
     Search (debounced) → TL.inventory.search (our stocked items, market field) merged
     with GET /price?game=&q= when the API is online (dedupe by name+set). Picking a
     result shows Market, Cash offer (config.buy.rates by tier) and Store credit
     (+config.buy.creditBonus), with an "Add to my quote" button that appends a line
     to the #bDesc textarea. Works fully offline from the demo/inventory data. */
  var WORTH_TIERS = [
    {key: "bulk", label: "Bulk & commons", hint: "Playable but not chase cards"},
    {key: "standard", label: "Standard single", hint: "Most rares, holos and promos"},
    {key: "hot", label: "Hot / chase card", hint: "In-demand hits we can move fast"},
    {key: "graded", label: "Graded slab", hint: "PSA, CGC, BGS 9 and up"}
  ];
  var worthState = {q: "", game: "pk", results: [], pick: null, tier: "standard", seq: 0};
  function worthRate(tier){ var r = (TL.config.buy || {}).rates || {}; var v = Number(r[tier]); return isNaN(v) ? 0.6 : v; }
  function worthBonus(){ var b = Number((TL.config.buy || {}).creditBonus); return isNaN(b) ? 0.1 : b; }
  function worthMarketOf(it){ var m = Number(it.market); if(m > 0) return m; var p = Number(it.price); return p > 0 ? p : 0; }
  function worthKeyOf(it){ return (String(it.name || "").toLowerCase().replace(/\s+/g, " ").trim() + "|" + String(it.set || "").toLowerCase().replace(/\s+/g, " ").trim()); }
  function worthLocalSearch(q, game, limit){
    var ql = q.toLowerCase(), terms = ql.split(/\s+/).filter(Boolean), pool = [];
    if(TL.inventory && typeof TL.inventory.search === "function"){
      try { var r = TL.inventory.search(q, {game: game, limit: limit}); if(Array.isArray(r) && r.length) return r; } catch(e){}
    }
    if(TL.inventory && Array.isArray(TL.inventory.items) && TL.inventory.items.length) pool = TL.inventory.items;
    else if(typeof LIVE !== "undefined" && LIVE && LIVE.items) pool = LIVE.items;
    else pool = TL.ITEMS || [];
    var out = [];
    for(var i = 0; i < pool.length && out.length < limit; i++){
      var it = pool[i];
      if(game && game !== "all" && it.game !== game) continue;
      var hay = (it.name + " " + (it.set || "")).toLowerCase(), ok = true;
      for(var t = 0; t < terms.length; t++){ if(hay.indexOf(terms[t]) === -1){ ok = false; break; } }
      if(ok) out.push(it);
    }
    return out;
  }
  function worthEnsureInventory(){
    if(TL.inventory && !TL.inventory.loaded && typeof TL.inventory.load === "function"){
      try { var p = TL.inventory.load(); if(p && p.then) return p.catch(function(){ return null; }); } catch(e){}
    }
    return Promise.resolve(null);
  }
  function worthSearch(){
    var q = worthState.q, game = worthState.game, hint = $("#worthHint"), list = $("#worthResults");
    if(!list) return;
    if(q.length < 2){ list.innerHTML = ""; if(hint) hint.textContent = q.length ? "Keep typing…" : "Start typing a card name."; return; }
    var seq = ++worthState.seq;
    if(hint) hint.textContent = (TL.inventory && !TL.inventory.loaded) ? "Loading the case…" : "Searching…";
    list.setAttribute("aria-busy", "true");
    worthEnsureInventory().then(function(){
      if(seq !== worthState.seq) return;
      var local = worthLocalSearch(q, game, 8).map(function(it){ return {name: it.name, set: it.set || "", game: it.game, img: it.img || null, market: worthMarketOf(it), price: it.price, stock: it.stock, source: "inventory", url: it.url || null, item: it}; });
      var remote = TL.api.online ? TL.api.get("/price?game=" + encodeURIComponent(game) + "&q=" + encodeURIComponent(q)).then(function(d){ return (d && Array.isArray(d.results)) ? d.results : []; }).catch(function(){ return []; }) : Promise.resolve([]);
      return remote.then(function(rows){
        if(seq !== worthState.seq) return;
        var seen = {}, merged = [];
        local.forEach(function(r){ var k = worthKeyOf(r); if(!seen[k]){ seen[k] = true; merged.push(r); } });
        rows.forEach(function(r){ if(!r || !r.name) return; var k = worthKeyOf(r); if(seen[k]) return; seen[k] = true; merged.push({name: r.name, set: r.set || "", game: game, img: r.img || null, market: Number(r.market) || 0, source: r.source || "market", url: r.url || null, number: r.number}); });
        merged = merged.filter(function(r){ return r.market > 0; }).slice(0, 10);
        worthState.results = merged;
        renderWorthResults();
      });
    }).catch(function(){ if(seq === worthState.seq){ worthState.results = []; renderWorthResults(); } });
  }
  function renderWorthResults(){
    var list = $("#worthResults"), hint = $("#worthHint"), rs = worthState.results;
    list.removeAttribute("aria-busy");
    if(!rs.length){
      list.innerHTML = "";
      if(hint) hint.textContent = "No match in the case" + (TL.api.online ? " or on the market feed" : "") + " — describe it in the quote form below and we’ll price it by hand.";
      return;
    }
    if(hint) hint.textContent = rs.length + (rs.length === 1 ? " match" : " matches") + " — pick one to see our offer.";
    list.innerHTML = rs.map(function(r, i){
      var thumb = r.img ? '<img src="' + esc(r.img) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<span class="worth-thumb-ph" aria-hidden="true">' + esc((TL.GAMES && TL.GAMES[r.game]) || "TCG").slice(0, 2).toUpperCase() + "</span>";
      return '<li><button type="button" class="worth-row" data-worth="' + i + '" aria-pressed="' + String(worthState.pick === r) + '">' +
        '<span class="worth-thumb">' + thumb + '</span>' +
        '<span class="worth-txt"><b>' + esc(r.name) + '</b><small>' + esc(r.set) + (r.source === "inventory" ? " · in the case" : "") + '</small></span>' +
        '<span class="worth-mkt"><small>Market</small>' + esc(money(r.market)) + '</span></button></li>';
    }).join("");
  }
  function worthNumbers(r){
    var market = r.market, cash = Math.max(0, market * worthRate(worthState.tier)), credit = cash * (1 + worthBonus());
    return {market: market, cash: Math.round(cash * 100) / 100, credit: Math.round(credit * 100) / 100};
  }
  function renderWorthPick(animate){
    var box = $("#worthPick"), r = worthState.pick; if(!box) return;
    if(!r){ box.hidden = true; box.innerHTML = ""; return; }
    var n = worthNumbers(r), bonusPct = Math.round(worthBonus() * 100);
    box.hidden = false;
    box.innerHTML =
      '<div class="worth-pick-head">' +
        (r.img ? '<img class="worth-pick-img" src="' + esc(r.img) + '" alt="" onerror="this.style.display=\'none\'">' : "") +
        '<div><p class="eyebrow">Your card</p><h4>' + esc(r.name) + '</h4><p class="worth-pick-set">' + esc(r.set) + (r.source === "inventory" ? " · we stock this one" : "") + '</p></div>' +
      '</div>' +
      '<fieldset class="worth-tiers"><legend>How would you grade it?</legend>' +
        WORTH_TIERS.map(function(t){ return '<label class="worth-tier' + (worthState.tier === t.key ? " on" : "") + '"><input type="radio" name="worthTier" value="' + t.key + '"' + (worthState.tier === t.key ? " checked" : "") + '><span><b>' + esc(t.label) + '</b><small>' + esc(t.hint) + " · " + Math.round(worthRate(t.key) * 100) + "% of market</small></span></label>"; }).join("") +
      '</fieldset>' +
      '<div class="worth-nums" role="status" aria-live="polite">' +
        '<div class="worth-num"><small>Market</small><span class="worth-val">$<span id="worthMarket">' + esc(n.market.toFixed(2)) + '</span></span></div>' +
        '<div class="worth-num cash"><small>Cash offer</small><span class="worth-val">$<span id="worthCash">' + esc(n.cash.toFixed(2)) + '</span></span></div>' +
        '<div class="worth-num credit"><small>Store credit <em>+' + bonusPct + '%</em></small><span class="worth-val">$<span id="worthCredit">' + esc(n.credit.toFixed(2)) + '</span></span></div>' +
      '</div>' +
      '<div class="worth-actions"><button type="button" class="btn" id="worthAdd">Add to my quote</button>' + (r.url ? '<a class="worth-link" href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">See our listing &rarr;</a>' : "") + '</div>';
    if(animate){ evCountTo($("#worthMarket"), n.market, {decimals: 2, duration: 500}); evCountTo($("#worthCash"), n.cash, {decimals: 2, duration: 700}); evCountTo($("#worthCredit"), n.credit, {decimals: 2, duration: 800}); }
  }
  function worthUpdateNumbers(){
    var r = worthState.pick; if(!r) return;
    var n = worthNumbers(r);
    evCountTo($("#worthCash"), n.cash, {decimals: 2, duration: 450});
    evCountTo($("#worthCredit"), n.credit, {decimals: 2, duration: 550});
    $$(".worth-tier").forEach(function(l){ l.classList.toggle("on", l.querySelector("input").value === worthState.tier); });
  }
  function worthAddToQuote(){
    var r = worthState.pick, ta = $("#bDesc"); if(!r || !ta) return;
    var n = worthNumbers(r), tier = WORTH_TIERS.filter(function(t){ return t.key === worthState.tier; })[0];
    var line = r.name + (r.set ? " (" + r.set + ")" : "") + " ~" + money(n.market) + " market · " + (tier ? tier.label.toLowerCase() : worthState.tier) + " → est. " + money(n.cash) + " cash / " + money(n.credit) + " credit";
    ta.value = (ta.value.trim() ? ta.value.replace(/\s+$/, "") + "\n" : "") + line;
    ta.dispatchEvent(new Event("input", {bubbles: true}));
    var sel = $("#bGames"), gname = {pk: "Pokemon", op: "One Piece", mtg: "Magic: The Gathering"}[r.game];
    if(sel && gname && sel.value !== gname && !/mix/i.test(sel.value)){ var has = false; for(var i = 0; i < sel.options.length; i++){ if(sel.options[i].value === gname) has = true; } if(has && ta.value.split("\n").length <= 1) sel.value = gname; }
    toast("Added to your quote — " + r.name);
    var btn = $("#worthAdd"); if(btn){ btn.textContent = "Added ✓"; btn.disabled = true; setTimeout(function(){ btn.textContent = "Add to my quote"; btn.disabled = false; }, 1400); }
  }
  TL.on("init", function(){
    var q = $("#worthQ"), g = $("#worthGame"), list = $("#worthResults"), pick = $("#worthPick");
    if(!q || !g || !list) return;
    var run = TL.debounce(worthSearch, 260);
    q.addEventListener("input", function(){ worthState.q = q.value.trim(); run(); });
    q.addEventListener("keydown", function(e){ if(e.key === "ArrowDown"){ var first = $(".worth-row", list); if(first){ e.preventDefault(); first.focus(); } } });
    g.addEventListener("change", function(){ worthState.game = g.value; if(worthState.q.length >= 2) worthSearch(); });
    list.addEventListener("click", function(e){
      var b = e.target.closest("[data-worth]"); if(!b) return;
      worthState.pick = worthState.results[parseInt(b.dataset.worth, 10)] || null;
      $$("[data-worth]", list).forEach(function(x){ x.setAttribute("aria-pressed", String(x === b)); });
      renderWorthPick(true);
      if(pick && !reduceMotion){ try { pick.scrollIntoView({block: "nearest", behavior: "smooth"}); } catch(err){} }
    });
    list.addEventListener("keydown", function(e){
      var rows = $$(".worth-row", list), i = rows.indexOf(document.activeElement); if(i < 0) return;
      if(e.key === "ArrowDown" && rows[i + 1]){ e.preventDefault(); rows[i + 1].focus(); }
      if(e.key === "ArrowUp"){ e.preventDefault(); if(rows[i - 1]) rows[i - 1].focus(); else q.focus(); }
    });
    if(pick){
      pick.addEventListener("change", function(e){ if(e.target.name === "worthTier"){ worthState.tier = e.target.value; worthUpdateNumbers(); } });
      pick.addEventListener("click", function(e){ if(e.target.closest("#worthAdd")) worthAddToQuote(); });
    }
    TL.on("config:change", function(){ if(worthState.pick) renderWorthPick(false); });
  });
  TL.on("inventory:loaded", function(){ if(worthState.q.length >= 2) worthSearch(); });
