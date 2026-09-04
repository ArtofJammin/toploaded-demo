  /* ---------- live breaks ----------
     State comes from TL.config.live ({on, title, platform, embed, spotPrice, spots,
     packsPerSpot, pack?, packs?, taken?, schedule:[{day,time,name,desc}]}); the
     module re-renders on 'live:change' and 'config:change'.
     API online: GET /live (spots, viewers, live state) every 10 s, GET /live/chat
     every 3 s, POST /live/viewers heartbeat every 20 s, claims via
     POST /live/spots/claim, releases via POST /live/spots/release. Every timer runs
     only while the Live view is showing AND the tab is visible.
     API offline, or the live endpoints answering 404: simulated chat and viewers,
     localStorage spot claims ("liveSpots"), newsletter signups into TL.store "forms".
       TL.live.state()          {on, active, online, embed, spots:{taken, mine, total, price}}
       TL.live.refresh()        re-fetch /live (online) or re-render (offline)
       TL.live.claim(n, el?)    same path as clicking a spot button
       TL.live.release(n)       free a spot you hold
       TL.live.rip(item?)       advance "now ripping" with a pull; emits 'live:rip'
       TL.live.pushChat(user, text, sys)
     Events: 'live:rip' {item, pack, total, hit}   'live:spot' {spot, el, item}
     DOM events for motion modules: 'tl:live-state' {on}, 'tl:spot-claimed' {n, el},
     'tl:live-rip' {item, pack, total, hit}.
     Ids other modules rely on: #chatBody #chatForm #chatInput #spotGrid #viewerCount #livePillText */
  var LV_DAYS = ["sun","mon","tue","wed","thu","fri","sat"];
  var CHAT_FEED = [
    ["mike_pulls", "LETS GO that alt art was insane"],
    ["nky_collector", "how many spots left?"],
    ["sarah_tcg", "shipping was crazy fast last week btw"],
    ["breakz_bill", "my spot is up next, no whammies"],
    ["gundam_greg", "any gundam breaks coming?"],
    ["toploaded_shop", "Gundam locals Saturday 1 PM — breaks soon after"],
    ["jess_rips", "chase card is still in there I can feel it"],
    ["cincy_cards", "W shop"],
    ["packrat_pete", "see everyone at the Turfway show, first weekend of the month"]
  ];
  var LV_HYPE = ["LETS GOOOO", "no way", "W pull", "that's the chase!!", "sheesh", "pack luck is unreal tonight", "who had that spot??"];
  var lv = {
    booted: false, active: false, api: null, mounted: "", timers: {}, sid: null, name: "",
    taken: {}, mine: {}, claimAt: {}, demoTaken: [2, 5, 9], total: 12, price: 24.99,
    viewers: 214, chatIdx: 0, chatMode: "", chatSeen: {}, chatSeenN: 0, chatSince: 0, chatBusy: false, lastReact: 0,
    pack: 7, packs: 36, ripped: 0, hitPool: [], hits: [], hitMap: {}, lastRip: ""
  };
  function liveCfg(){ return (TL.config && TL.config.live) || {}; }
  function liveIsOn(){ return !!liveCfg().on; }
  function liveOnline(){ return !!(TL.api && TL.api.online) && lv.api !== false; }
  function lvSid(){ var s = TL.session.get("sid", null); if(!s){ s = TL.uid(); TL.session.set("sid", s); } return s; }
  function lvEl(id){ return document.getElementById(id); }
  function lvDispatch(name, detail){ try { document.dispatchEvent(new CustomEvent(name, {detail: detail})); } catch(e){} }
  /* ---- timers: named, and only alive while the view shows and the tab is visible ---- */
  function lvStop(name){ if(lv.timers[name]){ clearTimeout(lv.timers[name]); clearInterval(lv.timers[name]); delete lv.timers[name]; } }
  function lvStopAll(){ Object.keys(lv.timers).forEach(lvStop); }
  function lvEvery(name, fn, ms){ lvStop(name); lv.timers[name] = setInterval(fn, ms); }
  function lvLater(name, fn, ms){ lvStop(name); lv.timers[name] = setTimeout(fn, ms); }
  function lvStart(){
    lvStopAll();
    if(!lv.active || document.hidden) return;
    var on = liveIsOn(), online = liveOnline();
    if(online){
      lvRefresh(); lvEvery("spots", lvRefresh, 10000);
      lvPollChat(); lvEvery("chat", lvPollChat, 3000);
      if(on){ lvHeartbeat(); lvEvery("viewers", lvHeartbeat, 20000); }
    } else {
      lvChatMode("sim");
      lvEvery("chat", lvSimChat, 4200);
      if(on) lvEvery("viewers", lvSimViewers, 5000);
    }
    if(on) lvScheduleRip(); else { lvRenderOffair(); lvEvery("clock", lvRenderOffair, 60000); }
  }
  /* ---- schedule helpers (shop timezone) ---- */
  function lvTzNow(){
    try {
      var f = new Intl.DateTimeFormat("en-US", {timeZone: TL.config.timezone || "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false});
      var p = {}; f.formatToParts(new Date()).forEach(function(x){ p[x.type] = x.value; });
      var h = parseInt(p.hour, 10); if(h === 24) h = 0;
      return {dow: LV_DAYS.indexOf(String(p.weekday).slice(0, 3).toLowerCase()), min: h * 60 + parseInt(p.minute, 10)};
    } catch(e){ var d = new Date(); return {dow: d.getDay(), min: d.getHours() * 60 + d.getMinutes()}; }
  }
  function lvParseTime(s){
    var m = String(s || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i);
    if(!m) return null;
    var h = parseInt(m[1], 10), mm = parseInt(m[2] || "0", 10), ap = (m[3] || "").toLowerCase();
    if(ap === "p" && h < 12) h += 12;
    if(ap === "a" && h === 12) h = 0;
    if(h > 23 || mm > 59) return null;
    return h * 60 + mm;
  }
  function lvNextStream(){
    var sched = liveCfg().schedule || [], now = lvTzNow(), best = null;
    for(var i = 0; i < sched.length; i++){
      var s = sched[i], dow = LV_DAYS.indexOf(String(s.day || "").slice(0, 3).toLowerCase()), t = lvParseTime(s.time);
      if(dow < 0 || t === null) continue;
      var delta = ((dow - now.dow + 7) % 7) * 1440 + (t - now.min);
      if(delta < -180) delta += 10080; /* more than 3 h ago: next week */
      if(!best || delta < best.delta) best = {entry: s, delta: delta};
    }
    return best;
  }
  function lvFmtDelta(m){
    if(m <= 0) return "starting any minute";
    var d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    if(d) return "in " + d + "d " + h + "h";
    if(h) return "in " + h + "h " + mm + "m";
    return "in " + mm + " min";
  }
  /* ---- embed ---- */
  function lvParseEmbed(cfg){
    var url = String(cfg.embed || "").trim(), plat = String(cfg.platform || "").toLowerCase(), m;
    if(!url && plat === "whatnot" && TL.config.links && TL.config.links.whatnot) url = String(TL.config.links.whatnot).trim();
    if(!url || !/^https?:\/\//i.test(url)) return null;
    var host = encodeURIComponent(location.hostname || "localhost");
    if((m = url.match(/youtube\.com\/channel\/(UC[\w-]+)\/live/i))) return {kind: "youtube", src: "https://www.youtube.com/embed/live_stream?channel=" + m[1] + "&autoplay=1&mute=1&playsinline=1", href: url};
    if((m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i))) return {kind: "youtube", src: "https://www.youtube.com/embed/" + m[1] + "?autoplay=1&mute=1&playsinline=1", href: url};
    if((m = url.match(/twitch\.tv\/videos\/(\d+)/i))) return {kind: "twitch", src: "https://player.twitch.tv/?video=v" + m[1] + "&parent=" + host + "&autoplay=true&muted=true", href: url};
    if((m = url.match(/twitch\.tv\/([\w]+)/i))) return {kind: "twitch", src: "https://player.twitch.tv/?channel=" + m[1] + "&parent=" + host + "&autoplay=true&muted=true", href: url};
    if(/whatnot\.com/i.test(url) || plat === "whatnot") return {kind: "whatnot", href: url};
    return {kind: "link", href: url};
  }
  /* ---- rendering ---- */
  function lvLoadCfg(){
    var cfg = liveCfg();
    if(lv.api !== true){ lv.total = Number(cfg.spots) > 0 ? Number(cfg.spots) : 12; lv.price = Number(cfg.spotPrice) > 0 ? Number(cfg.spotPrice) : 24.99; }
    if(Array.isArray(cfg.taken)) lv.demoTaken = cfg.taken.map(Number);
    if(lv.api !== true){
      lv.taken = {};
      lv.demoTaken.forEach(function(n){ if(n >= 1 && n <= lv.total) lv.taken[n] = true; });
      Object.keys(lv.mine).forEach(function(n){ lv.taken[n] = true; });
    }
    lv.packs = Number(cfg.packs) > 0 ? Number(cfg.packs) : (Number(cfg.spots) > 0 ? Number(cfg.spots) : 12) * (Number(cfg.packsPerSpot) > 0 ? Number(cfg.packsPerSpot) : 3);
    if(Number(cfg.pack) > 0) lv.pack = Math.min(lv.packs, Number(cfg.pack));
  }
  function lvRenderAll(){ lvRenderState(); lvRenderSpots(); lvRenderSchedule(); lvRenderRip(); lvRenderOffair(); lvRenderNotify(); lvRenderNameRow(); }
  function lvRenderState(){
    var on = liveIsOn(), cfg = liveCfg(), emb = lvParseEmbed(cfg), root = document.documentElement;
    var was = lv.on; /* tracked here — other modules toggle html.is-live too, so the class is not a reliable "before" */
    lv.on = on;
    root.classList.toggle("is-live", on);
    var pt = lvEl("livePillText"); if(pt) pt.textContent = on ? "Live" : "Offline";
    var title = lvEl("liveTitle"); if(title) title.textContent = cfg.title || "Live break";
    var sub = lvEl("liveSub"), tag = lvEl("liveDemoTag"), screen = lvEl("liveScreen");
    if(on){
      if(emb && emb.src){ if(sub) sub.textContent = "Streaming live on " + (emb.kind === "youtube" ? "YouTube" : "Twitch") + " · claim a spot below"; if(tag) tag.hidden = true; }
      else if(emb){ if(sub) sub.textContent = "Streaming live on Whatnot — open the stream to watch and bid"; if(tag) tag.hidden = true; }
      else { if(sub) sub.textContent = "Simulated stream — the live site embeds Whatnot, YouTube, or Twitch here"; if(tag){ tag.hidden = false; tag.textContent = "simulated stream"; } }
    } else {
      var ns = lvNextStream();
      if(sub) sub.textContent = ns ? "Off air · next stream " + ns.entry.day + " " + ns.entry.time + " · " + lvFmtDelta(ns.delta) + (ns.entry.name ? " · " + ns.entry.name : "") : "Off air · schedule coming soon";
      if(tag) tag.hidden = true;
    }
    if(screen){ screen.classList.toggle("off", !on); screen.classList.toggle("embedded", !!(on && emb && emb.src)); }
    var head = lvEl("spotHead"); if(head) head.textContent = on ? "Claim a spot in this break" : "Claim a spot in the next break";
    var hl = lvEl("hitsLabel"); if(hl) hl.textContent = on ? "Recent hits" : "Last break's hits";
    var vn = lvEl("viewerNum"); if(vn && on && !vn.dataset.set){ vn.dataset.set = "1"; vn.textContent = lv.viewers; }
    var ct = lvEl("chatTag"); if(ct){ ct.hidden = liveOnline() && lv.api === true; ct.textContent = on ? "simulated" : "replay · simulated"; }
    if(was !== on){ lvDispatch("tl:live-state", {on: on}); }
  }
  function lvRenderPlayer(){
    var host = lvEl("liveEmbed"), stage = lvEl("liveStage"); if(!host || !stage) return;
    var cfg = liveCfg(), on = liveIsOn(), emb = on ? lvParseEmbed(cfg) : null;
    var want = (emb && lv.active) ? (emb.src ? "iframe:" + emb.src : "card:" + emb.href) : "";
    if(lv.mounted === want) return;
    lv.mounted = want;
    host.innerHTML = "";
    if(!want){ host.hidden = true; stage.hidden = false; return; }
    host.hidden = false;
    stage.hidden = !!emb.src;
    if(emb.src){
      var f = document.createElement("iframe");
      f.src = emb.src;
      f.title = (cfg.title || "Live stream") + " — " + (emb.kind === "youtube" ? "YouTube" : "Twitch") + " player";
      f.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
      f.setAttribute("allowfullscreen", "");
      f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      host.appendChild(f);
    } else {
      var wn = emb.kind === "whatnot";
      host.innerHTML = '<div class="embed-card"><span class="embed-k">' + (wn ? "Live on Whatnot" : "Live stream") + '</span><b>' + esc(cfg.title || "Live break") + '</b>' +
        '<a class="btn" href="' + esc(emb.href) + '" target="_blank" rel="noopener noreferrer">Watch on ' + (wn ? "Whatnot" : "the stream") + ' ↗<span class="sr-only"> (opens in a new tab)</span></a>' +
        '<span class="embed-sub">Whatnot has no embed — the break runs in their app, spots and chat stay here.</span></div>';
    }
  }
  function lvRenderOffair(){
    var box = lvEl("liveOffair"); if(!box) return;
    var on = liveIsOn();
    box.hidden = on;
    if(on) return;
    var ns = lvNextStream(), nx = lvEl("liveNext"), cd = lvEl("liveCountdown"), sub = lvEl("liveSub");
    if(!ns){ if(nx) nx.textContent = "Schedule coming soon"; if(cd) cd.textContent = ""; return; }
    var nextText = "Next stream · " + ns.entry.day + " " + ns.entry.time;
    if(nx && nx.textContent !== nextText) nx.textContent = nextText;
    if(cd) cd.textContent = lvFmtDelta(ns.delta);
    if(sub) sub.textContent = "Off air · next stream " + ns.entry.day + " " + ns.entry.time + " · " + lvFmtDelta(ns.delta) + (ns.entry.name ? " · " + ns.entry.name : "");
  }
  function lvRenderSchedule(){
    var host = lvEl("liveSchedule"); if(!host) return;
    var sched = liveCfg().schedule || [], ns = lvNextStream();
    host.innerHTML = sched.map(function(s){
      var next = !!(ns && ns.entry === s);
      return '<div class="panel' + (next ? " next" : "") + '"><span class="num">' + esc(s.day || "") + ' · ' + esc(s.time || "") +
        (next ? '<em class="next-tag">Next up</em>' : "") + '</span><h3>' + esc(s.name || "Stream") + '</h3><p>' + esc(s.desc || "") + '</p></div>';
    }).join("") || '<p class="lede">Stream schedule coming soon — follow us on Instagram for go-live posts.</p>';
  }
  function lvRenderRip(){
    var el = lvEl("ripLabel"); if(!el) return;
    var cfg = liveCfg(), text = liveIsOn()
      ? "Now ripping · pack " + lv.pack + " of " + lv.packs
      : "Next break · " + lv.packs + " packs · " + (Number(cfg.spots) > 0 ? Number(cfg.spots) : lv.total) + " spots";
    if(text === lv.lastRip) return;
    lv.lastRip = text;
    el.textContent = text;
    if(!reduceMotion){ el.classList.remove("roll"); void el.offsetWidth; el.classList.add("roll"); }
  }
  function lvRenderNotify(){
    var wrap = lvEl("liveNotify"), form = lvEl("notifyForm"), msg = lvEl("notifyMsg"); if(!wrap) return;
    var on = liveIsOn(), email = TL.store.get("liveNotify", "");
    wrap.hidden = on;
    if(on) return;
    if(email){
      form.hidden = true; msg.hidden = false;
      msg.innerHTML = "We'll email <b>" + esc(email) + "</b> before we go live. <button class=\"linklike\" type=\"button\" id=\"notifyChange\">Change</button>";
    } else { form.hidden = false; msg.hidden = true; msg.textContent = ""; var b = form.querySelector("button"); if(b) b.disabled = false; }
  }
  function lvRenderNameRow(){
    var row = lvEl("chatNameRow"), as = lvEl("chatAs"); if(!row) return;
    var online = liveOnline();
    row.hidden = !(online && !lv.name);
    if(as){ as.hidden = !lv.name; as.textContent = "as " + lv.name; as.setAttribute("aria-label", "Chatting as " + lv.name + " — change display name"); }
  }
  /* ---- spots ---- */
  function lvSaveSpots(){ TL.store.set("liveSpots", {mine: lv.mine}); }
  function lvSpotsLeft(){ var left = 0; for(var i = 1; i <= lv.total; i++){ if(!lv.taken[i]) left++; } return left; }
  function lvRenderSpots(){
    var grid = lvEl("spotGrid"); if(!grid) return;
    var cfg = liveCfg(), html = "", left = lvSpotsLeft();
    for(var i = 1; i <= lv.total; i++){
      var t = !!lv.taken[i], m = !!lv.mine[i];
      html += '<button type="button" class="spot' + (m ? " mine" : t ? " taken" : "") + '" data-spot="' + i + '"' +
        (m ? ' aria-label="Spot ' + i + ' is yours — open cart"' : t ? ' disabled aria-label="Spot ' + i + ' taken"' : ' aria-label="Claim spot ' + i + ' for ' + esc(money(lv.price)) + '"') + '>' +
        (m ? "Yours" : t ? "Taken" : "#" + i) + "</button>";
    }
    grid.innerHTML = html;
    var num = lvEl("spotsLeftNum"), so = lvEl("spotsOpen");
    if(so && num){
      TL.countUp(num, left);
      var tail = so.lastChild;
      if(tail && tail.nodeType === 3) tail.nodeValue = " of " + lv.total + (left === 0 ? " spots — sold out" : " spots left");
      so.classList.toggle("sold", left === 0);
    }
    var meter = lvEl("spotMeter");
    if(meter){
      var claimed = lv.total - left;
      meter.style.setProperty("--fill", String(lv.total ? claimed / lv.total : 0));
      meter.setAttribute("aria-valuemax", String(lv.total));
      meter.setAttribute("aria-valuenow", String(claimed));
      meter.setAttribute("aria-valuetext", claimed + " of " + lv.total + " spots claimed");
    }
    var sp = lvEl("spotPrice"); if(sp) sp.textContent = money(lv.price) + " per spot · " + (Number(cfg.packsPerSpot) > 0 ? Number(cfg.packsPerSpot) : 3) + " packs each";
  }
  function lvApplyServer(spots){
    if(!spots) return;
    if(Number(spots.total) > 0) lv.total = Number(spots.total);
    if(Number(spots.price) > 0) lv.price = Number(spots.price);
    lv.taken = {};
    (spots.taken || []).forEach(function(n){ n = Number(n); if(n >= 1) lv.taken[n] = true; });
    var serverMine = Array.isArray(spots.mine) ? spots.mine.map(Number) : null, changed = false;
    if(serverMine) serverMine.forEach(function(n){ if(n >= 1 && !lv.mine[n]){ lv.mine[n] = true; lv.claimAt[n] = lv.claimAt[n] || 0; changed = true; } });
    Object.keys(lv.mine).forEach(function(n){
      var settling = Date.now() - (lv.claimAt[n] || 0) < 15000;
      var ok = serverMine ? (serverMine.indexOf(Number(n)) > -1) : !!lv.taken[n];
      if(ok || settling){ lv.taken[n] = true; return; }
      delete lv.mine[n]; changed = true;
      toast("Your hold on spot #" + n + " expired — grab another");
    });
    if(changed) lvSaveSpots();
  }
  function lvSyncLiveCfg(remote){
    if(!remote || typeof remote !== "object" || !TL.config.live) return;
    if(Date.now() - (lv.localChangeAt || 0) < 8000) return; /* a local edit (admin PUT may still be in flight) wins for a moment */
    var keys = ["on", "embed", "platform", "title", "spotPrice", "spots", "packsPerSpot", "pack"], diff = false;
    keys.forEach(function(k){ if(k in remote && JSON.stringify(remote[k]) !== JSON.stringify(TL.config.live[k])) diff = true; });
    if(!diff) return;
    TL.config.live = TL.deepMerge(TL.config.live, remote);
    lv.syncing = true;
    try { TL.emit("live:change", {live: TL.config.live}); } finally { lv.syncing = false; }
  }
  function lvRefresh(){
    if(!liveOnline()){ lvRenderSpots(); return Promise.resolve(); }
    return TL.api.get("/live?sid=" + encodeURIComponent(lv.sid || ""), {noAuth: true}).then(function(d){
      var first = lv.api !== true;
      lv.api = true;
      if(d && d.spots){ lvApplyServer(d.spots); lvReconcileCart(); }
      if(d && typeof d.viewers === "number" && liveIsOn()) lvSetViewers(Math.max(1, d.viewers));
      lvRenderSpots();
      if(first) lvRenderState();
      if(d && d.live) lvSyncLiveCfg(d.live);
    }).catch(function(e){
      if(e && e.status === 404){ lv.api = false; lvLoadCfg(); lvRenderSpots(); lvRenderState(); if(lv.active) lvStart(); }
    });
  }
  function lvSpotItem(n){
    var cfg = liveCfg();
    return {id: "live-spot-" + n, name: "Break spot #" + n + " · " + (cfg.title || "Rip & ship break"), set: "Rip & ship · ships next morning",
      game: "pk", type: "sealed", cond: null, price: lv.price, stock: 1, live: true};
  }
  function lvAddToCart(item, el){
    if(TL.cart && typeof TL.cart.add === "function"){ try { TL.cart.add(item, 1, el); return true; } catch(e){ if(window.console) console.error("[TL:live] cart add", e); } }
    if(typeof cart === "object" && cart && typeof renderCart === "function"){
      if(!ITEMS.some(function(x){ return x.id === item.id; })) ITEMS.push(item);
      cart[item.id] = 1; renderCart(); return true;
    }
    return false;
  }
  function lvClaim(n, btn){
    n = Number(n);
    if(!(n >= 1 && n <= lv.total)) return Promise.resolve(false);
    if(lv.mine[n]){ if(TL.cart && TL.cart.open) TL.cart.open(); return Promise.resolve(true); }
    if(lv.taken[n]){ toast("Spot #" + n + " is taken"); return Promise.resolve(false); }
    if(btn){ btn.disabled = true; btn.classList.add("pending"); btn.textContent = "…"; }
    var online = liveOnline();
    function finish(){
      lv.mine[n] = true; lv.taken[n] = true; lv.claimAt[n] = Date.now(); lvSaveSpots();
      var item = lvSpotItem(n);
      lvAddToCart(item, btn);
      lvRenderSpots();
      if(btn && !reduceMotion){ var r = btn.getBoundingClientRect(); TL.confetti(r.left + r.width / 2, r.top + r.height / 2, {count: 36, spread: 70}); }
      pushChat(null, "you claimed spot #" + n, true);
      toast("Spot #" + n + " claimed — added to cart" + (lv.api === true ? "" : " (demo)"));
      TL.emit("live:spot", {spot: n, el: btn, item: item});
      lvDispatch("tl:spot-claimed", {n: n, el: lvEl("spotGrid") ? lvEl("spotGrid").querySelector('[data-spot="' + n + '"]') : null});
      return true;
    }
    if(!online) return Promise.resolve(finish());
    return TL.api.post("/live/spots/claim", {spot: n, name: lv.name || "", sid: lv.sid}).then(function(d){
      if(!d || d.ok === false) throw {status: 409};
      lv.api = true;
      lv.mine[n] = true; lv.claimAt[n] = Date.now();
      if(d.taken) lvApplyServer({taken: d.taken, mine: d.mine, total: d.total, price: d.price});
      return finish();
    }).catch(function(e){
      if(e && e.status === 409){
        var t = e.data && Array.isArray(e.data.taken) ? e.data.taken : null;
        if(t) lvApplyServer({taken: t}); else lv.taken[n] = true;
        lvRenderSpots(); toast("Spot #" + n + " was just taken — pick another"); lvRefresh(); return false;
      }
      if(e && e.status === 404){ lv.api = false; lvLoadCfg(); var ok = finish(); if(lv.active) lvStart(); return ok; }
      lvRenderSpots();
      toast(e && e.status === 429 ? "Too many claims — slow down" : "Couldn't claim that spot — try again");
      return false;
    });
  }
  function lvRelease(n, silent){
    n = Number(n);
    if(!lv.mine[n]) return;
    delete lv.mine[n]; delete lv.claimAt[n];
    if(lv.api !== true) delete lv.taken[n];
    lvSaveSpots(); lvRenderSpots();
    if(liveOnline() && lv.api === true){
      TL.api.post("/live/spots/release", {spot: n, sid: lv.sid}).catch(function(e){
        if(e && e.status === 403) toast("Spot #" + n + " is confirmed with the shop — call us to release it");
      }).then(function(){ if(lv.active) lvRefresh(); });
    }
    if(!silent) toast("Spot #" + n + " released");
  }
  function lvCartIds(lines){
    var ids = {};
    try {
      if(Array.isArray(lines)) lines.forEach(function(l){ var id = l && (l.item ? l.item.id : l.id); if(id && (l.qty === undefined || l.qty > 0)) ids[id] = true; });
      else if(TL.cart && typeof TL.cart.lines === "function") return lvCartIds(TL.cart.lines());
      else if(typeof cart === "object" && cart) Object.keys(cart).forEach(function(k){ if(cart[k] > 0) ids[k] = true; });
    } catch(e){}
    return ids;
  }
  function lvReconcileCart(lines){
    var ids = lvCartIds(lines);
    Object.keys(lv.mine).forEach(function(n){
      if(ids["live-spot-" + n]) return;
      if(Date.now() - (lv.claimAt[n] || 0) < 3000){ lvLater("recheck", function(){ lvReconcileCart(); }, 3200); return; } /* the add may still be in flight: look again shortly */
      lvRelease(n, true);
      toast("Spot #" + n + " released — it left your cart");
    });
  }
  /* ---- viewers ---- */
  function lvSetViewers(n){
    lv.viewers = n;
    var num = lvEl("viewerNum"), vc = lvEl("viewerCount");
    if(num){ num.dataset.set = "1"; TL.countUp(num, n); }
    if(vc && !reduceMotion){ vc.classList.remove("tick"); void vc.offsetWidth; vc.classList.add("tick"); }
  }
  function lvSimViewers(){ if(reduceMotion) return; lvSetViewers(Math.max(180, lv.viewers + Math.round(Math.random() * 14 - 7))); }
  function lvHeartbeat(){
    TL.api.post("/live/viewers", {sid: lv.sid}).then(function(d){ if(d && typeof d.viewers === "number") lvSetViewers(Math.max(1, d.viewers)); }).catch(function(){});
  }
  /* ---- chat ---- */
  function lvAtBottom(body){ return body.scrollHeight - body.scrollTop - body.clientHeight < 48; }
  /* emoji-only line (surrogate pairs, misc symbols, VS16, ZWJ, spaces) — char codes so the source stays ASCII */
  function lvEmojiOnly(t){
    if(!t || t.length > 8) return false;
    for(var i = 0; i < t.length; i++){
      var c = t.charCodeAt(i);
      if((c >= 0xD800 && c <= 0xDFFF) || (c >= 0x2600 && c <= 0x27BF) || c === 0xFE0F || c === 0x200D || c === 32) continue;
      return false;
    }
    return true;
  }
  function lvNewPill(show){ var p = lvEl("chatNew"); if(p) p.hidden = !show; }
  function pushChat(user, msg, sys, opts){
    opts = opts || {};
    var body = lvEl("chatBody"); if(!body) return;
    var stick = lvAtBottom(body);
    var text = String(msg == null ? "" : msg);
    var emojiOnly = lvEmojiOnly(text);
    var div = document.createElement("div");
    div.className = "chat-line" + (sys ? " sys" : "") + (opts.me ? " me" : "") + (emojiOnly ? " emoji" : "") + (opts.seed ? " seed" : "");
    if(sys) div.textContent = text;
    else div.innerHTML = "<b>" + esc(user || "guest") + "</b>" + esc(text);
    body.appendChild(div);
    while(body.children.length > 60) body.removeChild(body.firstChild);
    if(stick || opts.me || opts.seed){ body.scrollTop = body.scrollHeight; } else lvNewPill(true);
  }
  function lvChatMode(mode){
    if(lv.chatMode === mode) return;
    lv.chatMode = mode;
    var body = lvEl("chatBody"); if(!body) return;
    body.innerHTML = "";
    lv.chatSeen = {}; lv.chatSeenN = 0; lv.chatSince = 0;
    if(mode === "sim"){
      pushChat(null, liveIsOn() ? "Welcome to the break — chat is simulated for this demo" : "Off air — replaying chat from the last break (simulated)", true, {seed: true});
      CHAT_FEED.slice(0, 4).forEach(function(c){ pushChat(c[0], c[1], false, {seed: true}); });
      lv.chatIdx = 4;
    } else {
      pushChat(null, liveIsOn() ? "You're in the live chat — be cool, we ship what we pull" : "Chat is open while we're off air — say hi", true, {seed: true});
    }
    lvNewPill(false);
    var ct = lvEl("chatTag"); if(ct) ct.hidden = mode === "api";
  }
  function lvSimChat(){
    var c = CHAT_FEED[lv.chatIdx++ % CHAT_FEED.length];
    pushChat(c[0], c[1]);
  }
  function lvSeen(id){
    if(lv.chatSeen[id]) return true;
    lv.chatSeen[id] = true; lv.chatSeenN++;
    if(lv.chatSeenN > 400){ lv.chatSeen = {}; lv.chatSeenN = 0; lv.chatSeen[id] = true; }
    return false;
  }
  function lvAddServerMsg(m, seed){
    if(!m) return;
    var at = m.at, atN = typeof m.ts === "number" ? m.ts : (typeof at === "number" ? at : Date.parse(at));
    var id = m.id || (String(at) + ":" + m.user + ":" + m.text);
    if(lvSeen(id)) return;
    if(!isNaN(atN) && atN > lv.chatSince) lv.chatSince = atN;
    pushChat(m.user || "guest", m.text || "", !!m.sys, {me: !m.sys && !!lv.name && m.user === lv.name, seed: seed});
  }
  function lvPollChat(){
    if(lv.chatBusy) return;
    lv.chatBusy = true;
    var first = lv.chatMode !== "api"; /* first API poll loads the full history, whatever was posted before */
    TL.api.get("/live/chat?since=" + encodeURIComponent(String(first ? 0 : (lv.chatSince || 0))), {noAuth: true}).then(function(d){
      lv.chatBusy = false;
      lv.api = true;
      lvChatMode("api");
      var msgs = (d && d.messages) || [];
      msgs.forEach(function(m){ lvAddServerMsg(m, first); });
    }).catch(function(e){
      lv.chatBusy = false;
      if(e && e.status === 404){ lv.api = false; lvLoadCfg(); lvRenderSpots(); lvRenderState(); lvRenderNameRow(); if(lv.active) lvStart(); }
    });
  }
  function lvSendChat(text){
    if(liveOnline()){
      if(!lv.name){ lvRenderNameRow(); var ni = lvEl("chatNameInput"); if(ni){ lvEl("chatNameRow").hidden = false; ni.focus(); } toast("Pick a display name first"); return; }
      TL.api.post("/live/chat", {user: lv.name, text: text}).then(function(d){
        var m = d && (d.message || (d.id ? d : null));
        if(m && m.id){ lvAddServerMsg(m); } else lvPollChat();
      }).catch(function(e){
        if(e && e.status === 404){ lv.api = false; pushChat(lv.name || "you", text, false, {me: true}); if(lv.active) lvStart(); return; }
        toast(e && e.status === 429 ? "Slow down — chat is rate limited" : "Message didn't send — try again");
      });
    } else pushChat(lv.name || "you", text, false, {me: true});
  }
  function lvFloat(em, btn){
    if(reduceMotion) return;
    var layer = lvEl("reactLayer"); if(!layer) return;
    var r = btn.getBoundingClientRect(), lr = layer.getBoundingClientRect();
    var s = document.createElement("span");
    s.className = "react"; s.textContent = em;
    s.style.setProperty("--x", Math.round(Math.max(20, Math.min(lr.width - 20, r.left + r.width / 2 - lr.left))) + "px");
    s.style.setProperty("--dx", Math.round(Math.random() * 44 - 22) + "px");
    layer.appendChild(s);
    s.addEventListener("animationend", function(){ if(s.parentNode) s.parentNode.removeChild(s); });
    setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s); }, 2200);
    while(layer.children.length > 12) layer.removeChild(layer.firstChild);
  }
  /* ---- pack progress + recent hits ---- */
  function lvBuildPool(){
    var pool = [], sum = TL.inventory && TL.inventory.summary;
    if(sum && sum.top && sum.top.length){
      sum.top.slice(0, 24).forEach(function(p){
        if(!p || !p.id) return;
        var l = (p.listings || [])[0] || {}, pid = encodeURIComponent(String(p.id));
        pool.push({id: "tcg-" + p.id, name: String(p.name || "Card"), set: String(p.set || "") + (p.rarity ? " · " + p.rarity : ""), lineName: p.line,
          game: (p.game === "pk" || p.game === "op" || p.game === "mtg") ? p.game : "other", type: "single", cond: null,
          price: Number(l.price || p.market || 0), stock: Number(l.qty || 1), tcg: true, market: p.market, rarity: p.rarity,
          img: "https://tcgplayer-cdn.tcgplayer.com/product/" + pid + "_in_200x200.jpg", url: "https://www.tcgplayer.com/product/" + pid + "?seller=5c356cdf"});
      });
    }
    if(!pool.length) pool = ITEMS.filter(function(i){ return i.type === "single"; }).slice().sort(function(a, b){ return b.price - a.price; });
    lv.hitPool = pool;
  }
  function lvPickHit(){
    var pool = lv.hitPool; if(!pool.length) return null;
    var i = Math.floor(Math.random() * Math.min(pool.length, 12));
    return pool[i];
  }
  function lvHitArt(it){
    if(it.img) return '<img src="' + esc(it.img) + '" alt="" loading="lazy" decoding="async" onerror="this.style.display=\'none\'">';
    try { return cardArt(it); } catch(e){ return ""; }
  }
  function lvAddHit(it, fresh){
    var row = lvEl("hitsRow"); if(!row || !it) return;
    lv.hitMap[it.id] = it;
    var b = document.createElement("button");
    b.type = "button"; b.className = "hit" + (fresh && !reduceMotion ? " new" : "");
    b.setAttribute("data-hit", it.id);
    b.setAttribute("aria-label", it.name + " · " + money(it.price) + " — view card");
    b.innerHTML = '<span class="hit-art">' + lvHitArt(it) + '</span><span class="hit-meta"><b>' + esc(it.name) + '</b><span>' + esc(money(it.price)) + (it.set ? " · " + esc(String(it.set).split(" · ")[0]) : "") + '</span></span>';
    row.insertBefore(b, row.firstChild);
    while(row.children.length > 6) row.removeChild(row.lastChild);
    lv.hits.unshift(it); lv.hits = lv.hits.slice(0, 6);
  }
  function lvSeedHits(){
    var row = lvEl("hitsRow"); if(!row) return;
    row.innerHTML = ""; lv.hits = [];
    var pool = lv.hitPool, order = [3, 1, 6, 2, 4];
    for(var i = order.length - 1; i >= 0; i--){ var it = pool[order[i] % pool.length]; if(it) lvAddHit(it, false); }
  }
  function lvScheduleRip(){ lvLater("rip", function(){ lvRip(); lvScheduleRip(); }, 16000 + Math.random() * 6000); }
  function lvRip(item){
    if(!liveIsOn()) return;
    lv.pack = (lv.pack % lv.packs) + 1;
    lv.ripped++;
    var hit = !!item || Math.random() < 0.28;
    if(hit && !item) item = lvPickHit();
    lvRenderRip();
    if(hit && item){
      lvAddHit(item, true);
      pushChat(null, "pulled: " + item.name + " · " + money(item.price), true);
      var who = CHAT_FEED[Math.floor(Math.random() * CHAT_FEED.length)][0];
      lvLater("hype", function(){ pushChat(who, LV_HYPE[Math.floor(Math.random() * LV_HYPE.length)]); }, 700);
    }
    var detail = {item: item || null, pack: lv.pack, total: lv.packs, hit: hit};
    TL.emit("live:rip", detail);
    lvDispatch("tl:live-rip", detail);
  }
  /* ---- boot / lifecycle ---- */
  function lvBoot(){
    if(lv.booted) return;
    lv.booted = true;
    lv.sid = lvSid();
    lv.name = String(TL.store.get("chatName", "") || "").slice(0, 24);
    var st = TL.store.get("liveSpots", null);
    if(st && st.mine && typeof st.mine === "object") Object.keys(st.mine).forEach(function(n){ if(Number(n) >= 1) lv.mine[Number(n)] = true; });
    lvLoadCfg(); lvBuildPool(); lvSeedHits(); lvChatMode("sim");
    lvRenderAll();
  }
  function lvEnter(){ lvBoot(); lv.active = true; lvRenderPlayer(); lvStart(); }
  function lvLeave(){ lv.active = false; lvStopAll(); lvRenderPlayer(); }
  /* lvBoot can run early (the router emits view:change during its own init when the page
     lands on #/live); the cart reconcile waits for this file's init slot, after 35-cart loaded */
  TL.on("init", function(){ lvBoot(); lvReconcileCart(); });
  TL.on("view:change", function(d){ if(!d || d.name !== "live") return; if(d.paramsOnly && lv.active) return; lvEnter(); });
  TL.on("view:leave", function(d){ if(d && d.name === "live") lvLeave(); });
  TL.on("api:ready", function(){ if(lv.booted){ lvRenderNameRow(); lvRenderState(); } if(lv.active) lvStart(); });
  TL.on("live:change", function(){
    if(!lv.syncing) lv.localChangeAt = Date.now();
    lvBoot(); lvLoadCfg(); lvRenderAll();
    if(lv.active){ lvRenderPlayer(); lvStart(); }
  });
  TL.on("config:change", function(){ if(!lv.booted) return; lvLoadCfg(); lvRenderState(); lvRenderSchedule(); lvRenderSpots(); lvRenderRip(); lvRenderOffair(); lvRenderNotify(); });
  TL.on("inventory:summary", function(){ if(!lv.booted) return; lvBuildPool(); if(!lv.ripped) lvSeedHits(); });
  TL.on("cart:change", function(d){ if(!lv.booted) return; if(d && d.reason === "checkout") return; /* bought, keep the claim */ lvReconcileCart(d && d.lines); });
  document.addEventListener("visibilitychange", function(){ if(!lv.active) return; if(document.hidden) lvStopAll(); else lvStart(); });
  document.addEventListener("click", function(e){
    var s = e.target.closest("#spotGrid [data-spot]");
    if(s){ if(!s.disabled) lvClaim(s.dataset.spot, s); return; }
    var h = e.target.closest("#hitsRow [data-hit]");
    if(h){ var it = lv.hitMap[h.dataset.hit]; if(it) TL.openQuickView(it); return; }
    var nc = e.target.closest("#notifyChange");
    if(nc){ TL.store.del("liveNotify"); lvRenderNotify(); var ne = lvEl("notifyEmail"); if(ne){ ne.value = ""; ne.focus(); } return; }
    var as = e.target.closest("#chatAs");
    if(as){ var row = lvEl("chatNameRow"), ni = lvEl("chatNameInput"); if(row){ row.hidden = false; if(ni){ ni.value = lv.name; ni.focus(); ni.select(); } } return; }
    var np = e.target.closest("#chatNew");
    if(np){ var body = lvEl("chatBody"); if(body) body.scrollTop = body.scrollHeight; lvNewPill(false); return; }
    /* legacy cart (no TL.cart): a spot line removed with the minus button frees the spot */
    var dec = e.target.closest("[data-dec]");
    if(dec && !TL.cart && /^live-spot-\d+$/.test(dec.dataset.dec || "")) setTimeout(function(){ lvReconcileCart(); }, 0);
  });
  (function(){
    var body = lvEl("chatBody");
    if(body) body.addEventListener("scroll", function(){ if(lvAtBottom(body)) lvNewPill(false); }, {passive: true});
    var form = lvEl("chatForm");
    if(form) form.addEventListener("submit", function(e){
      e.preventDefault();
      var ni = lvEl("chatNameInput"), row = lvEl("chatNameRow"), inp = lvEl("chatInput");
      if(row && !row.hidden && ni){
        var nm = ni.value.trim().replace(/[<>]/g, "").slice(0, 24);
        if(nm){ lv.name = nm; TL.store.set("chatName", nm); row.hidden = true; lvRenderNameRow(); }
      }
      var text = inp ? inp.value.trim().slice(0, 200) : "";
      if(!text){ if(row && !row.hidden && ni && !ni.value.trim()){ ni.focus(); } return; }
      inp.value = "";
      lvSendChat(text);
      inp.focus();
    });
    var reacts = lvEl("chatReacts");
    if(reacts) reacts.addEventListener("click", function(e){
      var b = e.target.closest("[data-react]"); if(!b) return;
      var now = Date.now(); if(now - lv.lastReact < 350) return; lv.lastReact = now;
      var em = b.dataset.react;
      lvFloat(em, b);
      if(liveOnline()){
        TL.api.post("/live/chat", {user: lv.name || "guest", text: em}).then(function(d){ var m = d && (d.message || (d.id ? d : null)); if(m && m.id) lvAddServerMsg(m); })
          .catch(function(err){ if(err && err.status === 404){ lv.api = false; pushChat(lv.name || "you", em, false, {me: true}); if(lv.active) lvStart(); } });
      } else pushChat(lv.name || "you", em, false, {me: true});
    });
    var nf = lvEl("notifyForm");
    if(nf) nf.addEventListener("submit", function(e){
      e.preventDefault();
      var inp = lvEl("notifyEmail"), hp = lvEl("notifyHp"), btn = nf.querySelector("button[type=submit]");
      var email = inp ? inp.value.trim() : "";
      if(hp && hp.value) return;
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){ toast("Enter a valid email address"); if(inp) inp.focus(); return; }
      if(btn) btn.disabled = true;
      function local(){
        var forms = TL.store.get("forms", []); if(!Array.isArray(forms)) forms = [];
        forms.push({id: TL.uid(), kind: "newsletter", at: new Date().toISOString(), status: "new", local: true, email: email, topic: "live"});
        TL.store.set("forms", forms);
        return {ok: true, local: true};
      }
      TL.api.call("POST", "/forms/newsletter", {email: email, topic: "live", website: ""}, local)
        .catch(function(err){ if(err && err.status === 429) throw err; return local(); })
        .then(function(){
          TL.store.set("liveNotify", email);
          lvRenderNotify();
          toast("You're on the list — we'll email you before we go live");
        }, function(){ if(btn) btn.disabled = false; toast("Too many tries — wait a few minutes"); });
    });
  })();
  TL.live = TL.live || {};
  TL.live.state = function(){ return {on: liveIsOn(), active: lv.active, online: liveOnline(), embed: lvParseEmbed(liveCfg()), spots: {taken: Object.keys(lv.taken).map(Number), mine: Object.keys(lv.mine).map(Number), total: lv.total, price: lv.price}, pack: lv.pack, packs: lv.packs}; };
  TL.live.refresh = function(){ lvBoot(); return lvRefresh(); };
  TL.live.claim = function(n, el){ lvBoot(); return lvClaim(n, el || (lvEl("spotGrid") && lvEl("spotGrid").querySelector('[data-spot="' + Number(n) + '"]'))); };
  TL.live.release = function(n){ lvBoot(); lvRelease(n); };
  TL.live.rip = function(item){ lvBoot(); lvRip(item); };
  TL.live.pushChat = function(user, text, sys){ pushChat(user, text, sys); };
  TL.live.nextStream = lvNextStream;
