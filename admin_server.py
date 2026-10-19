#!/usr/bin/env python3
"""
yesspec.com — Admin Back-Office API Server (port 3195)
จัดการแปะลิงก์ Shopee / Lazada, แก้ไขราคาจริงให้ตรง 100%, และเปลี่ยนรูปสินค้าจาก Shopee/Lazada
พร้อมบันทึกลง data/manual_overrides.json, data/daily_prices_feed.json และ index.html ทันที
"""

from __future__ import annotations

import html as html_lib
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
INDEX_PATH = BASE_DIR / "index.html"
FEED_PATH = BASE_DIR / "data" / "daily_prices_feed.json"
OVERRIDES_PATH = BASE_DIR / "data" / "manual_overrides.json"
SHOPEE_POOL_PATH = BASE_DIR / "data" / "shopee_DOM_pool.json"
LAZADA_LIVE_PATH = BASE_DIR / "data" / "lazada_live_products.json"

SHOPEE_AFF_ID = "15385610012"
LAZADA_AFF_ID = "267671179"
LAZ_EXLAZ = "e_B7mvt0tli55sbdaDA0DvZOb5ctG2SI%252F1oCEiHEl%252FUv6VEqD9MYhqUaBZjUeQcq%252FEsHyU0g7Ue2BaQSn2j07SOpy%252BluXF85Cop2wKbp7jb3SMVF0silKVnV0eDLXAhVqJ0%252F%252BjTUiUr75fykH4ULsnb5jPvKUp8JpoyrI0XKdux4HApXygm91QTIosaAsYiMVgksbiVaOKUnAW%252FECuMLE35Q%253D%253D"
LAZ_SHARE = "4161151791_1_9300_110172189818_4161153791_null"
LAZ_TOKEN = "08d572ad001a0d070782467eba3d16d9"


