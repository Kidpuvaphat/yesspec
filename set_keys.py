#!/usr/bin/env python3
"""
yespec (Yespec.com) — 1-Click Shopee, Lazada & TikTok Shop Affiliate Key Installer
====================================================================================
ใช้สำหรับอัปเดต Affiliate ID (Shopee, Lazada & TikTok Shop)
และ Shopee Open API Key (App ID + Secret) พร้อมซิงค์ขึ้น GitHub Secrets อัตโนมัติ
"""

from price_sync_mcp import load_affiliate_config, update_affiliate_credentials
from pathlib import Path


def main():
    base_dir = Path(__file__).parent
    cfg = load_affiliate_config(base_dir)
    print("==========================================================")
    print("🚀 ตั้งค่า Shopee, Lazada & TikTok Shop สำหรับ yespec")
    print("   (กด Enter ข้ามช่องที่ยังไม่ต้องการเปลี่ยน)")
    print("==========================================================")

    shopee_aff = input(f"1. Shopee Affiliate ID [{cfg.get('shopee_aff_id')}]: ").strip()
    lazada_id = input(f"2. Lazada Tracking / Sub ID [{cfg.get('lazada_tracking_id')}]: ").strip()
    tiktok_id = input(f"3. TikTok Shop Affiliate ID [{cfg.get('tiktok_aff_id')}]: ").strip()
    shopee_app = input(f"4. Shopee Open API App ID [{cfg.get('shopee_app_id') or 'ยังไม่ได้ใส่'}]: ").strip()
    shopee_sec = input(f"5. Shopee Open API Secret [{'***' if cfg.get('shopee_secret') else 'ยังไม่ได้ใส่'}]: ").strip()

    updates = {}
    if shopee_aff:
        updates["shopee_aff_id"] = shopee_aff
    if lazada_id:
        updates["lazada_tracking_id"] = lazada_id
    if tiktok_id:
        updates["tiktok_aff_id"] = tiktok_id
    if shopee_app:
        updates["shopee_app_id"] = shopee_app
    if shopee_sec:
        updates["shopee_secret"] = shopee_sec

    msg = update_affiliate_credentials(updates)
    print("\n✅", msg)


if __name__ == "__main__":
    main()
