  /* ---------- ticker ---------- */
  var buys = [
    ["Charizard ex \u00b7 151", "$85"], ["Umbreon VMAX Alt", "$450"], ["Shanks OP-09 Leader", "$42"],
    ["The One Ring", "$40"], ["Prismatic ETBs", "$70"], ["Luffy OP-05 Alt", "$88"],
    ["Ragavan MH2", "$41"], ["Base Set holos", "ask"], ["Sealed booster boxes", "top rates"]
  ];
  var half = buys.map(function(b){ return "<span>Buying now \u00b7 <b>" + b[0] + "</b> up to <b>" + b[1] + "</b></span>"; }).join("");
  $("#tickerTrack").innerHTML = half + half;
