  /* ---------- wishlist + recently viewed ----------
       TL.wishlist.ids() / has(id) / toggle(id, el) / add(id) / remove(id) / count() / items()
       TL.recent.ids() / push(id) / clear() / items()
     Both are localStorage lists of item ids (TL.store "wish" / "recent"), resolved against
     TL.inventory.byId at render time — an id that is no longer listed simply drops out.
     Emits 'wishlist:change' {ids} and 'recent:change' {ids}. */
  function storedIds(key){
    var v = TL.store.get(key, []);
    return Array.isArray(v) ? v.filter(function(x){ return typeof x === "string" && x; }) : [];
  }
  var wishIds = storedIds("wish"), recentIds = storedIds("recent");
  var RECENT_MAX = 8;
  function wishSave(){ TL.store.set("wish", wishIds); TL.emit("wishlist:change", {ids: wishIds.slice()}); }
  function resolveIds(ids){
    var out = [];
    ids.forEach(function(id){ var it = TL.inventory ? TL.inventory.byId(id) : null; if(it) out.push(it); });
    return out;
  }
  TL.wishlist = {
    ids: function(){ return wishIds.slice(); },
    has: function(id){ return wishIds.indexOf(String(id)) > -1; },
    count: function(){ return wishIds.length; },
    items: function(){ return resolveIds(wishIds); },
    add: function(id){ id = String(id); if(wishIds.indexOf(id) === -1){ wishIds.push(id); wishSave(); } },
    remove: function(id){ var i = wishIds.indexOf(String(id)); if(i > -1){ wishIds.splice(i, 1); wishSave(); } },
    toggle: function(id, el){
      id = String(id);
      var on = wishIds.indexOf(id) === -1;
      if(on) wishIds.push(id); else wishIds.splice(wishIds.indexOf(id), 1);
      wishSave();
      var it = TL.inventory ? TL.inventory.byId(id) : null;
      toast(on ? "Saved " + (it ? it.name : "card") + " to your wishlist" : "Removed from your wishlist");
      if(el && on && !reduceMotion){ el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
      return on;
    }
  };
  function syncHearts(){
    var n = wishIds.length;
    $$("[data-wish]").forEach(function(b){
      var on = wishIds.indexOf(b.dataset.wish) > -1;
      b.setAttribute("aria-pressed", String(on));
      var it = TL.inventory ? TL.inventory.byId(b.dataset.wish) : null, nm = it ? it.name : "this card";
      b.setAttribute("aria-label", (on ? "Remove " : "Save ") + nm + (on ? " from" : " to") + " your wishlist");
    });
    var c = $("#wishChipCount"); if(c) c.textContent = fmtInt(n);
    var chip = $("#wishChip"); if(chip) chip.classList.toggle("has-items", n > 0);
  }
  document.addEventListener("click", function(e){
    var b = e.target.closest ? e.target.closest("[data-wish]") : null;
    if(!b) return;
    e.preventDefault(); e.stopPropagation();
    TL.wishlist.toggle(b.dataset.wish, b);
  });
  TL.on("wishlist:change", syncHearts);
  /* ---- recently viewed ---- */
  function recentSave(){ TL.store.set("recent", recentIds); TL.emit("recent:change", {ids: recentIds.slice()}); }
  TL.recent = {
    ids: function(){ return recentIds.slice(); },
    items: function(){ return resolveIds(recentIds); },
    push: function(id){
      id = String(id);
      var i = recentIds.indexOf(id); if(i > -1) recentIds.splice(i, 1);
      recentIds.unshift(id);
      if(recentIds.length > RECENT_MAX) recentIds.length = RECENT_MAX;
      recentSave();
    },
    clear: function(){ recentIds = []; recentSave(); }
  };
  function recentTile(it){
    var art = (it.tcg && it.img)
      ? '<img class="card-img" src="' + esc(it.img) + '" alt="" width="48" height="67" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
      : cardArt(it);
    return '<button class="rv-tile" type="button" data-qv="' + esc(it.id) + '" aria-label="Quick view: ' + esc(it.name) + '">' +
      '<span class="rv-thumb">' + art + '</span><span class="rv-meta"><b>' + esc(it.name) + '</b><span>' + money(it.price) + '</span></span></button>';
  }
  function renderRecent(){
    var row = $("#recentRow"), strip = $("#recentStrip"); if(!row || !strip) return;
    var items = TL.recent.items();
    if(!items.length){ row.hidden = true; strip.innerHTML = ""; return; }
    strip.innerHTML = items.map(recentTile).join("");
    row.hidden = false;
  }
  document.addEventListener("click", function(e){
    var t = e.target;
    if(!t || !t.closest) return;
    if(t.closest("#recentClear")){ TL.recent.clear(); toast("Recently viewed cleared"); return; }
    var tile = t.closest(".rv-tile[data-qv]");
    if(tile){
      var it = TL.inventory ? TL.inventory.byId(tile.dataset.qv) : null;
      if(it) TL.openQuickView(it, {list: TL.recent.items(), from: tile});
    }
  });
  TL.on("recent:change", function(){ if(TL.current === "shop") renderRecent(); });
  TL.on("view:change", function(d){ if(d && d.name === "shop"){ renderRecent(); syncHearts(); } });
  TL.on("inventory:loaded", function(){ if(TL.current === "shop") renderRecent(); syncHearts(); });
  TL.on("inventory:summary", syncHearts);
  TL.on("init", syncHearts);
