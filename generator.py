#!/usr/bin/env python3
"""
yespec — Programmatic SEO & Multi-Store Price Radar Engine
--------------------------------------------------------------------------------
อ่านข้อมูลจาก data/products.json (แอร์, ทีวี, ตู้เย็น, iPhone 18 Pro vs 17 Pro) แล้วสร้างหน้าเว็บ SEO อัตโนมัติ:
1. หน้าเปรียบเทียบหมัดต่อหมัด พร้อมรูปสินค้า Studio Render และคำแนะนำฟันธง
2. ตารางเรดาร์เปรียบเทียบราคาทุกช่องทาง
3. หน้าจัดอันดับประจำปี (Best Category Ranking Pages) พร้อมรูปสินค้าทุกชิ้น
4. แสดงลิงก์และราคาจาก feed ที่ตรวจสอบได้ พร้อม sitemap.xml
"""

import html as html_lib
import itertools
from market_data import normalize_store, valid_url
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "data" / "products.json"
DIST_DIR = BASE_DIR / "dist"


def build_affiliate_url(raw_url: str, platform: str, config: dict, sub_id: str) -> str:
    return valid_url(raw_url, platform) if platform in ('shopee', 'lazada') else ''


def get_min_price(prod: dict):
    stores = [normalize_store(s, s['platform']) for s in prod.get('market_stores', [])]
    return min((s['net_price'] for s in stores if s['ranking_eligible']), default=None)


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


YESPEC_INLINE_LOGO = """<span style="display:inline-flex;align-items:center;gap:8px;"><svg width="24" height="24" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="border-radius:6px;flex-shrink:0;"><rect width="36" height="36" rx="9" fill="#0071e3"/><line x1="9" y1="12" x2="27" y2="12" stroke="white" stroke-opacity="0.35" stroke-width="2.2" stroke-linecap="round"/><line x1="9" y1="12" x2="21" y2="12" stroke="white" stroke-width="2.2" stroke-linecap="round"/><circle cx="21" cy="12" r="3" fill="white"/><line x1="9" y1="18.5" x2="27" y2="18.5" stroke="white" stroke-opacity="0.35" stroke-width="2.2" stroke-linecap="round"/><line x1="9" y1="18.5" x2="14" y2="18.5" stroke="white" stroke-width="2.2" stroke-linecap="round"/><circle cx="14" cy="18.5" r="3" fill="#7cc4ff"/><line x1="9" y1="25" x2="27" y2="25" stroke="white" stroke-opacity="0.35" stroke-width="2.2" stroke-linecap="round"/><line x1="9" y1="25" x2="24" y2="25" stroke="#4ade80" stroke-width="2.2" stroke-linecap="round"/><circle cx="24" cy="25" r="4" fill="#34d399"/></svg><span>yespec</span></span>"""


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
    # Live feed fetched on page load; old static catalogue offers are never current evidence.
    pid = html_lib.escape(prod['id'], quote=True)
    name = html_lib.escape(prod['name'], quote=True)
    return f'<div class="flights-table" data-market-product="{pid}" data-name="{name}">รอตรวจราคา</div>'


MARKET_SCRIPT = """
<script src="../assets/affiliate-links.js?v=20261019-affiliate2"></script>
<script src="../assets/market-data.js?v=20261019-affiliate2"></script>
<script>
fetch('../data/daily_prices_feed.json', {cache: 'no-store'}).then(r => r.ok ? r.json() : null).then(feed => {
  document.querySelectorAll('[data-market-product]').forEach(el => {
    const product = {id: el.dataset.marketProduct, name: el.dataset.name};
    const offers = MarketData.offers(product, feed?.items_by_id?.[product.id]);
    el.replaceChildren();
    offers.forEach(o => {
      const a = document.createElement('a'); a.className = 'flight-row'; a.href = o.url;
      a.target = '_blank'; a.rel = 'noopener sponsored nofollow';
      a.textContent = o.store + ' — ' + (o.verified ? '฿' + o.netPrice.toLocaleString('th-TH') + (o.priceBasis === 'member' ? ' (ราคา VIP / สมาชิก)' : '') + ' • ตรวจ ' + new Date(o.observedAt).toLocaleString('th-TH') : 'รอตรวจราคา');
      el.appendChild(a);
    });
  });
}).catch(() => {});
</script>
"""


def _document(title, body, slug, config):
    canonical = html_lib.escape(config['domain'].rstrip('/') + '/dist/' + slug + '.html', quote=True)
    return f'''<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html_lib.escape(title)} | yespec</title><link rel="canonical" href="{canonical}"><style>{SHARED_CSS}</style></head><body><nav class="nav"><div class="nav-inner"><a href="../index.html">{YESPEC_INLINE_LOGO}</a></div></nav><main class="container"><h1>{html_lib.escape(title)}</h1><p class="subtitle">ข้อมูลสเปกประกอบการเลือกซื้อ • ราคาแสดงเมื่อมีหลักฐานตรงตัวเลือกภายใน 48 ชั่วโมง ไม่รวมค่าส่งและคูปองเฉพาะบุคคล</p>{body}</main>{MARKET_SCRIPT}</body></html>'''


