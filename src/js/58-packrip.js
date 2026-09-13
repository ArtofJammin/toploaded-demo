  /* ---------- pack rip: virtual booster mini-game ----------
     View #view-rip (route "rip"), app root #ripApp, announcer #ripLive.
     Cards come from the selected TCGCSV checklist through TL.cards, including
     unstocked cards. Exact product IDs drive "In Stock Now" badges. Catalog
     outages show a retry state, never silently switch to the in-stock pool.
     The inventory-only draw helper remains for compatibility/tests. Pulls are
     rarity-weighted simulation rules (not manufacturer odds); hit slot last.

       TL.rip.draw(game, set, seed?)   → [entry]  pure, seedable, our in-stock singles
       TL.rip.drawFrom(cards, game, seed?) → [entry]  pure, any TL.cards list
       TL.rip.pull(game, set)          → Promise<{cards, mode, setName}>  the pool for a set
       TL.rip.start(game, set)         → jump to the pack screen
       TL.rip.stats()                  → {packs, value, spent, best} (simulation counters only)

     entry: {card, item, tier, rank, rare, rh, foil, hit} — `item` is the inventory
     item when we stock the card, otherwise null.
     card:  {key, name, set, game, img, price, priceIsMarket, rarity, url, num, cond,
             inStock, item, itemSet, source} — `price` is OUR price when inStock,
     otherwise the catalogue's MARKET REFERENCE (priceIsMarket), never presented as ours.

     Consumes (all guarded, all optional): TL.cards.*, TL.inventory.load()/items/summary,
     TL.cart.add(item, qty, fromEl), TL.openQuickView(item), TL.confetti(x, y, opts).
     Stores: TL.store "rip" {game, set, setName} last choice, "ripStats" session stats.
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
    var codes={c:"Common",u:"Uncommon",uc:"Uncommon",r:"Rare",rr:"Double Rare",sr:"Super Rare",sec:"Secret Rare",l:"Leader",m:"Mythic Rare",ir:"Illustration Rare",sir:"Special Illustration Rare",hr:"Hyper Rare"};
    if(codes[r])r=codes[r].toLowerCase();
    if(game === "pk"){
      if(/^common/.test(r)) return "C";
      if(/^uncommon/.test(r)) return "U";
      if(/special illustration|special art|secret/.test(r)) return "SIR";
      if(/hyper|rainbow|gold/.test(r)) return "HR";
      if(/illustration|art rare|shiny holo|trainer gallery/.test(r)) return "IR";
      if(/double|ultra|ace|mega|amazing|radiant|prism|super|shiny|full art|\bv\b|vmax|vstar|break|legend|star/.test(r)) return "RR";
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
    /* Magic — Scryfall reports common | uncommon | rare | mythic | special | bonus */
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
    if(!it) return false;
    if(it.cond && /RH|reverse/i.test(it.cond)) return true;
    var ls = it.listings; if(ls && ls.length) for(var i = 0; i < ls.length; i++) if(/reverse/i.test(ls[i].printing || "")) return true;
    return false;
  }
  /* 400px CDN face for any TCGplayer product (the shop grid uses 200px thumbs) */
  function ripImg(it){
    if(!it) return "";
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

  /* ---- cards: one shape for catalogue pulls and for our own case ---- */
  function ripCardFromItem(it){
    return {key: "inv:" + it.id, name: it.name, set: ripSetName(it), game: it.game, img: ripImg(it),
      price: Number(it.price) || 0, priceIsMarket: false, rarity: ripRarity(it), url: it.url || "",
      num: it.num || null, cond: it.cond || "", inStock: true, item: it, itemSet: ripSetName(it), source: "inventory"};
  }
  /* A TL.cards card; keep the exact product-ID stock match and reject sealed items. */
  function ripCardFromCatalog(c){
    if(!c || !c.name) return null;
    var item = c.item || null, market = !!c.priceIsMarket, price = Number(c.price) || 0;
    if(item && item.type && item.type !== "single"){ item = null; market = true; price = 0; }
    return {key: (c.source || "cat") + ":" + (c.id || c.num || "") + ":" + c.name + ":" + (c.set || ""),
      name: c.name, set: c.set || "", game: c.game, img: c.img || ripImg(item),
      price: item ? (Number(item.price) || 0) : price, priceIsMarket: item ? false : (market || !price),
      rarity: c.rarity || (item ? ripRarity(item) : ""), url: c.url || (item ? item.url : "") || "",
      num: c.num || null, cond: item ? (item.cond || "") : "",
      inStock: !!item, item: item, itemSet: item ? ripSetName(item) : "", source: c.source || "catalog"};
  }
  function ripCardsFromItems(items, game, setName){
    var out = [], list = items || [];
    for(var i = 0; i < list.length; i++){
      var it = list[i];
      if(!it || it.game !== game || it.type !== "single" || !(it.stock > 0) || it.live) continue;
      if(setName && setName !== "*" && ripSetName(it) !== setName) continue;
      out.push(ripCardFromItem(it));
    }
    return out;
  }
  function ripCardTier(game, card){ return ripTier(game, card.rarity || (card.item ? ripRarity(card.item) : "")); }
  /* bucket a card list by tier */
  function ripCardPool(cards, game){
    var pool = {all:[]}, tiers = PACKS[game].tiers, i;
    for(i = 0; i < tiers.length; i++) pool[tiers[i]] = [];
    for(i = 0; i < (cards || []).length; i++){
      var c = cards[i];
      if(!c || !c.name) continue;
      if(c.game && c.game !== game) continue;
      var t = ripCardTier(game, c);
      pool[t].push(c); pool.all.push(c);
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
      var cands = lists.filter(function(c){ return !used[c.key]; });
      if(slot.rh){ var rh = cands.filter(function(c){ return ripIsReverse(c.item); }); if(rh.length) cands = rh; }
      if(!cands.length) continue;
      var c = cands[Math.floor(rng() * cands.length)];
      return {card: c, tier: tiers[order[j]]};
    }
    return null; /* pool exhausted: the pack is short rather than repeating a card */
  }
  /* pure: the rarity-slot plan applied to any card list (whole set or just our case) */
  function ripDrawFrom(cards, game, seed){
    var P = PACKS[game]; if(!P) return [];
    var rng = ripRng(seed), pool = ripCardPool(cards, game), slots = ripSlots(game, rng), used = {}, out = [];
    if(!pool.all.length) return out;
    for(var i = 0; i < slots.length; i++){
      var got = ripPick(pool, game, slots[i], used, rng);
      if(!got) continue;
      used[got.card.key] = true;
      var rank = P.tiers.indexOf(got.tier);
      out.push({card: got.card, item: got.card.item || null, tier: got.tier, rank: rank,
        rare: rank >= P.rareFrom, rh: !!slots[i].rh, foil: !!slots[i].foil, hit: !!slots[i].hit});
    }
    return out;
  }
  function ripDraw(items, game, set, seed){ return ripDrawFrom(ripCardsFromItems(items, game, set || "*"), game, seed); }

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
  /* set list built from our own case — the fallback when no public checklist answers */
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
      var list = Object.keys(counts).map(function(k){ return {name:k, code:k, count:counts[k], own:true}; })
        .filter(function(x){ return ripDemo || x.count >= P.size; })
        .sort(function(a, b){ return b.count - a.count; });
      if(ripDemo) list = [{name:"*", code:"*", count: list.reduce(function(n, x){ return n + x.count; }, 0), own:true}];
      return (ripSetCache[game] = list);
    }
    var sum = TL.inventory && TL.inventory.summary;
    if(sum && sum.sets && sum.sets[game]) return sum.sets[game].filter(function(x){ return x.count >= P.size; }).map(function(x){ return {name:x.name, code:x.name, count:x.count, approx:true, own:true}; });
    return null;
  }

  /* ---- set lists: the whole published set list through TL.cards ---- */
  function ripCatalogGame(game){
    try { return !!(TL.cards && TL.cards.catalogued && TL.cards.catalogued(game) && TL.cards.fromSet); }
    catch(e){ return false; }
  }
  var ripSetList = {}, ripSetPend = {};
  function ripSetToken(s){ return String((s && (s.code || s.name)) || ""); }
  function ripFindSet(sets, val){
    if(!sets || !val) return null;
    for(var i = 0; i < sets.length; i++){ if(ripSetToken(sets[i]) === val || sets[i].name === val) return sets[i]; }
    return null;
  }
  function ripSetLabel(game, token){
    var hit = ripFindSet(ripSetList[game], token);
    if(hit) return hit.name === "*" ? "Sample case" : hit.name;
    if(token && token !== "*") return rip.setName || token;
    return "Sample case";
  }
  function ripRequestSets(game){
    if(ripSetList[game] || ripSetPend[game]) return;
    ripSetPend[game] = true;
    var p = null;
    try { if(TL.cards && TL.cards.sets) p = TL.cards.sets(game); } catch(e){ p = null; }
    Promise.resolve(p || Promise.reject(new Error("no catalogue")))
      .then(function(list){
        list = (list || []).filter(function(s){ return s && s.name && (!s.count || s.count >= PACKS[game].size); });
        return list.length ? list : Promise.reject(new Error("empty"));
      })
      .catch(function(e){ if(ripCatalogGame(game))throw e;return ripLoadItems().then(function(){ return ripSetsFor(game) || []; }); })
      .then(function(list){ ripSetsReady(game, list); }, function(){ ripSetsReady(game, []); });
  }
  function ripSetsReady(game, list){
    ripSetPend[game] = false;
    ripSetList[game] = list || [];
    if(rip.stage === "setup" && TL.current === "rip" && rip.game === game) ripRenderSetup();
  }

  /* ---- pools: every card in the set, our case as the safety net ---- */
  var ripPoolCache = {}, ripPoolPend = {};
  function ripPoolKey(game, token){ return game + "|" + (token || "*"); }
  function ripCasePoolFrom(items, game, token, mode){
    var name = ripSetLabel(game, token), cards = ripCardsFromItems(items, game, name), wide = false;
    if(!cards.length){ cards = ripCardsFromItems(items, game, "*"); wide = !!cards.length; }
    return {cards: cards, mode: mode, set: token, setName: name, game: game, wide: wide};
  }
  /* pool we can build without waiting on the network (repeat rips, games with no catalogue) */
  function ripSyncPool(game, token){
    var key = ripPoolKey(game, token);
    if(ripPoolCache[key]) return ripPoolCache[key];
    if(ripCatalogGame(game) || !ripItems) return null;
    var st = ripCasePoolFrom(ripItems, game, token, "case");
    return st.cards.length ? (ripPoolCache[key] = st) : null;
  }
  function ripEnsurePool(game, token){
    var key = ripPoolKey(game, token), have = ripSyncPool(game, token);
    if(have) return Promise.resolve(have);
    if(ripPoolPend[key]) return ripPoolPend[key];
    var p = ripBuildPool(game, token).then(function(st){
      delete ripPoolPend[key];
      if(st && st.cards.length) ripPoolCache[key] = st;
      return st;
    }, function(e){ delete ripPoolPend[key]; throw e; });
    ripPoolPend[key] = p;
    return p;
  }
  function ripBuildPool(game, token){
    if(!ripCatalogGame(game) || !token || token === "*"){
      return ripLoadItems().then(function(items){ return ripCasePoolFrom(items, game, token, "case"); });
    }
    return Promise.resolve()
      .then(function(){ return TL.cards.fromSet(game, token); })
      .then(function(list){
        var cards = [], i, c;
        for(i = 0; i < (list || []).length; i++){ c = ripCardFromCatalog(list[i]); if(c) cards.push(c); }
        if(cards.length < PACKS[game].size) throw new Error("catalogue too thin");
        return {cards: cards, mode: "catalog", set: token, setName: ripSetLabel(game, token), game: game, wide: false};
      });
  }

  /* ---- state + rendering ---- */
  var ripApp = $("#ripApp"), ripLiveEl = $("#ripLive");
  var rip = {stage:"setup", game:"pk", set:"", setName:"", cards:[], flipped:0, timers:[], drag:null, loading:false, pool:null};
  var ripPrefs = TL.store.get("rip", null) || {};
  if(PACKS[ripPrefs.game]) rip.game = ripPrefs.game;
  if(ripPrefs.set){ rip.set = String(ripPrefs.set); rip.setName = String(ripPrefs.setName || ripPrefs.set); }

  function ripLater(fn, ms){ var t = setTimeout(fn, reduceMotion ? 0 : ms); rip.timers.push(t); return t; }
  function ripClearTimers(){ rip.timers.forEach(clearTimeout); rip.timers = []; }
  function ripSay(msg){ if(ripLiveEl){ ripLiveEl.textContent = ""; ripLiveEl.textContent = msg; } }
  function ripSavePrefs(){ TL.store.set("rip", {game: rip.game, set: rip.set, setName: rip.setName}); }
  function ripPackPrice(game){
    var cfg = TL.config && TL.config.rip && TL.config.rip.prices;
    return (cfg && Number(cfg[game]) > 0) ? Number(cfg[game]) : PACKS[game].price;
  }
  function ripStats(){ return TL.store.get("ripStats", null) || {packs:0, value:0, spent:0, best:null}; }
  TL.rip = {
    draw: function(game, set, seed){ return ripDraw(ripItems || ITEMS, game || rip.game, set || rip.set || "*", seed); },
    drawFrom: ripDrawFrom,
    pull: function(game, set){ return ripEnsurePool(game || rip.game, set || rip.set); },
    start: function(game, set){ if(PACKS[game]) rip.game = game; if(set){ rip.set = set; rip.setName = ""; } TL.go("rip"); ripStartPack(); },
    stats: ripStats,
    packs: PACKS
  };

  /* ---- honest price wording: ours vs a catalogue market reference ---- */
  function ripHasPrice(c){ return Number(c && c.price) > 0; }
  function ripPriceText(c){ return ripHasPrice(c) ? money(c.price) : "No catalog price"; }
  function ripPriceKind(c){ return c.priceIsMarket ? "market reference" : "our price"; }
  function ripPriceHtml(c){
    if(!ripHasPrice(c)) return '<span class="rip-price-none">No catalog price</span>';
    return money(c.price) + '<small>' + (c.priceIsMarket ? "market ref." : "our price") + '</small>';
  }
  function ripPriceSay(c){
    return ripHasPrice(c) ? money(c.price) + " " + ripPriceKind(c) : "no catalog price";
  }
  function ripStockBadge(c, cls){
    if(!c.inStock) return "";
    return '<span class="rip-stock' + (cls ? " " + cls : "") + '">In Stock Now</span>';
  }
  function ripInStockCount(cards){
    var n = 0; for(var i = 0; i < cards.length; i++) if(cards[i].card.inStock) n++;
    return n;
  }
  /* where this pack's cards came from — said plainly, every time */
  function ripSourceNote(){
    var P = PACKS[rip.game], st = rip.pool;
    if(st && st.mode === "catalog")
      return "Cards are drawn from the whole " + esc(st.setName) + " set list, not just our shelf. Anything we have in the case is badged In Stock Now.";
    if(st && st.mode === "offline")
      return "The public card catalog did not answer, so this simulation used the " + esc(P.name) + " singles in our case" + (st.wide ? " (any set)" : "") + " instead of the full set list.";
    if(ripDemo)
      return "Live inventory is unavailable, so this simulation uses sample cards and sample prices.";
    return "No public checklist exists for " + esc(P.name) + ", so this simulation uses the singles in our case.";
  }
  function ripSetupNote(){
    var P = PACKS[rip.game];
    if(ripCatalogGame(rip.game))
      return "Pulls come from the whole published set list, not only what is on our shelf. Cards we have in the case are badged In Stock Now and are the only ones you can add to a cart.";
    return "There is no free public checklist for " + esc(P.name) + ", so these pulls come from the " + esc(P.name) + " singles in our case.";
  }

  function ripOddsTable(game){
    var P = PACKS[game], keys = Object.keys(P.hit), total = 0, i;
    for(i = 0; i < keys.length; i++) total += P.hit[keys[i]];
    var rows = keys.map(function(k){
      var pct = P.hit[k] / total * 100;
      return '<tr><th scope="row">' + esc(P.labels[k]) + '</th><td>' + (pct >= 10 ? Math.round(pct) : pct.toFixed(1)) + '%</td></tr>';
    }).join("");
    return '<table class="rip-odds"><caption class="rip-sr">Simulated odds for the rare slot in a ' + esc(P.name) + ' virtual pack</caption>' +
      '<thead><tr><th scope="col">Rare slot</th><th scope="col">Chance</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="rip-note">' + esc(P.note) + '</p><p class="rip-simulation-copy">For this simulator only. These are not real booster-pack odds.</p>';
  }
  function ripStatsCard(){
    var s = ripStats();
    var best = s.best ? '<div class="rip-best-mini">' +
        (s.best.img ? '<img src="' + esc(s.best.img) + '" alt="" loading="lazy" width="48" height="48">' : '<span class="rip-best-ph" aria-hidden="true"></span>') +
        '<div><b>' + esc(s.best.name) + '</b><span>Simulation highlight &middot; ' +
          (Number(s.best.price) > 0 ? esc((s.best.market ? "market reference " : "our price ") + money(s.best.price)) : "no catalog price") + '</span>' +
          (s.best.inStock ? ' <span class="rip-stock sm">In Stock Now</span>' : "") + '</div></div>'
      : '<p class="rip-note">No simulations yet &mdash; try one for free.</p>';
    return '<aside class="rip-stats panel" aria-labelledby="ripStatsH"><h3 id="ripStatsH">Simulator stats</h3>' +
      '<dl><div><dt>Simulations</dt><dd>' + fmtInt(s.packs) + '</dd></div>' +
      '<div><dt>Cost to play</dt><dd>Free</dd></div></dl>' + best +
      '<button class="btn btn-ghost rip-cta" type="button" data-go="shop" data-params="type=sealed&game=' + esc(rip.game) + '">Shop physical packs</button>' +
      '<p class="rip-simulation-copy">Physical products are sold separately.</p>' +
      '<p class="rip-note">Simulator history stays in this browser. It is not a card collection or credit balance.</p></aside>';
  }
  function ripRenderSetup(){
    rip.stage = "setup"; ripApp.dataset.stage = "setup";
    var P = PACKS[rip.game], sets = ripSetList[rip.game];
    if(!sets) ripRequestSets(rip.game);
    var setOpts, canRip = true;
    if(!sets){ setOpts = '<option value="">Loading sets…</option>'; canRip = false; }
    else if(!sets.length){ setOpts = '<option value="">No sets available right now</option>'; canRip = false; }
    else {
      var chosen = ripFindSet(sets, rip.set) || sets[0];
      rip.set = ripSetToken(chosen); rip.setName = chosen.name;
      setOpts = sets.map(function(x){
        var tok = ripSetToken(x);
        return '<option value="' + esc(tok) + '"' + (tok === rip.set ? " selected" : "") + '>' +
          (x.name === "*" ? "Sample cards (demo case)" : esc(x.name)) + " · " + fmtInt(x.count) +
          (x.approx ? " products" : x.own ? " singles in the case" : " cards") + '</option>';
      }).join("");
    }
    ripApp.innerHTML = '<div class="rip-setup">' +
      '<div class="rip-config panel">' +
        '<div class="rip-field"><span class="rip-label" id="ripGameL">Game</span>' +
          '<div class="chip-row" role="group" aria-labelledby="ripGameL">' + RIP_GAMES.map(function(g){
            return '<button class="chip" type="button" data-rip-game="' + g + '" aria-pressed="' + (g === rip.game) + '">' + TL.gameIcon(g) + esc(PACKS[g].name) + '</button>';
          }).join("") + '</div></div>' +
        '<div class="rip-field"><label class="rip-label" for="ripSet">Set</label><select id="ripSet"' + (canRip ? "" : " disabled") + '>' + setOpts + '</select>' +
          '<p class="rip-note rip-source-note">' + ripSetupNote() + '</p></div>' +
        '<div class="rip-price"><span class="rip-label">Cost to play</span><b>Free</b><span class="rip-note">' + esc(P.size) + ' simulated card reveals &middot; ' + esc(P.name) + '</span></div>' +
        '<button class="btn rip-go" type="button" data-rip-open aria-describedby="ripDisclaimerH"' + (canRip && !rip.loading ? "" : " disabled") + '>' +
          (rip.loading ? "Building the set list…" : "Start free simulation") + '</button>' +
        ((ripDemo || sets && !sets.length) ? '<p class="rip-note">A data connection is unavailable. <button class="linklike" type="button" data-rip-retry>Retry loading</button></p>' : "") +
      '</div>' +
      '<div class="rip-odds-wrap panel"><h3>Simulated odds</h3>' + ripOddsTable(rip.game) + '</div>' +
      ripStatsCard() + '</div>';
  }
  function ripRenderPack(){
    rip.stage = "pack"; ripApp.dataset.stage = "pack";
    var P = PACKS[rip.game], setLabel = (rip.pool && rip.pool.setName) || ripSetLabel(rip.game, rip.set);
    if(setLabel === "*") setLabel = "Sample case";
    ripApp.innerHTML = '<div class="rip-stage" id="ripStage" data-game="' + esc(rip.game) + '">' +
      '<div class="rip-packwrap">' +
        '<p class="rip-mode">Free simulation &middot; no real pack or card prizes</p>' +
        '<div class="rip-pack" id="ripPack" role="button" tabindex="0" aria-label="Simulated ' + esc(P.name) + ' pack, ' + esc(setLabel) + '. No real pack is opened or cards awarded. Press Enter to play, or drag across the tear strip.">' +
          '<span class="rip-foil" aria-hidden="true"></span><span class="rip-crimp top" aria-hidden="true"></span>' +
          '<div class="rip-strip" aria-hidden="true"><span>Tear here &#9656;&#9656;&#9656;</span></div>' +
          '<div class="rip-packart" aria-hidden="true"><span class="rip-packgame">' + esc(P.name) + '</span><b>TL</b><span class="rip-packset">' + esc(setLabel) + '</span><span class="rip-packn">SIMULATION ONLY</span></div>' +
          '<span class="rip-crimp bottom" aria-hidden="true"></span>' +
        '</div>' +
        '<p class="rip-note rip-source-note">' + ripSourceNote() + '</p>' +
        '<p class="rip-hint" id="ripHint">' + (reduceMotion ? "Press Open simulated pack to reveal the cards." : "Swipe across the strip or press Enter to play the simulated opening.") + '</p>' +
        '<div class="rip-actions"><button class="btn" type="button" data-rip-tear>Open simulated pack</button><button class="btn btn-ghost" type="button" data-rip-back>Change set</button></div>' +
      '</div>' +
      '<div class="rip-cards" id="ripCards" hidden></div>' +
      '<div class="rip-results" id="ripResults" hidden></div>' +
    '</div>';
    ripSay("Free simulation ready: " + P.name + ", " + setLabel + ". No real pack is opened and no cards are awarded. Press Enter or Open simulated pack to play.");
    var pack = $("#ripPack"); if(pack) try { pack.focus({preventScroll:true}); } catch(e){}
  }
  function ripLaunch(st){
    rip.pool = st || null;
    rip.cards = ripDrawFrom(st ? st.cards : [], rip.game);
    rip.flipped = 0;
    if(!rip.cards.length){
      toast(ripCatalogGame(rip.game) ? "No cards came back for that set — try another" : "That set has no singles in stock right now");
      ripRenderSetup(); return;
    }
    /* warm the card faces while the pack is on screen */
    rip.cards.forEach(function(c){ var src = c.card.img; if(src){ var im = new Image(); im.decoding = "async"; im.src = src; } });
    ripRenderPack();
  }
  function ripStartPack(){
    if(rip.loading) return;
    ripClearTimers();
    ripSavePrefs();
    var have = ripSyncPool(rip.game, rip.set);
    if(have){ ripLaunch(have); return; }
    var game = rip.game, token = rip.set;
    rip.loading = true;
    if(rip.stage === "setup") ripRenderSetup();
    ripSay("Building the " + ripSetLabel(game, token) + " set list…");
    ripEnsurePool(game, token).then(function(st){
      rip.loading = false;
      if(rip.game !== game || rip.set !== token) return;      /* the visitor moved on */
      if(TL.current && TL.current !== "rip"){ ripRenderSetup(); return; }
      ripLaunch(st);
    }, function(){
      rip.loading = false;
      toast("Could not build that set right now — try another");
      ripRenderSetup();
    });
  }

  /* ---- tear ---- */
  function ripTearProgress(p){
    var pack = $("#ripPack"); if(pack) pack.style.setProperty("--tear", String(TL.clamp(p, 0, 1)));
  }
  function ripTear(){
    var pack = $("#ripPack"); if(!pack || rip.stage !== "pack") return;
    rip.stage = "tearing";
    pack.classList.add("torn"); pack.setAttribute("aria-disabled", "true"); pack.setAttribute("tabindex", "-1");
    var hint = $("#ripHint"); if(hint) hint.textContent = "Simulated pack opened! Flip the cards.";
    var acts = $(".rip-actions", ripApp); if(acts) acts.hidden = true;
    var rect = pack.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height * .4;
    if(!reduceMotion) TL.confetti(cx, cy, {count: 24, spread: 50});
    ripLater(function(){ ripDeal(cx, cy); }, 380);
  }
  function ripCardHtml(c, i){
    var card = c.card, P = PACKS[rip.game], src = card.img;
    var front = src ? '<img src="' + esc(src) + '" alt="" decoding="async">' : cardArt(card.item || card);
    return '<button class="rip-card' + (card.inStock ? " has-stock" : "") + '" type="button" data-rip-flip="' + i + '" style="--i:' + i + '" aria-label="Card ' + (i + 1) + ' of ' + rip.cards.length + ', face down. Flip it." aria-pressed="false">' +
      '<span class="rip-card-inner"><span class="rip-face back" aria-hidden="true"><b>TL</b></span>' +
      '<span class="rip-face front"' + (src ? "" : ' data-drawn') + '>' + front + '<span class="rip-sheen" aria-hidden="true"></span>' +
      ripStockBadge(card, "on-card") +
      '<span class="rip-tag' + (c.rare ? " rare" : "") + '">' + esc(c.rh ? "Reverse holo" : c.foil ? "Foil " + P.labels[c.tier] : P.labels[c.tier]) + '</span></span></span></button>';
  }
  function ripDeal(cx, cy){
    var wrap = $("#ripCards"); if(!wrap) return;
    rip.stage = "cards"; ripApp.dataset.stage = "cards";
    var stocked = ripInStockCount(rip.cards);
    wrap.innerHTML = '<p class="rip-mode">Simulation only &middot; these cards are not awarded to you</p>' +
      '<p class="rip-note rip-source-note">' + ripSourceNote() +
        (stocked ? " " + fmtInt(stocked) + " of these " + fmtInt(rip.cards.length) + " are in our case right now." : "") + '</p>' +
      '<div class="rip-cardbar"><span class="rip-progress" id="ripProgress">0 of ' + rip.cards.length + ' flipped</span>' +
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
    ripSay(rip.cards.length + " simulated card reveals, face down. No cards are awarded. Flip them one at a time with Enter or Space.");
    ripLater(function(){ var f = cards[0]; if(f) try { f.focus({preventScroll:true}); } catch(e){} }, 120);
    $$(".rip-packwrap", ripApp).forEach(function(pw){ pw.classList.add("done"); });
  }
  function ripFlip(i, quiet){
    var c = rip.cards[i], el = $('.rip-card[data-rip-flip="' + i + '"]', ripApp);
    if(!c || !el || el.classList.contains("is-flipped")) return false;
    var P = PACKS[rip.game], card = c.card;
    el.classList.add("is-flipped");
    if(c.rare) el.classList.add("is-rare");
    if(c.hit) el.classList.add("is-hit");
    el.setAttribute("aria-pressed", "true");
    el.setAttribute("aria-label", card.name + ", " + (P.labels[c.tier] || c.tier) + ", " + ripPriceSay(card) + ". " +
      (card.inStock ? "In stock now at the shop. Open product details." : "Not in our case right now. Open card details."));
    el.dataset.ripView = i; el.removeAttribute("data-rip-flip");
    rip.flipped++;
    var prog = $("#ripProgress"); if(prog) prog.textContent = rip.flipped + " of " + rip.cards.length + " flipped";
    if(!quiet) ripSay((c.rare ? "Simulated hit! " : "") + "Card " + (i + 1) + " of " + rip.cards.length + ": " + card.name + ", " +
      (P.labels[c.tier] || c.tier) + ", " + ripPriceSay(card) + (card.inStock ? ", in stock now" : ""));
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
    var P = PACKS[rip.game], price = ripPackPrice(rip.game), total = 0, best = null, ours = 0, refs = 0;
    rip.cards.forEach(function(c){
      var p = Number(c.card.price) || 0;
      total += p;
      if(p > 0){ if(c.card.priceIsMarket) refs++; else ours++; }
      if(!best || p > (Number(best.card.price) || 0)) best = c;
    });
    var stocked = ripInStockCount(rip.cards);
    var s = ripStats();
    s.packs++; s.value = Math.round((s.value + total) * 100) / 100; s.spent = Math.round((s.spent + price) * 100) / 100;
    if(best && (!s.best || (Number(best.card.price) || 0) > (Number(s.best.price) || 0)))
      s.best = {id: best.card.item ? best.card.item.id : "", name: best.card.name, price: Number(best.card.price) || 0,
        img: best.card.img, market: !!best.card.priceIsMarket, inStock: !!best.card.inStock};
    TL.store.set("ripStats", s);
    var bi = rip.cards.indexOf(best);
    var res = $("#ripResults"); if(!res) return;
    res.innerHTML = '<div class="rip-sum panel">' +
      '<p class="eyebrow">Free simulation complete</p>' +
      '<h2 id="ripResultH" tabindex="-1">Your simulated reveal</h2>' +
      '<p class="rip-simulation-copy"><strong>No real pack was opened. No cards or prizes were awarded.</strong> Nothing was purchased or charged, and no store credit was earned.</p>' +
      '<p class="rip-simulation-copy">Reference singles total: <b class="rip-total">' + money(total) + '</b>. This is catalog pricing, not winnings, profit, or a balance you can spend. Prices and availability may change.</p>' +
      '<p class="rip-simulation-copy">' + (refs ? "That total mixes catalog market references for the " + fmtInt(refs) + " card" + (refs === 1 ? "" : "s") + " we do not stock" + (ours ? " with our shelf price on the " + fmtInt(ours) + " we do" : "") + ". " : "") +
        ripSourceNote() + '</p>' +
      '<p class="rip-simulation-copy rip-stocked">' + (stocked
        ? fmtInt(stocked) + " of these " + fmtInt(rip.cards.length) + " card" + (rip.cards.length === 1 ? " is" : "s are") + " in our case right now &mdash; badged <span class=\"rip-stock sm\">In Stock Now</span> below. Only those can be added to a cart, and they are sold separately."
        : "None of these cards are in our case right now, so there is nothing here to add to a cart.") + '</p>' +
      (best ? '<div class="rip-bestpull"><div class="rip-best-art">' + (best.card.img ? '<img src="' + esc(best.card.img) + '" alt="' + esc(best.card.name) + '">' : cardArt(best.card.item || best.card)) + '</div>' +
        '<div class="rip-best-meta"><span class="rip-label">Simulation highlight</span><h3>' + esc(best.card.name) + '</h3>' +
        '<p class="rip-note">' + esc(P.labels[best.tier] || best.tier) + ' &middot; ' + esc(best.card.set || ripSetLabel(rip.game, rip.set)) + (best.card.cond ? ' &middot; ' + esc(best.card.cond) : "") + '</p>' +
        ripStockBadge(best.card) +
        '<b class="rip-price">' + ripPriceHtml(best.card) + '</b>' +
        '<p class="rip-simulation-copy">' + (best.card.inStock
          ? "We have this single in the case. It is sold separately; adding it to your cart does not claim a prize."
          : "We do not have this single in the case right now, so the figure above is a catalog market reference, not our price.") + '</p>' +
        '<div class="rip-btns">' +
          (best.card.inStock ? '<button class="btn" type="button" data-rip-add="' + bi + '">Add single to cart</button>' : "") +
          '<button class="btn btn-ghost" type="button" data-rip-view="' + bi + '">' + (best.card.inStock ? "Product details" : "Card details") + '</button>' +
        '</div></div></div>' : "") +
      '<div class="rip-btns rip-again"><button class="btn" type="button" data-rip-again>Simulate another &middot; free</button><button class="btn btn-ghost" type="button" data-rip-share>Share simulation</button>' +
      '<button class="btn btn-ghost" type="button" data-go="shop" data-params="type=sealed&game=' + esc(rip.game) + '">Shop physical ' + esc(P.name) + ' packs</button></div>' +
      '<p class="rip-simulation-copy">Optional shopping: physical singles and packs are sold separately and require a separate checkout.</p>' +
    '</div>' +
    '<ul class="rip-list" aria-label="Cards shown in the simulation; physical singles sold separately">' + rip.cards.map(function(c, i){
      var card = c.card, src = card.img;
      return '<li class="rip-row' + (c.rare ? " rare" : "") + (c === best ? " best" : "") + (card.inStock ? " stocked" : "") + '">' +
        '<button class="rip-row-view" type="button" data-rip-view="' + i + '" aria-label="' + esc(card.name) + ', ' + esc(ripPriceSay(card)) + (card.inStock ? ", in stock now" : "") + ', open details">' +
          (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" width="44" height="44">' : '<span class="rip-best-ph" aria-hidden="true"></span>') +
          '<span class="rip-row-name"><b>' + esc(card.name) + '</b><span>' + esc(P.labels[c.tier] || c.tier) + (c.rh ? " · reverse holo" : "") +
            (card.inStock && card.itemSet && card.itemSet !== card.set ? " · our copy: " + esc(card.itemSet) : "") +
            (card.cond ? " · " + esc(card.cond) : "") + '</span></span>' +
          ripStockBadge(card, "sm") + '</button>' +
        '<span class="rip-row-price">' + ripPriceHtml(card) + '</span>' +
        (card.inStock
          ? '<button class="add rip-row-add" type="button" data-rip-add="' + i + '">Add single to cart</button>'
          : '<span class="rip-row-flag">Not in our case</span>') + '</li>';
    }).join("") + '</ul>';
    res.hidden = false;
    ripSay("Simulation complete. No real pack was opened, no cards were awarded, and nothing was charged. Reference singles total: " + money(total) +
      ", not winnings or store credit. " + stocked + " of " + rip.cards.length + " are in stock at the shop." + (best ? " Simulation highlight: " + best.card.name + "." : ""));
    ripLater(function(){
      try { res.scrollIntoView({behavior: reduceMotion ? "auto" : "smooth", block: "start"}); } catch(e){}
      var h = $("#ripResultH"); if(h) try { h.focus({preventScroll:true}); } catch(e){}
    }, 60);
  }
  function ripShare(){
    var best = null, total = 0, stocked = 0;
    rip.cards.forEach(function(c){
      total += Number(c.card.price) || 0;
      if(c.card.inStock) stocked++;
      if(!best || (Number(c.card.price) || 0) > (Number(best.card.price) || 0)) best = c;
    });
    var url = location.origin + location.pathname + "#/rip";
    var text = "I tried Top Loaded's free pack-opening simulator!";
    if(best) text += " Simulation highlight: " + best.card.name + (best.card.inStock ? " (in their case right now)" : "") + ".";
    text += " No real pack was opened and no cards or prizes were awarded. Reference singles total: " + money(total) + " (catalog pricing, not winnings or store credit).";
    if(navigator.share){
      navigator.share({title: "Top Loaded free pack simulator", text: text, url: url}).catch(function(){});
      return;
    }
    var full = text + " " + url;
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(full).then(function(){ toast("Copied to clipboard — paste it anywhere"); }, function(){ toast(full); });
    } else toast(full);
  }
  /* only a card we actually stock can go in the cart */
  function ripAddToCart(i, btn){
    var c = rip.cards[i]; if(!c) return;
    var card = c.card, it = card.item;
    if(!it || !card.inStock){
      toast(card.name + " is not in our case right now — nothing to add");
      return;
    }
    if(TL.cart && typeof TL.cart.add === "function"){
      try { TL.cart.add(it, 1, btn); return; } catch(e){ if(window.console) console.error("[rip] cart", e); }
    }
    if(it.url){ window.open(it.url, "_blank", "noopener"); toast("Opened " + it.name + " on TCGplayer"); return; }
    toast("Cart is warming up — try again in a moment");
  }
  function ripView(i){
    var c = rip.cards[i]; if(!c) return;
    var card = c.card;
    /* the core default is an empty no-op until the shop package defines the modal */
    var noModal = String(TL.openQuickView).replace(/\s/g, "") === "function(){}";
    if(card.item && !noModal){
      try { TL.openQuickView(card.item); return; } catch(e){ if(window.console) console.error("[rip] quickview", e); }
    }
    if(card.url){ window.open(card.url, "_blank", "noopener"); return; }
    toast(card.name + " · " + ripPriceText(card) + " · " + (card.inStock ? "in stock now" : "not in our case"));
  }

  /* ---- events ---- */
  ripApp.addEventListener("click", function(e){
    var t;
    if((t = e.target.closest("[data-rip-game]"))){
      if(rip.game === t.dataset.ripGame) return;
      rip.game = t.dataset.ripGame; rip.set = ""; rip.setName = "";
      ripSavePrefs();
      ripRenderSetup(); var b = $('[data-rip-game="' + rip.game + '"]', ripApp); if(b) b.focus();
      return;
    }
    if(e.target.closest("[data-rip-open]")){ ripStartPack(); return; }
    if(e.target.closest("[data-rip-retry]")){
      ripItemsP = null; ripItems = null; ripSetCache = {}; ripSetList = {}; ripPoolCache = {};
      ripRenderSetup(); ripLoadItems().then(function(){ if(rip.stage === "setup") ripRenderSetup(); });
      return;
    }
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
      /* a click with detail 0 (assistive tech, programmatic .click()) tears straight away; real keys are handled in keydown below */
      if(e.detail === 0 || reduceMotion || rip.drag === "done"){ ripTear(); return; }
      if(rip.drag === "moved"){ rip.drag = null; return; }
      t.classList.remove("nudge"); void t.offsetWidth; t.classList.add("nudge");
      var hint = $("#ripHint"); if(hint) hint.textContent = "Swipe across the tear strip — or press Open simulated pack.";
    }
  });
  ripApp.addEventListener("change", function(e){
    if(e.target && e.target.id === "ripSet"){
      rip.set = e.target.value;
      var hit = ripFindSet(ripSetList[rip.game], rip.set);
      rip.setName = hit ? hit.name : rip.set;
      ripSavePrefs();
    }
  });
  ripApp.addEventListener("keydown", function(e){
    /* #ripPack is a div[role=button], so the browser synthesises no click for Enter or Space — tear on both here,
       exactly like the Open pack button (the aria-label, the hint and the #ripLive announcement all promise Enter) */
    var pack = e.target.closest && e.target.closest("#ripPack");
    if(pack && (e.key === "Enter" || e.key === " " || e.key === "Spacebar") && rip.stage === "pack"){ e.preventDefault(); ripTear(); }
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
      ripRequestSets(rip.game);
      ripLoadItems().then(function(){ if(rip.stage === "setup" && TL.current === "rip") ripRenderSetup(); });
    }
  }
  TL.on("view:change", function(d){ if(d && d.name === "rip" && !d.paramsOnly) ripEnter(); });
  TL.on("view:leave", function(d){ if(d && d.name === "rip"){ ripClearTimers(); rip.drag = null; } });
  TL.on("inventory:summary", function(){ if(rip.stage === "setup" && TL.current === "rip") ripRenderSetup(); });
  TL.on("inventory:loaded", function(d){
    if(d && d.items && d.items.length && !(ripItems && !ripDemo)){
      ripItems = d.items; ripDemo = !d.items.some(function(it){ return it.tcg; });
      ripSetCache = {}; ripItemsP = Promise.resolve(ripItems);
      /* fresh stock: rebuild pools so "In Stock Now" reflects the live case */
      ripPoolCache = {};
      if(!ripCatalogGame(rip.game)) ripSetList = {};
    }
    if(rip.stage === "setup" && TL.current === "rip") ripRenderSetup();
  });
  TL.on("init", function(){ ripRenderSetup(); });
