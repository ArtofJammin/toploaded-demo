  /* ---------- data ---------- */
  var GAMES = {pk:"Pokemon", op:"One Piece", mtg:"Magic"};
  var ITEMS = [
    {id:"pk1", name:"Charizard ex", set:"Scarlet & Violet\u2014151 \u00b7 199/165", game:"pk", type:"single", cond:"NM", price:109.99, stock:2},
    {id:"pk2", name:"Pikachu with Grey Felt Hat", set:"SVP Promo \u00b7 085", game:"pk", type:"single", cond:"NM", price:329.00, stock:1},
    {id:"pk3", name:"Tatsugiri ex", set:"Surging Sparks \u00b7 226/191", game:"pk", type:"single", cond:"NM", price:34.50, stock:3},
    {id:"pk4", name:"Iono (Special Art)", set:"Paldea Evolved \u00b7 254/193", game:"pk", type:"single", cond:"LP", price:82.00, stock:1},
    {id:"pk5", name:"Roaring Moon ex", set:"Paradox Rift \u00b7 251/182", game:"pk", type:"single", cond:"NM", price:24.00, stock:4},
    {id:"pk6", name:"151 Booster Bundle", set:"Scarlet & Violet\u2014151 \u00b7 sealed", game:"pk", type:"sealed", cond:null, price:69.99, stock:8},
    {id:"pk7", name:"Prismatic Evolutions ETB", set:"Elite Trainer Box \u00b7 sealed", game:"pk", type:"sealed", cond:null, price:99.99, stock:4},
    {id:"pk8", name:"Surging Sparks Booster Box", set:"36 packs \u00b7 sealed", game:"pk", type:"sealed", cond:null, price:159.99, stock:3},
    {id:"op1", name:"Shanks (Leader)", set:"OP-09 Emperors in the New World", game:"op", type:"single", cond:"NM", price:59.99, stock:2},
    {id:"op2", name:"Monkey D. Luffy (Secret)", set:"OP-05 Awakening of the New Era", game:"op", type:"single", cond:"NM", price:119.00, stock:1},
    {id:"op3", name:"Boa Hancock (SR)", set:"OP-07 500 Years in the Future", game:"op", type:"single", cond:"NM", price:18.50, stock:5},
    {id:"op4", name:"Trafalgar Law (Leader)", set:"OP-01 Romance Dawn", game:"op", type:"single", cond:"LP", price:74.00, stock:1},
    {id:"op5", name:"OP-11 Booster Box", set:"A Fist of Divine Speed \u00b7 sealed", game:"op", type:"sealed", cond:null, price:89.99, stock:6},
    {id:"op6", name:"EB-01 Memorial Collection", set:"Extra Booster display \u00b7 sealed", game:"op", type:"sealed", cond:null, price:124.99, stock:2},
    {id:"m1", name:"Ragavan, Nimble Pilferer", set:"Modern Horizons 2 \u00b7 138", game:"mtg", type:"single", cond:"NM", price:58.00, stock:2},
    {id:"m2", name:"Sheoldred, the Apocalypse", set:"Dominaria United \u00b7 107", game:"mtg", type:"single", cond:"NM", price:69.00, stock:3},
    {id:"m3", name:"The One Ring", set:"Tales of Middle-earth \u00b7 246", game:"mtg", type:"single", cond:"LP", price:54.00, stock:1},
    {id:"m4", name:"Orcish Bowmasters", set:"Tales of Middle-earth \u00b7 103", game:"mtg", type:"single", cond:"NM", price:32.00, stock:4},
    {id:"m5", name:"Bloomburrow Play Booster Box", set:"36 packs \u00b7 sealed", game:"mtg", type:"sealed", cond:null, price:129.99, stock:5},
    {id:"m6", name:"MH3 Collector Booster", set:"Modern Horizons 3 \u00b7 single pack", game:"mtg", type:"sealed", cond:null, price:59.99, stock:7}
  ];

  var $ = function(s, c){ return (c||document).querySelector(s); };
  var $$ = function(s, c){ return Array.prototype.slice.call((c||document).querySelectorAll(s)); };
  var money = function(n){ return "$" + n.toFixed(2); };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  TL.$ = $; TL.$$ = $$; TL.money = money; TL.reduceMotion = reduceMotion; TL.GAMES = GAMES; TL.ITEMS = ITEMS;
