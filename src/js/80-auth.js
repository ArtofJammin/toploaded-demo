  /* ---------- staff/admin auth ----------
     Two roles. With the API online the worker decides (POST /auth/login → HMAC token);
     offline/demo the passcode is hashed in the browser and compared to the two
     placeholder hashes below. Both placeholders MUST be changed before the owner
     sees the site; the current values are noted in CLAUDE.md (kept out of git).
       TL.auth.role()        'admin' | 'staff' | null
       TL.auth.can(view)     may the current role open this view
       TL.auth.openLogin(target)  show the modal; on success navigates to target
       TL.auth.login(pin) → Promise<role|null>
       TL.auth.logout()
     DOM contract (src/html/22-overlays.html): #loginModal #loginOverlay #loginForm
     #loginPin #loginCancel, plus any .logoutBtn. Emits 'auth:change' {role}. */
  var DEMO_ADMIN_HASH = "213d2c9854a9b82d6e119914ced2e04b627c8c98d94d89ef1b7953a40d5806c1";
  var DEMO_STAFF_HASH = "efe899c74558f20b08bbc19bf0228c0c25bddb7871d80bd34ac8b33c030b3698";
  function sha256hex(str){
    if(!(window.crypto && crypto.subtle && window.TextEncoder)) return Promise.resolve(null);
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then(function(buf){
      var a = new Uint8Array(buf), s = "";
      for(var i = 0; i < a.length; i++){ s += (a[i] < 16 ? "0" : "") + a[i].toString(16); }
      return s;
    });
  }
  function demoRole(pin){
    return sha256hex(pin).then(function(h){
      if(!h) return null; /* no WebCrypto (very old browser / file://) — no demo login */
      if(h === DEMO_ADMIN_HASH) return "admin";
      if(h === DEMO_STAFF_HASH) return "staff";
      return null;
    });
  }
  var releaseLoginTrap = null;
  TL.auth = {
    role: function(){ return TL.api.role || null; },
    can: function(view){
      var r = TL.auth.role();
      if(view === "admin") return r === "admin";
      if(view === "staff") return r === "admin" || r === "staff";
      return true;
    },
    openLogin: function(target){
      if(target) pendingView = target;
      var m = $("#loginModal"); if(!m) return;
      var hint = $("#loginHint");
      if(hint) hint.textContent = TL.api.online ? "Passcodes are checked by the shop's API." : "Demo gate — real staff accounts run through the API.";
      m.hidden = false;
      $("#loginOverlay").classList.add("open");
      $("#loginPin").value = "";
      loginError("");
      if(releaseLoginTrap) releaseLoginTrap();
      releaseLoginTrap = TL.trapFocus(m, {initial: $("#loginPin")});
    },
    closeLogin: function(){
      var m = $("#loginModal"); if(!m) return;
      m.hidden = true;
      $("#loginOverlay").classList.remove("open");
      pendingView = null;
      if(releaseLoginTrap){ releaseLoginTrap(); releaseLoginTrap = null; }
    },
    login: function(pin){
      pin = String(pin || "");
      if(!pin) return Promise.resolve(null);
      if(TL.api.online){
        return TL.api.post("/auth/login", {pin: pin}, {noAuth: true}).then(function(d){
          if(!d || !d.token) return null;
          TL.api.setAuth(d.token, d.role);
          return d.role;
        }).catch(function(e){
          if(e && e.status === 429) throw e;
          return null;
        });
      }
      return demoRole(pin).then(function(role){
        if(role) TL.api.setAuth(null, role);
        return role;
      });
    },
    logout: function(){
      if(TL.api.online && TL.api.token) TL.api.post("/auth/logout", {}).catch(function(){});
      TL.api.setAuth(null, null);
      if(TL.current === "admin" || TL.current === "staff") go("home");
    }
  };
  function loginError(msg){
    var el = $("#loginError");
    if(el){ el.textContent = msg; el.hidden = !msg; }
    else if(msg) toast(msg);
    $("#loginPin").setAttribute("aria-invalid", msg ? "true" : "false");
  }
  function openLogin(t){ TL.auth.openLogin(t); }
  function closeLogin(){ TL.auth.closeLogin(); }
  $("#loginForm").addEventListener("submit", function(e){
    e.preventDefault();
    var btn = $("#loginForm button[type=submit]"), pin = $("#loginPin").value;
    if(!pin){ loginError("Enter your passcode"); $("#loginPin").focus(); return; }
    loginError("");
    if(btn) btn.disabled = true;
    TL.auth.login(pin).then(function(role){
      if(btn) btn.disabled = false;
      if(role){
        var t = pendingView || (role === "admin" ? "admin" : "staff");
        if(!TL.auth.can(t)) t = "staff";
        closeLogin();
        go(t);
        toast(role === "admin" ? "Logged in — admin unlocked" : "Logged in — staff desk unlocked");
      } else {
        loginError("Wrong passcode — ask a manager");
        $("#loginPin").value = "";
        $("#loginPin").focus();
      }
    }, function(err){
      if(btn) btn.disabled = false;
      loginError(err && err.status === 429 ? "Too many tries — wait a few minutes" : "Login failed — try again");
    });
  });
  $("#loginCancel").addEventListener("click", closeLogin);
  $("#loginOverlay").addEventListener("click", closeLogin);
  document.addEventListener("click", function(e){
    if(e.target.closest(".logoutBtn")){ TL.auth.logout(); toast("Logged out"); }
  });
  /* a role that was granted by the API is re-validated once the API answers */
  TL.on("api:ready", function(d){
    if(!d || !d.online){ if(TL.api.token) TL.api.setAuth(null, TL.api.role); return; }
    if(TL.api.token) TL.api.get("/auth/me").catch(function(){ /* 401 already cleared it */ });
    else if(TL.api.role) TL.api.setAuth(null, null); /* demo role is not valid against a live API */
  });
  TL.on("auth:change", function(d){
    document.documentElement.setAttribute("data-role", (d && d.role) || "");
    if(!(d && d.role) && (TL.current === "admin" || TL.current === "staff")) go("home");
  });
  document.documentElement.setAttribute("data-role", TL.auth.role() || "");
