#!/usr/bin/env python3
"""
yesspec — Programmatic SEO & Multi-Store Price Radar Engine
--------------------------------------------------------------------------------
อ่านข้อมูลจาก data/products.json (แอร์, ทีวี, ตู้เย็น, iPhone 18 Pro vs 17 Pro) แล้วสร้างหน้าเว็บ SEO อัตโนมัติ:
1. หน้าเปรียบเทียบหมัดต่อหมัด พร้อมรูปสินค้า Studio Render และคำแนะนำฟันธง
2. ตารางเรดาร์เปรียบเทียบราคาทุกช่องทาง
3. หน้าจัดอันดับประจำปี (Best Category Ranking Pages) พร้อมรูปสินค้าทุกชิ้น
4. ฝัง Affiliate Sub-ID อัตโนมัติทุกช่องทาง + Schema.org JSON-LD + sitemap.xml
"""

import itertools
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "data" / "products.json"
DIST_DIR = BASE_DIR / "dist"


def build_affiliate_url(raw_url: str, platform: str, config: dict, sub_id: str) -> str:
    parsed = urlparse(raw_url)
    query = dict(parse_qsl(parsed.query))
    query["utm_source"] = "yesspec_seo"
    query["utm_medium"] = "affiliate"
    query["sub_id"] = sub_id
    if platform == "shopee":
        query["af_siteid"] = config.get("shopee_affiliate_id", "")
    elif platform == "lazada":
        query["laz_trackid"] = config.get("lazada_affiliate_id", "")
    elif platform == "tiktok":
        query["tt_aff_id"] = config.get("tiktok_affiliate_id", "")
    elif platform == "involve":
        query["ia_aff_id"] = config.get("involve_asia_id", "")
    else:
        query["at_aff_id"] = config.get("accesstrade_id", "")
    return urlunparse(parsed._replace(query=urlencode(query)))


def get_min_price(prod: dict) -> int:
    return min(o["price"] for o in prod["offers"])


def compare_specs(prod_a: dict, prod_b: dict, spec_labels: dict) -> list:
    results = []
    lower_is_better = {"weight_grams", "yearly_elec_baht", "noise_db"}
    for key, label in spec_labels.items():
        val_a = prod_a["specs"].get(key, 0)
        val_b = prod_b["specs"].get(key, 0)
        if key in lower_is_better:
            winner = "a" if val_a < val_b else ("b" if val_b < val_a else "tie")
        else:
            winner = "a" if val_a > val_b else ("b" if val_b > val_a else "tie")
        results.append({
            "key": key,
            "label": label,
            "val_a": val_a,
            "val_b": val_b,
            "winner": winner,
        })
    return results


YESSPEC_INLINE_LOGO = """<span style="display:inline-flex;align-items:center;gap:8px;"><svg width="24" height="24" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="border-radius:6px;flex-shrink:0;"><rect width="36" height="36" rx="9" fill="#0071e3"/><line x1="9" y1="12" x2="27" y2="12" stroke="white" stroke-opacity="0.35" stroke-width="2.2" stroke-linecap="round"/><line x1="9" y1="12" x2="21" y2="12" stroke="white" stroke-width="2.2" stroke-linecap="round"/><circle cx="21" cy="12" r="3" fill="white"/><line x1="9" y1="18.5" x2="27" y2="18.5" stroke="white" stroke-opacity="0.35" stroke-width="2.2" stroke-linecap="round"/><line x1="9" y1="18.5" x2="14" y2="18.5" stroke="white" stroke-width="2.2" stroke-linecap="round"/><circle cx="14" cy="18.5" r="3" fill="#7cc4ff"/><line x1="9" y1="25" x2="27" y2="25" stroke="white" stroke-opacity="0.35" stroke-width="2.2" stroke-linecap="round"/><line x1="9" y1="25" x2="24" y2="25" stroke="#4ade80" stroke-width="2.2" stroke-linecap="round"/><circle cx="24" cy="25" r="4" fill="#34d399"/></svg><span>yesspec</span></span>"""


