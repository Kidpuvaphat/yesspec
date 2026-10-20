/* Evidence-aware storefront adapter; tracking is separate from price evidence. */
(function (root) {
  const affiliate = root.ShopeeAffiliate || (typeof require === 'function' ? require('./affiliate-links.js') : null);
  const hosts = {
    shopee: ['shopee.co.th', 'www.shopee.co.th', 's.shopee.co.th', 'shp.ee'],
    lazada: ['lazada.co.th', 'www.lazada.co.th', 's.lazada.co.th']
  };
  function safeLink(value, platform) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && hosts[platform].includes(u.hostname) && !u.username && !u.password && !/["'<>\\\n\r]/.test(value) ? value : '';
    } catch (_) { return ''; }
  }
  function eligible(s, now = Date.now()) {
    const observed = Date.parse(s.observed_at || ''), age = now - observed;
    return s.evidence_version === 2 && s.ranking_eligible === true && s.confirmed_match === true
      && ['manual', 'official_api'].includes(s.source) && !!s.variant && !!s.item_id
      && !!safeLink(s.product_url, s.platform) && ['sku', 'member'].includes(s.price_basis)
      && s.availability !== 'out_of_stock' && Number(s.net_price) > 0
      && Number.isFinite(Number(s.net_price)) && age >= 0 && age <= 48 * 3600000;
  }
  function collectedSalesEligible(s, now = Date.now()) {
    const sales = s.sales, observed = Date.parse(s.observed_at || '');
    // Historical observations remain usable with their collection date, even when a price expires.
    return s.evidence_version === 2 && s.confirmed_match === true
      && ['manual', 'official_api'].includes(s.source) && !!s.variant && !!s.item_id
      && s.link_type === 'exact_pdp' && !!safeLink(s.product_url, s.platform)
      && Number.isFinite(observed) && observed <= now
      && sales?.period === 'unknown' && ['listing', 'sku'].includes(sales.scope)
      && ['exact', 'lower_bound', 'approximate'].includes(sales.precision)
      && typeof sales.raw === 'string' && sales.raw.trim() !== ''
      && Number.isSafeInteger(sales.value) && sales.value >= 0;
  }
  function offers(product, item, now = Date.now()) {
    const scaled = !!product._scaledQuery || Math.abs((product._priceScale || 1) - 1) > 0.01;
    const stores = !scaled ? (item?.stores_sorted || []) : [];
    const result = ['shopee', 'lazada'].map(platform => {
      const s = stores.find(s => s.platform === platform) || {};
      const verified = eligible(s, now);
      const query = encodeURIComponent(product._scaledQuery || product.name);
      const fallback = platform === 'shopee' ? `https://shopee.co.th/search?keyword=${query}` : `https://www.lazada.co.th/catalog/?q=${query}`;
      const direct = s.link_type === 'exact_pdp';
      const rawUrl = safeLink(s.link, platform) || safeLink(s.product_url, platform);
      const landing = platform === 'shopee' ? (safeLink(s.product_url, platform) || rawUrl || fallback) : rawUrl || fallback;
      const trackedUrl = platform === 'shopee'
        ? (affiliate?.build(landing, product.id || 'catalog') || affiliate?.build(fallback, product.id || 'catalog')) : '';
      return {platform, store: s.shop_name || (platform === 'shopee' ? 'Shopee' : 'Lazada'),
        shopName: s.shop_name || '', netPrice: verified ? Number(s.net_price) : null,
        originalPrice: verified && Number(s.original_price) >= Number(s.net_price) ? Number(s.original_price) : null,
        url: trackedUrl || rawUrl || fallback, affiliateTracked: !!trackedUrl, linkType: direct ? 'exact_pdp' : 'search', verified,
        status: verified ? 'verified' : s.status === 'stale' || (s.observed_at && now - Date.parse(s.observed_at) > 48 * 3600000) ? 'stale' : 'unverified',
        observedAt: s.observed_at || null, variant: s.variant || '', sales: s.sales || null,
        collectedSalesEligible: collectedSalesEligible(s, now), productUrl: safeLink(s.product_url, platform),
        observedPrice: s.price_verified === true && Number.isFinite(Number(s.candidate_price)) && Number(s.candidate_price) > 0 ? Number(s.candidate_price) : null,
        priceBasis: s.price_basis || '', availability: s.availability || '',
        imageUrl: product.img || s.image_url || '', best: false, badge: '', shipping: '', discountPct: ''};
    });
    result.sort((a, b) => Number(b.verified) - Number(a.verified) || (a.netPrice ?? Infinity) - (b.netPrice ?? Infinity));
    if (result[0].verified) result[0].best = true;
    return result;
  }
  function comparePrices(a, b, descending = false) {
    if (a == null) return b == null ? 0 : 1;
    if (b == null) return -1;
    return descending ? b - a : a - b;
  }
  function collectedSalesOffer(offers) {
    return offers.filter(o => o.collectedSalesEligible)
      .sort((a, b) => b.sales.value - a.sales.value || a.platform.localeCompare(b.platform))[0] || null;
  }
  const api = {offers, eligible, comparePrices, collectedSalesEligible, collectedSalesOffer};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MarketData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
