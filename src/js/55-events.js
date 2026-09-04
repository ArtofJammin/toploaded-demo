  /* ---------- play nights · card show · visit · footer ----------
     Everything here renders from TL.config (events, hours, show, links, address) on
     'init' and 'config:change'. Countdown / status timers run at 60 s and only while
     their view is active ('view:change' starts, 'view:leave' stops, hidden tab skips).
     Exposes TL.calendar {ics(evt), google(evt), menu(evt), forEvent(ev), forShow()} —
     evt = {uid, title, desc, location, start:{y,m,d,h,mi}, durationMin, rrule?, alarm?, url}
     so the home strip or anything else can offer the same add-to-calendar menu. */
  var EV_DUR_MIN = 180;                       /* play nights run about three hours */
  var EV_DOWS = ["sun","mon","tue","wed","thu","fri","sat"];
  var EV_DAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var EV_DAY_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var EV_MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var EV_BYDAY = ["SU","MO","TU","WE","TH","FR","SA"];
  var EV_GAME_LABEL = {pk:"Pokemon", op:"One Piece", mtg:"Magic", gundam:"Gundam", lorcana:"Lorcana", other:"Other"};
  function evShopTz(){ return TL.config.timezone || "America/New_York"; }
  function evTzNow(date){
    date = date || new Date();
    try {
      var f = new Intl.DateTimeFormat("en-US", {timeZone: evShopTz(), weekday:"short", year:"numeric", month:"numeric", day:"numeric", hour:"numeric", minute:"numeric", hour12:false});
      var p = {}; f.formatToParts(date).forEach(function(x){ p[x.type] = x.value; });
      var h = parseInt(p.hour, 10); if(h === 24) h = 0;
      return {y: +p.year, m: +p.month, d: +p.day, dow: EV_DOWS.indexOf(String(p.weekday).toLowerCase().slice(0, 3)), min: h * 60 + parseInt(p.minute, 10)};
    } catch(e){
      return {y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(), dow: date.getDay(), min: date.getHours() * 60 + date.getMinutes()};
    }
  }
  function evAddDays(ymd, n){ var d = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d) + n * 864e5); return {y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate()}; }
  function ymdCompact(o){ return o.y + TL.pad2(o.m) + TL.pad2(o.d); }
  function ymdIso(o){ return o.y + "-" + TL.pad2(o.m) + "-" + TL.pad2(o.d); }
  function dowOf(o){ return new Date(Date.UTC(o.y, o.m - 1, o.d)).getUTCDay(); }
  function evHmMin(s){ if(typeof s !== "string") return null; var a = s.split(":"); var h = parseInt(a[0], 10); if(isNaN(h)) return null; return h * 60 + (parseInt(a[1] || "0", 10) || 0); }
  function evClock(min){ if(min === null || min === undefined) return ""; var h = Math.floor(min / 60) % 24, mm = min % 60, ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return h + (mm ? ":" + TL.pad2(mm) : "") + " " + ap; }
  function evClockLong(min){ var h = Math.floor(min / 60) % 24, mm = min % 60, ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return h + ":" + TL.pad2(mm) + " " + ap; }
  function evFmtUntil(mins){
    if(mins <= 0) return "now";
    var d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    if(d > 0) return "in " + d + (d === 1 ? " day" : " days") + (h ? " " + h + " h" : "");
    if(h > 0) return "in " + h + " h" + (m ? " " + m + " min" : "");
    return "in " + m + " min";
  }
  function eventStart(ev){ return evHmMin(ev.start) !== null ? evHmMin(ev.start) : evParseClock(ev.time); }
  function evParseClock(s){ /* "5:00 PM" → minutes, or null */
    var m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]?/.exec(String(s || "")); if(!m) return null;
    var h = parseInt(m[1], 10) % 12, mi = parseInt(m[2] || "0", 10); if(/p/i.test(m[3])) h += 12; return h * 60 + mi;
  }
  function eventDow(ev){ if(typeof ev.dow === "number") return ev.dow; var i = EV_DAY_SHORT.map(function(d){ return d.toLowerCase(); }).indexOf(String(ev.day || "").slice(0, 3).toLowerCase()); return i; }
  /* next occurrence of a weekly event in shop time: {date:{y,m,d}, mins:minutes until start, running} */
  function evNextOcc(ev, now){
    var t = evTzNow(now), dow = eventDow(ev), sm = eventStart(ev);
    if(dow < 0 || sm === null) return null;
    var days = (dow - t.dow + 7) % 7, running = false;
    if(days === 0 && sm <= t.min){ if(t.min < sm + EV_DUR_MIN) running = true; else days = 7; }
    return {date: evAddDays(t, days), mins: days * 1440 + (sm - t.min), running: running, startMin: sm};
  }
  function evUpcoming(now){
    return (TL.config.events || []).map(function(ev){ var o = evNextOcc(ev, now); return o ? {ev: ev, occ: o} : null; })
      .filter(Boolean).sort(function(a, b){ return (a.occ.running ? -1e9 : a.occ.mins) - (b.occ.running ? -1e9 : b.occ.mins); });
  }
  function evFeeHtml(fee){
    var f = String(fee === undefined || fee === null ? "" : fee).trim();
    if(!f || /^(tbd|tba|\?)$/i.test(f)) return '<span class="fee-tbd">TBD</span>';
    if(/^(free|\$?0(\.00)?)$/i.test(f)) return '<span class="fee-free">Free</span>';
    return esc(f);
  }
  function evSlug(s){ return String(s || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function shopLocation(){ var a = TL.config.address || {}; return (TL.config.title === "Top Loaded" ? "Top Loaded Trading Cards" : (TL.config.title || "Top Loaded")) + ", " + [a.line1, a.city, (a.state || "") + " " + (a.zip || "")].filter(Boolean).join(", ").replace(/\s+,/g, ","); }
  function siteUrl(view){ return (location.origin && location.origin !== "null" ? location.origin + location.pathname : "https://artofjammin.github.io/toploaded-demo/") + "#/" + (view || ""); }

  /* ---- calendar builders ---- */
  function icsText(s){ return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function icsFold(line){ var out = "", i = 0; while(line.length - i > 73){ out += line.slice(i, i + 73) + "\r\n "; i += 73; } return out + line.slice(i); }
  function icsStamp(o){ return ymdCompact(o) + "T" + TL.pad2(o.h) + TL.pad2(o.mi) + "00"; }
  function icsEnd(o, dur){ var t = Date.UTC(o.y, o.m - 1, o.d, o.h, o.mi) + dur * 60000, d = new Date(t); return {y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes()}; }
  function vtimezone(tz){
    if(tz !== "America/New_York") return "";
    return ["BEGIN:VTIMEZONE", "TZID:America/New_York", "BEGIN:STANDARD", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;EV_BYDAY=1SU", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST", "END:STANDARD",
      "BEGIN:DAYLIGHT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;EV_BYDAY=2SU", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT", "END:DAYLIGHT", "END:VTIMEZONE"].join("\r\n") + "\r\n";
  }
  function buildIcs(evt){
    var tz = evShopTz(), now = new Date();
    var stamp = now.getUTCFullYear() + TL.pad2(now.getUTCMonth() + 1) + TL.pad2(now.getUTCDate()) + "T" + TL.pad2(now.getUTCHours()) + TL.pad2(now.getUTCMinutes()) + TL.pad2(now.getUTCSeconds()) + "Z";
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Top Loaded Trading Cards//Site//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    var body = vtimezone(tz) + ["BEGIN:VEVENT",
      "UID:" + (evt.uid || evSlug(evt.title) + "@toploadedtcg"),
      "DTSTAMP:" + stamp,
      "DTSTART;TZID=" + tz + ":" + icsStamp(evt.start),
      "DTEND;TZID=" + tz + ":" + icsStamp(icsEnd(evt.start, evt.durationMin || 180)),
      evt.rrule ? "RRULE:" + evt.rrule : null,
      icsFold("SUMMARY:" + icsText(evt.title)),
      evt.desc ? icsFold("DESCRIPTION:" + icsText(evt.desc)) : null,
      evt.location ? icsFold("LOCATION:" + icsText(evt.location)) : null,
      evt.url ? icsFold("URL:" + evt.url) : null,
      evt.alarm ? "BEGIN:VALARM\r\nTRIGGER:" + evt.alarm + "\r\nACTION:DISPLAY\r\nDESCRIPTION:" + icsText(evt.title) + "\r\nEND:VALARM" : null,
      "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
    return lines.join("\r\n") + "\r\n" + body + "\r\n";
  }
  function icsDataUrl(evt){ return "data:text/calendar;charset=utf-8," + encodeURIComponent(buildIcs(evt)); }
  function googleUrl(evt){
    var q = "action=TEMPLATE&text=" + encodeURIComponent(evt.title) +
      "&dates=" + icsStamp(evt.start) + "/" + icsStamp(icsEnd(evt.start, evt.durationMin || 180)) +
      "&ctz=" + encodeURIComponent(evShopTz()) +
      (evt.desc ? "&details=" + encodeURIComponent(evt.desc + (evt.url ? "\n" + evt.url : "")) : "") +
      (evt.location ? "&location=" + encodeURIComponent(evt.location) : "") +
      (evt.rrule ? "&recur=" + encodeURIComponent("RRULE:" + evt.rrule) : "");
    return "https://calendar.google.com/calendar/render?" + q;
  }
  function calIcon(){ return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'; }
  function calMenu(evt, opts){
    opts = opts || {};
    return '<div class="cal-menu">' +
      '<button type="button" class="' + (opts.cls || "cal-btn") + '" aria-haspopup="true" aria-expanded="false" aria-label="Add ' + esc(evt.title) + ' to your calendar">' + calIcon() + '<span>' + esc(opts.label || "Add to calendar") + '</span></button>' +
      '<div class="cal-pop" role="menu" hidden>' +
        '<a role="menuitem" class="cal-item" download="top-loaded-' + esc(evSlug(evt.title)) + '.ics" href="' + esc(icsDataUrl(evt)) + '">Apple / Outlook (.ics)</a>' +
        '<a role="menuitem" class="cal-item" target="_blank" rel="noopener noreferrer" href="' + esc(googleUrl(evt)) + '">Google Calendar</a>' +
      '</div></div>';
  }
  function calForEvent(ev){
    var occ = evNextOcc(ev); if(!occ) return null;
    return {uid: (ev.id || evSlug(ev.name)) + "@toploadedtcg", title: ev.name + " · Top Loaded", desc: (ev.small ? ev.small + ". " : "") + "Weekly at Top Loaded Trading Cards" + (ev.fee && !/tbd/i.test(ev.fee) ? " · entry " + ev.fee : "") + ".",
      location: shopLocation(), start: {y: occ.date.y, m: occ.date.m, d: occ.date.d, h: Math.floor(occ.startMin / 60), mi: occ.startMin % 60},
      durationMin: EV_DUR_MIN, rrule: "FREQ=WEEKLY;EV_BYDAY=" + EV_BYDAY[eventDow(ev)], url: siteUrl("events")};
  }
  function calForShow(){
    var s = TL.config.show || {}, d = TL.nextShow(); if(!d || isNaN(d)) return null;
    var st = evHmMin(s.start) !== null ? evHmMin(s.start) : 600, en = evHmMin(s.end) !== null ? evHmMin(s.end) : 960;
    return {uid: "show-" + d.getFullYear() + TL.pad2(d.getMonth() + 1) + TL.pad2(d.getDate()) + "@toploadedtcg", title: "Top Loaded Card Show",
      desc: "Monthly card show — vendors from across the Tri-State. Free admission" + (s.setup ? ", vendor setup from " + evClock(evHmMin(s.setup)) : "") + ".",
      location: [s.venue, s.address].filter(Boolean).join(", "), start: {y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: Math.floor(st / 60), mi: st % 60},
      durationMin: Math.max(60, en - st), rrule: null, alarm: "-P1D", url: siteUrl("show")};
  }
  TL.calendar = {ics: buildIcs, icsUrl: icsDataUrl, google: googleUrl, menu: calMenu, forEvent: calForEvent, forShow: calForShow, nextOccurrence: evNextOcc};
  /* calendar menu behaviour: delegated so re-rendered menus keep working */
  function closeCalMenus(except){
    $$(".cal-menu .cal-pop:not([hidden])").forEach(function(p){
      if(p.parentNode === except) return;
      p.hidden = true; var b = p.parentNode.querySelector("[aria-haspopup]"); if(b) b.setAttribute("aria-expanded", "false");
    });
  }
  document.addEventListener("click", function(e){
    var btn = e.target.closest(".cal-menu [aria-haspopup]");
    if(btn){
      var menu = btn.parentNode, pop = menu.querySelector(".cal-pop"), open = !pop.hidden;
      closeCalMenus(menu);
      pop.hidden = open; btn.setAttribute("aria-expanded", String(!open));
      if(!open){ var first = pop.querySelector(".cal-item"); if(first && e.detail === 0) first.focus(); }
      return;
    }
    if(e.target.closest(".cal-item")){ var m = e.target.closest(".cal-menu"); setTimeout(function(){ closeCalMenus(); }, 0); if(m) return; }
    if(!e.target.closest(".cal-menu")) closeCalMenus();
  });
  document.addEventListener("keydown", function(e){
    var menu = e.target.closest && e.target.closest(".cal-menu"); if(!menu) return;
    var btn = menu.querySelector("[aria-haspopup]"), pop = menu.querySelector(".cal-pop"), items = $$(".cal-item", pop);
    if(e.key === "Escape"){ if(!pop.hidden){ pop.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.focus(); e.preventDefault(); } return; }
    if(e.key === "ArrowDown" || e.key === "ArrowUp"){
      e.preventDefault();
      if(pop.hidden){ closeCalMenus(menu); pop.hidden = false; btn.setAttribute("aria-expanded", "true"); items[e.key === "ArrowDown" ? 0 : items.length - 1].focus(); return; }
      var i = items.indexOf(document.activeElement), n = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[n].focus();
    }
    if(e.key === "Tab" && !pop.hidden && document.activeElement === items[items.length - 1] && !e.shiftKey){ pop.hidden = true; btn.setAttribute("aria-expanded", "false"); }
  });

  /* ---- play nights ---- */
  function evClosedDays(){ var h = TL.config.hours || {}; return EV_DOWS.filter(function(d){ return h[d] === null || h[d] === undefined; }); }
  function nextOpenAfter(dow){ var h = TL.config.hours || {}; for(var i = 1; i <= 7; i++){ var d = (dow + i) % 7; if(h[EV_DOWS[d]]) return {dow: d, open: evHmMin(h[EV_DOWS[d]][0])}; } return null; }
  function renderSched(){
    var list = $("#schedList"); if(!list) return;
    var up = evUpcoming(), nextId = up.length ? up[0].ev : null;
    var rows = [];
    evClosedDays().forEach(function(d){
      var dow = EV_DOWS.indexOf(d), after = nextOpenAfter(dow);
      rows.push({dow: dow, sort: -1, html: '<div class="sched-row is-closed" role="listitem"><span class="sched-day">' + EV_DAY_SHORT[dow] + '</span>' +
        '<span class="sched-name">Shop closed<small>' + (after ? "Back " + EV_DAY_LONG[after.dow] + " at " + esc(evClock(after.open)) : "") + '</small></span>' +
        '<span class="sched-time">&mdash;</span><span class="sched-fee">&mdash;</span><span class="sched-cal"></span></div>'});
    });
    (TL.config.events || []).forEach(function(ev){
      var dow = eventDow(ev), occ = evNextOcc(ev), isNext = ev === nextId, evt = calForEvent(ev);
      var tag = isNext ? '<em class="next-tag">' + (occ.running ? "Happening now" : "Next up · " + esc(evFmtUntil(occ.mins))) + '</em>' : "";
      rows.push({dow: dow, sort: eventStart(ev) || 0, html: '<div class="sched-row' + (isNext ? " is-next" : "") + '" role="listitem" data-ev="' + esc(ev.id || "") + '">' +
        '<span class="sched-day">' + esc(ev.day || EV_DAY_SHORT[dow] || "") + '</span>' +
        '<span class="sched-name">' + esc(ev.name) + tag + '<small>' + esc(ev.small || "") + '</small></span>' +
        '<span class="sched-time">' + esc(ev.time || evClockLong(eventStart(ev))) + '</span>' +
        '<span class="sched-fee">' + evFeeHtml(ev.fee) + '</span>' +
        '<span class="sched-cal">' + (evt ? calMenu(evt, {label: "Calendar"}) : "") + '</span></div>'});
    });
    rows.sort(function(a, b){ var da = (a.dow + 6) % 7, db = (b.dow + 6) % 7; return da - db || a.sort - b.sort; });
    list.innerHTML = rows.map(function(r){ return r.html; }).join("");
    evRenderNextUp(up);
  }
  function evRenderNextUp(up){
    var el = $("#evNextUp"); if(!el) return;
    up = up || evUpcoming();
    if(!up.length){ el.innerHTML = ""; el.hidden = true; return; }
    var ev = up[0].ev, occ = up[0].occ, evt = calForEvent(ev);
    el.hidden = false;
    el.innerHTML = '<span class="nu-k">' + (occ.running ? "Happening now" : "Next play night") + '</span>' +
      '<b>' + esc(ev.name) + '</b><span class="nu-when">' + esc(EV_DAY_LONG[eventDow(ev)]) + " · " + esc(ev.time || evClock(eventStart(ev))) + '</span>' +
      '<span class="nu-count">' + (occ.running ? "doors open — come play" : esc(evFmtUntil(occ.mins))) + '</span>' +
      (evt ? calMenu(evt) : "");
  }
  function tickEvents(){ if(document.hidden) return; var up = evUpcoming(); evRenderNextUp(up);
    var nextEl = $("#schedList .is-next .next-tag"); if(nextEl && up.length){ nextEl.textContent = up[0].occ.running ? "Happening now" : "Next up · " + evFmtUntil(up[0].occ.mins); }
    var rowNow = $("#schedList .is-next"); if(rowNow && up.length && rowNow.dataset.ev !== (up[0].ev.id || "")) renderSched(); }
  function tcgplusIsGeneric(u){ return !u || /^https?:\/\/(www\.)?bandai-tcg-plus\.com\/?$/i.test(String(u).trim()); }
  function pkEvent(){ var evs = TL.config.events || []; return evs.filter(function(e){ return e.signup === "form"; })[0] || evs.filter(function(e){ return e.id === "pk-sun"; })[0] || evs.filter(function(e){ return e.game === "pk"; })[0] || null; }
  function renderSignups(){
    var evs = TL.config.events || [], plus = evs.filter(function(e){ return e.signup === "tcgplus"; });
    var eye = $("#tcgplusEyebrow");
    if(eye){
      var games = [], byDay = {}, order = [];
      plus.forEach(function(e){ var g = EV_GAME_LABEL[e.game] || e.name; if(games.indexOf(g) === -1) games.push(g); var d = e.day || EV_DAY_SHORT[eventDow(e)]; if(!byDay[d]){ byDay[d] = []; order.push(d); } byDay[d].push((e.time || evClock(eventStart(e))).replace(":00", "")); });
      eye.textContent = plus.length ? games.join(" & ") + " · " + order.map(function(d){ return d + " " + byDay[d].join(" & "); }).join(" · ") : "Bandai events";
    }
    var link = (TL.config.links || {}).tcgplus, generic = tcgplusIsGeneric(link), btn = $("#tcgplusBtn"), note = $("#tcgplusNote");
    if(btn){ btn.href = link || "https://www.bandai-tcg-plus.com/"; btn.innerHTML = (generic ? "Open Bandai TCG+" : "Open our store page") + " &rarr;"; }
    if(note) note.innerHTML = generic ? 'Search "Top Loaded" in the app for this week\u2019s events.' : 'That link goes straight to our store\u2019s event list in TCG+.';
    var pk = pkEvent(), eye2 = $("#pkEyebrow"), when = $("#pkWhen");
    if(pk){
      var occ = evNextOcc(pk);
      if(eye2) eye2.textContent = pk.name + " · " + EV_DAY_LONG[eventDow(pk)] + "s " + (pk.time || evClock(eventStart(pk)));
      if(when && occ) when.innerHTML = (occ.running ? "Running right now" : "Next one: <b>" + esc(EV_DAY_LONG[dowOf(occ.date)] + ", " + EV_MON_SHORT[occ.date.m - 1] + " " + occ.date.d) + "</b> · " + esc(pk.time || evClock(occ.startMin))) + (pk.fee && !/tbd/i.test(pk.fee) ? " · " + (/^(free|0)/i.test(pk.fee) ? "free to play" : "entry " + esc(pk.fee)) : "");
    }
    var ph = $("#pkPhone"); if(ph){ ph.href = "tel:" + (TL.config.phoneRaw || ""); ph.textContent = TL.config.phone || ""; }
  }
  function bindSignup(){
    var form = $("#pkSignup"); if(!form) return;
    TL.forms.bind(form, {
      kind: "signup",
      collect: function(f){
        var pk = pkEvent(), occ = pk ? evNextOcc(pk) : null, contact = $("#pkContact", f).value.trim();
        var out = {name: $("#pkName", f).value.trim(), seats: parseInt($("#pkCount", f).value, 10) || 1, eventId: pk ? (pk.id || "pk-sun") : "pk-sun", eventName: pk ? pk.name : "Pokemon League", website: $("#pkWebsite", f).value};
        if(occ) out.date = ymdIso(occ.date);
        if(TL.forms.looksEmail(contact)) out.email = contact; else out.phone = contact;
        return out;
      },
      validate: function(fields, f){
        var c = $("#pkContact", f).value.trim();
        if(!TL.forms.looksEmail(c) && !TL.forms.looksPhone(c)) return {ctrl: $("#pkContact", f), msg: "Enter an email or a phone number"};
        return null;
      },
      mailto: function(fields){
        return {href: TL.forms.mailto(fields.eventName + " signup — " + EV_DAY_LONG[eventDow(pkEvent() || {dow: 0})], ["Name: " + fields.name, "Seats: " + fields.seats, "Contact: " + (fields.email || fields.phone || ""), fields.date ? "Date: " + fields.date : "", "", "See you there!"]), label: "Email the signup instead"};
      },
      success: function(fields, res, st){
        var pk = pkEvent(), evt = pk ? calForEvent(pk) : null, occ = pk ? evNextOcc(pk) : null;
        var dayTxt = occ ? EV_DAY_LONG[dowOf(occ.date)] + " " + (pk.time || evClock(occ.startMin)).replace(":00", "") + " · " + EV_MON_SHORT[occ.date.m - 1] + " " + occ.date.d : "Sunday 11 AM";
        return "<b>You\u2019re on the list for " + esc(dayTxt) + "</b><p>" + esc(fields.name) + " · " + fields.seats + (fields.seats === 1 ? " seat" : " seats") + ". Eight play at the big table; more than that and we run a second list so nobody sits out.</p>" +
          (evt ? '<div class="form-done-cal">' + calMenu(evt, {label: "Add to calendar"}) + "</div>" : "");
      }
    });
  }

  /* ---- card show ---- */
  function showNext(){ var d = TL.nextShow(); return (d && !isNaN(d)) ? d : null; }
  function showFromConfig(d){ var s = TL.config.show || {}; return !!(s.date && d && ymdIso({y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate()}) === s.date); }
  function pendingTables(){ return TL.forms.local("vendor").reduce(function(n, r){ return n + (parseInt(r.tables, 10) || 0); }, 0); }
  var lastTablesShown = null;
  function renderShow(){
    var s = TL.config.show || {}, d = showNext();
    var big = $("#showDateBig"), tbc = $("#showTbc");
    if(big && d) big.innerHTML = EV_DAY_SHORT[d.getDay()] + "<br>" + EV_MON_SHORT[d.getMonth()] + " " + d.getDate();
    if(tbc) tbc.hidden = showFromConfig(d);
    var st = evHmMin(s.start), en = evHmMin(s.end);
    var hoursTxt = s.hours || (st !== null && en !== null ? evClock(st) + " \u2013 " + evClock(en) : "10 AM \u2013 4 PM");
    var el;
    if((el = $("#showHours"))) el.textContent = hoursTxt;
    if((el = $("#showSetup"))) el.textContent = evHmMin(s.setup) !== null ? evClock(evHmMin(s.setup)) : "8 AM";
    if((el = $("#showVenue"))) el.textContent = s.venue || "Hilton Cincinnati Airport";
    if((el = $("#showAddress"))) el.textContent = s.address || "";
    if((el = $("#showCadence"))) el.textContent = String(s.cadence || "First Saturday or Sunday").replace(/\s+of every month\.?$/i, "");
    if((el = $("#showEyebrow"))) el.textContent = String(s.cadence || "First Saturday or Sunday").replace(/\s+of every month\.?$/i, "") + " \u00b7 " + (s.venue || "Hilton") + (s.address ? " \u00b7 " + s.address.split(",").slice(1, 3).join(",").trim() : "");
    if((el = $("#showMapLink"))) el.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([s.venue, s.address].filter(Boolean).join(", "));
    var total = parseInt(s.tables, 10) || 24, booked = Math.min(total, (parseInt(s.booked, 10) || 0) + pendingTables());
    var n = $("#tablesLabel .tables-n"), t = $("#tablesLabel .tables-t"), meter = $("#tablesMeter");
    if(t) t.textContent = total;
    if(n){ if(lastTablesShown !== booked){ n.textContent = lastTablesShown === null ? "0" : String(lastTablesShown); evCountTo(n, booked, {duration: 900}); lastTablesShown = booked; } }
    else if((el = $("#tablesLabel"))) el.textContent = booked + " of " + total;
    if(meter){ meter.setAttribute("aria-label", booked + " of " + total + " vendor tables booked"); var bar = meter.querySelector("i"); if(bar) bar.style.width = Math.round(booked / total * 100) + "%"; meter.classList.toggle("full", booked >= total); }
    var cal = $("#showCal"), evt = calForShow(); if(cal) cal.innerHTML = evt ? calMenu(evt) : "";
    var sel = $("#vTables");
    if(sel && Array.isArray(s.tablePrices) && s.tablePrices.length){
      var cur = sel.value;
      sel.innerHTML = s.tablePrices.map(function(p){ return '<option value="' + esc(p.n) + '">' + esc(p.n) + (p.n === 1 ? " table" : " tables") + (p.price ? " \u2014 " + money(p.price).replace(/\.00$/, "") : "") + "</option>"; }).join("");
      if(cur) sel.value = cur;
    }
    var form = $("#vendorForm"), full = booked >= total, h3 = form && $("h3", form), btn = form && $("button[type=submit]", form);
    if(form){ form.classList.toggle("is-full", full); if(h3) h3.textContent = full ? "Join the vendor waitlist" : "Book a table"; if(btn && !btn.disabled){ btn.textContent = full ? "Add me to the waitlist" : "Reserve my table"; btn.dataset.label = btn.textContent; } }
    tickShow();
    var fd = $("#footShowDate"); if(fd && d) fd.innerHTML = "Next card show \u00b7 " + EV_DAY_SHORT[d.getDay()] + ", " + EV_MON_SHORT[d.getMonth()] + " " + d.getDate() + " &rarr;";
  }
  function tickShow(){
    var el = $("#showCountdown"); if(!el) return;
    var s = TL.config.show || {}, d = showNext(); if(!d){ el.textContent = ""; return; }
    var now = new Date(), st = evHmMin(s.start), en = evHmMin(s.end);
    var endMs = d.getTime() + Math.max(60, ((en !== null ? en : 960) - (st !== null ? st : 600))) * 60000;
    var mins = Math.round((d.getTime() - now.getTime()) / 60000);
    if(mins <= 0 && now.getTime() < endMs){ el.textContent = "Happening now \u00b7 doors open till " + evClock(en !== null ? en : 960); el.classList.add("live"); return; }
    el.classList.remove("live");
    el.textContent = mins <= 0 ? "" : evFmtUntil(mins);
  }
  function bindVendor(){
    var form = $("#vendorForm"); if(!form) return;
    TL.forms.bind(form, {
      kind: "vendor",
      collect: function(f){
        var d = showNext(), out = {name: $("#vName", f).value.trim(), email: $("#vEmail", f).value.trim(), tables: parseInt($("#vTables", f).value, 10) || 1, game: $("#vGame", f).value, website: $("#vWebsite", f).value};
        var ph = $("#vPhone", f).value.trim(); if(ph) out.phone = ph;
        if(d) out.show = ymdIso({y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate()});
        if(f.classList.contains("is-full")) out.waitlist = true;
        return out;
      },
      mailto: function(fields){
        return {href: TL.forms.mailto("Vendor table request" + (fields.show ? " \u2014 " + fields.show : ""), ["Name: " + fields.name, "Email: " + fields.email, fields.phone ? "Phone: " + fields.phone : "", "Tables: " + fields.tables, "Selling: " + fields.game, fields.waitlist ? "Waitlist please" : ""]), label: "Email the request instead"};
      },
      success: function(fields, res, st){
        var d = showNext(), when = d ? EV_DAY_LONG[d.getDay()] + ", " + EV_MON_SHORT[d.getMonth()] + " " + d.getDate() : "the next show";
        var prices = ((TL.config.show || {}).tablePrices || []).filter(function(p){ return p.n === fields.tables; })[0];
        return "<b>" + (fields.waitlist ? "You\u2019re on the vendor waitlist" : "Table request received") + "</b><p>" + fields.tables + (fields.tables === 1 ? " table" : " tables") + " for " + esc(when) + (prices && prices.price ? " \u00b7 " + money(prices.price).replace(/\.00$/, "") : "") + ". We\u2019ll confirm by email within a day" + (fields.waitlist ? " if a table opens up" : "") + " \u2014 setup opens at " + esc($("#showSetup") ? $("#showSetup").textContent : "8 AM") + ".</p>";
      },
      onSuccess: function(fields, res, st){ if(st.local) renderShow(); else { var s = TL.config.show || {}; lastTablesShown = null; TL.config.show = TL.deepMerge(s, {booked: (parseInt(s.booked, 10) || 0) + fields.tables}); renderShow(); } }
    });
  }

  /* ---- visit ---- */
  var mapLoaded = false;
  function renderVisit(){
    var c = TL.config, a = c.address || {}, el;
    if((el = $("#visitTitle"))) el.textContent = c.title === "Top Loaded" || !c.title ? "Top Loaded Trading Cards" : c.title;
    if((el = $("#visitAddress"))) el.innerHTML = esc(a.line1 || "") + "<br>" + esc([a.city, a.state].filter(Boolean).join(", ") + (a.zip ? " " + a.zip : ""));
    if((el = $("#visitPhone"))){ el.href = "tel:" + (c.phoneRaw || ""); el.textContent = c.phone || ""; }
    if((el = $("#visitEmail"))){ el.href = "mailto:" + (c.email || ""); el.textContent = c.email || ""; }
    var ht = c.hoursText || {};
    if((el = $("#visitHoursWk")) && ht.wk) el.textContent = ht.wk;
    if((el = $("#visitHoursWe")) && ht.we) el.textContent = ht.we;
    var links = c.links || {};
    if((el = $("#visitGoogle"))){ if(links.googleMaps) el.href = links.googleMaps; }
    if((el = $("#visitApple"))){ if(links.appleMaps) el.href = links.appleMaps; el.hidden = !links.appleMaps; }
    var note = $("#visitNote"), b = c.banner || {};
    if(note){ note.hidden = !(b.on && b.text); note.textContent = b.on && b.text ? b.text : ""; }
    var tb = $("#visitHoursTbl tbody");
    if(tb){
      var today = evTzNow().dow, h = c.hours || {};
      tb.innerHTML = [1,2,3,4,5,6,0].map(function(dw){
        var v = h[EV_DOWS[dw]], txt = v ? evClock(evHmMin(v[0])) + " \u2013 " + evClock(evHmMin(v[1])) : "Closed";
        return '<tr class="' + (dw === today ? "today" : "") + (v ? "" : " closed") + '"><th scope="row">' + EV_DAY_LONG[dw] + (dw === today ? ' <em>Today</em>' : "") + '</th><td>' + esc(txt) + "</td></tr>";
      }).join("");
    }
    tickVisit();
  }
  function tickVisit(){
    var el = $("#visitStatus"); if(!el) return;
    var s = TL.shopStatus(), dot = el.querySelector(".dot"), lab = el.querySelector("b"), sub = el.querySelector(".visit-status-sub");
    var soon = s.open && /Closes in/.test(s.sub || "");
    if(dot) dot.className = "dot" + (s.open ? (soon ? " warn" : "") : " crit");
    if(lab) lab.textContent = soon ? "Closing soon" : s.label;
    if(sub) sub.textContent = s.sub ? " \u00b7 " + s.sub : "";
    el.classList.toggle("open", !!s.open);
  }
  function evLoadMap(){
    if(mapLoaded) return; var f = $("#visitMap"); if(!f || !f.dataset.src) return;
    mapLoaded = true; f.src = f.dataset.src;
  }

  /* ---- footer ---- */
  function renderFooter(){
    var c = TL.config, a = c.address || {}, links = c.links || {}, el;
    if((el = $("#footBrand"))) el.textContent = c.title || "Top Loaded";
    if((el = $("#footAddress"))) el.innerHTML = esc(a.line1 || "") + "<br>" + esc([a.city, a.state].filter(Boolean).join(", ") + (a.zip ? " " + a.zip : ""));
    if((el = $("#footPhone"))){ el.href = "tel:" + (c.phoneRaw || ""); el.textContent = c.phone || ""; }
    if((el = $("#footEmail"))){ el.href = "mailto:" + (c.email || ""); el.textContent = c.email || ""; }
    var cd = evClosedDays().map(function(d){ return EV_DAY_LONG[EV_DOWS.indexOf(d)]; });
    if((el = $("#footClosed"))){ el.hidden = !cd.length; el.textContent = cd.length ? "Closed " + (cd.length === 1 ? cd[0] + "s" : cd.join(" & ")) : ""; }
    var ht = c.hoursText || {};
    if((el = $("#footHoursWk")) && ht.wk) el.textContent = ht.wk;
    if((el = $("#footHoursSun")) && ht.we) el.textContent = ht.we;
    var soc = $("#footSocials");
    if(soc){
      var rows = [];
      function handle(u){ return String(u || "").replace(/\/+$/, "").split("/").pop(); }
      if(links.facebook) rows.push({href: links.facebook, txt: "Facebook \u00b7 " + handle(links.facebook)});
      if(links.instagram) rows.push({href: links.instagram, txt: "Instagram \u00b7 @" + handle(links.instagram)});
      if(links.tcgplayer) rows.push({href: links.tcgplayer, txt: "TCGplayer seller \u00b7 Top Loaded TCG"});
      if(links.whatnot) rows.push({href: links.whatnot, txt: "Whatnot \u00b7 live breaks"});
      if(links.tcgplus && !tcgplusIsGeneric(links.tcgplus)) rows.push({href: links.tcgplus, txt: "Bandai TCG+ \u00b7 our events"});
      soc.innerHTML = rows.map(function(r){ return '<li><a href="' + esc(r.href) + '" target="_blank" rel="noopener noreferrer">' + esc(r.txt) + "</a></li>"; }).join("");
    }
    if((el = $("#footVersion"))) el.textContent = "site v" + String(TL.version || "2").split(".")[0];
    if((el = $("#footYear"))) el.textContent = String(new Date().getFullYear());
  }
  function bindNewsletter(){
    var form = $("#newsForm"); if(!form) return;
    TL.forms.bind(form, {
      kind: "newsletter",
      collect: function(f){ return {email: $("#newsEmail", f).value.trim(), topic: "news", website: $("#newsWebsite", f).value}; },
      mailto: function(fields){ return {href: TL.forms.mailto("Sign me up for the drop", ["Please add " + fields.email + " to the newsletter."]), label: "Email us to sign up instead"}; },
      success: function(fields){ return "<b>You\u2019re on the list.</b><p>First drop lands at " + esc(fields.email) + " \u2014 one a week, tops.</p>"; }
    });
  }

  /* ---- buylist quote form ---- */
  function bindBuylist(){
    var form = $("#buyForm"); if(!form) return;
    var ph = $("#buyPhone"); if(ph){ ph.href = "tel:" + (TL.config.phoneRaw || ""); ph.textContent = TL.config.phone || ph.textContent; }
    TL.forms.bind(form, {
      kind: "buylist",
      collect: function(f){
        var out = {name: $("#bName", f).value.trim(), contact: $("#bContact", f).value.trim(), games: $("#bGames", f).value, desc: $("#bDesc", f).value.trim(), website: $("#bWebsite", f).value};
        var u = $("#bPhotos", f).value.trim(); if(u) out.photosUrl = u;
        return out;
      },
      validate: function(fields, f){
        var c = fields.contact;
        if(!TL.forms.looksEmail(c) && !TL.forms.looksPhone(c)) return {ctrl: $("#bContact", f), msg: "Enter an email or a phone number"};
        return null;
      },
      mailto: function(fields){
        return {href: TL.forms.mailto("Buylist quote — " + fields.games, ["Name: " + fields.name, "Contact: " + fields.contact, "Games: " + fields.games, "", fields.desc, fields.photosUrl ? "Photos: " + fields.photosUrl : ""]), label: "Email the quote request instead"};
      },
      success: function(fields, res, st){
        return "<b>Quote request received</b><p>Thanks " + esc(fields.name.split(" ")[0]) + " — we’ll look it over and reply to " + esc(fields.contact) + " with a real number" + (st.local ? "" : " (ref " + esc(String(res.id).slice(0, 8)) + ")") + ". Bring it in any day we’re open if you’d rather have cash in hand today.</p>";
      }
    });
  }

  /* ---- count-up helper: safe whether or not the motion package replaced TL.countUp ---- */
  function evCountTo(el, n, opts){
    if(!el) return;
    opts = opts || {};
    var dec = opts.decimals || 0, txt = (opts.prefix || "") + (dec ? Number(n).toFixed(dec) : String(Math.round(n))) + (opts.suffix || "");
    var isDefault = /textContent\s*=\s*to;?\s*\}\s*$/.test(String(TL.countUp));
    if(isDefault || reduceMotion){ el.textContent = txt; return; }
    try { TL.countUp(el, n, opts); } catch(e){ el.textContent = txt; }
  }

  /* ---- admin play-nights editor fallback: only if no other module rendered #evEditor ---- */
  var DAY_DOW = {sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6};
  function evEditorFallback(){
    var box = $("#evEditor"); if(!box || box.children.length || box.dataset.owner) return;
    box.dataset.owner = "events";
    function draw(){
      var evs = TL.config.events || [];
      box.innerHTML = evs.map(function(ev, i){
        return '<div class="ev-edit-row">' +
          '<input data-ev="day" data-i="' + i + '" value="' + esc(ev.day || EV_DAY_SHORT[eventDow(ev)] || "") + '" style="width:52px" aria-label="Day" autocomplete="off">' +
          '<input data-ev="name" data-i="' + i + '" value="' + esc(ev.name || "") + '" style="flex:1; min-width:110px" aria-label="Event name" autocomplete="off">' +
          '<input data-ev="time" data-i="' + i + '" value="' + esc(ev.time || evClockLong(eventStart(ev) || 0)) + '" style="width:82px" aria-label="Start time" autocomplete="off">' +
          '<input data-ev="fee" data-i="' + i + '" value="' + esc(ev.fee || "") + '" style="width:56px" aria-label="Entry fee" autocomplete="off">' +
          '<button type="button" class="linklike" data-ev-del="' + i + '" aria-label="Remove ' + esc(ev.name || "event") + '">&times;</button></div>';
      }).join("") || '<p style="color:var(--ink3); font-size:.85rem">No play nights yet \u2014 add one.</p>';
    }
    function read(){
      var evs = (TL.config.events || []).map(function(e){ return TL.deepMerge({}, e); });
      $$("[data-ev]", box).forEach(function(inp){ var ev = evs[parseInt(inp.dataset.i, 10)]; if(!ev) return; ev[inp.dataset.ev] = inp.value.trim(); });
      evs.forEach(function(ev){
        var d = DAY_DOW[String(ev.day || "").slice(0, 3).toLowerCase()]; if(typeof d === "number") ev.dow = d;
        var m = evParseClock(ev.time); if(m !== null) ev.start = TL.pad2(Math.floor(m / 60)) + ":" + TL.pad2(m % 60);
        if(!ev.id) ev.id = evSlug((ev.game || "ev") + "-" + (ev.day || "")) + "-" + TL.uid().slice(-4);
      });
      return evs;
    }
    box.addEventListener("click", function(e){
      var del = e.target.closest("[data-ev-del]"); if(!del) return;
      var evs = read(); evs.splice(parseInt(del.dataset.evDel, 10), 1);
      TL.config.events = evs; draw();
    });
    var apply = $("#evApply"), add = $("#evAdd");
    if(apply) apply.addEventListener("click", function(){ TL.saveConfig({events: read()}); toast("Schedule published \u2014 Play Nights page updated"); });
    if(add) add.addEventListener("click", function(){ var evs = read(); evs.push({id: "ev-" + TL.uid().slice(-5), day: "Fri", dow: 5, name: "New event", small: "Set details, then publish", time: "6:00 PM", start: "18:00", fee: "TBD", game: "other", signup: null}); TL.config.events = evs; draw(); var last = $$("[data-ev='name']", box).pop(); if(last) last.focus(); });
    draw();
    TL.on("config:change", draw);
  }

  /* ---- wiring ---- */
  var evTimer = null, showTimer = null, visitTimer = null;
  function evRenderAll(){ renderSched(); renderSignups(); renderShow(); renderVisit(); renderFooter(); }
  TL.on("init", function(){
    evRenderAll();
    bindSignup(); bindVendor(); bindBuylist(); bindNewsletter();
    evEditorFallback();
  });
  TL.on("config:change", function(){ evRenderAll(); });
  TL.on("view:change", function(d){
    if(!d) return;
    if(d.name === "events" && !evTimer){ tickEvents(); evTimer = setInterval(tickEvents, 60000); }
    if(d.name === "show" && !showTimer){ tickShow(); showTimer = setInterval(tickShow, 60000); }
    if(d.name === "visit"){ evLoadMap(); if(!visitTimer){ renderVisit(); visitTimer = setInterval(function(){ if(!document.hidden) tickVisit(); }, 60000); } }
    if(d.name === "admin") evEditorFallback();
  });
  TL.on("view:leave", function(d){
    if(!d) return;
    if(d.name === "events" && evTimer){ clearInterval(evTimer); evTimer = null; }
    if(d.name === "show" && showTimer){ clearInterval(showTimer); showTimer = null; }
    if(d.name === "visit" && visitTimer){ clearInterval(visitTimer); visitTimer = null; }
  });
  document.addEventListener("visibilitychange", function(){
    if(document.hidden) return;
    if(evTimer) tickEvents(); if(showTimer) tickShow(); if(visitTimer) tickVisit();
  });