def _card(product, category, config):
    rows = ''.join(f'<tr><td>{html_lib.escape(str(label))}</td><td>{html_lib.escape(str(product.get("specs", {}).get(key, "—")))}</td></tr>' for key, label in category.get('spec_labels', {}).items())
    return f'<article class="card"><h2>{html_lib.escape(product["name"])}</h2><table>{rows}</table>{render_flights_offers_html(product, config, "")}</article>'


def render_vs_page(prod_a: dict, prod_b: dict, category: dict, config: dict) -> tuple[str, dict]:
    slug = f"{prod_a['id']}-vs-{prod_b['id']}"
    title = f"เปรียบเทียบ {prod_a['name']} กับ {prod_b['name']}"
    body = '<div class="grid-2">' + _card(prod_a, category, config) + _card(prod_b, category, config) + '</div>'
    return _document(title, body, slug, config), {'type':'vs_comparison', 'slug':slug + '.html', 'title':title, 'category':category['name']}


def render_category_ranking_page(products: list, category: dict, config: dict) -> tuple[str, dict]:
    slug = f"best-{category['slug']}-2026"
    title = f"เปรียบเทียบรุ่น {category.get('full_name', category['name'])}"
    body = '<p>รายการรุ่นสำหรับเปรียบเทียบสเปก ดูอันดับตามราคาที่ตรวจสอบได้ในหน้าหลัก</p><div class="grid-2">' + ''.join(_card(p, category, config) for p in products) + '</div>'
    return _document(title, body, slug, config), {'type':'category_ranking', 'slug':slug + '.html', 'title':title, 'category':category['name']}


def main():
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    config = data["affiliate_config"]
    domain = config["domain"].rstrip("/")
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

    # Ensure any older static HTML pages in dist/ also have canonical link
    for html_file in sorted(DIST_DIR.glob("*.html")):
        content = html_file.read_text(encoding="utf-8")
        if 'data-market-product=' not in content and 'data-legacy-market-notice' not in content:
            notice = '<aside data-legacy-market-notice style="padding:18px;background:#fff4d6;color:#5c3b00;font:16px sans-serif">บทความเดิม: ราคา โปรโมชัน และลิงก์ในหน้านี้ยังไม่ได้ตรวจสอบใหม่ กรุณาใช้ <a href="../index.html">หน้าหลัก</a> สำหรับข้อมูลที่มีหลักฐาน</aside>'
            content = content.replace('<body>', '<body>' + notice, 1)
            html_file.write_text(content, encoding='utf-8')
        if 'rel="canonical"' not in content:
            canonical_tag = f'  <link rel="canonical" href="{domain}/dist/{html_file.name}">\n'
            content = content.replace("</head>", f"{canonical_tag}</head>", 1)
            html_file.write_text(content, encoding="utf-8")

    today = datetime.now().strftime("%Y-%m-%d")
    url_entries = [
        f"  <url>\n    <loc>{domain}/</loc>\n    <lastmod>{today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>"
    ]
    for html_file in sorted(DIST_DIR.glob("*.html")):
        url_entries.append(
            f"  <url>\n    <loc>{domain}/dist/{html_file.name}</loc>\n    <lastmod>{today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>"
        )
    articles_dir = DIST_DIR / "articles"
    if articles_dir.exists():
        for art_file in sorted(articles_dir.glob("*.html")):
            url_entries.append(
                f"  <url>\n    <loc>{domain}/dist/articles/{art_file.name}</loc>\n    <lastmod>{today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>"
            )

    active_feed = BASE_DIR / 'data/shopee_feed_rankings.json'
    if active_feed.exists() and json.loads(active_feed.read_text()).get('catalog_mode') == 'smartphone_30':
        # Dormant articles stay on disk but their routes are paused on Hostinger.
        url_entries = [f"  <url><loc>{domain}{path}</loc><lastmod>{today}</lastmod></url>"
                       for path in ('/', '/shopee-ranking.html')]
    sitemap_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{chr(10).join(url_entries)}
</urlset>"""
    (DIST_DIR / "sitemap.xml").write_text(sitemap_xml, encoding="utf-8")
    (BASE_DIR / "sitemap.xml").write_text(sitemap_xml, encoding="utf-8")

    manifest_summary = {
        "generated_at": datetime.now().isoformat(),
        "total_products": len(products),
        "total_seo_pages_generated": len(manifest),
        "pages": manifest,
    }
    (DIST_DIR / "seo_manifest.json").write_text(
        json.dumps(manifest_summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"✅ สร้างหน้าเว็บ yespec + รูปสินค้า + Price Radar สำเร็จทั้งหมด {len(manifest)} หน้า (รวม Sitemap {len(url_entries)} URLs)!")


if __name__ == "__main__":
    main()

