  /* ---------- core: shared namespace, event bus, storage, helpers ----------
     Every file in src/js shares one closure (see tools/build.mjs). Cross-module
     contract lives on window.TL so modules can be built independently:

       TL.on(ev, fn) / TL.off(ev, fn) / TL.emit(ev, data)   event bus
       TL.store.get(key, fallback) / .set(key, v) / .del(key) localStorage, JSON, "tl-" prefix, never throws
       TL.session.*                                           same, on sessionStorage
       TL.$ / TL.$$ / TL.money / TL.esc / TL.toast            helpers exported by 00-data, 05-toast, 25-products
       TL.reduceMotion                                        boolean
       TL.api                                                 API client (02-api.js)
       TL.config / TL.saveConfig(patch) / TL.shopStatus()     site config (03-config.js)
       TL.go(view, params) / TL.route()                       router (10-router.js)
       TL.cart.add(item, qty) / .count() / .open()            cart (35-cart.js)
       TL.inventory                                           {summary, items, generated, byId(id)} (30-inventory.js)
       TL.confetti(x, y, opts) / TL.flyTo(fromEl, toEl)       motion hooks — no-ops until a motion module defines them
       TL.countUp(el, to, opts)                               motion hook, no-op default
       TL.openQuickView(item) / TL.openModal(html, opts) / TL.closeModal()  overlays, no-op defaults

     Events (name → payload):
       'init'                            DOM parsed; modules render their initial state (registered handlers run in file order)
       'api:ready'      {online}         API health check finished
       'config:change'  {config, patch}  site config loaded or edited
       'inventory:summary' {summary}     inventory-summary.json loaded
       'inventory:loaded'  {items, generated}  full inventory.json loaded and normalized
       'view:change'    {name, params, prev}   a view became active
       'view:leave'     {name}                 a view is being hidden (stop timers)
       'cart:change'    {qty, total, lines}
       'auth:change'    {role}                 'staff' | 'admin' | null
       'live:change'    {live}                 TL.config.live changed
       'ready'          {online}               boot finished
  */
  var TL = window.TL = window.TL || {};
  TL.version = "2.0";
  var _bus = {};
  TL.on = function(ev, fn){ (_bus[ev] = _bus[ev] || []).push(fn); return function(){ TL.off(ev, fn); }; };
  TL.off = function(ev, fn){ var l = _bus[ev]; if(!l) return; var i = l.indexOf(fn); if(i > -1) l.splice(i, 1); };
  TL.emit = function(ev, data){
    var l = (_bus[ev] || []).slice();
    for(var i = 0; i < l.length; i++){
      try { l[i](data); } catch(e){ if(window.console) console.error("[TL:" + ev + "]", e); }
    }
  };
  function mkStore(area){
    return {
      get: function(k, fb){ try { var v = window[area].getItem("tl-" + k); return v === null ? fb : JSON.parse(v); } catch(e){ return fb; } },
      set: function(k, v){ try { window[area].setItem("tl-" + k, JSON.stringify(v)); return true; } catch(e){ return false; } },
      del: function(k){ try { window[area].removeItem("tl-" + k); } catch(e){} }
    };
  }
  TL.store = mkStore("localStorage");
  TL.session = mkStore("sessionStorage");
  TL.uid = function(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
  TL.debounce = function(fn, ms){
    var t; return function(){ var a = arguments, s = this; clearTimeout(t); t = setTimeout(function(){ fn.apply(s, a); }, ms); };
  };
  TL.clamp = function(n, lo, hi){ return Math.min(hi, Math.max(lo, n)); };
  TL.pad2 = function(n){ return (n < 10 ? "0" : "") + n; };
  /* Focus trap for modals/drawers: keeps Tab inside `el`, restores focus on release.
       var release = TL.trapFocus(el, {initial: firstInput}); … release(); */
  TL.trapFocus = function(el, opts){
    opts = opts || {};
    var prev = document.activeElement;
    var sel = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    function items(){ return Array.prototype.filter.call(el.querySelectorAll(sel), function(n){ return n.offsetParent !== null || n === document.activeElement; }); }
    function onKey(e){
      if(e.key !== "Tab") return;
      var f = items(); if(!f.length){ e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      if(e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey, true);
    var init = opts.initial || items()[0];
    if(init) try { init.focus(); } catch(e){}
    return function release(){
      document.removeEventListener("keydown", onKey, true);
      if(prev && prev.focus && opts.restore !== false) try { prev.focus(); } catch(e){}
    };
  };
  /* no-op defaults; feature modules replace these */
  TL.confetti = function(){};
  TL.flyTo = function(){};
  TL.countUp = function(el, to){ if(el) el.textContent = to; };
  TL.openQuickView = function(){};
  TL.openModal = function(){};
  TL.closeModal = function(){};
