  /* ---------- channel sync alerts + inbox ----------
     Alerts: GET /alerts · POST /alerts {msg, ch} · POST /alerts/:id/ack (staff). Offline or
     when the worker has no alerts route yet, the list lives in TL.store "alerts".
       addAlert(msg, ch)   used by the inventory table's stock stepper
     Inbox: GET /forms (staff) merged with TL.store "forms" — the offline fallback that the
     forms module writes as {id, kind, at, status:"new", local:true, ...fields}.
     PUT /forms/:kind/:id {status} for server rows; local rows update in the store. */
  var alerts = [], alertsFromServer = false;
  function localAlerts(){
    var l = TL.store.get("alerts", null);
    if(!l){
      l = [
        {id: "demo-1", at: new Date(Date.now() - 36e5).toISOString(), ch: "TCGplayer", msg: "Sold in-store (Square): Charizard ex — update the TCGplayer listing", ack: false, demo: true},
        {id: "demo-2", at: new Date(Date.now() - 72e5).toISOString(), ch: "Square", msg: "Sold on TCGplayer: The One Ring — pull it from the case & Square", ack: false, demo: true}
      ];
      TL.store.set("alerts", l);
    }
    return l;
  }
  function saveLocalAlerts(){ TL.store.set("alerts", alerts.filter(function(a){ return !a.server; }).slice(0, 100)); }
  function renderAlerts(){
    var list = $("#alertList"); if(!list) return;
    var open = alerts.filter(function(a){ return !a.ack; });
    list.innerHTML = open.length ? open.map(function(a){
      return '<div class="alert-row" data-alert="' + esc(a.id) + '"><div class="tl"><b>' + esc(a.msg) + (a.demo ? '<span class="demo-tag">demo</span>' : "") + '</b>' +
        '<span>Reconcile on ' + esc(a.ch || "the other channel") + (a.at ? " · " + esc(ago(a.at)) : "") + (a.local && !a.demo ? " · this device" : "") + '</span></div>' +
        '<button class="btn btn-ghost" data-ack="' + esc(a.id) + '" type="button" aria-label="Done: ' + esc(a.msg) + '">Done</button></div>';
    }).join("") : '<p class="alert-empty">All channels reconciled — nothing waiting.</p>';
    var n = open.length;
    statNum($("#alertCount"), n);
    statNum($("#statAlerts"), n);
    var pill = $("#alertPill"); if(pill) pill.className = "pill " + (n ? "warn" : "ok");
    var sub = $("#statAlertsSub"); if(sub) sub.textContent = n ? "Channel sync · " + (alertsFromServer ? "from the API" : "on this device") : "Channel sync · nothing waiting";
  }
  function loadAlerts(){
    return apiTry("GET", "/alerts").then(function(r){
      if(r.ok && r.data && Array.isArray(r.data.alerts)){
        alertsFromServer = true;
        alerts = r.data.alerts.map(function(a){ a.server = true; return a; });
      } else {
        alertsFromServer = false;
        alerts = localAlerts();
      }
      renderAlerts();
    });
  }
  function addAlert(msg, ch){
    ch = ch === "TCGplayer" ? "TCGplayer" : "Square"; /* the worker only knows these two channels */
    var local = {id: TL.uid(), at: new Date().toISOString(), ch: ch, msg: msg, ack: false, local: true};
    return apiTry("POST", "/alerts", {msg: msg, ch: ch, source: "site"}).then(function(r){
      if(r.ok){ return loadAlerts(); }
      alerts.unshift(local); saveLocalAlerts(); renderAlerts();
    });
  }
  function ackAlert(id, rowEl){
    var a = null;
    for(var i = 0; i < alerts.length; i++){ if(String(alerts[i].id) === String(id)){ a = alerts[i]; break; } }
    if(!a) return;
    function finish(){
      a.ack = true;
      if(!a.server) saveLocalAlerts();
      renderAlerts();
      toast("Alert cleared — channels reconciled");
    }
    var p = a.server ? apiTry("POST", "/alerts/" + encodeURIComponent(id) + "/ack", {}) : Promise.resolve({ok: true});
    p.then(function(r){
      if(a.server && !r.ok){ toast("Couldn't clear that alert — " + errText(r)); return; }
      if(rowEl && !reduceMotion){
        rowEl.classList.add("going");
        var doneOnce = false, end = function(){ if(doneOnce) return; doneOnce = true; finish(); };
        rowEl.addEventListener("animationend", end);
        setTimeout(end, 400);
      } else finish();
    });
  }
  document.addEventListener("click", function(e){
    var b = e.target.closest("[data-ack]");
    if(b){ ackAlert(b.dataset.ack, b.closest(".alert-row")); return; }
    if(e.target.closest("#alertNewBtn")){
      var inp = $("#alertNewMsg"), msg = inp.value.trim();
      if(!msg){ toast("Type what needs reconciling first"); inp.focus(); return; }
      addAlert(msg, $("#alertNewCh").value).then(function(){ inp.value = ""; toast("Alert added"); });
    }
  });

  /* ---- inbox ---- */
  var inboxItems = [], inboxKind = "all", inboxShowDone = false, inboxFromServer = false;
  var KIND_LABEL = {vendor: "Vendor table", buylist: "Buylist quote", signup: "League signup", newsletter: "Newsletter", restock: "Restock", contact: "Contact"};
  var HIDE_FIELDS = {id: 1, kind: 1, at: 1, ip: 1, status: 1, local: 1, website: 1, server: 1, note: 1, emailed: 1};
  function localForms(){ var l = TL.store.get("forms", []); return Array.isArray(l) ? l : []; }
  function inboxTitle(f){
    return f.name || f.email || f.contact || f.productName || (f.kind === "newsletter" ? "Newsletter signup" : KIND_LABEL[f.kind] || "Submission");
  }
  function fieldHtml(k, v){
    if(v === undefined || v === null || v === "" || (typeof v === "object" && !Array.isArray(v))) return "";
    var s = Array.isArray(v) ? v.join(", ") : String(v);
    var out;
    if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) out = '<a href="mailto:' + esc(s) + '">' + esc(s) + '</a>';
    else if(/^\+?[\d\s().-]{7,}$/.test(s)) out = '<a href="tel:' + esc(s.replace(/[^\d+]/g, "")) + '">' + esc(s) + '</a>';
    else out = esc(s.length > 240 ? s.slice(0, 239) + "…" : s);
    return '<span><span style="color:var(--ink3)">' + esc(k) + ':</span> ' + out + '</span>';
  }
  function renderInbox(){
    var list = $("#inboxList"); if(!list) return;
    var rows = inboxItems.filter(function(f){
      if(inboxKind !== "all" && f.kind !== inboxKind) return false;
      if(!inboxShowDone && f.status && f.status !== "new") return false;
      return true;
    });
    list.innerHTML = rows.length ? rows.map(function(f){
      var st = f.status || "new", key = f.kind + "/" + f.id;
      var fields = Object.keys(f).filter(function(k){ return !HIDE_FIELDS[k] && k !== "name"; }).map(function(k){ return fieldHtml(k, f[k]); }).filter(Boolean).join(" · ");
      return '<div class="inbox-item' + (st !== "new" ? " is-done" : "") + '" data-form="' + esc(key) + '">' +
        '<div class="ih"><span class="kind ' + esc(f.kind) + '">' + esc(KIND_LABEL[f.kind] || f.kind) + '</span><b>' + esc(inboxTitle(f)) + '</b>' +
          (f.local ? '<span class="local-tag">this device</span>' : "") + '<span class="when">' + esc(f.at ? ago(f.at) : "") + '</span></div>' +
        '<div class="ib">' + (fields || '<span style="color:var(--ink3)">No details</span>') + (st !== "new" ? ' · <span class="local-tag" style="color:var(--ink3)">' + esc(st) + '</span>' : "") + '</div>' +
        '<div class="ia">' +
          (st === "new" ? '<button class="btn btn-ghost" type="button" data-fstatus="done" data-fkey="' + esc(key) + '" aria-label="Mark done: ' + esc(inboxTitle(f)) + '">Done</button>' : '<button class="btn btn-ghost" type="button" data-fstatus="new" data-fkey="' + esc(key) + '" aria-label="Reopen: ' + esc(inboxTitle(f)) + '">Reopen</button>') +
          (st !== "archived" ? '<button class="linklike" type="button" data-fstatus="archived" data-fkey="' + esc(key) + '" aria-label="Archive: ' + esc(inboxTitle(f)) + '">Archive</button>' : "") +
        '</div></div>';
    }).join("") : '<p class="inbox-empty">' + (inboxItems.length ? "Nothing here for this filter." : "Inbox is empty — vendor, buylist and signup forms land here.") + '</p>';
    var unread = inboxItems.filter(function(f){ return !f.status || f.status === "new"; }).length;
    statNum($("#inboxCount"), unread);
    var pill = $("#inboxPill"); if(pill) pill.className = "pill " + (unread ? "warn" : "ok");
    var badge = $("#inboxBadge"), bn = $("#inboxBadgeN");
    if(badge){ badge.hidden = !unread; badge.setAttribute("aria-label", "Inbox: " + unread + " new"); }
    if(bn) bn.textContent = unread;
  }
  function loadInbox(){
    setState($("#inboxState"), "", "Loading…");
    return apiTry("GET", "/forms?limit=100").then(function(r){
      var server = [];
      if(r.ok && r.data){
        var d = r.data; server = Array.isArray(d) ? d : (d.forms || d.items || d.submissions || []);
        inboxFromServer = true;
      } else inboxFromServer = false;
      var local = localForms().map(function(f){ f.local = true; return f; });
      var seen = {};
      inboxItems = server.map(function(f){ f.server = true; f.local = false; seen[f.kind + "/" + f.id] = 1; return f; })
        .concat(local.filter(function(f){ return !seen[f.kind + "/" + f.id]; }));
      inboxItems.sort(function(a, b){ return String(b.at || "").localeCompare(String(a.at || "")); });
      renderInbox();
      setState($("#inboxState"), inboxFromServer ? "ok" : "warn", inboxFromServer
        ? "From the API" + (local.length ? " + " + local.length + " kept on this device" : "") + " · " + nowTime()
        : (TL.api.online ? "API has no inbox route yet — showing this device" : "Demo mode — submissions kept on this device"));
    });
  }
  function setFormStatus(key, status){
    var f = null;
    for(var i = 0; i < inboxItems.length; i++){ if(inboxItems[i].kind + "/" + inboxItems[i].id === key){ f = inboxItems[i]; break; } }
    if(!f) return;
    function apply(){
      f.status = status;
      if(f.local){
        var l = localForms();
        for(var j = 0; j < l.length; j++){ if(l[j].kind === f.kind && String(l[j].id) === String(f.id)) l[j].status = status; }
        TL.store.set("forms", l);
      }
      renderInbox();
      toast(status === "new" ? "Reopened" : (status === "done" ? "Marked done" : "Archived"));
    }
    if(f.local){ apply(); return; }
    apiTry("PUT", "/forms/" + encodeURIComponent(f.kind) + "/" + encodeURIComponent(f.id), {status: status}).then(function(r){
      if(!r.ok){ toast("Couldn't update that — " + errText(r)); return; }
      apply();
    });
  }
  document.addEventListener("click", function(e){
    var chip = e.target.closest("#inboxChips .chip");
    if(chip){
      inboxKind = chip.dataset.kind;
      $$("#inboxChips .chip").forEach(function(c){ c.setAttribute("aria-pressed", String(c === chip)); });
      renderInbox(); return;
    }
    var fs = e.target.closest("[data-fstatus]");
    if(fs){ setFormStatus(fs.dataset.fkey, fs.dataset.fstatus); return; }
    if(e.target.closest("#inboxRefresh")){ loadInbox(); return; }
    var sd = e.target.closest("#inboxShowDone");
    if(sd){ inboxShowDone = !inboxShowDone; sd.setAttribute("aria-pressed", String(inboxShowDone)); sd.textContent = inboxShowDone ? "Hide done" : "Show done"; renderInbox(); }
  });
  TL.on("view:change", function(d){
    if(d && d.name === "admin" && !d.paramsOnly){ loadAlerts(); loadInbox(); }
  });
  TL.on("api:ready", function(){ if(TL.current === "admin"){ loadAlerts(); loadInbox(); } });
  TL.on("init", function(){ alerts = localAlerts(); renderAlerts(); renderInbox(); });
