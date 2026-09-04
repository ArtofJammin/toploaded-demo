  /* ---------- cart ---------- */
  var cart = {}; // id -> qty
  var lastCartQty = 0;
  var drawer = $("#drawer"), overlay = $("#overlay");
  function cartQty(){ return Object.keys(cart).reduce(function(n,k){ return n + cart[k]; }, 0); }
  function openCart(){
    drawer.classList.add("open"); overlay.classList.add("open");
    drawer.setAttribute("aria-hidden","false");
    if(!reduceMotion){
      drawer.classList.add("opening");
      setTimeout(function(){ drawer.classList.remove("opening"); }, 700);
    }
    document.documentElement.classList.add("cart-open");
    $("#drawerClose").focus();
  }
  function closeCart(){
    drawer.classList.remove("open"); overlay.classList.remove("open");
    drawer.setAttribute("aria-hidden","true");
    document.documentElement.classList.remove("cart-open");
    $("#cartBtn").focus();
  }
  function renderCart(){
    var ids = Object.keys(cart);
    var qNow = cartQty();
    if(!reduceMotion && qNow > lastCartQty){
      var cc = $("#cartCount");
      cc.classList.remove("pop"); void cc.offsetWidth; cc.classList.add("pop");
    }
    lastCartQty = qNow;
    $("#cartCount").textContent = qNow;
    if(!ids.length){
      $("#cartBody").innerHTML = '<p class="cart-empty">Cart is empty &mdash; go pull some hits.</p>';
      $("#cartTotal").textContent = money(0);
      return;
    }
    var total = 0;
    $("#cartBody").innerHTML = ids.map(function(id){
      var it = ITEMS.find(function(x){ return x.id === id; });
      var q = cart[id];
      total += it.price * q;
      return '<div class="cart-line">' +
        '<div class="ct"><b>' + it.name + "</b><span>" + (it.live ? "Live break \u00b7 rip & ship" : GAMES[it.game] + (it.cond ? " \u00b7 " + it.cond : " \u00b7 sealed")) + "</span></div>" +
        '<div class="qty"><button data-dec="' + id + '" aria-label="Remove one">&minus;</button><span>' + q + '</span><button data-inc="' + id + '" aria-label="Add one">+</button></div>' +
        '<span class="lp">' + money(it.price * q) + "</span></div>";
    }).join("");
    $("#cartTotal").textContent = money(total);
  }
  document.addEventListener("click", function(e){
    var add = e.target.closest("[data-add]");
    if(add){
      var it = ITEMS.find(function(x){ return x.id === add.dataset.add; });
      var have = cart[it.id] || 0;
      if(have >= it.stock){ toast("That's all our stock of " + it.name); return; }
      cart[it.id] = have + 1;
      renderCart();
      toast("Added " + it.name + " to cart");
      return;
    }
    var inc = e.target.closest("[data-inc]");
    if(inc){
      var it2 = ITEMS.find(function(x){ return x.id === inc.dataset.inc; });
      if((cart[it2.id]||0) >= it2.stock){ toast("That's all our stock of " + it2.name); return; }
      cart[it2.id]++; renderCart(); return;
    }
    var dec = e.target.closest("[data-dec]");
    if(dec){
      var id = dec.dataset.dec;
      cart[id]--;
      if(cart[id] <= 0) delete cart[id];
      renderCart(); return;
    }
  });
  $("#cartBtn").addEventListener("click", function(){ renderCart(); openCart(); });
  $("#drawerClose").addEventListener("click", closeCart);
  overlay.addEventListener("click", closeCart);
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    if(drawer.classList.contains("open")) closeCart();
    if(!$("#loginModal").hidden) closeLogin();
  });
  $("#checkoutBtn").addEventListener("click", function(){
    if(!cartQty()){ toast("Cart is empty"); return; }
    toast("Demo checkout \u2014 on the live site this hands off to Square");
  });
  TL.on("init", renderCart);
