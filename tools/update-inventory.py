#!/usr/bin/env python3
"""Pulls Top Loaded TCG's live TCGplayer listings into inventory.json.

Uses the same marketplace search endpoint the TCGplayer storefront itself
calls (captured from the seller page). Run nightly; output is committed to
the repo so GitHub Pages redeploys with fresh stock.
"""
import json
import sys
import time
import urllib.request

SELLER_KEY = "5c356cdf"
SELLER_NAME = "Top Loaded TCG"
API = "https://mp-search-api.tcgplayer.com/v1/search/request?q=&isList=false&mpfev=5489"
PAGE_SIZE = 50
MAX_FROM = 10000  # ES window cap
OUT = "inventory.json"

GAME_KEYS = {
    "pokemon": "pk",
    "pokemon japan": "pk",
    "one piece card game": "op",
    "magic: the gathering": "mtg",
    "magic": "mtg",
    "gundam card game": "gundam",
}


def page_body(offset):
    return json.dumps({
        "algorithm": "sales_dismax",
        "from": offset,
        "size": PAGE_SIZE,
        "filters": {"term": {}, "range": {}, "match": {}},
        "listingSearch": {
            "context": {"cart": {}},
            "filters": {
                "term": {"sellerStatus": "Live", "channelId": 0,
                         "sellerKey": [SELLER_KEY]},
                "range": {"quantity": {"gte": 1}},
                "exclude": {"channelExclusion": 0},
            },
        },
        "context": {"cart": {}, "shippingCountry": "US", "userProfile": {}},
        "settings": {"useFuzzySearch": True, "didYouMean": {}},
        "sort": {},
    }).encode()


def fetch_page(offset, retries=3):
    req = urllib.request.Request(API, data=page_body(offset), headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": "https://www.tcgplayer.com",
        "Referer": "https://www.tcgplayer.com/",
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/148.0.0.0 Safari/537.36"),
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - retry then surface
            if attempt == retries - 1:
                raise
            print("retry %d at offset %d: %s" % (attempt + 1, offset, e))
            time.sleep(2 * (attempt + 1))


def main():
    items = []
    offset = 0
    total = None
    while total is None or (offset < total and offset < MAX_FROM):
        data = fetch_page(offset)
        block = data["results"][0]
        if total is None:
            total = block["totalResults"]
            print("seller reports %d products" % total)
        for p in block["results"]:
            listings = [l for l in (p.get("listings") or [])
                        if l.get("sellerName") == SELLER_NAME]
            if not listings:
                continue
            line = (p.get("productLineName") or "").strip()
            items.append({
                "id": p.get("productId"),
                "name": p.get("productName"),
                "set": p.get("setName"),
                "line": line,
                "game": GAME_KEYS.get(line.lower(), "other"),
                "rarity": p.get("rarityName"),
                "market": p.get("marketPrice"),
                "listings": [{
                    "price": l.get("price"),
                    "qty": int(l.get("quantity") or 0),
                    "cond": l.get("condition"),
                    "printing": l.get("printing"),
                } for l in listings],
            })
        offset += PAGE_SIZE
        time.sleep(0.25)

    items.sort(key=lambda i: (i["line"] or "", i["name"] or "", i["id"] or 0))
    out = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "seller": SELLER_NAME,
        "sellerKey": SELLER_KEY,
        "products": len(items),
        "listings": sum(len(i["listings"]) for i in items),
        "units": sum(l["qty"] for i in items for l in i["listings"]),
        "items": items,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print("wrote %s: %d products, %d listings, %d units" %
          (OUT, out["products"], out["listings"], out["units"]))


if __name__ == "__main__":
    sys.exit(main())
