  /* ---------- scroll-in reveals + count-up triggers (one IntersectionObserver) ----------
     revealAdd(el, idx)   observe a dynamically rendered element (no-op under reduced motion)
     observeCount(el)     count el up to its data-count when it scrolls into view
                          (data-prefix / data-suffix / data-decimals optional) */
  var srIO = null;
  function runCount(el){
    var to = parseFloat(el.getAttribute("data-count")) || 0;
    TL.countUp(el, to, {prefix: el.dataset.prefix || "", suffix: el.dataset.suffix || "", decimals: parseInt(el.dataset.decimals || "0", 10), duration: 1100});
    el.dataset.counted = "1";
  }
  function observeCount(el){
    if(!el) return;
    if(srIO) srIO.observe(el); else runCount(el);
  }
  function revealAdd(el, idx){
    if(!el || !srIO || reduceMotion) return;
    if(typeof idx !== "number") idx = Array.prototype.indexOf.call(el.parentNode.children, el);
    el.classList.add("sr");
    el.style.setProperty("--srd", (Math.min(idx, 5) * 70) + "ms");
    srIO.observe(el);
  }
  if("IntersectionObserver" in window){
    srIO = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(!en.isIntersecting) return;
        var el = en.target;
        if(el.hasAttribute("data-count")) runCount(el); else el.classList.add("sr-in");
        srIO.unobserve(el);
      });
    }, {rootMargin: "0px 0px -10% 0px", threshold: .05});
  }
  if(!reduceMotion && srIO){
    $$("#view-home .tri .panel, #view-home .nextup-cell, #view-home .case-stats > div, #view-home .promo-rip, #view-home .faq details, " +
       "#view-show .gal, #view-show .show-date-card, #view-show .vendor-form, #view-events .tri .panel, #view-live .tri .panel, " +
       "#view-buylist .buy-points .panel, #view-buylist .form-card, .section-head").forEach(function(el){ revealAdd(el); });
  }
  $$("[data-count]").forEach(observeCount);
  /* OS reduce-motion switched on mid-session: show everything, stop waiting for scroll */
  TL.on("motion:change", function(d){
    if(!(d && d.reduce)) return;
    $$(".sr").forEach(function(el){ el.classList.add("sr-in"); });
  });
