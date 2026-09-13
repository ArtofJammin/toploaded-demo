  /* Whole-set snapshots on our origin; exact product IDs keep reprint stock separate. */
  TL.cards = (function(){
    var pending={};
    function get(file){
      if(pending[file])return pending[file];
      var ctrl=typeof AbortController!=="undefined"?new AbortController():null;
      var timer=ctrl?setTimeout(function(){ctrl.abort();},12000):0;
      pending[file]=fetch(file,{cache:"no-cache",signal:ctrl?ctrl.signal:undefined}).then(function(r){if(!r.ok)throw new Error("The card catalogue is unavailable. Please retry shortly.");return r.json();}).catch(function(e){delete pending[file];throw e;}).finally(function(){if(timer)clearTimeout(timer);});
      return pending[file];
    }
    function sets(game){return get("catalog-index.json").then(function(d){
      if(!d || !Array.isArray(d.sets))throw new Error("Invalid card catalogue");
      return d.sets.filter(function(s){return game==="all"||s.game===game;}).sort(function(a,b){return Number(b.code)-Number(a.code);});
    });}
    function stockOf(card){
      if(!card || !TL.inventory || !TL.inventory.loaded || TL.inventory.failed)return null;
      var it=TL.inventory.byId("tcg-"+String(card.id));
      return it && it.type==="single" && it.stock>0 && it.game===card.game?it:null;
    }
    function withStock(c){
      var card=Object.assign({},c),it=stockOf(card);
      card.inStock=!!it;card.item=it;card.stockKnown=!!(TL.inventory && TL.inventory.loaded && !TL.inventory.failed);
      card.priceIsMarket=!it;if(it)card.price=it.price;return card;
    }
    function fromSet(game,code,opts){
      opts=opts||{};
      return Promise.all([sets(game),TL.inventory.load().catch(function(){return null;})]).then(function(parts){
        var list=parts[0],set=list.find(function(s){return s.code===String(code)||s.name===code;});
        if(!set&&!code)set=list[Math.floor(Math.random()*list.length)];
        if(!set || !/^catalog-\d+\.json$/.test(set.file))throw new Error("Choose an available catalogue set.");
        return get(set.file).then(function(d){
          if(!d||!Array.isArray(d.cards)||d.cards.length!==set.count)throw new Error("The complete set could not be loaded. Please retry.");
          var cards=d.cards.map(withStock).filter(function(c){return (!opts.requirePhoto||c.img)&&(!opts.maxPrice||c.price>0&&c.price<=opts.maxPrice);});
          if(opts.count){var out=[];while(out.length<opts.count&&cards.length)out.push(cards.splice(Math.floor(Math.random()*cards.length),1)[0]);return out;}
          return cards;
        });
      });
    }
    return {sets:sets,fromSet:fromSet,stockOf:stockOf,catalogued:function(g){return ["pk","op","mtg","gundam","lorcana"].indexOf(g)>-1;}};
  })();