SHARED_CSS = """
  :root {
    --bg: #f5f5f7;
    --card: #ffffff;
    --text: #1d1d1f;
    --muted: #6e6e73;
    --line: rgba(0, 0, 0, 0.08);
    --blue: #0071e3;
    --green: #137333;
    --green-bg: #e6f4ea;
  }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Sukhumvit Set", "Kanit", sans-serif; }
  body { margin: 0; background: var(--bg); color: var(--text); line-height: 1.62; -webkit-font-smoothing: antialiased; }
  .nav {
    position: sticky; top: 0; z-index: 50;
    background: rgba(251, 251, 253, 0.84); backdrop-filter: saturate(180%) blur(20px);
    border-bottom: 1px solid var(--line); padding: 14px 24px;
  }
  .nav-inner { max-width: 1060px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; }
  .nav a { color: var(--blue); text-decoration: none; font-weight: 600; font-size: 0.92rem; }
  .container { max-width: 1060px; margin: 0 auto; padding: 44px 20px 80px; }
  .eyebrow { color: var(--blue); font-weight: 700; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
  h1 { font-size: clamp(1.85rem, 3.6vw, 2.75rem); letter-spacing: -0.025em; line-height: 1.18; margin: 0 0 12px; }
  .subtitle { color: var(--muted); font-size: 1.06rem; max-width: 780px; margin-bottom: 32px; }
  .bento-verdict {
    background: var(--card); border-radius: 24px; padding: 28px 32px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.04); border: 1px solid var(--line); margin-bottom: 32px;
  }
  .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 24px; margin-bottom: 36px; }
  .card {
    background: var(--card); border-radius: 24px; padding: 28px;
    box-shadow: 0 8px 26px rgba(0,0,0,0.04); border: 1px solid var(--line);
  }
  .prod-img-stage {
    background: #f5f5f7; border-radius: 20px; padding: 20px; margin-bottom: 18px;
    display: flex; align-items: center; justify-content: center; height: 240px; overflow: hidden;
  }
  .prod-img-stage img {
    max-width: 100%; max-height: 210px; object-fit: contain;
    transition: transform 0.3s ease;
  }
  .prod-img-stage:hover img { transform: scale(1.04); }
  .award-pill {
    display: inline-block; background: #f5f5f7; color: #1d1d1f; font-size: 0.78rem;
    font-weight: 700; padding: 5px 12px; border-radius: 99px; margin-bottom: 10px;
  }
  .why-box {
    background: #f0f7ff; border-left: 4px solid var(--blue); padding: 14px 16px;
    border-radius: 12px; font-size: 0.9rem; margin: 14px 0; color: #1d1d1f;
  }
  .flights-table {
    margin-top: 16px; border: 1px solid var(--line); border-radius: 16px; overflow: hidden;
  }
  .flight-row {
    display: flex; justify-content: space-between; align-items: center; gap: 10px;
    padding: 12px 16px; border-bottom: 1px solid var(--line); background: #fff;
    text-decoration: none; color: var(--text); transition: background 0.15s;
  }
  .flight-row:last-child { border-bottom: none; }
  .flight-row:hover { background: #f8fafc; }
  .flight-row.cheapest { background: #f4fbf7; }
  .cheapest-pill {
    background: var(--green-bg); color: var(--green); font-size: 0.72rem;
    font-weight: 800; padding: 2px 8px; border-radius: 99px; margin-left: 6px;
  }
  .go-btn {
    background: var(--blue); color: #fff; font-weight: 700; font-size: 0.82rem;
    padding: 7px 14px; border-radius: 99px; white-space: nowrap;
  }
  table {
    width: 100%; border-collapse: collapse; background: var(--card);
    border-radius: 24px; overflow: hidden; box-shadow: 0 8px 26px rgba(0,0,0,0.04); border: 1px solid var(--line);
  }
  th, td { padding: 16px 20px; border-bottom: 1px solid var(--line); text-align: left; }
  th { background: #fbfbfd; color: var(--muted); font-size: 0.88rem; font-weight: 700; }
  .winner-cell { background: rgba(19, 115, 51, 0.07); color: var(--green); font-weight: 700; }
  .win-badge {
    background: var(--green-bg); color: var(--green);
    font-size: 0.72rem; padding: 2px 9px; border-radius: 99px; font-weight: 800; margin-left: 8px;
  }
"""


