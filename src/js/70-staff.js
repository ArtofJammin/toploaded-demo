  /* ---------- staff desk: store credit + pricing ----------
     API (staff token): GET /credit?q= · POST /credit {name, phone} · POST /credit/:id/add
     {cash} | {redeem:true, amount} · GET /credit/:id (customer + entries).
     Fallback (offline, or the worker has no credit route yet): TL.store "credit" =
     {customers:[{id, name, phone, balanceCents, updatedAt}], log:{id:[entries]}}.
     Money is kept in integer cents on this side; the API talks dollars. */
  var credServer = false, credCustomers = [], credKnown = {}, credSelected = null, credWhoKey = "";
  function ledger(){
    var l = TL.store.get("credit", null);
    if(!l || !l.customers){
      var now = new Date().toISOString();
      l = {customers: [
        {id: "c-alex", name: "Alex R.", phone: "(859) 555-0142", balanceCents: 8650, updatedAt: now, demo: true},
        {id: "c-dana", name: "Dana K.", phone: "(513) 555-0177", balanceCents: 21200, updatedAt: now, demo: true},
        {id: "c-marcus", name: "Marcus T.", phone: "(859) 555-0103", balanceCents: 1425, updatedAt: now, demo: true},
        {id: "c-priya", name: "Priya S.", phone: "(513) 555-0164", balanceCents: 0, updatedAt: now, demo: true}
      ], log: {}};
      TL.store.set("credit", l);
    }
    if(!l.log) l.log = {};
    return l;
  }
  function saveLedger(l){ TL.store.set("credit", l); }
  function bonusRate(){ var b = TL.config.buy && TL.config.buy.creditBonus; return typeof b === "number" ? b : 0.1; }
  function cents(dollars){ return Math.round((Number(dollars) || 0) * 100); }
  function fromLocal(c){ return {id: c.id, name: c.name, phone: c.phone || "", balance: (c.balanceCents || 0) / 100, updatedAt: c.updatedAt, demo: !!c.demo, local: true}; }
  function fromServer(c){ return {id: c.id, name: c.name, phone: c.phoneDisplay || c.phone || "", balance: Number(c.balance) || 0, updatedAt: c.updatedAt, local: false}; }
  function normalizePhone(p){ return String(p || "").replace(/\D/g, ""); }
  function credMode(server){
    credServer = server;
    var pill = $("#credMode"), note = $("#credNote");
    if(pill){ pill.className = "pill " + (server ? "ok" : "warn"); pill.innerHTML = '<span class="dot"></span>' + (server ? "API ledger" : "This device"); }
    if(note) note.textContent = server
      ? "Balances live on the shop's API ledger — every register sees the same numbers. Trade-ins taken in credit get the " + Math.round(bonusRate() * 100) + "% bonus automatically."
      : (TL.api.online ? "The API has no credit ledger route yet, so balances are kept on this device in whole cents. " : "Demo mode — balances are kept on this device in whole cents. ") + "Trade-ins taken in credit get the " + Math.round(bonusRate() * 100) + "% bonus automatically.";
  }
  function fetchCustomers(q){
    q = (q || "").trim();
    if(credServer){
      return apiTry("GET", "/credit?q=" + encodeURIComponent(q)).then(function(r){
        if(r.ok && r.data && Array.isArray(r.data.customers)) return r.data.customers.map(fromServer);
        credMode(false);
        return localSearch(q);
      });
    }
    return Promise.resolve(localSearch(q));
  }
  function localSearch(q){
    var lq = q.toLowerCase(), digits = normalizePhone(q);
    return ledger().customers.filter(function(c){
      if(!q) return true;
      return c.name.toLowerCase().indexOf(lq) > -1 || (digits && normalizePhone(c.phone).indexOf(digits) > -1);
    }).map(fromLocal);
  }
  function renderCredTable(list){
    var body = $("#credBody"); if(!body) return;
    body.innerHTML = list.length ? list.map(function(c){
      return '<tr data-cust="' + esc(c.id) + '"' + (credSelected && c.id === credSelected.id ? ' class="sel"' : "") + ' tabindex="0" role="button" aria-label="Select ' + esc(c.name) + '">' +
        '<td>' + esc(c.name) + (c.demo ? ' <span class="demo-tag">sample</span>' : "") + '</td><td class="num">' + esc(c.phone || "—") + '</td><td class="num">' + money(c.balance) + '</td></tr>';
    }).join("") : '<tr class="empty"><td colspan="3">No matches — add the customer under "New customer" below.</td></tr>';
  }
  function renderCredWho(list){
    var key = list.map(function(c){ return c.id; }).join("|");
    var sel = $("#credWho"); if(!sel) return;
    if(key === credWhoKey && sel.options.length){ if(credSelected) sel.value = credSelected.id; return; }
    credWhoKey = key;
    sel.innerHTML = list.length ? list.map(function(c){ return '<option value="' + esc(c.id) + '">' + esc(c.name) + (c.phone ? " · " + esc(c.phone) : "") + '</option>'; }).join("") : '<option value="">No customers yet</option>';
    if(credSelected && list.some(function(c){ return c.id === credSelected.id; })) sel.value = credSelected.id;
    else if(list.length){ credSelected = list[0]; }
  }
  function refreshCredit(q){
    return fetchCustomers(q === undefined ? $("#credSearch").value : q).then(function(list){
      list.forEach(function(c){ credKnown[c.id] = c; });
      if(q === undefined || q === ""){ credCustomers = list; renderCredWho(list); }
      renderCredTable(list);
      return list;
    });
  }
  function selectCustomer(id, openHistory){
    var c = credKnown[id]; if(!c) return;
    credSelected = c;
    var sel = $("#credWho");
    if(!sel.querySelector('option[value="' + id.replace(/"/g, "") + '"]')){ /* found by search but outside the recent list */
      var o = document.createElement("option"); o.value = c.id; o.textContent = c.name + (c.phone ? " · " + c.phone : ""); sel.appendChild(o);
    }
    sel.value = id;
    $$("#credBody tr").forEach(function(tr){ tr.classList.toggle("sel", tr.dataset.cust === id); });
    if(openHistory) showHistory(c);
  }
  function fetchHistory(c){
    if(!c.local && credServer){
      return apiTry("GET", "/credit/" + encodeURIComponent(c.id)).then(function(r){
        if(!r.ok || !r.data) return [];
        var d = r.data; return (d.entries || []).map(function(e){ /* newest first from the worker */
          return {at: e.at, kind: e.kind || "trade", cashCents: cents(e.cash), creditCents: cents(e.credited), balanceCents: cents(e.balanceAfter), note: e.note};
        });
      });
    }
    return Promise.resolve((ledger().log[c.id] || []).slice().reverse());
  }
  function showHistory(c){
    var box = $("#credHistory"), log = $("#credLog"); if(!box) return;
    box.hidden = false;
    $("#credHistName").textContent = c.name + " · balance " + money(c.balance);
    log.innerHTML = '<div><span class="t">Loading…</span></div>';
    fetchHistory(c).then(function(entries){
      if(!entries.length){ log.innerHTML = '<div><span class="t">No history yet' + (c.demo ? " — sample customer" : "") + '.</span></div>'; return; }
      log.innerHTML = entries.slice(0, 50).map(function(e){
        var neg = e.kind === "redeem" || e.creditCents < 0;
        return '<div><span class="t">' + esc(fmtStamp(e.at)) + '</span> · <span class="' + (neg ? "neg" : "amt") + '">' + (neg ? "−" : "+") + esc(money(Math.abs(e.creditCents) / 100)) + '</span> ' +
          esc(neg ? "redeemed" : (e.kind === "adjust" ? "adjustment" : "credit for " + money(e.cashCents / 100) + " cash trade")) + (e.note ? " · " + esc(e.note) : "") +
          (typeof e.balanceCents === "number" ? ' · <span class="t">balance ' + esc(money(e.balanceCents / 100)) + '</span>' : "") + '</div>';
      }).join("");
    });
  }
  function afterChange(c, entry, msg){
    credSelected = c;
    toast(msg);
    $("#credAmt").value = ""; $("#credRedeemAmt").value = "";
    refreshCredit("").then(function(){
      var q = $("#credSearch").value.trim(); if(q) refreshCredit(q);
      selectCustomer(c.id, true);
    });
    fillReceipt(c, entry);
  }
  function localAdd(id, cashCents){
    var l = ledger(), cu = null;
    for(var i = 0; i < l.customers.length; i++){ if(l.customers[i].id === id){ cu = l.customers[i]; break; } }
    if(!cu) return null;
    var creditCents = Math.round(cashCents * (1 + bonusRate()));
    cu.balanceCents = (cu.balanceCents || 0) + creditCents; cu.updatedAt = new Date().toISOString();
    var entry = {id: TL.uid(), at: cu.updatedAt, kind: "trade", cashCents: cashCents, creditCents: creditCents, balanceCents: cu.balanceCents};
    (l.log[id] = l.log[id] || []).push(entry);
    saveLedger(l);
    return {customer: fromLocal(cu), entry: entry};
  }
  function localRedeem(id, amountCents){
    var l = ledger(), cu = null;
    for(var i = 0; i < l.customers.length; i++){ if(l.customers[i].id === id){ cu = l.customers[i]; break; } }
    if(!cu) return null;
    if(amountCents > (cu.balanceCents || 0)) return {error: "Only " + money((cu.balanceCents || 0) / 100) + " on the account"};
    cu.balanceCents -= amountCents; cu.updatedAt = new Date().toISOString();
    var entry = {id: TL.uid(), at: cu.updatedAt, kind: "redeem", cashCents: 0, creditCents: amountCents, balanceCents: cu.balanceCents};
    (l.log[id] = l.log[id] || []).push(entry);
    saveLedger(l);
    return {customer: fromLocal(cu), entry: entry};
  }
  $("#credAdd").addEventListener("click", function(){
    var amt = parseFloat($("#credAmt").value), id = $("#credWho").value;
    if(!(amt > 0)){ toast("Enter the cash value of the trade first"); $("#credAmt").focus(); return; }
    if(!id){ toast("Pick or create a customer first"); return; }
    var cashCents = cents(amt), bonus = Math.round(bonusRate() * 100);
    var btn = this; btn.disabled = true;
    var p = credServer ? apiTry("POST", "/credit/" + encodeURIComponent(id) + "/add", {cash: amt}).then(function(r){
      if(r.ok && r.data && r.data.customer) return {customer: fromServer(r.data.customer), entry: r.data.entry ? {at: r.data.entry.at, kind: "trade", cashCents: cashCents, creditCents: cents(r.data.entry.credited), balanceCents: cents(r.data.entry.balanceAfter)} : null};
      toast("API refused the credit — " + errText(r)); return null;
    }) : Promise.resolve(localAdd(id, cashCents));
    p.then(function(res){
      btn.disabled = false;
      if(!res) return;
      var creditCents = Math.round(cashCents * (1 + bonusRate()));
      afterChange(res.customer, res.entry, money(cashCents / 100) + " trade → " + money(creditCents / 100) + " credit for " + res.customer.name + " (+" + bonus + "% bonus)");
    });
  });
  $("#credRedeem").addEventListener("click", function(){
    var amt = parseFloat($("#credRedeemAmt").value), id = $("#credWho").value;
    if(!(amt > 0)){ toast("Enter the amount to redeem"); $("#credRedeemAmt").focus(); return; }
    if(!id){ toast("Pick a customer first"); return; }
    var btn = this; btn.disabled = true;
    var p = credServer ? apiTry("POST", "/credit/" + encodeURIComponent(id) + "/add", {redeem: true, amount: amt}).then(function(r){
      if(r.ok && r.data && r.data.customer) return {customer: fromServer(r.data.customer), entry: {at: new Date().toISOString(), kind: "redeem", cashCents: 0, creditCents: cents(amt), balanceCents: cents(r.data.customer.balance)}};
      return {error: r.err && r.err.status === 409 ? "Not enough credit on the account" : "API refused — " + errText(r)};
    }) : Promise.resolve(localRedeem(id, cents(amt)));
    p.then(function(res){
      btn.disabled = false;
      if(!res) return;
      if(res.error){ toast(res.error); return; }
      afterChange(res.customer, res.entry, money(amt) + " redeemed — " + res.customer.name + " has " + money(res.customer.balance) + " left");
    });
  });
  $("#credNew").addEventListener("click", function(){
    var name = $("#credNewName").value.trim(), phone = $("#credNewPhone").value.trim();
    if(!name){ toast("Add the customer's name"); $("#credNewName").focus(); return; }
    if(phone && normalizePhone(phone).length < 7){ toast("That phone number looks short"); $("#credNewPhone").focus(); return; }
    var btn = this; btn.disabled = true;
    var p = credServer ? apiTry("POST", "/credit", {name: name, phone: phone}).then(function(r){
      if(r.ok && r.data) return fromServer(r.data.customer || r.data);
      toast(r.err && r.err.status === 409 ? "That phone number already has an account" : "API refused the new customer — " + errText(r)); return null;
    }) : Promise.resolve().then(function(){
      var l = ledger();
      if(phone && l.customers.some(function(c){ return normalizePhone(c.phone) === normalizePhone(phone); })){ toast("That phone number already has an account"); return null; }
      var cu = {id: "c-" + TL.uid(), name: name, phone: phone, balanceCents: 0, updatedAt: new Date().toISOString()};
      l.customers.push(cu); saveLedger(l);
      return fromLocal(cu);
    });
    p.then(function(cu){
      btn.disabled = false;
      if(!cu) return;
      $("#credNewName").value = ""; $("#credNewPhone").value = "";
      credSelected = cu;
      toast(cu.name + " added — pick a trade amount to start their credit");
      refreshCredit("").then(function(){ selectCustomer(cu.id, false); $("#credAmt").focus(); });
    });
  });
  $("#credSearch").addEventListener("input", TL.debounce(function(){ refreshCredit($("#credSearch").value); }, 200));
  $("#credWho").addEventListener("change", function(e){ selectCustomer(e.target.value, true); });
  $("#credBody").addEventListener("click", function(e){ var tr = e.target.closest("tr[data-cust]"); if(tr) selectCustomer(tr.dataset.cust, true); });
  $("#credBody").addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var tr = e.target.closest("tr[data-cust]"); if(!tr) return;
    e.preventDefault(); selectCustomer(tr.dataset.cust, true);
  });
  $("#credHistClose").addEventListener("click", function(){ $("#credHistory").hidden = true; });

  /* ---- printable credit receipt ---- */
  var lastReceipt = null;
  function fillReceipt(c, entry){
    lastReceipt = {c: c, entry: entry};
    var r = $("#credReceipt"); if(!r) return;
    var cfg = TL.config, a = cfg.address || {};
    r.innerHTML = '<h2>' + esc(cfg.title || "Top Loaded") + ' Trading Cards</h2>' +
      '<p>' + esc([a.line1, a.city, a.state, a.zip].filter(Boolean).join(", ")) + '</p><p>' + esc(cfg.phone || "") + '</p><hr>' +
      '<p><b>Store credit receipt</b></p><p>' + esc(fmtStamp(new Date().toISOString())) + '</p>' +
      '<p>Customer: ' + esc(c.name) + (c.phone ? " · " + esc(c.phone) : "") + '</p>' +
      (entry ? '<p>' + (entry.kind === "redeem" ? "Redeemed: " + esc(money(entry.creditCents / 100)) : "Trade (cash value): " + esc(money(entry.cashCents / 100)) + "<br>Credit added (+" + Math.round(bonusRate() * 100) + "%): " + esc(money(entry.creditCents / 100))) + '</p>' : "") +
      '<p class="big">Balance: ' + esc(money(c.balance)) + '</p><hr>' +
      '<p>Store credit is worth ' + Math.round(bonusRate() * 100) + '% more than cash on trade-ins. Thanks for keeping it local.</p>';
  }
  $("#credPrint").addEventListener("click", function(){
    if(!credSelected){ toast("Pick a customer first"); return; }
    if(!lastReceipt || lastReceipt.c.id !== credSelected.id) fillReceipt(credSelected, null);
    try { window.print(); } catch(e){ toast("Printing isn't available here"); }
  });

  /* ---- pricing desk ---- */
  var RATE_LABELS = {bulk: "bulk / slow movers", standard: "standard singles", hot: "hot / case cards", graded: "graded slabs"};
  function renderRates(){
    var sel = $("#pdRate"); if(!sel) return;
    var rates = (TL.config.buy && TL.config.buy.rates) || {}, prev = sel.value || "standard";
    var keys = ["bulk", "standard", "hot", "graded"].filter(function(k){ return typeof rates[k] === "number"; });
    sel.innerHTML = keys.map(function(k){ return '<option value="' + k + '"' + (k === prev || (!prev && k === "standard") ? " selected" : "") + '>' + Math.round(rates[k] * 100) + '% — ' + esc(RATE_LABELS[k] || k) + '</option>'; }).join("");
    if(!sel.value && keys.length) sel.value = keys.indexOf("standard") > -1 ? "standard" : keys[0];
    var b = Math.round(bonusRate() * 100);
    ["#pdBonusPct", "#credBonusPct"].forEach(function(s){ var el = $(s); if(el) el.textContent = b; });
    var tag = $("#pdRateTag"); if(tag) tag.textContent = TL.config.updatedAt ? "from settings" : "default rates";
    recalcPricing();
  }
  function recalcPricing(){
    var m = parseFloat($("#pdMarket").value), rates = (TL.config.buy && TL.config.buy.rates) || {}, r = rates[$("#pdRate").value];
    if(!(m > 0) || typeof r !== "number"){ $("#pdCash").textContent = "—"; $("#pdCredit").textContent = "—"; return; }
    var cashCents = Math.round(cents(m) * r), creditCents = Math.round(cashCents * (1 + bonusRate()));
    $("#pdCash").textContent = money(cashCents / 100);
    $("#pdCredit").textContent = money(creditCents / 100);
  }
  $("#pdMarket").addEventListener("input", recalcPricing);
  $("#pdRate").addEventListener("change", recalcPricing);

  function openStaff(){
    credMode(false);
    var probe = TL.api.online ? apiTry("GET", "/credit?q=") : Promise.resolve({ok: false});
    probe.then(function(r){
      credMode(!!(r.ok && r.data && Array.isArray(r.data.customers)));
      refreshCredit("").then(function(list){ if(list.length && !credSelected) selectCustomer(list[0].id, false); });
    });
    renderRates();
  }
  TL.on("config:change", function(){ renderRates(); if(TL.current === "staff") credMode(credServer); });
  TL.on("view:change", function(d){ if(d && d.name === "staff" && !d.paramsOnly) openStaff(); });
  TL.on("init", function(){ renderRates(); renderCredTable(localSearch("")); renderCredWho(localSearch("")); });
