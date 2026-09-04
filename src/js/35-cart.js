  /* ---------- cart & checkout ----------
     TL.cart = { add(item, qty, fromEl), remove(id), setQty(id, n), lines(), count(), total(),
                 subtotal(), shipping(), has(id), qty(id), fulfillment(), open(), close(),
                 isOpen(), clear(), checkout(), render() }
     Storage: TL.store "cart" = {id: {qty, item}} — the item is a snapshot, so TCGplayer items,
     demo items and live break spots all resolve without inventory being loaded. Price/stock
     refresh from TL.inventory.byId (when that module exists) on every render and on
     'inventory:loaded'; ids starting "tcg-" that vanish from a loaded inventory are dropped.
     Events: TL 'cart:change' {qty, total, subtotal, shipping, lines, reason, added, removed,
     changed} — reason ∈ add|qty|remove|clear|checkout|options|sync — plus the same detail on
     the DOM event 'tl:cart-changed'; [data-add] clicks also dispatch 'tl:cart-add'
     {id, sourceEl, item} for the fly-to-cart motion. A removed 'live-spot-*' id shows up in
     `removed` so the live page can release the claim (reason 'checkout' means it was bought).
     Checkout: POST /checkout {lines, fulfillment, email, note} → {url} redirects to Square;
     {mock} shows the in-drawer confirmation; offline (or an API without the route yet) shows
     the same confirmation labelled demo. Any other error becomes a retry state.
     Kept for other modules: var cart, renderCart(), openCart(), closeCart(), cartQty(). */
  var cart = {}; // id -> {qty, item}
  var lastCartQty = 0;
  var drawer = $("#drawer"), overlay = $("#overlay");
  var CART_SHIP_SINGLES = 4.99, CART_SHIP_SEALED = 9.99, CART_MAX_QTY = 20;
  var cartOpts = cartLoadOpts();
  var cartTrapRelease = null, cartBusy = false, cartBusyWatch = null, cartDoneShown = false;
  var cartAddedTimer = null, cartEmptyTimer = null, cartOptsTimer = null;

  /* ---- options (fulfillment / email / note) persist alongside the cart ---- */
  function cartLoadOpts(){
    var o = TL.store.get("cart-opts", null);
    if(!o || typeof o !== "object") o = {};
    return {
      fulfillment: o.fulfillment === "ship" ? "ship" : "pickup",
      email: typeof o.email === "string" ? o.email.slice(0, 120) : "",
      note: typeof o.note === "string" ? o.note.slice(0, 200) : ""
    };
  }
  function cartSaveOpts(){ TL.store.set("cart-opts", cartOpts); }

  /* ---- item helpers ---- */
  function cartIsLive(it){ return !!(it && (it.live || String(it.id).indexOf("live-spot-") === 0)); }
  function cartGameLabel(it){ return it.lineName || (TL.GAMES && TL.GAMES[it.game]) || "TCG"; }
  function cartMax(it){ return Math.max(0, Math.min(Number(it.stock) || 0, CART_MAX_QTY)); }
  function cartSnap(it){
    if(!it || typeof it !== "object" || it.id === undefined || it.id === null) return null;
    var price = Number(it.price), stock = Number(it.stock);
    return {
      id: String(it.id), name: String(it.name || "Item").slice(0, 160), set: String(it.set || "").slice(0, 160),
      lineName: it.lineName ? String(it.lineName).slice(0, 60) : "", game: String(it.game || "other"),
      type: it.type === "sealed" ? "sealed" : "single", cond: it.cond ? String(it.cond).slice(0, 24) : null,
      price: isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : 0,
      stock: isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0,
      tcg: !!it.tcg, img: it.img ? String(it.img) : "", url: it.url ? String(it.url) : "",
      live: !!it.live || String(it.id).indexOf("live-spot-") === 0
    };
  }
  /* Looks an id up in whatever catalog is around: TL.inventory (shop module), the live
     inventory array (older shop code) and the demo ITEMS. Never throws. */
  function cartFind(id){
    id = String(id);
    var it = null, i, arr;
    try { if(TL.inventory && typeof TL.inventory.byId === "function") it = TL.inventory.byId(id) || null; } catch(e){ it = null; }
    if(!it && typeof LIVE !== "undefined" && LIVE && LIVE.items){
      arr = LIVE.items;
      for(i = 0; i < arr.length; i++){ if(arr[i] && String(arr[i].id) === id){ it = arr[i]; break; } }
    }
    if(!it){
      arr = TL.ITEMS || [];
      for(i = 0; i < arr.length; i++){ if(arr[i] && String(arr[i].id) === id){ it = arr[i]; break; } }
    }
    return it || null;
  }

  /* ---- storage ---- */
  function cartLoad(){
    var raw = TL.store.get("cart", null), out = {};
    if(raw && typeof raw === "object" && !Array.isArray(raw)){
      Object.keys(raw).forEach(function(id){
        var v = raw[id], qty, snap = null;
        if(typeof v === "number"){ qty = v; snap = cartSnap(cartFind(id)); }
        else if(v && typeof v === "object"){ qty = Number(v.qty); snap = cartSnap(v.item); }
        if(!snap || !isFinite(qty) || qty < 1) return;
        snap.id = id;
        out[id] = {qty: Math.max(1, Math.min(Math.floor(qty), CART_MAX_QTY)), item: snap};
      });
    }
    cart = out;
  }
  function cartSave(){ TL.store.set("cart", cart); }
  /* Older modules write cart[id] = <number>; turn those into {qty, item} entries. */
  function cartNormalize(){
    var dirty = false;
    Object.keys(cart).forEach(function(id){
      var v = cart[id];
      if(v && typeof v === "object" && v.item && typeof v.qty === "number" && v.qty >= 1) return;
      var qty = typeof v === "number" ? v : (v && Number(v.qty)) || 0;
      var snap = cartSnap(v && typeof v === "object" && v.item ? v.item : cartFind(id));
      dirty = true;
      if(!snap || !isFinite(qty) || qty < 1){ delete cart[id]; return; }
      snap.id = id;
      cart[id] = {qty: Math.min(Math.floor(qty), CART_MAX_QTY), item: snap};
    });
    return dirty;
  }
  /* Refresh price/stock/art from the live catalog; clamp quantities that no longer fit. */
  function cartRefreshSnaps(){
    var dirty = false;
    Object.keys(cart).forEach(function(id){
      var e = cart[id], f = cartFind(id);
      if(!e || !f) return;
      var s = cartSnap(f); if(!s) return;
      s.id = id;
      if(e.item.price !== s.price || e.item.stock !== s.stock || e.item.img !== s.img || e.item.cond !== s.cond || e.item.name !== s.name){ e.item = s; dirty = true; }
      var max = cartMax(e.item);
      if(max > 0 && e.qty > max){ e.qty = max; dirty = true; }
    });
    return dirty;
  }

  /* ---- aggregates ---- */
  function cartLines(){ return Object.keys(cart).map(function(id){ return {item: cart[id].item, qty: cart[id].qty}; }); }
  function cartQty(){ return Object.keys(cart).reduce(function(n, k){ return n + (cart[k] && cart[k].qty || 0); }, 0); }
  function cartSubtotal(){ return Math.round(cartLines().reduce(function(n, l){ return n + l.item.price * l.qty; }, 0) * 100) / 100; }
  function cartShipQuote(lines){
    var sealed = false, any = false;
    (lines || cartLines()).forEach(function(l){ if(cartIsLive(l.item)) return; any = true; if(l.item.type === "sealed") sealed = true; });
    if(!any) return 0;
    return sealed ? CART_SHIP_SEALED : CART_SHIP_SINGLES;
  }
  function cartShipping(){ return cartOpts.fulfillment === "ship" ? cartShipQuote() : 0; }
  function cartTotal(){ return Math.round((cartSubtotal() + cartShipping()) * 100) / 100; }

  /* ---- events ---- */
  function cartEmit(reason, diff){
    diff = diff || {};
    var payload = {
      qty: cartQty(), total: cartTotal(), subtotal: cartSubtotal(), shipping: cartShipping(), lines: cartLines(),
      reason: reason || "change", added: diff.added || [], removed: diff.removed || [], changed: diff.changed || []
    };
    TL.emit("cart:change", payload);
    try { document.dispatchEvent(new CustomEvent("tl:cart-changed", {detail: payload})); } catch(e){}
  }
  function cartCommit(reason, diff){ cartSave(); renderCart(diff); cartEmit(reason, diff); }
  function cartAnnounce(msg){
    var el = $("#cartLive"); if(!el) return;
    el.textContent = "";
    setTimeout(function(){ el.textContent = msg; }, 40);
  }

  /* ---- mutations (TL.cart) ---- */
  function cartAdd(item, qty, fromEl){
    var snap = cartSnap(item);
    if(!snap){ toast("Couldn't add that one — try again"); return 0; }
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    var cur = cart[snap.id], have = cur ? cur.qty : 0, max = cartMax(snap);
    if(snap.stock <= 0){ toast("Sold out — " + snap.name); return 0; }
    if(have >= max){ toast("That's all we have of " + snap.name); return 0; }
    var n = Math.min(have + qty, max), added = n - have;
    if(n < have + qty) toast("That's all we have — " + n + " of " + snap.name + " in your cart");
    cart[snap.id] = {qty: n, item: snap};
    cartCommit(have ? "qty" : "add", have ? {changed: [snap.id]} : {added: [snap.id]});
    var btn = $("#cartBtn");
    if(fromEl){
      try { document.dispatchEvent(new CustomEvent("tl:cart-add", {detail: {id: snap.id, sourceEl: fromEl, item: snap}})); } catch(e){}
      if(btn) try { TL.flyTo(fromEl, btn, {img: snap.img}); } catch(e){}
    }
    cartAddedPill(snap);
    var q = cartQty();
    cartAnnounce(snap.name + " added. " + q + (q === 1 ? " item" : " items") + ", " + money(cartSubtotal()) + " subtotal.");
    return added;
  }
  function cartSetQty(id, n){
    id = String(id);
    var e = cart[id]; if(!e) return 0;
    n = Math.floor(Number(n));
    if(!isFinite(n)) return e.qty;
    if(n <= 0){ cartRemove(id); return 0; }
    var max = cartMax(e.item);
    if(max <= 0){ toast("Sold out — " + e.item.name); return e.qty; }
    if(n > max){ toast("That's all we have of " + e.item.name); n = max; }
    if(n === e.qty) return n;
    e.qty = n;
    cartCommit("qty", {changed: [id]});
    cartAnnounce(e.item.name + ": quantity " + n + ".");
    return n;
  }
  function cartRemove(id){
    id = String(id);
    var e = cart[id]; if(!e) return false;
    delete cart[id];
    cartCommit("remove", {removed: [id]});
    cartAnnounce(e.item.name + " removed." + (cartQty() ? "" : " Cart is empty."));
    return true;
  }
  function cartClear(reason){
    var ids = Object.keys(cart);
    if(!ids.length) return;
    cart = {};
    cartCommit(reason || "clear", {removed: ids});
    cartAnnounce("Cart emptied.");
  }

  /* ---- rendering ---- */
  function cartThumb(it){
    var fb = "";
    if(!cartIsLive(it) && typeof cardArt === "function" && typeof ART !== "undefined" && ART && ART[it.game]){
      try { fb = cardArt(it); } catch(e){ fb = ""; }
    }
    if(!fb) fb = '<span class="ct-ph" aria-hidden="true">' + esc(cartIsLive(it) ? "LIVE" : (it.game || "TL").slice(0, 3).toUpperCase()) + "</span>";
    var img = it.img ? '<img src="' + esc(it.img) + '" alt="" loading="lazy" decoding="async">' : "";
    return '<div class="ct-art' + (img ? "" : " noimg") + '">' + img + '<div class="ct-fb">' + fb + "</div></div>";
  }
  function cartStockHint(it, q){
    if(it.stock <= 0) return "Sold out";
    if(cartIsLive(it)) return "";
    if(q >= it.stock) return it.stock === 1 ? "Last one" : "All " + it.stock + " in your cart";
    if(it.stock <= 3) return it.stock + " left";
    return "";
  }
  function cartLinePrice(it, q){
    return money(it.price * q) + (q > 1 ? "<small>" + q + " × " + money(it.price) + "</small>" : "");
  }
  function cartLineInner(l){
    var it = l.item, q = l.qty, live = cartIsLive(it), name = esc(it.name), idA = esc(it.id);
    var meta = live ? "Live break · rip & ship" : cartGameLabel(it) + (it.set ? " · " + it.set : "");
    var hint = cartStockHint(it, q), tags = "";
    if(live) tags += '<i class="ct-live">Live</i>';
    else if(it.cond) tags += '<i class="ct-cond">' + esc(it.cond) + "</i>";
    else if(it.type === "sealed") tags += '<i class="ct-cond">Sealed</i>';
    tags += '<i class="ct-stock' + (it.stock <= 0 ? " out" : "") + '"' + (hint ? "" : " hidden") + ">" + esc(hint) + "</i>";
    return cartThumb(it) +
      '<div class="ct"><b class="ct-name">' + name + '</b><span class="ct-meta">' + esc(meta) + '</span><span class="ct-tags">' + tags + "</span></div>" +
      '<span class="lp">' + cartLinePrice(it, q) + "</span>" +
      '<div class="ct-ctrl"><div class="qty" role="group" aria-label="Quantity of ' + name + '">' +
        '<button type="button" data-dec="' + idA + '" aria-label="' + (q > 1 ? "Remove one " : "Remove ") + name + '">&minus;</button>' +
        '<span class="qty-n">' + q + "</span>" +
        '<button type="button" data-inc="' + idA + '" aria-label="Add one ' + name + '"' + (q >= cartMax(it) ? " disabled" : "") + ">+</button></div>" +
      '<button type="button" class="ct-rm" data-rm="' + idA + '" aria-label="Remove ' + name + ' from cart">Remove</button></div>';
  }
  function cartLineEl(l){
    var li = document.createElement("li");
    li.className = "cart-line" + (l.item.stock <= 0 ? " soldout" : "");
    li.setAttribute("data-id", l.item.id);
    li.innerHTML = cartLineInner(l);
    return li;
  }
  function cartLineUpdate(li, l){
    var it = l.item, q = l.qty;
    var qn = li.querySelector(".qty-n");
    if(qn && qn.textContent !== String(q)){
      qn.textContent = q;
      if(!reduceMotion){ qn.classList.remove("pop"); void qn.offsetWidth; qn.classList.add("pop"); }
    }
    var lp = li.querySelector(".lp"); if(lp) lp.innerHTML = cartLinePrice(it, q);
    var inc = li.querySelector("[data-inc]"); if(inc) inc.disabled = q >= cartMax(it);
    var dec = li.querySelector("[data-dec]"); if(dec) dec.setAttribute("aria-label", (q > 1 ? "Remove one " : "Remove ") + it.name);
    var st = li.querySelector(".ct-stock"), hint = cartStockHint(it, q);
    if(st){ st.textContent = hint; st.hidden = !hint; st.classList.toggle("out", it.stock <= 0); }
    var nm = li.querySelector(".ct-name"); if(nm && nm.textContent !== it.name) nm.textContent = it.name;
    li.classList.toggle("soldout", it.stock <= 0);
  }
  function cartRemoveLine(li){
    if(!li || !li.parentNode) return;
    if(reduceMotion || !drawer.classList.contains("open")){ li.parentNode.removeChild(li); return; }
    li.classList.add("leaving");
    li.setAttribute("aria-hidden", "true");
    var done = false;
    function fin(){ if(done) return; done = true; if(li.parentNode) li.parentNode.removeChild(li); }
    li.addEventListener("animationend", fin);
    setTimeout(fin, 320);
  }
  function cartRenderEmpty(){
    $("#cartBody").innerHTML = '<div class="cart-empty"><span>Your cart is empty &mdash; go pull some hits.</span>' +
      '<button type="button" class="btn btn-ghost cart-browse" data-go="shop">Browse the case</button></div>';
  }
  function cartRenderLines(body, lines){
    var list = body.querySelector("ul.cart-lines");
    if(!list){ body.innerHTML = '<ul class="cart-lines" role="list"></ul>'; list = body.querySelector("ul.cart-lines"); }
    var have = {};
    $$(".cart-line", list).forEach(function(li){
      if(li.classList.contains("leaving")) return;
      var id = li.getAttribute("data-id");
      if(cart[id]) have[id] = li; else cartRemoveLine(li);
    });
    var prev = null;
    lines.forEach(function(l){
      var id = l.item.id, li = have[id];
      if(!li){
        li = cartLineEl(l);
        if(!reduceMotion && drawer.classList.contains("open") && !drawer.classList.contains("opening")){
          li.classList.add("is-new");
          setTimeout(function(){ li.classList.remove("is-new"); }, 500);
        }
        if(prev){ if(prev.nextSibling) list.insertBefore(li, prev.nextSibling); else list.appendChild(li); }
        else list.insertBefore(li, list.firstChild);
      } else cartLineUpdate(li, l);
      prev = li;
    });
  }
  function cartCheckoutLabel(){ return TL.api.online ? "Checkout with Square" : "Checkout · demo"; }
  function cartRenderSums(lines){
    var sub = cartSubtotal(), ship = cartShipping(), tot = Math.round((sub + ship) * 100) / 100;
    var shipping = cartOpts.fulfillment === "ship", quote = cartShipQuote(lines);
    $("#cartSubtotal").textContent = money(sub);
    $("#cartShipLbl").textContent = shipping ? "Shipping" : "Pickup";
    $("#cartShip").textContent = shipping && ship ? money(ship) : "Free";
    var tt = $("#cartTotal"); tt.textContent = money(tot); tt.setAttribute("data-total", tot.toFixed(2));
    $("#fulShipPrice").textContent = quote ? money(quote) : "Free";
    $("#cartCredit").innerHTML = shipping
      ? "Paying with <b>store credit</b>? Credit is redeemed in store — pick pickup and mention it at the counter."
      : "Paying with <b>store credit</b>? Mention it at pickup — credit is worth 10% more than cash.";
    if(!cartBusy){ var b = $("#checkoutBtn"); if(b) b.textContent = cartCheckoutLabel(); }
  }
  function renderCart(diff){
    diff = diff || {};
    var dirty = cartNormalize();
    if(cartRefreshSnaps()) dirty = true;
    if(dirty) cartSave();
    var lines = cartLines(), qNow = cartQty();
    var cc = $("#cartCount");
    if(cc){
      if(!reduceMotion && qNow > lastCartQty){ cc.classList.remove("pop"); void cc.offsetWidth; cc.classList.add("pop"); }
      cc.textContent = qNow;
    }
    lastCartQty = qNow;
    var btn = $("#cartBtn"); if(btn) btn.setAttribute("aria-label", "Cart, " + qNow + (qNow === 1 ? " item" : " items"));
    var dc = $("#drawerCount"); if(dc) dc.textContent = qNow ? "(" + qNow + ")" : "";
    drawer.classList.toggle("empty", !lines.length);
    if(cartDoneShown) return; /* confirmation panel owns the body until the drawer closes */
    var body = $("#cartBody"), form = $("#cartForm");
    body.hidden = false;
    if(!lines.length){
      clearTimeout(cartEmptyTimer);
      var existing = $$(".cart-line:not(.leaving)", body);
      if(existing.length && !reduceMotion && drawer.classList.contains("open")){
        existing.forEach(cartRemoveLine);
        cartEmptyTimer = setTimeout(function(){ if(!cartQty() && !cartDoneShown) cartRenderEmpty(); }, 240);
      } else cartRenderEmpty();
      form.hidden = true;
    } else {
      clearTimeout(cartEmptyTimer);
      cartRenderLines(body, lines);
      form.hidden = false;
    }
    cartRenderSums(lines);
  }

  /* ---- drawer open / close ---- */
  var CART_INERT = ["header.topbar", "#main", "footer"];
  function cartSetInert(on){
    if(!("inert" in HTMLElement.prototype)) return;
    CART_INERT.forEach(function(s){ var el = $(s); if(el && !drawer.contains(el) && !el.contains(drawer)) el.inert = on; });
  }
  function openCart(){
    if(drawer.classList.contains("open")) return;
    cartHideAdded();
    drawer.classList.add("open"); overlay.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    var btn = $("#cartBtn"); if(btn) btn.setAttribute("aria-expanded", "true");
    if(!reduceMotion){
      drawer.classList.add("opening");
      setTimeout(function(){ drawer.classList.remove("opening"); }, 700);
    }
    document.documentElement.classList.add("cart-open");
    cartSetInert(true);
    if(cartTrapRelease) cartTrapRelease();
    cartTrapRelease = TL.trapFocus(drawer, {initial: $("#drawerClose")});
  }
  function closeCart(){
    if(!drawer.classList.contains("open")) return;
    drawer.classList.remove("open", "opening"); overlay.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    var btn = $("#cartBtn"); if(btn) btn.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("cart-open");
    cartSetInert(false);
    cartHideError();
    if(cartDoneShown){
      cartDoneShown = false;
      drawer.classList.remove("done");
      var p = $("#cartDone"); if(p){ p.hidden = true; p.innerHTML = ""; }
      renderCart();
    }
    var rel = cartTrapRelease; cartTrapRelease = null;
    if(rel) rel();
    var ae = document.activeElement;
    if(!ae || ae === document.body || drawer.contains(ae) || !ae.getClientRects().length){
      if(btn) try { btn.focus({preventScroll: true}); } catch(e){}
    }
  }

  /* ---- "Added ✓ · View cart" pill under the cart button ---- */
  /* Deferred a tick: callers such as the shop's Add handler may open the drawer right
     after add(), in which case the line animating in is the feedback and no pill shows. */
  function cartAddedPill(snap){
    if(drawer.classList.contains("open")) return;
    setTimeout(function(){ cartAddedPillNow(snap); }, 60);
  }
  function cartAddedPillNow(snap){
    var pill = $("#cartAdded"), btn = $("#cartBtn");
    if(!pill || !btn || drawer.classList.contains("open")) return;
    var r = btn.getBoundingClientRect();
    if(!r.width && !r.height) return;
    pill.style.top = Math.round(r.bottom + 8) + "px";
    pill.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px";
    var nm = $("#cartAddedName"); if(nm) nm.textContent = snap.name + " added to cart.";
    pill.hidden = false;
    pill.classList.remove("on"); void pill.offsetWidth; pill.classList.add("on");
    cartAddedArm(2500);
  }
  function cartAddedArm(ms){ clearTimeout(cartAddedTimer); cartAddedTimer = setTimeout(cartHideAdded, ms); }
  function cartHideAdded(){
    clearTimeout(cartAddedTimer);
    var pill = $("#cartAdded"); if(!pill || pill.hidden) return;
    var hadFocus = pill.contains(document.activeElement);
    pill.classList.remove("on");
    setTimeout(function(){ if(!pill.classList.contains("on")) pill.hidden = true; }, reduceMotion ? 0 : 220);
    if(hadFocus && !drawer.classList.contains("open")){ var b = $("#cartBtn"); if(b) try { b.focus(); } catch(e){} }
  }

  /* ---- checkout ---- */
  function cartDemoId(){ return "TL-" + Math.random().toString(36).slice(2, 7).toUpperCase(); }
  function cartSetBusy(on, label){
    cartBusy = !!on;
    clearTimeout(cartBusyWatch);
    var b = $("#checkoutBtn"); if(!b) return;
    b.disabled = cartBusy;
    b.setAttribute("aria-busy", cartBusy ? "true" : "false");
    b.textContent = cartBusy ? (label || "One sec…") : cartCheckoutLabel();
    if(cartBusy) cartBusyWatch = setTimeout(function(){ if(cartBusy){ cartSetBusy(false); cartError("That took too long — nothing was charged.", true); } }, 12000);
  }
  function cartError(msg, retry){
    var el = $("#cartErr"); if(!el) return;
    el.innerHTML = "<span>" + esc(msg) + "</span>" + (retry ? '<button type="button" class="cart-retry" data-cart-retry>Try again</button>' : "");
    el.hidden = false;
  }
  function cartHideError(){ var el = $("#cartErr"); if(el){ el.hidden = true; el.innerHTML = ""; } }
  function cartRecordOrder(o){
    var list = TL.store.get("orders", []);
    if(!Array.isArray(list)) list = [];
    list.unshift({id: o.orderId, at: new Date().toISOString(), total: o.total, fulfillment: o.fulfillment, email: o.email || "", mock: true,
      lines: o.lines.map(function(l){ return {id: l.item.id, name: l.item.name, price: l.item.price, qty: l.qty}; })});
    TL.store.set("orders", list.slice(0, 20));
  }
  function cartShowDone(o){
    cartSetBusy(false); cartHideError();
    var ful = o.fulfillment === "ship" ? "Ship it" : "In-store pickup";
    var html = '<div class="done-mark" aria-hidden="true">&#10003;</div>' +
      '<p class="eyebrow">' + (o.demo ? "Demo order" : "Order placed") + "</p>" +
      '<h3 id="cartDoneTitle" tabindex="-1">' + (o.demo ? "Order placed — in demo" : "Thanks — we’ve got it") + "</h3>" +
      '<dl class="done-meta">' +
        "<div><dt>Order</dt><dd class=\"mono\">" + esc(o.orderId) + "</dd></div>" +
        "<div><dt>Total</dt><dd class=\"mono\">" + money(o.total) + "</dd></div>" +
        "<div><dt>Fulfillment</dt><dd>" + ful + "</dd></div>" +
        (o.email ? "<div><dt>Receipt to</dt><dd>" + esc(o.email) + "</dd></div>" : "<div><dt>Receipt</dt><dd>At the counter</dd></div>") +
      "</dl>" +
      '<ul class="done-lines">' + o.lines.map(function(l){
        return "<li><span>" + l.qty + " × " + esc(l.item.name) + "</span><span>" + money(l.item.price * l.qty) + "</span></li>";
      }).join("") + (o.shipping ? "<li><span>Shipping</span><span>" + money(o.shipping) + "</span></li>" : "") + "</ul>" +
      '<p class="done-note">' + esc(o.note) + "</p>" +
      '<button type="button" class="btn" data-cart-close>Keep shopping</button>';
    var panel = $("#cartDone"); panel.innerHTML = html; panel.hidden = false;
    $("#cartBody").hidden = true; $("#cartForm").hidden = true;
    cartDoneShown = true; drawer.classList.add("done");
    cartRecordOrder(o);
    cart = {};
    cartCommit("checkout", {removed: o.lines.map(function(l){ return l.item.id; })});
    if(!drawer.classList.contains("open")) openCart();
    var h = $("#cartDoneTitle"); if(h) try { h.focus({preventScroll: true}); } catch(e){}
    cartAnnounce("Order " + o.orderId + " placed. Total " + money(o.total) + ".");
    if(!reduceMotion){
      var m = panel.querySelector(".done-mark"), r = m ? m.getBoundingClientRect() : null;
      try { TL.confetti(r ? r.left + r.width / 2 : undefined, r ? r.top + r.height / 2 : undefined, {count: 60}); } catch(e){}
    }
  }
  function cartCheckout(){
    if(cartBusy) return;
    cartHideError();
    var lines = cartLines();
    if(!lines.length){ toast("Cart is empty — go pull some hits"); return; }
    for(var i = 0; i < lines.length; i++){
      if(lines[i].item.stock <= 0){ cartError("“" + lines[i].item.name + "” sold out — remove it to check out.", false); return; }
    }
    var email = (cartOpts.email || "").trim(), note = (cartOpts.note || "").trim();
    if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){
      cartError("That email doesn't look right — fix it or leave it blank.", false);
      var ei = $("#cartEmail"); if(ei) try { ei.focus(); } catch(e){}
      return;
    }
    var fulfillment = cartOpts.fulfillment === "ship" ? "ship" : "pickup";
    var subtotal = cartSubtotal(), shipping = cartShipping(), total = cartTotal();
    var body = {
      lines: lines.map(function(l){ return {id: l.item.id, name: l.item.name, price: l.item.price, qty: l.qty, game: l.item.game}; }),
      fulfillment: fulfillment
    };
    if(email) body.email = email;
    if(note) body.note = note;
    var online = !!TL.api.online;
    cartSetBusy(true, online ? "Taking you to Square…" : "Placing demo order…");
    function done(extra){
      cartShowDone({
        orderId: (extra && extra.orderId) || cartDemoId(),
        total: (extra && typeof extra.total === "number" && extra.total > 0) ? extra.total : total,
        subtotal: subtotal, shipping: shipping, fulfillment: fulfillment, email: email, lines: lines, demo: true,
        note: (extra && extra.note) || "This is a demo — nothing was charged. Square Checkout goes live with the API keys."
      });
    }
    var p;
    try {
      p = TL.api.call("POST", "/checkout", body, function(){ return {mock: true, demo: true, orderId: cartDemoId(), total: total}; });
    } catch(e){ p = Promise.reject({status: 0, error: "error"}); }
    p.then(function(d){
      if(d && d.url){
        TL.store.set("cart-pending", {orderId: d.orderId || null, at: Date.now(), url: String(d.url)});
        cartSetBusy(true, "Taking you to Square…");
        setTimeout(function(){ window.location.href = String(d.url); }, 350);
        setTimeout(function(){ if(cartBusy) cartSetBusy(false); }, 6000);
        return;
      }
      if(d && d.mock){
        done({orderId: d.orderId, total: d.total, note: d.demo ? null :
          "Square isn't connected on this API yet, so the order was recorded as a mock — nothing was charged."});
        return;
      }
      done({orderId: d && d.orderId, note: "The API accepted the order but sent no payment link — recorded as a demo, nothing was charged."});
    }).catch(function(e){
      var status = e && e.status;
      if(status === 404 || status === 405){
        done({note: "This API build has no checkout route yet — demo confirmation only, nothing was charged."});
        return;
      }
      cartSetBusy(false);
      var msg;
      if(status === 409){
        var avail = e && e.data && e.data.items, touched = 0;
        if(Array.isArray(avail)){
          avail.forEach(function(a){
            if(!a || !cart[String(a.id)]) return;
            var n = Math.floor(Number(a.available));
            if(!isFinite(n)) return;
            touched++;
            if(n <= 0) cartRemove(String(a.id)); else if(n < cart[String(a.id)].qty) cartSetQty(String(a.id), n);
          });
        }
        msg = touched ? "Stock changed while you were browsing — your cart was updated. Check it and try again." : "Something in your cart just sold — check the quantities and try again.";
      } else if(status === 0 && e && e.error === "timeout") msg = "The checkout took too long to answer — nothing was charged.";
      else if(status === 0) msg = "Couldn't reach the checkout service — check your connection.";
      else if(status === 429) msg = "Too many tries — give it a minute.";
      else msg = "Checkout hit a snag" + (e && e.error && e.error !== "error" ? ": " + String(e.error).slice(0, 120) : "") + ". Nothing was charged.";
      cartError(msg, true);
    });
  }
  function cartUpdateMode(){
    if(!cartBusy){ var b = $("#checkoutBtn"); if(b) b.textContent = cartCheckoutLabel(); }
    var n = $("#cartNoteLine");
    if(n) n.textContent = TL.api.online ? "Pickup in store or ship · secure payment through Square" : "Demo mode — Square Checkout goes live with the API keys";
  }
  function cartSyncOptsUI(){
    $$('#cartForm input[name="fulfillment"]').forEach(function(r){
      r.checked = r.value === cartOpts.fulfillment;
      var lab = r.closest(".ful-opt"); if(lab) lab.classList.toggle("on", r.checked);
    });
    var em = $("#cartEmail"); if(em && em.value !== cartOpts.email) em.value = cartOpts.email;
    var nt = $("#cartNote"); if(nt && nt.value !== cartOpts.note) nt.value = cartOpts.note;
  }

  /* ---- wiring ---- */
  document.addEventListener("click", function(e){
    var add = e.target.closest("[data-add]");
    if(add){
      if(add.disabled) return;
      var id = add.getAttribute("data-add"), it = cartFind(id);
      if(!it){ toast("Couldn't find that item — refresh and try again"); return; }
      var prod = add.closest(".prod");
      var src = prod ? (prod.querySelector(".face.front") || prod.querySelector(".mini") || prod.querySelector(".thumb")) : null;
      var fromEl = src || add;
      try { document.dispatchEvent(new CustomEvent("tl:cart-add", {detail: {id: String(id), sourceEl: fromEl, item: it}})); } catch(err){}
      cartAdd(it, 1, fromEl);
      return;
    }
    var inc = e.target.closest("[data-inc]");
    if(inc){ if(!inc.disabled) cartSetQty(inc.getAttribute("data-inc"), (cart[inc.getAttribute("data-inc")] || {qty: 0}).qty + 1); return; }
    var dec = e.target.closest("[data-dec]");
    var rm = e.target.closest("[data-rm]");
    if(dec || rm){
      var rid = (dec || rm).getAttribute(dec ? "data-dec" : "data-rm"), entry = cart[rid];
      if(!entry) return;
      var li = (dec || rm).closest(".cart-line"), next = null;
      if(dec && entry.qty > 1){ cartSetQty(rid, entry.qty - 1); return; }
      if(li) next = li.nextElementSibling || li.previousElementSibling;
      cartRemove(rid);
      if(drawer.classList.contains("open")){
        var target = next && !next.classList.contains("leaving") ? next.querySelector("[data-rm]") : null;
        try { (target || $("#drawerClose")).focus(); } catch(err){}
      }
      return;
    }
    if(e.target.closest("#cartBtn")){ if(drawer.classList.contains("open")) closeCart(); else { renderCart(); openCart(); } return; }
    if(e.target.closest("#cartAddedView")){ cartHideAdded(); renderCart(); openCart(); return; }
    if(e.target.closest("#drawerClose") || e.target.closest("[data-cart-close]")){ closeCart(); return; }
    if(e.target.closest("[data-cart-retry]")){ cartHideError(); cartCheckout(); return; }
    if(e.target.closest("#checkoutBtn")){ cartCheckout(); return; }
  });
  overlay.addEventListener("click", closeCart);
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    if(drawer.classList.contains("open")){ closeCart(); return; }
    var lm = $("#loginModal");
    if(lm && !lm.hidden && typeof closeLogin === "function") closeLogin();
  });
  document.addEventListener("change", function(e){
    var t = e.target;
    if(!t || t.name !== "fulfillment" || !drawer.contains(t)) return;
    cartOpts.fulfillment = t.value === "ship" ? "ship" : "pickup";
    cartSaveOpts(); cartSyncOptsUI(); cartHideError();
    cartCommit("options", {});
    cartAnnounce((cartOpts.fulfillment === "ship" ? "Shipping" : "Pickup") + " selected. Total " + money(cartTotal()) + ".");
  });
  document.addEventListener("input", function(e){
    var t = e.target;
    if(!t || !drawer.contains(t)) return;
    if(t.id === "cartEmail") cartOpts.email = String(t.value || "").slice(0, 120);
    else if(t.id === "cartNote") cartOpts.note = String(t.value || "").slice(0, 200);
    else return;
    clearTimeout(cartOptsTimer); cartOptsTimer = setTimeout(cartSaveOpts, 250);
  });
  $("#cartBody").addEventListener("error", function(e){
    var t = e.target;
    if(t && t.tagName === "IMG"){ var a = t.closest(".ct-art"); if(a) a.classList.add("noimg"); }
  }, true);
  (function(){
    var pill = $("#cartAdded"); if(!pill) return;
    pill.addEventListener("mouseenter", function(){ clearTimeout(cartAddedTimer); });
    pill.addEventListener("focusin", function(){ clearTimeout(cartAddedTimer); });
    pill.addEventListener("mouseleave", function(){ if(!pill.hidden) cartAddedArm(1500); });
    pill.addEventListener("focusout", function(){ if(!pill.hidden) cartAddedArm(1500); });
  })();
  window.addEventListener("storage", function(e){
    if(e && e.key !== null && e.key !== "tl-cart") return;
    cartLoad(); renderCart(); cartEmit("sync", {});
  });

  /* Re-validate against the loaded inventory: refresh snapshots, clamp to stock, drop sold-out. */
  function cartRevalidate(){
    var inv = TL.inventory;
    if(!inv || typeof inv.byId !== "function") return;
    var removed = [], changed = [], clamped = 0;
    Object.keys(cart).forEach(function(id){
      var e = cart[id], fresh = null;
      try { fresh = inv.byId(id) || null; } catch(err){ fresh = null; }
      if(!fresh){
        if(id.indexOf("tcg-") === 0 && inv.loaded){ delete cart[id]; removed.push(id); }
        return;
      }
      var s = cartSnap(fresh); if(!s) return;
      s.id = id;
      var was = e.item; e.item = s;
      if(s.stock <= 0){ delete cart[id]; removed.push(id); return; }
      var max = cartMax(s);
      if(e.qty > max){ e.qty = max; clamped++; changed.push(id); }
      else if(was.price !== s.price) changed.push(id);
    });
    if(removed.length || changed.length) cartCommit("sync", {removed: removed, changed: changed});
    else cartSave();
    if(removed.length) toast(removed.length === 1 ? "1 item in your cart sold out — removed" : removed.length + " items in your cart sold out — removed");
    else if(clamped) toast(clamped === 1 ? "1 cart quantity was trimmed to what's left" : clamped + " cart quantities were trimmed to what's left");
  }

  TL.cart = {
    add: cartAdd, remove: cartRemove, setQty: cartSetQty, clear: function(){ cartClear("clear"); },
    lines: cartLines, count: cartQty, total: cartTotal, subtotal: cartSubtotal, shipping: cartShipping,
    has: function(id){ return !!cart[String(id)]; },
    qty: function(id){ var e = cart[String(id)]; return e ? e.qty : 0; },
    fulfillment: function(){ return cartOpts.fulfillment; },
    open: function(){ renderCart(); openCart(); },
    close: closeCart,
    isOpen: function(){ return drawer.classList.contains("open"); },
    checkout: cartCheckout,
    render: renderCart
  };

  TL.on("init", function(){
    var btn = $("#cartBtn");
    if(btn){ btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "drawer"); }
    cartLoad();
    cartSyncOptsUI();
    renderCart();
    cartUpdateMode();
    if(TL.inventory && TL.inventory.loaded) cartRevalidate();
  });
  TL.on("inventory:loaded", cartRevalidate);
  TL.on("api:ready", cartUpdateMode);
  TL.on("view:change", function(d){
    if(d && d.paramsOnly) return;
    if(!drawer.classList.contains("open")) return;
    closeCart();
    var sel = d && d.name ? "#view-" + String(d.name).replace(/[^\w-]/g, "") : null;
    var v = sel ? $(sel) : null, h1 = v && v.querySelector("h1");
    if(h1){ h1.setAttribute("tabindex", "-1"); try { h1.focus({preventScroll: true}); } catch(e){} }
  });
