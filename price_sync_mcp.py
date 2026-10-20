#!/usr/bin/env python3
"""
yespec — Daily Price Sync & MCP Server (Shopee Mall & Lazada LazMall)
======================================================================
การซิงค์ข้อมูลที่มีหลักฐาน (ยังไม่ยืนยันสิทธิ์ API):
- Shopee Affiliate ID: 15385610012 (orkid8931) -> Official Gateway: s.shopee.co.th/an_redir
- Lazada Member ID:    267671179 (kidpuvaphat / Referral: AM86gKgj) -> Official exlaz Tracking
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from market_data import read_json, rebuild_feed, write_json

SHOPEE_GRAPHQL_ENDPOINT = "https://open-api.affiliate.shopee.co.th/graphql"


def load_affiliate_config(base_dir: Path) -> dict:
    cfg_path = base_dir / "data" / "affiliate_config.json"
    default_cfg = {
        "platform": "yespec",
        "domain": "https://yespec.com",
        "live_url": "https://kidpuvaphat.github.io/yesspec/",
        "shopee_aff_id": "15385610012",
        "shopee_app_id": "",
        "shopee_secret": "",
        "lazada_tracking_id": "267671179",
        "lazada_referral_code": "AM86gKgj",
        "lazada_exlaz": "e_B7mvt0tli55sbdaDA0DvZOb5ctG2SI%252F1oCEiHEl%252FUv6VEqD9MYhqUaBZjUeQcq%252FEsHyU0g7Ue2BaQSn2j07SOpy%252BluXF85Cop2wKbp7jb3SMVF0silKVnV0eDLXAhVqJ0%252F%252BjTUiUr75fykH4ULsnb5jPvKUp8JpoyrI0XKdux4HApXygm91QTIosaAsYiMVgksbiVaOKUnAW%252FECuMLE35Q%253D%253D",
        "lazada_share_info": "4161151791_1_9300_110172189818_4161153791_null",
        "lazada_token": "08d572ad001a0d070782467eba3d16d9",
    }
    if cfg_path.exists():
        try:
            loaded = json.loads(cfg_path.read_text(encoding="utf-8"))
            default_cfg.update(loaded)
        except Exception:
            pass
    return default_cfg


def extract_all_products_from_index(index_path: Path) -> list[dict]:
    """
    ดึงรายชื่อสินค้าครบทั้ง 32 หมวด (351 รุ่น) จาก index.html โดยอัตโนมัติ
    """
    if not index_path.exists():
        return []

    html = index_path.read_text(encoding="utf-8")
    cat_match = re.search(r"const CATEGORIES = (\[[\s\S]*?\n\s*\]);", html)
    if cat_match:
        try:
            categories = json.loads(cat_match.group(1))
            items = []
            seen = set()
            for cat in categories:
                cid = cat.get("id", "smartphone")
                for p in cat.get("products", []):
                    pid = p.get("id")
                    if not pid or pid in seen:
                        continue
                    seen.add(pid)
                    items.append({
                        "id": pid,
                        "category_id": cid,
                        "tier": p.get("tier", "mid"),
                        "bracketLabel": p.get("bracketLabel", ""),
                        "name": p.get("name", ""),
                        "base_price": int(round(float(p.get("price") or 0))),
                        "img": p.get("img", ""),
                    })
            if items:
                return items
        except Exception:
            pass

    pattern = re.compile(
        r"id:\s*'([^']+)',\s*tier:\s*'([^']+)',\s*bracketLabel:\s*'([^']+)',[\s\S]*?"
        r"name:\s*(?:'([^']+)'|\"([^\"]+)\"),[\s\S]*?price:\s*(\d+)",
        re.MULTILINE,
    )
    items = []
    seen = set()
    for match in pattern.finditer(html):
        pid, tier, bracket, name_sq, name_dq, price_str = match.groups()
        name = name_sq or name_dq
        if pid in seen:
            continue
        seen.add(pid)
        items.append({
            "id": pid,
            "tier": tier,
            "bracketLabel": bracket,
            "name": name,
            "base_price": int(price_str),
        })
    return items


def fetch_shopee_affiliate_offer(keyword: str, app_id: str, secret: str) -> dict | None:
    """
    เชื่อมต่อ Shopee Affiliate Open API (GraphQL) ของจริงเมื่อได้รับสิทธิ์ Open API
    """
    if not app_id or not secret:
        return None

    timestamp = int(time.time())
    query = """
    query($keyword: String!) {
      productOfferV2(keyword: $keyword, sortType: 2, limit: 1) {
        nodes {
          itemId
          productName
          priceMin
          priceMax
          priceDiscountRate
          commissionRate
          offerLink
          shopName
        }
      }
    }
    """
    payload_str = json.dumps({"query": query, "variables": {"keyword": keyword}}, separators=(",", ":"))
    signature_raw = f"{app_id}{timestamp}{payload_str}{secret}"
    signature = hashlib.sha256(signature_raw.encode("utf-8")).hexdigest()

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"SHA256 Credential={app_id}, Timestamp={timestamp}, Signature={signature}",
    }

    req = urllib.request.Request(
        SHOPEE_GRAPHQL_ENDPOINT,
        data=payload_str.encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            nodes = data.get("data", {}).get("productOfferV2", {}).get("nodes", [])
            if nodes:
                return nodes[0]
    except Exception as exc:
        print(f"⚠️ Shopee API Warning ({keyword}): {exc}", file=sys.stderr)
    return None


def run_daily_price_sync(silent: bool = False, base_dir: Path | None = None) -> dict:
    """Rebuild the evidence feed without inventing prices or refreshing observations.

    API keyword search is discovery only: it cannot establish the exact variant.
    Until account access/schema is tested, manual observations are authoritative.
    """
    start = time.monotonic()
    base_dir = Path(base_dir) if base_dir else Path(__file__).parent
    data_dir = base_dir / 'data'
    feed = read_json(data_dir / 'daily_prices_feed.json', {'items_by_id': {}})
    items = feed.get('items_by_id', {})
    for model in extract_all_products_from_index(base_dir / 'index.html'):
        items.setdefault(model['id'], {'id': model['id'], 'name': model['name'],
                                      'category_id': model.get('category_id'), 'stores_sorted': []})
    for pid, ov in read_json(data_dir / 'manual_overrides.json', {}).items():
        if pid in items and ov.get('schema_version') == 2:
            items[pid].update(ov)
    payload = rebuild_feed({'items_by_id': items})
    payload['elapsed_seconds'] = round(time.monotonic() - start, 3)
    write_json(data_dir / 'daily_prices_feed.json', payload)
    if not silent:
        print(f"Rebuilt {payload['total_models_synced']} products; {payload['verified_offers']} eligible offers. Observations were not refreshed.")
    return payload


def update_affiliate_credentials(new_vals: dict) -> str:
    base_dir = Path(__file__).parent
    cfg_path = base_dir / "data" / "affiliate_config.json"
    cfg = load_affiliate_config(base_dir)
    for k in ("shopee_aff_id", "shopee_app_id", "shopee_secret", "lazada_tracking_id"):
        if k in new_vals and new_vals[k] is not None:
            cfg[k] = str(new_vals[k]).strip()
    cfg["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")

    secret_map = {
        "shopee_aff_id": "SHOPEE_AFF_ID",
        "shopee_app_id": "SHOPEE_APP_ID",
        "shopee_secret": "SHOPEE_SECRET",
        "lazada_tracking_id": "LAZADA_TRACKING_ID",
    }
    for field, gh_secret in secret_map.items():
        val = cfg.get(field, "")
        if val:
            try:
                subprocess.run(
                    ["gh", "secret", "set", gh_secret, "--body", val],
                    cwd=str(base_dir),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=8,
                )
            except Exception:
                pass

    data = run_daily_price_sync(silent=True)
    return f"บันทึกค่าตั้งค่าและประเมินหลักฐานเดิม {data['total_models_synced']} รุ่นแล้ว (ยังไม่ทดสอบสิทธิ์ API) (โหมด: {data['sync_mode']})"


def run_mcp_stdio_server():
    base_dir = Path(__file__).parent
    feed_path = base_dir / "data" / "daily_prices_feed.json"

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue

        req_id = req.get("id")
        method = req.get("method", "")

        if method == "initialize":
            resp = {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "yespec-price-mcp", "version": "1.0.0"},
                },
            }
        elif method == "tools/list":
            resp = {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "tools": [
                        {
                            "name": "sync_all_prices",
                            "description": "ตรวจความสดและสร้าง feed จากข้อมูลที่บันทึกหลักฐานไว้",
                            "inputSchema": {"type": "object", "properties": {}},
                        },
                        {
                            "name": "get_product_price",
                            "description": "ค้นหาราคาและลิงก์ร้านค้า Shopee / Lazada ที่ถูกที่สุดของสินค้าตาม ID หรือชื่อรุ่น",
                            "inputSchema": {
                                "type": "object",
                                "properties": {"query": {"type": "string", "description": "ID หรือชื่อรุ่นสินค้า"}},
                                "required": ["query"],
                            },
                        },
                        {
                            "name": "update_product_price",
                            "description": "อัปเดตราคาของสินค้ารุ่นที่ต้องการใน daily_prices_feed.json ทันที",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "product_id": {"type": "string"},
                                    "new_price": {"type": "integer"},
                                },
                                "required": ["product_id", "new_price"],
                            },
                        },
                        {
                            "name": "set_affiliate_credentials",
                            "description": "ตั้งค่า Shopee Affiliate ID, Lazada Tracking ID และ Shopee Open API Keys แล้วอัปเดตลิงก์ทันที",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "shopee_aff_id": {"type": "string"},
                                    "shopee_app_id": {"type": "string"},
                                    "shopee_secret": {"type": "string"},
                                    "lazada_tracking_id": {"type": "string"},
                                },
                            },
                        },
                    ]
                },
            }
        elif method == "tools/call":
            params = req.get("params", {})
            tname = params.get("name")
            args = params.get("arguments", {})

            if tname == "sync_all_prices":
                data = run_daily_price_sync(silent=True)
                text = f"สร้าง feed จากหลักฐานที่มี {data['total_models_synced']} รุ่น ใน {data['elapsed_seconds']} วินาที (โหมด: {data['sync_mode']})"
            elif tname == "get_product_price":
                q = str(args.get("query", "")).lower()
                if not feed_path.exists():
                    run_daily_price_sync(silent=True)
                feed = rebuild_feed(read_json(feed_path, {"items_by_id": {}}))
                matches = [
                    it for it in feed.get("items", [])
                    if q in it["id"].lower() or q in it["name"].lower()
                ][:5]
                text = json.dumps(matches, ensure_ascii=False, indent=2)
            elif tname == "update_product_price":
                # A naked number has no listing, variant or observation evidence.
                text = "กรุณาบันทึกผ่าน Admin พร้อมแพลตฟอร์ม หน้าสินค้า ตัวเลือก และยืนยันเวลาตรวจราคา"
            elif tname == "set_affiliate_credentials":
                text = update_affiliate_credentials(args)
            else:
                text = f"ไม่รู้จักคำสั่ง {tname}"

            resp = {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"content": [{"type": "text", "text": text}]},
            }
        else:
            continue

        sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if "--mcp" in sys.argv:
        run_mcp_stdio_server()
    else:
        run_daily_price_sync()