def render_flights_offers_html(prod: dict, config: dict, sub_prefix: str) -> str:
    sorted_offers = sorted(prod["offers"], key=lambda x: x["price"])
    rows = ""
    for idx, off in enumerate(sorted_offers):
        is_cheapest = idx == 0
        aff_url = build_affiliate_url(off["url"], off["platform"], config, f"{sub_prefix}_{off['platform']}")
        cheapest_badge = '<span class="cheapest-pill">ถูกที่สุด #1</span>' if is_cheapest else ""
        rows += f"""
        <a class="flight-row {'cheapest' if is_cheapest else ''}" href="{aff_url}" target="_blank" rel="nofollow sponsored">
          <div>
            <strong>{off['store']}</strong> <span style="font-size:0.8rem;color:var(--muted);">({off['seller']})</span>{cheapest_badge}<br>
            <span style="font-size:0.78rem;color:#137333;font-weight:600;">{off['coupon_text']}</span> •
            <span style="font-size:0.78rem;color:var(--muted);">{off['perks']}</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="text-align:right;">
              <div style="font-size:1.15rem;font-weight:800;color:{'#137333' if is_cheapest else '#1d1d1f'};">฿{off['price']:,}</div>
              <div style="font-size:0.72rem;color:var(--muted);">{off['delivery']}</div>
            </div>
            <span class="go-btn">ไปที่ร้าน ➔</span>
          </div>
        </a>"""
    return f'<div class="flights-table">{rows}</div>'