def format_shopee_affiliate_link(raw_url: str, item_id: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        return ""
    # If already an affiliate shortlink or an_redir link, keep as-is
    if "s.shopee.co.th" in url or "shp.ee" in url or "utm_source=an_" in url:
        return url
    clean_sub = "yespec" + re.sub(r"[^a-zA-Z0-9]", "", item_id)[:18]
    # Strip existing query string for clean product URL if it's a direct product page
    parsed = urllib.parse.urlparse(url)
    clean_origin = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    if "search" in parsed.path:
        clean_origin = url
    return (
        f"https://s.shopee.co.th/an_redir?origin_link="
        f"{urllib.parse.quote(clean_origin, safe='')}"
        f"&affiliate_id={SHOPEE_AFF_ID}&sub_id={clean_sub}----"
    )


def format_lazada_affiliate_link(raw_url: str, item_id: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        return ""
    if "s.lazada.co.th" in url or "exlaz=" in url or "aff_id=" in url:
        return url
    clean_sub = "yespec" + re.sub(r"[^a-zA-Z0-9]", "", item_id)[:18]
    parsed = urllib.parse.urlparse(url)
    clean_origin = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    sep = "&" if "?" in clean_origin else "?"
    return (
        f"{clean_origin}{sep}from_affiliate=1&t=pdp&exlaz={LAZ_EXLAZ}"
        f"&dsource=share&laz_share_info={LAZ_SHARE}&laz_token={LAZ_TOKEN}"
        f"&sub_id1={clean_sub}&aff_id={LAZADA_AFF_ID}&c=d"
    )


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default
    return default


def load_all_products_payload() -> dict:
    html_text = INDEX_PATH.read_text(encoding="utf-8")
    cat_match = re.search(r"const CATEGORIES = (\[[\s\S]*?\n\s*\]);", html_text)
    categories_raw = json.loads(cat_match.group(1)) if cat_match else []
    feed = load_json(FEED_PATH, {"items_by_id": {}})
    items_by_id = feed.get("items_by_id", {})
    overrides = load_json(OVERRIDES_PATH, {})

    categories_out = []
    products_out = []

    for cat in categories_raw:
        cid = cat.get("id", "")
        cname = cat.get("name", "")
        cicon = cat.get("icon", "📦")
        categories_out.append({"id": cid, "name": cname, "icon": cicon})

        for p in cat.get("products", []):
            pid = p.get("id", "")
            f_item = items_by_id.get(pid, {})
            stores = f_item.get("stores_sorted", [])
            sp_store = next((s for s in stores if s.get("platform") == "shopee"), {})
            lz_store = next((s for s in stores if s.get("platform") == "lazada"), {})
            ov = overrides.get(pid, {})

            img_url = (
                ov.get("image_url")
                or p.get("img")
                or f_item.get("image_url")
                or sp_store.get("image_url")
                or lz_store.get("image_url")
                or ""
            )

            sp_price = int(ov.get("shopee_price") or sp_store.get("net_price") or p.get("price") or 0)
            lz_price = int(ov.get("lazada_price") or lz_store.get("net_price") or p.get("price") or 0)

            sp_link = ov.get("shopee_raw_link") or ov.get("shopee_link") or sp_store.get("link") or ""
            lz_link = ov.get("lazada_raw_link") or ov.get("lazada_link") or lz_store.get("link") or ""

            sp_type = "exact_pdp" if ov.get("shopee_link") else sp_store.get("link_type", "mall_exact_query")
            lz_type = "exact_pdp" if ov.get("lazada_link") else lz_store.get("link_type", "mall_exact_query")

            products_out.append({
                "id": pid,
                "name": p.get("name", ""),
                "category_id": cid,
                "category_name": cname,
                "category_icon": cicon,
                "eyebrow": p.get("eyebrow", ""),
                "display_price": int(p.get("price") or 0),
                "image_url": img_url,
                "has_manual_override": pid in overrides,
                "shopee": {
                    "link": sp_link,
                    "aff_link": sp_store.get("link", ""),
                    "price": sp_price,
                    "original_price": int(ov.get("shopee_orig_price") or sp_store.get("original_price") or sp_price),
                    "shop_name": ov.get("shopee_shop") or sp_store.get("shop_name") or "Shopee Mall Official",
                    "link_type": sp_type,
                },
                "lazada": {
                    "link": lz_link,
                    "aff_link": lz_store.get("link", ""),
                    "price": lz_price,
                    "original_price": int(ov.get("lazada_orig_price") or lz_store.get("original_price") or lz_price),
                    "shop_name": ov.get("lazada_shop") or lz_store.get("shop_name") or "LazMall Official",
                    "link_type": lz_type,
                },
            })

    return {
        "ok": True,
        "total": len(products_out),
        "categories": categories_out,
        "products": products_out,
    }


def save_product_updates(updates: list[dict]) -> dict:
    overrides = load_json(OVERRIDES_PATH, {})
    feed = load_json(FEED_PATH, {"items_by_id": {}, "items": []})
    items_by_id = feed.get("items_by_id", {})

    html_text = INDEX_PATH.read_text(encoding="utf-8")
    cat_match = re.search(r"const CATEGORIES = (\[[\s\S]*?\n\s*\]);", html_text)
    cats_data = json.loads(cat_match.group(1)) if cat_match else []

    updated_ids = []

    for upd in updates:
        pid = (upd.get("id") or "").strip()
        if not pid:
            continue

        sp_raw = (upd.get("shopee_link") or "").strip()
        lz_raw = (upd.get("lazada_link") or "").strip()
        sp_price = int(float(upd.get("shopee_price") or 0))
        lz_price = int(float(upd.get("lazada_price") or 0))
        sp_orig = int(float(upd.get("shopee_orig_price") or sp_price))
        lz_orig = int(float(upd.get("lazada_orig_price") or lz_price))
        sp_shop = (upd.get("shopee_shop") or "Shopee Mall Official").strip()
        lz_shop = (upd.get("lazada_shop") or "LazMall Official").strip()
        img_url = (upd.get("image_url") or "").strip()

        f_item = items_by_id.get(pid, {})
        old_stores = f_item.get("stores_sorted", [])
        old_sp = next((s for s in old_stores if s.get("platform") == "shopee"), {})
        old_lz = next((s for s in old_stores if s.get("platform") == "lazada"), {})

        # Determine whether link is a real direct product link or search fallback
        is_sp_direct = bool(
            sp_raw
            and "shopee.co.th/search?" not in sp_raw
            and "origin_link=https%3A%2F%2Fshopee.co.th%2Fsearch" not in sp_raw
        )
        is_lz_direct = bool(
            lz_raw
            and "lazada.co.th/catalog/" not in lz_raw
        )

        sp_aff = format_shopee_affiliate_link(sp_raw, pid) if sp_raw else old_sp.get("link", "")
        lz_aff = format_lazada_affiliate_link(lz_raw, pid) if lz_raw else old_lz.get("link", "")

        if sp_price <= 0:
            sp_price = int(old_sp.get("net_price") or f_item.get("cheapest_price") or 0)
        if lz_price <= 0:
            lz_price = int(old_lz.get("net_price") or sp_price)

        if sp_orig < sp_price:
            sp_orig = sp_price
        if lz_orig < lz_price:
            lz_orig = lz_price

        sp_disc = f"{int(round((1 - sp_price / sp_orig) * 100))}%" if sp_orig > sp_price else ""
        lz_disc = f"{int(round((1 - lz_price / lz_orig) * 100))}%" if lz_orig > lz_price else ""

        final_img = img_url or f_item.get("image_url") or ""

        overrides[pid] = {
            "updated_at": datetime.now().isoformat(),
            "shopee_raw_link": sp_raw,
            "shopee_link": sp_aff,
            "shopee_price": sp_price,
            "shopee_orig_price": sp_orig,
            "shopee_shop": sp_shop,
            "shopee_is_direct": is_sp_direct,
            "lazada_raw_link": lz_raw,
            "lazada_link": lz_aff,
            "lazada_price": lz_price,
            "lazada_orig_price": lz_orig,
            "lazada_shop": lz_shop,
            "lazada_is_direct": is_lz_direct,
            "image_url": final_img,
        }

        sp_entry = {
            "store": f"Shopee Mall • {sp_shop}",
            "platform": "shopee",
            "shop_name": sp_shop,
            "badge": f"ร้านทางการ {sp_shop}",
            "net_price": sp_price,
            "original_price": sp_orig,
            "discount_pct": sp_disc,
            "shipping": "ส่งฟรี • ของแท้ Shopee Mall 100%",
            "image_url": final_img,
            "link": sp_aff,
            "is_direct_product": is_sp_direct,
            "link_type": "exact_pdp" if is_sp_direct else "mall_exact_query",
            "exact_query": f_item.get("exact_query", ""),
        }
        lz_entry = {
            "store": f"LazMall • {lz_shop}",
            "platform": "lazada",
            "shop_name": lz_shop,
            "badge": f"ร้านทางการ {lz_shop}",
            "net_price": lz_price,
            "original_price": lz_orig,
            "discount_pct": lz_disc,
            "shipping": "ส่งฟรี • คืนสินค้าได้ใน 15 วัน",
            "image_url": final_img,
            "link": lz_aff,
            "is_direct_product": is_lz_direct,
            "link_type": "exact_pdp" if is_lz_direct else "mall_exact_query",
            "exact_query": f_item.get("exact_query", ""),
        }

        stores_sorted = [sp_entry, lz_entry]
        stores_sorted.sort(key=lambda s: (0 if s["link_type"] == "exact_pdp" else 1, s["net_price"]))

        cheapest_price = min(sp_price, lz_price)
        if is_sp_direct and not is_lz_direct:
            cheapest_price = sp_price
        elif is_lz_direct and not is_sp_direct:
            cheapest_price = lz_price

        f_item["cheapest_price"] = cheapest_price
        f_item["cheapest_store"] = stores_sorted[0]["store"]
        f_item["cheapest_link"] = stores_sorted[0]["link"]
        if final_img:
            f_item["image_url"] = final_img
        f_item["stores_sorted"] = stores_sorted
        items_by_id[pid] = f_item
        updated_ids.append(pid)

        # Also sync into CATEGORIES inside index.html
        for cat in cats_data:
            for p in cat.get("products", []):
                if p.get("id") == pid:
                    p["price"] = cheapest_price
                    if final_img:
                        p["img"] = final_img

    # Rebuild feed["items"] list
    feed["updated_at"] = datetime.now().isoformat()
    feed["items_by_id"] = items_by_id
    feed["items"] = list(items_by_id.values())

    OVERRIDES_PATH.write_text(json.dumps(overrides, ensure_ascii=False, indent=2), encoding="utf-8")
    FEED_PATH.write_text(json.dumps(feed, ensure_ascii=False, indent=2), encoding="utf-8")

    if cat_match and cats_data:
        formatted_cats = json.dumps(cats_data, ensure_ascii=False, indent=6).replace("\n", "\n    ")
        html_text = html_text[:cat_match.start(1)] + formatted_cats + html_text[cat_match.end(1):]
        INDEX_PATH.write_text(html_text, encoding="utf-8")

    return {"ok": True, "updated_count": len(updated_ids), "updated_ids": updated_ids}


def extract_url_metadata(raw_url: str, product_id: str = "") -> dict:
    url = (raw_url or "").strip()
    if not url:
        return {"ok": False, "error": "กรุณาวางลิงก์ก่อนครับ"}

    resolved_url = url
    html_body = ""
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
                "Accept-Language": "th-TH,th;q=0.9,en;q=0.8",
            },
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            resolved_url = resp.geturl()
            html_body = resp.read(250_000).decode("utf-8", errors="ignore")
    except Exception:
        pass

    # If wrapped in an_redir?origin_link=...
    if "origin_link=" in resolved_url:
        parsed = urllib.parse.urlparse(resolved_url)
        qs = dict(urllib.parse.parse_qsl(parsed.query))
        if qs.get("origin_link"):
            resolved_url = urllib.parse.unquote(qs["origin_link"])

    # Extract Shopee item_id from URL if possible (e.g. /product/shopid/itemid or -i.shopid.itemid)
    sp_item_id = None
    m1 = re.search(r"/product/(\d+)/(\d+)", resolved_url)
    m2 = re.search(r"-i\.(\d+)\.(\d+)", resolved_url)
    if m1:
        sp_item_id = m1.group(2)
    elif m2:
        sp_item_id = m2.group(2)

    if sp_item_id and SHOPEE_POOL_PATH.exists():
        pool = load_json(SHOPEE_POOL_PATH, [])
        for entry in pool:
            if str(entry.get("item_id")) == str(sp_item_id):
                return {
                    "ok": True,
                    "resolved_url": resolved_url,
                    "title": entry.get("title", ""),
                    "price": entry.get("price", 0),
                    "original_price": entry.get("original_price", 0),
                    "shop_name": entry.get("shop_name", ""),
                    "image_url": entry.get("image", ""),
                }

    # Try matching Lazada itemId from URL (e.g. -i123456789-s...)
    lz_item_m = re.search(r"-i(\d+)", resolved_url)
    if lz_item_m and LAZADA_LIVE_PATH.exists():
        lz_item_id = lz_item_m.group(1)
        laz_map = load_json(LAZADA_LIVE_PATH, {})
        for _, entry in laz_map.items():
            if str(entry.get("itemId")) == str(lz_item_id):
                return {
                    "ok": True,
                    "resolved_url": resolved_url,
                    "title": entry.get("title", ""),
                    "price": int(round(float(entry.get("afterVoucherPrice") or entry.get("price") or 0))),
                    "original_price": int(round(float(entry.get("originalPrice") or 0))),
                    "shop_name": entry.get("sellerName", ""),
                    "image_url": entry.get("imageUrl", ""),
                }

    # Parse OpenGraph tags from fetched HTML if available
    og_img = ""
    og_title = ""
    price_val = 0

    img_m = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', html_body, re.I)
    if not img_m:
        img_m = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', html_body, re.I)
    if img_m:
        og_img = html_lib.unescape(img_m.group(1))

    title_m = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', html_body, re.I)
    if title_m:
        og_title = html_lib.unescape(title_m.group(1))

    price_m = re.search(r'"price"\s*:\s*"?(\d+(?:\.\d+)?)"?', html_body)
    if price_m:
        raw_p = float(price_m.group(1))
        # Shopee sometimes stores price * 100000 in JSON
        if raw_p > 10_000_000:
            raw_p = raw_p / 100000
        price_val = int(round(raw_p))

    return {
        "ok": True,
        "resolved_url": resolved_url,
        "title": og_title,
        "price": price_val,
        "image_url": og_img,
    }


class AdminRequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json({"ok": True})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/admin/products":
            try:
                payload = load_all_products_payload()
                self._send_json(payload)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return
        self._send_json({"ok": False, "error": "Not found"}, 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw_body = self.rfile.read(length).decode("utf-8", errors="ignore") if length > 0 else "{}"
        try:
            body = json.loads(raw_body)
        except Exception:
            body = {}

        if parsed.path == "/api/admin/save-product":
            try:
                updates = body.get("products") if isinstance(body.get("products"), list) else [body]
                res = save_product_updates(updates)
                self._send_json(res)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        if parsed.path == "/api/admin/extract-url":
            try:
                res = extract_url_metadata(body.get("url", ""), body.get("id", ""))
                self._send_json(res)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        self._send_json({"ok": False, "error": "Not found"}, 404)

    def log_message(self, format, *args):
        return


def reapply_all_overrides():
    overrides = load_json(OVERRIDES_PATH, {})
    if not overrides:
        return
    updates = []
    for pid, ov in overrides.items():
        updates.append({
            "id": pid,
            "shopee_link": ov.get("shopee_raw_link") or ov.get("shopee_link") or "",
            "shopee_price": ov.get("shopee_price") or 0,
            "shopee_orig_price": ov.get("shopee_orig_price") or 0,
            "shopee_shop": ov.get("shopee_shop") or "Shopee Mall Official",
            "lazada_link": ov.get("lazada_raw_link") or ov.get("lazada_link") or "",
            "lazada_price": ov.get("lazada_price") or 0,
            "lazada_orig_price": ov.get("lazada_orig_price") or 0,
            "lazada_shop": ov.get("lazada_shop") or "LazMall Official",
            "image_url": ov.get("image_url") or "",
        })
    if updates:
        save_product_updates(updates)


def main():
    import sys
    if "--reapply-overrides" in sys.argv:
        reapply_all_overrides()
        return
    port = int(os.environ.get("YESSPEC_ADMIN_PORT", "3195"))
    server = HTTPServer(("127.0.0.1", port), AdminRequestHandler)
    print(f"✅ yesspec Admin Back-Office API listening on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
