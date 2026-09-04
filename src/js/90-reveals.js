  /* ---------- scroll-in reveals ---------- */
  if(!reduceMotion && "IntersectionObserver" in window){
    var srTargets = $$("#view-home .tri .panel, #view-show .gal, #view-show .show-date-card, #view-show .vendor-form, #view-events .tri .panel, #view-live .tri .panel, #view-buylist .buy-points .panel, #view-buylist .form-card, .section-head");
    srTargets.forEach(function(el){
      var idx = Array.prototype.indexOf.call(el.parentNode.children, el);
      el.classList.add("sr");
      el.style.setProperty("--srd", (Math.min(idx, 5) * 70) + "ms");
    });
    var srIO = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(en.isIntersecting){ en.target.classList.add("sr-in"); srIO.unobserve(en.target); }
      });
    }, {rootMargin:"0px 0px -10% 0px", threshold:.05});
    srTargets.forEach(function(el){ srIO.observe(el); });
  }
