(function (root) {
  'use strict';
  const ranking = root.ShopeeRanking || (typeof require === 'function' ? require('./shopee-ranking.js') : null);
  const rankingData = root.RankingData || (typeof require === 'function' ? require('./ranking-data.js') : null);
  const channels = root.RankingOffers || (typeof require === 'function' ? require('./ranking-offers.js') : null);
  const prepareDataset = rankingData.prepareDataset;

  function createController(doc, load) {
    const $ = id => doc.getElementById(id);
    let dataset, category, selectedId, query = '', band = 'all', mode = 'suitability', request = 0, profile = ranking.readProfile(), message = '';
    function applySnapshot(snapshot) {
      dataset = snapshot.dataset;
      message = snapshot.status === 'ready' ? '' : snapshot.message;
      category = dataset?.categories.find(c => c.id === selectedId);
      if (!category) {
        $('categoryTop20Search').disabled = $('categoryTop20Clear').disabled = true;
        $('categoryTop20Count').textContent = 'ยังโหลดไม่ได้';
        $('categoryTop20Meta').textContent = message;
        $('categoryTop20Results').innerHTML = '<div class="error">ยังโหลดอันดับของหมวดนี้ไม่ได้<br><button id="categoryTop20Retry" type="button">ลองโหลดอีกครั้ง</button></div>';
        $('categoryTop20Retry').onclick = () => show(selectedId, true);
        return;
      }
      if ($('categoryTop20Band')) {
        $('categoryTop20Band').innerHTML = '<option value="all">ทุกช่วงงบ</option>' + (category.price_bands || []).map(b => `<option value="${ranking.escapeHTML(b.id)}">${ranking.escapeHTML(b.label)} (${b.count})</option>`).join('');
        if (band !== 'all' && !category.price_bands?.some(b => b.id === band)) band = 'all';
        $('categoryTop20Band').value = band;
      }
      $('categoryTop20Search').disabled = $('categoryTop20Clear').disabled = false;
      render();
    }
    function render() {
      if (!category) return;
      const ordered = dataset.catalog_mode === 'smartphone_30' ? channels.orderItems(category.items,mode,Date.now(),profile) : category.items;
      const items = ranking.filterItems(ordered, query).filter(item => band === 'all' || item.price_band === band);
      $('categoryTop20Meta').innerHTML = (message ? `<strong role="status">${ranking.escapeHTML(message)}</strong><br>` : '') + ranking.readinessHTML(ordered,mode);
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
    async function show(id, refresh = false) {
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
      const snapshot = await load(refresh);
      if (current !== request) return;
      applySnapshot(snapshot);
      $('categoryTop20Results').setAttribute('aria-busy', 'false');
    }
    $('categoryTop20Search').addEventListener('input', event => search(event.target.value));
    $('categoryTop20Clear').addEventListener('click', () => search(''));
    $('categoryTop20Band')?.addEventListener('change', event => {band = event.target.value; render();});
    if ($('categoryTop20Sort')) $('categoryTop20Sort').value = mode;
    ranking.bindChoices(doc,'categoryTop20SortChoices','categoryTop20Sort',ranking.sortChoices,mode,value=>{mode=value;render();});
    $('categoryTop20Sort')?.addEventListener('change', event => {mode = event.target.value; render();});
    if ($('categoryTop20Profile')) {
      $('categoryTop20Profile').innerHTML = ranking.profileOptions(profile);
      $('categoryTop20Profile').value = profile;
      ranking.bindChoices(doc,'categoryTop20ProfileChoices','categoryTop20Profile',channels.profiles,profile,value=>{
        profile=ranking.saveProfile(value);
        if ($('categoryTop20Formula')) $('categoryTop20Formula').innerHTML=channels.formulaHTML(profile);
        render();
      });
      $('categoryTop20Profile').addEventListener('change',event=>{
        profile=ranking.saveProfile(event.target.value);
        if ($('categoryTop20Formula')) $('categoryTop20Formula').innerHTML=channels.formulaHTML(profile);
        render();
      });
    }
    if ($('categoryTop20Formula')) $('categoryTop20Formula').innerHTML = channels.formulaHTML(profile);
    async function refresh(snapshot) {
      if (!selectedId) return;
      const current = ++request;
      const next = snapshot || await load(true);
      if (current !== request) return;
      applySnapshot(next);
      $('categoryTop20Results').setAttribute('aria-busy', 'false');
    }
    return {show, search, refresh};
  }
  const api = {prepareDataset, createController};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) {
    const store = rankingData.create({fetcher:(...args) => root.fetch(...args), host:root});
    api.load = store.load;
    let controller;
    api.show = id => (controller ||= createController(root.document, api.load)).show(id);
    api.search = value => controller?.search(value);
    root.ShopeeCategoryCatalog = api;
    store.watch(snapshot=>controller?.refresh(snapshot));
  }
})(typeof window !== 'undefined' ? window : globalThis);
