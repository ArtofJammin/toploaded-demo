  /* Marketfloor-inspired local guide. No external event's bookings are copied. */
  TL.floorplan = (function(){
    var labels = {tcg:"TCG",sports:"Sports",mixed:"Mixed",food:"Food",entry:"Entry"};
    function stats(booths){
      var counts = {tcg:0,sports:0,mixed:0};
      (booths || []).forEach(function(b){ if(b && Object.prototype.hasOwnProperty.call(counts,b.type)) counts[b.type]++; });
      var total = counts.tcg + counts.sports + counts.mixed, pct = {}, rest = 100;
      var keys = Object.keys(counts).filter(function(k){ return counts[k]; });
      keys.forEach(function(k,i){ pct[k] = i === keys.length-1 ? rest : Math.round(counts[k]/total*100); rest -= pct[k]; });
      return {counts:counts,total:total,pct:pct};
    }
    function fits(b,size){return b.r>=1 && b.c>=1 && b.w>=1 && b.h>=1 && b.r+b.h-1<=size.rows && b.c+b.w-1<=size.cols;}
    function overlaps(a,b){return a.c<b.c+b.w && b.c<a.c+a.w && a.r<b.r+b.h && b.r<a.r+a.h;}
    function canPlace(booths,b,size,skip){return fits(b,size) && !booths.some(function(other,i){return i!==skip && overlaps(b,other);});}
    function viewport(root,map,scroll){
      var zoom=1,drag=null,fitMode=true;
      function setZoom(z){
        var old=zoom; zoom=Math.max(.18,Math.min(2.5,z));
        var x=(scroll.scrollLeft+scroll.clientWidth/2)/old,y=(scroll.scrollTop+scroll.clientHeight/2)/old;
        map.style.setProperty('--fp-cell',(64*zoom)+'px');map.style.setProperty('--fp-gap',(6*zoom)+'px');
        map.classList.toggle('is-dense',zoom<.6);
        scroll.scrollLeft=x*zoom-scroll.clientWidth/2;scroll.scrollTop=y*zoom-scroll.clientHeight/2;
      }
      function fit(){
        if(!scroll.clientWidth) return;
        var cols=Number(map.dataset.cols)||10,rows=Number(map.dataset.rows)||6;
        setZoom(Math.min(1,(scroll.clientWidth-32)/(cols*70),(scroll.clientHeight-32)/(rows*70)));
        scroll.scrollLeft=scroll.scrollTop=0;fitMode=true;
      }
      function focus(el){
        if(!el) return;
        /* Center within this map, without scrolling the entire page. */
        var a=el.getBoundingClientRect(),b=scroll.getBoundingClientRect();
        scroll.scrollLeft+=a.left-b.left-(scroll.clientWidth-a.width)/2;
        scroll.scrollTop+=a.top-b.top-(scroll.clientHeight-a.height)/2;
      }
      root.addEventListener('click',function(e){
        var b=e.target.closest('[data-floor-zoom]');if(!b) return;
        var k=b.dataset.floorZoom;if(k==='fit') fit();else{fitMode=false;setZoom(zoom*(k==='in'?1.3:1/1.3));}
      });
      scroll.addEventListener('wheel',function(e){if(!e.ctrlKey)return;e.preventDefault();fitMode=false;setZoom(zoom*(e.deltaY<0?1.12:1/1.12));},{passive:false});
      scroll.addEventListener('pointerdown',function(e){
        if(e.pointerType==='touch'||e.button!==0||e.target.closest('.fp-cell')||map.classList.contains('is-placing'))return;
        drag={x:e.clientX,y:e.clientY,left:scroll.scrollLeft,top:scroll.scrollTop,id:e.pointerId};scroll.setPointerCapture(e.pointerId);scroll.classList.add('is-panning');
      });
      scroll.addEventListener('pointermove',function(e){if(!drag||e.pointerId!==drag.id)return;scroll.scrollLeft=drag.left+drag.x-e.clientX;scroll.scrollTop=drag.top+drag.y-e.clientY;});
      function stop(){drag=null;scroll.classList.remove('is-panning');}
      scroll.addEventListener('pointerup',stop);scroll.addEventListener('pointercancel',stop);scroll.addEventListener('lostpointercapture',stop);
      map.addEventListener('focusin',function(e){var b=e.target.closest('.fp-cell');if(b)focus(b);});
      if(typeof ResizeObserver!=='undefined')new ResizeObserver(function(){if(fitMode)fit();}).observe(scroll);
      return {fit:fit,focus:focus,refresh:function(){if(fitMode)fit();}};
    }
    var publicBooths=[],selected=-1,publicView=null;
    function match(b){var q=($('#floorSearch').value||'').trim().toLowerCase(),type=$('#floorType').value;return (!type||b.type===type)&&(!q||(b.label+' '+b.id+' '+labels[b.type]).toLowerCase().includes(q));}
    function details(i){
      var b=publicBooths[i];selected=b?i:-1;
      $('#showFloorDetail').innerHTML=b?'<p class="eyebrow">'+esc(labels[b.type])+' vendor area</p><h3>'+esc(b.label)+'</h3><dl><dt>Booth reference</dt><dd>'+esc(b.id)+'</dd><dt>Find it</dt><dd>Row '+b.r+' · Column '+b.c+'</dd><dt>Footprint</dt><dd>'+b.w+' × '+b.h+' grid squares</dd></dl><p class="card-note">Location shown on the published show layout. A listing is not a live availability or booking guarantee.</p>':'<h3>Explore the floor</h3><p>Choose a vendor on the map or in the directory.</p>';
      $$('#showFloorGuide [data-floor-booth]').forEach(function(el){el.setAttribute('aria-pressed',String(Number(el.dataset.floorBooth)===selected));});
    }
    function filter(){
      var count=0;
      publicBooths.forEach(function(b,i){var yes=match(b);if(yes)count++;var cell=$('#showFloorMap [data-floor-booth="'+i+'"]');cell.classList.toggle('is-muted',!yes);cell.disabled=!yes;cell.setAttribute('aria-hidden',String(!yes));});
      $('#showFloorList').innerHTML=publicBooths.map(function(b,i){return match(b)?'<li><button type="button" data-floor-booth="'+i+'" aria-pressed="'+(i===selected)+'"><span class="floor-swatch t-'+b.type+'" aria-hidden="true"></span><span><b>'+esc(b.label)+'</b><small>'+labels[b.type]+' · Row '+b.r+', column '+b.c+'</small></span><span aria-hidden="true">↗</span></button></li>':'';}).join('');
      $('#floorResults').textContent=count+' of '+publicBooths.length+' locations shown'+(!count?' — try another name or category.':'. Vendor percentages above always describe the whole floor.');
      if(selected>=0&&!match(publicBooths[selected]))details(-1);
    }
    function render(){
      var f = (TL.config.show || {}).floorplan || {}, rows = Number(f.rows)||6, cols = Number(f.cols)||10;
      var booths = (Array.isArray(f.booths) ? f.booths : []).filter(function(b){return b && labels[b.type] && b.r>=1 && b.c>=1 && b.w>=1 && b.h>=1 && b.r+b.h-1<=rows && b.c+b.w-1<=cols;});
      var map=$("#showFloorMap"), note=$("#showFloorNote"), mix=$("#showFloorMix"), legend=$("#showFloorLegend"), list=$("#showFloorList"), scroll=$("#showFloorScroll");
      if(!map) return;
      var guide=$('#showFloorGuide');guide.hidden=!booths.length;
      scroll.hidden = !booths.length; mix.hidden = !booths.length;
      if(!booths.length){ note.textContent="The vendor layout is not published yet. Check back for the confirmed TCG and Sports booth locations and percentages."; map.innerHTML=legend.innerHTML=list.innerHTML=mix.innerHTML="";publicBooths=[];selected=-1;return; }
      var s=stats(booths);
      note.textContent=s.total+" vendor booths · percentages are by booth, not floor area. Mixed vendors are counted separately; food and entry areas are excluded.";
      map.style.gridTemplateColumns="repeat("+cols+", var(--fp-cell))"; map.style.gridTemplateRows="repeat("+rows+", var(--fp-cell))";
      map.dataset.rows=rows;map.dataset.cols=cols;
      map.innerHTML=booths.map(function(b,i){return '<button type="button" class="fp-cell t-'+b.type+'" data-floor-booth="'+i+'" aria-pressed="false" aria-label="'+esc(b.label+' · '+labels[b.type]+', row '+b.r+', column '+b.c)+'" title="'+esc(b.label+' · '+labels[b.type])+'" style="grid-row:'+b.r+' / span '+b.h+';grid-column:'+b.c+' / span '+b.w+'"><b>'+esc(b.label)+'</b><i>'+labels[b.type]+'</i></button>';}).join("");
      mix.innerHTML=Object.keys(s.pct).map(function(k){return '<span class="t-'+k+'" style="width:'+s.pct[k]+'%"></span>';}).join("");
      legend.innerHTML=Object.keys(labels).filter(function(k){return booths.some(function(b){return b.type===k;});}).map(function(k){return '<li><i class="t-'+k+'" aria-hidden="true"></i>'+labels[k]+(s.pct[k]!==undefined?' '+s.pct[k]+'% ('+s.counts[k]+')':'')+'</li>';}).join("");
      publicBooths=booths;details(-1);filter();
      if(!publicView){
        publicView=viewport(guide,map,scroll);
        $('#floorSearch').addEventListener('input',filter);$('#floorType').addEventListener('change',filter);
        guide.addEventListener('click',function(e){var b=e.target.closest('[data-floor-booth]');if(!b)return;var i=Number(b.dataset.floorBooth);details(i);publicView.focus($('#showFloorMap [data-floor-booth="'+i+'"]'));});
      }
      publicView.refresh();
    }
    TL.on("init",render); TL.on("config:change",render);
    return {stats:stats,render:render,viewport:viewport,fits:fits,overlaps:overlaps,canPlace:canPlace};
  })();
