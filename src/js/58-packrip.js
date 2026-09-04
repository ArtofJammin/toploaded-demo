  /* ---------- pack rip: virtual booster mini-game ----------
     View #view-rip (route "rip"), app root #ripApp, announcer #ripLive.
     Every card is a real in-stock single from TL.inventory (game + set); demo ITEMS
     when inventory is unavailable. Pulls are rarity-weighted per game (see PACKS);
     the last card in the fan is the hit slot.

       TL.rip.draw(game, set, seed?)   → [{item, tier, rank, rare, rh, hit}]  pure, seedable
       TL.rip.start(game, set)         → jump to the pack screen
       TL.rip.stats()                  → {packs, value, spent, best}

     Consumes (all guarded, all optional): TL.inventory.load()/items/summary,
     TL.cart.add(item, qty, fromEl), TL.openQuickView(item), TL.confetti(x, y, opts).
     Stores: TL.store "rip" {game, set} last choice, "ripStats" session stats.
  */
  var PACKS = {
    pk:  {name:"Pokemon",   price:4.49, size:10, tiers:["C","U","R","RR","IR","SIR","HR"], rareFrom:3,
          labels:{C:"Common", U:"Uncommon", R:"Rare", RR:"Double Rare", IR:"Illustration Rare", SIR:"Special Illustration Rare", HR:"Hyper Rare"},
          hit:{R:60, RR:22, IR:10, SIR:5, HR:3},
          note:"5 commons · 3 uncommons · 1 reverse holo · 1 rare-or-better slot"},
    op:  {name:"One Piece", price:4.49, size:12, tiers:["C","UC","R","SR","L","SEC"], rareFrom:3,
          labels:{C:"Common", UC:"Uncommon", R:"Rare", SR:"Super Rare", L:"Leader", SEC:"Secret Rare"},
          hit:{R:74, SR:16, L:6, SEC:4},
          note:"8 commons · 2 uncommons · 1 rare · 1 rare-or-better slot"},
    mtg: {name:"Magic",     price:5.49, size:14, tiers:["C","U","R","M"], rareFrom:2,
          labels:{C:"Common", U:"Uncommon", R:"Rare", M:"Mythic Rare"},
          hit:{R:6, M:1},
          note:"7 commons · 3 uncommons · 1 land · 2 wildcards · 1 rare-or-mythic slot (mythic 1 in 7)"}
  };
  var RIP_GAMES = ["pk", "op", "mtg"];
  var RARITY_RE = /rare|common|uncommon|leader|mythic|promo|land|token|don!!|classic collection|none$/i;

  function ripTier(game, rarity){
    var r = String(rarity || "").toLowerCase();
    if(game === "pk"){
      if(/^common/.test(r)) return "C";
      if(/^uncommon/.test(r)) return "U";
      if(/special illustration|special art|secret/.test(r)) return "SIR";
      if(/hyper|rainbow/.test(r)) return "HR";
      if(/illustration|art rare|shiny holo/.test(r)) return "IR";
      if(/double|ultra|ace|mega|amazing|radiant|prism|super|shiny|full art/.test(r)) return "RR";
      return "R";
    }
    if(game === "op"){
      if(/^common/.test(r)) return "C";
      if(/^uncommon/.test(r)) return "UC";
      if(/leader/.test(r)) return "L";
      if(/secret|treasure/.test(r)) return "SEC";
      if(/super|special|\bsp\b/.test(r)) return "SR";
      return "R";
    }
    if(/^common|land|token|basic/.test(r)) return "C";
    if(/^uncommon/.test(r)) return "U";
    if(/mythic/.test(r)) return "M";
    return "R";
  }
  /* live items may carry rarity in `rarity` or appended to `set` as " · Rarity" */
  function ripRarity(it){
    if(it.rarity) return it.rarity;
    var s = String(it.set || ""), i = s.lastIndexOf(" · ");
    if(i > -1 && RARITY_RE.test(s.slice(i + 3))) return s.slice(i + 3);
    /* demo ITEMS carry no rarity: read the hint in the name */
    var n = String(it.name || "");
    if(/\(secret\)/i.test(n)) return "Secret Rare";
    if(/\(leader\)/i.test(n)) return "Leader";
    if(/\(sr\)/i.test(n)) return "Super Rare";
    if(/special art/i.test(n)) return "Special Art Rare";
    if(/\bex\b/i.test(n)) return "Double Rare";
    if(/promo|hat/i.test(n)) return "Illustration Rare";
    return "";
  }
  function ripSetName(it){
    if(it.setName) return it.setName;
    var s = String(it.set || ""), i = s.lastIndexOf(" · ");
    if(i > -1 && (it.rarity ? s.slice(i + 3) === it.rarity : RARITY_RE.test(s.slice(i + 3)))) return s.slice(0, i);
    return s;
  }
  function ripIsReverse(it){
    if(it.cond && /RH|reverse/i.test(it.cond)) return true;
    var ls = it.listings; if(ls && ls.length) for(var i = 0; i < ls.length; i++) if(/reverse/i.test(ls[i].printing || "")) return true;
    return false;
  }
  /* 400px CDN face for any TCGplayer product (the shop grid uses 200px thumbs) */
  function ripImg(it){
    var m = /^tcg-(\d+)$/.exec(String(it.id || ""));
    if(m) return "https://tcgplayer-cdn.tcgplayer.com/product/" + m[1] + "_in_400x400.jpg";
    return it.img || "";
  }
  /* mulberry32: a seed makes TL.rip.draw reproducible for tests */
  function ripRng(seed){
    if(seed === undefined || seed === null) return Math.random;
    var a = (Number(seed) >>> 0) || 1;
    return function(){
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function ripWeighted(weights, rng){
    var keys = Object.keys(weights), total = 0, i;
    for(i = 0; i < keys.length; i++) total += weights[keys[i]];
    var x = rng() * total;
    for(i = 0; i < keys.length; i++){ x -= weights[keys[i]]; if(x <= 0) return keys[i]; }
    return keys[keys.length - 1];
  }
  /* slot plan per game, in reveal order (hit slot last) */
  function ripSlots(game, rng){
    var s = [], i;
    if(game === "pk"){
      for(i = 0; i < 5; i++) s.push({tier:"C"});
      for(i = 0; i < 3; i++) s.push({tier:"U"});
      s.push({tier: ripWeighted({C:55, U:30, R:15}, rng), rh:true});
      s.push({tier: ripWeighted(PACKS.pk.hit, rng), hit:true});
    } else if(game === "op"){
      for(i = 0; i < 8; i++) s.push({tier:"C"});
      for(i = 0; i < 2; i++) s.push({tier:"UC"});
      s.push({tier:"R"});
      s.push({tier: ripWeighted(PACKS.op.hit, rng), hit:true});
    } else {
      for(i = 0; i < 7; i++) s.push({tier:"C"});
      for(i = 0; i < 3; i++) s.push({tier:"U"});
      s.push({tier:"C", land:true});
      s.push({tier: ripWeighted({C:50, U:30, R:17, M:3}, rng)});
      s.push({tier: ripWeighted({C:50, U:30, R:17, M:3}, rng), foil:true});
      s.push({tier: ripWeighted(PACKS.mtg.hit, rng), hit:true});
    }
    return s;
  }
  /* pool: singles in stock for game (+ set), bucketed by tier */
  function ripPool(items, game, set){
    var pool = {all:[]}, tiers = PACKS[game].tiers, i;
    for(i = 0; i < tiers.length; i++) pool[tiers[i]] = [];
    for(i = 0; i < items.length; i++){
      var it = items[i];
      if(it.game !== game || it.type !== "single" || !(it.stock > 0) || it.live) continue;
      if(set && set !== "*" && ripSetName(it) !== set) continue;
      var t = ripTier(game, ripRarity(it));
      pool[t].push(it); pool.all.push(it);
    }
    return pool;
  }
  /* pick from `tier`, walking to the nearest tier when the set lacks one; avoid repeats while possible */
  function ripPick(pool, game, slot, used, rng){
    var tiers = PACKS[game].tiers, idx = tiers.indexOf(slot.tier), order = [idx], d, lists, j;
    for(d = 1; d < tiers.length; d++){ if(idx - d >= 0) order.push(idx - d); if(idx + d < tiers.length) order.push(idx + d); }
    for(j = 0; j < order.length; j++){
      lists = pool[tiers[order[j]]];
      if(!lists || !lists.length) continue;
      var cands = lists.filter(function(it){ return !used[it.id]; });
      if(slot.rh){ var rh = cands.filter(ripIsReverse); if(rh.length) cands = rh; }
      if(!cands.length) continue;
      var it = cands[Math.floor(rng() * cands.length)];
      return {item: it, tier: tiers[order[j]]};
    }
    return null; /* pool exhausted: the pack is short rather than repeating a card */
  }
  function ripDraw(items, game, set, seed){
    var P = PACKS[game]; if(!P) return [];
    var rng = ripRng(seed), pool = ripPool(items, game, set), slots = ripSlots(game, rng), used = {}, out = [];
    if(!pool.all.length) return out;
    for(var i = 0; i < slots.length; i++){
      var got = ripPick(pool, game, slots[i], used, rng);
      if(!got) continue;
      used[got.item.id] = true;
      var rank = P.tiers.indexOf(got.tier);
      out.push({item: got.item, tier: got.tier, rank: rank, rare: rank >= P.rareFrom, rh: !!slots[i].rh, foil: !!slots[i].foil, hit: !!slots[i].hit});
    }
    return out;
  }

  /* ---- inventory access (guarded: the shop package owns TL.inventory) ---- */
  var ripItemsP = null, ripItems = null, ripDemo = false;
  function ripNormalize(p){
    var ls = p.listings || [], best = ls[0], qty = 0, i;
    if(!best) return null;
    for(i = 0; i < ls.length; i++){ qty += ls[i].qty || 0; if(ls[i].price < best.price) best = ls[i]; }
    var sealed = /booster box|elite trainer|booster bundle|collection box|booster display|booster pack|premium collection|box set|blister|tin\b|sleeves|deck\b/i.test(p.name + " " + (p.set || ""));
    return {id:"tcg-" + p.id, name:p.name, set:p.set, lineName:p.line, rarity:p.rarity || "", market:p.market,
      game:(p.game === "pk" || p.game === "op" || p.game === "mtg") ? p.game : "other", type: sealed ? "sealed" : "single",
      cond: best.cond || null, price: best.price, stock: qty, tcg:true, listings: ls,
      img:"https://tcgplayer-cdn.tcgplayer.com/product/" + p.id + "_in_400x400.jpg",
      url:"https://www.tcgplayer.com/product/" + p.id + "?seller=5c356cdf"};
  }
  function ripLoadItems(){
    if(ripItemsP) return ripItemsP;
    ripItemsP = Promise.resolve().then(function(){
      var inv = TL.inventory;
      if(inv && typeof inv.load === "function") return inv.load();
      if(inv && inv.items && inv.items.length) return inv.items;
      if(!window.fetch) return null;
      return fetch("inventory.json").then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
        if(!d || !d.items) return null;
        var out = [];
        for(var i = 0; i < d.items.length; i++){ var it = ripNormalize(d.items[i]); if(it) out.push(it); }
        return out;
      });
    }).then(function(items){
      if(!items || !items.length) throw new Error("no inventory");
      /* the shop module hands back the demo ITEMS when inventory.json fails; treat that as demo too */
      ripItems = items; ripDemo = !items.some(function(it){ return it.tcg; }); ripSetCache = {};
      return items;
    }).catch(function(){
      ripItems = ITEMS.slice(); ripDemo = true; ripSetCache = {};
      return ripItems;
    });
    return ripItemsP;
  }
  var ripSetCache = {};
  function ripSetsFor(game){
    var P = PACKS[game];
    if(ripItems){
      if(ripSetCache[game]) return ripSetCache[game];
      var counts = {}, i;
      for(i = 0; i < ripItems.length; i++){
        var it = ripItems[i];
        if(it.game !== game || it.type !== "single" || !(it.stock > 0)) continue;
        var s = ripSetName(it); counts[s] = (counts[s] || 0) + 1;
      }
      var list = Object.keys(counts).map(function(k){ return {name:k, count:counts[k]}; })
        .filter(function(x){ return ripDemo || x.count >= P.size; })
        .sort(function(a, b){ return b.count - a.count; });
      if(ripDemo) list = [{name:"*", count: list.reduce(function(n, x){ return n + x.count; }, 0)}];
      return (ripSetCache[game] = list);
    }
    var sum = TL.inventory && TL.inventory.summary;
    if(sum && sum.sets && sum.sets[game]) return sum.sets[game].filter(function(x){ return x.count >= P.size; }).map(function(x){ return {name:x.name, count:x.count, approx:true}; });
    return null;
  }

  /* ---- state + rendering ---- */
  var ripApp = $("#ripApp"), ripLiveEl = $("#ripLive");
  var rip = {stage:"setup", game:"pk", set:"", cards:[], flipped:0, timers:[], drag:null};
  var ripPrefs = TL.store.get("rip", null) || {};
  if(PACKS[ripPrefs.game]) rip.game = ripPrefs.game;
  if(ripPrefs.set) rip.set = ripPrefs.set;

  function ripLater(fn, ms){ var t = setTimeout(fn, reduceMotion ? 0 : ms); rip.timers.push(t); return t; }
  function ripClearTimers(){ rip.timers.forEach(clearTimeout); rip.timers = []; }
  function ripSay(msg){ if(ripLiveEl){ ripLiveEl.textContent = ""; ripLiveEl.textContent = msg; } }
  function ripPackPrice(game){
    var cfg = TL.config && TL.config.rip && TL.config.rip.prices;
    return (cfg && Number(cfg[game]) > 0) ? Number(cfg[game]) : PACKS[game].price;
  }
  function ripStats(){ return TL.store.get("ripStats", null) || {packs:0, value:0, spent:0, best:null}; }
  TL.rip = {
    draw: function(game, set, seed){ return ripDraw(ripItems || ITEMS, game || rip.game, set || rip.set || "*", seed); },
    start: function(game, set){ if(PACKS[game]) rip.game = game; if(set) rip.set = set; TL.go("rip"); ripStartPack(); },
    stats: ripStats,
    packs: PACKS
  };

  function ripOddsTable(game){
    var P = PACKS[game], keys = Object.keys(P.hit), total = 0, i;
    for(i = 0; i < keys.length; i++) total += P.hit[keys[i]];
    var rows = keys.map(function(k){
      var pct = P.hit[k] / total * 100;
      return '<tr><th scope="row">' + esc(P.labels[k]) + '</th><td>' + (pct >= 10 ? Math.round(pct) : pct.toFixed(1)) + '%</td></tr>';
    }).join("");
    return '<table class="rip-odds"><caption class="rip-sr">Odds for the rare slot in a ' + esc(P.name) + ' pack</caption>' +
      '<thead><tr><th scope="col">Rare slot</th><th scope="col">Chance</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="rip-note">' + esc(P.note) + ' &middot; for fun, not real pull rates</p>';
  }
  function ripStatsCard(){
    var s = ripStats();
    var best = s.best ? '<div class="rip-best-mini">' +
        (s.best.img ? '<img src="' + esc(s.best.img) + '" alt="" loading="lazy" width="48" height="48">' : '<span class="rip-best-ph" aria-hidden="true"></span>') +
        '<div><b>' + esc(s.best.name) + '</b><span>Best pull &middot; ' + money(s.best.price) + '</span></div></div>'
      : '<p class="rip-note">No pulls yet &mdash; tear one open.</p>';
    return '<aside class="rip-stats panel" aria-labelledby="ripStatsH"><h3 id="ripStatsH">Your stats</h3>' +
      '<dl><div><dt>Packs</dt><dd>' + fmtInt(s.packs) + '</dd></div>' +
      '<div><dt>Pulled</dt><dd>' + money(s.value) + '</dd></div>' +
      '<div><dt>Spent</dt><dd>' + money(s.spent) + '</dd></div></dl>' + best +
      '<button class="btn btn-ghost rip-cta" type="button" data-go="shop" data-params="type=sealed&game=' + esc(rip.game) + '">Buy real packs</button>' +
      '<p class="rip-note">Stats live in this browser only.</p></aside>';
  }
  function ripRenderSetup(){
    rip.stage = "setup"; ripApp.dataset.stage = "setup";
    var sets = ripSetsFor(rip.game), P = PACKS[rip.game], price = ripPackPrice(rip.game);
    var setOpts, canRip = true;
    if(sets === null){ setOpts = '<option value="">Loading sets…</option>'; canRip = false; }
    else if(!sets.length){ setOpts = '<option value="">No sets with enough singles yet</option>'; canRip = false; }
    else {
      if(!sets.some(function(x){ return x.name === rip.set; })) rip.set = sets[0].name;
      setOpts = sets.map(function(x){
        return '<option value="' + esc(x.name) + '"' + (x.name === rip.set ? " selected" : "") + '>' +
          (x.name === "*" ? "Sample cards (demo case)" : esc(x.name)) + " · " + fmtInt(x.count) + (x.approx ? " products" : " singles") + '</option>';
      }).join("");
    }
    ripApp.innerHTML = '<div class="rip-setup">' +
      '<div class="rip-config panel">' +
        '<div class="rip-field"><span class="rip-label" id="ripGameL">Game</span>' +
          '<div class="chip-row" role="group" aria-labelledby="ripGameL">' + RIP_GAMES.map(function(g){
            return '<button class="chip" type="button" data-rip-game="' + g + '" aria-pressed="' + (g === rip.game) + '">' + esc(PACKS[g].name) + '</button>';
          }).join("") + '</div></div>' +
        '<div class="rip-field"><label class="rip-label" for="ripSet">Set</label><select id="ripSet"' + (canRip ? "" : " disabled") + '>' + setOpts + '</select></div>' +
        '<div class="rip-price"><span class="rip-label">Pack price</span><b>' + money(price) + '</b><span class="rip-note">' + esc(P.size) + ' cards &middot; ' + esc(P.name) + '</span></div>' +
        '<button class="btn rip-go" type="button" data-rip-open' + (canRip ? "" : " disabled") + '>Rip it</button>' +
        (ripDemo ? '<p class="rip-note">Live inventory is unavailable, so this pack draws from our sample cards. <button class="linklike" type="button" data-rip-retry>Retry</button></p>' : "") +
      '</div>' +
      '<div class="rip-odds-wrap panel"><h3>Odds</h3>' + ripOddsTable(rip.game) + '</div>' +
      ripStatsCard() + '</div>';
  }
  function ripRenderPack(){
    rip.stage = "pack"; ripApp.dataset.stage = "pack";
    var P = PACKS[rip.game], setLabel = rip.set === "*" ? "Sample case" : rip.set;
    ripApp.innerHTML = '<div class="rip-stage" id="ripStage" data-game="' + esc(rip.game) + '">' +
      '<div class="rip-packwrap">' +
        '<div class="rip-pack" id="ripPack" role="button" tabindex="0" aria-label="Sealed ' + esc(P.name) + ' pack, ' + esc(setLabel) + '. Press Enter to tear it open, or drag across the tear strip.">' +
          '<span class="rip-foil" aria-hidden="true"></span><span class="rip-crimp top" aria-hidden="true"></span>' +
          '<div class="rip-strip" aria-hidden="true"><span>Tear here &#9656;&#9656;&#9656;</span></div>' +
          '<div class="rip-packart" aria-hidden="true"><span class="rip-packgame">' + esc(P.name) + '</span><b>TL</b><span class="rip-packset">' + esc(setLabel) + '</span><span class="rip-packn">' + esc(P.size) + ' cards</span></div>' +
          '<span class="rip-crimp bottom" aria-hidden="true"></span>' +
        '</div>' +
        '<p class="rip-hint" id="ripHint">' + (reduceMotion ? "Press Open pack to see your cards." : "Swipe across the strip to tear it, or press Enter.") + '</p>' +
        '<div class="rip-actions"><button class="btn" type="button" data-rip-tear>Open pack</button><button class="btn btn-ghost" type="button" data-rip-back>Change set</button></div>' +
      '</div>' +
      '<div class="rip-cards" id="ripCards" hidden></div>' +
      '<div class="rip-results" id="ripResults" hidden></div>' +
    '</div>';
    ripSay("Pack ready: " + P.name + ", " + setLabel + ". Press Enter or Open pack to tear it.");
    var pack = $("#ripPack"); if(pack) try { pack.focus({preventScroll:true}); } catch(e){}
  }
  function ripStartPack(){
    ripClearTimers();
    TL.store.set("rip", {game: rip.game, set: rip.set});
    rip.cards = ripDraw(ripItems || ITEMS, rip.game, rip.set || "*");
    rip.flipped = 0;
    if(!rip.cards.length){ toast("That set has no singles in stock right now"); ripRenderSetup(); return; }
    /* warm the CDN thumbs while the pack is on screen */
    rip.cards.forEach(function(c){ var src = ripImg(c.item); if(src){ var im = new Image(); im.decoding = "async"; im.src = src; } });
    ripRenderPack();
  }

  /* ---- tear ---- */
  function ripTearProgress(p){
    var pack = $("#ripPack"); if(pack) pack.style.setProperty("--tear", String(TL.clamp(p, 0, 1)));
  }
  function ripTear(){
    var pack = $("#ripPack"); if(!pack || rip.stage !== "pack") return;
    rip.stage = "tearing";
    pack.classList.add("torn"); pack.setAttribute("aria-disabled", "true"); pack.setAttribute("tabindex", "-1");
    var hint = $("#ripHint"); if(hint) hint.textContent = "Ripped! Flip the cards.";
    var acts = $(".rip-actions", ripApp); if(acts) acts.hidden = true;
    var rect = pack.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height * .4;
    if(!reduceMotion) TL.confetti(cx, cy, {count: 24, spread: 50});
    ripLater(function(){ ripDeal(cx, cy); }, 380);
  }
  function ripCardHtml(c, i){
    var it = c.item, P = PACKS[rip.game], src = ripImg(it);
    var front = src ? '<img src="' + esc(src) + '" alt="" decoding="async">' : cardArt(it);
    return '<button class="rip-card" type="button" data-rip-flip="' + i + '" style="--i:' + i + '" aria-label="Card ' + (i + 1) + ' of ' + rip.cards.length + ', face down. Flip it." aria-pressed="false">' +
      '<span class="rip-card-inner"><span class="rip-face back" aria-hidden="true"><b>TL</b></span>' +
      '<span class="rip-face front"' + (src ? "" : ' data-drawn') + '>' + front + '<span class="rip-sheen" aria-hidden="true"></span>' +
      '<span class="rip-tag' + (c.rare ? " rare" : "") + '">' + esc(c.rh ? "Reverse holo" : c.foil ? "Foil " + P.labels[c.tier] : P.labels[c.tier]) + '</span></span></span></button>';
  }
  function ripDeal(cx, cy){
    var wrap = $("#ripCards"); if(!wrap) return;
    rip.stage = "cards"; ripApp.dataset.stage = "cards";
    wrap.innerHTML = '<div class="rip-cardbar"><span class="rip-progress" id="ripProgress">0 of ' + rip.cards.length + ' flipped</span>' +
      '<div class="rip-cardbtns"><button class="btn btn-ghost" type="button" data-rip-next>Flip next</button><button class="btn btn-ghost" type="button" data-rip-all>Flip all</button></div></div>' +
      '<div class="rip-grid" id="ripGrid">' + rip.cards.map(ripCardHtml).join("") + '</div>';
    wrap.hidden = false;
    var grid = $("#ripGrid"), cards = $$(".rip-card", grid);
    if(!reduceMotion){
      cards.forEach(function(el){
        var r = el.getBoundingClientRect();
        el.style.setProperty("--dx", (cx - (r.left + r.width / 2)).toFixed(0) + "px");
        el.style.setProperty("--dy", (cy - (r.top + r.height / 2)).toFixed(0) + "px");
      });
      void grid.offsetWidth;
    }
    grid.classList.add("deal");
    ripSay(rip.cards.length + " cards on the table, face down. Flip them one at a time with Enter or Space.");
    ripLater(function(){ var f = cards[0]; if(f) try { f.focus({preventScroll:true}); } catch(e){} }, 120);
    $$(".rip-packwrap", ripApp).forEach(function(pw){ pw.classList.add("done"); });
  }
  function ripFlip(i, quiet){
    var c = rip.cards[i], el = $('.rip-card[data-rip-flip="' + i + '"]', ripApp);
    if(!c || !el || el.classList.contains("is-flipped")) return false;
    var P = PACKS[rip.game], it = c.item;
    el.classList.add("is-flipped");
    if(c.rare) el.classList.add("is-rare");
    if(c.hit) el.classList.add("is-hit");
    el.setAttribute("aria-pressed", "true");
    el.setAttribute("aria-label", it.name + ", " + (P.labels[c.tier] || c.tier) + ", " + money(it.price) + ". Open details.");
    el.dataset.ripView = i; el.removeAttribute("data-rip-flip");
    rip.flipped++;
    var prog = $("#ripProgress"); if(prog) prog.textContent = rip.flipped + " of " + rip.cards.length + " flipped";
    if(!quiet) ripSay((c.rare ? "Hit! " : "") + "Card " + (i + 1) + " of " + rip.cards.length + ": " + it.name + ", " + (P.labels[c.tier] || c.tier) + ", " + money(it.price));
    if(c.rare && !reduceMotion){
      var r = el.getBoundingClientRect(), big = c.hit;
      ripLater(function(){
        TL.confetti(r.left + r.width / 2, r.top + r.height / 2, {count: big ? 140 : 50, spread: big ? 90 : 60});
        if(big){ var st = $("#ripStage"); if(st){ st.classList.remove("shake"); void st.offsetWidth; st.classList.add("shake"); } }
      }, 320);
    }
    if(rip.flipped >= rip.cards.length) ripLater(ripShowResults, c.rare ? 1100 : 700);
    return true;
  }
  function ripNextIndex(){ for(var i = 0; i < rip.cards.length; i++){ if($('.rip-card[data-rip-flip="' + i + '"]', ripApp)) return i; } return -1; }
  function ripFlipAll(){
    var idx = [], i;
    for(i = 0; i < rip.cards.length; i++) if($('.rip-card[data-rip-flip="' + i + '"]', ripApp)) idx.push(i);
    idx.forEach(function(n, k){ ripLater(function(){ ripFlip(n, k < idx.length - 1); }, k * 140); });
  }
  function ripShowResults(){
    if(rip.stage === "results") return;
    rip.stage = "results"; ripApp.dataset.stage = "results";
    var P = PACKS[rip.game], price = ripPackPrice(rip.game), total = 0, best = null;
    rip.cards.forEach(function(c){ total += Number(c.item.price) || 0; if(!best || c.item.price > best.item.price) best = c; });
    var s = ripStats();
    s.packs++; s.value = Math.round((s.value + total) * 100) / 100; s.spent = Math.round((s.spent + price) * 100) / 100;
    if(best && (!s.best || best.item.price > s.best.price)) s.best = {id: best.item.id, name: best.item.name, price: best.item.price, img: ripImg(best.item)};
    TL.store.set("ripStats", s);
    var mult = price ? total / price : 0;
    var bi = rip.cards.indexOf(best);
    var res = $("#ripResults"); if(!res) return;
    res.innerHTML = '<div class="rip-sum panel' + (mult >= 1 ? " up" : "") + '">' +
      '<p class="eyebrow">Pack opened</p>' +
      '<h2 id="ripResultH" tabindex="-1">You pulled <b class="rip-total">' + money(total) + '</b> from a ' + money(price) + ' pack</h2>' +
      '<p class="rip-note">' + (mult >= 1 ? "That's " + mult.toFixed(1) + "x the pack price." : "Under the pack price this time — that's why we sell singles.") + ' Every card is in the case right now at these prices.</p>' +
      (best ? '<div class="rip-bestpull"><div class="rip-best-art">' + (ripImg(best.item) ? '<img src="' + esc(ripImg(best.item)) + '" alt="' + esc(best.item.name) + '">' : cardArt(best.item)) + '</div>' +
        '<div class="rip-best-meta"><span class="rip-label">Best pull</span><h3>' + esc(best.item.name) + '</h3>' +
        '<p class="rip-note">' + esc(P.labels[best.tier] || best.tier) + ' &middot; ' + esc(ripSetName(best.item)) + (best.item.cond ? ' &middot; ' + esc(best.item.cond) : "") + '</p>' +
        '<b class="rip-price">' + money(best.item.price) + '</b>' +
        '<div class="rip-btns"><button class="btn" type="button" data-rip-add="' + bi + '">Add to cart</button><button class="btn btn-ghost" type="button" data-rip-view="' + bi + '">See it</button></div></div></div>' : "") +
      '<div class="rip-btns rip-again"><button class="btn" type="button" data-rip-again>Rip another</button><button class="btn btn-ghost" type="button" data-rip-share>Share</button>' +
      '<button class="btn btn-ghost" type="button" data-go="shop" data-params="type=sealed&game=' + esc(rip.game) + '">Buy real ' + esc(P.name) + ' packs</button></div>' +
    '</div>' +
    '<ul class="rip-list" aria-label="Every card in this pack">' + rip.cards.map(function(c, i){
      var it = c.item, src = ripImg(it);
      return '<li class="rip-row' + (c.rare ? " rare" : "") + (c === best ? " best" : "") + '">' +
        '<button class="rip-row-view" type="button" data-rip-view="' + i + '" aria-label="' + esc(it.name) + ', open details">' + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" width="44" height="44">' : '<span class="rip-best-ph" aria-hidden="true"></span>') +
          '<span class="rip-row-name"><b>' + esc(it.name) + '</b><span>' + esc(P.labels[c.tier] || c.tier) + (c.rh ? " · reverse holo" : "") + (it.cond ? " · " + esc(it.cond) : "") + '</span></span></button>' +
        '<span class="rip-row-price">' + money(it.price) + '</span>' +
        '<button class="add rip-row-add" type="button" data-rip-add="' + i + '"' + (it.stock > 0 ? "" : " disabled") + '>' + (it.stock > 0 ? "Add to cart" : "Sold out") + '</button></li>';
    }).join("") + '</ul>';
    res.hidden = false;
    ripSay("Pack opened. You pulled " + money(total) + " from a " + money(price) + " pack." + (best ? " Best pull: " + best.item.name + ", " + money(best.item.price) + "." : ""));
    ripLater(function(){
      try { res.scrollIntoView({behavior: reduceMotion ? "auto" : "smooth", block: "start"}); } catch(e){}
      var h = $("#ripResultH"); if(h) try { h.focus({preventScroll:true}); } catch(e){}
    }, 60);
  }
  function ripShare(){
    var best = null, total = 0;
    rip.cards.forEach(function(c){ total += Number(c.item.price) || 0; if(!best || c.item.price > best.item.price) best = c; });
    var url = location.origin + location.pathname + "#/rip";
    var text = best ? "I pulled a " + money(best.item.price) + " " + best.item.name + " on Top Loaded's pack rip" : "I ripped a pack on Top Loaded's pack rip";
    text += " — " + money(total) + " from a " + money(ripPackPrice(rip.game)) + " pack.";
    if(navigator.share){
      navigator.share({title: "Top Loaded pack rip", text: text, url: url}).catch(function(){});
      return;
    }
    var full = text + " " + url;
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(full).then(function(){ toast("Copied to clipboard — paste it anywhere"); }, function(){ toast(full); });
    } else toast(full);
  }
  function ripAddToCart(i, btn){
    var c = rip.cards[i]; if(!c) return;
    var it = c.item;
    if(TL.cart && typeof TL.cart.add === "function"){
      try { TL.cart.add(it, 1, btn); return; } catch(e){ if(window.console) console.error("[rip] cart", e); }
    }
    if(it.url){ window.open(it.url, "_blank", "noopener"); toast("Opened " + it.name + " on TCGplayer"); return; }
    toast("Cart is warming up — try again in a moment");
  }
  function ripView(i){
    var c = rip.cards[i]; if(!c) return;
    /* the core default is an empty no-op until the shop package defines the modal */
    if(String(TL.openQuickView).replace(/\s/g, "") === "function(){}"){
      if(c.item.url){ window.open(c.item.url, "_blank", "noopener"); return; }
      toast(c.item.name + " · " + money(c.item.price) + " · " + (c.item.cond || "sealed"));
      return;
    }
    try { TL.openQuickView(c.item); } catch(e){ if(window.console) console.error("[rip] quickview", e); }
  }

  /* ---- events ---- */
  ripApp.addEventListener("click", function(e){
    var t;
    if((t = e.target.closest("[data-rip-game]"))){
      rip.game = t.dataset.ripGame;
      var sets = ripSetsFor(rip.game); rip.set = (sets && sets[0]) ? sets[0].name : "";
      TL.store.set("rip", {game: rip.game, set: rip.set});
      ripRenderSetup(); var b = $('[data-rip-game="' + rip.game + '"]', ripApp); if(b) b.focus();
      return;
    }
    if(e.target.closest("[data-rip-open]")){ ripStartPack(); return; }
    if(e.target.closest("[data-rip-retry]")){ ripItemsP = null; ripRenderSetup(); ripLoadItems().then(function(){ if(rip.stage === "setup") ripRenderSetup(); }); return; }
    if(e.target.closest("[data-rip-back]")){ ripClearTimers(); ripRenderSetup(); return; }
    if(e.target.closest("[data-rip-tear]")){ ripTear(); return; }
    if((t = e.target.closest("[data-rip-flip]"))){ ripFlip(Number(t.dataset.ripFlip)); return; }
    if(e.target.closest("[data-rip-next]")){ var n = ripNextIndex(); if(n > -1){ ripFlip(n); var el = $('.rip-card[data-rip-view="' + n + '"]', ripApp); if(el) el.focus(); } return; }
    if(e.target.closest("[data-rip-all]")){ ripFlipAll(); return; }
    if((t = e.target.closest("[data-rip-add]"))){ ripAddToCart(Number(t.dataset.ripAdd), t); return; }
    if((t = e.target.closest("[data-rip-view]"))){ ripView(Number(t.dataset.ripView)); return; }
    if(e.target.closest("[data-rip-again]")){ ripStartPack(); return; }
    if(e.target.closest("[data-rip-share]")){ ripShare(); return; }
    if((t = e.target.closest("#ripPack")) && rip.stage === "pack"){
      /* keyboard activation (Enter/Space) arrives as a click with detail 0 */
      if(e.detail === 0 || reduceMotion || rip.drag === "done"){ ripTear(); return; }
      if(rip.drag === "moved"){ rip.drag = null; return; }
      t.classList.remove("nudge"); void t.offsetWidth; t.classList.add("nudge");
      var hint = $("#ripHint"); if(hint) hint.textContent = "Swipe across the tear strip — or press Open pack.";
    }
  });
  ripApp.addEventListener("change", function(e){
    if(e.target && e.target.id === "ripSet"){ rip.set = e.target.value; TL.store.set("rip", {game: rip.game, set: rip.set}); }
  });
  ripApp.addEventListener("keydown", function(e){
    var pack = e.target.closest && e.target.closest("#ripPack");
    if(pack && (e.key === " " || e.key === "Spacebar") && rip.stage === "pack"){ e.preventDefault(); ripTear(); }
  });
  /* drag / swipe across the strip */
  ripApp.addEventListener("pointerdown", function(e){
    var strip = e.target.closest(".rip-strip"); if(!strip || rip.stage !== "pack" || reduceMotion) return;
    var pack = strip.closest("#ripPack"); if(!pack) return;
    if(e.button !== undefined && e.button !== 0) return;
    rip.drag = {x: e.clientX, w: strip.getBoundingClientRect().width || 200, p: 0, id: e.pointerId};
    pack.classList.add("tearing");
    try { strip.setPointerCapture(e.pointerId); } catch(err){}
    e.preventDefault();
  });
  ripApp.addEventListener("pointermove", function(e){
    if(!rip.drag || typeof rip.drag !== "object" || rip.drag.id !== e.pointerId) return;
    var p = Math.abs(e.clientX - rip.drag.x) / (rip.drag.w * .72);
    rip.drag.p = p; ripTearProgress(p);
    if(p >= 1) ripDragEnd(e, true);
  });
  function ripDragEnd(e, force){
    if(!rip.drag || typeof rip.drag !== "object") return;
    var d = rip.drag, pack = $("#ripPack");
    if(pack) pack.classList.remove("tearing");
    try { e.target.releasePointerCapture(d.id); } catch(err){}
    if(force || d.p >= .6){ rip.drag = "done"; ripTearProgress(1); ripTear(); rip.drag = null; }
    else { rip.drag = d.p > .05 ? "moved" : null; ripTearProgress(0); }
  }
  ripApp.addEventListener("pointerup", function(e){ ripDragEnd(e, false); });
  ripApp.addEventListener("pointercancel", function(e){ ripDragEnd(e, false); });
  ripApp.addEventListener("lostpointercapture", function(e){ if(rip.drag && typeof rip.drag === "object") ripDragEnd(e, false); });

  /* ---- lifecycle ---- */
  var ripBooted = false;
  function ripEnter(){
    if(!ripBooted || rip.stage === "setup"){
      ripBooted = true; ripRenderSetup();
      ripLoadItems().then(function(){ if(rip.stage === "setup" && TL.current === "rip") ripRenderSetup(); });
    }
  }
  TL.on("view:change", function(d){ if(d && d.name === "rip" && !d.paramsOnly) ripEnter(); });
  TL.on("view:leave", function(d){ if(d && d.name === "rip"){ ripClearTimers(); rip.drag = null; } });
  TL.on("inventory:summary", function(){ if(rip.stage === "setup" && TL.current === "rip") ripRenderSetup(); });
  TL.on("inventory:loaded", function(d){
    if(d && d.items && d.items.length && !(ripItems && !ripDemo)){ ripItems = d.items; ripDemo = !d.items.some(function(it){ return it.tcg; }); ripSetCache = {}; ripItemsP = Promise.resolve(ripItems); }
    if(rip.stage === "setup" && TL.current === "rip") ripRenderSetup();
  });
  TL.on("init", function(){ ripRenderSetup(); });
