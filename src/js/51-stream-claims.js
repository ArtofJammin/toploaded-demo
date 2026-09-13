  (function(){
    var rows=[],timer=null,busy=false,lastSig="",active=false,checkoutReady=false,catalogResults=[];
    function checkoutStatus(){if(!TL.api.online)return;TL.api.get('/live/checkout/status',{noAuth:true}).then(function(d){checkoutReady=!!d.ready;$('#claimCheckoutState').textContent=d.reason+(d.mode==='sandbox'?' Sandbox only — no real payments.':'');render();}).catch(function(){checkoutReady=false;$('#claimCheckoutState').textContent='Payment connection could not be checked.';});}
    function controls(c){if(!staff())return '';var states=c.paymentManaged?(c.status==='paid'?['paid','shipped']:[c.status]):['claimed','paid','shipped','cancelled'];return '<br><select data-claim-status="'+esc(c.id)+'" aria-label="Status of '+esc(c.card)+'">'+states.map(function(s){return '<option'+(s===c.status?' selected':'')+'>'+s+'</option>';}).join('')+'</select>'+(c.payable&&c.status==='claimed'?'<br><button type="button" class="btn btn-ghost" data-claim-pay="'+esc(c.id)+'"'+(!checkoutReady?' disabled':'')+'>Get payment link</button>':'')+(c.paymentManaged&&c.status==='claimed'?'<button type="button" class="btn btn-ghost" data-claim-cancel="'+esc(c.id)+'">Cancel unpaid checkout</button>':'');}
    function staff(){return TL.api.online && (TL.api.role==="staff"||TL.api.role==="admin");}
    function render(){
      var list=$("#claimFeed"),empty=$("#claimFeedEmpty"),note=$("#claimFeedNote");
      $("#claimDesk").hidden=!staff();
      if(!staff()){$('#claimPaymentResult').hidden=true;$('#claimPaymentUrl').value='';$('#claimPaymentLink').removeAttribute('href');}
      var sig=JSON.stringify(rows)+staff()+checkoutReady;if(sig!==lastSig){
        lastSig=sig;list.innerHTML=rows.map(function(c){return '<li class="claim-entry"><div><b>'+esc(c.card)+'</b><br><small>'+esc(c.handle)+' · '+esc(new Date(c.at).toLocaleString())+'</small></div><div>'+money(c.price)+' · '+esc(c.status)+controls(c)+'</div></li>';}).join("");
      }
      empty.hidden=!!rows.length;$("#claimCount").textContent=rows.length?rows.length+" posted":"";
      empty.textContent=TL.api.online?"No confirmed card claims posted yet.":"The shared claims board is not connected yet. Follow the stream host for claim confirmations.";
      note.hidden=false;note.textContent=TL.api.online?"Refreshes every 5 seconds. Linked checkout payments are confirmed by Square; fulfillment and non-checkout claims are maintained by staff.":"No sample or device-only claims are displayed as real purchases.";
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
    TL.on("api:ready",function(){checkoutStatus();start();});TL.on("auth:change",function(){checkoutStatus();render();});TL.on("init",render);
    document.addEventListener("visibilitychange",start);
    $("#streamClaimForm").addEventListener("submit",function(e){
      e.preventDefault();if(!staff())return;var form=this,btn=form.querySelector("button"),st=$("#claimDeskStatus");btn.disabled=true;
      TL.api.post("/live/claims",{card:$("#claimCard").value.trim(),handle:$("#claimHandle").value.trim(),price:Number($("#claimPrice").value),squareVariationId:$('#claimSquareId').value.trim(),tcgProductId:$('#claimTcgId').value.trim(),fulfillment:$('#claimFulfillment').value})
        .then(function(){form.reset();st.textContent="Confirmed claim posted.";refresh();})
        .catch(function(e){st.textContent=e.error||"Could not post the claim. Retry when connected.";}).finally(function(){btn.disabled=false;});
    });
    $("#claimFeed").addEventListener("change",function(e){var sel=e.target.closest("[data-claim-status]");if(!sel||!staff())return;sel.disabled=true;TL.api.put("/live/claims/"+encodeURIComponent(sel.dataset.claimStatus),{status:sel.value}).then(refresh).catch(function(){toast("Claim status was not saved");lastSig="";render();}).finally(function(){sel.disabled=false;});});
    $('#claimFeed').addEventListener('click',function(e){var btn=e.target.closest('[data-claim-pay],[data-claim-cancel]');if(!btn||!staff())return;var cancel=btn.hasAttribute('data-claim-cancel'),id=cancel?btn.dataset.claimCancel:btn.dataset.claimPay;if(cancel&&!confirm('Cancel this unpaid Square checkout? The payment link will stop accepting payment.'))return;btn.disabled=true;
      TL.api.post('/live/claims/'+encodeURIComponent(id)+(cancel?'/cancel-checkout':'/checkout'),{}).then(function(d){if(cancel){$('#claimPaymentResult').hidden=true;toast('Unpaid checkout cancelled');}else{var u=new URL(d.url);if(u.protocol!=='https:'||!/(^|\.)square\.(link|site)$/.test(u.hostname))throw new Error('Unexpected checkout link');$('#claimPaymentLink').href=u.href;$('#claimPaymentUrl').value=u.href;$('#claimPaymentResult').hidden=false;$('#claimPaymentUrl').focus();$('#claimDeskStatus').textContent=d.mode==='sandbox'?'Sandbox link — no real money.':'Share privately with the confirmed buyer. Square will confirm payment.';}refresh();}).catch(function(err){toast(err.error||err.message||'Checkout could not be prepared');}).finally(function(){btn.disabled=false;});
    });
    $('#claimPaymentCopy').addEventListener('click',function(){var input=$('#claimPaymentUrl');if(navigator.clipboard)navigator.clipboard.writeText(input.value).then(function(){toast('Payment link copied');}).catch(function(){input.focus();input.select();});else{input.focus();input.select();}});
    $('#claimCatalogFind').addEventListener('click',function(){if(!staff())return;var btn=this,el=$('#claimCatalogResults'),q=$('#claimCatalogQuery').value.trim();if(q.length<2){el.textContent='Enter at least two characters.';return;}btn.disabled=true;el.textContent='Searching Square…';TL.api.get('/live/catalog?q='+encodeURIComponent(q)).then(function(d){catalogResults=d.items||[];el.innerHTML=catalogResults.length?catalogResults.map(function(c,i){return '<button class="btn btn-ghost" type="button" data-claim-item="'+i+'">'+esc(c.name)+(c.sku?' · '+esc(c.sku):'')+(c.price>0?' · '+money(c.price):'')+'</button>';}).join('')+(d.more?'<p>Narrow the search for more specific results.</p>':''):'No tracked variations matched. Try the exact SKU.';}).catch(function(e){el.textContent=e.error||'Square catalog unavailable.';}).finally(function(){btn.disabled=false;});});
    $('#claimCatalogResults').addEventListener('click',function(e){var b=e.target.closest('[data-claim-item]'),c=b&&catalogResults[Number(b.dataset.claimItem)];if(!c)return;$('#claimSquareId').value=c.variationId;$('#claimTcgId').value=c.tcgProductId||'';$('#claimCard').value=c.name;if(c.price>0)$('#claimPrice').value=c.price.toFixed(2);$('#claimDeskStatus').textContent='Selected '+c.name+'. Check condition/printing and the agreed price before posting.';$('#claimHandle').focus();});
  })();
