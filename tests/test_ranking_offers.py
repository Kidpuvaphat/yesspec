import copy
import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import HTTPServer
from pathlib import Path
from unittest.mock import patch
import admin_server
import ranking_offers as api


class RankingOffersTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root/'data').mkdir()
        self.feed = (Path(__file__).parents[1]/'data/shopee_feed_rankings.json').read_bytes()
        (self.root/'data/shopee_feed_rankings.json').write_bytes(self.feed)
        self.row = api.payload(self.root)['categories'][0]['items'][0]

    def update(self, offers, **extra):
        return {'listing_id':self.row['listing_id'], 'revision':self.row['revision'], 'offers':offers, **extra}

    def test_all_categories_and_empty_channels(self):
        data = api.payload(self.root)
        self.assertEqual(data['total'],640)
        self.assertEqual(len(data['categories']),32)
        for c in data['categories']:
            self.assertEqual(len(c['items']),20)
            for item in c['items']:
                self.assertIsNone(item['offers']['tiktok'])
                self.assertIsNone(item['offers']['lazada'])
                self.assertTrue(item['offers']['shopee']['url'])

    def test_save_reopen_clear_and_reset_are_persistent_without_touching_feed(self):
        tiktok='https://vt.tiktok.com/ZStest/?affiliate_id=keep&share=keep'
        api.save(self.root,[self.update({'tiktok':{'url':tiktok,'price':'99.5','price_type':'vip','variant':'128GB'}})])
        self.row=api.payload(self.root)['categories'][0]['items'][0]
        self.assertEqual(self.row['offers']['tiktok']['url'],tiktok)
        self.assertEqual(self.row['offers']['tiktok']['price'],99.5)
        self.assertEqual(self.row['offers']['tiktok']['price_type'],'vip')
        api.save(self.root,[self.update({'tiktok':{'url':'','price':'99.5'},'shopee':None})])
        self.row=api.payload(self.root)['categories'][0]['items'][0]
        self.assertIsNone(self.row['offers']['tiktok'])
        self.assertIsNone(self.row['offers']['shopee'])
        api.save(self.root,[self.update({},reset=['shopee'])])
        self.assertEqual(api.payload(self.root)['categories'][0]['items'][0]['offers']['shopee']['source'],'shopee_affiliate_csv')
        self.assertEqual((self.root/'data/shopee_feed_rankings.json').read_bytes(),self.feed)

    def test_blank_price_and_unsafe_links(self):
        self.assertIsNone(api.clean_offer({'url':'https://s.lazada.co.th/s.abc','price':''},'lazada','now')['price'])
        for url in ['https://www.tiktok.com/@name','https://tiktok.com.evil.test/view/product/1','http://vt.tiktok.com/abc','https://u:p@vt.tiktok.com/abc','https://vt.tiktok.com:444/a','javascript:alert(1)']:
            with self.subTest(url=url),self.assertRaises(ValueError):api.valid_cart_url(url,'tiktok')
        for price in [-1,0,0.001,True,'NaN','Infinity','abc']:
            with self.subTest(price=price),self.assertRaises(ValueError):api.clean_offer({'url':'https://vt.tiktok.com/abc','price':price},'tiktok','now')

    def test_replacing_shopee_cart_keeps_affiliate_link_and_source_ranking(self):
        url = 'https://s.shopee.co.th/Lo9720VLk'
        api.save(self.root, [self.update({'shopee': {
            'url': url, 'price': 6808, 'price_type': 'flash_sale',
            'variant': 'OPPO A6t Pro 8/128GB', 'note': 'ราคาโปรโมชันที่ผู้ดูแลแจ้ง',
        }})])
        row = api.payload(self.root)['categories'][0]['items'][0]
        self.assertEqual(row['offers']['shopee']['url'], url)
        self.assertEqual(row['offers']['shopee']['price'], 6808)
        self.assertEqual(row['offers']['shopee']['price_type'], 'flash_sale')
        self.assertNotIn('price_lookup', row['offers']['shopee'])
        self.assertEqual((row['listing_id'], row['rank'], row['title']),
                         (self.row['listing_id'], self.row['rank'], self.row['title']))
        self.assertEqual((self.root/'data/shopee_feed_rankings.json').read_bytes(), self.feed)

    def test_atomic_batch_and_conflicting_tabs(self):
        bad=self.update({'lazada':{'url':'https://evil.test','price':20}})
        bad['listing_id']=api.payload(self.root)['categories'][0]['items'][1]['listing_id']
        bad['revision']=api.payload(self.root)['categories'][0]['items'][1]['revision']
        good=self.update({'tiktok':{'url':'https://vt.tiktok.com/abc','price':10}})
        with self.assertRaises(ValueError):api.save(self.root,[good,bad])
        self.assertFalse((self.root/'data/ranking_manual_offers.json').exists())
        api.save(self.root,[good])
        with self.assertRaises(api.ConflictError):api.save(self.root,[good])

    def test_feed_changes_require_rematching_without_restoring_a_deleted_cart(self):
        api.save(self.root,[self.update({'shopee':None,'tiktok':{'url':'https://vt.tiktok.com/abc','price':10}})])
        feed=json.loads(self.feed);feed['categories'][0]['items'][0]['title']+=' changed'
        (self.root/'data/shopee_feed_rankings.json').write_text(json.dumps(feed))
        row=api.payload(self.root)['categories'][0]['items'][0]
        self.assertIsNone(row['offers']['shopee'])
        self.assertIsNone(row['offers']['tiktok'])
        self.assertEqual(row['needs_review'],['tiktok'])

    def test_http_endpoints_require_auth_and_preserve_conflicts(self):
        class QuietHandler(admin_server.AdminRequestHandler):
            def log_message(self, *args): pass
        cfg = {'username':'qa', 'password_sha256':'qa-hash', 'secret':'test-only'}
        token = admin_server._make_token(cfg['username'],cfg['password_sha256'],cfg['secret'])
        with patch.object(admin_server,'BASE_DIR',self.root), patch.object(admin_server,'_get_auth_config',return_value=cfg):
            server = HTTPServer(('127.0.0.1',0),QuietHandler)
            thread = threading.Thread(target=server.serve_forever,daemon=True)
            thread.start()
            def request(method,path,data=None,authenticated=False):
                conn=HTTPConnection('127.0.0.1',server.server_port,timeout=5)
                headers={'Content-Type':'application/json'}
                if authenticated: headers['X-Admin-Token']=token
                conn.request(method,path,body=json.dumps(data) if data is not None else None,headers=headers)
                response=conn.getresponse();status=response.status;body=json.loads(response.read());conn.close()
                return status,body
            try:
                self.assertEqual(request('GET','/api/admin/ranking-products')[0],401)
                data={'products':[self.update({'tiktok':{'url':'https://vt.tiktok.com/abc','price':10}})]}
                self.assertEqual(request('POST','/api/admin/save-ranking-offers',data)[0],401)
                self.assertFalse((self.root/'data/ranking_manual_offers.json').exists())
                with patch.object(admin_server.price_check,'check_price',return_value={'ok':True,'status':'no_price','candidates':[]}) as check:
                    self.assertEqual(request('POST','/api/admin/check-ranking-price',{'url':'https://vt.tiktok.com/abc','platform':'tiktok'})[0],401)
                    check.assert_not_called()
                    status,body=request('POST','/api/admin/check-ranking-price',{'url':'https://vt.tiktok.com/abc','platform':'tiktok'},True)
                    self.assertEqual((status,body['status']),(200,'no_price'))
                    check.assert_called_once_with('https://vt.tiktok.com/abc','tiktok')
                    self.assertFalse((self.root/'data/ranking_manual_offers.json').exists())
                status,body=request('GET','/api/admin/ranking-products',authenticated=True)
                self.assertEqual((status,body['total']),(200,640))
                self.assertEqual(request('POST','/api/admin/save-ranking-offers',data,True)[0],200)
                self.assertEqual(request('POST','/api/admin/save-ranking-offers',data,True)[0],409)
                self.assertEqual(request('POST','/api/admin/save-ranking-offers',[],True)[0],400)
            finally:
                server.shutdown();server.server_close();thread.join()

    def test_price_lookup_provenance_is_only_kept_for_the_confirmed_url_and_amount(self):
        url='https://vt.tiktok.com/abc'
        lookup={'requested_url':url,'resolved_url':'https://shop.tiktok.com/view/product/34','amount':100,'checked_at':'2026-10-19T10:00:00Z','confirmed':True}
        raw={'url':url,'price':100,'price_lookup':lookup}
        result=api.clean_offer(raw,'tiktok','2026-10-20T10:00:00Z')
        self.assertEqual(result['price_lookup'],lookup)
        for changed in [{**raw,'price':101},{**raw,'url':url+'changed'},{**raw,'price_lookup':{**lookup,'confirmed':False}}]:
            self.assertNotIn('price_lookup',api.clean_offer(changed,'tiktok','2026-10-20T10:00:00Z'))


if __name__=='__main__':unittest.main()
