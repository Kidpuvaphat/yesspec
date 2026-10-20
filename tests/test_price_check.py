import json
import socket
import unittest
from unittest.mock import patch, MagicMock
import price_check as pc

URLS={'shopee':'https://shopee.co.th/product/12/34','lazada':'https://www.lazada.co.th/products/pdp-i34-s56.html','tiktok':'https://shop.tiktok.com/view/product/34'}

def document(url,offer=None,**extra):
    product={'@type':'Product','name':'Phone 128GB','url':url,'offers':offer or {'@type':'Offer','price':'1299.50','priceCurrency':'THB'},**extra}
    return '<title>Phone</title><script type="application/ld+json">'+json.dumps(product)+'</script>'


class PriceCheckTests(unittest.TestCase):
    def test_reads_product_prices_for_all_platforms_without_assuming_vip_or_variant(self):
        for platform,url in URLS.items():
            with self.subTest(platform=platform),patch.object(pc,'fetch_page',return_value=(document(url),url)):
                result=pc.check_price(url,platform)
                self.assertEqual(result['status'],'candidates_found')
                self.assertEqual(result['candidates'][0]['amount'],1299.5)
                self.assertEqual(result['candidates'][0]['variant'],'')
                self.assertNotIn('price_type',result['candidates'][0])
                self.assertTrue(result['requires_confirmation'])

    def test_ranges_never_become_a_selected_price(self):
        url=URLS['shopee'];html=document(url,{'@type':'AggregateOffer','lowPrice':'10','highPrice':'999','priceCurrency':'THB'})
        with patch.object(pc,'fetch_page',return_value=(html,url)):
            result=pc.check_price(url,'shopee')
            self.assertEqual(result['status'],'range_only');self.assertEqual(result['candidates'],[])
            self.assertEqual(result['ranges'][0]['high'],999)

    def test_wrong_products_foreign_currency_invalid_prices_and_unavailable_stock_are_not_candidates(self):
        url=URLS['shopee']
        for offer in [
            {'price':'1','priceCurrency':'USD'}, {'price':'0','priceCurrency':'THB'},
            {'price':'NaN','priceCurrency':'THB'}, {'price':'1,200','priceCurrency':'THB'},
            {'price':'12','priceCurrency':'THB','availability':'https://schema.org/OutOfStock'},
            {'price':'12','priceCurrency':'THB','priceValidUntil':'2000-01-01'},
            {'price':'12','priceCurrency':'THB','priceValidUntil':'invalid'},
            {'price':'12','priceCurrency':'THB','url':'https://shopee.co.th/product/99/99'},
            {'priceSpecification':{'price':999,'priceType':'https://schema.org/StrikethroughPrice'},'priceCurrency':'THB'}]:
            with self.subTest(offer=offer):self.assertEqual(pc.extract_prices(document(url,offer),url,'shopee')[0],[])
        self.assertEqual(pc.extract_prices(document('https://shopee.co.th/product/99/99'),url,'shopee')[0],[])
        self.assertEqual(pc.extract_prices(document(url,**{'@id':'https://shopee.co.th/product/99/99'}),url,'shopee')[0],[])

    def test_graph_main_entity_and_multiple_offers_preserve_choices(self):
        url=URLS['tiktok'];p=json.loads(document(url).split('application/ld+json">')[1].split('</script>')[0])
        p['offers']=[{'price':'100','priceCurrency':'THB','name':'128GB'},{'price':'200','priceCurrency':'THB','name':'256GB'}]
        for root in [{'@graph':[p]},{'@type':'WebPage','mainEntity':p}]:
            html='<script type="application/ld+json">'+json.dumps(root)+'</script>'
            candidates,_=pc.extract_prices(html,url,'tiktok')
            self.assertEqual([x['amount'] for x in candidates],[100,200])
        html='<script type="application/ld+json">'+json.dumps({'@type':'ItemList','itemListElement':[p]})+'</script>'
        self.assertEqual(pc.extract_prices(html,url,'tiktok')[0],[])

    def test_meta_price_requires_product_type_currency_and_matching_canonical(self):
        url=URLS['lazada']
        html=f'<meta property="og:type" content="product"><meta property="og:url" content="{url}"><meta property="product:price:amount" content="12.50"><meta property="product:price:currency" content="THB">'
        self.assertEqual(pc.extract_prices(html,url,'lazada')[0][0]['amount'],12.5)
        self.assertEqual(pc.extract_prices(html.replace('THB','USD'),url,'lazada')[0],[])
        self.assertEqual(pc.extract_prices(html.replace('content="product"','content="website"'),url,'lazada')[0],[])
        with self.assertRaises(pc.CannotCheck):pc.extract_prices(html.replace('i34','i99'),url,'lazada')

    def test_challenge_login_and_network_failures_return_manual_fallback(self):
        url=URLS['shopee']
        for title,status in [('Verify you are human','blocked'),('Login Shopee','login_required')]:
            with patch.object(pc,'fetch_page',return_value=(f'<title>{title}</title>'+document(url),url)):
                self.assertEqual(pc.check_price(url,'shopee')['status'],status)
        for code in pc.MESSAGES:
            with patch.object(pc,'fetch_page',side_effect=pc.CannotCheck(code)):
                result=pc.check_price(url,'shopee');self.assertEqual(result['status'],code);self.assertEqual(result['candidates'],[])

    def test_url_validation_and_private_ip_connections(self):
        for url in ['http://shopee.co.th/product/1/2','https://127.0.0.1/','https://shopee.co.th.evil.test/product/1/2','https://u:p@shopee.co.th/product/1/2','https://shopee.co.th:444/product/1/2']:
            with self.subTest(url=url),self.assertRaises(pc.CannotCheck):pc.allowed_url(url,'shopee')
        for ip in ['127.0.0.1','169.254.169.254','10.0.0.1','::1']:
            with patch.object(socket,'getaddrinfo',return_value=[(2,1,6,'',(ip,443))]),patch.object(socket,'create_connection') as connect:
                with self.assertRaises(pc.CannotCheck):pc.PublicHTTPSConnection('shopee.co.th').connect()
                connect.assert_not_called()

    def test_redirects_are_checked_before_following_and_credentials_never_sent(self):
        response=MagicMock(status=302)
        response.getheader.side_effect=lambda key,default=None: 'https://127.0.0.1/' if key=='Location' else default
        conn=MagicMock();conn.getresponse.return_value=response
        with patch.object(pc,'PublicHTTPSConnection',return_value=conn) as connect:
            with self.assertRaises(pc.CannotCheck) as raised:pc.fetch_page(URLS['shopee'],'shopee')
            self.assertEqual(raised.exception.code,'unsafe_redirect');self.assertEqual(connect.call_count,1)
            headers=conn.request.call_args.kwargs['headers'];self.assertNotIn('Cookie',headers);self.assertNotIn('Authorization',headers)

    def test_affiliate_wrapper_keeps_original_link_in_result(self):
        url='https://s.shopee.co.th/an_redir?origin_link=https%3A%2F%2Fshopee.co.th%2Fproduct%2F12%2F34&affiliate_id=123'
        with patch.object(pc,'fetch_page',return_value=(document(URLS['shopee']),URLS['shopee'])):
            result=pc.check_price(url,'shopee');self.assertEqual(result['requested_url'],url)
            self.assertEqual(result['resolved_url'],URLS['shopee'])


if __name__=='__main__':unittest.main()
