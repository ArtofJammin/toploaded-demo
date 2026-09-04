  /* ---------- view switching ---------- */
  var views = {home:"#view-home", shop:"#view-shop", live:"#view-live", show:"#view-show", events:"#view-events", buylist:"#view-buylist", visit:"#view-visit", staff:"#view-staff", admin:"#view-admin"};
  var current = "home";
  var pendingView = null;
  function isAuthed(){ try { return sessionStorage.getItem("tl-staff") === "1"; } catch(e){ return false; } }
  function go(name){
    if(!views[name]) return;
    if((name === "admin" || name === "staff") && !isAuthed()){
      pendingView = name;
      openLogin();
      return;
    }
    current = name;
    Object.keys(views).forEach(function(k){ $(views[k]).classList.toggle("active", k === name); });
    $$(".mainnav button").forEach(function(b){ b.setAttribute("aria-current", String(b.dataset.go === name)); });
    if(name === "admin"){ renderAdmin(); }
    window.scrollTo({top:0, behavior:"auto"});
  }
  document.addEventListener("click", function(e){
    var t = e.target.closest("[data-go]");
    if(t){ go(t.dataset.go); }
  });
