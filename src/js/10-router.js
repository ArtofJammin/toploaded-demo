  /* ---------- router: hash routes, view lifecycle, transitions ----------
     Views are <section class="view" id="view-NAME"> discovered from the DOM, so a new
     file in src/html adding a section registers a route automatically.
       URL shape:  #/shop?game=pk&q=charizard     home is "#/" or an empty hash
       TL.go(name, params?, {replace?, keepScroll?})   navigate (pushes history)
       TL.route()            → {name, params}          current route
       TL.setParams(params, {replace:true})            update the URL query without re-rendering
       TL.current            name of the active view
     Events: 'view:leave' {name}  then  'view:change' {name, params, prev, paramsOnly}
     Modules that run timers (live chat, countdowns, marquee) start them on
     view:change for their view and stop them on view:leave.
     Gate: staff/admin views ask TL.auth.can(name) (80-auth.js) and open the login
     modal when it says no; the pending target is stored in pendingView. */
  var views = {};
  $$("section.view[id^='view-']").forEach(function(s){ views[s.id.slice(5)] = "#" + s.id; });
  var current = "home";
  var pendingView = null;
  var VIEW_TITLES = {home:"", shop:"Shop", live:"Live breaks", show:"Card show", events:"Play nights", buylist:"Sell to us", visit:"Visit", staff:"Staff desk", admin:"Admin", rip:"Pack rip"};
  var BASE_TITLE = document.title;
  function isAuthed(){
    if(TL.auth && typeof TL.auth.can === "function") return TL.auth.can(current);
    try { return sessionStorage.getItem("tl-staff") === "1"; } catch(e){ return false; }
  }
  function canView(name){
    if(name !== "admin" && name !== "staff") return true;
    if(TL.auth && typeof TL.auth.can === "function") return TL.auth.can(name);
    try { return sessionStorage.getItem("tl-staff") === "1"; } catch(e){ return false; }
  }
  function dec(s){ try { return decodeURIComponent(s); } catch(e){ return s; } }
  function parseHash(h){
    h = h || location.hash || "";
    if(h.indexOf("#/") !== 0) return null;
    var body = h.slice(2), q = body.indexOf("?"), name = q > -1 ? body.slice(0, q) : body, params = {};
    if(q > -1){
      body.slice(q + 1).split("&").forEach(function(kv){
        if(!kv) return;
        var i = kv.indexOf("="), k = dec(i > -1 ? kv.slice(0, i) : kv), v = i > -1 ? dec(kv.slice(i + 1).replace(/\+/g, " ")) : "";
        params[k] = v;
      });
    }
    return {name: dec(name) || "home", params: params};
  }
  function buildHash(name, params){
    var qs = Object.keys(params || {}).filter(function(k){ return params[k] !== undefined && params[k] !== null && params[k] !== ""; })
      .map(function(k){ return encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])); }).join("&");
    return "#/" + (name === "home" ? "" : name) + (qs ? "?" + qs : "");
  }
  var lastRoute = {name: null, params: {}};
  function sameParams(a, b){ return JSON.stringify(a || {}) === JSON.stringify(b || {}); }
  function show(name, params, opts){
    opts = opts || {};
    if(!views[name]) name = "home";
    if(!canView(name)){
      pendingView = name;
      if(TL.auth && TL.auth.openLogin) TL.auth.openLogin(name); else if(typeof openLogin === "function") openLogin();
      if(lastRoute.name) history.replaceState(null, "", buildHash(lastRoute.name, lastRoute.params));
      return;
    }
    var prev = current, paramsOnly = (prev === name && lastRoute.name === name);
    current = name;
    lastRoute = {name: name, params: params || {}};
    function swap(){
      if(!paramsOnly){
        TL.emit("view:leave", {name: prev});
        Object.keys(views).forEach(function(k){ var el = $(views[k]); if(el) el.classList.toggle("active", k === name); });
        $$(".mainnav [data-go]").forEach(function(b){ if(b.dataset.go === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
        document.title = (VIEW_TITLES[name] ? VIEW_TITLES[name] + " · " : "") + BASE_TITLE;
        if(!opts.keepScroll) window.scrollTo({top: 0, behavior: "auto"});
        var v = $(views[name]), h1 = v && v.querySelector("h1");
        if(h1 && !opts.noFocus){ h1.setAttribute("tabindex", "-1"); try { h1.focus({preventScroll: true}); } catch(e){} }
      }
      TL.emit("view:change", {name: name, params: params || {}, prev: prev, paramsOnly: paramsOnly});
    }
    if(!paramsOnly && !reduceMotion && document.startViewTransition && !opts.noTransition && !document.hidden){
      document.documentElement.classList.add("vt");
      var t = document.startViewTransition(swap), noop = function(){};
      /* every promise on the transition can reject when navigations overlap; none of that is an error for us */
      if(t.ready) t.ready.catch(noop);
      if(t.updateCallbackDone) t.updateCallbackDone.catch(noop);
      var done = function(){ document.documentElement.classList.remove("vt"); };
      if(t.finished) t.finished.then(done, done); else done();
    } else swap();
  }
  function go(name, params, opts){
    opts = opts || {};
    if(!views[name]) return;
    var h = buildHash(name, params);
    if(("#" + location.hash.slice(1)) === h || (h === "#/" && !location.hash)){ show(name, params || {}, opts); return; }
    if(opts.replace) { history.replaceState(null, "", h); show(name, params || {}, opts); }
    else location.hash = h; // hashchange → show()
  }
  TL.go = go;
  TL.route = function(){ return {name: current, params: lastRoute.params || {}}; };
  TL.setParams = function(params, opts){
    opts = opts || {replace: true};
    lastRoute = {name: current, params: params || {}};
    var h = buildHash(current, params);
    if(opts.replace !== false) history.replaceState(null, "", h); else location.hash = h;
  };
  Object.defineProperty(TL, "current", {get: function(){ return current; }});
  window.addEventListener("hashchange", function(){
    var r = parseHash();
    if(!r) return;
    if(r.name === current && sameParams(r.params, lastRoute.params)) return;
    show(r.name, r.params, {});
  });
  document.addEventListener("click", function(e){
    var t = e.target.closest("[data-go]");
    if(!t) return;
    /* real links (<a href="#/shop">) navigate on their own — keeps middle-click / open-in-new-tab working */
    if(t.tagName === "A" && (t.getAttribute("href") || "").indexOf("#/") === 0 && !t.dataset.params){
      if(e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault(); go(t.dataset.go, {}); return;
    }
    var params = {};
    if(t.dataset.params){ t.dataset.params.split("&").forEach(function(kv){ var i = kv.indexOf("="); if(i > -1) params[kv.slice(0, i)] = kv.slice(i + 1); }); }
    go(t.dataset.go, params);
  });
  TL.on("init", function(){
    var r = parseHash();
    if(r && views[r.name]) show(r.name, r.params, {noTransition: true, noFocus: true, keepScroll: true});
    else show("home", {}, {noTransition: true, noFocus: true, keepScroll: true});
  });
