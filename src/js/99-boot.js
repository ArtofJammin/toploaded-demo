  /* ---------- boot ----------
     Runs last. Modules register TL.on("init", fn) in their own files; nothing here
     names a module function. Order: 'init' → API health check → 'api:ready'
     (03-config.js then fetches /config and emits 'config:change') → 'ready'. */
  TL.emit("init");
  TL.api.ready.then(function(online){
    document.documentElement.classList.toggle("api-online", !!online);
    TL.emit("api:ready", {online: !!online});
    TL.emit("ready", {online: !!online});
  });