def render_vs_page(prod_a: dict, prod_b: dict, category: dict, config: dict) -> tuple[str, dict]:
    slug = f"{prod_a['id']}-vs-{prod_b['id']}"
    sub_id = f"vs_{prod_a['id'][:8]}_{prod_b['id'][:8]}"
    spec_comparisons = compare_specs(prod_a, prod_b, category["spec_labels"])

    wins_a = sum(1 for s in spec_comparisons if s["winner"] == "a")
    wins_b = sum(1 for s in spec_comparisons if s["winner"] == "b")

    min_price_a = get_min_price(prod_a)
    min_price_b = get_min_price(prod_b)
    price_diff = abs(min_price_a - min_price_b)
    cheaper_prod = prod_a if min_price_a <= min_price_b else prod_b
    higher_score_prod = prod_a if prod_a["overall_score"] >= prod_b["overall_score"] else prod_b

    title = f"เปรียบเทียบ {prod_a['name']} vs {prod_b['name']} ซื้อรุ่นไหนดี? ฟันธงตัวไหนดีกว่าเพราะอะไร (2026)"
    description = (
        f"เทียบละเอียด {prod_a['name']} กับ {prod_b['name']} อันไหนดีกว่ากันเพราะอะไร "
        f"พร้อมตารางเรดาร์เช็คราคาถูกสุดทุกช่องทาง ส่วนต่าง {price_diff:,} บาท"
    )

    faq_schema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": f"ระหว่าง {prod_a['name']} กับ {prod_b['name']} แนะนำให้ซื้ออันไหนดีกว่าเพราะอะไร?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": (
                        f"แนะนำ {higher_score_prod['name']} (คะแนน {higher_score_prod['overall_score']}/10) หากเน้นคุณภาพสูงสุดเพราะ {higher_score_prod['why_better']} "
                        f"แต่หากเน้นความคุ้มค่าประหยัดงบ แนะนำ {cheaper_prod['name']} เพราะราคาถูกกว่า {price_diff:,} บาท"
                    ),
                },
            }
        ],
    }

    rows_html = ""
    for item in spec_comparisons:
        badge_a = '<span class="win-badge">ดีกว่า</span>' if item["winner"] == "a" else ""
        badge_b = '<span class="win-badge">ดีกว่า</span>' if item["winner"] == "b" else ""
        cls_a = "winner-cell" if item["winner"] == "a" else ""
        cls_b = "winner-cell" if item["winner"] == "b" else ""
        rows_html += f"""
        <tr>
          <td>{item['label']}</td>
          <td class="{cls_a}">{item['val_a']:,} {badge_a}</td>
          <td class="{cls_b}">{item['val_b']:,} {badge_b}</td>
        </tr>"""

    offers_a_html = render_flights_offers_html(prod_a, config, f"{sub_id}_a")
    offers_b_html = render_flights_offers_html(prod_b, config, f"{sub_id}_b")

    html = f"""<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <script type="application/ld+json">{json.dumps(faq_schema, ensure_ascii=False)}</script>
  <style>{SHARED_CSS}</style>
</head>
<body>
  <nav class="nav">
    <div class="nav-inner">
      <strong>{YESSPEC_INLINE_LOGO} <span style="font-weight:400;color:var(--muted);margin-left:6px;">Editorial & Price Radar</span></strong>
      <a href="../index.html">← กลับหน้าหลัก yesspec</a>
    </div>
  </nav>
  <div class="container">
    <div class="eyebrow">{category['full_name']} • IN-DEPTH COMPARISON</div>
    <h1>{prod_a['name']} <span style="color:var(--muted);font-weight:400;">vs</span> {prod_b['name']}</h1>
    <p class="subtitle">{description}</p>

    <div class="bento-verdict">
      <div class="eyebrow" style="margin-bottom:4px;">EXPERT RECOMMENDATION • คำแนะนำฟันธงว่าควรซื้ออันไหน</div>
      <h3 style="margin:0 0 12px;font-size:1.35rem;">สรุปฟันธง: อันไหนดีกว่า และเพราะอะไร?</h3>
      <p style="margin:0 0 10px;">🏆 <strong>ผู้ชนะคะแนนภาพรวม ({higher_score_prod['name']} — {higher_score_prod['overall_score']}/10):</strong> {higher_score_prod['why_better']}</p>
      <p style="margin:0 0 10px;">💰 <strong>ทางเลือกคุ้มค่าประหยัดงบ ({cheaper_prod['name']}):</strong> เริ่มต้นเพียง <strong>฿{min(min_price_a, min_price_b):,}</strong> ประหยัดเงินในกระเป๋าได้ทันที <strong>฿{price_diff:,}</strong></p>
      <ul style="margin:10px 0 0;padding-left:20px;color:#333;">
        <li><strong>ควรซื้อ {prod_a['name']} ถ้าคุณเน้น:</strong> {', '.join(prod_a['best_for'])} (ชนะสเปก {wins_a} หัวข้อ)</li>
        <li><strong>ควรซื้อ {prod_b['name']} ถ้าคุณเน้น:</strong> {', '.join(prod_b['best_for'])} (ชนะสเปก {wins_b} หัวข้อ)</li>
      </ul>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="prod-img-stage">
          <img src="../assets/products/{prod_a['id']}.png" alt="{prod_a['name']}" loading="lazy">
        </div>
        <span class="award-pill">🏆 {prod_a['award']}</span>
        <h2 style="margin:4px 0;">{prod_a['name']}</h2>
        <p style="color:var(--muted);font-size:0.92rem;margin-top:4px;">{prod_a['tagline']}</p>
        <div class="why-box"><strong>ทำไมรุ่นนี้ถึงดีกว่า:</strong> {prod_a['why_better']}</div>
        <h4 style="margin:16px 0 8px;font-size:0.92rem;">✈️ เปรียบเทียบราคาทุกช่องทาง (เรียงจากถูกที่สุด):</h4>
        {offers_a_html}
      </div>

      <div class="card">
        <div class="prod-img-stage">
          <img src="../assets/products/{prod_b['id']}.png" alt="{prod_b['name']}" loading="lazy">
        </div>
        <span class="award-pill">🏆 {prod_b['award']}</span>
        <h2 style="margin:4px 0;">{prod_b['name']}</h2>
        <p style="color:var(--muted);font-size:0.92rem;margin-top:4px;">{prod_b['tagline']}</p>
        <div class="why-box"><strong>ทำไมรุ่นนี้ถึงดีกว่า:</strong> {prod_b['why_better']}</div>
        <h4 style="margin:16px 0 8px;font-size:0.92rem;">✈️ เปรียบเทียบราคาทุกช่องทาง (เรียงจากถูกที่สุด):</h4>
        {offers_b_html}
      </div>
    </div>

    <h2 style="margin-bottom:16px;letter-spacing:-0.02em;">ตารางผ่าสเปกเปรียบเทียบละเอียด</h2>
    <table>
      <thead>
        <tr>
          <th>หัวข้อการเปรียบเทียบ</th>
          <th>{prod_a['name']}</th>
          <th>{prod_b['name']}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>คะแนนรวม yesspec Score</td>
          <td class="{'winner-cell' if prod_a['overall_score'] >= prod_b['overall_score'] else ''}">{prod_a['overall_score']} / 10</td>
          <td class="{'winner-cell' if prod_b['overall_score'] > prod_a['overall_score'] else ''}">{prod_b['overall_score']} / 10</td>
        </tr>
        {rows_html}
        <tr>
          <td>ราคาสุทธิถูกสุดวันนี้</td>
          <td class="{'winner-cell' if min_price_a <= min_price_b else ''}">฿{min_price_a:,}</td>
          <td class="{'winner-cell' if min_price_b < min_price_a else ''}">฿{min_price_b:,}</td>
        </tr>
      </tbody>
    </table>
  </div>
</body>
</html>"""

    avg_comm = int((min_price_a * prod_a["commission_pct"] / 100 + min_price_b * prod_b["commission_pct"] / 100) / 2)
    meta = {
        "type": "vs_comparison",
        "slug": f"{slug}.html",
        "title": title,
        "category": category["name"],
        "target_keyword": f"{prod_a['name']} vs {prod_b['name']}",
        "sub_id": sub_id,
        "est_commission_baht": avg_comm,
    }
    return html, meta


