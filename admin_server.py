#!/usr/bin/env python3
"""
yesspec.com — Admin Back-Office API Server (port 3195)
จัดการข้อมูล Shopee / Lazada พร้อมหลักฐานราคา ตัวเลือกสินค้า และเวลาตรวจสอบ
พร้อมบันทึกลง data/manual_overrides.json, data/daily_prices_feed.json และ index.html ทันที
"""

from __future__ import annotations

import json
import os
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import ranking_offers
import price_check
from runtime_lock import runtime_lock

BASE_DIR = Path(__file__).resolve().parent
INDEX_PATH = BASE_DIR / "index.html"
FEED_PATH = BASE_DIR / "data" / "daily_prices_feed.json"
OVERRIDES_PATH = BASE_DIR / "data" / "manual_overrides.json"
SHOPEE_POOL_PATH = BASE_DIR / "data" / "shopee_DOM_pool.json"
LAZADA_LIVE_PATH = BASE_DIR / "data" / "lazada_live_products.json"

from market_data import (PLATFORMS, identity, normalize_store, observe_manual,
                         rebuild_feed, rebuild_item, record_observations, utc_now,
                         valid_url, write_json)


def format_shopee_affiliate_link(raw_url: str, item_id: str) -> str:
    """Preserve a supplied link; tracking must be created by the platform."""
    return valid_url(raw_url, 'shopee')


def format_lazada_affiliate_link(raw_url: str, item_id: str) -> str:
    return valid_url(raw_url, 'lazada')


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default
    return default


def _categories():
    text = INDEX_PATH.read_text(encoding="utf-8")
    match = re.search(r"const CATEGORIES = (\[[\s\S]*?\n\s*\]);", text)
    return text, match, json.loads(match.group(1)) if match else []


def load_all_products_payload() -> dict:
    _, _, categories = _categories()
    feed = rebuild_feed(load_json(FEED_PATH, {"items_by_id": {}}))
    overrides = load_json(OVERRIDES_PATH, {})
    products = []
    for cat in categories:
        for p in cat.get('products', []):
            pid = p['id']
            item = feed['items_by_id'].get(pid, {})
            stores = item.get('stores_sorted', [])
            product = {'id': pid, 'name': item.get('name') or p.get('name', ''),
                       'sold_count': None, 'category_id': cat['id'], 'category_name': cat.get('name', ''),
                       'category_icon': cat.get('icon', '📦'), 'eyebrow': p.get('eyebrow', ''),
                       'display_price': item.get('cheapest_price'),
                       'image_url': item.get('image_url') or p.get('img', ''),
                       'has_manual_override': pid in overrides}
            for pf in PLATFORMS:
                st = next((s for s in stores if s['platform'] == pf), None) or normalize_store({}, pf)
                product[pf] = {**st, 'aff_link': st['link'], 'price': st['net_price'],
                               'original_price': st['original_price'], 'shop_name': st.get('shop_name', '')}
            products.append(product)
    return {'ok': True, 'total': len(products), 'products': products,
            'categories': [{'id': c['id'], 'name': c.get('name', ''), 'icon': c.get('icon', '📦')} for c in categories],
            'verified_offers': feed['verified_offers']}


def save_product_updates(updates: list[dict]) -> dict:
    overrides = load_json(OVERRIDES_PATH, {})
    feed = rebuild_feed(load_json(FEED_PATH, {'items_by_id': {}}))
    items = feed['items_by_id']
    text, match, categories = _categories()
    models = {p['id']: p for c in categories for p in c.get('products', [])}
    updated = []
    now = utc_now()
    for upd in updates:
        pid = str(upd.get('id') or '').strip()
        if pid not in models:
            raise ValueError('ไม่พบรหัสสินค้า: ' + pid)
        model = models[pid]
        item = items.get(pid, {'id': pid, 'name': model.get('name', ''), 'stores_sorted': []})
        stores = item.get('stores_sorted', [])
        if upd.get('name') and str(upd['name']).strip() != item.get('name', model.get('name', '')):
            for store in stores:
                store.update(confirmed_match=False, observed_at=None)
        item['stores_sorted'] = [observe_manual(upd, pf, next((s for s in stores if s['platform'] == pf), {}), now) for pf in PLATFORMS]
        if upd.get('name'):
            item['name'] = str(upd['name']).strip()
            model['name'] = item['name']
        if 'image_url' in upd:
            image = str(upd['image_url'] or '').strip()
            if image and not image.startswith('https://'):
                raise ValueError('รูปสินค้าต้องเป็น HTTPS')
            item['image_url'] = image
            model['img'] = image
        item = rebuild_item(item, now)
        items[pid] = item
        overrides[pid] = {'schema_version': 2, 'name': item.get('name'), 'image_url': item.get('image_url', ''),
                          'stores_sorted': item['stores_sorted']}
        # Static catalogue prices stay editorial references. The feed alone owns live prices.
        model.pop('soldCount', None)
        updated.append(pid)
    # Validate the complete batch before writing anything.
    feed = rebuild_feed({'items_by_id': items}, now)
    write_json(OVERRIDES_PATH, overrides)
    write_json(FEED_PATH, feed)
    record_observations(BASE_DIR / 'data/market_observations.jsonl', [items[pid] for pid in updated])
    if match:
        formatted = json.dumps(categories, ensure_ascii=False, indent=6).replace('</', '<\\/').replace('\n', '\n    ')
        INDEX_PATH.write_text(text[:match.start(1)] + formatted + text[match.end(1):], encoding='utf-8')
    return {'ok': True, 'updated_count': len(updated), 'updated_ids': updated}


