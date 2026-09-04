  /* ---------- live TCGplayer inventory ---------- */
  var LIVE = null;
  var COND_ABBR = {"Near Mint":"NM","Lightly Played":"LP","Moderately Played":"MP","Heavily Played":"HP","Damaged":"DMG","Unopened":"SEALED"};
  function liveType(name){
    return /booster box|elite trainer|booster bundle|collection box|booster display|booster pack|premium collection|box set|blister|tin\b/i.test(name) ? "sealed" : "single";
  }
  function liveToItem(p){
    var ls = p.listings || [];
    var best = ls[0];
    var qty = 0;
    for(var i = 0; i < ls.length; i++){
      qty += ls[i].qty;
      if(ls[i].price < best.price) best = ls[i];
    }
    var cond = COND_ABBR[best.cond] || best.cond || null;
    if(cond && best.printing && /reverse/i.test(best.printing)) cond += " \u00b7 RH";
    else if(cond && best.printing === "Foil") cond += " \u00b7 Foil";
    return {
      id: "tcg-" + p.id, name: p.name,
      set: p.set + (p.rarity ? " \u00b7 " + p.rarity : ""),
      lineName: p.line,
      game: (p.game === "pk" || p.game === "op" || p.game === "mtg") ? p.game : "other",
      type: liveType(p.name + " " + (p.set || "")),
      cond: cond, price: best.price, stock: qty, tcg: true,
      img: "https://tcgplayer-cdn.tcgplayer.com/product/" + p.id + "_in_400x400.jpg",
      url: "https://www.tcgplayer.com/product/" + p.id + "?seller=5c356cdf"
    };
  }
  function initLiveInventory(){
    if(!window.fetch) return;
    fetch("inventory.json", {cache: "no-store"}).then(function(r){
      if(!r.ok) throw new Error("no inventory");
      return r.json();
    }).then(function(d){
      if(!d || !d.items || !d.items.length) return;
      var items = [];
      for(var i = 0; i < d.items.length; i++) items.push(liveToItem(d.items[i]));
      LIVE = { items: items, generated: d.generated };
      pageCount = 1;
      var gen = (d.generated || "").slice(0, 10);
      $("#shopFresh").innerHTML = '<span class="dot"></span>Live inventory \u00b7 <span id="shopCount">' + d.products +
        '</span> results \u00b7 ' + d.units + ' cards in stock \u00b7 synced ' + gen + ' from our TCGplayer store';
      $("#homeFresh").innerHTML = '<span class="dot"></span>The priciest pulls in the case right now \u00b7 live from our TCGplayer store';
      var oc = $("#otherChip"); if(oc) oc.hidden = false;
      var top = items.slice().sort(function(a,b){ return b.price - a.price; }).slice(0, 4);
      $("#featuredGrid").innerHTML = top.map(prodCard).join("");
      renderShop();
    }).catch(function(){ /* offline or demo host: embedded demo data stays */ });
  }
  document.addEventListener("click", function(e){
    var lm = e.target.closest("#loadMore");
    if(lm){ pageCount++; renderShop(); }
  });
  (function(){
    var deb = null;
    var si = $("#shopSearch");
    if(!si) return;
    si.addEventListener("input", function(){
      clearTimeout(deb);
      deb = setTimeout(function(){
        searchQ = si.value.trim().toLowerCase();
        pageCount = 1;
        renderShop();
      }, 160);
    });
  })();

  $$("#gameChips .chip").forEach(function(ch){
    ch.addEventListener("click", function(){
      filterGame = ch.dataset.game;
      $$("#gameChips .chip").forEach(function(c){ c.setAttribute("aria-pressed", String(c === ch)); });
      pageCount = 1;
      renderShop();
    });
  });
  $$("#typeChips .chip").forEach(function(ch){
    ch.addEventListener("click", function(){
      filterType = ch.dataset.type;
      $$("#typeChips .chip").forEach(function(c){ c.setAttribute("aria-pressed", String(c === ch)); });
      pageCount = 1;
      renderShop();
    });
  });
  $("#sortSel").addEventListener("change", function(e){ sortMode = e.target.value; pageCount = 1; renderShop(); });
  TL.on("init", initLiveInventory);
