  /* ---------- product rendering + the shop ----------
     Exports kept for other modules: esc(), prodCard(it, opts), cardArt(it), stockLabel(it),
     gameLabel(it), renderShop(), renderFeatured(). Shop state lives in F and is mirrored to
     the URL through TL.setParams; TL.shop.list() is the current result list (quick view
     walks it with prev/next). Everything here works with the demo ITEMS until TL.inventory
     delivers live items. */
  function esc(s){
    return String(s === undefined || s === null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  TL.esc = esc;
  function reEsc(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  /* escape + wrap matched search terms in <mark> */
  function hl(text, terms){
    var s = esc(text);
    if(!terms || !terms.length) return s;
    try {
      var re = new RegExp("(" + terms.map(function(t){ return reEsc(esc(t)); }).join("|") + ")", "ig");
      return s.replace(re, "<mark>$1</mark>");
    } catch(e){ return s; }
  }
  function itemGameLabel(it){ return (it && (it.lineName || GAMES[it.game] || (TL.inventory && TL.inventory.gameLabel(it.game)))) || "TCG"; }
  function gameLabelFor(x){ return (typeof x === "string") ? gameLabel(x) : itemGameLabel(x); }
  TL.gameLabel = gameLabelFor;
  function stockLabel(it){
    var n = Number(it && it.stock) || 0, price = Number(it && it.price) || 0;
    if(n <= 0) return '<span class="stock out">Sold out</span>';
    var low = price >= 3 ? " low" : "";
    if(n === 1) return '<span class="stock' + low + ' last">1 left</span>';
    if(n <= 3) return '<span class="stock' + low + '">' + n + ' left</span>';
    return '<span class="stock">In stock</span>';
  }
  function marketPill(it){
    if(!it || typeof it.market !== "number" || it.market <= 0 || !(it.price > 0)) return "";
    var diff = Math.round((it.market - it.price) / it.market * 100), cls = "", txt;
    if(diff >= 2){ txt = diff + "% under"; cls = " under"; }
    else if(diff <= -2){ txt = Math.abs(diff) + "% over"; cls = " over"; }
    else txt = "at market";
    return '<span class="mkt' + cls + '" title="TCGplayer market price">Market ' + money(it.market) + ' \u00b7 ' + txt + '</span>';
  }
  var ART = {
    pk:{a:"#3A6EA8", b:"#16202F", label:"POKEMON",
        em:'<path d="M125 92 L96 158 h22 l-14 60 l50 -76 h-25 l21 -50 z" fill="#F5C542"/>'},
    op:{a:"#8E3227", b:"#231314", label:"ONE PIECE",
        em:'<path d="M95 166 a30 28 0 0 1 60 0 z" fill="#E8C97A"/><rect x="97" y="152" width="56" height="11" fill="#D94A3D"/><ellipse cx="125" cy="168" rx="56" ry="12" fill="#E8C97A"/>'},
    mtg:{a:"#57432A", b:"#1E1911", label:"MAGIC",
        em:'<path d="M125 98 L172 132 L154 190 L96 190 L78 132 Z" fill="none" stroke="#C08A3E" stroke-width="5"/><path d="M125 120 L152 140 L142 172 L108 172 L98 140 Z" fill="#C08A3E" opacity=".85"/>'},
    gundam:{a:"#3C5A8A", b:"#141B2A", label:"GUNDAM",
        em:'<path d="M125 86 L150 116 L150 176 L125 196 L100 176 L100 116 Z" fill="none" stroke="#DDE6F5" stroke-width="5"/><path d="M112 128 h26 v22 h-26 z" fill="#E9503C"/>'},
    lorcana:{a:"#5B4A8A", b:"#1B1626", label:"LORCANA",
        em:'<circle cx="125" cy="150" r="42" fill="none" stroke="#E6C46A" stroke-width="5"/><circle cx="125" cy="150" r="16" fill="#E6C46A"/>'},
    other:{a:"#4A5566", b:"#171B22", label:"TCG",
        em:'<rect x="92" y="108" width="66" height="90" rx="6" fill="none" stroke="#C9D1DE" stroke-width="5"/><path d="M104 128 h42 M104 150 h42 M104 172 h26" stroke="#C9D1DE" stroke-width="5" stroke-linecap="round"/>'}
  };
  function boxArt(){
    return '<g><rect x="75" y="80" width="100" height="120" rx="5" fill="rgba(255,255,255,.92)"/>' +
      '<rect x="75" y="80" width="100" height="26" rx="5" fill="rgba(0,0,0,.45)"/>' +
      '<path d="M75 200 L125 222 L175 200 Z" fill="rgba(255,255,255,.55)"/>' +
      '<path d="M125 106 v94" stroke="rgba(0,0,0,.25)" stroke-width="2"/>' +
      '<path d="M90 130 h70 M90 150 h70 M90 170 h44" stroke="rgba(0,0,0,.28)" stroke-width="5" stroke-linecap="round"/></g>';
  }
  var IMG_KEY = {pk1:"pk-charizard151", pk2:"pk-pikachuhat", pk3:"pk-tatsugiri", pk4:"pk-iono", pk5:"pk-roaringmoon", op1:"op-shanks-op09", op2:"op-luffy-op05", op3:"op-boa-op07", op4:"op-law-op01", m1:"mtg-ragavan", m2:"mtg-sheoldred", m3:"mtg-onering", m4:"mtg-bowmasters"};
  var artSeq = 0;
  function cardArt(it){
    it = it || {};
    var key = IMG_KEY[it.id];
    if(key && window.CARD_IMG && window.CARD_IMG[key]){
      return '<img class="card-img ok" src="' + window.CARD_IMG[key] + '" alt="' + esc(it.name) + '" width="150" height="210" decoding="async">';
    }
    var a = ART[it.game] || ART.other;
    var gid = "cg-" + String(it.id || "x").replace(/[^\w-]/g, "") + "-" + (artSeq++);
    var nm = String(it.name || ""), st = String(it.set || "");
    var name = nm.length > 24 ? nm.slice(0, 23) + "\u2026" : nm;
    var set = st.length > 32 ? st.slice(0, 31) + "\u2026" : st;
    return '<svg viewBox="0 0 250 350" role="img" aria-label="' + esc(nm) + ' card art placeholder" preserveAspectRatio="xMidYMid slice">' +
      '<defs><radialGradient id="' + gid + '" cx="50%" cy="40%" r="80%">' +
        '<stop offset="0%" stop-color="' + a.a + '"/><stop offset="100%" stop-color="' + a.b + '"/></radialGradient></defs>' +
      '<rect width="250" height="350" fill="#12151B"/>' +
      '<rect x="8" y="8" width="234" height="334" rx="9" fill="none" stroke="#2A3140" stroke-width="2"/>' +
      '<text x="20" y="31" font-family="Spline Sans Mono, monospace" font-size="11" letter-spacing="2.4" fill="rgba(255,255,255,.55)">' + a.label + '</text>' +
      '<rect x="16" y="42" width="218" height="216" rx="6" fill="url(#' + gid + ')"/>' +
      '<g opacity=".16"><path d="M16 226 L234 130" stroke="#fff" stroke-width="24"/><path d="M16 258 L234 176" stroke="#fff" stroke-width="9"/></g>' +
      (it.type === "sealed" ? boxArt() : a.em) +
      '<rect x="16" y="42" width="218" height="216" rx="6" fill="none" stroke="rgba(0,0,0,.4)"/>' +
      '<text x="20" y="292" font-family="Spline Sans, sans-serif" font-weight="600" font-size="16" fill="#EEF0F4">' + esc(name) + '</text>' +
      '<text x="20" y="318" font-family="Spline Sans Mono, monospace" font-size="10.5" letter-spacing="1" fill="rgba(255,255,255,.5)">' + esc(set) + '</text>' +
    '</svg>';
  }
  function wished(id){ return !!(TL.wishlist && TL.wishlist.has(id)); }
  function heartBtn(it){
    var on = wished(it.id);
    return '<button class="heart" type="button" data-wish="' + esc(it.id) + '" aria-pressed="' + on + '" aria-label="' + (on ? "Remove " : "Save ") + esc(it.name) + (on ? " from" : " to") + ' your wishlist">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21s-7.2-4.6-9.6-9.1C.7 8.6 2.3 4.9 5.9 4.2c2-.4 4 .5 5.1 2.1 1.1-1.6 3.1-2.5 5.1-2.1 3.6.7 5.2 4.4 3.5 7.7C19.2 16.4 12 21 12 21z"/></svg></button>';
  }
  /* opts: {i: stagger index, eager: bool (above the fold), hl: [terms]} */
  function prodCard(it, opts){
    opts = opts || {};
    it = it || {};
    var terms = opts.hl || null;
    var out = !(Number(it.stock) > 0);
    var art;
    if(it.tcg && it.img){
      art = '<img class="card-img" src="' + esc(it.img) + '" alt="' + esc(it.name) + '" width="150" height="210" decoding="async"' +
        (opts.eager ? ' fetchpriority="high"' : ' loading="lazy"') + ' referrerpolicy="no-referrer">';
    } else art = cardArt(it);
    var cond = it.cond ? '<span class="cond">' + esc(it.cond) + (it.jp ? ' \u00b7 JP' : '') + "</span>" : (it.jp ? '<span class="cond">JP</span>' : "");
    var back = '<div class="back-body"><span class="back-k">' + esc(itemGameLabel(it)) + '</span>' +
      '<b>' + esc(it.name) + '</b>' +
      '<span>' + esc(it.set) + (it.rarity ? ' \u00b7 ' + esc(it.rarity) : '') + '</span>' +
      '<span>' + (it.cond ? esc(it.cond) : (it.type === "sealed" ? "Sealed" : "")) + (it.printing && !/normal/i.test(it.printing) ? ' \u00b7 ' + esc(it.printing) : '') + '</span>' +
      '<span>' + (out ? "Sold out" : (Number(it.stock) || 0) + " in stock") + '</span>' +
      (typeof it.market === "number" ? '<span>Market ' + money(it.market) + ' / Ours ' + money(it.price) + '</span>' : '<span>Ours ' + money(it.price) + '</span>') +
      '</div>';
    var action;
    if(out) action = '<button class="add notify" type="button" data-notify="' + esc(it.id) + '">Notify me when it\u2019s back</button>';
    else action = '<button class="add" type="button" data-cart="' + esc(it.id) + '">Add to cart</button>';
    var tcgLink = (it.tcg && it.url)
      ? '<a class="tcg-link" href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">on TCGplayer \u2197<span class="sr-only"> (opens TCGplayer in a new tab)</span></a>'
      : "";
    var rarity = it.rarity ? '<span class="p-rarity">' + hl(it.rarity, terms) + '</span>' : "";
    return '<article class="prod' + (out ? " out" : "") + (it.tcg ? " tcg" : "") + '" data-id="' + esc(it.id) + '" tabindex="0"' +
      (typeof opts.i === "number" ? ' style="--i:' + Math.min(opts.i, 12) + '"' : "") + '>' +
      '<div class="thumb" data-qv="' + esc(it.id) + '">' +
        '<div class="flip"><div class="tilt">' +
          '<div class="mini face front">' + art + '<span class="holo-hover"></span></div>' +
          '<div class="mini face back" aria-hidden="true">' + back + '</div>' +
        '</div></div>' +
        cond + heartBtn(it) +
        '<span class="qv-hint" aria-hidden="true">Quick view</span>' +
      "</div>" +
      '<div class="p-meta"><h3>' + hl(it.name, terms) + "</h3>" +
      '<p class="p-set">' + esc(itemGameLabel(it)) + " \u00b7 " + hl(it.set, terms) + rarity + "</p>" +
      marketPill(it) +
      '<div class="p-row"><span class="price">' + money(it.price) + "</span>" + stockLabel(it) + "</div>" +
      '<div class="p-actions">' + action + tcgLink + "</div>" +
      "</div></article>";
  }
  function skelCard(i){
    return '<article class="prod skel" aria-hidden="true" style="--i:' + i + '"><div class="thumb"><div class="mini"></div></div>' +
      '<div class="p-meta"><span class="sk-line"></span><span class="sk-line short"></span><span class="sk-line price"></span><span class="sk-line btn"></span></div></article>';
  }
  function skeletons(n){ var s = ""; for(var i = 0; i < n; i++) s += skelCard(i); return s; }

  /* ---------- shop state ---------- */
  var SHOP_PAGE = 24, AUTO_PAGES = 8;
  var F_DEFAULT = {game:"all", type:"all", set:"", rarity:"", cond:"", all:"", min:"", max:"", sort:"feat", q:"", wish:""};
  var F = Object.assign ? Object.assign({}, F_DEFAULT) : JSON.parse(JSON.stringify(F_DEFAULT));
  var curList = [], shownCount = 0, autoLoads = 0, featSource = null;
  var shopGrid = $("#shopGrid"), shopMore = $("#shopMore"), loadMoreBtn = $("#loadMore"), shopStatus = $("#shopStatus");
  function priceDesc(a, b){ return (b.price || 0) - (a.price || 0); }
  /* featured order: priciest singles per core game interleaved (pk, op, mtg), then the rest by price */
  function ensureFeatRank(items){
    if(featSource === items) return;
    var by = {pk:[], op:[], mtg:[]}, rest = [];
    for(var i = 0; i < items.length; i++){
      var it = items[i];
      if(it.type === "single" && by[it.game]) by[it.game].push(it); else rest.push(it);
    }
    by.pk.sort(priceDesc); by.op.sort(priceDesc); by.mtg.sort(priceDesc); rest.sort(priceDesc);
    var rank = 0, max = Math.max(by.pk.length, by.op.length, by.mtg.length);
    for(var r = 0; r < max; r++){
      if(by.pk[r]) by.pk[r]._feat = rank++;
      if(by.op[r]) by.op[r]._feat = rank++;
      if(by.mtg[r]) by.mtg[r]._feat = rank++;
    }
    for(var k = 0; k < rest.length; k++) rest[k]._feat = rank++;
    featSource = items;
  }
  function searchTerms(){ return F.q ? F.q.toLowerCase().split(/\s+/).filter(Boolean) : []; }
  function computeList(){
    var INV = TL.inventory, src = INV ? INV.catalog() : ITEMS.filter(function(it){ return !it.live; });
    ensureFeatRank(INV && INV.loaded ? INV.items : ITEMS);
    var terms = searchTerms(), rar = F.rarity ? F.rarity.split(",") : null;
    var min = F.min !== "" ? parseFloat(F.min) : null, max = F.max !== "" ? parseFloat(F.max) : null;
    var wishSet = null;
    if(F.wish === "1" && TL.wishlist){ wishSet = {}; TL.wishlist.ids().forEach(function(id){ wishSet[id] = true; }); }
    var out = [];
    for(var i = 0; i < src.length; i++){
      var it = src[i];
      if(!it) continue;
      if(wishSet && !wishSet[it.id]) continue;
      if(F.game !== "all" && it.game !== F.game) continue;
      if(F.type !== "all" && it.type !== F.type) continue;
      if(F.set && it.set !== F.set) continue;
      if(rar && rar.indexOf(it.rarity || "") === -1) continue;
      if(F.cond && !(it.cond && String(it.cond).indexOf(F.cond) === 0)) continue;
      if(F.all !== "1" && !(Number(it.stock) > 0)) continue;
      if(min !== null && !isNaN(min) && it.price < min) continue;
      if(max !== null && !isNaN(max) && it.price > max) continue;
      if(terms.length){
        var hay = itemHay(it), ok = true;
        for(var t = 0; t < terms.length; t++){ if(hay.indexOf(terms[t]) === -1){ ok = false; break; } }
        if(!ok) continue;
      }
      out.push(it);
    }
    var s = F.sort;
    if(s === "asc") out.sort(function(a, b){ return a.price - b.price; });
    else if(s === "desc") out.sort(priceDesc);
    else if(s === "name") out.sort(function(a, b){ return a.name.localeCompare(b.name); });
    else if(s === "new") out.sort(function(a, b){ return (b.num || 0) - (a.num || 0) || a.name.localeCompare(b.name); });
    else if(s === "value") out.sort(function(a, b){
      var ra = a.market > 0 ? a.price / a.market : Infinity, rb = b.market > 0 ? b.price / b.market : Infinity;
      return ra - rb || priceDesc(a, b);
    });
    else out.sort(function(a, b){ return (a._feat || 0) - (b._feat || 0); });
    return out;
  }
  function filtersActive(){
    var ks = Object.keys(F_DEFAULT);
    for(var i = 0; i < ks.length; i++){ if(ks[i] !== "sort" && F[ks[i]] !== F_DEFAULT[ks[i]]) return true; }
    return false;
  }
  /* ---- URL sync ---- */
  var suppressUrl = false;
  function readParams(p){
    p = p || {};
    Object.keys(F_DEFAULT).forEach(function(k){ F[k] = (p[k] !== undefined && p[k] !== null) ? String(p[k]) : F_DEFAULT[k]; });
    if(["feat","asc","desc","name","new","value"].indexOf(F.sort) === -1) F.sort = "feat";
    if(["all","single","sealed"].indexOf(F.type) === -1) F.type = "all";
  }
  function writeParams(){
    if(suppressUrl || TL.current !== "shop") return;
    var p = {}, cur = TL.route().params || {};
    Object.keys(F_DEFAULT).forEach(function(k){ if(F[k] !== F_DEFAULT[k]) p[k] = F[k]; });
    if(cur.item) p.item = cur.item;
    TL.setParams(p, {replace: true});
  }
  /* ---- UI sync ---- */
  function pressChips(sel, attr, val){
    $$(sel + " .chip").forEach(function(c){ c.setAttribute("aria-pressed", String(c.dataset[attr] === val)); });
  }
  function applyFilterUI(){
    pressChips("#gameChips", "game", F.game);
    pressChips("#typeChips", "type", F.type);
    pressChips("#condChips", "cond", F.cond);
    $$("#priceChips .chip").forEach(function(c){ c.setAttribute("aria-pressed", String(c.dataset.min === F.min && c.dataset.max === F.max)); });
    var rar = F.rarity ? F.rarity.split(",") : [];
    $$("#rarityChips .chip").forEach(function(c){ c.setAttribute("aria-pressed", String(rar.indexOf(c.dataset.rarity) > -1)); });
    var si = $("#shopSearch"); if(si && si.value !== F.q) si.value = F.q;
    var sc = $("#shopSearchClear"); if(sc) sc.hidden = !F.q;
    var so = $("#sortSel"); if(so) so.value = F.sort;
    var mn = $("#priceMin"), mx = $("#priceMax");
    if(mn && document.activeElement !== mn) mn.value = F.min;
    if(mx && document.activeElement !== mx) mx.value = F.max;
    var st = $("#stockOnly"); if(st) st.checked = F.all !== "1";
    var wc = $("#wishChip"); if(wc) wc.setAttribute("aria-pressed", String(F.wish === "1"));
    var rs = $("#resetFilters"); if(rs) rs.hidden = !filtersActive();
    var mc = $("#moreFiltersCount");
    if(mc){ var n = ["set","rarity","cond","all","min","max"].filter(function(k){ return F[k] !== F_DEFAULT[k]; }).length + (F.type !== "all" ? 1 : 0); mc.textContent = n ? String(n) : ""; }
    buildSetSelect();
    buildRarityChips();
  }
  function buildGameChips(){
    var INV = TL.inventory, counts = INV ? INV.gameCounts() : {}, wrap = $("#gameChips");
    if(!wrap) return;
    var total = 0; Object.keys(counts).forEach(function(k){ total += counts[k]; });
    var order = CORE_GAMES.concat(["lorcana", "other"]), html = '<button class="chip" data-game="all" aria-pressed="' + (F.game === "all") + '">All games <b>' + fmtInt(total) + '</b></button>';
    order.forEach(function(g){
      var n = counts[g] || 0;
      if(CORE_GAMES.indexOf(g) === -1 && !n && F.game !== g) return;
      html += '<button class="chip" data-game="' + g + '" aria-pressed="' + (F.game === g) + '"' + (!n ? ' data-empty="1"' : '') + '>' + esc(gameLabel(g)) + ' <b>' + fmtInt(n) + '</b></button>';
    });
    wrap.innerHTML = html;
    var INVc = INV ? INV.catalog() : [], sealed = 0, singles = 0;
    for(var i = 0; i < INVc.length; i++){ if(INVc[i].type === "sealed") sealed++; else singles++; }
    var tc = $("#typeChips");
    if(tc){
      tc.innerHTML = '<button class="chip" data-type="all" aria-pressed="' + (F.type === "all") + '">Everything</button>' +
        '<button class="chip" data-type="single" aria-pressed="' + (F.type === "single") + '">Singles <b>' + fmtInt(singles) + '</b></button>' +
        '<button class="chip" data-type="sealed" aria-pressed="' + (F.type === "sealed") + '"' + (!sealed ? " hidden" : "") + '>Sealed <b>' + fmtInt(sealed) + '</b></button>';
    }
  }
  function setsFor(game){
    var INV = TL.inventory, out = {}, i;
    if(INV && INV.summary && INV.summary.sets && !INV.loaded){
      var s = INV.summary.sets;
      Object.keys(s).forEach(function(g){
        var ng = (g === "pk" || g === "op" || g === "mtg" || g === "gundam" || g === "lorcana") ? g : "other";
        if(game !== "all" && ng !== game) return;
        (s[g] || []).forEach(function(x){ if(x && x.name){ out[ng] = out[ng] || []; out[ng].push({name: x.name, count: x.count || 0}); } });
      });
      return out;
    }
    var list = INV ? INV.catalog() : [], cnt = {};
    for(i = 0; i < list.length; i++){
      var it = list[i];
      if(game !== "all" && it.game !== game) continue;
      if(!it.set) continue;
      var key = it.game + "\u0000" + it.set;
      if(!cnt[key]) cnt[key] = {g: it.game, name: it.set, count: 0};
      cnt[key].count++;
    }
    Object.keys(cnt).forEach(function(k){ var c = cnt[k]; out[c.g] = out[c.g] || []; out[c.g].push({name: c.name, count: c.count}); });
    Object.keys(out).forEach(function(g){ out[g].sort(function(a, b){ return b.count - a.count || a.name.localeCompare(b.name); }); });
    return out;
  }
  function buildSetSelect(){
    var sel = $("#setSel"); if(!sel) return;
    var groups = setsFor(F.game), html = '<option value="">All sets</option>', found = !F.set;
    var order = CORE_GAMES.concat(["lorcana", "other"]).filter(function(g){ return groups[g] && groups[g].length; });
    order.forEach(function(g){
      var opts = groups[g].map(function(s){
        if(s.name === F.set) found = true;
        return '<option value="' + esc(s.name) + '">' + esc(s.name) + ' (' + fmtInt(s.count) + ')</option>';
      }).join("");
      html += (F.game === "all" && order.length > 1) ? '<optgroup label="' + esc(gameLabel(g)) + '">' + opts + '</optgroup>' : opts;
    });
    if(!found) html += '<option value="' + esc(F.set) + '">' + esc(F.set) + '</option>';
    sel.innerHTML = html;
    sel.value = F.set;
    var wrap = sel.closest(".set-wrap"); if(wrap) wrap.hidden = !order.length;
  }
  function buildRarityChips(){
    var row = $("#rarityRow"), wrap = $("#rarityChips"); if(!row || !wrap) return;
    var INV = TL.inventory, list = INV ? INV.catalog() : [], cnt = {}, any = false;
    for(var i = 0; i < list.length; i++){
      var it = list[i];
      if(!it.rarity) continue;
      if(F.game !== "all" && it.game !== F.game) continue;
      if(F.set && it.set !== F.set) continue;
      cnt[it.rarity] = (cnt[it.rarity] || 0) + 1; any = true;
    }
    if(!any){ row.hidden = true; wrap.innerHTML = ""; return; }
    var sel = F.rarity ? F.rarity.split(",") : [];
    var keys = Object.keys(cnt).sort(function(a, b){ return cnt[b] - cnt[a] || a.localeCompare(b); }).slice(0, 14);
    sel.forEach(function(r){ if(r && keys.indexOf(r) === -1) keys.push(r); });
    wrap.innerHTML = '<span class="chip-label">Rarity</span>' + keys.map(function(r){
      return '<button class="chip" type="button" data-rarity="' + esc(r) + '" aria-pressed="' + (sel.indexOf(r) > -1) + '">' + esc(r) + (cnt[r] ? ' <b>' + fmtInt(cnt[r]) + '</b>' : '') + '</button>';
    }).join("");
    row.hidden = false;
  }
  /* ---- rendering ---- */
  function shopBusy(on){ if(shopGrid) shopGrid.setAttribute("aria-busy", on ? "true" : "false"); }
  function updateStatus(){
    if(!shopStatus) return;
    var total = curList.length, txt;
    if(F.q) txt = fmtInt(total) + (total === 1 ? " result" : " results") + " for \u201c" + F.q + "\u201d";
    else txt = fmtInt(total) + (total === 1 ? " item" : " items");
    if(total > shownCount) txt += " \u00b7 showing " + fmtInt(shownCount);
    if(F.wish === "1") txt += " \u00b7 wishlist";
    shopStatus.textContent = txt;
    if(shopMore){
      var left = total - shownCount;
      shopMore.hidden = left <= 0;
      if(loadMoreBtn) loadMoreBtn.textContent = "Show " + Math.min(SHOP_PAGE, left) + " more \u00b7 " + fmtInt(left) + " left";
    }
  }
  function emptyMessage(){
    var INV = TL.inventory;
    if(F.wish === "1") return '<p class="cart-empty">Nothing on your wishlist yet \u2014 tap the heart on any card to save it.</p>';
    var note = (INV && INV.failed) ? " Live inventory is unavailable right now, so these are sample items." : "";
    return '<p class="cart-empty">Nothing matches \u2014 clear a filter, or call (513) 222-2573. The case moves fast.' + esc(note) + '</p>';
  }
  function renderShop(){
    if(!shopGrid) return;
    var INV = TL.inventory;
    if(INV && INV.loading && !INV.loaded){
      shopGrid.innerHTML = skeletons(8); shopBusy(true);
      if(shopStatus) shopStatus.textContent = "Loading the case\u2026";
      if(shopMore) shopMore.hidden = true;
      return;
    }
    curList = computeList();
    shownCount = Math.min(SHOP_PAGE, curList.length);
    autoLoads = 0;
    var terms = searchTerms(), html = "";
    for(var i = 0; i < shownCount; i++) html += prodCard(curList[i], {i: i, eager: i < 8, hl: terms});
    shopGrid.innerHTML = html || emptyMessage();
    shopBusy(false);
    if(INV && INV.failed) renderFailedNote();
    updateStatus();
    observeSentinel();
  }
  function appendPage(focusFirst){
    if(shownCount >= curList.length) return;
    var start = shownCount, end = Math.min(curList.length, start + SHOP_PAGE), terms = searchTerms(), html = "";
    for(var i = start; i < end; i++) html += prodCard(curList[i], {i: i - start, eager: false, hl: terms});
    shopGrid.insertAdjacentHTML("beforeend", html);
    shownCount = end;
    updateStatus();
    if(focusFirst && curList[start]){
      var first = shopGrid.querySelector('.prod[data-id="' + cssEsc(curList[start].id) + '"]');
      if(first) try { first.focus({preventScroll: false}); } catch(e){}
    }
  }
  function cssEsc(s){ return window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&"); }
  function renderFailedNote(){
    var f = $("#shopFresh"); if(!f) return;
    f.innerHTML = '<span class="dot crit"></span><span id="shopFreshText">Live inventory unavailable \u2014 showing sample items.</span> <button class="linklike" type="button" id="invRetry">Retry</button>';
  }
  var sentinelIO = null;
  function observeSentinel(){
    var s = $("#shopSentinel");
    if(!s || !("IntersectionObserver" in window)) return;
    if(!sentinelIO){
      sentinelIO = new IntersectionObserver(function(entries){
        for(var i = 0; i < entries.length; i++){
          if(!entries[i].isIntersecting) continue;
          if(TL.current !== "shop" || shownCount >= curList.length || autoLoads >= AUTO_PAGES) continue;
          autoLoads++;
          appendPage(false);
        }
      }, {rootMargin: "0px 0px 480px 0px"});
    }
    sentinelIO.observe(s);
  }
  function unobserveSentinel(){ var s = $("#shopSentinel"); if(sentinelIO && s) sentinelIO.unobserve(s); }
  /* ---- featured (home) ---- */
  var DEMO_FEATURED = ["pk2", "op2", "m2", "pk1", "op1", "m3", "pk7", "op6"];
  function featuredList(){
    var INV = TL.inventory, out = [], i;
    if(INV && INV.summary && INV.summary.topByGameItems){
      var g = INV.summary.topByGameItems, lists = [g.pk || [], g.op || [], g.mtg || []], seen = {};
      for(i = 0; out.length < 8 && i < 12; i++){
        for(var k = 0; k < lists.length && out.length < 8; k++){
          var it = lists[k][i];
          if(it && !seen[it.id]){ seen[it.id] = true; out.push(it); }
        }
      }
      if(out.length < 8) (INV.summary.topItems || []).forEach(function(it){ if(out.length < 8 && !seen[it.id]){ seen[it.id] = true; out.push(it); } });
      if(out.length) return out;
    }
    if(INV && INV.loaded){
      ensureFeatRank(INV.items);
      return INV.items.filter(function(it){ return it.stock > 0; }).sort(function(a, b){ return a._feat - b._feat; }).slice(0, 8);
    }
    DEMO_FEATURED.forEach(function(id){ var it = INV ? INV.byId(id) : null; if(it) out.push(it); });
    return out;
  }
  function renderFeatured(){
    var grid = $("#featuredGrid"); if(!grid) return;
    var INV = TL.inventory;
    if(INV && !INV.summary && !INV.loaded && !INV._summaryFailed && !INV.failed){
      grid.innerHTML = skeletons(8); grid.setAttribute("aria-busy", "true"); return;
    }
    var list = featuredList();
    grid.innerHTML = list.map(function(it, i){ return prodCard(it, {i: i, eager: true}); }).join("");
    grid.setAttribute("aria-busy", "false");
  }
  function renderFresh(){
    var INV = TL.inventory, home = $("#homeFresh"), shop = $("#shopFreshText"), sdot = $("#shopFresh .dot");
    if(!INV) return;
    if(INV.failed && !INV.summary){
      if(home) home.innerHTML = '<span class="dot warn"></span>Sample inventory \u00b7 the live case could not be reached <span class="demo-tag">demo data</span>';
      if(shop) renderFailedNote();
      return;
    }
    var gen = INV.generated || (INV.summary && INV.summary.generated);
    if(!gen){
      if(home) home.innerHTML = '<span class="dot"></span>Chase cards from the case <span class="demo-tag">demo data</span>';
      if(shop) shop.textContent = "Sample inventory \u00b7 demo data";
      return;
    }
    var fr = INV.freshness(gen), c = INV.counts || {};
    if(home) home.innerHTML = '<span class="dot ' + fr.cls + '"></span>Chase cards from the case \u00b7 live from our TCGplayer store \u00b7 ' + esc(fr.text);
    if(shop){
      shop.textContent = "Live from our TCGplayer store \u00b7 " + fmtInt(c.products || 0) + " products \u00b7 " + fmtInt(c.units || 0) + " cards in stock \u00b7 " + fr.text +
        (INV.failed ? " \u00b7 showing sample items until the full case loads" : "");
      if(sdot) sdot.className = "dot " + fr.cls;
    }
  }
  /* ---- add to cart (contract: TL.cart.add(item, qty, fromEl); legacy fallback while the cart module is old) ---- */
  function addToCart(it, qty, btn){
    if(!it) { toast("That card is no longer listed"); return false; }
    qty = Math.max(1, parseInt(qty, 10) || 1);
    if(TL.cart && typeof TL.cart.add === "function"){ TL.cart.add(it, qty, btn); return true; }
    if(typeof cart === "object" && cart && typeof renderCart === "function" && ITEMS.indexOf(it) > -1){
      var have = cart[it.id] || 0;
      if(have >= it.stock){ toast("That's all our stock of " + it.name); return false; }
      cart[it.id] = Math.min(it.stock, have + qty);
      renderCart();
      toast("Added " + it.name + " to cart");
      return true;
    }
    toast("Cart is warming up \u2014 buy it on TCGplayer for now");
    return false;
  }
  /* ---- holo tilt: delegated pointermove on the grids, fine pointers only, transform vars only ---- */
  var fineMQ = window.matchMedia ? window.matchMedia("(hover:hover) and (pointer:fine)") : {matches: false};
  var tiltCard = null, tiltEv = null, tiltRaf = 0;
  function clearTilt(card){
    if(!card) return;
    ["--rx", "--ry", "--mx", "--my", "--hyp"].forEach(function(v){ card.style.removeProperty(v); });
    card.classList.remove("tilting");
  }
  function tiltFrame(){
    tiltRaf = 0;
    if(!tiltCard || !tiltEv) return;
    var th = tiltCard.querySelector(".thumb"); if(!th) return;
    var r = th.getBoundingClientRect(); if(!r.width || !r.height) return;
    var x = TL.clamp((tiltEv.clientX - r.left) / r.width - .5, -.5, .5), y = TL.clamp((tiltEv.clientY - r.top) / r.height - .5, -.5, .5);
    var s = tiltCard.style;
    s.setProperty("--rx", (x * 10).toFixed(2) + "deg");
    s.setProperty("--ry", (-y * 8).toFixed(2) + "deg");
    s.setProperty("--mx", (50 + x * 100).toFixed(1) + "%");
    s.setProperty("--my", (50 + y * 100).toFixed(1) + "%");
    s.setProperty("--hyp", Math.min(1, Math.hypot(x, y) * 2).toFixed(3));
  }
  function onTiltLeave(e){ if(tiltCard === e.currentTarget){ clearTilt(tiltCard); tiltCard = null; tiltEv = null; } else clearTilt(e.currentTarget); }
  function onTiltMove(e){
    if(reduceMotion || !fineMQ.matches || document.hidden) return;
    var card = e.target.closest ? e.target.closest(".prod") : null;
    if(!card || card.classList.contains("skel")){ if(tiltCard){ clearTilt(tiltCard); tiltCard = null; } return; }
    if(card !== tiltCard){
      clearTilt(tiltCard);
      tiltCard = card; card.classList.add("tilting");
      card.addEventListener("pointerleave", onTiltLeave, {once: true});
    }
    tiltEv = e;
    if(!tiltRaf) tiltRaf = requestAnimationFrame(tiltFrame);
  }
  function bindTilt(el){ if(el && window.PointerEvent) el.addEventListener("pointermove", onTiltMove, {passive: true}); }
  /* ---- image load / error (delegated, capture: load and error do not bubble) ---- */
  document.addEventListener("load", function(e){
    var img = e.target;
    if(img && img.tagName === "IMG" && img.classList.contains("card-img")) img.classList.add("ok");
  }, true);
  document.addEventListener("error", function(e){
    var img = e.target;
    if(!img || img.tagName !== "IMG" || !img.classList.contains("card-img") || img.dataset.fallback) return;
    img.dataset.fallback = "1";
    var card = img.closest("[data-id]"), it = card && TL.inventory ? TL.inventory.byId(card.dataset.id) : null;
    var host = img.parentNode; if(!host) return;
    var wrap = document.createElement("span"); wrap.innerHTML = cardArt(it || {name: img.alt || "Card", set: "", game: "other"});
    var svg = wrap.firstChild;
    if(svg) host.replaceChild(svg, img); else img.style.visibility = "hidden";
  }, true);
  /* ---- events ---- */
  function qvFromEl(el){
    var card = el.closest("[data-id]"), id = card ? card.dataset.id : el.dataset.qv;
    var it = TL.inventory ? TL.inventory.byId(id) : null;
    if(!it) return;
    var inShop = card && shopGrid && shopGrid.contains(card);
    var list = inShop ? curList : (card && card.closest("#featuredGrid") ? featuredList() : null);
    TL.openQuickView(it, {list: list, from: card || el});
  }
  document.addEventListener("click", function(e){
    var t = e.target;
    if(!t || !t.closest) return;
    var cartBtn = t.closest("[data-cart]");
    if(cartBtn){
      var it = TL.inventory ? TL.inventory.byId(cartBtn.dataset.cart) : null;
      addToCart(it, 1, cartBtn);
      return;
    }
    if(t.closest("[data-wish]") || t.closest(".tcg-link")) return; /* wishlist module / plain link */
    var notify = t.closest("[data-notify]");
    if(notify){
      var ni = TL.inventory ? TL.inventory.byId(notify.dataset.notify) : null;
      if(ni) TL.openQuickView(ni, {list: curList, from: notify.closest(".prod") || notify, restock: true});
      return;
    }
    var thumb = t.closest(".thumb[data-qv], .prod h3");
    if(thumb && !thumb.closest(".skel")){ e.preventDefault(); qvFromEl(thumb); return; }
    if(t.closest("#loadMore")){ appendPage(true); return; }
    var mf = t.closest("#moreFilters");
    if(mf){ var tools = mf.closest(".shop-tools"), open = !tools.classList.contains("facets-open"); tools.classList.toggle("facets-open", open); mf.setAttribute("aria-expanded", String(open)); return; }
    if(t.closest("#resetFilters")){ readParams({}); applyFilterUI(); writeParams(); renderShop(); toast("Filters cleared"); return; }
    if(t.closest("#shopSearchClear")){ F.q = ""; applyFilterUI(); writeParams(); renderShop(); var si = $("#shopSearch"); if(si) si.focus(); return; }
    if(t.closest("#invRetry")){ if(TL.inventory){ TL.inventory.failed = false; TL.inventory.load(); renderShop(); } return; }
    var chip = t.closest("#gameChips .chip, #typeChips .chip, #condChips .chip, #priceChips .chip, #rarityChips .chip, #wishChip");
    if(chip){
      if(chip.id === "wishChip") F.wish = F.wish === "1" ? "" : "1";
      else if(chip.dataset.game !== undefined){ if(F.game !== chip.dataset.game){ F.game = chip.dataset.game; F.set = ""; F.rarity = ""; } }
      else if(chip.dataset.type !== undefined) F.type = chip.dataset.type;
      else if(chip.dataset.cond !== undefined) F.cond = chip.dataset.cond;
      else if(chip.dataset.rarity !== undefined){
        var rs = F.rarity ? F.rarity.split(",") : [], ix = rs.indexOf(chip.dataset.rarity);
        if(ix > -1) rs.splice(ix, 1); else rs.push(chip.dataset.rarity);
        F.rarity = rs.join(",");
      }
      else if(chip.dataset.min !== undefined){
        var same = F.min === chip.dataset.min && F.max === chip.dataset.max;
        F.min = same ? "" : chip.dataset.min; F.max = same ? "" : chip.dataset.max;
      }
      applyFilterUI(); writeParams(); renderShop();
      if(TL.inventory && !TL.inventory.loaded) TL.inventory.load();
    }
  });
  document.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var t = e.target;
    if(!t || !t.classList || !t.classList.contains("prod") || t.classList.contains("skel")) return;
    e.preventDefault();
    qvFromEl(t);
  });
  (function(){
    var si = $("#shopSearch");
    if(si){
      var run = TL.debounce(function(){
        var q = si.value.trim();
        if(q === F.q) return;
        F.q = q;
        var sc = $("#shopSearchClear"); if(sc) sc.hidden = !q;
        var rs = $("#resetFilters"); if(rs) rs.hidden = !filtersActive();
        writeParams(); renderShop();
      }, 160);
      si.addEventListener("input", function(){
        if(TL.inventory && !TL.inventory.loaded && !TL.inventory.loading) TL.inventory.load();
        run();
      });
      si.addEventListener("keydown", function(e){ if(e.key === "Escape" && si.value){ si.value = ""; run(); } });
    }
    var so = $("#sortSel"); if(so) so.addEventListener("change", function(){ F.sort = so.value; writeParams(); renderShop(); });
    var ss = $("#setSel"); if(ss) ss.addEventListener("change", function(){ F.set = ss.value; F.rarity = ""; applyFilterUI(); writeParams(); renderShop(); });
    var st = $("#stockOnly"); if(st) st.addEventListener("change", function(){ F.all = st.checked ? "" : "1"; applyFilterUI(); writeParams(); renderShop(); });
    var priceRun = TL.debounce(function(){
      var mn = $("#priceMin"), mx = $("#priceMax");
      F.min = mn && mn.value !== "" ? String(Math.max(0, parseFloat(mn.value) || 0)) : "";
      F.max = mx && mx.value !== "" ? String(Math.max(0, parseFloat(mx.value) || 0)) : "";
      applyFilterUI(); writeParams(); renderShop();
    }, 220);
    ["#priceMin", "#priceMax"].forEach(function(s){ var el = $(s); if(el) el.addEventListener("input", priceRun); });
    bindTilt(shopGrid); bindTilt($("#featuredGrid")); bindTilt($("#recentStrip"));
  })();
  if(fineMQ.addEventListener) fineMQ.addEventListener("change", function(){ if(tiltCard){ clearTilt(tiltCard); tiltCard = null; } });
  TL.on("motion:change", function(){ if(tiltCard){ clearTilt(tiltCard); tiltCard = null; } });
  /* ---- lifecycle ---- */
  TL.shop = {
    list: function(){ return curList; },
    filters: function(){ return F; },
    featured: featuredList,
    render: renderShop,
    setSearch: function(q){ F.q = String(q || ""); applyFilterUI(); writeParams(); renderShop(); }
  };
  function enterShop(params){
    readParams(params);
    buildGameChips(); applyFilterUI();
    var INV = TL.inventory;
    if(INV && !INV.loaded && !INV.failed) INV.load();
    renderShop(); renderFresh();
  }
  TL.on("view:change", function(d){
    if(!d || d.name !== "shop") return;
    enterShop(d.params);
  });
  TL.on("view:leave", function(d){ if(d && d.name === "shop") unobserveSentinel(); });
  TL.on("inventory:loading", function(){ if(TL.current === "shop") renderShop(); });
  TL.on("inventory:summary", function(){
    buildGameChips(); renderFeatured(); renderFresh();
    if(TL.current === "shop"){ applyFilterUI(); }
  });
  TL.on("inventory:summary-failed", function(){
    if(TL.inventory) TL.inventory._summaryFailed = true;
    renderFeatured(); renderFresh();
  });
  TL.on("inventory:loaded", function(){
    buildGameChips();
    if(TL.current === "shop"){ readParams(TL.route().params); applyFilterUI(); renderShop(); }
    if(!(TL.inventory && TL.inventory.summary)) renderFeatured();
    renderFresh();
  });
  TL.on("inventory:failed", function(){
    buildGameChips();
    if(TL.current === "shop"){ applyFilterUI(); renderShop(); }
    renderFeatured(); renderFresh();
  });
  TL.on("wishlist:change", function(){
    if(TL.current === "shop" && F.wish === "1") renderShop();
  });
  TL.on("init", function(){
    /* the router's own init handler already emitted view:change for a #/shop landing */
    if(TL.current !== "shop"){ buildGameChips(); renderFresh(); }
    renderFeatured();
  });
