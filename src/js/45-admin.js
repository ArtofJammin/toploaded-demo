  /* ---------- admin: dashboard, integrations, sync, inventory table ----------
     Shared helpers for the back office (also used by 60-settings, 65-alerts, 70-staff):
       nowTime()                          "2:31 PM"
       apiTry(method, path, body)         → Promise<{ok, data} | {ok:false, err, offline}> never rejects
       statNum(el, n, {prefix, suffix})   TL.countUp with a formatted fallback
       logLine(logEl, cls, text)          prepend a log entry (escaped, highlighted)
       setState(el, cls, text)            save-state / status line helper
       invItems() / loadInventory()       live inventory when the shop module has it, demo ITEMS otherwise
       effStock(item)                     stock with this-device overrides applied (TL.store "stockOverrides")
       cardBusy(card, state)              busy bar on an .admin-card ("on" | "ok" | "err" | "")
     Stock edits emit 'inventory:override' {id, stock, item}. */
  function nowTime(){
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ap;
  }
  function apiTry(method, path, body){
    if(!TL.api.online) return Promise.resolve({ok: false, offline: true});
    return TL.api.request(method, path, body).then(function(d){ return {ok: true, data: d}; }, function(e){ return {ok: false, err: e || {status: 0, error: "error"}}; });
  }
  function errText(r){
    if(!r) return "error";
    if(r.offline) return "offline";
    var e = r.err || {};
    if(e.status === 404) return "API has no such endpoint yet";
    if(e.status === 401 || e.status === 403) return "not allowed for this role";
    if(e.status === 0) return e.error === "timeout" ? "timed out" : "network error";
    return (e.error || "error") + (e.status ? " (" + e.status + ")" : "");
  }
  function statNum(el, n, opts){
    if(!el) return;
    opts = opts || {};
    n = Number(n) || 0;
    var txt = (opts.prefix || "") + fmtInt(n) + (opts.suffix || "");
    if(reduceMotion || document.hidden){ el.textContent = txt; return; }
    try { TL.countUp(el, n, {prefix: opts.prefix || "", suffix: opts.suffix || "", decimals: 0, duration: 700, from: opts.from}); }
    catch(e){ el.textContent = txt; return; }
    if(el.textContent === String(n)) el.textContent = txt; /* no-op default wrote the raw number */
  }
  function logLine(logEl, cls, text){
    if(!logEl) return;
    var div = document.createElement("div");
    div.className = reduceMotion ? "" : "fresh";
    div.innerHTML = '<span class="t">' + esc(nowTime()) + '</span> · <span class="' + esc(cls || "ok") + '">' + esc((cls || "ok").toUpperCase()) + '</span> ' + esc(text);
    logEl.insertBefore(div, logEl.firstChild);
    while(logEl.children.length > 40) logEl.removeChild(logEl.lastChild);
  }
  function setState(el, cls, text){
    if(!el) return;
    el.className = "save-state" + (cls ? " " + cls : "");
    el.textContent = text || "";
  }
  function cardBusy(card, state){
    if(!card) return;
    card.classList.remove("busy", "busy-ok", "busy-err");
    if(state === "on") card.classList.add("busy");
    else if(state === "ok") card.classList.add("busy-ok");
    else if(state === "err") card.classList.add("busy-err");
    if(state === "ok") setTimeout(function(){ card.classList.remove("busy-ok"); }, 1800);
  }
  function longDate(){
    try { return new Date().toLocaleDateString("en-US", {weekday: "long", month: "long", day: "numeric", timeZone: TL.config.timezone || "America/New_York"}); }
    catch(e){ return new Date().toDateString(); }
  }
  function fmtStamp(iso){
    if(!iso) return "—";
    var d = new Date(iso); if(isNaN(d)) return String(iso);
    try { return d.toLocaleString("en-US", {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}); } catch(e){ return d.toLocaleString(); }
  }
  function ago(iso){
    var d = new Date(iso); if(isNaN(d)) return "";
    var m = Math.round((Date.now() - d.getTime()) / 60000);
    if(m < 1) return "just now";
    if(m < 60) return m + " min ago";
    var h = Math.round(m / 60); if(h < 36) return h + " h ago";
    return Math.round(h / 24) + " days ago";
  }

  /* ---- inventory access (shop module contract, with fallbacks) ---- */
  var stockOv = TL.store.get("stockOverrides", {}) || {};
  function invItems(){
    if(TL.inventory && TL.inventory.items && TL.inventory.items.length) return TL.inventory.items;
    if(typeof LIVE !== "undefined" && LIVE && LIVE.items && LIVE.items.length) return LIVE.items;
    return ITEMS.filter(function(it){ return !it.live; });
  }
  function loadInventory(){
    if(TL.inventory && typeof TL.inventory.load === "function"){
      var p;
      try { p = TL.inventory.load(); } catch(e){ p = null; }
      if(p && typeof p.then === "function") return p.then(function(items){ return (items && items.length) ? items : invItems(); }, function(){ return invItems(); });
    }
    return Promise.resolve(invItems());
  }
  function effStock(it){
    var o = stockOv[it.id];
    return (typeof o === "number") ? o : it.stock;
  }
  function gameName(g){ return GAMES[g] || (g === "other" ? "Other" : (g ? String(g) : "TCG")); }

  /* ---- health / connection pills ---- */
  var health = null, apiChecked = false;
  function connText(){
    if(!apiChecked && TL.api.base) return "Checking the API…";
    if(!TL.api.online) return "Demo mode · saving to this device";
    var sq = health && health.integrations && health.integrations.square;
    return "Connected to API · Square " + (sq ? "configured" : "not configured");
  }
  function renderConn(){
    ["#adminConn", "#staffConn"].forEach(function(sel){
      var el = $(sel); if(!el) return;
      el.className = "pill conn-pill " + ((!apiChecked && TL.api.base) ? "" : (TL.api.online ? "ok" : "warn"));
      el.innerHTML = '<span class="dot"></span>' + esc(connText());
    });
    var role = TL.auth && TL.auth.role ? TL.auth.role() : null;
    ["#adminRole", "#staffRole"].forEach(function(sel){
      var el = $(sel); if(!el) return;
      el.innerHTML = '<span class="dot"></span>' + esc(role === "admin" ? "Admin" : role === "staff" ? "Staff" : "Signed out");
    });
  }
  function refreshHealth(){
    return apiTry("GET", "/health").then(function(r){
      health = r.ok ? r.data : null;
      renderConn(); renderIntegrations();
    });
  }
  var INT_ROWS = [
    ["api", "Worker API", "Cloudflare Worker · config, forms, credit, alerts"],
    ["kv", "KV storage", "Settings and ledgers persist here"],
    ["auth", "Staff / admin passcodes", "Hashed on the worker · 12 h tokens"],
    ["square", "Square", "Checkout links + catalog · needs SQUARE_ACCESS_TOKEN"],
    ["squareWebhook", "Square webhooks", "Register sales → sync alerts · needs signature key"],
    ["email", "Email (Resend)", "Form notifications to the shop"],
    ["github", "GitHub sync token", "Lets Sync now dispatch the inventory workflow"]
  ];
  var HOOK_ROWS = ["inventory.count.updated", "order.created", "payment.updated"];
  function renderIntegrations(){
    var list = $("#intList"), pill = $("#intPill"); if(!list) return;
    var ints = (health && health.integrations) || {};
    var online = TL.api.online;
    list.innerHTML = INT_ROWS.map(function(r){
      var on = r[0] === "api" ? online : !!ints[r[0]];
      var lab = r[0] === "api" ? (online ? "Connected" : "Demo mode") : (on ? "Configured" : (online ? "Not set" : "Unknown"));
      return '<div class="int-row"><div class="in"><b>' + esc(r[1]) + '</b><span>' + esc(r[2]) + '</span></div>' +
        '<span class="pill ' + (on ? "ok" : (online ? "warn" : "")) + '"><span class="dot"></span>' + esc(lab) + '</span></div>';
    }).join("") +
    '<div class="int-row" style="border-top:1px solid var(--line); margin-top:4px"><div class="in"><b>Square webhook events</b><span>Expected events once the webhook is registered</span></div></div>' +
    HOOK_ROWS.map(function(h){
      return '<div class="hook-row"><span class="hn">' + esc(h) + '</span><span class="pill ' + (ints.squareWebhook ? "ok" : "") + '"><span class="dot"></span>' + (ints.squareWebhook ? "listening" : "expected event") + '</span></div>';
    }).join("");
    if(pill){
      var n = INT_ROWS.filter(function(r){ return r[0] === "api" ? online : !!ints[r[0]]; }).length;
      pill.className = "pill " + (online ? (n >= 4 ? "ok" : "warn") : "warn");
      pill.innerHTML = '<span class="dot"></span>' + (online ? n + " of " + INT_ROWS.length + " live" : "Demo mode");
    }
  }

  /* ---- stats ---- */
  var invSummary = null, summaryFetched = false;
  function applySummary(s){
    if(!s || typeof s !== "object") return;
    invSummary = s;
    statNum($("#admProducts"), s.products || 0);
    var sub = $("#admProductsSub");
    if(sub) sub.textContent = fmtInt(s.units || 0) + " cards in stock · " + fmtInt(s.listings || 0) + " listings · synced " + (s.generated ? ago(s.generated) : "—");
    var g = $("#tcgGenerated"); if(g) g.textContent = s.generated ? fmtStamp(s.generated) + " (" + ago(s.generated) + ")" : "—";
    var c = $("#tcgCounts");
    if(c){
      var games = s.games || {};
      c.textContent = fmtInt(s.products || 0) + " products · " + fmtInt(s.listings || 0) + " listings · " + fmtInt(s.units || 0) + " units" +
        (games.pk !== undefined ? " · Pokemon " + fmtInt(games.pk) + " / One Piece " + fmtInt(games.op || 0) + " / Magic " + fmtInt(games.mtg || 0) : "");
    }
    var meta = $("#invMeta"); if(meta && s.generated) meta.textContent = "inventory.json · " + fmtStamp(s.generated);
  }
  function ensureSummary(){
    if(invSummary) return;
    if(TL.inventory && TL.inventory.summary){ applySummary(TL.inventory.summary); return; }
    if(summaryFetched || !window.fetch) return;
    summaryFetched = true;
    fetch("inventory-summary.json", {cache: "no-store"}).then(function(r){ return r.ok ? r.json() : null; }).then(function(s){
      if(s) applySummary(s);
      else { var sub = $("#admProductsSub"); if(sub) sub.textContent = "No inventory-summary.json yet — run the import"; }
    }).catch(function(){ var sub = $("#admProductsSub"); if(sub) sub.textContent = "Inventory summary unavailable"; });
  }
  function renderLowStock(items){
    var low = 0, total = items.length;
    for(var i = 0; i < items.length; i++){ if(effStock(items[i]) <= 1) low++; }
    statNum($("#lowStockVal"), low);
    var sub = $("#lowStockSub");
    if(sub) sub.textContent = "At 1 or fewer · of " + fmtInt(total) + " products" + (items.length && items[0].tcg ? " on TCGplayer" : " (demo list)");
  }
  function renderShowStat(){
    var s = TL.config.show || {};
    statNum($("#statTables"), s.booked || 0);
    var of = $("#statTablesOf"); if(of) of.textContent = fmtInt(s.tables || 0);
    var d = $("#statShowDate");
    if(d){
      var when = TL.nextShow ? TL.nextShow() : null, lab = "";
      try { lab = when ? when.toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"}) : ""; } catch(e){ lab = s.date || ""; }
      d.textContent = (lab || "Date TBC") + " · " + (s.venue ? s.venue.replace(/^Hilton.*$/, "Hilton, Turfway Rd") : "");
    }
  }
  function renderAdminDate(){
    var a = $("#adminDate"), b = $("#staffDate"), t = longDate();
    if(a) a.textContent = t;
    if(b) b.textContent = t;
  }

  /* ---- sync now (GitHub Action via the worker) ---- */
  var syncPoll = null, syncBusy = false, lastGenerated = null;
  function stopSyncPoll(){ clearTimeout(syncPoll); syncPoll = null; }
  function runSync(btn, logEl, card){
    if(syncBusy) return;
    var label = btn.textContent;
    function done(state, msg){
      syncBusy = false; btn.disabled = false; btn.textContent = label;
      cardBusy(card, state === "ok" ? "ok" : (state === "err" ? "err" : ""));
      setState($("#syncStatus"), state === "ok" ? "ok" : (state === "err" ? "err" : "warn"), msg || "");
    }
    syncBusy = true; btn.disabled = true; btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Syncing…';
    cardBusy(card, "on");
    setState($("#syncStatus"), "", "Working…");
    if(!TL.api.online){
      logLine(logEl, "warn", "Demo mode — nothing dispatched. The real job is the GitHub Action .github/workflows/inventory.yml (daily 10:00 UTC); Sync now dispatches it through the worker once GITHUB_TOKEN is set.");
      setTimeout(function(){ done("warn", "Demo mode · no job dispatched"); toast("Demo mode — the nightly import runs on GitHub Actions"); }, 500);
      return;
    }
    apiTry("POST", "/inventory/sync", {}).then(function(r){
      if(!r.ok){
        logLine(logEl, "err", "Sync request failed — " + errText(r));
        done("err", "Not dispatched · " + errText(r));
        toast("Sync not started — " + errText(r));
        return;
      }
      var d = r.data || {};
      if(d.ok === false || d.dispatched === false){
        logLine(logEl, "warn", "Not connected — " + (d.reason || "the worker has no GITHUB_TOKEN, so it cannot start the workflow"));
        done("warn", "Not connected · " + (d.reason || "no GitHub token"));
        toast("Sync not connected — " + (d.reason || "no GitHub token on the worker"));
        return;
      }
      logLine(logEl, "ok", "Dispatched inventory.yml on GitHub Actions — polling for the new file");
      toast("Inventory refresh started on GitHub Actions");
      var tries = 0;
      function poll(){
        tries++;
        apiTry("GET", "/inventory/status").then(function(s){
          if(s.ok && s.data){
            var st = s.data;
            if(st.lastRun && st.lastRun.message && tries === 1) logLine(logEl, st.lastRun.ok === false ? "warn" : "ok", "Last run: " + st.lastRun.message);
            if(st.generated && lastGenerated && st.generated !== lastGenerated){
              logLine(logEl, "ok", "New inventory file · " + fmtInt(st.products || 0) + " products · " + fmtInt(st.units || 0) + " units · generated " + fmtStamp(st.generated));
              lastGenerated = st.generated;
              done("ok", "Synced · " + nowTime());
              return;
            }
            if(st.generated && !lastGenerated) lastGenerated = st.generated;
            if(!st.syncing && tries > 3){
              logLine(logEl, "ok", "Workflow finished; inventory unchanged (" + (st.generated ? fmtStamp(st.generated) : "no file") + ")");
              done("ok", "Done · no changes");
              return;
            }
          }
          if(tries >= 20){ logLine(logEl, "warn", "Still running after 2 minutes — check the Actions tab; the site picks the new file up on the next load."); done("warn", "Still running on GitHub"); return; }
          syncPoll = setTimeout(poll, 6000);
        });
      }
      syncPoll = setTimeout(poll, 4000);
    });
  }

  /* ---- inventory table ---- */
  var INV_PAGE = 50;
  var inv = {q: "", game: "all", sort: "name", low: false, page: 1, items: null, filtered: []};
  function invFiltered(){
    var items = inv.items || invItems(), q = inv.q, terms = q ? q.split(/\s+/) : [];
    var out = [];
    for(var i = 0; i < items.length; i++){
      var it = items[i];
      if(inv.game !== "all" && it.game !== inv.game) continue;
      if(inv.low && effStock(it) > 1) continue;
      if(terms.length){
        var hay = (it.name + " " + (it.set || "") + " " + (it.lineName || "")).toLowerCase(), okAll = true;
        for(var t = 0; t < terms.length; t++){ if(terms[t] && hay.indexOf(terms[t]) === -1){ okAll = false; break; } }
        if(!okAll) continue;
      }
      out.push(it);
    }
    var s = inv.sort;
    out.sort(function(a, b){
      if(s === "price-desc") return b.price - a.price || a.name.localeCompare(b.name);
      if(s === "price-asc") return a.price - b.price || a.name.localeCompare(b.name);
      if(s === "stock-asc") return effStock(a) - effStock(b) || a.name.localeCompare(b.name);
      if(s === "stock-desc") return effStock(b) - effStock(a) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    return out;
  }
  function invRow(it){
    var st = effStock(it), cls = st <= 0 ? "zero" : (st <= 1 ? "low" : "");
    var edited = typeof stockOv[it.id] === "number";
    var name = it.url
      ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">' + esc(it.name) + '<span class="vh"> (opens in a new tab)</span></a>'
      : esc(it.name);
    var chan = edited
      ? '<span class="pill warn"><span class="dot"></span>Edited here</span>'
      : (it.tcg ? '<span class="pill ok"><span class="dot"></span>TCGplayer</span>' : '<span class="pill"><span class="dot"></span>Demo item</span>');
    return '<tr data-row="' + esc(it.id) + '">' +
      '<td><div class="inv-name">' + name + '<span class="sub">' + esc(it.set || "") + '</span></div></td>' +
      '<td>' + esc(it.lineName || gameName(it.game)) + '</td>' +
      '<td>' + (it.type === "single" ? "Single" : "Sealed") + '</td>' +
      '<td>' + esc(it.cond || "—") + '</td>' +
      '<td class="num">' + money(it.price) + '</td>' +
      '<td><span class="stock-edit">' +
        '<button type="button" data-stk="-1" data-id="' + esc(it.id) + '" aria-label="Decrease stock for ' + esc(it.name) + '">&minus;</button>' +
        '<span class="' + cls + '" data-stock="' + esc(it.id) + '">' + st + '</span>' +
        '<button type="button" data-stk="1" data-id="' + esc(it.id) + '" aria-label="Increase stock for ' + esc(it.name) + '">+</button>' +
      '</span></td>' +
      '<td>' + chan + '</td></tr>';
  }
  function renderInvTable(){
    var body = $("#invBody"), pager = $("#invPager"); if(!body) return;
    var list = inv.filtered = invFiltered();
    var pages = Math.max(1, Math.ceil(list.length / INV_PAGE));
    if(inv.page > pages) inv.page = pages;
    var start = (inv.page - 1) * INV_PAGE, shown = list.slice(start, start + INV_PAGE);
    body.innerHTML = shown.length ? shown.map(invRow).join("") : '<tr class="inv-empty"><td colspan="7">Nothing matches — clear a filter or search a different name.</td></tr>';
    if(pager){
      if(pages <= 1){ pager.innerHTML = list.length ? '<span>' + fmtInt(list.length) + ' products</span>' : ""; }
      else {
        var lo = Math.max(1, inv.page - 2), hi = Math.min(pages, lo + 4); lo = Math.max(1, hi - 4);
        var h = '<button type="button" data-page="' + (inv.page - 1) + '"' + (inv.page === 1 ? " disabled" : "") + ' aria-label="Previous page">&lsaquo;</button>';
        for(var p = lo; p <= hi; p++) h += '<button type="button" data-page="' + p + '"' + (p === inv.page ? ' aria-current="page"' : "") + ' aria-label="Page ' + p + '">' + p + '</button>';
        h += '<button type="button" data-page="' + (inv.page + 1) + '"' + (inv.page === pages ? " disabled" : "") + ' aria-label="Next page">&rsaquo;</button>';
        h += '<span>' + fmtInt(start + 1) + "–" + fmtInt(start + shown.length) + " of " + fmtInt(list.length) + '</span>';
        pager.innerHTML = h;
      }
    }
  }
  function setStock(id, delta){
    var items = inv.items || invItems();
    var it = null;
    for(var i = 0; i < items.length; i++){ if(items[i].id === id){ it = items[i]; break; } }
    if(!it){ for(var j = 0; j < ITEMS.length; j++){ if(ITEMS[j].id === id){ it = ITEMS[j]; break; } } }
    if(!it) return;
    var next = Math.max(0, effStock(it) + delta);
    stockOv[id] = next;
    TL.store.set("stockOverrides", stockOv);
    if(!it.tcg) it.stock = next; /* demo objects are shared with the storefront */
    TL.emit("inventory:override", {id: id, stock: next, item: it});
    var span = $('[data-stock="' + id + '"]');
    if(span){
      span.textContent = next;
      span.className = next <= 0 ? "zero" : (next <= 1 ? "low" : "");
      if(!reduceMotion){ span.classList.remove("flash"); void span.offsetWidth; span.classList.add("flash"); }
      var row = span.closest("tr"), chan = row && row.lastElementChild;
      if(chan) chan.innerHTML = '<span class="pill warn"><span class="dot"></span>Edited here</span>';
    }
    renderLowStock(items);
    logLine($("#syncLog"), "ok", "Stock edit kept on this device · " + it.name + " → " + next + (it.tcg ? " · TCGplayer listing flagged" : ""));
    if(typeof addAlert === "function") addAlert("Stock changed here: " + it.name + " → " + next + " — " + (it.tcg ? "TCGplayer listing needs the same change" : "update the register count to match"), it.tcg ? "TCGplayer" : "Square");
    toast("Stock set to " + next + " — " + (it.tcg ? "TCGplayer" : "Square") + " flagged to match");
  }
  function openAdminInventory(){
    var meta = $("#invMeta");
    if(meta && !invSummary) meta.textContent = "Loading inventory…";
    loadInventory().then(function(items){
      inv.items = items;
      renderLowStock(items);
      renderInvTable();
      if(meta && !invSummary) meta.textContent = fmtInt(items.length) + " products";
      var g = $("#invGame"), hasOther = false;
      for(var i = 0; i < items.length; i++){ if(items[i].game === "other"){ hasOther = true; break; } }
      if(g){ var opt = g.querySelector('option[value="other"]'); if(opt) opt.hidden = !hasOther; }
    });
  }

  /* ---- wiring ---- */
  document.addEventListener("click", function(e){
    var b = e.target.closest("[data-stk]");
    if(b){ setStock(b.dataset.id, parseInt(b.dataset.stk, 10)); return; }
    var pg = e.target.closest("#invPager [data-page]");
    if(pg && !pg.disabled){ inv.page = parseInt(pg.dataset.page, 10) || 1; renderInvTable(); var tw = $("#invBody"); if(tw && tw.closest(".table-wrap")) tw.closest(".table-wrap").scrollTop = 0; return; }
    var sw = e.target.closest("#view-admin .switch, #view-staff .switch");
    if(sw){ sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true")); return; }
    if(e.target.closest("#inboxBadge")){ var ic = $("#inboxCard"); if(ic){ ic.scrollIntoView({behavior: reduceMotion ? "auto" : "smooth", block: "start"}); var f = ic.querySelector(".chip"); if(f) f.focus({preventScroll: true}); } }
  });
  $("#loginShow").addEventListener("click", function(){
    var pin = $("#loginPin"), show = pin.type === "password";
    pin.type = show ? "text" : "password";
    this.setAttribute("aria-pressed", String(show));
    this.setAttribute("aria-label", show ? "Hide passcode" : "Show passcode");
    this.title = show ? "Hide passcode" : "Show passcode";
    pin.focus();
  });
  $("#syncNow").addEventListener("click", function(){ runSync(this, $("#syncLog"), $("#intCard")); });
  $("#tcgRun").addEventListener("click", function(){ runSync(this, $("#tcgLog"), $("#tcgCard")); });
  $("#invSearch").addEventListener("input", TL.debounce(function(){ inv.q = $("#invSearch").value.trim().toLowerCase(); inv.page = 1; renderInvTable(); }, 160));
  $("#invGame").addEventListener("change", function(e){ inv.game = e.target.value; inv.page = 1; renderInvTable(); });
  $("#invSort").addEventListener("change", function(e){ inv.sort = e.target.value; inv.page = 1; renderInvTable(); });
  $("#invLowOnly").addEventListener("change", function(e){ inv.low = !!e.target.checked; inv.page = 1; renderInvTable(); });

  TL.on("inventory:summary", function(d){ if(d && d.summary) applySummary(d.summary); });
  TL.on("inventory:loaded", function(d){
    if(d && d.items && d.items.length && (TL.current === "admin")){ inv.items = d.items; renderLowStock(d.items); renderInvTable(); }
  });
  TL.on("api:ready", function(){ apiChecked = true; renderConn(); if(TL.api.online) refreshHealth(); else renderIntegrations(); });
  TL.on("auth:change", renderConn);
  TL.on("config:change", function(){ if(TL.current === "admin") renderShowStat(); });
  TL.on("view:change", function(d){
    if(!d || d.paramsOnly) return;
    if(d.name === "admin"){
      renderAdminDate(); renderConn(); renderIntegrations();
      if(TL.api.online) refreshHealth();
      ensureSummary(); renderShowStat();
      statNum($("#statSales"), 1284, {from: 0}); statNum($("#statOrders"), 23, {from: 0});
      if(invSummary) applySummary(invSummary);
      openAdminInventory();
    }
    if(d.name === "staff"){ renderAdminDate(); renderConn(); }
  });
  TL.on("view:leave", function(d){ if(d && d.name === "admin") stopSyncPoll(); });
  TL.on("init", function(){ renderAdminDate(); renderConn(); renderIntegrations(); });
