  /* ---------- forms: one shared submit helper ----------
     TL.forms.bind(form, opts) wires a <form> to POST /forms/<kind>:
       opts.kind        'vendor' | 'buylist' | 'signup' | 'newsletter' | …  (default form.dataset.kind)
       opts.collect(f)  → fields object to send (default: every named control except the honeypot)
       opts.validate(fields, form) → {field:<name>, msg} to block, or null
       opts.success(fields, res, {local}) → inner HTML for the success panel (esc() everything dynamic)
       opts.mailto(fields) → {href, label} secondary link offered offline / on failure
       opts.onSuccess(fields, res, {local})
     Behaviour: inline validation messages next to the field, honeypot check, disabled
     "Sending…" state, success panel that replaces the form with a "Send another" link,
     failure message with retry, and the offline fallback per contract: when
     TL.api.online is false the submission is appended to TL.store "forms" as
     {id, kind, at, status:"new", local:true, ...fields} and the mailto is offered.
     TL.forms.submit(kind, fields) → Promise<{ok, id, local}> for programmatic use.
     TL.forms.local(kind?) → locally queued submissions. Never throws. */
  var FORM_MSG = {
    required: "This one's required",
    email: "Enter a valid email like you@example.com",
    tel: "Enter a phone number we can reach you on",
    url: "Paste a full link starting with http",
    contact: "Enter an email or a phone number"
  };
  var FORMS_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function formsLooksEmail(s){ return FORMS_EMAIL_RE.test(String(s || "").trim()); }
  function formsLooksPhone(s){ return (String(s || "").replace(/\D/g, "")).length >= 7; }
  function formsLocal(kind){
    var all = TL.store.get("forms", []);
    if(!Array.isArray(all)) all = [];
    return kind ? all.filter(function(x){ return x && x.kind === kind; }) : all;
  }
  function formsQueueLocal(kind, fields){
    var all = formsLocal();
    var rec = {id: "local-" + TL.uid(), kind: kind, at: new Date().toISOString(), status: "new", local: true};
    Object.keys(fields || {}).forEach(function(k){ if(k !== "website" && !(k in rec)) rec[k] = fields[k]; });
    all.unshift(rec);
    TL.store.set("forms", all.slice(0, 200));
    return rec;
  }
  function formsSubmit(kind, fields){
    fields = fields || {};
    if(fields.website){ /* honeypot tripped: pretend it went through, keep nothing */
      return Promise.resolve({ok: true, id: "hp", local: false});
    }
    var body = {}; Object.keys(fields).forEach(function(k){ if(fields[k] !== undefined && fields[k] !== "") body[k] = fields[k]; });
    body.website = "";
    if(!TL.api.online){
      var rec = formsQueueLocal(kind, fields);
      return Promise.resolve({ok: true, id: rec.id, local: true});
    }
    return TL.api.post("/forms/" + encodeURIComponent(kind), body).then(function(d){
      return {ok: true, id: (d && d.id) || TL.uid(), local: false, emailed: !!(d && d.emailed)};
    });
  }
  function formsFieldWrap(ctrl){ return ctrl.closest(".field") || ctrl.parentNode; }
  function formsSetFieldError(ctrl, msg){
    var wrap = formsFieldWrap(ctrl); if(!wrap) return;
    var id = (ctrl.id || ctrl.name || "f") + "-err";
    var el = wrap.querySelector(".field-err");
    if(!el){ el = document.createElement("p"); el.className = "field-err"; el.id = id; wrap.appendChild(el); }
    el.textContent = msg;
    ctrl.setAttribute("aria-invalid", "true");
    var desc = (ctrl.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    if(desc.indexOf(id) === -1) desc.push(id);
    ctrl.setAttribute("aria-describedby", desc.join(" "));
  }
  function formsClearFieldError(ctrl){
    var wrap = formsFieldWrap(ctrl); if(!wrap) return;
    var el = wrap.querySelector(".field-err"); if(el) el.remove();
    ctrl.removeAttribute("aria-invalid");
    var desc = (ctrl.getAttribute("aria-describedby") || "").split(/\s+/).filter(function(d){ return d && !/-err$/.test(d); });
    if(desc.length) ctrl.setAttribute("aria-describedby", desc.join(" ")); else ctrl.removeAttribute("aria-describedby");
  }
  function formsClearErrors(form){
    $$("[aria-invalid]", form).forEach(formsClearFieldError);
    $$(".field-err", form).forEach(function(e){ e.remove(); });
    var f = $(".form-fail", form); if(f) f.remove();
  }
  function formsControls(form){
    return $$("input,select,textarea", form).filter(function(c){ return c.name && c.name !== "website" && c.type !== "submit" && c.type !== "button"; });
  }
  function formsCollect(form){
    var out = {};
    $$("input,select,textarea", form).forEach(function(c){
      if(!c.name || c.type === "submit" || c.type === "button") return;
      if(c.type === "checkbox"){ out[c.name] = !!c.checked; return; }
      if(c.type === "radio"){ if(c.checked) out[c.name] = c.value; return; }
      out[c.name] = String(c.value || "").trim();
    });
    return out;
  }
  function formsValidate(form){
    var ctrls = formsControls(form);
    for(var i = 0; i < ctrls.length; i++){
      var c = ctrls[i], v = String(c.value || "").trim();
      if(c.required && !v) return {ctrl: c, msg: FORM_MSG.required};
      if(!v) continue;
      if(c.type === "email" && !formsLooksEmail(v)) return {ctrl: c, msg: FORM_MSG.email};
      if(c.type === "tel" && !formsLooksPhone(v)) return {ctrl: c, msg: FORM_MSG.tel};
      if(c.type === "url" && !/^https?:\/\/\S+\.\S+/i.test(v)) return {ctrl: c, msg: FORM_MSG.url};
      if(c.dataset.contact !== undefined && !formsLooksEmail(v) && !formsLooksPhone(v)) return {ctrl: c, msg: FORM_MSG.contact};
      if(c.maxLength > 0 && v.length > c.maxLength) return {ctrl: c, msg: "Keep it under " + c.maxLength + " characters"};
    }
    return null;
  }
  function formsSubmitButton(form){ return $("button[type=submit]", form) || $("button:not([type])", form); }
  function formsSetBusy(form, on, label){
    var btn = formsSubmitButton(form);
    form.setAttribute("aria-busy", on ? "true" : "false");
    if(btn){
      if(on){ btn.dataset.label = btn.dataset.label || btn.textContent; btn.disabled = true; btn.textContent = label || "Sending…"; }
      else { btn.disabled = false; if(btn.dataset.label) btn.textContent = btn.dataset.label; }
    }
    formsControls(form).forEach(function(c){ c.readOnly = !!on; });
  }
  function formsShowFail(form, msg, mailto){
    var f = $(".form-fail", form);
    if(!f){ f = document.createElement("div"); f.className = "form-fail"; f.setAttribute("role", "alert"); var btn = formsSubmitButton(form); (btn ? btn.parentNode : form).insertBefore(f, btn || null); }
    f.innerHTML = '<p>' + esc(msg) + '</p>' +
      '<div class="form-fail-actions"><button type="button" class="btn btn-ghost btn-sm form-retry">Try again</button>' +
      (mailto ? '<a class="form-alt" href="' + esc(mailto.href) + '">' + esc(mailto.label) + '</a>' : "") + '</div>';
    $(".form-retry", f).addEventListener("click", function(){ f.remove(); var first = formsControls(form)[0]; if(first) first.focus(); });
    $(".form-retry", f).focus();
  }
  function formsShowDone(form, html, mailto, local){
    var done = document.createElement("div");
    done.className = "form-done" + (local ? " local" : "");
    done.setAttribute("role", "status");
    done.setAttribute("tabindex", "-1");
    done.innerHTML = '<span class="form-done-ic" aria-hidden="true">' +
        (local ? '&#9679;' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>') + '</span>' +
      '<div class="form-done-body">' + html +
      (mailto ? '<p class="form-done-alt"><a class="form-alt" href="' + esc(mailto.href) + '">' + esc(mailto.label) + '</a></p>' : "") +
      '<p class="form-done-again"><button type="button" class="linklike form-again">Send another</button></p></div>';
    form.classList.add("is-done");
    form.appendChild(done);
    $(".form-again", done).addEventListener("click", function(){
      done.remove(); form.classList.remove("is-done"); form.reset(); formsClearErrors(form);
      var first = formsControls(form)[0]; if(first) first.focus();
    });
    try { done.focus({preventScroll: true}); } catch(e){}
    if(TL.confetti && !reduceMotion && !local){
      var r = done.getBoundingClientRect();
      TL.confetti(r.left + r.width / 2, r.top + 24, {count: 40, spread: 60});
    }
  }
  function formsBind(form, opts){
    if(!form || form.dataset.formsBound) return;
    form.dataset.formsBound = "1";
    opts = opts || {};
    var kind = opts.kind || form.dataset.kind || "contact";
    form.setAttribute("novalidate", "");
    form.addEventListener("input", function(e){ if(e.target && e.target.getAttribute && e.target.getAttribute("aria-invalid")) formsClearFieldError(e.target); });
    form.addEventListener("submit", function(e){
      e.preventDefault();
      if(form.getAttribute("aria-busy") === "true") return;
      formsClearErrors(form);
      var hp = $('[name="website"]', form);
      var fields;
      try { fields = opts.collect ? opts.collect(form) : formsCollect(form); } catch(err){ fields = formsCollect(form); }
      if(hp && hp.value){ /* bot: quietly show success, send nothing */
        formsShowDone(form, opts.success ? opts.success(fields, {id: "hp"}, {local: false}) : "<b>Thanks!</b>", null, false);
        return;
      }
      var bad = formsValidate(form);
      if(!bad && opts.validate){
        var v = opts.validate(fields, form);
        if(v){ var c = v.ctrl || $('[name="' + v.field + '"]', form); bad = {ctrl: c, msg: v.msg}; }
      }
      if(bad){
        if(bad.ctrl){ formsSetFieldError(bad.ctrl, bad.msg); bad.ctrl.focus(); }
        else toast(bad.msg);
        return;
      }
      var mailto = null;
      try { mailto = opts.mailto ? opts.mailto(fields) : null; } catch(err){ mailto = null; }
      formsSetBusy(form, true, opts.sendingLabel);
      formsSubmit(kind, fields).then(function(res){
        formsSetBusy(form, false);
        var html = opts.success ? opts.success(fields, res, {local: res.local}) : "<b>Thanks &mdash; we got it.</b>";
        if(res.local) html += '<p class="form-done-note">Saved on this device (demo mode) &mdash; the live site sends this straight to the counter.</p>';
        formsShowDone(form, html, res.local ? mailto : null, res.local);
        try { if(opts.onSuccess) opts.onSuccess(fields, res, {local: res.local}); } catch(err){}
        TL.emit("form:sent", {kind: kind, fields: fields, res: res});
      }, function(err){
        formsSetBusy(form, false);
        var why = err && err.status === 429 ? "Too many sends from this connection — give it a few minutes." :
                  err && err.status === 400 ? "The shop's server didn't like something in the form: " + ((err.data && err.data.error) || err.error || "check the fields") + "." :
                  err && err.status === 0 ? "Couldn't reach the shop's server — check your connection." :
                  "The shop's server hiccuped (" + ((err && err.error) || "error") + ").";
        formsShowFail(form, why + " Your answers are still here.", mailto);
      });
    });
  }
  function formsMailto(subject, lines){
    return "mailto:" + (TL.config.email || "toploadedtcg@gmail.com") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(lines.join("\n"));
  }
  TL.forms = {bind: formsBind, submit: formsSubmit, local: formsLocal, mailto: formsMailto, looksEmail: formsLooksEmail, looksPhone: formsLooksPhone, setFieldError: formsSetFieldError, clearFieldError: formsClearFieldError};
