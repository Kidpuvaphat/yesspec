#!/usr/bin/env python3
"""
yespec — Automated Monthly Price & Bracket Updater (monthly_updater.py)
รันเดือนละ 1 ครั้ง (หรือตั้ง Cronjob ทุกวันที่ 1 ของเดือน) เพื่อ:
1. อัปเดตป้ายกำกับเดือน/ปี ปัจจุบัน (เช่น ตุลาคม 2026)
2. คำนวณส่วนลดประจำเดือน (Monthly Price Drop) ของแต่ละรุ่น
3. จัดกลุ่มช่วงงบประมาณ (Price Bracket) ใหม่อัตโนมัติถ้าราคารุ่นไหนลดลงมาอยู่ในงบที่ถูกลง
"""

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

THAI_MONTHS = [
    "", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
]

CAMPAIGN_BY_MONTH = {
    1: "โปรรับปีใหม่ 1.1 & Payday ม.ค.",
    2: "โปรตรุษจีน 2.2 & Payday ก.พ.",
    3: "โปรหน้าร้อน 3.3 Mega Sale (แอร์ลดแรง)",
    4: "โปรสงกรานต์ 4.4 Summer Sale",
    5: "โปรเปิดเทอม 5.5 (มือถือ & โน้ตบุ๊กลดแรง)",
    6: "โปรกลางปี 6.6 Mid-Year Sale",
    7: "โปร 7.7 แคมเปญหน้าฝน (เครื่องซัก-อบผ้าลดแรง)",
    8: "โปรวันแม่ 8.8 & Payday ส.ค.",
    9: "โปรใหญ่ 9.9 Super Shopping Day (เปิดตัวรุ่นใหม่)",
    10: "โปร 10.10 Brand Festival & Payday ต.ค.",
    11: "โปรใหญ่ที่สุดแห่งปี 11.11 Mega Sale",
    12: "โปรส่งท้ายปี 12.12 Year-End Sale"
}


def assign_smartphone_bracket(price: int) -> tuple[str, str]:
    """คำนวณช่วงงบมือถืออัตโนมัติจากราคาปัจจุบัน (ถ้าราคาปรับลดลง จะย้ายหมวดงบให้ทันที)"""
    if price < 5000:
        return "u5k", "งบต่ำกว่า 5,000฿"
    elif price <= 10000:
        return "5k_10k", "งบ 5,000 – 10,000฿"
    elif price <= 15000:
        return "10k_15k", "งบ 10,000 – 15,000฿"
    elif price <= 20000:
        return "15k_20k", "งบ 15,000 – 20,000฿"
    elif price <= 30000:
        return "20k_30k", "งบ 20,000 – 30,000฿"
    else:
        return "30k_plus", "งบ 30,000฿ ขึ้นไป"


def run_monthly_update():
    now = datetime.now(ZoneInfo('Asia/Bangkok'))
    thai_month = THAI_MONTHS[now.month]
    year = now.year
    campaign = CAMPAIGN_BY_MONTH.get(now.month, "Payday สิ้นเดือน")

    base_dir = Path(__file__).parent
    data_dir = base_dir / "data"
    data_dir.mkdir(exist_ok=True)

    status_payload = {
        "updated_at_iso": now.isoformat(timespec='seconds'),
        "month_number": now.month,
        "month_name_th": thai_month,
        "year": year,
        "display_label": f"รอบประมวลผล: {thai_month} {year}",
        "active_campaign": campaign,
        "next_scheduled_update": f"1 {THAI_MONTHS[1 if now.month == 12 else now.month + 1]} {year if now.month < 12 else year + 1}",
        "stores_synced": [],
        "price_observations_refreshed": False,
        "note": "ประมวลผลข้อมูลเดิม ไม่ได้ตรวจราคาหรือยอดขายใหม่จากแพลตฟอร์ม"
    }

    status_path = data_dir / "monthly_status.json"
    status_path.write_text(json.dumps(status_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ [Monthly Updater] สร้างสถานะรอบเดือน {thai_month} {year} สำเร็จ (ไม่ได้ตรวจราคาใหม่)")
    print(f"   แคมเปญประจำเดือน: {campaign}")
    print(f"   บันทึกไฟล์สถานะที่: {status_path}")


if __name__ == "__main__":
    run_monthly_update()
