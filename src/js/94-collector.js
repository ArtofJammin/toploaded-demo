  /* Collector preview. User-driven motion; summary-first showcase and lazy discovery. */
  (function(){
    var deck = document.getElementById("holo"), form = document.getElementById("discoveryForm");
    if(!form || !deck) return;
    var cards = [], selected = 0, lastPick = null, pointerFrame = 0, gesture = null;
    function art(item, large){
      if(item.tcg && item.img){
        var src = large ? item.img.replace("200x200", "400x400") : item.img;
        return '<img class="card-img" src="' + TL.esc(src) + '" alt="' + TL.esc(item.name) + '" width="250" height="350" decoding="async" referrerpolicy="no-referrer">';
      }
      return cardArt(item);
    }
    function updateDeck(){
      var nodes = deck.querySelectorAll(".deck-card");
      Array.prototype.forEach.call(nodes, function(node, i){
        var position = i === selected ? "front" : i === (selected + 1) % cards.length ? "right" : "left";
        node.dataset.position = position;
        node.setAttribute("aria-label", (position === "front" ? "View " : "Bring forward: ") + cards[i].name + ", " + TL.money(cards[i].price));
      });
      document.getElementById("deckName").textContent = cards[selected] ? cards[selected].name : "The case is being refreshed.";
      document.getElementById("deckIndex").textContent = TL.pad2(selected + 1) + " / " + TL.pad2(cards.length);
      document.getElementById("deckPrev").disabled = document.getElementById("deckNext").disabled = cards.length < 2;
    }
    function renderDeck(){
      var summary = TL.inventory.summary, next = [], used = {};
      if(!summary && !TL.inventory._summaryFailed && !TL.inventory.failed){
        deck.setAttribute("aria-busy", "true");
        document.getElementById("deckPrev").disabled = document.getElementById("deckNext").disabled = true;
        document.getElementById("deckIndex").textContent = "-- / --";
        return;
      }
      deck.setAttribute("aria-busy", "false");
      if(summary && summary.topByGame){
        ["pk", "op", "mtg"].forEach(function(game){
          var raw = (summary.topByGame[game] || []).find(function(item){ return item && item.listings && item.listings.some(function(l){ return l.qty > 0; }); });
          if(raw){ var item = TL.inventory.toItem(raw); if(!used[item.id]){ used[item.id] = true; next.push(item); } }
        });
        (summary.top || []).forEach(function(raw){
          if(next.length >= 3) return;
          var item = TL.inventory.toItem(raw);
          if(item.stock > 0 && !used[item.id]){ used[item.id] = true; next.push(item); }
        });
      }
      if(!next.length) next = TL.ITEMS.filter(function(item){ return !item.live && item.type === "single" && item.stock > 0; }).slice(0,3);
      cards = next; selected = 0;
      deck.innerHTML = cards.map(function(item,i){
        return '<button type="button" class="deck-card" data-deck="' + i + '" data-id="' + TL.esc(item.id) + '"><span class="deck-face">' + art(item,true) + '</span><span class="deck-tag"><small>' + (item.tcg ? 'IN THE CASE' : 'SAMPLE CARD') + '</small>' + TL.money(item.price) + '</span></button>';
      }).join("");
      document.getElementById("stageCaption").textContent = summary ? "SELECT A CARD / TAKE A CLOSER LOOK" : "SAMPLE SHOWCASE / TAKE A CLOSER LOOK";
      updateDeck();
    }
    function step(direction){ selected = (selected + direction + cards.length) % cards.length; updateDeck(); }
    document.getElementById("deckPrev").addEventListener("click", function(){ if(cards.length) step(-1); });
    document.getElementById("deckNext").addEventListener("click", function(){ if(cards.length) step(1); });
    deck.addEventListener("click", function(e){
      var button = e.target.closest("[data-deck]"); if(!button || deck.dataset.swiping === "true") return;
      var i = Number(button.dataset.deck);
      if(i !== selected){ selected = i; updateDeck(); }
      else TL.openQuickView(TL.inventory.byId(cards[i].id) || cards[i], {list:cards, from:button});
    });
    deck.addEventListener("keydown", function(e){
      deck.dataset.swiping = "false";
      if(!cards.length || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      e.preventDefault(); step(e.key === "ArrowRight" ? 1 : -1);
      deck.querySelector('[data-position="front"]').focus();
    });
    deck.addEventListener("pointerdown", function(e){
      deck.dataset.swiping = "false";
      if(e.pointerType === "touch") gesture = {x:e.clientX,y:e.clientY};
    }, {passive:true});
    deck.addEventListener("pointerup", function(e){
      if(!gesture) return;
      var x = e.clientX - gesture.x, y = e.clientY - gesture.y; gesture = null;
      if(Math.abs(x) > 40 && Math.abs(x) > Math.abs(y) * 1.5 && cards.length){ deck.dataset.swiping = "true"; step(x < 0 ? 1 : -1); }
    }, {passive:true});
    deck.addEventListener("pointercancel", function(){ gesture = null; });
    function resetTilt(){
      if(pointerFrame) cancelAnimationFrame(pointerFrame); pointerFrame = 0;
      ["--deck-rx","--deck-ry","--deck-shine"].forEach(function(key){ deck.style.removeProperty(key); });
    }
    deck.addEventListener("pointermove", function(e){
      if(e.pointerType === "touch" || TL.reduceMotion || document.hidden || pointerFrame) return;
      var x = e.clientX, y = e.clientY;
      pointerFrame = requestAnimationFrame(function(){
        pointerFrame = 0; var rect = deck.getBoundingClientRect(); if(!rect.width || !rect.height) return;
        var px = TL.clamp((x-rect.left)/rect.width,0,1), py = TL.clamp((y-rect.top)/rect.height,0,1);
        deck.style.setProperty("--deck-rx", ((.5-py)*8).toFixed(1)+"deg");
        deck.style.setProperty("--deck-ry", ((px-.5)*10).toFixed(1)+"deg");
        deck.style.setProperty("--deck-shine", (100-px*100).toFixed(1)+"%");
      });
    }, {passive:true});
    deck.addEventListener("pointerleave", resetTilt);
    TL.on("motion:change",resetTilt); TL.on("view:leave",resetTilt);
    document.addEventListener("visibilitychange",function(){ if(document.hidden) resetTilt(); });

    /* Whole-set checklists, with exact product-ID stock matching via TL.cards. */
    var setSel = document.getElementById("discoverySet"), gameSel = document.getElementById("discoveryGame");
    var setsToken = 0;
    function loadSets(){
      if(!setSel || !gameSel) return;
      var game = gameSel.value, token = ++setsToken;
      setSel.disabled = true;
      setSel.innerHTML = '<option value="">Loading sets…</option>';
      TL.cards.sets(game === "all" ? "all" : game).then(function(list){
        if(token !== setsToken) return;
        setSel.innerHTML = '<option value="">Any set (surprise me)</option>' +
          list.map(function(st){ return '<option value="' + TL.esc(st.code) + '">' + TL.esc(st.name) + '</option>'; }).join("");
        setSel.disabled = false;
      }, function(){
        if(token !== setsToken) return;
        setSel.innerHTML = '<option value="">Any set (surprise me)</option>';
        setSel.disabled = false;
      });
    }
    if(gameSel) gameSel.addEventListener("change", loadSets);

    function pickHtml(card){
      var img = card.img
        ? '<img class="card-img" src="' + TL.esc(card.img) + '" alt="' + TL.esc(card.name) + '" width="250" height="350" decoding="async" referrerpolicy="no-referrer">'
        : '<span class="mystery-card" aria-hidden="true"><span>TOP LOADED</span><b>?</b><small>NO PHOTO</small></span>';
      var price = card.price > 0
        ? (card.priceIsMarket
            ? '<span class="pick-price">' + TL.money(card.price) + ' <small>market reference</small></span>'
            : '<span class="pick-price">' + TL.money(card.price) + ' <small>our price</small></span>')
        : '<span class="pick-price"><small>no price on file</small></span>';
      var badge = card.inStock
        ? '<span class="stock-badge">In stock now</span>'
        : '<span class="stock-badge out">'+(card.stockKnown ? 'Not in the current inventory' : 'Stock unavailable')+'</span>';
      var action = card.inStock
        ? '<button type="button" class="linklike" data-discovery-view>Take a closer look ↗</button>'
        : (card.url ? '<a class="linklike" href="' + TL.esc(card.url) + '" target="_blank" rel="noopener noreferrer">Look it up ↗</a>' : "");
      return '<div class="discovery-pick"><span class="discovery-art' + (card.inStock ? '" role="button" tabindex="0" data-discovery-view aria-label="View ' + TL.esc(card.name) : '') + '">' + img + '</span>' +
        '<div><span class="case-label">A LITTLE DISCOVERY</span><h4>' + TL.esc(card.name) + '</h4>' +
        '<p>' + TL.esc(card.set || "") + (card.rarity ? ' · ' + TL.esc(card.rarity) : "") + '</p>' +
        '<p>' + price + '</p>' + badge + action + '</div></div>';
    }

    form.addEventListener("submit", function(e){
      e.preventDefault();
      var button = document.getElementById("discoveryBtn"), status = document.getElementById("discoveryStatus");
      if(button.disabled) return;
      var game = gameSel.value, budget = Number(document.getElementById("discoveryBudget").value);
      var chosenSet = setSel ? setSel.value : "";
      button.disabled = true; button.textContent = "Exploring the set…";
      status.textContent = "Looking through the set…";
      var pickSet = chosenSet
        ? Promise.resolve(chosenSet)
        : TL.cards.sets(game === "all" ? "all" : game).then(function(list){
            if(!list.length) return "";
            return list[Math.floor(Math.random() * list.length)].code;
          }, function(){ return ""; });

      pickSet.then(function(setToken){
        return TL.cards.fromSet(game === "all" ? "all" : game, setToken, {maxPrice: budget});
      }).then(function(cards){
        if(!cards.length){
          lastPick = null;
          document.getElementById("discoveryResult").innerHTML = '<p class="collector-note">Nothing in that set under ' + TL.money(budget) + '. Try another set or a bigger budget.</p>';
          status.textContent = "No cards matched. Try another set or budget.";
          return;
        }
        var pool = cards.length > 1 ? cards.filter(function(c){ return !lastPick || c.id !== lastPick.id; }) : cards;
        if(!pool.length) pool=cards;
        var card = pool[Math.floor(Math.random() * pool.length)];
        lastPick = card;
        document.getElementById("discoveryResult").innerHTML = pickHtml(card);
        status.textContent = card.name + " — one of " + TL.fmtInt(cards.length) + " in " + (card.set || "that set") +
          (card.inStock ? ". In stock in our latest inventory." : card.stockKnown ? ". Not currently listed in our inventory." : ". Stock could not be checked.") + " Try again for another.";
      }).catch(function(err){
        status.textContent = (err && err.message) || "Could not reach the card catalogue. Please try again.";
      }).finally(function(){
        button.disabled = false; button.innerHTML = (lastPick ? "Find another card" : "Find my next card") + ' <span aria-hidden="true">✦</span>';
      });
    });
    TL.on("init", loadSets);
    document.getElementById("discoveryResult").addEventListener("click",function(e){
      var trigger = e.target.closest("[data-discovery-view]");
      if(!trigger || !lastPick) return;
      var stocked = TL.cards.stockOf(lastPick);
      if(stocked) TL.openQuickView(stocked, {from: trigger});
    });
    document.getElementById("discoveryResult").addEventListener("keydown",function(e){
      if(e.target.matches('[role="button"][data-discovery-view]')&&(e.key==="Enter"||e.key===" ")){e.preventDefault();e.target.click();}
    });
    TL.on("init",renderDeck); TL.on("inventory:summary",renderDeck); TL.on("inventory:summary-failed",renderDeck);
  })();
