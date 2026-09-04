  /* ---------- forms ---------- */
  $("#vendorForm").addEventListener("submit", function(e){
    e.preventDefault();
    toast("Table request received (demo) \u2014 we'd email you within a day");
    e.target.reset();
  });
  $("#pkSignup").addEventListener("submit", function(e){
    e.preventDefault();
    var name = $("#pkName").value.trim();
    if(!name){ toast("Add your name first"); return; }
    var seats = $("#pkCount").value;
    var subject = "Pokemon League signup — Sunday 11 AM";
    var body = "Name: " + name + "\nSeats: " + seats + "\n\nSee you Sunday at 11!";
    window.location.href = "mailto:toploadedtcg@gmail.com?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    toast("Opening your email app — hit send and you're in");
  });
  $("#buyForm").addEventListener("submit", function(e){
    e.preventDefault();
    toast("Quote request sent (demo) \u2014 we'd reply with a number soon");
    e.target.reset();
  });
