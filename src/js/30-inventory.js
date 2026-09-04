  /* ---------- live TCGplayer inventory: TL.inventory ----------
       TL.inventory.summary        inventory-summary.json (small; fetched on init)
       TL.inventory.items          normalized live items once loaded, else the demo ITEMS
       TL.inventory.generated      ISO time the inventory was pulled from TCGplayer
       TL.inventory.loaded         true once inventory.json is normalized
       TL.inventory.failed         true when the full fetch failed (demo items stay)
       TL.inventory.load()         Promise<items>; fetches inventory.json lazily, once
       TL.inventory.byId(id)       item or undefined (map lookup; demo ids resolve too)
       TL.inventory.search(q, {game, type, limit})
       TL.inventory.catalog()      the active list (live or demo) without live-break spots
       TL.inventory.freshness(iso) {rel, abs, text, cls, age}
       TL.inventory.gameLabel(game) / gameCounts()
     Emits 'inventory:summary' {summary} and 'inventory:loaded' {items, generated}.
     Item shape (demo and live): {id, name, set, lineName?, game, type:'single'|'sealed',
       cond, price, stock, tcg?, img?, imgLg?, url?, market?, rarity?, printing?, listings?} */
  var GAME_LABEL = {pk:"Pokemon", op:"One Piece", mtg:"Magic", gundam:"Gundam", lorcana:"Lorcana", other:"More"};
  var CORE_GAMES = ["pk", "op", "mtg", "gundam"];
  var COND_ABBR = {"Near Mint":"NM", "Lightly Played":"LP", "Moderately Played":"MP", "Heavily Played":"HP", "Damaged":"DMG", "Unopened":"SEALED"};
  var TCG_CDN = "https://tcgplayer-cdn.tcgplayer.com/product/";
  var SEALED_NAME_RE = /booster box|elite trainer|booster bundle|collection|display|\btins?\b|blister|bundle|\bdecks?\b|\bcase\b/i;
  var ACCESSORY_RE = /sleeve|accessor|binder|playmat|deck box|toploader|portfolio/i;
  function tcgImg(id, size){ return TCG_CDN + encodeURIComponent(String(id)) + "_in_" + size + ".jpg"; }
  function tcgUrl(id){ return "https://www.tcgplayer.com/product/" + encodeURIComponent(String(id)) + "?seller=5c356cdf"; }
  function normGame(g){
    return (g === "pk" || g === "op" || g === "mtg" || g === "gundam" || g === "lorcana") ? g : "other";
  }
  function gameLabel(g){ return GAME_LABEL[g] || GAMES[g] || "More"; }
  /* sealed rule: a rarity means a single card; otherwise an Unopened listing, an accessory line,
     or a sealed-product word in the name. Trainer cards like "Suspicious Food Tin" carry a rarity. */
  function isSealed(p){
    if(p.rarity) return false;
    var ls = p.listings || [];
    for(var i = 0; i < ls.length; i++){ if(ls[i] && ls[i].cond === "Unopened") return true; }
    var line = String(p.line || "");
    if(line === "Card Sleeves" || ACCESSORY_RE.test(line)) return true;
    return SEALED_NAME_RE.test(String(p.name || ""));
  }
  function printingTag(pr){
    if(!pr) return "";
    if(/reverse/i.test(pr)) return "RH";
    if(/1st/i.test(pr)) return "1st Ed";
    if(/cold foil/i.test(pr)) return "Cold Foil";
    if(/holo/i.test(pr)) return "Holo";
    if(/foil/i.test(pr)) return "Foil";
    return "";
  }
  function liveToItem(p){
    var ls = Array.isArray(p.listings) ? p.listings.filter(function(l){ return l && typeof l.price === "number"; }) : [];
    var best = null, qty = 0;
    for(var i = 0; i < ls.length; i++){
      qty += Math.max(0, parseInt(ls[i].qty, 10) || 0);
      if(!best || ls[i].price < best.price) best = ls[i];
    }
    var sealed = isSealed(p);
    var cond = best ? (COND_ABBR[best.cond] || best.cond || null) : null;
    var tag = best ? printingTag(best.printing) : "";
    if(cond && tag && !sealed) cond += " · " + tag;
    var id = String(p.id);
    return {
      id: "tcg-" + id, tcgId: id, num: Number(p.id) || 0,
      name: String(p.name || "Untitled"), set: String(p.set || ""), lineName: p.line ? String(p.line) : "",
      game: normGame(p.game), jp: p.line === "Pokemon Japan",
      type: sealed ? "sealed" : "single",
      cond: cond, printing: best ? (best.printing || "") : "",
      price: best ? best.price : 0, stock: qty, tcg: true,
      market: (typeof p.market === "number" && p.market > 0) ? p.market : null,
      rarity: p.rarity ? String(p.rarity) : "",
      listings: ls,
      img: tcgImg(id, "200x200"), imgLg: tcgImg(id, "1000x1000"), url: tcgUrl(id)
    };
  }
  function mergeDup(into, p){
    var ls = Array.isArray(p.listings) ? p.listings : [];
    for(var i = 0; i < ls.length; i++){
      if(!ls[i] || typeof ls[i].price !== "number") continue;
      into.listings.push(ls[i]);
      into.stock += Math.max(0, parseInt(ls[i].qty, 10) || 0);
      if(ls[i].price < into.price){
        into.price = ls[i].price;
        var c = COND_ABBR[ls[i].cond] || ls[i].cond || null, t = printingTag(ls[i].printing);
        into.cond = (c && t && into.type !== "sealed") ? c + " · " + t : c;
        into.printing = ls[i].printing || "";
      }
    }
  }
  var idle = window.requestIdleCallback
    ? function(fn){ window.requestIdleCallback(fn, {timeout: 250}); }
    : function(fn){ setTimeout(fn, 0); };
  var CHUNK = 500;
  function normalizeChunked(raw, done){
    var out = [], seen = {}, i = 0, n = raw.length;
    function step(){
      var end = Math.min(n, i + CHUNK);
      for(; i < end; i++){
        var p = raw[i];
        if(!p || p.id === undefined || p.id === null) continue;
        var key = String(p.id);
        if(seen[key]) mergeDup(seen[key], p);
        else { var it = liveToItem(p); seen[key] = it; out.push(it); }
      }
      if(i < n) idle(step); else { var map = {}; for(var k = 0; k < out.length; k++) map[out[k].id] = out[k]; done(out, map); }
    }
    idle(step);
  }
  function parseISO(s){
    if(!s) return null;
    var str = String(s).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    var d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
  function freshness(iso){
    var d = parseISO(iso);
    if(!d) return {rel: "", abs: "", text: "", cls: "", age: null};
    var age = Date.now() - d.getTime(), mins = Math.round(age / 6e4), hours = age / 36e5, days = Math.round(hours / 24);
    var cls = hours < 36 ? "" : (hours < 168 ? "warn" : "crit");
    var rel;
    try {
      var rtf = window.Intl && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat("en", {numeric: "auto"}) : null;
      if(mins < 1) rel = "just now";
      else if(mins < 60) rel = rtf ? rtf.format(-mins, "minute") : mins + " min ago";
      else if(hours < 48) rel = rtf ? rtf.format(-Math.round(hours), "hour") : Math.round(hours) + " hours ago";
      else rel = rtf ? rtf.format(-days, "day") : days + " days ago";
    } catch(e){ rel = days + " days ago"; }
    var abs;
    try {
      abs = new Intl.DateTimeFormat("en-US", {timeZone: (TL.config && TL.config.timezone) || "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}).format(d);
    } catch(e){ abs = d.toLocaleString(); }
    return {rel: rel, abs: abs, cls: cls, age: age,
      text: "synced " + rel + " · " + abs + (cls === "crit" ? " · prices may be out of date" : "")};
  }
  function applyOverride(it){
    var ov = TL.store.get("stockOverrides", null);
    if(ov && typeof ov[it.id] === "number" && ov[it.id] !== it.stock){ it.stock = ov[it.id]; it.overridden = true; }
    return it;
  }
  function applyOverrides(list){
    var ov = TL.store.get("stockOverrides", null);
    if(!ov) return list;
    for(var i = 0; i < list.length; i++){ var it = list[i]; if(it && typeof ov[it.id] === "number"){ it.stock = ov[it.id]; it.overridden = true; } }
    return list;
  }
  TL.on("inventory:override", function(d){
    if(!d || !d.id) return;
    var it = INV.byId(d.id); if(it && typeof d.stock === "number"){ it.stock = d.stock; it.overridden = true; }
  });
  var INV = TL.inventory = {
    summary: null, items: ITEMS, generated: null, loaded: false, loading: false, failed: false,
    _map: null, _promise: null,
    catalog: function(){
      var src = INV.loaded ? INV.items : ITEMS;
      return src.filter(function(it){ return it && !it.live; });
    },
    byId: function(id){
      if(id === undefined || id === null) return undefined;
      id = String(id);
      var it;
      if(INV._map){
        if(INV._map[id]) it = INV._map[id];
        else if(INV._map["tcg-" + id]) it = INV._map["tcg-" + id];
      }
      if(!it) for(var i = 0; i < ITEMS.length; i++){ if(ITEMS[i] && ITEMS[i].id === id){ it = ITEMS[i]; break; } }
      if(!it && INV._summaryMap && INV._summaryMap[id]) it = INV._summaryMap[id];
      return it ? applyOverride(it) : undefined;
    },
    /* admin stock edits made on this device (TL.store 'stockOverrides' {id: stock}) win over the nightly file */
    overrides: function(){ return TL.store.get("stockOverrides", {}) || {}; },
    search: function(q, opts){
      opts = opts || {};
      var terms = String(q || "").toLowerCase().split(/\s+/).filter(Boolean), limit = opts.limit || 50, out = [];
      var list = INV.catalog();
      for(var i = 0; i < list.length && out.length < limit; i++){
        var it = list[i];
        if(opts.game && it.game !== opts.game) continue;
        if(opts.type && it.type !== opts.type) continue;
        if(terms.length){
          var hay = itemHay(it), ok = true;
          for(var t = 0; t < terms.length; t++){ if(hay.indexOf(terms[t]) === -1){ ok = false; break; } }
          if(!ok) continue;
        }
        out.push(it);
      }
      return out;
    },
    load: function(){
      if(INV._promise) return INV._promise;
      if(!window.fetch){ INV.failed = true; return Promise.resolve(INV.catalog()); }
      INV.loading = true;
      TL.emit("inventory:loading", {});
      INV._promise = fetch("inventory.json").then(function(r){
        if(!r.ok) throw new Error("inventory " + r.status);
        return r.json();
      }).then(function(d){
        if(!d || !Array.isArray(d.items) || !d.items.length) throw new Error("empty inventory");
        return new Promise(function(resolve){
          normalizeChunked(d.items, function(items, map){
            INV.items = applyOverrides(items); INV._map = map; INV.generated = d.generated || INV.generated;
            INV.loaded = true; INV.loading = false; INV.failed = false;
            INV.counts = {products: items.length, listings: d.listings, units: d.units};
            TL.emit("inventory:loaded", {items: items, generated: INV.generated});
            resolve(items);
          });
        });
      }).catch(function(){
        INV.loading = false; INV.failed = true; INV._promise = null;
        TL.emit("inventory:failed", {});
        return INV.catalog();
      });
      return INV._promise;
    },
    freshness: freshness,
    gameLabel: gameLabel,
    /* per-game product counts from whatever is available (summary → live items → demo) */
    gameCounts: function(){
      var out = {}, i;
      if(INV.summary && INV.summary.games){
        Object.keys(INV.summary.games).forEach(function(g){ var k = normGame(g); out[k] = (out[k] || 0) + (INV.summary.games[g] || 0); });
        return out;
      }
      var list = INV.catalog();
      for(i = 0; i < list.length; i++){ var k = normGame(list[i].game); out[k] = (out[k] || 0) + 1; }
      return out;
    },
    toItem: liveToItem
  };
  function itemHay(it){
    if(!it._hay) it._hay = (it.name + " " + (it.set || "") + " " + (it.rarity || "") + " " + (it.lineName || GAMES[it.game] || "")).toLowerCase();
    return it._hay;
  }
  function loadSummary(){
    if(!window.fetch) return Promise.resolve(null);
    return fetch("inventory-summary.json", {cache: "no-cache"}).then(function(r){
      if(!r.ok) throw new Error("summary " + r.status);
      return r.json();
    }).then(function(s){
      if(!s || typeof s !== "object") throw new Error("bad summary");
      var map = {};
      function norm(list){
        return (Array.isArray(list) ? list : []).map(function(p){
          if(!p || p.id === undefined) return null;
          var it = INV._map && INV._map["tcg-" + String(p.id)];
          if(!it){ it = liveToItem(p); }
          map[it.id] = it;
          return it;
        }).filter(Boolean);
      }
      s.topItems = norm(s.top);
      s.topByGameItems = {};
      Object.keys(s.topByGame || {}).forEach(function(g){ s.topByGameItems[g] = norm(s.topByGame[g]); });
      INV._summaryMap = map;
      INV.summary = s;
      if(!INV.generated) INV.generated = s.generated || null;
      INV.counts = INV.counts || {products: s.products, listings: s.listings, units: s.units};
      TL.emit("inventory:summary", {summary: s});
      return s;
    }).catch(function(){ TL.emit("inventory:summary-failed", {}); return null; });
  }
  TL.on("init", function(){ loadSummary(); });
