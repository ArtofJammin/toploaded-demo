  /* ---------- channel sync alerts ---------- */
  var ALERTS = [
    {msg:"Sold in-store (Square): Charizard ex — update the TCGplayer listing", ch:"TCGplayer"},
    {msg:"Sold on TCGplayer: The One Ring — pull it from the case & Square", ch:"Square"}
  ];
  function renderAlerts(){
    $("#alertList").innerHTML = ALERTS.length ? ALERTS.map(function(a, i){
      return '<div class="toggle-row"><div class="tl"><b>' + esc(a.msg) + '</b><span>Reconcile on ' + esc(a.ch) + '</span></div>' +
        '<button class="btn btn-ghost" data-ack="' + i + '" type="button" style="padding:7px 12px">Done</button></div>';
    }).join("") : '<p class="drawer-note" style="text-align:left">All channels reconciled — nothing waiting.</p>';
    $("#alertCount").textContent = ALERTS.length;
  }
  document.addEventListener("click", function(e){
    var b = e.target.closest("[data-ack]");
    if(!b) return;
    ALERTS.splice(parseInt(b.dataset.ack, 10), 1);
    renderAlerts();
    toast("Alert cleared — channels reconciled");
  });
  $("#tcgRun").addEventListener("click", function(){
    var btn = this;
    btn.disabled = true; btn.textContent = "Importing…";
    setTimeout(function(){
      btn.disabled = false; btn.textContent = "Run import now";
      $("#tcgLog").insertAdjacentHTML("afterbegin",
        '<div><span class="t">' + nowTime() + '</span> · <span class="ok">OK</span> Manual import · 1,204 listings · 3 price changes · 0 conflicts</div>');
      toast("TCGplayer import complete — 3 price changes pulled (demo)");
    }, 1100);
  });
