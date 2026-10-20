"""Read public product-page price candidates. Never logs in or writes product data."""
from __future__ import annotations

import http.client
import ipaddress
import json
import math
import re
import socket
import ssl
import time
from datetime import date, datetime
from html.parser import HTMLParser
from urllib.parse import parse_qs, quote, urljoin, urlparse, urlunparse

from market_data import identity, utc_now
from ranking_offers import HOSTS, valid_cart_url

MAX_BYTES = 2 * 1024 * 1024
TIMEOUT = 15
MAX_REDIRECTS = 4
MESSAGES = {
    'blocked': 'หน้าร้านปฏิเสธการอ่านหรือให้ตรวจสอบผู้ใช้งาน กรุณาเปิดหน้าสินค้าแล้วกรอกราคาเอง',
    'login_required': 'หน้าร้านต้องเข้าสู่ระบบ กรุณาเปิดหน้าสินค้าในเบราว์เซอร์แล้วกรอกราคาเอง',
    'unavailable': 'หน้าสินค้าไม่พร้อมใช้งานหรือไม่พบสินค้า กรุณาเปิดลิงก์เพื่อตรวจเอง',
    'timeout': 'หน้าร้านตอบกลับไม่ทันเวลา ลองใหม่ภายหลังหรือกรอกราคาเองได้',
    'no_price': 'อ่านราคาที่ผูกกับสินค้านี้ไม่ได้ หน้าร้านอาจโหลดราคาผ่านแอปหรือ JavaScript กรุณาเปิดสินค้าแล้วกรอกราคาเอง',
    'range_only': 'พบเพียงช่วงราคา ยังเลือกตัวเลือกสินค้าให้ไม่ได้ กรุณาเปิดสินค้า เลือกตัวเลือก แล้วกรอกราคาเอง',
    'identity_mismatch': 'ลิงก์หรือข้อมูลในหน้าไม่ตรงรหัสสินค้าที่ตรวจ จึงไม่นำราคามาใช้',
    'unsafe_redirect': 'ลิงก์เปลี่ยนไปหน้าที่ตัวตรวจไม่รองรับ กรุณาวางลิงก์หน้าสินค้าเต็มหรือกรอกเอง',
    'too_large': 'หน้าสินค้ามีข้อมูลมากเกินขอบเขตการตรวจ กรุณาเปิดหน้าแล้วกรอกราคาเอง',
}


class CannotCheck(Exception):
    def __init__(self, code): self.code = code


def allowed_url(url, platform):
    """Validate every hop, not only the URL supplied by the admin."""
    try:
        p = urlparse(url)
        if (len(url) > 4096 or p.scheme != 'https' or p.hostname not in HOSTS[platform]
                or p.username or p.password or p.port not in (None, 443)
                or re.search(r'[\s<>"\x27\\\x00-\x1f]', url)):
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise CannotCheck('unsafe_redirect') from None
    return p


def product_key(url, platform):
    try:
        allowed_url(url, platform)
        if platform in ('shopee', 'lazada'):
            ids = identity(url, platform)
            return (ids.get('shop_id', ''), ids['item_id']) if ids else None
        p = urlparse(url)
        m = re.fullmatch(r'/(?:view/product/|(?:shop/|[a-z]{2}/)?pdp/(?:[^/]+/)?)(\d+)/?', p.path)
        return ('', m[1]) if m else None
    except (CannotCheck, ValueError):
        return None


class PublicHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        # Pin the checked address while TLS still authenticates the platform hostname.
        addresses = socket.getaddrinfo(self.host, self.port, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise CannotCheck('unsafe_redirect')
        self.sock = socket.create_connection((addresses[0][4][0], self.port), self.timeout)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


def fetch_page(url, platform):
    deadline = time.monotonic() + TIMEOUT
    current, visited = url, set()
    # A documented Shopee wrapper can be read without counting a tracking click.
    if platform == 'shopee':
        origin = parse_qs(urlparse(url).query).get('origin_link', [''])[0]
        if origin and product_key(origin, platform): current = origin
    original_key = product_key(url, platform)
    for hop in range(MAX_REDIRECTS + 1):
        p = allowed_url(current, platform)
        if current in visited: raise CannotCheck('unsafe_redirect')
        visited.add(current)
        remaining = deadline - time.monotonic()
        if remaining <= 0: raise CannotCheck('timeout')
        conn = PublicHTTPSConnection(p.hostname, timeout=min(5, remaining), context=ssl.create_default_context())
        try:
            target = urlunparse(('', '', quote(p.path or '/', safe='/%:@!$&()*+,;=-._~'), '', p.query, ''))
            conn.request('GET', target, headers={'User-Agent':'YesspecPriceCheck/1.0', 'Accept':'text/html,application/xhtml+xml', 'Accept-Encoding':'identity'})
            network_socket = conn.sock
            response = conn.getresponse()
            if response.status in (301,302,303,307,308):
                if hop == MAX_REDIRECTS or not response.getheader('Location'): raise CannotCheck('unsafe_redirect')
                current = urljoin(current, response.getheader('Location'))
                allowed_url(current, platform)
                continue
            if response.status in (401,403,429): raise CannotCheck('blocked')
            if response.status != 200: raise CannotCheck('unavailable')
            if re.search(r'/(?:login|buyer/login|verify|captcha)(?:/|$)', p.path, re.I):
                raise CannotCheck('login_required' if 'login' in p.path.lower() else 'blocked')
            final_key = product_key(current, platform)
            if not final_key or (original_key and final_key != original_key): raise CannotCheck('identity_mismatch')
            content_type = response.getheader('Content-Type', '').lower()
            if not any(t in content_type for t in ('text/html','application/xhtml+xml')): raise CannotCheck('no_price')
            if response.getheader('Content-Encoding', 'identity').lower() not in ('identity',''): raise CannotCheck('no_price')
            body = bytearray()
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0: raise CannotCheck('timeout')
                # A read is bounded even when the remote peer sends a slow body.
                network_socket.settimeout(min(5, remaining))
                chunk = response.read1(min(65536, MAX_BYTES + 1 - len(body)))
                if not chunk: break
                body.extend(chunk)
                if len(body) > MAX_BYTES: raise CannotCheck('too_large')
            encoding = response.headers.get_content_charset() or 'utf-8'
            try: html = body.decode(encoding, errors='replace')
            except LookupError: html = body.decode('utf-8', errors='replace')
            return html, current
        except (socket.timeout, TimeoutError):
            raise CannotCheck('timeout') from None
        except (OSError, http.client.HTTPException, UnicodeError):
            raise CannotCheck('unavailable') from None
        finally:
            conn.close()
    raise CannotCheck('unsafe_redirect')


class ProductPage(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.documents, self.meta, self.canonicals = [], {}, []
        self.script, self.parts, self.title_parts, self.in_title = False, [], [], False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'script':
            self.script = a.get('type','').lower().split(';')[0] == 'application/ld+json'
            self.parts = []
        if tag == 'meta': self.meta.setdefault((a.get('property') or a.get('name') or '').lower(), []).append(a.get('content',''))
        if tag == 'link' and 'canonical' in a.get('rel','').lower().split(): self.canonicals.append(a.get('href',''))
        if tag == 'title': self.in_title = True
    def handle_data(self, data):
        if self.script: self.parts.append(data)
        if self.in_title: self.title_parts.append(data)
    def handle_endtag(self, tag):
        if tag == 'script' and self.script:
            self.script = False
            if len(self.documents) < 30:
                try: self.documents.append(json.loads(''.join(self.parts)))
                except (ValueError, RecursionError): pass
        if tag == 'title': self.in_title = False


def typed(obj, kind):
    types = obj.get('@type', [])
    return kind in [str(t).rsplit('/',1)[-1] for t in (types if isinstance(types,list) else [types])]


def products(doc, depth=0):
    if depth > 8: return []
    if isinstance(doc,list): return [p for v in doc[:100] for p in products(v,depth+1)]
    if not isinstance(doc,dict): return []
    if typed(doc,'Product'): return [doc]
    # Do not recursively walk recommendations, reviews, or unrelated item lists.
    return products(doc.get('@graph',[]),depth+1) + products(doc.get('mainEntity',[]),depth+1)


def price(value):
    if isinstance(value,bool) or not re.fullmatch(r'\d+(?:\.\d{1,2})?',str(value)): return None
    n = float(value)
    return round(n,2) if math.isfinite(n) and 0 < n <= 100_000_000 else None


def extract_prices(html, url, platform):
    page = ProductPage(); page.feed(html)
    title = ''.join(page.title_parts).strip()[:500]
    if re.search(r'captcha|access denied|verify (?:you|your)|robot check|security verification|ยืนยันว่าคุณ|ตรวจสอบความปลอดภัย',title,re.I):
        raise CannotCheck('blocked')
    if re.search(r'^(?:login|log in|sign in|เข้าสู่ระบบ)(?:\s|$)',title,re.I): raise CannotCheck('login_required')
    key = product_key(url,platform)
    if not key: raise CannotCheck('identity_mismatch')
    # If a canonical product URL is declared, it must agree with the requested PDP.
    for canonical in page.canonicals + page.meta.get('og:url',[]):
        candidate_key = product_key(urljoin(url,canonical),platform)
        if candidate_key and candidate_key != key: raise CannotCheck('identity_mismatch')
    all_products = [p for doc in page.documents for p in products(doc)]
    matched = []
    for product in all_products:
        links = [product[k] for k in ('url','@id') if isinstance(product.get(k),str) and product[k]]
        if links:
            keys = [product_key(urljoin(url,link),platform) for link in links]
            if key not in keys or any(k and k != key for k in keys): continue
        elif len(all_products) != 1: continue
        matched.append(product)
    candidates, ranges = [], []
    for product in matched:
        name = str(product.get('name') or title)[:500]
        offers = product.get('offers',[])
        for offer in (offers if isinstance(offers,list) else [offers])[:30]:
            if not isinstance(offer,dict): continue
            if offer.get('url') and product_key(urljoin(url,str(offer['url'])),platform) != key: continue
            if str(offer.get('priceCurrency','')).upper() != 'THB': continue
            availability = str(offer.get('availability','')).rsplit('/',1)[-1]
            if availability in ('OutOfStock','SoldOut','Discontinued'): continue
            # Expired or malformed validity dates cannot support a current price.
            if offer.get('priceValidUntil'):
                try:
                    if date.fromisoformat(str(offer['priceValidUntil'])) < datetime.fromisoformat(utc_now().replace('Z','+00:00')).date(): continue
                except ValueError: continue
            if typed(offer,'AggregateOffer') or 'lowPrice' in offer or 'highPrice' in offer:
                lo, hi = price(offer.get('lowPrice')), price(offer.get('highPrice'))
                if lo and hi and lo <= hi: ranges.append({'low':lo,'high':hi,'currency':'THB'})
                continue
            amount = price(offer.get('price'))
            if amount is None: continue
            # Never substitute a priceSpecification's list/struck-through price.
            candidates.append({'amount':amount,'currency':'THB','product_title':name,
                               'variant':str(offer.get('name') or product.get('sku') or '')[:500],
                               'source':'product_structured_data'})
    # Metadata fallback is allowed only on a declared, matching product PDP.
    if not all_products and not candidates and 'product' in page.meta.get('og:type',[]) and any(
            product_key(urljoin(url,u),platform)==key for u in page.meta.get('og:url',[]) + page.canonicals):
        for prefix in ('product:price','og:price'):
            amounts = page.meta.get(prefix+':amount',[])
            currencies = page.meta.get(prefix+':currency',[])
            if len(amounts)==1 and currencies==['THB'] and price(amounts[0]):
                candidates.append({'amount':price(amounts[0]),'currency':'THB',
                                   'product_title':(page.meta.get('og:title') or [title])[0][:500],
                                   'variant':'','source':'product_metadata'})
    unique = list({(c['amount'],c['product_title'],c['variant']):c for c in candidates}.values())
    if len(unique)>12: raise CannotCheck('no_price')
    return unique, ranges[:6]


def check_price(url, platform):
    if not isinstance(platform,str) or platform not in HOSTS: raise ValueError('ช่องทางซื้อไม่ถูกต้อง')
    if not isinstance(url,str) or not valid_cart_url(url,platform): raise ValueError('กรุณาใส่ลิงก์ตะกร้าก่อนตรวจราคา')
    result = {'ok':True,'platform':platform,'requested_url':url,'candidates':[],'ranges':[],
              'checked_at':utc_now(),'method':'public_page','requires_confirmation':True}
    try:
        html, resolved = fetch_page(url,platform)
        candidates, ranges = extract_prices(html,resolved,platform)
        result.update(resolved_url=resolved,candidates=candidates,ranges=ranges)
        code = 'candidates_found' if candidates else 'range_only' if ranges else 'no_price'
        message = 'พบราคาจากหน้าเว็บ กรุณาตรวจร้าน ตัวเลือก และประเภทราคาก่อนยืนยัน' if candidates else MESSAGES[code]
    except CannotCheck as exc:
        code, message = exc.code, MESSAGES[exc.code]
    except (ValueError, RecursionError):
        code, message = 'no_price', MESSAGES['no_price']
    result.update(status=code,message=message,checked_at=utc_now())
    return result
