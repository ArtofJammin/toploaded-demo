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

  /* ---- generic row editors (live schedule, table prices) ---- */
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
  var SCHED_F = [{k: "day", ph: "Tue", cls: "xs", label: "Day"}, {k: "time", ph: "7 PM", cls: "xs", label: "Time"}, {k: "name", ph: "Pokemon rip night", label: "Stream name"}, {k: "desc", ph: "What gets opened", label: "Description"}];
  var TABLE_F = [{k: "n", ph: "1", cls: "xs", type: "number", min: 1, label: "Tables"}, {k: "price", ph: "60", cls: "sm", type: "number", min: 0, label: "Price $"}];
  var addSched = rowsWire($("#liveSchedEditor"), SCHED_F, function(){ return {day: "", time: "", name: "", desc: ""}; }, "No streams scheduled.");
  rowsWire($("#tablePriceEditor"), TABLE_F, function(){ return {n: "", price: ""}; }, "No table prices.");
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
    if(btn) btn.textContent = on ? "End live stream" : "Start live stream";
  }
  function renderLiveCard(){
    var l = TL.config.live || {};
    setVal("setLiveTitle", l.title); setVal("setLivePlatform", l.platform || ""); setVal("setLiveEmbed", l.embed);
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
      schedule: rowsRead($("#liveSchedEditor"), SCHED_F).filter(function(s){ return s.name || s.day; })
    }}, "Live settings saved");
  });

  /* ---- play nights editor (working copy kept in sync on every keystroke) ---- */
  var evWork = [], evReady = false;
  var evUid = 0;
  function evFromConfig(){
    return (TL.config.events || []).map(function(e){
      return {uid: e.__uid || (e.__uid = "u" + (++evUid)), id: e.id || "", day: e.day || DOW_NAMES[e.dow || 0], dow: typeof e.dow === "number" ? e.dow : (DOW_NAMES.indexOf(e.day) > -1 ? DOW_NAMES.indexOf(e.day) : 3),
        name: e.name || "", small: e.small || "", time: e.time || "", start: e.start || "", fee: e.fee || "", game: e.game || "op", signup: e.signup || "tcgplus"};
    });
  }
  function renderEvEditor(){
    var el = $("#evEditor"); if(!el) return;
    if(!evWork.length){ el.innerHTML = '<p class="rows-empty">No play nights — add one below.</p>'; return; }
    el.innerHTML = '<div class="ev-head" aria-hidden="true"><span>Day</span><span>Event</span><span></span></div>' +
      evWork.map(function(ev, i){
        var n = i + 1;
        return '<div class="ev-row" data-r="' + i + '">' +
          '<select data-f="dow" aria-label="Day for event ' + n + '">' + opts(DOW_NAMES.map(function(d, di){ return [di, d]; }), ev.dow) + '</select>' +
          '<input data-f="name" value="' + esc(ev.name) + '" placeholder="One Piece Locals" aria-label="Name of event ' + n + '">' +
          '<button type="button" class="row-del" data-evdel="' + i + '" aria-label="Remove ' + esc(ev.name || "event " + n) + '">&times;</button>' +
          '<div class="ev-meta-head" aria-hidden="true"><span>Start</span><span>Fee</span><span>Game</span><span>Signup</span></div>' +
          '<div class="ev-meta">' +
            '<input data-f="start" type="time" value="' + esc(ev.start) + '" aria-label="Start time of event ' + n + '">' +
            '<input data-f="fee" value="' + esc(ev.fee) + '" placeholder="$5" aria-label="Entry fee of event ' + n + '">' +
            '<select data-f="game" aria-label="Game for event ' + n + '">' + opts(GAME_OPTS, ev.game) + '</select>' +
            '<select data-f="signup" aria-label="Signup type for event ' + n + '">' + opts(SIGNUP_OPTS, ev.signup) + '</select>' +
          '</div>' +
          '<div class="ev-small"><input data-f="small" value="' + esc(ev.small) + '" placeholder="One line under the name — prizing, format, who it\'s for" aria-label="Description of event ' + n + '"></div>' +
        '</div>';
      }).join("");
  }
  function evSync(e){
    var inp = e.target.closest("[data-f]"), row = inp && inp.closest(".ev-row"); if(!row) return;
    var ev = evWork[parseInt(row.dataset.r, 10)]; if(!ev) return;
    var f = inp.dataset.f, v = inp.value;
    if(inp.getAttribute("aria-invalid")) inp.removeAttribute("aria-invalid");
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
    evWork.push({uid: "new" + (++evUid), id: "", day: "Fri", dow: 5, name: "", small: "", time: "6:00 PM", start: "18:00", fee: "TBD", game: "op", signup: "tcgplus"});
    renderEvEditor();
    var rows = $$("#evEditor .ev-row"), last = rows[rows.length - 1], inp = last && last.querySelector('[data-f="name"]');
    if(inp) inp.focus();
  });
  $("#evApply").addEventListener("click", function(){
    var used = {};
    /* never publish a working copy that was never filled in from the config — that
       used to replace the whole schedule with whatever happened to be on screen.
       Keyed on "did the editor ever load", so deliberately clearing every night still works. */
    if(!evReady){
      evWork = evFromConfig(); evReady = true; renderEvEditor();
      toast("Schedule reloaded — check it, then publish");
      return;
    }
    /* a nameless row used to vanish on publish with no warning — stop and point at it */
    var blank = -1;
    for(var b = 0; b < evWork.length; b++){ if(!String(evWork[b].name || "").trim()){ blank = b; break; } }
    if(blank > -1){
      var brow = $('#evEditor .ev-row[data-r="' + blank + '"]'), binp = brow && brow.querySelector('[data-f="name"]');
      if(binp){ binp.focus(); binp.setAttribute("aria-invalid", "true"); }
      toast("Night " + (blank + 1) + " needs a name before you publish");
      return;
    }
    /* a night with no start time renders as 12:00 AM and loses its calendar link */
    var noTime = -1;
    for(var t2 = 0; t2 < evWork.length; t2++){ if(!String(evWork[t2].start || "").trim()){ noTime = t2; break; } }
    if(noTime > -1){
      var trow = $('#evEditor .ev-row[data-r="' + noTime + '"]'), tinp = trow && trow.querySelector('[data-f="start"]');
      if(tinp){ tinp.focus(); tinp.setAttribute("aria-invalid", "true"); }
      toast("Give " + (evWork[noTime].name || "night " + (noTime + 1)) + " a start time before you publish");
      return;
    }
    var events = evWork.map(function(ev){
      var id = ev.id || ((ev.game || "ev") + "-" + DOW_NAMES[ev.dow].toLowerCase());
      var base = id, n = 2; while(used[id]){ id = base + "-" + (n++); } used[id] = true;
      var out = {id: id, day: DOW_NAMES[ev.dow], dow: ev.dow, name: ev.name, small: ev.small, time: ev.time || fmt12(ev.start), start: ev.start, fee: ev.fee, game: ev.game, signup: ev.signup};
      try { Object.defineProperty(out, "__uid", {value: ev.uid, enumerable: false, writable: true}); } catch(e2){}
      return out;
    });
    /* dropping nights is destructive and easy to do by accident — say so out loud.
       Compare identities, not counts: deleting one night while adding another nets to
       zero and used to slip through silently. */
    var keep = {}; evWork.forEach(function(ev){ if(ev.uid) keep[ev.uid] = 1; });
    var gone = (TL.config.events || []).filter(function(e){ return e.__uid && !keep[e.__uid]; });
    if(gone.length){
      var names = gone.map(function(e){ return e.name || "an unnamed night"; }).join(", ");
      if(!window.confirm("Publishing removes " + gone.length + " play night" + (gone.length === 1 ? "" : "s") + " from the site: " + names + ". Continue?")){
        evWork = evFromConfig(); renderEvEditor();
        toast("Nothing published — the schedule is back as it was");
        return;
      }
    }
    saveCard("cardEvents", {events: events}, "Schedule published").then(function(){ evWork = evFromConfig(); renderEvEditor(); });
  });

  /* ---- reviews ("Word around the tables") ----
     config.reviews = {source, googlePlaceId, minRating, items:[{quote, who, rating, source, url, at}]}.
     Ships empty: nothing is invented here, the list is whatever the shop pastes in. The
     "google" source only records intent — pulling reviews needs a Places key on the worker,
     so the site still shows this list either way (renderRevSourceNote says so out loud). */
  var REV_SRC_OPTS = [["google", "Google"], ["tcgplayer", "TCGplayer"], ["shop", "In the shop"]];
  var REV_SRC_LAB = {google: "Google", tcgplayer: "TCGplayer", shop: "In the shop"};
  var revWork = [], revReady = false, revUid = 0;
  function tagUid(obj, prefix, n){
    var uid = obj.__uid;
    if(!uid){
      uid = prefix + n;
      try { Object.defineProperty(obj, "__uid", {value: uid, enumerable: false, writable: true}); } catch(e){ obj.__uid = uid; }
    }
    return uid;
  }
  function revMin(){ return TL.clamp(Math.round(num(val("setRevMin"), 4)), 1, 5); }
  function revFromConfig(){
    var r = TL.config.reviews || {};
    return (r.items || []).map(function(it){
      return {uid: tagUid(it, "r", ++revUid), quote: it.quote || "", who: it.who || "",
        rating: TL.clamp(Math.round(num(it.rating, 5)), 1, 5), source: REV_SRC_LAB[it.source] ? it.source : "google",
        url: it.url || "", at: it.at || ""};
    });
  }
  function renderRevSourceNote(){
    var el = $("#revSourceNote"); if(!el) return;
    el.textContent = val("setRevSource") === "google"
      ? "Automatic Google reviews need the shared API, a Places key, the shop's Place ID, and published terms/privacy links. Until connected, only the genuine reviews entered below can appear."
      : "Pasted in by hand: the site shows exactly what's in the list below, nothing else.";
  }
  function renderRevPreview(){
    var el = $("#revPreview"); if(!el) return;
    var min = revMin(), live = 0, held = 0;
    revWork.forEach(function(r){ if(String(r.quote || "").trim()){ if(r.rating >= min) live++; else held++; } });
    if(!revWork.length){ el.textContent = "Nothing published — the home page section stays empty until you add a review."; return; }
    el.textContent = live + " review" + (live === 1 ? "" : "s") + " will show on the home page" +
      (held ? " · " + held + " held back under the " + min + "-star minimum" : "") +
      " · publish to put the change live.";
  }
  function renderRevEditor(){
    var el = $("#revEditor"); if(!el) return;
    if(!revWork.length){
      el.innerHTML = '<p class="rows-empty">No reviews yet. Copy a real one in with “Add review” — quote, who left it, and the link if it has one.</p>';
      renderRevPreview(); return;
    }
    el.innerHTML = revWork.map(function(r, i){
      var n = i + 1;
      return '<div class="rev-row" data-r="' + i + '">' +
        '<textarea data-f="quote" rows="2" placeholder="Paste what they actually wrote" aria-label="Review ' + n + ' quote">' + esc(r.quote) + '</textarea>' +
        '<button type="button" class="row-del" data-revdel="' + i + '" aria-label="Remove review ' + n + (r.who ? " from " + esc(r.who) : "") + '">&times;</button>' +
        '<div class="rev-meta-head" aria-hidden="true"><span>Who left it</span><span>Stars</span><span>Where from</span></div>' +
        '<div class="rev-meta">' +
          '<input data-f="who" value="' + esc(r.who) + '" placeholder="First name and initial" aria-label="Who left review ' + n + '">' +
          '<input data-f="rating" type="number" min="1" max="5" step="1" inputmode="numeric" value="' + esc(r.rating) + '" aria-label="Stars for review ' + n + '">' +
          '<select data-f="source" aria-label="Where review ' + n + ' came from">' + opts(REV_SRC_OPTS, r.source) + '</select>' +
        '</div>' +
        '<div class="rev-url"><input data-f="url" type="url" value="' + esc(r.url) + '" placeholder="https:// link to the review (optional)" aria-label="Link to review ' + n + '"></div>' +
      '</div>';
    }).join("");
    renderRevPreview();
  }
  function revSync(e){
    var inp = e.target.closest("[data-f]"), row = inp && inp.closest(".rev-row"); if(!row) return;
    var r = revWork[parseInt(row.dataset.r, 10)]; if(!r) return;
    if(inp.getAttribute("aria-invalid")) inp.removeAttribute("aria-invalid");
    if(inp.dataset.f === "rating") r.rating = TL.clamp(Math.round(num(inp.value, 5)), 1, 5);
    else r[inp.dataset.f] = inp.value;
    renderRevPreview();
  }
  function renderReviewsCard(){
    var r = TL.config.reviews || {};
    setVal("setRevSource", r.source === "google" ? "google" : "manual");
    setVal("setRevPlace", r.googlePlaceId);
    setVal("setRevMin", TL.clamp(Math.round(num(r.minRating, 4)), 1, 5));
    revWork = revFromConfig(); revReady = true;
    renderRevSourceNote(); renderRevEditor();
  }
  $("#revEditor").addEventListener("input", revSync);
  $("#revEditor").addEventListener("change", revSync);
  $("#revEditor").addEventListener("click", function(e){
    var d = e.target.closest("[data-revdel]"); if(!d) return;
    revWork.splice(parseInt(d.dataset.revdel, 10), 1);
    renderRevEditor();
    var first = $("#revEditor textarea") || $("#revAdd"); if(first) first.focus();
    toast("Review removed — publish to make it stick");
  });
  $("#revAdd").addEventListener("click", function(){
    revWork.push({uid: "revnew" + (++revUid), quote: "", who: "", rating: 5, source: "google", url: "", at: ""});
    renderRevEditor();
    var rows = $$("#revEditor .rev-row"), last = rows[rows.length - 1], inp = last && last.querySelector("textarea");
    if(inp) inp.focus();
  });
  $("#setRevSource").addEventListener("change", renderRevSourceNote);
  $("#setRevMin").addEventListener("input", renderRevPreview);
  $("#revApply").addEventListener("click", function(){
    /* never publish a working copy that was never filled in from the config */
    if(!revReady){ renderReviewsCard(); toast("Reviews reloaded — check them, then publish"); return; }
    function flag(i, sel, msg){
      var row = $('#revEditor .rev-row[data-r="' + i + '"]'), inp = row && row.querySelector(sel);
      if(inp){ inp.focus(); inp.setAttribute("aria-invalid", "true"); }
      toast(msg);
    }
    for(var i = 0; i < revWork.length; i++){
      var r = revWork[i];
      if(!String(r.quote || "").trim()){ flag(i, "textarea", "Review " + (i + 1) + " has no quote — paste it in or remove the row"); return; }
      if(!String(r.who || "").trim()){ flag(i, '[data-f="who"]', "Add the original review author's display name"); return; }
      if(r.url && !/^https?:\/\//i.test(r.url)){ flag(i, '[data-f="url"]', "The link on review " + (i + 1) + " needs to start with https://"); return; }
    }
    var min = revMin();
    var items = revWork.map(function(r){
      var out = {quote: String(r.quote).trim(), who: String(r.who || "").trim(), rating: r.rating,
        source: r.source, url: String(r.url || "").trim(), at: r.at || new Date().toISOString()};
      try { Object.defineProperty(out, "__uid", {value: r.uid, enumerable: false, writable: true}); } catch(e){}
      return out;
    });
    /* dropping reviews is destructive — compare identities, not counts (a delete plus an
       add nets to zero and used to slip through on the play-nights editor) */
    var keep = {}; revWork.forEach(function(r){ if(r.uid) keep[r.uid] = 1; });
    var gone = ((TL.config.reviews || {}).items || []).filter(function(it){ return it.__uid && !keep[it.__uid]; });
    if(gone.length && !window.confirm("Publishing removes " + gone.length + " review" + (gone.length === 1 ? "" : "s") + " from the site. Continue?")){
      renderReviewsCard();
      toast("Nothing published — the list is back as it was");
      return;
    }
    var patch = {reviews: {source: val("setRevSource") === "google" ? "google" : "manual", googlePlaceId: val("setRevPlace"), minRating: min, items: items}};
    /* the older home-page quote list reads {quote, who}; keep it in step so real reviews
       replace the sample quotes wherever that list is still what gets rendered */
    if(window.TL_DEFAULT_CONFIG && ("testimonials" in window.TL_DEFAULT_CONFIG)){
      patch.testimonials = items.filter(function(r){ return r.rating >= min; }).map(function(r){
        return {quote: r.quote, who: r.who || (REV_SRC_LAB[r.source] || "") + " review"};
      });
    }
    saveCard("cardReviews", patch, "Reviews published").then(function(){ renderReviewsCard(); });
  });

  /* ---- card show floor plan ----
     config.show.floorplan = {rows, cols, booths:[{id, r, c, w, h, type, label}]}.
     Grid is 1-indexed: row 1 is the top of the map, column 1 the left. The map here is a
     read-only preview of the same data the Card show page draws. */
  var BOOTH_OPTS = [["tcg", "TCG"], ["sports", "Sports"], ["mixed", "Mixed"], ["food", "Food"], ["entry", "Entry"]];
  var BOOTH_LAB = {tcg: "TCG", sports: "Sports", mixed: "Mixed", food: "Food", entry: "Entry"};
  var FP_MAX_ROWS = 20, FP_MAX_COLS = 26;
  var fpWork = [], fpReady = false, fpUid = 0;
  function fpSize(){
    return {rows: TL.clamp(Math.round(num(val("setFpRows"), 6)), 1, FP_MAX_ROWS), cols: TL.clamp(Math.round(num(val("setFpCols"), 10)), 1, FP_MAX_COLS)};
  }
  function fpFromConfig(){
    var f = (TL.config.show || {}).floorplan || {};
    return (f.booths || []).map(function(b){
      return {uid: tagUid(b, "b", ++fpUid), id: b.id || "", label: b.label || "",
        type: BOOTH_LAB[b.type] ? b.type : "tcg",
        r: Math.max(1, Math.round(num(b.r, 1))), c: Math.max(1, Math.round(num(b.c, 1))),
        w: Math.max(1, Math.round(num(b.w, 1))), h: Math.max(1, Math.round(num(b.h, 1)))};
    });
  }
  function fpFits(b, size){ return b.r >= 1 && b.c >= 1 && (b.r + b.h - 1) <= size.rows && (b.c + b.w - 1) <= size.cols; }
  function fpOverlap(a, b){
    return a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h;
  }
  function renderFpEditor(){
    var el = $("#fpEditor"); if(!el) return;
    if(!fpWork.length){
      el.innerHTML = '<p class="rows-empty">No booths yet. Add one per table block — the Card show page shows nothing until you do.</p>';
      renderFpMap(); return;
    }
    el.innerHTML = fpWork.map(function(b, i){
      var n = i + 1;
      function nInput(k, lab, max){
        return '<input data-f="' + k + '" type="number" min="1" max="' + max + '" step="1" inputmode="numeric" value="' + esc(b[k]) + '" aria-label="' + lab + ' of booth ' + n + '">';
      }
      return '<div class="fp-row" data-r="' + n0(i) + '">' +
        '<input data-f="label" class="fp-label" value="' + esc(b.label) + '" placeholder="Booth name" aria-label="Name of booth ' + n + '">' +
        '<select data-f="type" class="fp-type" aria-label="Kind of booth ' + n + '">' + opts(BOOTH_OPTS, b.type) + '</select>' +
        '<div class="fp-nums-head" aria-hidden="true"><span>Row</span><span>Col</span><span>Wide</span><span>Tall</span></div>' +
        '<div class="fp-nums">' + nInput("r", "Row", FP_MAX_ROWS) + nInput("c", "Column", FP_MAX_COLS) + nInput("w", "Width", FP_MAX_COLS) + nInput("h", "Height", FP_MAX_ROWS) + '</div>' +
        '<button type="button" class="row-del" data-fpdel="' + i + '" aria-label="Remove ' + esc(b.label || "booth " + n) + '">&times;</button>' +
      '</div>';
    }).join("");
    renderFpMap();
  }
  function n0(i){ return i; }
  function renderFpMap(){
    var map = $("#fpMap"), size = fpSize();
    if(map){
      map.style.gridTemplateColumns = "repeat(" + size.cols + ", var(--fp-cell))";
      map.style.gridTemplateRows = "repeat(" + size.rows + ", var(--fp-cell))";
      map.innerHTML = fpWork.map(function(b, i){
        var fits = fpFits(b, size);
        var r = TL.clamp(b.r, 1, size.rows), c = TL.clamp(b.c, 1, size.cols);
        var h = TL.clamp(b.h, 1, size.rows - r + 1), w = TL.clamp(b.w, 1, size.cols - c + 1);
        return '<span class="fp-cell t-' + esc(b.type) + (fits ? "" : " is-bad") + '" style="grid-row:' + r + ' / span ' + h + '; grid-column:' + c + ' / span ' + w + '">' +
          '<b>' + esc(b.label || "Booth " + (i + 1)) + '</b><i>' + esc(BOOTH_LAB[b.type] || b.type) + '</i></span>';
      }).join("");
    }
    renderFpMix(size);
  }
  function renderFpMix(size){
    size = size || fpSize();
    var n = {tcg: 0, sports: 0, mixed: 0, food: 0, entry: 0}, bad = 0;
    fpWork.forEach(function(b){ n[b.type] = (n[b.type] || 0) + 1; if(!fpFits(b, size)) bad++; });
    var tables = n.tcg + n.sports + n.mixed;
    var shares = TL.floorplan.stats(fpWork).pct;
    function pct(k){ return shares[k] || 0; }
    var bar = $("#fpMix");
    if(bar){
      bar.innerHTML = tables ? ["tcg", "sports", "mixed"].filter(function(k){ return n[k]; }).map(function(k){
        return '<span class="t-' + k + '" style="width:' + pct(k) + '%"></span>';
      }).join("") : "";
      bar.hidden = !tables;
    }
    var txt = $("#fpMixText");
    if(txt){
      if(!fpWork.length) txt.textContent = "Nothing placed yet. The Card show page shows the plan once you save booths here.";
      else txt.textContent = (tables ? tables + " table booth" + (tables === 1 ? "" : "s") + " · TCG " + pct("tcg") + "% · Sports " + pct("sports") + "%" + (n.mixed ? " · Mixed " + pct("mixed") + "%" : "") : "No table booths yet") +
        (n.food || n.entry ? " · plus " + [n.food ? n.food + " food" : "", n.entry ? n.entry + " entry" : ""].filter(Boolean).join(" and ") : "") +
        (bad ? " — " + bad + " booth" + (bad === 1 ? "" : "s") + " outside the " + size.rows + "×" + size.cols + " grid" : "");
    }
    var st = $("#fpRatio");
    if(st) setState(st, bad ? "warn" : "", size.rows + " rows × " + size.cols + " columns");
  }
  function fpSync(e){
    var inp = e.target.closest("[data-f]"), row = inp && inp.closest(".fp-row"); if(!row) return;
    var b = fpWork[parseInt(row.dataset.r, 10)]; if(!b) return;
    if(inp.getAttribute("aria-invalid")) inp.removeAttribute("aria-invalid");
    var f = inp.dataset.f;
    if(f === "label" || f === "type") b[f] = inp.value;
    else b[f] = Math.max(1, Math.round(num(inp.value, 1)));
    renderFpMap();
  }
  function renderFloorplanCard(){
    var f = (TL.config.show || {}).floorplan || {};
    setVal("setFpRows", TL.clamp(Math.round(num(f.rows, 6)), 1, FP_MAX_ROWS));
    setVal("setFpCols", TL.clamp(Math.round(num(f.cols, 10)), 1, FP_MAX_COLS));
    fpWork = fpFromConfig(); fpReady = true;
    renderFpEditor();
  }
  $("#fpEditor").addEventListener("input", fpSync);
  $("#fpEditor").addEventListener("change", fpSync);
  $("#fpEditor").addEventListener("click", function(e){
    var d = e.target.closest("[data-fpdel]"); if(!d) return;
    fpWork.splice(parseInt(d.dataset.fpdel, 10), 1);
    renderFpEditor();
    var first = $("#fpEditor input") || $("#fpAdd"); if(first) first.focus();
    toast("Booth removed — save to make it stick");
  });
  $("#fpAdd").addEventListener("click", function(){
    var size = fpSize();
    /* drop the new booth in the first free cell so it never lands on top of another one */
    var spot = null;
    for(var r = 1; r <= size.rows && !spot; r++){
      for(var c = 1; c <= size.cols && !spot; c++){
        var probe = {r: r, c: c, w: 1, h: 1};
        var clash = fpWork.some(function(b){ return fpOverlap(probe, b); });
        if(!clash) spot = probe;
      }
    }
    fpWork.push({uid: "bnew" + (++fpUid), id: "", label: "", type: "tcg", r: spot ? spot.r : 1, c: spot ? spot.c : 1, w: 1, h: 1});
    renderFpEditor();
    var rows = $$("#fpEditor .fp-row"), last = rows[rows.length - 1], inp = last && last.querySelector(".fp-label");
    if(inp) inp.focus();
    if(!spot) toast("Grid is full — make it bigger or move a booth");
  });
  $("#setFpRows").addEventListener("input", renderFpMap);
  $("#setFpCols").addEventListener("input", renderFpMap);
  $("#fpApply").addEventListener("click", function(){
    if(!fpReady){ renderFloorplanCard(); toast("Floor plan reloaded — check it, then save"); return; }
    var size = fpSize();
    setVal("setFpRows", size.rows); setVal("setFpCols", size.cols);
    function flag(i, sel, msg){
      var row = $('#fpEditor .fp-row[data-r="' + i + '"]'), inp = row && row.querySelector(sel);
      if(inp){ inp.focus(); inp.setAttribute("aria-invalid", "true"); }
      toast(msg);
    }
    for(var i = 0; i < fpWork.length; i++){
      var b = fpWork[i];
      if(!String(b.label || "").trim()){ flag(i, ".fp-label", "Booth " + (i + 1) + " needs a name before you save"); return; }
      if(!fpFits(b, size)){ flag(i, '[data-f="r"]', esc(b.label) + " sits outside the " + size.rows + "×" + size.cols + " grid"); return; }
      for(var j = 0; j < i; j++){
        if(fpOverlap(b, fpWork[j])){ flag(i, '[data-f="r"]', b.label + " sits on top of " + (fpWork[j].label || "booth " + (j + 1))); return; }
      }
    }
    var used = {};
    var booths = fpWork.map(function(b, i){
      var base = (b.id || String(b.label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")) || ("booth-" + (i + 1));
      var id = base, k = 2; while(used[id]){ id = base + "-" + (k++); } used[id] = true;
      var out = {id: id, label: String(b.label).trim(), type: b.type, r: b.r, c: b.c, w: b.w, h: b.h};
      try { Object.defineProperty(out, "__uid", {value: b.uid, enumerable: false, writable: true}); } catch(e){}
      return out;
    });
    var keep = {}; fpWork.forEach(function(b){ if(b.uid) keep[b.uid] = 1; });
    var gone = (((TL.config.show || {}).floorplan || {}).booths || []).filter(function(b){ return b.__uid && !keep[b.__uid]; });
    if(gone.length && !window.confirm("Saving removes " + gone.length + " booth" + (gone.length === 1 ? "" : "s") + " from the floor plan: " +
        gone.map(function(b){ return b.label || "an unnamed booth"; }).join(", ") + ". Continue?")){
      renderFloorplanCard();
      toast("Nothing saved — the plan is back as it was");
      return;
    }
    saveCard("cardFloorplan", {show: {floorplan: {rows: size.rows, cols: size.cols, booths: booths}}}, "Floor plan saved")
      .then(function(){ renderFloorplanCard(); });
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
      txt.textContent = "LIVE NOW — " + (live.title ? live.title + " · " : "") + "streaming from the shop floor";
      btn.hidden = false; el.hidden = false;
    } else if(b.on && b.text){
      txt.textContent = b.text; btn.hidden = true; el.hidden = false;
    } else el.hidden = true;
  }

  function renderEditors(){
    renderSite(); renderHours(); renderBannerCard(); renderLinks(); renderShowCard(); renderLiveCard();
    evWork = evFromConfig(); evReady = true; renderEvEditor(); renderReviewsCard(); renderFloorplanCard(); renderCfgUpdated();
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
