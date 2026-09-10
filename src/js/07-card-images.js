  /* A failed photo gets one alternate TCGplayer image URL, never an endless retry.
     Do not silently replace a missing product photo with invented card artwork. */
  (function(){
    var legacy = /^https:\/\/tcgplayer-cdn\.tcgplayer\.com\/product\/(\d+)_in_(\d+x\d+)\.jpg(?:\?.*)?$/i;
    var modern = /^https:\/\/product-images\.tcgplayer\.com\/fit-in\/(\d+x\d+)\/(\d+)\.jpg(?:\?.*)?$/i;
    function alternate(src){
      var m = legacy.exec(src || "");
      if(m) return "https://product-images.tcgplayer.com/fit-in/" + m[2] + "/" + m[1] + ".jpg";
      m = modern.exec(src || "");
      return m ? "https://tcgplayer-cdn.tcgplayer.com/product/" + m[2] + "_in_" + m[1] + ".jpg" : "";
    }
    function managed(img){ return img && img.tagName === "IMG" && (img.classList.contains("card-img") || !!alternate(img.currentSrc || img.src)); }
    function loaded(img){
      img.classList.add("ok");
      img.dataset.imageState = "loaded";
      img.style.removeProperty("visibility");
      var cartArt = img.closest(".ct-art"); if(cartArt) cartArt.classList.remove("noimg");
    }
    function failed(img){
      if(!managed(img) || img.dataset.imageState === "failed") return false;
      var next = alternate(img.currentSrc || img.src);
      if(next && !img.dataset.imageRetried){
        img.dataset.imageRetried = "1";
        img.dataset.imageState = "retrying";
        img.removeAttribute("srcset");
        img.referrerPolicy = "no-referrer";
        img.src = next;
        return true;
      }
      img.dataset.imageState = "failed";
      if(!img.parentNode) return true;
      var owner = img.closest("[data-name], [data-id], [data-qv]"), name = img.alt || (owner && owner.dataset.name) || "Card";
      if(name === "Card" && owner && TL.inventory){
        var item = TL.inventory.byId(owner.dataset.id || owner.dataset.qv);
        if(item) name = item.name;
      }
      var placeholder = document.createElement("span");
      placeholder.className = "card-image-missing";
      placeholder.setAttribute("role", "img");
      placeholder.setAttribute("aria-label", name + ": photo unavailable");
      placeholder.textContent = "Photo unavailable";
      placeholder.title = name + ". Product details are still available.";
      img.parentNode.replaceChild(placeholder, img);
      return true;
    }
    function scan(root){
      (root || document).querySelectorAll("img.card-img").forEach(function(img){
        if(!img.getAttribute("src") || !img.complete) return;
        if(img.naturalWidth > 0) loaded(img);
        else failed(img);
      });
    }
    TL.cardImages = {alternate:alternate, failed:failed, loaded:loaded, scan:scan};
    document.addEventListener("load", function(e){ if(managed(e.target)) loaded(e.target); }, true);
    document.addEventListener("error", function(e){
      if(failed(e.target)) e.stopImmediatePropagation(); /* older inline handlers must not hide a retry */
    }, true);
    TL.on("init", function(){ scan(document); });
    TL.on("view:change", function(){ requestAnimationFrame(function(){ scan(document); }); });
  })();
