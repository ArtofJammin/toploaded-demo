  /* ---------- site config ----------
     TL.config is the live settings object; its shape is config.default.json (built in
     as window.TL_DEFAULT_CONFIG). Layers, lowest → highest: defaults → localStorage
     "config" (admin edits made without an API) → GET /config from the worker.

       TL.saveConfig(patch) merges the patch, persists it (PUT /config when an admin
         is logged in and online, always localStorage too), emits 'config:change'.
       TL.shopStatus(date?) → {open, label, sub} computed from config.hours in the shop's timezone
       TL.nextEvent(date?)  → {event, when:Date} next play night from config.events
       TL.nextShow(date?)   → Date of the next card show (config.show.date if still ahead,
                              else the first Saturday of the following month)
  */
  function deepMerge(a, b){
    if(Array.isArray(b)) return b.slice();
    if(!b || typeof b !== "object") return b;
    var out = (a && typeof a === "object" && !Array.isArray(a)) ? a : {};
    Object.keys(b).forEach(function(k){
      var v = b[k];
      out[k] = (v && typeof v === "object" && !Array.isArray(v)) ? deepMerge(out[k], v) : (Array.isArray(v) ? v.slice() : v);
    });
    return out;
  }
  TL.deepMerge = deepMerge;
  TL.config = deepMerge({}, window.TL_DEFAULT_CONFIG || {});
  TL.saveConfig = function(patch){
    TL.config = deepMerge(TL.config, patch);
    TL.config.updatedAt = new Date().toISOString();
    TL.store.set("config", deepMerge(TL.store.get("config", {}) || {}, patch));
    TL.emit("config:change", {config: TL.config, patch: patch});
    if(patch && patch.live) TL.emit("live:change", {live: TL.config.live});
    if(TL.api.online && TL.api.role === "admin"){
      return TL.api.put("/config", patch).catch(function(e){
        if(TL.toast) TL.toast("Saved on this device only — server said: " + (e.error || "error"));
      });
    }
    return Promise.resolve();
  };
  /* ---- time helpers (shop timezone) ---- */
  var DOW = ["sun","mon","tue","wed","thu","fri","sat"];
  function tzParts(date){
    try {
      var f = new Intl.DateTimeFormat("en-US", {timeZone: TL.config.timezone || "America/New_York", weekday:"short", hour:"numeric", minute:"numeric", hour12:false});
      var p = {}; f.formatToParts(date).forEach(function(x){ p[x.type] = x.value; });
      var h = parseInt(p.hour, 10); if(h === 24) h = 0;
      return {dow: DOW.indexOf(p.weekday.toLowerCase().slice(0,3)), min: h * 60 + parseInt(p.minute, 10)};
    } catch(e){ return {dow: date.getDay(), min: date.getHours() * 60 + date.getMinutes()}; }
  }
  function hm(s){ var a = String(s).split(":"); return parseInt(a[0], 10) * 60 + parseInt(a[1] || "0", 10); }
  function fmtMin(m){ var h = Math.floor(m / 60) % 24, mm = m % 60, ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return h + (mm ? ":" + TL.pad2(mm) : "") + " " + ap; }
  var DAYN = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  TL.shopStatus = function(date){
    var now = tzParts(date || new Date()), hours = TL.config.hours || {};
    var today = hours[DOW[now.dow]];
    if(today && now.min >= hm(today[0]) && now.min < hm(today[1])){
      var left = hm(today[1]) - now.min;
      return {open: true, label: "Open now", sub: left <= 60 ? "Closes in " + left + " min" : "Closes at " + fmtMin(hm(today[1]))};
    }
    if(today && now.min < hm(today[0])){
      return {open: false, label: "Closed", sub: "Opens today at " + fmtMin(hm(today[0]))};
    }
    for(var i = 1; i <= 7; i++){
      var d = (now.dow + i) % 7, hrs = hours[DOW[d]];
      if(hrs) return {open: false, label: "Closed", sub: "Opens " + (i === 1 ? "tomorrow" : DAYN[d]) + " at " + fmtMin(hm(hrs[0]))};
    }
    return {open: false, label: "Closed", sub: ""};
  };
  TL.nextEvent = function(date){
    var now = date || new Date(), t = tzParts(now), best = null;
    (TL.config.events || []).forEach(function(ev){
      if(typeof ev.dow !== "number" || !ev.start) return;
      var days = (ev.dow - t.dow + 7) % 7;
      if(days === 0 && hm(ev.start) <= t.min) days = 7;
      var when = new Date(now.getTime() + days * 864e5);
      when.setHours(Math.floor(hm(ev.start) / 60), hm(ev.start) % 60, 0, 0);
      if(!best || when < best.when) best = {event: ev, when: when};
    });
    return best;
  };
  TL.nextShow = function(date){
    var now = date || new Date(), s = TL.config.show || {};
    if(s.date){
      var d = new Date(s.date + "T" + (s.end || "16:00") + ":00");
      if(!isNaN(d) && d > now) return new Date(s.date + "T" + (s.start || "10:00") + ":00");
    }
    var m = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    while(m.getDay() !== 6) m.setDate(m.getDate() + 1);
    m.setHours(10, 0, 0, 0);
    return m;
  };
  TL.on("init", function(){
    var local = TL.store.get("config", null);
    if(local && typeof local === "object") TL.config = deepMerge(TL.config, local);
    TL.emit("config:change", {config: TL.config, patch: local || {}});
  });
  TL.on("api:ready", function(d){
    if(!d || !d.online) return;
    TL.api.get("/config", {noAuth: true}).then(function(c){
      if(!c || typeof c !== "object") return;
      TL.config = deepMerge(TL.config, c);
      TL.emit("config:change", {config: TL.config, patch: c});
      TL.emit("live:change", {live: TL.config.live});
    }).catch(function(){});
  });
