(function (root) {
  'use strict';
  const hosts = {
    shopee: ['shopee.co.th', 'www.shopee.co.th', 's.shopee.co.th', 'shp.ee'],
    lazada: ['lazada.co.th', 'www.lazada.co.th', 's.lazada.co.th'],
    tiktok: ['tiktok.com', 'www.tiktok.com', 'shop.tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com']
  };
  const names = {shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok Shop'};
  function validURL(raw, platform, depth = 0) {
    if (typeof raw !== 'string' || !raw || raw.length > 4096 || /[\s<>"'\\\u0000-\u001f]/.test(raw)) return '';
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' || u.username || u.password || u.port || !hosts[platform]?.includes(u.hostname)) return '';
      let cart = false;
      if (platform === 'shopee') {
        if (u.searchParams.has('origin_link')) {
          cart = depth === 0 && !!validURL(u.searchParams.get('origin_link'), platform, 1);
        } else if (['s.shopee.co.th', 'shp.ee'].includes(u.hostname)) {
          cart = u.pathname !== '/an_redir' && /^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname);
        } else cart = /(?:\/product\/|\/universal-link\/product\/)\d+\/\d+(?:\/|$)/.test(u.pathname) || /-i\.\d+\.\d+(?:\/|$)/.test(u.pathname);
      } else if (platform === 'lazada') {
        cart = u.hostname === 's.lazada.co.th' ? /^\/[A-Za-z0-9_.-]+\/?$/.test(u.pathname) : /-i\d+(?:-s\d+)?\.html$/.test(u.pathname);
      } else {
        cart = ['vt.tiktok.com', 'vm.tiktok.com'].includes(u.hostname)
          ? /^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)
          : /^\/(?:view\/product\/\d+|(?:shop\/|[a-z]{2}\/)?pdp\/(?:[^/]+\/)?\d+|t\/[A-Za-z0-9_-]+)\/?$/.test(u.pathname);
      }
      return cart ? raw : '';
    } catch (_) { return ''; }
  }
  function sameBinding(item, binding) {
    return binding?.title === item.title && binding.model_count === (item.price?.model_count ?? null) &&
      JSON.stringify(binding.model_examples) === JSON.stringify((item.price?.model_examples || []).map(m => ({id:m.id, name:m.name})));
  }
  function defaultShopee(item) {
    const id = `${item.shop_id}/${item.item_id}`;
    if (item.listing_id !== id || item.product_url !== `https://shopee.co.th/product/${id}` || !validURL(item.product_url, 'shopee')) return null;
    return {platform:'shopee', url:item.product_url, price:item.manual_price_only ? null : item.price?.amount ?? null,
      source:item.manual_price_only ? 'awaiting_manual' : item.source, price_type:item.manual_price_only ? 'coupon' : 'regular'};
  }
  function resolve(item, registry) {
    if (registry?.schema_version !== 1 || !registry.items || typeof registry.items !== 'object') return [];
    const entry = item.source === 'shopee_affiliate_csv' ? registry.items[item.listing_id] : null;
    const matched = sameBinding(item, entry?.binding);
    return Object.keys(names).flatMap(platform => {
      const has = Object.prototype.hasOwnProperty.call(entry?.offers || {}, platform);
      const raw = has && (matched || entry.offers[platform] === null)
        ? entry.offers[platform] : platform === 'shopee' ? defaultShopee(item) : null;
      if (!raw || !validURL(raw.url, platform)) return [];
      return [{...raw, platform, price:typeof raw.price === 'number' && Number.isFinite(raw.price) && raw.price > 0 ? raw.price : null}];
    });
  }
  function attach(data, registry) {
    return {...data, categories:data.categories.map(c => ({...c, items:c.items.map(item => ({...item,
      purchase_offers:resolve(item, registry), purchase_offers_unavailable:registry?.schema_version !== 1
    }))}))};
  }
  const api = {names, validURL, sameBinding, defaultShopee, resolve, attach};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RankingOffers = api;
})(typeof window !== 'undefined' ? window : globalThis);
