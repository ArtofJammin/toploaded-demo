  /* ---------- live breaks ---------- */
  var SPOT_PRICE = 24.99;
  var takenSpots = {2:true, 5:true, 9:true};
  function renderSpots(){
    var html = "";
    for(var i = 1; i <= 12; i++){
      html += '<button class="spot" data-spot="' + i + '"' + (takenSpots[i] ? " disabled" : "") + ">" +
        (takenSpots[i] ? "Taken" : "#" + i) + "</button>";
    }
    $("#spotGrid").innerHTML = html;
  }
  document.addEventListener("click", function(e){
    var s = e.target.closest("[data-spot]");
    if(!s || s.disabled) return;
    var n = s.dataset.spot;
    takenSpots[n] = true;
    var id = "live-spot-" + n;
    ITEMS.push({id:id, name:"Break spot #" + n + " · Prismatic box", set:"Rip & ship · ships next day", game:"pk", type:"sealed", cond:null, price:SPOT_PRICE, stock:1, live:true});
    cart[id] = 1;
    renderSpots(); renderCart();
    pushChat(null, "you claimed spot #" + n, true);
    toast("Spot #" + n + " claimed — added to cart (demo)");
  });

  var CHAT_FEED = [
    ["mike_pulls", "LETS GO that alt art was insane"],
    ["nky_collector", "how many spots left?"],
    ["sarah_tcg", "shipping was crazy fast last week btw"],
    ["breakz_bill", "my spot is up next, no whammies"],
    ["gundam_greg", "any gundam breaks coming?"],
    ["toploaded_shop", "Gundam locals Saturday 1 PM — breaks soon after"],
    ["jess_rips", "chase card is still in there I can feel it"],
    ["cincy_cards", "W shop"],
    ["packrat_pete", "see everyone at the Turfway show, first weekend of the month"]
  ];
  var chatIdx = 0;
  function pushChat(user, msg, sys){
    var body = $("#chatBody");
    var div = document.createElement("div");
    div.className = "chat-line" + (sys ? " sys" : "");
    if(sys){ div.textContent = msg; }
    else { div.innerHTML = "<b>" + esc(user) + "</b>" + esc(msg); }
    body.appendChild(div);
    while(body.children.length > 40) body.removeChild(body.firstChild);
    body.scrollTop = body.scrollHeight;
  }
  function initLive(){
    renderSpots();
    pushChat(null, "Welcome to the break — chat is simulated for this demo", true);
    CHAT_FEED.slice(0, 4).forEach(function(c){ pushChat(c[0], c[1]); });
    chatIdx = 4;
    setInterval(function(){
      var c = CHAT_FEED[chatIdx++ % CHAT_FEED.length];
      pushChat(c[0], c[1]);
    }, 4200);
    var v = 214;
    setInterval(function(){
      v = Math.max(180, v + Math.round(Math.random() * 14 - 7));
      var vc = $("#viewerCount");
      vc.textContent = v + " watching";
      if(!reduceMotion){ vc.classList.remove("tick"); void vc.offsetWidth; vc.classList.add("tick"); }
    }, 5000);
    $("#chatForm").addEventListener("submit", function(e){
      e.preventDefault();
      var inp = $("#chatInput");
      if(!inp.value.trim()) return;
      pushChat("you", inp.value.trim());
      inp.value = "";
    });
  }
