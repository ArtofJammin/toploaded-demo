  /* ---------- toast ---------- */
  var toastEl = $("#toast"), toastTimer = null;
  function toast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove("on"); }, 2600);
  }
