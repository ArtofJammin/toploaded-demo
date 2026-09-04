  /* ---------- hero tilt ---------- */
  var stage = $("#stage"), holo = $("#holo"), sheen = $("#sheen");
  if(!reduceMotion && window.matchMedia("(pointer:fine)").matches){
    stage.addEventListener("pointermove", function(e){
      var r = stage.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5;
      var y = (e.clientY - r.top) / r.height - 0.5;
      holo.style.transform = "rotateY(" + (x * 18) + "deg) rotateX(" + (y * -14) + "deg)";
      sheen.style.setProperty("--shx", (50 + x * 90) + "%");
      sheen.style.setProperty("--shy", (50 + y * 90) + "%");
    });
    stage.addEventListener("pointerleave", function(){
      holo.style.transform = "";
      sheen.style.setProperty("--shx", "50%");
      sheen.style.setProperty("--shy", "50%");
    });
  }
