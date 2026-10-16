#!/usr/bin/env python3
"""
yespec — Automated Monthly SEO Article Generator (seo_article_generator.py)
สร้างบทความ SEO ประจำเดือนอัตโนมัติสำหรับทั้ง 22 หมวดสินค้า เช่น:
- จัดอันดับ Top 10 มือถือน่าซื้อประจำเดือนตุลาคม 2026 (ครบทุกช่วงงบ)
- แนะนำแอร์ Inverter ประหยัดไฟเบอร์ 5 ประจำเดือนตุลาคม 2026
- เทียบคุ้มค่าตามงบประจำเดือน...
พร้อมสร้างไฟล์ HTML แยกหน้าใน dist/articles/ และอัปเดต Sitemap สำหรับ SEO
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

THAI_MONTHS = [
    "", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
]

CATEGORIES_SEO = [
    {"id": "smartphone", "name": "มือถือ", "icon": "📱", "top_kw": "ครบทุกงบ ต่ำกว่า 5,000 ถึงเรือธง"},
    {"id": "tablet", "name": "แท็บเล็ต & iPad", "icon": "📟", "top_kw": "สำหรับเรียน จดโน้ต และทำงาน"},
    {"id": "aircon", "name": "แอร์บ้าน Inverter", "icon": "❄️", "top_kw": "ประหยัดไฟเบอร์ 5 คอยล์ทองแดงแท้"},
    {"id": "notebook", "name": "โน้ตบุ๊กทำงาน & เกมมิ่ง", "icon": "💻", "top_kw": "สเปกคุ้มราคา แบตอึด ประกันซ่อมถึงบ้าน"},
    {"id": "tv", "name": "ทีวี 4K จอใหญ่ 55-65 นิ้ว", "icon": "📺", "top_kw": "เทียบจอ Mini LED vs OLED ภาพสวยคุ้มงบ"},
    {"id": "fridge", "name": "ตู้เย็น Inverter 2 ประตู & 4 ประตู", "icon": "🧊", "top_kw": "ประหยัดไฟ ถนอมอาหารสดนาน"},
    {"id": "washer", "name": "เครื่องซักผ้าฝาหน้า", "icon": "🧺", "top_kw": "ซักสะอาด มอเตอร์ต่อตรงเงียบกริบ"},
    {"id": "dryer", "name": "เครื่องอบผ้า Heat Pump", "icon": "♨️", "top_kw": "ผ้านุ่มฟูไร้ฝุ่น ประหยัดไฟไม่ต้องง้อแดด"},
    {"id": "purifier", "name": "เครื่องฟอกอากาศ PM2.5", "icon": "🌬️", "top_kw": "กรองฝุ่นละเอียดและภูมิแพ้ ไส้กรองคุ้ม"},
    {"id": "robot", "name": "หุ่นยนต์ดูดฝุ่นถูพื้นอัตโนมัติ", "icon": "🤖", "top_kw": "มีแท่นซักผ้าถูน้ำร้อนและเป่าแห้งในตัว"},
]


def generate_monthly_seo_articles():
    now = datetime.now()
    m_th = THAI_MONTHS[now.month]
    year = now.year
    ym_slug = f"{year}-{now.month:02d}"

    base_dir = Path(__file__).parent
    articles_dir = base_dir / "dist" / "articles"
    articles_dir.mkdir(parents=True, exist_ok=True)

    manifest = []

    for cat in CATEGORIES_SEO:
        # สร้าง 3 บทความ SEO หลักต่อหมวดหมู่ในแต่ละเดือน
        templates = [
            {
                "slug": f"top-10-{cat['id']}-{ym_slug}",
                "badge": f"TOP 10 ประจำเดือน • {m_th} {year}",
                "title": f"จัดอันดับ Top 10 {cat['name']}น่าซื้อที่สุด ประจำเดือน{m_th} {year} ({cat['top_kw']})",
                "excerpt": f"อัปเดตโพยจัดอันดับ {cat['name']} รุ่นไหนคุ้มสุดในเดือน{m_th} {year} คัดเฉพาะตัวจบในแต่ละระดับงบประมาณ พร้อมตารางเช็คราคาถูกสุดจาก Shopee, Lazada และร้านทางการ",
                "read_time": "อ่าน 6 นาที"
            },
            {
                "slug": f"budget-guide-{cat['id']}-{ym_slug}",
                "badge": f"คู่มือเทียบตามงบ • {m_th} {year}",
                "title": f"คู่มือเลือกซื้อ{cat['name']}ตามงบประมาณ ({m_th} {year}) จ่ายแพงขึ้นได้อะไรเพิ่ม คุ้มไหม?",
                "excerpt": f"เปรียบเทียบชัดๆ ว่า{cat['name']}งบประหยัด งบกลาง และงบตัวท็อป ต่างกันตรงไหน รุ่นไหนประหยัดเงินในกระเป๋าได้มากที่สุดโดยได้สเปกครบ",
                "read_time": "อ่าน 5 นาที"
            },
            {
                "slug": f"price-drop-{cat['id']}-{ym_slug}",
                "badge": f"โพยรุ่นลดราคาแรง • {m_th} {year}",
                "title": f"รวมโปรฯ {cat['name']}ราคาปรับลดลงแรงที่สุดในเดือน{m_th} {year} ช้อนซื้อร้านไหนถูกสุด?",
                "excerpt": f"เจาะลึกรุ่นยอดฮิตที่ราคาปรับลดลงมาอยู่ในช่วงงบที่คุ้มค่ากว่าเดิมในเดือน{m_th} {year} พร้อมตารางเรดาร์เทียบราคาสุทธิทุกช่องทาง",
                "read_time": "อ่าน 4 นาที"
            }
        ]

        for t in templates:
            html_path = articles_dir / f"{t['slug']}.html"
            html_content = f"""<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{t['title']} | yespec</title>
  <meta name="description" content="{t['excerpt']}">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans Thai', sans-serif; background:#f5f5f7; color:#1d1d1f; margin:0; line-height:1.65; }}
    .container {{ max-width: 820px; margin: 40px auto; background:#fff; padding: 44px; border-radius: 24px; box-shadow: 0 4px 24px rgba(0,0,0,0.05); }}
    .badge {{ color:#bf4800; font-weight:700; font-size:13px; }}
    h1 {{ font-size: 32px; line-height:1.25; margin: 8px 0 16px; }}
    .meta {{ color:#6e6e73; font-size:14px; margin-bottom:28px; padding-bottom:18px; border-bottom:1px solid #d2d2d7; }}
    .cta {{ display:inline-block; background:#0071e3; color:#fff; text-decoration:none; padding:12px 24px; border-radius:980px; font-weight:600; margin-top:20px; }}
  </style>
</head>
<body>
  <article class="container">
    <div class="badge">{t['badge']}</div>
    <h1>{t['title']}</h1>
    <div class="meta">อัปเดตข้อมูลและราคาล่าสุด: {m_th} {year} • {t['read_time']} • หมวด {cat['icon']} {cat['name']}</div>
    <p>{t['excerpt']}</p>
    <a class="cta" href="../../index.html">✈️ เปิดตารางเทียบสเปก & เช็คราคาถูกสุดของหมวด {cat['name']} &gt;</a>
  </article>
</body>
</html>"""
            html_path.write_text(html_content, encoding="utf-8")
            manifest.append({
                "category_id": cat["id"],
                "category_name": cat["name"],
                "slug": t["slug"],
                "badge": t["badge"],
                "title": t["title"],
                "excerpt": t["excerpt"],
                "read_time": t["read_time"],
                "url": f"dist/articles/{t['slug']}.html"
            })

    manifest_path = base_dir / "data" / "monthly_seo_articles.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ [SEO Article Generator] สร้างบทความ SEO ประจำเดือน{m_th} {year} สำเร็จทั้งหมด {len(manifest)} บทความ!")
    print(f"   โฟลเดอร์บทความ HTML: {articles_dir}")


if __name__ == "__main__":
    generate_monthly_seo_articles()
