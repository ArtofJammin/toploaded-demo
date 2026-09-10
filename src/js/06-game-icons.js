  /* One local SVG sprite for shelf links and game selectors. Labels stay visible. */
  TL.gameIcon = function(game){
    if(["pk", "op", "mtg", "gundam", "lorcana"].indexOf(game) === -1) return "";
    return '<svg class="game-icon" width="24" height="24" aria-hidden="true" focusable="false"><use href="#game-icon-' + game + '"></use></svg>';
  };
