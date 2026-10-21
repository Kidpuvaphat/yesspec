(function (root) {
  'use strict';
  const ranking = root.ShopeeRanking || (typeof require === 'function' ? require('./shopee-ranking.js') : null);
  const official = root.OfficialSpecs || (typeof require === 'function' ? require('./official-specs.js') : null);
  const channels = root.RankingOffers || (typeof require === 'function' ? require('./ranking-offers.js') : null);
  const count = value => Number(value).toLocaleString('th-TH');

  // Category browsing uses listing-level feed evidence only. Never mix legacy SKU/spec records into it.
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
        if (ids.has(item.listing_id) || !ranking.productUrl(item) || item.listing_id !== `${item.shop_id}/${item.item_id}` ||
            item.source !== data.source || item.sales?.period !== 'unknown' || item.sales?.scope !== 'listing' ||
            !Number.isFinite(item.sales?.value) || item.sales.value < 0) {
          throw new Error('Invalid listing evidence');
        }
        ids.add(item.listing_id);
      }
      let previousSales, rank;
      const items = [...category.items].sort((a, b) => b.sales.value - a.sales.value).slice(0, category.target_count || 20).map((item, index) => {
        if (item.sales.value !== previousSales) rank = index + 1;
        previousSales = item.sales.value;
        return {...item, rank, price: {...item.price, amount: Number.isFinite(item.price?.amount) && item.price.amount > 0 ? item.price.amount : null}};
      });
      return {...category, items, listing_count: items.length};
    });
    return {...data, categories};
  }

  function createLoader(fetcher) {
    let pending;
    const read = async path => {
      const response = await fetcher(path, {cache: 'no-store'});
      if (!response.ok) throw new Error('Cannot load data');
      return response.json();
    };
    return (refresh = false) => {
      if (refresh) pending = null;
      if (!pending) pending = Promise.allSettled([read('data/shopee_feed_rankings.json'), read('data/official_product_specs.json'), read('data/ranking_manual_offers.json')])
        .then(results => {
          if (results[0].status !== 'fulfilled') throw results[0].reason;
          return channels.attach(official.attach(prepareDataset(results[0].value), results[1].status === 'fulfilled' ? results[1].value : null), results[2].status === 'fulfilled' ? results[2].value : null);
        }).catch(error => { pending = null; throw error; });
      return pending;
    };
  }

  function createController(doc, load) {
    const $ = id => doc.getElementById(id);
    let dataset, category, selectedId, query = '', band = 'all', mode = 'value', request = 0, profile = ranking.readProfile();
    function render() {
      if (!category) return;
      const ordered = dataset.catalog_mode === 'smartphone_30' ? channels.orderItems(category.items,mode,Date.now(),profile) : category.items;
      const items = ranking.filterItems(ordered, query).filter(item => band === 'all' || item.price_band === band);
      $('categoryTop20Meta').textContent = dataset.catalog_mode === 'smartphone_30'
        ? `${category.listing_count} รุ่น · ${category.price_bands?.length || 0} ช่วงงบ · ${ranking.orderLabel(mode,profile)}${mode==='sales'?'':` · จัดอันดับได้ ${ordered.filter(i=>i.rank!=null).length} รุ่น (ชั่วคราว ${ordered.filter(i=>i.rank!=null&&i.value_result?.provisional).length})`}`
        : `${category.listing_count} รายการ · เรียงตามยอดขายต้นทางที่เก็บได้`;
      $('categoryTop20Count').textContent = `${items.length} / ${category.listing_count} รายการ`;
      $('categoryTop20Results').innerHTML = items.length
        ? items.map(item => ranking.listingHTML(item, dataset.reason_labels || {}, false, Date.now(), dataset.price_ttl_hours)).join('')
        : '<p class="empty">ไม่พบสินค้าในตัวกรองนี้ ลองเปลี่ยนช่วงงบหรือคำค้น</p>';
    }
    function search(value) {
      query = String(value || '');
      $('categoryTop20Search').value = query;
      render();
    }
    async function show(id) {
      const current = ++request;
      selectedId = id;
      category = null;
      query = '';
      band = 'all';
      if ($('categoryTop20Band')) $('categoryTop20Band').value = 'all';
      $('categoryTop20Search').value = '';
      $('categoryTop20Search').disabled = true;
      $('categoryTop20Clear').disabled = true;
      $('categoryTop20Count').textContent = 'กำลังโหลด…';
      $('categoryTop20Meta').textContent = '';
      $('categoryTop20Review').href = `shopee-ranking.html?source=feed#${encodeURIComponent(id)}`;
      $('categoryTop20Results').textContent = 'กำลังโหลดรายการมือถือ…';
      $('categoryTop20Results').setAttribute('aria-busy', 'true');
      try {
        const result = await load();
        if (current !== request) return;
        dataset = result;
        category = dataset.categories.find(c => c.id === selectedId);
        if (!category) throw new Error('Missing category');
        $('categoryTop20Meta').textContent = `${category.listing_count} รุ่น · ${category.price_bands?.length || 0} ช่วงงบ · เรียงตามยอดขายต้นทางที่เก็บได้`;
        if ($('categoryTop20Band')) $('categoryTop20Band').innerHTML = '<option value="all">ทุกช่วงงบ</option>' + (category.price_bands || []).map(b => `<option value="${ranking.escapeHTML(b.id)}">${ranking.escapeHTML(b.label)} (${b.count})</option>`).join('');
        $('categoryTop20Search').disabled = false;
        $('categoryTop20Clear').disabled = false;
        render();
      } catch (_) {
        if (current !== request) return;
        category = null;
        $('categoryTop20Count').textContent = 'ยังโหลดไม่ได้';
        $('categoryTop20Results').innerHTML = '<div class="error">ยังโหลดอันดับของหมวดนี้ไม่ได้<br><button id="categoryTop20Retry" type="button">ลองโหลดอีกครั้ง</button></div>';
        $('categoryTop20Retry').onclick = () => show(selectedId);
      } finally {
        if (current === request) $('categoryTop20Results').setAttribute('aria-busy', 'false');
      }
    }
    $('categoryTop20Search').addEventListener('input', event => search(event.target.value));
    $('categoryTop20Clear').addEventListener('click', () => search(''));
    $('categoryTop20Band')?.addEventListener('change', event => {band = event.target.value; render();});
    $('categoryTop20Sort')?.addEventListener('change', event => {mode = event.target.value; render();});
    if ($('categoryTop20Profile')) {
      $('categoryTop20Profile').innerHTML = ranking.profileOptions(profile);
      $('categoryTop20Profile').value = profile;
      $('categoryTop20Profile').addEventListener('change',event=>{
        profile=ranking.saveProfile(event.target.value);
        if ($('categoryTop20Formula')) $('categoryTop20Formula').innerHTML=channels.formulaHTML(profile);
        render();
      });
    }
    if ($('categoryTop20Formula')) $('categoryTop20Formula').innerHTML = channels.formulaHTML(profile);
    async function refresh() {
      if (!selectedId || !category) return;
      const current = ++request;
      try {
        const next = await load(true);
        if (current !== request) return;
        dataset = next;
        category = next.categories.find(c=>c.id===selectedId);
        render();
      } catch (_) {
        if (current !== request) return;
        category = {...category, items:category.items.map(i=>({...i, purchase_offers:[], value_specs:null}))};
        render();
        $('categoryTop20Meta').textContent = 'อัปเดตราคาไม่ได้ · พักอันดับความคุ้มค่าไว้ก่อน ระบบจะลองใหม่';
      }
    }
    return {show, search, refresh};
  }
  const api = {prepareDataset, createLoader, createController};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) {
    api.load = createLoader((...args) => root.fetch(...args));
    let controller;
    api.show = id => (controller ||= createController(root.document, api.load)).show(id);
    api.search = value => controller?.search(value);
    root.ShopeeCategoryCatalog = api;
    channels.watchChanges(()=>controller?.refresh());
  }
})(typeof window !== 'undefined' ? window : globalThis);
