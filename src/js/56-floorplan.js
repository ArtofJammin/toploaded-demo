  /* Published booth heatmap. Empty plans never masquerade as real bookings. */
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
    function render(){
      var f = (TL.config.show || {}).floorplan || {}, rows = Number(f.rows)||6, cols = Number(f.cols)||10;
      var booths = (Array.isArray(f.booths) ? f.booths : []).filter(function(b){return b && labels[b.type] && b.r>=1 && b.c>=1 && b.w>=1 && b.h>=1 && b.r+b.h-1<=rows && b.c+b.w-1<=cols;});
      var map=$("#showFloorMap"), note=$("#showFloorNote"), mix=$("#showFloorMix"), legend=$("#showFloorLegend"), list=$("#showFloorList"), scroll=$("#showFloorScroll");
      if(!map) return;
      scroll.hidden = !booths.length; mix.hidden = !booths.length;
      if(!booths.length){ note.textContent="The vendor layout is not published yet. Check back for the confirmed TCG and Sports booth locations and percentages."; map.innerHTML=legend.innerHTML=list.innerHTML=mix.innerHTML=""; return; }
      var s=stats(booths);
      note.textContent=s.total+" vendor booths · percentages are by booth, not floor area. Mixed vendors are counted separately; food and entry areas are excluded.";
      map.style.gridTemplateColumns="repeat("+cols+", var(--fp-cell))"; map.style.gridTemplateRows="repeat("+rows+", var(--fp-cell))";
      map.innerHTML=booths.map(function(b){return '<span class="fp-cell t-'+b.type+'" style="grid-row:'+b.r+' / span '+b.h+';grid-column:'+b.c+' / span '+b.w+'"><b>'+esc(b.label)+'</b><i>'+labels[b.type]+'</i></span>';}).join("");
      mix.innerHTML=Object.keys(s.pct).map(function(k){return '<span class="t-'+k+'" style="width:'+s.pct[k]+'%"></span>';}).join("");
      legend.innerHTML=Object.keys(labels).filter(function(k){return booths.some(function(b){return b.type===k;});}).map(function(k){return '<li><i class="t-'+k+'" aria-hidden="true"></i>'+labels[k]+(s.pct[k]!==undefined?' '+s.pct[k]+'% ('+s.counts[k]+')':'')+'</li>';}).join("");
      list.innerHTML=booths.map(function(b){return '<li>'+esc(b.label)+' · '+labels[b.type]+' · row '+b.r+', column '+b.c+'</li>';}).join("");
    }
    TL.on("init",render); TL.on("config:change",render);
    return {stats:stats,render:render};
  })();