def extract_url_metadata(raw_url: str, product_id: str = '') -> dict:
    """Extract identity only. A cached/HTML price cannot prove a selected SKU price."""
    url = str(raw_url or '').strip()
    pf = next((p for p in PLATFORMS if urllib.parse.urlparse(url).hostname in
               ({'shopee.co.th', 'www.shopee.co.th', 's.shopee.co.th', 'shp.ee'} if p == 'shopee'
                else {'lazada.co.th', 'www.lazada.co.th', 's.lazada.co.th'})), None)
    if not pf:
        raise ValueError('กรุณาวางลิงก์ Shopee หรือ Lazada ประเทศไทย')
    valid_url(url, pf)
    ids = identity(url, pf)
    return {'ok': True, 'platform': pf, 'resolved_url': url if ids else '', **ids,
            'price': None, 'status': 'unverified',
            'message': 'พบรหัสสินค้าแล้ว กรุณาตรวจตัวเลือก ราคา และยอดขายจากหน้าร้าน' if ids
                       else 'ลิงก์ย่อยังไม่ยืนยันปลายทาง เปิดลิงก์แล้ววาง URL หน้าสินค้าเต็มในช่องต้นทาง'}


AUTH_CONFIG_PATH = Path(os.environ.get("YESSPEC_AUTH_FILE", "/etc/yesspec-admin.json"))
_LOGIN_ATTEMPTS: dict[str, list[float]] = {}
MAX_ATTEMPTS = 5
LOCKOUT_SECONDS = 900  # 15 minutes


