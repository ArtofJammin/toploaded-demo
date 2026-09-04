  /* ---------- staff desk: store credit + pricing ---------- */
  var CUSTOMERS = [
    {n:"Alex R.",    p:"(859) 555-0142", c:86.50},
    {n:"Dana K.",    p:"(513) 555-0177", c:212.00},
    {n:"Marcus T.",  p:"(859) 555-0103", c:14.25},
    {n:"Priya S.",   p:"(513) 555-0164", c:0.00}
  ];
  function renderCred(){
    var q = ($("#credSearch").value || "").toLowerCase();
    var rows = CUSTOMERS.filter(function(cu){
      return !q || cu.n.toLowerCase().indexOf(q) > -1 || cu.p.indexOf(q) > -1;
    });
    $("#credBody").innerHTML = rows.length ? rows.map(function(cu){
      return "<tr><td>" + esc(cu.n) + '</td><td class="num">' + esc(cu.p) + '</td><td class="num">' + money(cu.c) + "</td></tr>";
    }).join("") : '<tr><td colspan="3" style="color:var(--ink3)">No matches — new customers get an account at checkout.</td></tr>';
    $("#credWho").innerHTML = CUSTOMERS.map(function(cu, i){
      return '<option value="' + i + '">' + esc(cu.n) + "</option>";
    }).join("");
  }
  $("#credSearch").addEventListener("input", renderCred);
  $("#credAdd").addEventListener("click", function(){
    var amt = parseFloat($("#credAmt").value);
    if(!(amt > 0)){ toast("Enter the cash value of the trade first"); return; }
    var cu = CUSTOMERS[parseInt($("#credWho").value, 10)];
    var credited = amt * 1.10;
    cu.c += credited;
    $("#credAmt").value = "";
    renderCred();
    toast(money(amt) + " trade → " + money(credited) + " credit for " + cu.n + " (+10% bonus)");
  });
  function recalcPricing(){
    var m = parseFloat($("#pdMarket").value);
    var r = parseFloat($("#pdRate").value);
    if(!(m > 0)){ $("#pdCash").textContent = "—"; $("#pdCredit").textContent = "—"; return; }
    var cash = m * r;
    $("#pdCash").textContent = money(cash);
    $("#pdCredit").textContent = money(cash * 1.10);
  }
  $("#pdMarket").addEventListener("input", recalcPricing);
  $("#pdRate").addEventListener("change", recalcPricing);
  TL.on("init", renderCred);
