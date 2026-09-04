  /* ---------- product rendering ---------- */
  function stockLabel(it){
    if(it.stock <= 0) return '<span class="stock out">Sold out</span>';
    if(it.stock <= 1) return '<span class="stock low">Last one</span>';
    if(it.stock <= 2) return '<span class="stock low">' + it.stock + ' left</span>';
    return '<span class="stock">' + it.stock + ' in stock</span>';
  }
  function esc(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  TL.esc = esc;
  var ART = {
    pk:{a:"#3A6EA8", b:"#16202F", label:"POKEMON",
        em:'<path d="M125 92 L96 158 h22 l-14 60 l50 -76 h-25 l21 -50 z" fill="#F5C542"/>'},
    op:{a:"#8E3227", b:"#231314", label:"ONE PIECE",
        em:'<path d="M95 166 a30 28 0 0 1 60 0 z" fill="#E8C97A"/><rect x="97" y="152" width="56" height="11" fill="#D94A3D"/><ellipse cx="125" cy="168" rx="56" ry="12" fill="#E8C97A"/>'},
    mtg:{a:"#57432A", b:"#1E1911", label:"MAGIC",
        em:'<path d="M125 98 L172 132 L154 190 L96 190 L78 132 Z" fill="none" stroke="#C08A3E" stroke-width="5"/><path d="M125 120 L152 140 L142 172 L108 172 L98 140 Z" fill="#C08A3E" opacity=".85"/>'}
  };
  function boxArt(){
    return '<g><rect x="75" y="80" width="100" height="120" rx="5" fill="rgba(255,255,255,.92)"/>' +
      '<rect x="75" y="80" width="100" height="26" rx="5" fill="rgba(0,0,0,.45)"/>' +
      '<path d="M75 200 L125 222 L175 200 Z" fill="rgba(255,255,255,.55)"/>' +
      '<path d="M125 106 v94" stroke="rgba(0,0,0,.25)" stroke-width="2"/>' +
      '<path d="M90 130 h70 M90 150 h70 M90 170 h44" stroke="rgba(0,0,0,.28)" stroke-width="5" stroke-linecap="round"/></g>';
  }
  var IMG_KEY = {pk1:"pk-charizard151", pk2:"pk-pikachuhat", pk3:"pk-tatsugiri", pk4:"pk-iono", pk5:"pk-roaringmoon", op1:"op-shanks-op09", op2:"op-luffy-op05", op3:"op-boa-op07", op4:"op-law-op01", m1:"mtg-ragavan", m2:"mtg-sheoldred", m3:"mtg-onering", m4:"mtg-bowmasters"};
  function cardArt(it){
    var key = IMG_KEY[it.id];
    if(key && window.CARD_IMG && window.CARD_IMG[key]){
      return '<img class="card-img" src="' + window.CARD_IMG[key] + '" alt="' + esc(it.name) + '">';
    }
    var a = ART[it.game];
    var gid = "cg-" + it.id;
    var name = it.name.length > 24 ? it.name.slice(0, 23) + "…" : it.name;
    var set = it.set.length > 32 ? it.set.slice(0, 31) + "…" : it.set;
    return '<svg viewBox="0 0 250 350" role="img" aria-label="' + esc(it.name) + ' card art placeholder" preserveAspectRatio="xMidYMid slice">' +
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
  function prodCard(it){
    var art = (it.tcg && it.img)
      ? '<img class="card-img" loading="lazy" src="' + it.img + '" alt="' + esc(it.name) + '" onerror="this.style.display=\'none\'">'
      : cardArt(it);
    var mini = '<div class="mini">' + art + '<span class="holo-hover"></span></div>';
    var cond = it.cond ? '<span class="cond">' + esc(it.cond) + "</span>" : "";
    var action = it.tcg
      ? '<a class="add" href="' + it.url + '" target="_blank" rel="noopener noreferrer">Buy on TCGplayer</a>'
      : '<button class="add" data-add="' + it.id + '"' + (it.stock <= 0 ? " disabled" : "") + ">" +
        (it.stock <= 0 ? "Sold out" : "Add to cart") + "</button>";
    return '<article class="prod">' +
      '<div class="thumb">' + mini + cond + "</div>" +
      '<div class="p-meta"><h3>' + esc(it.name) + "</h3>" +
      '<p class="p-set">' + esc(it.lineName || GAMES[it.game] || "TCG") + " \u00b7 " + esc(it.set) + "</p>" +
      '<div class="p-row"><span class="price">' + money(it.price) + "</span>" + stockLabel(it) + "</div>" +
      action + "</div></article>";
  }

  var filterGame = "all", filterType = "all", sortMode = "feat", searchQ = "", pageCount = 1;
  var SHOP_PAGE = 24;
  function activeList(){
    var src = LIVE ? LIVE.items : ITEMS;
    return src.filter(function(it){
      if(it.live) return false;
      if(filterGame !== "all" && it.game !== filterGame) return false;
      if(filterType !== "all" && it.type !== filterType) return false;
      if(searchQ){
        var hay = (it.name + " " + it.set + " " + (it.lineName || "")).toLowerCase();
        var terms = searchQ.split(/\s+/);
        for(var t = 0; t < terms.length; t++){
          if(terms[t] && hay.indexOf(terms[t]) === -1) return false;
        }
      }
      return true;
    });
  }
  function renderShop(){
    var list = activeList();
    if(sortMode === "asc") list = list.slice().sort(function(a,b){ return a.price - b.price; });
    if(sortMode === "desc") list = list.slice().sort(function(a,b){ return b.price - a.price; });
    $("#shopCount").textContent = list.length;
    var shown = list.slice(0, SHOP_PAGE * pageCount);
    var more = list.length > shown.length
      ? '<button class="add" id="loadMore" type="button" style="grid-column:1/-1; padding:13px 0;">Show 24 more \u00b7 ' + (list.length - shown.length) + ' left</button>'
      : "";
    $("#shopGrid").innerHTML = (shown.map(prodCard).join("") ||
      '<p class="cart-empty">Nothing matches &mdash; clear a filter, or call (513) 222-2573. The case moves fast.</p>') + more;
  }
  function renderFeatured(){
    var feat = [ITEMS[1], ITEMS[9], ITEMS[16], ITEMS[6]];
    $("#featuredGrid").innerHTML = feat.map(prodCard).join("");
  }
  TL.on("init", function(){ renderShop(); renderFeatured(); });
