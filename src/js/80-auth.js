  /* ---------- staff/admin login gate ---------- */
  var AUTH_HASH = "213d2c9854a9b82d6e119914ced2e04b627c8c98d94d89ef1b7953a40d5806c1";
  function openLogin(){
    $("#loginModal").hidden = false;
    $("#loginOverlay").classList.add("open");
    $("#loginPin").value = "";
    $("#loginPin").focus();
  }
  function closeLogin(){
    $("#loginModal").hidden = true;
    $("#loginOverlay").classList.remove("open");
    pendingView = null;
  }
  function sha256hex(str){
    if(!(window.crypto && crypto.subtle && window.TextEncoder)) return Promise.resolve(null);
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then(function(buf){
      var a = new Uint8Array(buf), s = "";
      for(var i = 0; i < a.length; i++){ s += (a[i] < 16 ? "0" : "") + a[i].toString(16); }
      return s;
    });
  }
  $("#loginForm").addEventListener("submit", function(e){
    e.preventDefault();
    var pin = $("#loginPin").value;
    sha256hex(pin).then(function(h){
      var ok = h ? (h === AUTH_HASH) : (pin === atob("dG9wbG9hZGVk"));
      if(ok){
        try { sessionStorage.setItem("tl-staff", "1"); } catch(e2){}
        var t = pendingView || "admin";
        closeLogin();
        go(t);
        toast("Logged in — back of house unlocked");
      } else {
        toast("Wrong passcode — ask a manager");
        $("#loginPin").value = "";
        $("#loginPin").focus();
      }
    });
  });
  $("#loginCancel").addEventListener("click", closeLogin);
  $("#loginOverlay").addEventListener("click", closeLogin);
  document.addEventListener("click", function(e){
    if(e.target.closest(".logoutBtn")){
      try { sessionStorage.removeItem("tl-staff"); } catch(e2){}
      toast("Logged out");
      go("home");
    }
  });
