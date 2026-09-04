  /* ---------- site settings editors / banner / live toggle ----------
     Every card reads TL.config, saves through TL.saveConfig(patch) (PUT /config when an
     admin is online, localStorage always) and reports "Saved to server" or "Saved on
     this device". The storefront banner (#siteBanner) is rendered here from
     config.banner and config.live on 'config:change' / 'live:change'. */
  var DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  var DAY_LAB = {mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun"};
  var DOW_OF = {sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6};
  var DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var GAME_OPTS = [["pk", "Pokemon"], ["op", "One Piece"], ["mtg", "Magic"], ["gundam", "Gundam"], ["lorcana", "Lorcana"], ["other", "Other"]];
  var SIGNUP_OPTS = [["tcgplus", "Bandai TCG+"], ["form", "Site signup form"], ["none", "Walk in"]];
  var savingConfig = false;
  function fmt12(hhmm){
    if(!hhmm) return "";
    var a = String(hhmm).split(":"), h = parseInt(a[0], 10), m = parseInt(a[1] || "0", 10);
    if(isNaN(h)) return String(hhmm);
    var ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return h + (m ? ":" + TL.pad2(m) : "") + " " + ap;
  }
  function todayKey(){
    try {
      var w = new Intl.DateTimeFormat("en-US", {timeZone: TL.config.timezone || "America/New_York", weekday: "short"}).format(new Date());
      return w.toLowerCase().slice(0, 3);
    } catch(e){ return DAY_KEYS[(new Date().getDay() + 6) % 7]; }
  }
  function stateFor(cardId){ return $('[data-state-for="' + cardId + '"]'); }
  function renderCfgUpdated(){
    var el = $("#cfgUpdated"); if(!el) return;
    setState(el, "", TL.config.updatedAt ? "Last change · " + fmtStamp(TL.config.updatedAt) : "Built-in defaults · nothing changed yet");
  }
  function saveCard(cardId, patch, okMsg){
    var st = stateFor(cardId);
    setState(st, "", "Saving…");
    savingConfig = true;
    var canServer = TL.api.online && TL.api.role === "admin";
    var p;
    try { p = TL.saveConfig(patch); } catch(e){ p = Promise.reject(e); }
    return Promise.resolve(p).then(function(res){
      savingConfig = false;
      var server = canServer && !!(res && typeof res === "object");
      var where = !TL.api.online ? "Saved on this device" : (server ? "Saved to server" : "Saved on this device only — server refused");
      setState(st, server || !TL.api.online ? "ok" : "warn", where + " · " + nowTime());
      renderCfgUpdated();
      toast((okMsg ? okMsg + " — " : "") + where.toLowerCase());
      return server;
    }, function(e){
      savingConfig = false;
      setState(st, "err", "Not saved — " + ((e && e.message) || "error"));
      toast("Could not save — " + ((e && e.message) || "error"));
      return false;
    });
  }
  function num(v, fb){ var n = parseFloat(v); return isNaN(n) ? fb : n; }
  function setVal(id, v){ var el = $("#" + id); if(el) el.value = (v === undefined || v === null) ? "" : String(v); }
  function val(id){ var el = $("#" + id); return el ? el.value.trim() : ""; }
  function opts(list, sel){
    return list.map(function(o){ return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(sel) ? " selected" : "") + '>' + esc(o[1]) + '</option>'; }).join("");
  }

  /* ---- generic row editors (ticker, testimonials, live schedule, table prices) ---- */
  function rowsRender(el, rows, fields, emptyText){
    if(!el) return;
    if(!rows.length){ el.innerHTML = '<p class="rows-empty">' + esc(emptyText || "Nothing yet — add a row.") + '</p>'; return; }
    el.innerHTML = rows.map(function(row, i){
      return '<div class="row-line" data-r="' + i + '">' + fields.map(function(f){
        var v = row[f.k]; if(v === undefined || v === null) v = "";
        return '<input class="' + esc(f.cls || "grow") + '" data-f="' + esc(f.k) + '" type="' + esc(f.type || "text") + '"' + (f.step ? ' step="' + f.step + '"' : "") + (f.min !== undefined ? ' min="' + f.min + '"' : "") +
          ' value="' + esc(v) + '" placeholder="' + esc(f.ph || "") + '" aria-label="' + esc(f.label || f.ph || f.k) + ' ' + (i + 1) + '">';
      }).join("") + '<button type="button" class="row-del" data-del="' + i + '" aria-label="Remove row ' + (i + 1) + '">&times;</button></div>';
    }).join("");
  }
  function rowsRead(el, fields){
    if(!el) return [];
    return $$(".row-line", el).map(function(line){
      var o = {};
      fields.forEach(function(f){ var inp = line.querySelector('[data-f="' + f.k + '"]'); o[f.k] = inp ? inp.value.trim() : ""; });
      return o;
    });
  }
  function rowsWire(el, fields, blank, emptyText){
    if(!el) return;
    el.addEventListener("click", function(e){
      var d = e.target.closest("[data-del]"); if(!d) return;
      var rows = rowsRead(el, fields); rows.splice(parseInt(d.dataset.del, 10), 1);
      rowsRender(el, rows, fields, emptyText);
      var focusTo = el.querySelector("input"); if(focusTo) focusTo.focus();
    });
    return function add(){
      var rows = rowsRead(el, fields); rows.push(blank());
      rowsRender(el, rows, fields, emptyText);
      var lines = $$(".row-line", el), last = lines[lines.length - 1], inp = last && last.querySelector("input");
      if(inp) inp.focus();
    };
  }
  var TICKER_F = [{k: "label", ph: "Charizard ex · 151", label: "Ticker item"}, {k: "price", ph: "$85", cls: "sm", label: "Top price"}];
  var TESTI_F = [{k: "quote", ph: "Best prices in NKY, hands down.", label: "Quote"}, {k: "who", ph: "Alex R.", cls: "sm", label: "Who said it"}];
  var SCHED_F = [{k: "day", ph: "Tue", cls: "xs", label: "Day"}, {k: "time", ph: "7 PM", cls: "xs", label: "Time"}, {k: "name", ph: "Pokemon rip night", label: "Stream name"}, {k: "desc", ph: "What gets opened", label: "Description"}];
  var TABLE_F = [{k: "n", ph: "1", cls: "xs", type: "number", min: 1, label: "Tables"}, {k: "price", ph: "60", cls: "sm", type: "number", min: 0, label: "Price $"}];
  var addTicker = rowsWire($("#tickerEditor"), TICKER_F, function(){ return {label: "", price: ""}; }, "No ticker rows — the strip hides.");
  var addTesti = rowsWire($("#testiEditor"), TESTI_F, function(){ return {quote: "", who: ""}; }, "No testimonials yet — the section stays hidden.");
  var addSched = rowsWire($("#liveSchedEditor"), SCHED_F, function(){ return {day: "", time: "", name: "", desc: ""}; }, "No streams scheduled.");
  rowsWire($("#tablePriceEditor"), TABLE_F, function(){ return {n: "", price: ""}; }, "No table prices.");
  $("#tickerAdd").addEventListener("click", function(){ addTicker(); });
  $("#testiAdd").addEventListener("click", function(){ addTesti(); });
  $("#liveSchedAdd").addEventListener("click", function(){ addSched(); });

  /* ---- identity & contact ---- */
  function renderSite(){
    var c = TL.config, a = c.address || {};
    setVal("setTitle", c.title); setVal("setTagline", c.tagline); setVal("setPhone", c.phone); setVal("setEmail", c.email);
    setVal("setAddr1", a.line1); setVal("setCity", a.city); setVal("setState", a.state); setVal("setZip", a.zip);
  }
  $("#setApply").addEventListener("click", function(){
    var phone = val("setPhone"), digits = phone.replace(/\D/g, "");
    if(digits.length === 10) digits = "1" + digits;
    var email = val("setEmail");
    if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ toast("That email doesn't look right"); $("#setEmail").focus(); return; }
    saveCard("cardSite", {
      title: val("setTitle") || "Top Loaded", tagline: val("setTagline"), phone: phone, phoneRaw: digits ? "+" + digits : "", email: email,
      address: {line1: val("setAddr1"), city: val("setCity"), state: val("setState").toUpperCase(), zip: val("setZip")}
    }, "Identity saved");
  });

  /* ---- hours ---- */
  function renderHours(){
    var el = $("#hoursEditor"); if(!el) return;
    var h = TL.config.hours || {}, today = todayKey();
    el.innerHTML = DAY_KEYS.map(function(k){
      var v = h[k], closed = !v;
      return '<div class="hours-row' + (closed ? " is-closed" : "") + (k === today ? " is-today" : "") + '" data-day="' + k + '">' +
        '<span class="hd">' + DAY_LAB[k] + '</span>' +
        '<label class="closed"><input type="checkbox" data-closed="' + k + '"' + (closed ? " checked" : "") + '> Closed</label>' +
        '<input type="time" data-open="' + k + '" value="' + esc(v ? v[0] : "11:00") + '" aria-label="' + DAY_LAB[k] + ' opens"' + (closed ? " disabled" : "") + '>' +
        '<span class="dash">–</span>' +
        '<input type="time" data-close="' + k + '" value="' + esc(v ? v[1] : "18:00") + '" aria-label="' + DAY_LAB[k] + ' closes"' + (closed ? " disabled" : "") + '>' +
      '</div>';
    }).join("");
    renderHoursPreview();
  }
  function readHours(){
    var out = {};
    DAY_KEYS.forEach(function(k){
      var closed = $('[data-closed="' + k + '"]'), o = $('[data-open="' + k + '"]'), c = $('[data-close="' + k + '"]');
      out[k] = (closed && closed.checked) ? null : [(o && o.value) || "11:00", (c && c.value) || "18:00"];
    });
    return out;
  }
  function hoursText(hours){
    function group(days){
      var runs = [], run = null;
      days.forEach(function(d){
        var v = hours[d], key = v ? v[0] + "-" + v[1] : null;
        if(!key){ run = null; return; }
        if(run && run.key === key) run.end = d; else { run = {key: key, start: d, end: d, v: v}; runs.push(run); }
      });
      return runs.map(function(r){ return (r.start === r.end ? DAY_LAB[r.start] : DAY_LAB[r.start] + "–" + DAY_LAB[r.end]) + " · " + fmt12(r.v[0]) + " – " + fmt12(r.v[1]); }).join(", ");
    }
    return {wk: group(["mon", "tue", "wed", "thu", "fri"]) || "Closed weekdays", we: group(["sat", "sun"]) || "Closed weekends"};
  }
  function renderHoursPreview(){
    var t = hoursText(readHours()), el = $("#hoursPreview");
    if(el) el.textContent = t.wk + " · " + t.we;
  }
  $("#hoursEditor").addEventListener("change", function(e){
    var cb = e.target.closest("[data-closed]");
    if(cb){
      var row = cb.closest(".hours-row"); row.classList.toggle("is-closed", cb.checked);
      $$("input[type=time]", row).forEach(function(i){ i.disabled = cb.checked; });
    }
    renderHoursPreview();
  });
  $("#hoursApply").addEventListener("click", function(){
    var hours = readHours();
    for(var i = 0; i < DAY_KEYS.length; i++){
      var v = hours[DAY_KEYS[i]];
      if(v && v[0] >= v[1]){ toast(DAY_LAB[DAY_KEYS[i]] + " closes before it opens — fix the times"); return; }
    }
    saveCard("cardHours", {hours: hours, hoursText: hoursText(hours)}, "Hours saved");
  });

  /* ---- banner & logo ---- */
  var pendingLogo; /* undefined = unchanged, null = clear, string = new data URL */
  function renderLogoPreview(){
    var el = $("#logoPreview"); if(!el) return;
    var src = pendingLogo === undefined ? TL.config.logo : pendingLogo;
    el.innerHTML = src ? '<img src="' + esc(src) + '" alt="">' : "TL";
    var note = $("#logoNote");
    if(note && pendingLogo === undefined) note.textContent = (TL.config.logo ? "Custom logo in use. " : "Default logo in use. ") + "PNG, JPG, WebP or SVG — scaled to 600px wide, must come out under 150 KB.";
  }
  function renderBannerCard(){
    var b = TL.config.banner || {};
    setVal("setBanner", b.text);
    $("#setBannerOn").setAttribute("aria-checked", String(!!b.on));
    pendingLogo = undefined;
    renderLogoPreview();
  }
  function dataUrlBytes(s){ var i = s.indexOf(","); return Math.round((s.length - i - 1) * 0.75); }
  function downscale(file, maxW){
    return new Promise(function(resolve, reject){
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function(){
        try {
          var scale = Math.min(1, maxW / img.naturalWidth), w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
          var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          resolve(cv.toDataURL("image/png"));
        } catch(e){ URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error("not an image")); };
      img.src = url;
    });
  }
  $("#setLogoFile").addEventListener("change", function(e){
    var f = e.target.files && e.target.files[0]; if(!f) return;
    var note = $("#logoNote"), LIMIT = 150 * 1024;
    function reject(msg){ note.textContent = msg; toast(msg); e.target.value = ""; }
    if(f.type === "image/svg+xml"){
      if(f.size > LIMIT){ reject("That SVG is " + Math.round(f.size / 1024) + " KB — keep the logo under 150 KB."); return; }
      var rd = new FileReader();
      rd.onload = function(){ pendingLogo = String(rd.result); renderLogoPreview(); note.textContent = "SVG staged (" + Math.round(f.size / 1024) + " KB) — hit Save to publish it."; };
      rd.onerror = function(){ reject("Couldn't read that file."); };
      rd.readAsDataURL(f);
      return;
    }
    if(!/^image\/(png|jpeg|webp)$/.test(f.type)){ reject("Use a PNG, JPG, WebP or SVG file."); return; }
    downscale(f, 600).then(function(url){
      if(dataUrlBytes(url) > LIMIT) return downscale(f, 400);
      return url;
    }).then(function(url){
      var kb = Math.round(dataUrlBytes(url) / 1024);
      if(dataUrlBytes(url) > LIMIT){ reject("Even at 400px that comes out to " + kb + " KB — flatten the artwork or use an SVG under 150 KB."); return; }
      pendingLogo = url; renderLogoPreview();
      note.textContent = "Logo staged as PNG (" + kb + " KB) — hit Save to publish it.";
    }).catch(function(){ reject("Couldn't read that image."); });
  });
  $("#setLogoClear").addEventListener("click", function(){
    pendingLogo = null; renderLogoPreview();
    $("#logoNote").textContent = "Default logo will be restored when you Save.";
  });
  $("#bannerApply").addEventListener("click", function(){
    var patch = {banner: {on: $("#setBannerOn").getAttribute("aria-checked") === "true", text: val("setBanner")}};
    if(patch.banner.on && !patch.banner.text){ toast("Type the banner text first, or switch it off"); $("#setBanner").focus(); return; }
    if(pendingLogo !== undefined) patch.logo = pendingLogo;
    saveCard("cardBanner", patch, "Banner saved").then(function(){ pendingLogo = undefined; renderLogoPreview(); $("#setLogoFile").value = ""; });
  });

  /* ---- links & buy rates ---- */
  function renderLinks(){
    var l = TL.config.links || {}, b = TL.config.buy || {}, r = b.rates || {};
    setVal("setLinkTcgplus", l.tcgplus); setVal("setLinkFacebook", l.facebook); setVal("setLinkInstagram", l.instagram); setVal("setLinkWhatnot", l.whatnot);
    setVal("setRateBulk", Math.round((r.bulk || 0) * 100)); setVal("setRateStandard", Math.round((r.standard || 0) * 100));
    setVal("setRateHot", Math.round((r.hot || 0) * 100)); setVal("setRateGraded", Math.round((r.graded || 0) * 100));
    setVal("setCreditBonus", Math.round((b.creditBonus || 0) * 100));
  }
  function pct(id){ return TL.clamp(num(val(id), 0), 0, 100) / 100; }
  $("#linksApply").addEventListener("click", function(){
    var bad = ["setLinkTcgplus", "setLinkFacebook", "setLinkInstagram", "setLinkWhatnot"].filter(function(id){ var v = val(id); return v && !/^https?:\/\//i.test(v); });
    if(bad.length){ toast("Links need to start with https://"); $("#" + bad[0]).focus(); return; }
    saveCard("cardLinks", {
      links: {tcgplus: val("setLinkTcgplus"), facebook: val("setLinkFacebook"), instagram: val("setLinkInstagram"), whatnot: val("setLinkWhatnot")},
      buy: {rates: {bulk: pct("setRateBulk"), standard: pct("setRateStandard"), hot: pct("setRateHot"), graded: pct("setRateGraded")}, creditBonus: pct("setCreditBonus")}
    }, "Links and rates saved");
  });

  /* ---- card show ---- */
  function renderShowCard(){
    var s = TL.config.show || {};
    setVal("setShowDate", s.date); setVal("setShowStart", s.start); setVal("setShowEnd", s.end); setVal("setShowSetup", s.setup);
    setVal("setShowHours", s.hours); setVal("setShowVenue", s.venue); setVal("setShowAddress", s.address); setVal("setShowCadence", s.cadence);
    setVal("setShowTables", s.tables); setVal("setShowBooked", s.booked);
    rowsRender($("#tablePriceEditor"), (s.tablePrices || []).map(function(t){ return {n: t.n, price: t.price}; }), TABLE_F, "No table prices.");
  }
  $("#setShowApply").addEventListener("click", function(){
    var tables = Math.max(0, Math.round(num(val("setShowTables"), 0))), booked = Math.max(0, Math.round(num(val("setShowBooked"), 0)));
    if(booked > tables){ toast("Booked can't be more than the total tables"); $("#setShowBooked").focus(); return; }
    var start = val("setShowStart") || "10:00", end = val("setShowEnd") || "16:00";
    var hoursTxt = val("setShowHours") || (fmt12(start) + " – " + fmt12(end));
    saveCard("cardShow", {show: {
      date: val("setShowDate"), start: start, end: end, setup: val("setShowSetup") || "08:00", hours: hoursTxt,
      venue: val("setShowVenue"), address: val("setShowAddress"), cadence: val("setShowCadence"), tables: tables, booked: booked,
      tablePrices: rowsRead($("#tablePriceEditor"), TABLE_F).filter(function(t){ return t.n; }).map(function(t){ return {n: Math.round(num(t.n, 1)), price: num(t.price, 0)}; })
    }}, "Card show saved").then(function(){ if(typeof renderShowStat === "function") renderShowStat(); });
  });

  /* ---- live ---- */
  function renderLivePill(){
    var on = !!(TL.config.live && TL.config.live.on), pill = $("#liveStatusPill"), btn = $("#goLiveBtn");
    if(pill){ pill.className = "pill " + (on ? "ok" : "crit"); pill.innerHTML = '<span class="dot"></span>' + (on ? "On air" : "Offline"); }
    if(btn) btn.textContent = on ? "End live rip" : "Start live rip";
  }
  function renderLiveCard(){
    var l = TL.config.live || {};
    setVal("setLiveTitle", l.title); setVal("setLivePlatform", l.platform || ""); setVal("setLiveEmbed", l.embed);
    setVal("setLiveSpotPrice", l.spotPrice); setVal("setLiveSpots", l.spots); setVal("setLivePacks", l.packsPerSpot);
    rowsRender($("#liveSchedEditor"), (l.schedule || []).map(function(s){ return {day: s.day, time: s.time, name: s.name, desc: s.desc}; }), SCHED_F, "No streams scheduled.");
    renderLivePill();
  }
  $("#goLiveBtn").addEventListener("click", function(){
    var on = !(TL.config.live && TL.config.live.on), st = $("#liveState");
    setState(st, "", on ? "Going live…" : "Ending…");
    this.disabled = true; var btn = this;
    savingConfig = true;
    Promise.resolve(TL.saveConfig({live: {on: on}})).then(function(res){
      savingConfig = false; btn.disabled = false;
      var server = TL.api.online && TL.api.role === "admin" && !!(res && typeof res === "object");
      setState(st, server || !TL.api.online ? "ok" : "warn", (on ? "On air" : "Off air") + " · " + (server ? "everyone sees it" : (TL.api.online ? "this device only" : "this device")) + " · " + nowTime());
      renderCfgUpdated();
      toast(on ? "You're live — storefront banner is up" : "Stream ended — banner cleared");
    });
  });
  $("#liveApply").addEventListener("click", function(){
    var embed = val("setLiveEmbed");
    if(embed && !/^https:\/\//i.test(embed)){ toast("Embed URL needs to start with https://"); $("#setLiveEmbed").focus(); return; }
    saveCard("cardLive", {live: {
      title: val("setLiveTitle"), platform: val("setLivePlatform"), embed: embed,
      spotPrice: Math.max(0, num(val("setLiveSpotPrice"), 0)), spots: TL.clamp(Math.round(num(val("setLiveSpots"), 12)), 1, 60), packsPerSpot: TL.clamp(Math.round(num(val("setLivePacks"), 3)), 1, 36),
      schedule: rowsRead($("#liveSchedEditor"), SCHED_F).filter(function(s){ return s.name || s.day; })
    }}, "Live settings saved");
  });

  /* ---- play nights editor (working copy kept in sync on every keystroke) ---- */
  var evWork = [];
  function evFromConfig(){
    return (TL.config.events || []).map(function(e){
      return {id: e.id || "", day: e.day || DOW_NAMES[e.dow || 0], dow: typeof e.dow === "number" ? e.dow : (DOW_NAMES.indexOf(e.day) > -1 ? DOW_NAMES.indexOf(e.day) : 3),
        name: e.name || "", small: e.small || "", time: e.time || "", start: e.start || "", fee: e.fee || "", game: e.game || "op", signup: e.signup || "tcgplus"};
    });
  }
  function renderEvEditor(){
    var el = $("#evEditor"); if(!el) return;
    if(!evWork.length){ el.innerHTML = '<p class="rows-empty">No play nights — add one below.</p>'; return; }
    el.innerHTML = '<div class="ev-head" aria-hidden="true"><span>Day</span><span>Event</span><span>Start</span><span>Fee</span><span>Game</span><span>Signup</span><span></span></div>' +
      evWork.map(function(ev, i){
        var n = i + 1;
        return '<div class="ev-row" data-r="' + i + '">' +
          '<select data-f="dow" aria-label="Day for event ' + n + '">' + opts(DOW_NAMES.map(function(d, di){ return [di, d]; }), ev.dow) + '</select>' +
          '<input data-f="name" value="' + esc(ev.name) + '" placeholder="One Piece Locals" aria-label="Name of event ' + n + '">' +
          '<input data-f="start" type="time" value="' + esc(ev.start) + '" aria-label="Start time of event ' + n + '">' +
          '<input data-f="fee" value="' + esc(ev.fee) + '" placeholder="$5" aria-label="Entry fee of event ' + n + '">' +
          '<select data-f="game" aria-label="Game for event ' + n + '">' + opts(GAME_OPTS, ev.game) + '</select>' +
          '<select data-f="signup" aria-label="Signup type for event ' + n + '">' + opts(SIGNUP_OPTS, ev.signup) + '</select>' +
          '<button type="button" class="row-del" data-evdel="' + i + '" aria-label="Remove ' + esc(ev.name || "event " + n) + '">&times;</button>' +
          '<div class="ev-small"><input data-f="small" value="' + esc(ev.small) + '" placeholder="One line under the name — prizing, format, who it\'s for" aria-label="Description of event ' + n + '"></div>' +
        '</div>';
      }).join("");
  }
  function evSync(e){
    var inp = e.target.closest("[data-f]"), row = inp && inp.closest(".ev-row"); if(!row) return;
    var ev = evWork[parseInt(row.dataset.r, 10)]; if(!ev) return;
    var f = inp.dataset.f, v = inp.value;
    if(f === "dow"){ ev.dow = parseInt(v, 10); ev.day = DOW_NAMES[ev.dow]; }
    else if(f === "start"){ ev.start = v; ev.time = fmt12(v); }
    else ev[f] = v;
  }
  $("#evEditor").addEventListener("input", evSync);
  $("#evEditor").addEventListener("change", evSync);
  $("#evEditor").addEventListener("click", function(e){
    var d = e.target.closest("[data-evdel]"); if(!d) return;
    evWork.splice(parseInt(d.dataset.evdel, 10), 1);
    renderEvEditor();
    var first = $("#evEditor input"); if(first) first.focus();
    toast("Night removed — publish to make it stick");
  });
  $("#evAdd").addEventListener("click", function(){
    evWork.push({id: "", day: "Fri", dow: 5, name: "", small: "", time: "6:00 PM", start: "18:00", fee: "TBD", game: "op", signup: "tcgplus"});
    renderEvEditor();
    var rows = $$("#evEditor .ev-row"), last = rows[rows.length - 1], inp = last && last.querySelector('[data-f="name"]');
    if(inp) inp.focus();
  });
  $("#evApply").addEventListener("click", function(){
    var used = {};
    var events = evWork.filter(function(ev){ return ev.name; }).map(function(ev){
      var id = ev.id || ((ev.game || "ev") + "-" + DOW_NAMES[ev.dow].toLowerCase());
      var base = id, n = 2; while(used[id]){ id = base + "-" + (n++); } used[id] = true;
      return {id: id, day: DOW_NAMES[ev.dow], dow: ev.dow, name: ev.name, small: ev.small, time: ev.time || fmt12(ev.start), start: ev.start, fee: ev.fee, game: ev.game, signup: ev.signup};
    });
    if(!events.length && evWork.length){ toast("Give the night a name first"); return; }
    saveCard("cardEvents", {events: events}, "Schedule published").then(function(){ evWork = evFromConfig(); renderEvEditor(); });
  });

  /* ---- ticker & testimonials ---- */
  function renderTickerCard(){
    rowsRender($("#tickerEditor"), (TL.config.ticker || []).map(function(t){ return {label: t[0], price: t[1]}; }), TICKER_F, "No ticker rows — the strip hides.");
    rowsRender($("#testiEditor"), (TL.config.testimonials || []).map(function(t){ return {quote: t.quote, who: t.who}; }), TESTI_F, "No testimonials yet — the section stays hidden.");
  }
  $("#tickerApply").addEventListener("click", function(){
    saveCard("cardTicker", {
      ticker: rowsRead($("#tickerEditor"), TICKER_F).filter(function(r){ return r.label; }).map(function(r){ return [r.label, r.price || "ask"]; }),
      testimonials: rowsRead($("#testiEditor"), TESTI_F).filter(function(r){ return r.quote; })
    }, "Ticker and testimonials saved");
  });

  /* ---- reset ---- */
  $("#cfgReset").addEventListener("click", function(){
    if(!window.confirm("Reset every site setting to the built-in defaults? Hours, banner, logo, play nights, show info and live settings all go back.")) return;
    var btn = this; btn.disabled = true;
    var p = (TL.api.online && TL.api.role === "admin") ? TL.api.del("/config").then(function(){ return true; }, function(e){ toast("Server reset failed — " + (e && e.error || "error") + "; this device was reset"); return false; }) : Promise.resolve(false);
    p.then(function(server){
      TL.store.del("config");
      TL.config = TL.deepMerge({}, window.TL_DEFAULT_CONFIG || {});
      TL.emit("config:change", {config: TL.config, patch: {}, reset: true});
      TL.emit("live:change", {live: TL.config.live});
      renderEditors();
      btn.disabled = false;
      toast(server ? "Settings reset on the server and this device" : "Settings reset on this device");
    });
  });

  /* ---- banner on the storefront ---- */
  function renderBanner(){
    var el = $("#siteBanner"), txt = $("#siteBannerText"), btn = $("#siteBannerBtn"); if(!el) return;
    var live = TL.config.live || {}, b = TL.config.banner || {};
    if(live.on){
      txt.textContent = "LIVE NOW — " + (live.title ? live.title + " · " : "") + "rip & ship in progress";
      btn.hidden = false; el.hidden = false;
    } else if(b.on && b.text){
      txt.textContent = b.text; btn.hidden = true; el.hidden = false;
    } else el.hidden = true;
  }

  function renderEditors(){
    renderSite(); renderHours(); renderBannerCard(); renderLinks(); renderShowCard(); renderLiveCard();
    evWork = evFromConfig(); renderEvEditor(); renderTickerCard(); renderCfgUpdated();
  }
  var editorsStale = true;
  TL.on("config:change", function(){
    renderBanner();
    if(savingConfig) return;
    if(TL.current === "admin") renderEditors(); else editorsStale = true;
  });
  TL.on("live:change", function(){ renderBanner(); renderLivePill(); });
  TL.on("view:change", function(d){
    if(d && d.name === "admin" && !d.paramsOnly){ if(editorsStale){ renderEditors(); editorsStale = false; } else renderLivePill(); }
  });
  TL.on("init", function(){ renderBanner(); });
