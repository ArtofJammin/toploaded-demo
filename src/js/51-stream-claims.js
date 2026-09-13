  (function(){
    var rows=[],timer=null,busy=false,lastSig="",active=false;
    function staff(){return TL.api.online && (TL.api.role==="staff"||TL.api.role==="admin");}
    function render(){
      var list=$("#claimFeed"),empty=$("#claimFeedEmpty"),note=$("#claimFeedNote");
      $("#claimDesk").hidden=!staff();
      var sig=JSON.stringify(rows)+staff();if(sig!==lastSig){
        lastSig=sig;list.innerHTML=rows.map(function(c){return '<li class="claim-entry"><div><b>'+esc(c.card)+'</b><br><small>'+esc(c.handle)+' · '+esc(new Date(c.at).toLocaleString())+'</small></div><div>'+money(c.price)+' · '+esc(c.status)+(staff()?'<br><select data-claim-status="'+esc(c.id)+'" aria-label="Status of '+esc(c.card)+'">'+["claimed","paid","shipped","cancelled"].map(function(s){return '<option'+(s===c.status?' selected':'')+'>'+s+'</option>';}).join("")+'</select>':'')+'</div></li>';}).join("");
      }
      empty.hidden=!!rows.length;$("#claimCount").textContent=rows.length?rows.length+" posted":"";
      empty.textContent=TL.api.online?"No confirmed card claims posted yet.":"The shared claims board is not connected yet. Follow the stream host for claim confirmations.";
      note.hidden=false;note.textContent=TL.api.online?"Refreshes every 5 seconds while this page is open. Posted statuses are maintained by staff.":"No sample or device-only claims are displayed as real purchases.";
    }
    function refresh(){
      render();if(!active || document.hidden || busy || !TL.api.online)return;
      busy=true;TL.api.get("/live/claims",{noAuth:true}).then(function(d){
        var before=rows.length;rows=Array.isArray(d.claims)?d.claims:[];render();
        if(rows.length>before)$("#claimFeedStatus").textContent=(rows.length-before)+" new confirmed claim(s) posted.";
      }).catch(function(){var n=$("#claimFeedNote");n.hidden=false;n.textContent="Claims could not refresh. Any displayed claims are from the last successful update; confirm with the host.";}).finally(function(){busy=false;});
    }
    function start(){clearInterval(timer);refresh();if(active&&!document.hidden)timer=setInterval(refresh,5000);}
    TL.on("view:change",function(d){if(!d||d.name!=="live")return;active=true;start();});
    TL.on("view:leave",function(d){if(d&&d.name==="live"){active=false;clearInterval(timer);}});
    TL.on("api:ready",start);TL.on("auth:change",render);TL.on("init",render);
    document.addEventListener("visibilitychange",start);
    $("#streamClaimForm").addEventListener("submit",function(e){
      e.preventDefault();if(!staff())return;var form=this,btn=form.querySelector("button"),st=$("#claimDeskStatus");btn.disabled=true;
      TL.api.post("/live/claims",{card:$("#claimCard").value.trim(),handle:$("#claimHandle").value.trim(),price:Number($("#claimPrice").value)})
        .then(function(){form.reset();st.textContent="Confirmed claim posted.";refresh();})
        .catch(function(e){st.textContent=e.error||"Could not post the claim. Retry when connected.";}).finally(function(){btn.disabled=false;});
    });
    $("#claimFeed").addEventListener("change",function(e){var sel=e.target.closest("[data-claim-status]");if(!sel||!staff())return;sel.disabled=true;TL.api.put("/live/claims/"+encodeURIComponent(sel.dataset.claimStatus),{status:sel.value}).then(refresh).catch(function(){toast("Claim status was not saved");lastSig="";render();}).finally(function(){sel.disabled=false;});});
  })();
