(function (root) {
  'use strict';
  const official = root.OfficialSpecs || (typeof require === 'function' ? require('./official-specs.js') : null);
  const offers = root.RankingOffers || (typeof require === 'function' ? require('./ranking-offers.js') : null);
  const paths = ['/data/shopee_feed_rankings.json', '/data/official_product_specs.json',
    '/data/ranking_manual_offers.json', '/data/shopee_feed_review.json'];

  // Listing evidence stays separate from legacy SKU records and manual purchase carts.
  function prepareDataset(data) {
    if (data?.source !== 'shopee_affiliate_csv' || data.sales_period !== 'unknown' || !data.categories?.length) {
      throw new Error('Unsupported ranking dataset');
    }
    const categoryIds = new Set();
    const categories = data.categories.map(category => {
      if (!category.id || categoryIds.has(category.id) || !Array.isArray(category.items)) throw new Error('Invalid category');
      categoryIds.add(category.id);
      const ids = new Set();
      for (const item of category.items) {
        const key = `${item.shop_id}/${item.item_id}`;
        if (ids.has(item.listing_id) || !/^[1-9]\d*\/[1-9]\d*$/.test(key) ||
            item.product_url !== `https://shopee.co.th/product/${key}` || item.listing_id !== key ||
            item.source !== data.source || item.sales?.period !== 'unknown' || item.sales?.scope !== 'listing' ||
            !Number.isFinite(item.sales?.value) || item.sales.value < 0) {
          throw new Error('Invalid listing evidence');
        }
        ids.add(item.listing_id);
      }
      let previousSales, rank;
      const items = [...category.items].sort((a, b) => b.sales.value - a.sales.value)
        .slice(0, category.target_count || 20).map((item, index) => {
          if (item.sales.value !== previousSales) rank = index + 1;
          previousSales = item.sales.value;
          return {...item, rank, price: {...item.price,
            amount: Number.isFinite(item.price?.amount) && item.price.amount > 0 ? item.price.amount : null}};
        });
      return {...category, items, listing_count: items.length};
    });
    return {...data, categories};
  }

  function create({fetcher, host = root}) {
    let generation = 0, pending = false, current, snapshot, catalog = null, audit = null;
    async function read(path) {
      const schedule = host.setTimeout?.bind(host) || globalThis.setTimeout;
      const cancel = host.clearTimeout?.bind(host) || globalThis.clearTimeout;
      const Controller = host.AbortController || globalThis.AbortController;
      const controller = Controller ? new Controller() : null;
      let timer;
      const request = (async () => {
        const response = await fetcher(path, {cache: 'no-store', ...(controller ? {signal: controller.signal} : {})});
        if (!response.ok) throw new Error('Cannot load ranking data');
        return response.json();
      })();
      if (!schedule) return request;
      const deadline = new Promise((_, reject) => {
        timer = schedule(() => {
          controller?.abort();
          reject(new Error('Ranking data request timed out'));
        }, 15000);
      });
      try { return await Promise.race([request, deadline]); }
      finally { cancel(timer); }
    }
    function unavailable() {
      return {dataset: catalog ? offers.attach(catalog, null) : null, audit,
        status: 'unavailable', message: 'โหลดข้อมูลล่าสุดไม่ได้ · พักอันดับชั่วคราว ระบบจะลองใหม่'};
    }
    function load(refresh = false) {
      if (!refresh && pending) return current;
      if (!refresh && snapshot?.status === 'ready') return Promise.resolve(snapshot);
      const ticket = ++generation;
      pending = true;
      current = (async () => {
        const results = await Promise.allSettled(paths.map(read));
        // Both old successes and old failures adopt the newer read's result.
        if (ticket !== generation) return current;
        const value = index => results[index].status === 'fulfilled' ? results[index].value : null;
        let next;
        try {
          const prepared = prepareDataset(value(0));
          let nextCatalog;
          try { nextCatalog = official.attach(prepared, value(1)); }
          catch (_) { nextCatalog = official.attach(prepared, null); }
          // Verify that the feed can also be displayed with no manual registry
          // before replacing the last usable catalog (including nested evidence).
          const safeDataset = offers.attach(nextCatalog, null);
          catalog = nextCatalog;
          const review = value(3);
          audit = Array.isArray(review?.categories) && review.categories.every(category =>
            category && typeof category.category_id === 'string' &&
            (category.excluded === undefined || (Array.isArray(category.excluded) &&
              category.excluded.every(item => item && typeof item === 'object' && !Array.isArray(item))))) ? review : null;
          const registry = value(2);
          const validRegistry = registry?.schema_version === 1 && registry.items &&
            typeof registry.items === 'object' && !Array.isArray(registry.items);
          let dataset;
          try { dataset = validRegistry ? offers.attach(catalog, registry) : null; }
          catch (_) { /* Malformed manual data must not restore cached prices. */ }
          next = dataset
            ? {dataset, audit, status: 'ready', message: ''}
            : {dataset: safeDataset, audit, status: 'prices_unavailable',
              message: 'โหลดราคาล่าสุดไม่ได้ · พักอันดับชั่วคราว ระบบจะลองใหม่'};
        } catch (_) {
          // A new registry cannot safely bind to an unavailable or invalid feed.
          next = unavailable();
        }
        snapshot = next;
        pending = false;
        return snapshot;
      })();
      return current;
    }

    function watch(listener) {
      if (!host.document || !host.addEventListener) return () => {};
      let busy = false, queued = false, stopped = false;
      async function update() {
        if (stopped || host.document.hidden) return;
        if (busy) { queued = true; return; }
        busy = true;
        try {
          do {
            queued = false;
            const next = await load(true);
            if (!stopped) await listener(next);
          } while (queued && !stopped && !host.document.hidden);
        } finally { busy = false; }
      }
      const refresh = () => update().catch(error => host.console?.error(error));
      const storage = event => event.key === 'yesspec_offers_updated' ? refresh() : undefined;
      host.addEventListener('storage', storage);
      host.addEventListener('focus', refresh);
      host.document.addEventListener('visibilitychange', refresh);
      const interval = host.setInterval(refresh, 60000);
      return () => {
        stopped = true;
        host.removeEventListener('storage', storage);
        host.removeEventListener('focus', refresh);
        host.document.removeEventListener('visibilitychange', refresh);
        host.clearInterval(interval);
      };
    }
    return {load, watch};
  }
  const exported = {prepareDataset, create};
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  root.RankingData = exported;
})(typeof window !== 'undefined' ? window : globalThis);
