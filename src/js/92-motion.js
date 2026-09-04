  /* ---------- motion library ----------
     Replaces the no-op hooks from 00-core.js. Every routine checks reduceMotion itself
     (the CSS .01ms rule does not reach WAAPI or canvas work) and is safe to call anywhere.
       TL.motion.reduced / .fine              live flags (reduced follows the OS toggle)
       TL.motion.replay(el, cls)              restart a CSS animation class
       TL.motion.watch(el, cb(inView))        shared IntersectionObserver, keeps firing (returns unwatch)
       TL.confetti(x, y, {count, colors, spread})   foil confetti burst on one shared canvas
       TL.flyTo(fromEl, toEl, {img})          card thumbnail arcs into a target, target pops
       TL.countUp(el, to, {prefix, suffix, decimals, duration, from})
       TL.tilt(el, {max, area, sheen}) → destroy()   pointer tilt + sheen vars (--mx --my --shx --shy)
     Also: html.page-hidden while the tab is hidden (CSS pauses infinite animations on it) and
     the cursor spotlight over .panel/.prod (--sx/--sy in px + .spot-lit), pointer:fine only. */
  var motionFineMQ = window.matchMedia ? window.matchMedia("(pointer:fine)") : null;
  TL.motion = {
    get reduced(){ return !!reduceMotion; },
    fine: !!(motionFineMQ && motionFineMQ.matches),
    replay: function(el, cls){ if(!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); },
    watch: function(el, cb){
      if(!el || typeof cb !== "function") return function(){};
      if(!ioWatch){ cb(true); return function(){}; }
      ioWatchers.push({el: el, cb: cb});
      ioWatch.observe(el);
      return function(){ ioWatch.unobserve(el); ioWatchers = ioWatchers.filter(function(w){ return w.el !== el; }); };
    }
  };
  if(motionFineMQ && motionFineMQ.addEventListener) motionFineMQ.addEventListener("change", function(e){ TL.motion.fine = e.matches; });
  var ioWatchers = [];
  var ioWatch = ("IntersectionObserver" in window) ? new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      for(var i = 0; i < ioWatchers.length; i++){ if(ioWatchers[i].el === en.target) ioWatchers[i].cb(en.isIntersecting, en); }
    });
  }, {rootMargin: "80px 0px", threshold: 0}) : null;
  function syncPageHidden(){ document.documentElement.classList.toggle("page-hidden", !!document.hidden); }
  document.addEventListener("visibilitychange", syncPageHidden);
  syncPageHidden();

  /* ---- confetti ---- */
  var fxEl = null, fxCtx = null, fxParts = [], fxRaf = 0, fxLast = 0;
  function fxSize(){
    var d = Math.min(window.devicePixelRatio || 1, 2);
    if(fxEl.width !== Math.round(innerWidth * d) || fxEl.height !== Math.round(innerHeight * d)){
      fxEl.width = Math.round(innerWidth * d); fxEl.height = Math.round(innerHeight * d);
    }
    fxCtx.setTransform(d, 0, 0, d, 0, 0);
  }
  function fxStep(ts){
    fxRaf = 0;
    var dt = fxLast ? Math.min(48, ts - fxLast) : 16; fxLast = ts;
    var k = dt / 16.7, W = innerWidth, H = innerHeight;
    fxCtx.clearRect(0, 0, W, H);
    var alive = [];
    for(var i = 0; i < fxParts.length; i++){
      var p = fxParts[i];
      p.vy += 0.35 * k; p.vx *= Math.pow(0.985, k); p.vy *= Math.pow(0.99, k);
      p.x += p.vx * k; p.y += p.vy * k; p.rot += p.vr * k; p.age += dt;
      if(p.age >= p.life || p.y > H + 24) continue;
      var a = p.age > p.life * 0.6 ? 1 - (p.age - p.life * 0.6) / (p.life * 0.4) : 1;
      fxCtx.save();
      fxCtx.globalAlpha = Math.max(0, a);
      fxCtx.translate(p.x, p.y); fxCtx.rotate(p.rot);
      fxCtx.scale(Math.max(0.15, Math.abs(Math.cos(p.age / 110 + p.ph))), 1); /* foil flicker */
      fxCtx.fillStyle = p.color;
      fxCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      fxCtx.restore();
      alive.push(p);
    }
    fxParts = alive;
    if(fxParts.length && !document.hidden) fxRaf = requestAnimationFrame(fxStep);
    else { fxParts = []; fxCtx.clearRect(0, 0, W, H); fxEl.hidden = true; fxLast = 0; }
  }
  TL.confetti = function(x, y, opts){
    if(reduceMotion || document.hidden || !window.requestAnimationFrame) return;
    opts = opts || {};
    x = typeof x === "number" ? x : innerWidth / 2;
    y = typeof y === "number" ? y : innerHeight / 2;
    var count = TL.clamp(opts.count || 90, 1, 120);
    var colors = opts.colors;
    if(!colors || !colors.length){
      var cs = getComputedStyle(document.documentElement);
      colors = ["--foilA", "--foilB", "--foilC", "--foilD", "--accent"].map(function(v){ return cs.getPropertyValue(v).trim(); }).filter(Boolean);
      if(!colors.length) colors = ["#FFD23F", "#FFFFFF"];
    }
    var spread = ((opts.spread || 70) * Math.PI / 180) / 2;
    if(!fxEl){
      fxEl = document.createElement("canvas"); fxEl.id = "fxCanvas"; fxEl.setAttribute("aria-hidden", "true");
      document.body.appendChild(fxEl); fxCtx = fxEl.getContext("2d");
      window.addEventListener("resize", function(){ if(fxEl && !fxEl.hidden) fxSize(); });
    }
    for(var i = 0; i < count; i++){
      var ang = -Math.PI / 2 + (Math.random() * 2 - 1) * spread, sp = 6 + Math.random() * 9;
      fxParts.push({x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, w: 4 + Math.random() * 5, h: 3 + Math.random() * 5,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, ph: Math.random() * 6.3,
        color: colors[i % colors.length], life: 1200 + Math.random() * 500, age: 0});
    }
    if(fxParts.length > 200) fxParts.splice(0, fxParts.length - 200);
    fxSize(); fxEl.hidden = false;
    if(!fxRaf) fxRaf = requestAnimationFrame(fxStep);
  };

  /* ---- fly to target ---- */
  var flyInflight = 0;
  function popTarget(el){ if(el) TL.motion.replay(el, "tl-pop"); }
  TL.flyTo = function(fromEl, toEl, opts){
    opts = opts || {};
    if(!toEl){ return; }
    if(reduceMotion || !fromEl || !fromEl.getBoundingClientRect || !("animate" in document.body) || flyInflight >= 3){ popTarget(toEl); return; }
    var src = opts.img || fromEl.querySelector("img, svg") || fromEl;
    var r = src.getBoundingClientRect(); if(!r.width || !r.height){ src = fromEl; r = fromEl.getBoundingClientRect(); }
    var t = toEl.getBoundingClientRect();
    if(!r.width || !t.width){ popTarget(toEl); return; }
    var clone = document.createElement("div"); clone.className = "fly-clone";
    var node;
    if(src.tagName === "IMG"){ node = new Image(); node.alt = ""; node.src = src.currentSrc || src.src; }
    else { node = src.cloneNode(true); if(node.removeAttribute){ node.removeAttribute("id"); } }
    if(node.setAttribute) node.setAttribute("aria-hidden", "true");
    clone.appendChild(node);
    var w = Math.min(r.width, 140), h = r.height * (w / r.width);
    clone.style.left = (r.left + (r.width - w) / 2) + "px"; clone.style.top = (r.top + (r.height - h) / 2) + "px";
    clone.style.width = w + "px"; clone.style.height = h + "px";
    document.body.appendChild(clone);
    var dx = (t.left + t.width / 2) - (r.left + r.width / 2), dy = (t.top + t.height / 2) - (r.top + r.height / 2);
    flyInflight++;
    var done = false;
    function finish(){
      if(done) return; done = true; flyInflight--;
      if(clone.parentNode) clone.parentNode.removeChild(clone);
      popTarget(toEl);
      var btn = toEl.closest ? toEl.closest("button") : null; if(btn && btn !== toEl) TL.motion.replay(btn, "tl-bump");
    }
    try {
      var anim = clone.animate([
        {transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1},
        {transform: "translate(" + (dx * 0.45) + "px," + (dy * 0.45 - 90) + "px) scale(.55) rotate(-10deg)", opacity: 1, offset: 0.45},
        {transform: "translate(" + dx + "px," + dy + "px) scale(.08) rotate(14deg)", opacity: 0.85}
      ], {duration: 650, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards"});
      anim.onfinish = finish; anim.oncancel = finish;
      setTimeout(finish, 900);
    } catch(e){ finish(); }
  };

  /* ---- count up ---- */
  var cuTweens = [], cuRaf = 0;
  function cuStep(ts){
    cuRaf = 0;
    var keep = [];
    for(var i = 0; i < cuTweens.length; i++){
      var tw = cuTweens[i];
      if(!tw.start) tw.start = ts;
      var p = Math.min(1, (ts - tw.start) / tw.dur), e = 1 - Math.pow(1 - p, 3);
      tw.write(tw.from + (tw.to - tw.from) * e);
      if(p < 1) keep.push(tw);
    }
    cuTweens = keep;
    if(cuTweens.length) cuRaf = requestAnimationFrame(cuStep);
  }
  TL.countUp = function(el, to, opts){
    if(!el) return;
    opts = opts || {};
    to = Number(to) || 0;
    var dec = opts.decimals != null ? opts.decimals : 0, prefix = opts.prefix || "", suffix = opts.suffix || "";
    function fmt(n){
      var s = dec ? Math.abs(n).toFixed(dec) : String(Math.round(Math.abs(n))), i = s.indexOf(".");
      var int = i > -1 ? s.slice(0, i) : s, frac = i > -1 ? s.slice(i) : "";
      return (n < 0 ? "-" : "") + prefix + int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + frac + suffix;
    }
    var textNode = (el.firstChild && el.firstChild.nodeType === 3 && el.childNodes.length > 1) ? el.firstChild : null;
    function write(n){ if(textNode) textNode.nodeValue = fmt(n); else el.textContent = fmt(n); }
    var cur = textNode ? textNode.nodeValue : el.textContent;
    var from = opts.from != null ? Number(opts.from) : (parseFloat(String(cur).replace(/[^0-9.\-]/g, "")) || 0);
    el.style.fontVariantNumeric = "tabular-nums";
    if(reduceMotion || document.hidden || !window.requestAnimationFrame || from === to){ write(to); return; }
    cuTweens = cuTweens.filter(function(t){ return t.el !== el; });
    cuTweens.push({el: el, from: from, to: to, dur: opts.duration || 900, start: 0, write: write});
    if(!cuRaf) cuRaf = requestAnimationFrame(cuStep);
  };

  /* ---- pointer tilt + sheen ---- */
  TL.tilt = function(el, opts){
    opts = opts || {};
    if(!el || reduceMotion || !TL.motion.fine) return function(){};
    var max = opts.max || 14, area = opts.area || el, raf = 0, last = null;
    var sheen = null;
    if(opts.sheen !== false && !el.querySelector(".sheen, .tl-sheen")){
      sheen = document.createElement("span"); sheen.className = "tl-sheen"; sheen.setAttribute("aria-hidden", "true"); el.appendChild(sheen);
    }
    function frame(){
      raf = 0; if(!last) return;
      var r = area.getBoundingClientRect(); if(!r.width || !r.height) return;
      var x = TL.clamp((last.x - r.left) / r.width - 0.5, -0.5, 0.5), y = TL.clamp((last.y - r.top) / r.height - 0.5, -0.5, 0.5);
      el.style.transform = "rotateY(" + (x * max * 1.3).toFixed(2) + "deg) rotateX(" + (-y * max).toFixed(2) + "deg)";
      el.style.setProperty("--mx", (50 + x * 100).toFixed(1) + "%"); el.style.setProperty("--my", (50 + y * 100).toFixed(1) + "%");
      el.style.setProperty("--shx", (50 + x * 90).toFixed(1) + "%"); el.style.setProperty("--shy", (50 + y * 90).toFixed(1) + "%");
    }
    function move(e){ if(document.hidden) return; last = {x: e.clientX, y: e.clientY}; if(!raf) raf = requestAnimationFrame(frame); }
    function leave(){
      last = null; el.style.transform = "";
      ["--mx", "--my", "--shx", "--shy"].forEach(function(v){ el.style.removeProperty(v); });
    }
    area.addEventListener("pointermove", move);
    area.addEventListener("pointerleave", leave);
    el.classList.add("tl-tilt");
    return function destroy(){
      area.removeEventListener("pointermove", move); area.removeEventListener("pointerleave", leave);
      if(raf) cancelAnimationFrame(raf);
      leave(); el.classList.remove("tl-tilt");
      if(sheen && sheen.parentNode) sheen.parentNode.removeChild(sheen);
    };
  };

  /* ---- cursor spotlight over .panel / .prod (pointer:fine only) ---- */
  (function(){
    if(!TL.motion.fine) return;
    var lit = null, raf = 0, ev = null;
    function clear(){ if(lit){ lit.classList.remove("spot-lit"); lit.style.removeProperty("--sx"); lit.style.removeProperty("--sy"); lit = null; } }
    function frame(){
      raf = 0; var e = ev; if(!e) return;
      var t = (e.target && e.target.closest) ? e.target.closest(".panel, .prod, .stat, .admin-card") : null;
      if(t !== lit){ clear(); lit = t; if(t) t.classList.add("spot-lit"); }
      if(t){ var r = t.getBoundingClientRect(); t.style.setProperty("--sx", Math.round(e.clientX - r.left) + "px"); t.style.setProperty("--sy", Math.round(e.clientY - r.top) + "px"); }
    }
    document.addEventListener("pointermove", function(e){
      if(reduceMotion || document.hidden || e.pointerType === "touch") return;
      ev = e; if(!raf) raf = requestAnimationFrame(frame);
    }, {passive: true});
    document.addEventListener("pointerleave", clear);
    TL.on("motion:change", function(d){ if(d && d.reduce) clear(); });
  })();
