  /* ---------- play nights: data-driven schedule + admin editor ---------- */
  var EVENTS = [
    {day:"Mon", name:"Shop closed", small:"Back Tuesday at open", time:"—", fee:"—"},
    {day:"Wed", name:"One Piece Locals", small:"Bandai official · winner & participation packs", time:"5:00 PM", fee:"TBD"},
    {day:"Sat", name:"One Piece Locals", small:"Bandai official · winner & participation packs", time:"11:00 AM", fee:"TBD"},
    {day:"Sat", name:"Gundam Card Game", small:"Bandai official · winner & participation packs", time:"1:00 PM", fee:"TBD"},
    {day:"Sun", name:"Pokemon League", small:"All ages · league promo prizing", time:"11:00 AM", fee:"TBD"}
  ];
  function renderSched(){
    $("#schedList").innerHTML = EVENTS.map(function(ev){
      return '<div class="sched-row"><span class="sched-day">' + esc(ev.day) + '</span>' +
        '<span class="sched-name">' + esc(ev.name) + '<small>' + esc(ev.small) + '</small></span>' +
        '<span class="sched-time">' + esc(ev.time) + '</span><span class="sched-fee">' + esc(ev.fee) + '</span></div>';
    }).join("");
  }
  function renderEvEditor(){
    $("#evEditor").innerHTML = EVENTS.map(function(ev, i){
      return '<div class="ev-edit-row">' +
        '<input data-ev="day" data-i="' + i + '" value="' + esc(ev.day) + '" style="width:52px" aria-label="Day">' +
        '<input data-ev="name" data-i="' + i + '" value="' + esc(ev.name) + '" style="flex:1; min-width:110px" aria-label="Event name">' +
        '<input data-ev="time" data-i="' + i + '" value="' + esc(ev.time) + '" style="width:82px" aria-label="Start time">' +
        '<input data-ev="fee" data-i="' + i + '" value="' + esc(ev.fee) + '" style="width:56px" aria-label="Entry fee">' +
      '</div>';
    }).join("");
  }
  $("#evApply").addEventListener("click", function(){
    $$("#evEditor [data-ev]").forEach(function(inp){
      EVENTS[parseInt(inp.dataset.i, 10)][inp.dataset.ev] = inp.value;
    });
    renderSched();
    toast("Schedule published — Play Nights page updated");
  });
  $("#evAdd").addEventListener("click", function(){
    EVENTS.push({day:"Fri", name:"New event", small:"Set details, then publish", time:"6:00 PM", fee:"TBD"});
    renderEvEditor();
  });
