  /* ---------- site settings / banner / live toggle ---------- */
  var isLive = false;
  function updateBanner(){
    var el = $("#siteBanner"), txt = $("#siteBannerText"), btn = $("#siteBannerBtn");
    var custom = $("#setBanner").value.trim();
    var customOn = $("#setBannerOn").getAttribute("aria-checked") === "true";
    if(isLive){
      txt.textContent = "LIVE NOW — rip & ship break in progress";
      btn.hidden = false; el.hidden = false;
    } else if(customOn && custom){
      txt.textContent = custom; btn.hidden = true; el.hidden = false;
    } else {
      el.hidden = true;
    }
  }
  $("#setApply").addEventListener("click", function(){
    var t = $("#setTitle").value.trim() || "Top Loaded";
    $("#brandName").firstChild.nodeValue = t;
    $("#footHoursWk").textContent = $("#setHoursWk").value;
    $("#footHoursSun").textContent = $("#setHoursSun").value;
    $("#visitHoursWk").textContent = $("#setHoursWk").value;
    $("#visitHoursWe").textContent = $("#setHoursSun").value;
    updateBanner();
    toast("Site settings applied (demo — saved for this session)");
  });
  $("#setLogo").addEventListener("click", function(){
    toast("Logo upload ships with the live build — accepts PNG/SVG, swaps the header mark");
  });
  $("#goLiveBtn").addEventListener("click", function(){
    isLive = !isLive;
    this.textContent = isLive ? "End live rip" : "Start live rip";
    var pill = $("#liveStatusPill");
    pill.className = "pill " + (isLive ? "ok" : "crit");
    pill.innerHTML = '<span class="dot' + (isLive ? "" : " crit") + '"></span>' + (isLive ? "On air" : "Offline");
    $("#livePillText").textContent = isLive ? "Live" : "Offline";
    updateBanner();
    toast(isLive ? "You're live — storefront banner is up" : "Stream ended — banner cleared");
  });
  $("#setShowApply").addEventListener("click", function(){
    var d = $("#setShowDate").value.trim(), h = $("#setShowHours").value.trim();
    $("#showDateBig").innerHTML = esc(d).replace(/,\s*/, "<br>");
    $("#showHours").textContent = h;
    $("#footShowDate").innerHTML = "Next card show · " + esc(d) + " →";
    $("#statShowDate").textContent = d + " · Hilton, Turfway Rd";
    toast("Card show info updated across the site");
  });