def _get_auth_config() -> dict:
    if AUTH_CONFIG_PATH.exists():
        try:
            return json.loads(AUTH_CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _make_token(username: str, password_sha256: str, secret: str) -> str:
    import hashlib, hmac
    if not username or not password_sha256 or not secret:
        return ""
    msg = f"{username}:{password_sha256}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def _verify_token(token: str) -> bool:
    import hmac
    if not token:
        return False
    cfg = _get_auth_config()
    secret = cfg.get("secret", "")
    pw_hash = cfg.get("password_sha256", "")
    if not secret or not pw_hash:
        return False
    expected = _make_token(cfg.get("username", ""), pw_hash, secret)
    return bool(expected) and hmac.compare_digest(token, expected)


class AdminRequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token, Authorization")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _client_ip(self) -> str:
        return self.headers.get("X-Real-IP") or self.client_address[0] or "unknown"

    def _is_authorized(self) -> bool:
        token = self.headers.get("X-Admin-Token", "").strip()
        if not token:
            auth = self.headers.get("Authorization", "").strip()
            if auth.lower().startswith("bearer "):
                token = auth[7:].strip()
        return _verify_token(token)

    def do_OPTIONS(self):
        self._send_json({"ok": True})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/api/admin/products", "/api/admin/ranking-products"):
            if not self._is_authorized():
                self._send_json({"ok": False, "error": "Unauthorized"}, 401)
                return
            try:
                payload = ranking_offers.payload(BASE_DIR) if parsed.path.endswith('/ranking-products') else load_all_products_payload()
                self._send_json(payload)
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, 400)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return
        self._send_json({"ok": False, "error": "Not found"}, 404)

    def do_POST(self):
        import hashlib, hmac, secrets, time
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw_body = self.rfile.read(length).decode("utf-8", errors="ignore") if length > 0 else "{}"
        try:
            body = json.loads(raw_body)
        except Exception:
            body = {}

        if parsed.path == "/api/admin/login":
            ip = self._client_ip()
            now = time.time()
            recent = [t for t in _LOGIN_ATTEMPTS.get(ip, []) if now - t < LOCKOUT_SECONDS]
            _LOGIN_ATTEMPTS[ip] = recent
            if len(recent) >= MAX_ATTEMPTS:
                self._send_json({"ok": False, "error": "Too many failed attempts. Please try again later."}, 429)
                return

            user_in = (body.get("username") or "").strip()
            pass_in = body.get("password") or ""
            cfg = _get_auth_config()
            valid_users = {
                u.lower() for u in [cfg.get("username", ""), cfg.get("alt_username", "")] if u
            }
            pass_hash = hashlib.sha256(pass_in.encode("utf-8")).hexdigest()
            stored_hash = cfg.get("password_sha256", "")
            if valid_users and stored_hash and user_in.lower() in valid_users and hmac.compare_digest(pass_hash, stored_hash):
                _LOGIN_ATTEMPTS.pop(ip, None)
                token = _make_token(cfg.get("username", ""), stored_hash, cfg.get("secret", ""))
                self._send_json({"ok": True, "token": token})
            else:
                recent.append(now)
                _LOGIN_ATTEMPTS[ip] = recent
                self._send_json({"ok": False, "error": "Invalid credentials"}, 401)
            return

        if not self._is_authorized():
            self._send_json({"ok": False, "error": "Unauthorized"}, 401)
            return

        if parsed.path == "/api/admin/check-ranking-price":
            try:
                if not isinstance(body, dict):
                    raise ValueError('ข้อมูลที่ส่งมาไม่ถูกต้อง')
                self._send_json(price_check.check_price(body.get('url'), body.get('platform')))
            except ValueError as e:
                self._send_json({'ok': False, 'error': str(e)}, 400)
            except Exception:
                self._send_json({'ok': False, 'error': 'ตรวจราคาไม่ได้ กรุณาลองใหม่หรือกรอกเอง'}, 502)
            return

        if parsed.path == "/api/admin/save-ranking-offers":
            try:
                if not isinstance(body, dict):
                    raise ValueError('ข้อมูลที่ส่งมาไม่ถูกต้อง')
                with runtime_lock(BASE_DIR):
                    result = ranking_offers.save(BASE_DIR, body.get('products', []))
                self._send_json(result)
            except ranking_offers.ConflictError as e:
                self._send_json({'ok': False, 'error': str(e)}, 409)
            except ValueError as e:
                self._send_json({'ok': False, 'error': str(e)}, 400)
            except Exception:
                self._send_json({'ok': False, 'error': 'บันทึกช่องทางซื้อไม่ได้ กรุณาลองใหม่'}, 500)
            return

        if parsed.path == "/api/admin/change-password":
            new_user = (body.get("new_username") or "").strip()
            new_pass = body.get("new_password") or ""
            if not new_user or len(new_pass) < 8:
                self._send_json({"ok": False, "error": "Username required and password must be at least 8 characters"}, 400)
                return
            cfg = _get_auth_config()
            cfg["username"] = new_user
            cfg.pop("alt_username", None)
            cfg["password_sha256"] = hashlib.sha256(new_pass.encode("utf-8")).hexdigest()
            cfg["secret"] = secrets.token_hex(32)
            with runtime_lock(BASE_DIR):
                AUTH_CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
                os.chmod(AUTH_CONFIG_PATH, 0o600)
            new_token = _make_token(cfg["username"], cfg["password_sha256"], cfg["secret"])
            self._send_json({"ok": True, "token": new_token})
            return

        if parsed.path == "/api/admin/save-product":
            try:
                updates = body.get("products") if isinstance(body.get("products"), list) else [body]
                with runtime_lock(BASE_DIR):
                    res = save_product_updates(updates)
                self._send_json(res)
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, 400)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        if parsed.path == "/api/admin/extract-url":
            try:
                res = extract_url_metadata(body.get("url", ""), body.get("id", ""))
                self._send_json(res)
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, 400)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        self._send_json({"ok": False, "error": "Not found"}, 404)

    def log_message(self, format, *args):
        return


def reapply_all_overrides():
    # Rebuild only: replaying saved data must never create a fresh observation.
    from price_sync_mcp import run_daily_price_sync
    with runtime_lock(BASE_DIR):
        return run_daily_price_sync(silent=True, base_dir=BASE_DIR)


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
