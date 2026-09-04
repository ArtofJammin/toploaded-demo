  /* ---------- quick view modal ----------
       TL.openQuickView(item, {list, from, restock})   list = result list for prev/next
       TL.closeQuickView()
     DOM contract: src/html/23-quickview.html (#qv, #qvOverlay, …). While open on the shop
     view the URL carries ?item=<id>; landing on #/shop?item=<id> deep-links into it.
     Restock requests POST /forms/restock {email, productId, productName}; offline they are
     appended to TL.store "forms" per the forms contract. */
  var qvEl = $("#qv"), qvOverlay = $("#qvOverlay"), qvFront = $("#qvFront"), qvFlip = $("#qvFlip"), qvCardBtn = $("#qvCard");
  var QV = {open: false, item: null, list: null, idx: -1, release: null, qty: 1, flipped: false, from: null, destroyTilt: null, pending: null};
  function qvListings(it){
    var rows = [];
    if(Array.isArray(it.listings) && it.listings.length){
      it.listings.slice().sort(function(a, b){ return a.price - b.price; }).forEach(function(l){
        rows.push('<tr><td>' + esc(COND_ABBR[l.cond] || l.cond || "—") + (l.cond && COND_ABBR[l.cond] ? ' <span class="qv-cond-long">' + esc(l.cond) + '</span>' : '') + '</td>' +
          '<td>' + esc(l.printing || "Normal") + '</td><td class="num">' + fmtInt(l.qty) + '</td><td class="num">' + money(l.price) + '</td></tr>');
      });
    } else {
      rows.push('<tr><td>' + esc(it.cond || (it.type === "sealed" ? "Sealed" : "—")) + '</td><td>' + esc(it.printing || "Normal") + '</td><td class="num">' + fmtInt(it.stock) + '</td><td class="num">' + money(it.price) + '</td></tr>');
    }
    return rows.join("");
  }
  function qvSetFlip(on){
    QV.flipped = !!on;
    if(qvFlip) qvFlip.classList.toggle("flipped", QV.flipped);
    if(qvCardBtn) qvCardBtn.setAttribute("aria-pressed", String(QV.flipped));
  }
  function qvRenderImage(it){
    if(!qvFront) return;
    var art;
    if(it.tcg && (it.imgLg || it.img)){
      art = '<img class="card-img qv-img" src="' + esc(it.imgLg || it.img) + '" alt="' + esc(it.name) + '" width="500" height="700" decoding="async" referrerpolicy="no-referrer">';
    } else art = cardArt(it);
    qvFront.innerHTML = art;
    qvFront.dataset.id = it.id;
  }
  /* local pointer tilt for the big card when the motion package's TL.tilt is still the no-op */
  var qvTiltRaf = 0, qvTiltEv = null;
  function qvTiltFrame(){
    qvTiltRaf = 0;
    if(!qvTiltEv || !qvCardBtn) return;
    var r = qvCardBtn.getBoundingClientRect(); if(!r.width) return;
    var x = TL.clamp((qvTiltEv.clientX - r.left) / r.width - .5, -.5, .5), y = TL.clamp((qvTiltEv.clientY - r.top) / r.height - .5, -.5, .5);
    qvCardBtn.style.setProperty("--rx", (x * 14).toFixed(2) + "deg");
    qvCardBtn.style.setProperty("--ry", (-y * 12).toFixed(2) + "deg");
    qvCardBtn.style.setProperty("--mx", (50 + x * 100).toFixed(1) + "%");
    qvCardBtn.style.setProperty("--my", (50 + y * 100).toFixed(1) + "%");
  }
  function qvTiltMove(e){
    if(reduceMotion || !fineMQ.matches) return;
    qvTiltEv = e; qvCardBtn.classList.add("tilting");
    if(!qvTiltRaf) qvTiltRaf = requestAnimationFrame(qvTiltFrame);
  }
  function qvTiltLeave(){
    qvTiltEv = null;
    if(!qvCardBtn) return;
    ["--rx", "--ry", "--mx", "--my"].forEach(function(v){ qvCardBtn.style.removeProperty(v); });
    qvCardBtn.classList.remove("tilting");
  }
  function qvStartTilt(){
    qvStopTilt();
    if(!qvCardBtn || reduceMotion) return;
    var d = null;
    try { d = TL.tilt(qvCardBtn, {max: 14}); } catch(e){ d = null; }
    if(typeof d === "function"){ QV.destroyTilt = d; return; }
    if(!window.PointerEvent) return;
    qvCardBtn.addEventListener("pointermove", qvTiltMove, {passive: true});
    qvCardBtn.addEventListener("pointerleave", qvTiltLeave);
    QV.destroyTilt = function(){
      qvCardBtn.removeEventListener("pointermove", qvTiltMove);
      qvCardBtn.removeEventListener("pointerleave", qvTiltLeave);
      qvTiltLeave();
    };
  }
  function qvStopTilt(){ if(QV.destroyTilt){ try { QV.destroyTilt(); } catch(e){} QV.destroyTilt = null; } }
  function qvUrl(set){
    if(TL.current !== "shop") return;
    var p = TL.route().params || {}, next = {};
    Object.keys(p).forEach(function(k){ if(k !== "item") next[k] = p[k]; });
    if(set && QV.item) next.item = QV.item.id;
    TL.setParams(next, {replace: true});
  }
  function qvFill(it){
    QV.item = it;
    var out = !(Number(it.stock) > 0);
    qvRenderImage(it);
    qvSetFlip(false);
    var eyebrow = [itemGameLabel(it), it.set, it.rarity].filter(Boolean).join(" · ");
    $("#qvEyebrow").textContent = eyebrow + (it.jp ? " · Japanese" : "");
    $("#qvName").textContent = it.name;
    $("#qvPrice").textContent = money(it.price);
    $("#qvCond").textContent = it.cond ? it.cond : (it.type === "sealed" ? "Sealed" : "");
    var mk = $("#qvMarket");
    if(typeof it.market === "number" && it.market > 0){
      var diff = Math.round((it.market - it.price) / it.market * 100);
      mk.textContent = "TCGplayer market " + money(it.market) + " · " + (diff >= 2 ? diff + "% under" : diff <= -2 ? Math.abs(diff) + "% over" : "at market");
      mk.className = "mkt" + (diff >= 2 ? " under" : diff <= -2 ? " over" : "");
      mk.hidden = false;
    } else mk.hidden = true;
    $("#qvStock").innerHTML = stockLabel(it) + (it.listings && it.listings.length > 1 ? ' <span class="qv-stock-note">' + fmtInt(it.stock) + ' across ' + it.listings.length + ' listings</span>' : '');
    $("#qvListings").innerHTML = qvListings(it);
    QV.qty = 1; $("#qvQtyVal").textContent = "1";
    var add = $("#qvAdd"), qty = $("#qvQty");
    add.disabled = out; add.textContent = out ? "Sold out" : "Add to cart";
    qty.hidden = out;
    $("#qvInc").disabled = out || QV.qty >= it.stock;
    $("#qvDec").disabled = true;
    var rs = $("#qvRestock"); rs.hidden = !out; rs.reset();
    var tcg = $("#qvTcg");
    if(it.tcg && it.url){ tcg.href = it.url; tcg.hidden = false; } else { tcg.hidden = true; tcg.removeAttribute("href"); }
    qvSyncWish();
    qvSyncNav();
    $("#qvStatus").textContent = "";
    if(TL.recent) TL.recent.push(it.id);
  }
  function qvSyncWish(){
    var b = $("#qvWish"); if(!b || !QV.item) return;
    var on = !!(TL.wishlist && TL.wishlist.has(QV.item.id));
    b.setAttribute("aria-pressed", String(on));
    $("#qvWishText").textContent = on ? "Saved" : "Save";
    b.setAttribute("aria-label", (on ? "Remove " : "Save ") + QV.item.name + (on ? " from" : " to") + " your wishlist");
  }
  function qvSyncNav(){
    var has = QV.list && QV.list.length > 1 && QV.idx > -1;
    $("#qvPrev").hidden = !has; $("#qvNext").hidden = !has;
    $("#qvPos").textContent = has ? (QV.idx + 1) + " of " + fmtInt(QV.list.length) : "";
  }
  function qvStep(dir){
    if(!QV.list || QV.idx < 0) return;
    var n = QV.list.length, i = (QV.idx + dir + n) % n, it = QV.list[i];
    if(!it) return;
    QV.idx = i;
    qvFill(it);
    qvUrl(true);
    var name = $("#qvName"); if(name) try { name.focus({preventScroll: true}); } catch(e){}
  }
  function openQuickView(item, opts){
    opts = opts || {};
    if(!item || !qvEl) return;
    var list = Array.isArray(opts.list) ? opts.list : null, idx = -1;
    if(list){ for(var i = 0; i < list.length; i++){ if(list[i] === item || (list[i] && list[i].id === item.id)){ idx = i; break; } } }
    QV.list = idx > -1 ? list : null; QV.idx = idx;
    if(!QV.open){
      QV.from = opts.from || document.activeElement;
      QV.open = true;
      qvEl.hidden = false;
      qvOverlay.classList.add("open");
      document.documentElement.classList.add("qv-open");
      qvEl.scrollTop = 0;
    }
    qvFill(item);
    qvUrl(true);
    if(QV.release) QV.release();
    var initial = opts.restock && !$("#qvRestock").hidden ? $("#qvEmail") : $("#qvClose");
    QV.release = TL.trapFocus(qvEl, {initial: initial, restore: false});
    qvStartTilt();
  }
  function closeQuickView(opts){
    opts = opts || {};
    if(!QV.open) return;
    QV.open = false;
    qvStopTilt();
    qvEl.hidden = true;
    qvOverlay.classList.remove("open");
    document.documentElement.classList.remove("qv-open");
    if(QV.release){ QV.release(); QV.release = null; }
    if(!opts.keepUrl) qvUrl(false);
    var back = QV.from;
    QV.from = null; QV.item = null; QV.list = null; QV.idx = -1;
    if(back && back.focus && document.contains(back)) try { back.focus({preventScroll: true}); } catch(e){}
  }
  TL.openQuickView = openQuickView;
  TL.closeQuickView = closeQuickView;
  /* ---- interactions ---- */
  qvOverlay.addEventListener("click", function(){ closeQuickView(); });
  $("#qvClose").addEventListener("click", function(){ closeQuickView(); });
  $("#qvPrev").addEventListener("click", function(){ qvStep(-1); });
  $("#qvNext").addEventListener("click", function(){ qvStep(1); });
  qvCardBtn.addEventListener("click", function(){ qvSetFlip(!QV.flipped); });
  $("#qvInc").addEventListener("click", function(){
    if(!QV.item) return;
    QV.qty = Math.min(Math.max(1, QV.item.stock), QV.qty + 1);
    $("#qvQtyVal").textContent = String(QV.qty);
    $("#qvInc").disabled = QV.qty >= QV.item.stock; $("#qvDec").disabled = QV.qty <= 1;
  });
  $("#qvDec").addEventListener("click", function(){
    if(!QV.item) return;
    QV.qty = Math.max(1, QV.qty - 1);
    $("#qvQtyVal").textContent = String(QV.qty);
    $("#qvInc").disabled = QV.qty >= QV.item.stock; $("#qvDec").disabled = QV.qty <= 1;
  });
  $("#qvAdd").addEventListener("click", function(e){
    if(!QV.item) return;
    if(addToCart(QV.item, QV.qty, e.currentTarget)) $("#qvStatus").textContent = "Added " + QV.qty + " × " + QV.item.name + " to your cart";
  });
  $("#qvWish").addEventListener("click", function(){
    if(!QV.item || !TL.wishlist) return;
    TL.wishlist.toggle(QV.item.id, $("#qvWish"));
    qvSyncWish();
  });
  $("#qvShare").addEventListener("click", function(){
    if(!QV.item) return;
    var url = location.origin + location.pathname + "#/shop?q=" + encodeURIComponent(QV.item.name);
    var title = QV.item.name + " · Top Loaded Trading Cards";
    if(navigator.share){
      navigator.share({title: title, text: QV.item.name + " — " + money(QV.item.price) + " at Top Loaded", url: url}).catch(function(){});
      return;
    }
    var done = function(){ toast("Link copied — send it to a friend"); $("#qvStatus").textContent = "Link copied"; };
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function(){ prompt("Copy this link", url); });
    else prompt("Copy this link", url);
  });
  $("#qvRestock").addEventListener("submit", function(e){
    e.preventDefault();
    if(!QV.item) return;
    var email = $("#qvEmail").value.trim(), it = QV.item, btn = e.target.querySelector("button[type=submit]");
    if(!email){ toast("Add your email first"); return; }
    var payload = {email: email, productId: it.tcgId || it.id, productName: it.name, website: e.target.querySelector(".qv-hp").value || ""};
    function local(){
      var forms = TL.store.get("forms", []); if(!Array.isArray(forms)) forms = [];
      forms.push({id: TL.uid(), kind: "restock", at: new Date().toISOString(), status: "new", local: true, email: email, productId: payload.productId, productName: it.name});
      TL.store.set("forms", forms);
      return {ok: true, local: true};
    }
    if(btn) btn.disabled = true;
    TL.api.call("POST", "/forms/restock", payload, local).catch(function(){ return local(); }).then(function(){
      if(btn) btn.disabled = false;
      $("#qvRestock").hidden = true;
      $("#qvStatus").textContent = "You’re on the list — we’ll email " + email + " when " + it.name + " is back.";
      toast("We’ll email you when it’s back");
    });
  });
  document.addEventListener("keydown", function(e){
    if(!QV.open) return;
    if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); closeQuickView(); return; }
    var tag = (e.target && e.target.tagName) || "";
    if(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if(e.key === "ArrowLeft"){ e.preventDefault(); qvStep(-1); }
    else if(e.key === "ArrowRight"){ e.preventDefault(); qvStep(1); }
  }, true);
  TL.on("wishlist:change", qvSyncWish);
  /* ---- deep link: #/shop?item=<id> ---- */
  function qvDeepLink(id){
    if(!id) return;
    var INV = TL.inventory, it = INV ? INV.byId(id) : null;
    if(it){ QV.pending = null; if(!QV.open || QV.item !== it) openQuickView(it, {list: TL.shop ? TL.shop.list() : null}); return; }
    if(INV && !INV.loaded && !INV.failed){ QV.pending = id; INV.load(); return; }
    QV.pending = null;
    toast("That card is no longer listed");
    qvUrl(false);
  }
  TL.on("view:change", function(d){
    if(!d) return;
    if(d.name === "shop"){ if(d.params && d.params.item) qvDeepLink(d.params.item); else if(QV.open && d.paramsOnly) closeQuickView({keepUrl: true}); }
    else if(QV.open) closeQuickView({keepUrl: true});
  });
  TL.on("inventory:loaded", function(){ if(QV.pending && TL.current === "shop") qvDeepLink(QV.pending); });
  TL.on("inventory:failed", function(){ QV.pending = null; });
