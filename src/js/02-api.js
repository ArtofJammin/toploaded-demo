  /* ---------- api client ----------
     Discovers the API base URL, first match wins:
       1. window.TL_API                                  (inline script or devtools override)
       2. <meta name="tl-api" content="https://toploaded-api.<you>.workers.dev">
       3. localStorage "tl-api"                          TL.store.set("api", url) points any copy of the page at a worker
       4. same-origin "/api" when served from localhost  (tools/dev-server.mjs mounts the worker there)
     With no base, or when GET /health fails, TL.api.online stays false and every
     feature uses its demo / localStorage fallback. Worker routes have NO /api prefix;
     the dev server strips it.

       TL.api.request(method, path, body, opts) → Promise<json>; rejects {status, error, data}
       TL.api.get/post/put/del(path, ...)
       TL.api.call(method, path, body, demoFn)   → request when online, else Promise.resolve(demoFn())
       TL.api.setAuth(token, role)               persists to sessionStorage, emits 'auth:change'
       TL.api.ready                              Promise<boolean online>
  */
  TL.api = (function(){
    function discover(){
      try {
        if(window.TL_API) return String(window.TL_API).replace(/\/+$/, "");
        var m = document.querySelector('meta[name="tl-api"]');
        if(m && m.content && m.content.trim()) return m.content.trim().replace(/\/+$/, "");
        var s = TL.store.get("api", null);
        if(s) return String(s).replace(/\/+$/, "");
        var h = location.hostname;
        if(h === "localhost" || h === "127.0.0.1" || h === "[::1]") return location.origin + "/api";
      } catch(e){}
      return null;
    }
    var api = {
      base: discover(),
      online: false,
      token: TL.session.get("token", null),
      role: TL.session.get("role", null)
    };
    api.request = function(method, path, body, opts){
      opts = opts || {};
      if(!api.base) return Promise.reject({status:0, error:"offline"});
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, opts.timeout || 8000) : null;
      var headers = {"Accept":"application/json"};
      var hasBody = body !== undefined && body !== null;
      if(hasBody) headers["Content-Type"] = "application/json";
      if(api.token && !opts.noAuth) headers["Authorization"] = "Bearer " + api.token;
      return fetch(api.base + path, {
        method: method, headers: headers,
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: ctrl ? ctrl.signal : undefined, credentials: "omit", cache: "no-store"
      }).then(function(r){
        clearTimeout(timer);
        return r.text().then(function(t){
          var d = null;
          try { d = t ? JSON.parse(t) : null; } catch(e){ d = {raw: t}; }
          if(!r.ok){
            if(r.status === 401 && api.token && !opts.noAuth) api.setAuth(null, null);
            throw {status: r.status, error: (d && d.error) || r.statusText || "error", data: d};
          }
          return d;
        });
      }, function(e){
        clearTimeout(timer);
        throw {status: 0, error: (e && e.name === "AbortError") ? "timeout" : "network"};
      });
    };
    api.get = function(path, opts){ return api.request("GET", path, null, opts); };
    api.post = function(path, body, opts){ return api.request("POST", path, body || {}, opts); };
    api.put = function(path, body, opts){ return api.request("PUT", path, body || {}, opts); };
    api.del = function(path, opts){ return api.request("DELETE", path, null, opts); };
    api.call = function(method, path, body, demoFn){
      if(api.online) return api.request(method, path, body);
      return Promise.resolve().then(function(){ return demoFn ? demoFn() : null; });
    };
    api.setAuth = function(token, role){
      api.token = token || null; api.role = token ? role : null;
      if(token){ TL.session.set("token", token); TL.session.set("role", role); }
      else { TL.session.del("token"); TL.session.del("role"); }
      TL.emit("auth:change", {role: api.role});
    };
    api.ready = api.base
      ? api.get("/health", {timeout: 4000, noAuth: true}).then(function(d){ api.online = !!(d && d.ok); return api.online; }).catch(function(){ api.online = false; return false; })
      : Promise.resolve(false);
    return api;
  })();
