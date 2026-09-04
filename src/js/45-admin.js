  /* ---------- admin ---------- */
  function nowTime(){
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ap;
  }
  function renderAdmin(){
    var low = ITEMS.filter(function(it){ return !it.live && it.stock <= 1; }).length;
    $("#lowStockVal").textContent = low;
    $("#invBody").innerHTML = ITEMS.filter(function(it){ return !it.live; }).map(function(it){
      var cls = it.stock <= 0 ? "zero" : (it.stock <= 1 ? "low" : "");
      return "<tr>" +
        "<td>" + it.name + "</td>" +
        "<td>" + GAMES[it.game] + "</td>" +
        "<td>" + (it.type === "single" ? "Single" : "Sealed") + "</td>" +
        "<td>" + (it.cond || "\u2014") + "</td>" +
        '<td class="num">' + money(it.price) + "</td>" +
        '<td><span class="stock-edit">' +
          '<button data-stk="-1" data-id="' + it.id + '" aria-label="Decrease stock">&minus;</button>' +
          '<span class="' + cls + '">' + it.stock + "</span>" +
          '<button data-stk="1" data-id="' + it.id + '" aria-label="Increase stock">+</button>' +
        "</span></td>" +
        '<td><span class="pill ok"><span class="dot"></span>Synced</span></td>' +
      "</tr>";
    }).join("");
  }
  document.addEventListener("click", function(e){
    var b = e.target.closest("[data-stk]");
    if(!b) return;
    var it = ITEMS.find(function(x){ return x.id === b.dataset.id; });
    it.stock = Math.max(0, it.stock + parseInt(b.dataset.stk, 10));
    renderAdmin(); renderShop(); renderFeatured();
    var log = $("#syncLog");
    log.insertAdjacentHTML("afterbegin",
      '<div><span class="t">' + nowTime() + '</span> \u00b7 <span class="ok">OK</span> Pushed stock edit to Square \u00b7 ' + it.name + " \u2192 " + it.stock + "</div>");
    ALERTS.unshift({msg:"Stock changed here: " + it.name + " \u2192 " + it.stock + " \u2014 TCGplayer listing needs the same change", ch:"TCGplayer"});
    renderAlerts();
    toast("Stock updated \u2014 pushed to Square, TCGplayer flagged (demo)");
  });
  $("#syncNow").addEventListener("click", function(){
    var btn = this, log = $("#syncLog");
    btn.disabled = true; btn.textContent = "Syncing\u2026";
    setTimeout(function(){
      btn.disabled = false; btn.textContent = "Sync now";
      $("#lastSync").textContent = nowTime();
      log.insertAdjacentHTML("afterbegin",
        '<div><span class="t">' + nowTime() + '</span> \u00b7 <span class="ok">OK</span> Manual sync complete \u00b7 214 items \u00b7 0 conflicts</div>');
      toast("Catalog synced with Square \u2014 214 items, 0 conflicts (demo)");
    }, 900);
  });
  $("#viewSquare").addEventListener("click", function(){ toast("On the live site this opens squareup.com/dashboard"); });
  $("#tcgTease").addEventListener("click", function(){ toast("TCGplayer repricing ships with the live build (demo preview)"); });
  $$(".switch").forEach(function(sw){
    sw.addEventListener("click", function(){
      var on = sw.getAttribute("aria-checked") === "true";
      sw.setAttribute("aria-checked", String(!on));
      toast(sw.getAttribute("aria-label") + (!on ? " \u2014 on" : " \u2014 off") + " (demo)");
    });
  });
  $("#locSel").addEventListener("change", function(e){ toast("Location switched \u2014 " + e.target.value.split(" \u2014 ")[0] + " (demo)"); });
  $("#syncInterval").addEventListener("change", function(e){ toast("Auto-sync set to " + e.target.value.toLowerCase() + " (demo)"); });