def render_category_ranking_page(products: list, category: dict, config: dict) -> tuple[str, dict]:
    slug = f"best-{category['slug']}-2026"
    sub_id = f"rank_{category['slug']}"
    title = f"จัดอันดับ {category['full_name']} รุ่นไหนดี ปี 2026 ฟันธงตัวไหนคุ้มสุด"
    description = f"รีวิวเปรียบเทียบ {category['full_name']} แนะนำว่าควรซื้อรุ่นไหนเพราะอะไร พร้อมตารางเรดาร์เช็คราคาถูกสุดทุกช่องทาง"

    guide = category.get("expert_buying_guide", {})
    cards_html = ""
    for p in sorted(products, key=lambda x: x["rank"]):
        offers_html = render_flights_offers_html(p, config, f"{sub_id}_{p['rank']}")
        cards_html += f"""
        <div class="card" style="margin-bottom:24px;">
          <div class="prod-img-stage">
            <img src="../assets/products/{p['id']}.png" alt="{p['name']}" loading="lazy">
          </div>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
            <div>
              <span class="award-pill">อันดับ #{p['rank']} • {p['award']}</span>
              <h2 style="margin:4px 0;">{p['name']}</h2>
              <p style="margin:0;color:var(--muted);">{p['tagline']}</p>
            </div>
            <div style="text-align:right;">
              <div style="font-size:0.78rem;color:var(--muted);font-weight:700;">YESSPEC SCORE</div>
              <div style="font-size:1.8rem;font-weight:800;color:var(--blue);">{p['overall_score']}<span style="font-size:0.95rem;color:var(--muted);">/10</span></div>
            </div>
          </div>
          <div class="why-box"><strong>💡 ทำไมเราแนะนำรุ่นนี้ (ดีกว่าเพราะอะไร):</strong> {p['why_better']}</div>
          <p style="font-size:0.92rem;"><strong>เหมาะสำหรับ:</strong> {', '.join(p['best_for'])}</p>
          <ul style="padding-left:18px;font-size:0.92rem;">{''.join(f'<li>{pro}</li>' for pro in p['pros'])}</ul>
          <h4 style="margin:16px 0 8px;font-size:0.92rem;">✈️ เช็คราคาถูกสุดทุกช่องทาง (เรียงจากถูกไปแพง):</h4>
          {offers_html}
        </div>"""

    html = f"""<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <style>{SHARED_CSS}</style>
</head>
<body>
  <nav class="nav">
    <div class="nav-inner">
      <strong>{YESSPEC_INLINE_LOGO} <span style="font-weight:400;color:var(--muted);margin-left:6px;">Buying Guide 2026</span></strong>
      <a href="../index.html">← กลับหน้าหลัก yesspec</a>
    </div>
  </nav>
  <div class="container">
    <div class="eyebrow">BUYING GUIDE • จัดอันดับและฟันธงประจำปี 2026</div>
    <h1>{title}</h1>
    <p class="subtitle">{description}</p>
    <div class="bento-verdict">
      <div class="eyebrow">EXPERT SUMMARY • สรุปโพยเลือกซื้อใน 1 นาที</div>
      <h3 style="margin:4px 0 12px;">{guide.get('summary_headline', '')}</h3>
      <p style="margin:0 0 8px;">🥇 <strong>แนะนำอันดับ 1 ({guide.get('best_overall_pick', '')}):</strong> {guide.get('best_overall_reason', '')}</p>
      <p style="margin:0;">💎 <strong>ทางเลือกสุดคุ้ม ({guide.get('best_value_pick', '')}):</strong> {guide.get('best_value_reason', '')}</p>
    </div>
    {cards_html}
  </div>
</body>
</html>"""

    avg_comm = int(sum(get_min_price(p) * p["commission_pct"] / 100 for p in products) / len(products))
    meta = {
        "type": "category_ranking",
        "slug": f"{slug}.html",
        "title": title,
        "category": category["name"],
        "target_keyword": f"แนะนำ {category['name']} รุ่นไหนดี 2026",
        "sub_id": sub_id,
        "est_commission_baht": avg_comm,
    }
    return html, meta


def main():
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    config = data["affiliate_config"]
    categories = {c["id"]: c for c in data["categories"]}
    products = data["products"]

    manifest = []
    by_category = {}
    for p in products:
        by_category.setdefault(p["category_id"], []).append(p)

    for cat_id, cat_prods in by_category.items():
        cat = categories[cat_id]
        rank_html, rank_meta = render_category_ranking_page(cat_prods, cat, config)
        (DIST_DIR / rank_meta["slug"]).write_text(rank_html, encoding="utf-8")
        manifest.append(rank_meta)

        for prod_a, prod_b in itertools.combinations(cat_prods, 2):
            vs_html, vs_meta = render_vs_page(prod_a, prod_b, cat, config)
            (DIST_DIR / vs_meta["slug"]).write_text(vs_html, encoding="utf-8")
            manifest.append(vs_meta)

    today = datetime.now().strftime("%Y-%m-%d")
    sitemap_urls = "\n".join(
        f"  <url>\n    <loc>{config['domain']}/dist/{m['slug']}</loc>\n    <lastmod>{today}</lastmod>\n    <priority>0.8</priority>\n  </url>"
        for m in manifest
    )
    sitemap_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{sitemap_urls}
</urlset>"""
    (DIST_DIR / "sitemap.xml").write_text(sitemap_xml, encoding="utf-8")

    manifest_summary = {
        "generated_at": datetime.now().isoformat(),
        "total_products": len(products),
        "total_seo_pages_generated": len(manifest),
        "pages": manifest,
    }
    (DIST_DIR / "seo_manifest.json").write_text(
        json.dumps(manifest_summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"✅ สร้างหน้าเว็บ yesspec + รูปสินค้า + Price Radar สำเร็จทั้งหมด {len(manifest)} หน้า!")


if __name__ == "__main__":
    main()

