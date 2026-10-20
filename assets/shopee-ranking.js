(function (root) {
  'use strict';
  const affiliate = root.ShopeeAffiliate || (typeof require === 'function' ? require('./affiliate-links.js') : null);
  const official = root.OfficialSpecs || (typeof require === 'function' ? require('./official-specs.js') : null);
  const channels = root.RankingOffers || (typeof require === 'function' ? require('./ranking-offers.js') : null);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 ? '—' : value.toLocaleString('th-TH', {maximumFractionDigits: 2});
  const money = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? `฿${number(value)}` : '—';
  const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('th-TH', {timeZone:'Asia/Bangkok', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}) : '—';
  function productUrl(item) {
    const key = `${item.shop_id}/${item.item_id}`;
    return /^[1-9]\d*\/[1-9]\d*$/.test(key) && item.product_url === `https://shopee.co.th/product/${key}` ? item.product_url : '';
  }
  function stalePrice(item, now = Date.now(), hours = 48) {
    const observed = Date.parse(item.observed_at);
    return !Number.isFinite(observed) || observed > now || now - observed > hours * 3600000;
  }
  function filterItems(items, term) {
    const query = term.trim().toLocaleLowerCase('th-TH');
    return items.filter(i => `${i.display_name || ""} ${i.title} ${i.shop_name}`.toLocaleLowerCase('th-TH').includes(query));
  }
  function officialHTML(specs) {
    const e = escapeHTML;
    if (!specs || specs.scope !== 'model_only' || !official?.validSource(specs.source, specs.brand) || !specs.fields?.length) {
      return '<div class="official-specs" data-official-status="pending"><span class="official-label">สเปกจากผู้ผลิต</span> <span aria-label="ยังไม่มีข้อมูลยืนยัน">—</span></div>';
    }
    return `<div class="official-specs" data-official-status="verified"><span class="official-label">สเปกจากผู้ผลิต · ${e(specs.model)}</span>
      <dl>${specs.fields.map(field => `<div><dt>${e(field.label)}</dt><dd>${e(field.value || '—')}</dd></div>`).join('')}
        <div><dt>ตัวเลือกที่ตรงกับราคา</dt><dd aria-label="ยังไม่มีข้อมูลยืนยัน">—</dd></div>
        <div><dt>การรับประกันของร้าน</dt><dd aria-label="ยังไม่มีข้อมูลยืนยัน">—</dd></div>
      </dl><a class="official-source" href="${e(specs.source.url)}" target="_blank" rel="noopener noreferrer">อ้างอิง ${e(specs.brand)} ↗</a><span class="official-checked"> · ตรวจ ${date(specs.source.checked_at)} น.${specs.source.market === 'Global' ? ' · ข้อมูลรุ่นสากล' : ''}</span>
    </div>`;
  }
  function purchaseHTML(item, now = Date.now(), hours = 48) {
    const e = escapeHTML;
    const reference = channels?.referencePrice(item,now);
    const referenceHTML = reference ? `<div class="reference-price"><div class="metric-label">ราคาต่ำสุดที่ผู้ดูแลพบ</div><div class="metric-value">${money(reference.price)}</div><div class="metric-caption">ราคาอ้างอิงสำหรับจัดอันดับ · ราคาที่ลิงก์ซื้ออาจต่างกัน<br>บันทึก ${date(reference.recorded_at)} น.${reference.stale ? '<br><span class="stale">เกิน 48 ชม. · ควรตรวจราคาใหม่</span>' : ''}${reference.variant ? `<br>ตัวเลือก: ${e(reference.variant)}` : '<br>ยังไม่ระบุตัวเลือก · รอจัดอันดับ'}${reference.note ? `<br>${e(reference.note)}` : ''}</div></div>` : '';
    const offers = item.purchase_offers ?? [channels?.defaultShopee(item)].filter(Boolean);
    const rows = offers.flatMap(offer => {
      if (!channels?.validURL(offer.url, offer.platform)) return [];
      const isShopee = offer.platform === 'shopee';
      const url = isShopee ? (affiliate?.build(offer.url, `ranking${item.item_id}`) || offer.url) : offer.url;
      const manual = offer.source === 'manual', feed = offer.source === 'shopee_affiliate_csv';
      const lookup = manual && offer.price_lookup?.confirmed && offer.price_lookup.requested_url === offer.url && offer.price_lookup.amount === offer.price && date(offer.price_lookup.checked_at) !== '—' ? offer.price_lookup : null;
      const stale = stalePrice(manual ? {observed_at:lookup?.checked_at || offer.recorded_at} : item, now, hours);
      const vip = !manual && isShopee && money(item.vip_reference?.amount) !== '—' && item.vip_reference?.variant && date(item.vip_reference?.observed_at) !== '—' ? item.vip_reference : null;
      const label = manual ? ({vip:'ราคา VIP / สมาชิก', coupon:'ราคามีเงื่อนไขคูปอง', flash_sale:'ราคาแฟลชเซล'}[offer.price_type] || (lookup ? 'ราคาที่ผู้ดูแลยืนยัน' : 'ราคาที่ผู้ดูแลกรอก')) : offer.source === 'awaiting_manual' ? 'ราคาหลังคูปอง' : feed ? 'ราคา sale_price ในฟีด' : 'ราคาแสดงตอนเก็บข้อมูล';
      const caption = money(offer.price) === '—' ? (reference ? 'ตรวจราคาและคูปองที่ปลายทาง' : item.manual_price_only ? 'รอกรอกราคาหลังคูปอง' : 'ยังไม่มีข้อมูลราคายืนยัน') : manual
        ? `${lookup ? 'อ่านจากหน้า' : 'บันทึก'} ${date(lookup?.checked_at || offer.recorded_at)} น.${stale ? ' · เกิน 48 ชม. — ตรวจราคาปัจจุบัน' : ''}`
        : feed ? 'เวลาอัปเดตราคาไม่ระบุ — ตรวจราคาปัจจุบัน' : stale ? 'ข้อมูลราคาเกิน 48 ชม. — ตรวจใหม่' : 'รอตรวจตัวเลือกและเงื่อนไข';
      return [`<div class="purchase-offer" data-platform="${e(offer.platform)}"><div class="offer-price"><div class="metric-label">${e(channels.names[offer.platform])} · ${label}</div><div class="metric-value">${money(offer.price)}</div><div class="metric-caption ${stale || feed ? 'stale' : ''}">${caption}</div>${manual && offer.price_type === 'flash_sale' ? '<div class="metric-caption">ตรวจราคาและสิทธิ์โปรโมชันที่หน้าร้าน</div>' : ''}${manual && offer.variant ? `<div class="metric-caption">ตัวเลือก: ${e(offer.variant)}</div>` : ''}${manual && offer.note ? `<div class="metric-caption">${e(offer.note)}</div>` : ''}${vip ? `<span class="vip">เคยตรวจราคา VIP ${money(vip.amount)}<br>${e(vip.variant)}<br>${date(vip.observed_at)} น.</span>` : ''}</div><a class="pdp-link" href="${e(url)}" target="_blank" rel="sponsored noopener noreferrer">ดูบน ${e(channels.names[offer.platform])} ↗</a></div>`];
    });
    return rows.length || referenceHTML ? `<div class="purchase-offers">${referenceHTML}${rows.join('')}</div>` : '';
  }
  function listingHTML(item, labels, review = false, now = Date.now(), hours = 48) {
    const e = escapeHTML, price = item.price || {}, sales = item.sales || {};
    const feed = item.source === 'shopee_affiliate_csv';
    const flags = item.review_flags || [];
    const manualCart = feed && item.purchase_offers?.some(o => o.platform === 'shopee' && o.source === 'manual');
    return `<article class="listing" data-listing-id="${e(item.listing_id)}" data-rank="${e(item.rank)}" data-sales="${e(sales.value)}">
      <div class="rank" aria-label="อันดับ ${e(item.rank ?? '—')}">${e(item.rank ?? '—')}</div>
      <div class="product"><h3>${e(item.display_name || item.title)}</h3>${item.value_result ? valueHTML(item) : ''}${item.price_band_label ? `<div class="shop">กลุ่มงบอ้างอิง: ${e(item.price_band_label)}</div>` : ''}<div class="shop">${feed ? 'ร้านต้นทางในฟีด' : 'ร้าน'} ${e(item.shop_name || '—')}</div>${flags.filter(f => ['preorder','repacked'].includes(f)).map(f => `<span class="flag">${e(labels[f])}</span>`).join('')}${channels?.researchedSpecs(item) ? channels.researchHTML(item.spec_research) : officialHTML(item.official_specs)}</div>
      <div class="sales"><div class="metric-label">${feed ? 'ยอดขายใน Product Feed' : 'ยอดขายที่ปลั๊กอินรายงาน'}</div><div class="metric-value">${number(sales.value)}</div><div class="metric-caption">${e(sales.raw)}<br><strong>ไม่ระบุช่วงเวลา</strong>${manualCart ? '<br>ตะกร้าซื้อเลือกโดยผู้ดูแล · ยอดขายข้างต้นอ้างอิงตะกร้าในฟีด' : ''}</div></div>
      ${purchaseHTML(item, now, hours)}
      <details class="listing-details" ${review ? 'open' : ''}><summary>หลักฐานและสิ่งที่ต้องตรวจเพิ่ม</summary>${item.display_name ? `<p>ชื่อหน้าสินค้าต้นทาง: ${e(item.title)}</p>` : ''}<ul>${flags.map(f => `<li>${e(labels[f] || f)}</li>`).join('')}</ul><p>${feed ? 'อ่านไฟล์เมื่อ' : 'เก็บเมื่อ'} ${date(item.observed_at)} น. (เวลาไทย) · แหล่งข้อมูล: ${feed ? 'Shopee Affiliate Product Feed' : 'ปลั๊กอิน Shopee'}</p><p>รหัสร้าน ${e(item.shop_id)} · รหัสสินค้า ${e(item.item_id)}${price.model_id ? ` · รหัสตัวเลือกที่ปลั๊กอินส่งมา ${e(price.model_id)} (ยังไม่จับคู่ชื่อตัวเลือก)` : ''}</p>${feed ? `<p>หมวดในฟีด: ${(item.category_path || []).map(p => `${e(p.name)} (${e(p.id)})`).join(' / ')}</p><p>ตัวเลือกในฟีด ${number(price.model_count)} ตัวเลือก; ราคา sale_price ยังไม่จับคู่กับตัวเลือก ไม่ใช้ราคาตัวเลือกอื่นแทนกัน</p>` : `<p>พบจากคำค้น: ${(item.queries || []).map(e).join(' · ')}</p>`}</details>
    </article>`;
  }
  function valueHTML(item) {
    const result = item.value_result, e = escapeHTML;
    if (result.score === null) return `<div class="value-summary pending">ความคุ้มค่า: รอข้อมูล<br><small>${e(result.reason)}</small></div>`;
    const specs = item.value_specs;
    return `<div class="value-summary"><strong>${result.score.toFixed(4)} คะแนน / 1,000 บาท</strong><br><small>สเปก ${result.spec_score.toFixed(2)}/100 ÷ ${money(result.price)} × 1,000 · ${result.price_source === 'manual_reference' ? 'ราคาต่ำสุดที่ผู้ดูแลพบ' : e(channels.names[result.platform])}<br>ตัวเลือก: ${e(result.variant)}</small><details><summary>สเปกที่ใช้คำนวณ</summary><ul>${channels.specMetrics.map(([key,label])=>`<li>${e(label)}: ${number(specs[key])}</li>`).join('')}</ul><a href="${e(specs.spec_url)}" target="_blank" rel="noopener noreferrer">แหล่งสเปก ↗</a> · <a href="${e(specs.benchmark_url)}" target="_blank" rel="noopener noreferrer">ผล Geekbench 6 ↗</a><small> · ผู้ดูแลยืนยัน ${date(specs.checked_at)} น.</small></details></div>`;
  }
  const api = {escapeHTML, productUrl, stalePrice, filterItems, officialHTML, purchaseHTML, listingHTML};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ShopeeRanking = api;
  if (!root.document || !root.document.getElementById('sourceSelect')) return;
  const $ = id => document.getElementById(id);
  let dataset, audit, activeCategory, review = false, loadSequence = 0;
  function categoryFromHash() {
    let hash = '';
    try { hash = decodeURIComponent(location.hash.slice(1)); } catch (_) { /* Invalid fragment falls back to the first category. */ }
    return dataset.categories.find(c => c.id === hash) || dataset.categories[0];
  }
  function render() {
    const c = activeCategory, mode = $('rankingSort').value;
    const ordered = channels.orderItems(c.items,mode);
    const items = filterItems(ordered, $('listingSearch').value).filter(i => $('budgetBand').value === 'all' || i.price_band === $('budgetBand').value), e = escapeHTML;
    $('rankingOrderLabel').textContent = mode === 'sales' ? 'เรียงยอดขายต้นทาง (ไม่ระบุช่วงเวลา)' : 'เรียงความคุ้มค่า · คะแนนสเปกต่อ 1,000 บาท';
    const feed = dataset.source === 'shopee_affiliate_csv';
    $('categoryTitle').textContent = `${c.icon} ${c.name}`;
    $('categoryMeta').textContent = `คัด ${c.listing_count} จาก ${number(c.sample_count)} รายการในหมวดต้นทาง · ${feed ? 'อ่านไฟล์' : 'เก็บล่าสุด'} ${date(c.observed_to)} น. · มีข้อมูลสเปกอ้างอิง ${c.items.filter(item => item.spec_research || item.official_specs).length}/${c.listing_count} รายการ`;
    $('resultCount').textContent = `${items.length} / ${c.listing_count} รายการ`;
    $('reviewView').textContent = `รายการที่ต้องตรวจเพิ่ม (${c.items.filter(i => i.review_flags.length).length})`;
    $('rankingView').classList.toggle('active', !review);
    $('reviewView').classList.toggle('active', review);
    $('rankingView').setAttribute('aria-pressed', String(!review));
    $('reviewView').setAttribute('aria-pressed', String(review));
    $('methodContent').innerHTML = c.selection_method ? `<p>${e(c.selection_method)}</p><p>ช่วงงบใช้ราคาอ้างอิงจากฟีดก่อนคูปอง เพื่อกระจายรุ่น ไม่ใช่ราคาปัจจุบัน ยอดขายเป็นของหน้าสินค้าต้นทางซึ่งอาจรวมหลายความจุหรือรุ่นย่อย ไม่รวมยอดต่างร้าน</p>` : feed
      ? `<p>อ่านไฟล์ครบ ${number(dataset.source_total_rows)} แถว พบ ${number(c.sample_count)} รายการในหมวดต้นทางที่จับคู่ ผ่านเกณฑ์ชื่อ ประเภท สต็อก และข้อมูล ${number(c.eligible_count)} รายการ แล้วเลือกยอด item_sold สูงสุด ${c.listing_count} รายการ${c.shortfall ? ` · ยังขาด ${c.shortfall} รายการ` : ''}</p><p>เป็นอันดับภายในไฟล์ที่ได้รับและผ่านเกณฑ์เท่านั้น ฟีดอาจมีเงื่อนไขคัดสินค้า ไม่มีจำนวนสินค้าทั้งตลาดให้คำนวณความครอบคลุม หมวดจับคู่ด้วยรหัสในฟีดและชื่อสินค้า ยังต้องตรวจความถูกต้องรายรายการ ยอดเท่ากันใช้อันดับร่วม และอ่านไฟล์ใหม่ไม่ได้แปลว่าราคาอัปเดตใหม่</p><ul class="query-list">${c.source_category_paths.map(p => `<li>${p.levels.filter(l => l.id).map(l => `${e(l.name)} (${e(l.id)})`).join(' / ')} · ${number(p.rows)} รายการ</li>`).join('')}</ul>`
      : `<p>ค้นหา ${c.queries.length} คำค้น ได้ ${c.sample_count} หน้าสินค้าที่ไม่ซ้ำ ผ่านการคัดหมวดและข้อมูล ${c.eligible_count} รายการ แล้วเลือกสูงสุด ${c.target_count} รายการ${c.shortfall ? ` · ยังขาด ${c.shortfall} รายการ` : ''} เก็บระหว่าง ${date(c.observed_from)} ถึง ${date(c.observed_to)} น.</p><p>เรียงด้วยตัวเลขยอดขายที่ปลั๊กอินส่งมา ยอดเท่ากันใช้อันดับร่วม คำค้นเป็นกลุ่มตัวอย่าง จึงอาจไม่ครอบคลุมสินค้าหรือแบรนด์อื่น</p><ul class="query-list">${c.queries.map(q => `<li>${e(q)}</li>`).join('')}</ul>`;
    $('rankingResults').innerHTML = (review ? '<p class="review-intro">รุ่นที่สเปก ราคา หรือตัวเลือกยังไม่ครบจะยังไม่มีอันดับความคุ้มค่า ยอดขายต้นทางยังแสดงประกอบตามเดิม</p>' : '') + (items.length ? `<div class="ranking-list">${items.map(i => listingHTML(i, dataset.reason_labels, review, Date.now(), dataset.price_ttl_hours)).join('')}</div>` : '<div class="empty">ไม่พบสินค้าในตัวกรองนี้ ลองใช้ชื่อรุ่นหรือร้านค้าอื่น</div>');
    const excluded = audit?.categories.find(a => a.category_id === c.id)?.excluded || [];
    $('excludedPanel').hidden = !review;
    const excludedTotal = audit?.categories.find(a => a.category_id === c.id)?.excluded_count ?? excluded.length;
    $('excludedSummary').textContent = audit ? `รายการที่แยกออกจากอันดับ (${number(excludedTotal)})${excludedTotal > excluded.length ? ` · แสดง ${excluded.length} รายการยอดสูงสุดสำหรับตรวจ` : ''}` : 'โหลดรายการที่แยกออกไม่ได้ — ลองโหลดหน้าใหม่';
    $('excludedItems').innerHTML = excluded.length ? excluded.map(i => `<div class="excluded-item"><strong>${e(dataset.reason_labels[i.reason] || i.reason)}</strong><p>${e(i.title)}</p>${i.note ? `<p>${e(i.note)}</p>` : ''}${/^https:\/\/shopee\.co\.th\/product\/[1-9]\d*\/[1-9]\d*$/.test(i.product_url || '') ? `<a href="${e(i.product_url)}" target="_blank" rel="noopener noreferrer">ตรวจหน้าสินค้า ↗</a>` : ''}</div>`).join('') : '<p>ไม่พบรายการที่แยกออกในหมวดนี้</p>';
  }
  function selectCategory() {
    activeCategory = categoryFromHash();
    $('categorySelect').value = activeCategory.id;
    $('listingSearch').value = '';
    $('budgetBand').innerHTML = '<option value="all">ทุกช่วงงบ</option>' + (activeCategory.price_bands || []).map(b => `<option value="${escapeHTML(b.id)}">${escapeHTML(b.label)} (${b.count})</option>`).join('');
    render();
  }
  async function readJSON(path) {
    const response = await fetch(path, {cache: 'no-store'});
    if (!response.ok) throw new Error(`โหลด ${path} ไม่สำเร็จ`);
    return response.json();
  }
  async function init() {
    const request = ++loadSequence;
    const source = 'feed'; // Only the current phone catalog is open to the public.
    $('sourceSelect').value = source;
    dataset = null;
    $('categorySelect').disabled = $('listingSearch').disabled = true;
    $('rankingResults').textContent = 'กำลังโหลดชุดข้อมูล…';
    try {
      const paths = source === 'feed' ? ['data/shopee_feed_rankings.json', 'data/shopee_feed_review.json'] : ['data/shopee_rankings.json', 'data/shopee_ranking_review.json'];
      const results = await Promise.allSettled([...paths, 'data/official_product_specs.json', 'data/ranking_manual_offers.json'].map(readJSON));
      if (request !== loadSequence) return;
      if (results[0].status !== 'fulfilled') throw results[0].reason;
      dataset = official.attach(results[0].value, results[2].status === 'fulfilled' ? results[2].value : null);
      dataset = channels.attach(dataset, results[3].status === 'fulfilled' ? results[3].value : null);
      if (!dataset.categories?.length) throw new Error('ยังไม่มีข้อมูลอันดับ');
      audit = results[1].status === 'fulfilled' ? results[1].value : null;
      const feed = dataset.source === 'shopee_affiliate_csv';
      $('sourceLabel').textContent = feed ? 'SHOPEE · PRODUCT FEED' : 'SHOPEE · ผลค้นหาจากปลั๊กอิน';
      $('scopeDescription').textContent = dataset.catalog_mode === 'smartphone_30' ? '30 รุ่นไม่ซ้ำ คัดกระจาย 6 ช่วงงบจากไฟล์ Shopee ที่ได้รับ ใช้ยอดขายต้นทางประกอบการคัดเลือกและเรียงลำดับในชุดนี้' : feed ? `คัดจากไฟล์ Product Feed ที่อ่านครบ ${number(dataset.source_total_rows)} รายการ ใช้ยอด item_sold ภายในหมวดที่จับคู่และผ่านเกณฑ์ ยังไม่ยืนยันว่าฟีดครอบคลุมสินค้าทั้ง Shopee` : 'จัดอันดับภายในผลค้นหาที่เก็บได้ โดยใช้ตัวเลขยอดขายที่ปลั๊กอินรายงานต่อหน้าสินค้า เป็นกลุ่มตัวอย่างจากคำค้น';
      $('sourceFooter').textContent = feed ? 'แหล่งข้อมูล: Shopee Affiliate Product Feed · ราคาและยอดขายจาก CSV' : 'แหล่งข้อมูล: ผลค้นหาจากปลั๊กอิน Shopee';
      $('datasetStats').innerHTML = `<span><strong>${number(dataset.category_count)}</strong> หมวดสินค้า</span><span><strong>${number(dataset.listing_count)}</strong> รายการที่จัดอันดับ</span>${feed ? `<span>ฐานฟีด ${number(dataset.source_total_rows)} รายการ</span>` : ''}<span>${feed ? 'อ่านไฟล์' : 'เก็บล่าสุด'} ${date(dataset.observed_to)} น.</span>`;
      $('categorySelect').innerHTML = dataset.categories.map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.icon)} ${escapeHTML(c.name)} (${c.listing_count})</option>`).join('');
      $('categorySelect').disabled = $('listingSearch').disabled = false;
      selectCategory();
    } catch (error) {
      if (request !== loadSequence) return;
      $('datasetStats').textContent = 'ยังโหลดข้อมูลไม่ได้';
      $('categoryTitle').textContent = 'ยังโหลดอันดับไม่ได้';
      $('rankingResults').innerHTML = '<div class="error">ไม่สามารถโหลดข้อมูลอันดับได้ กรุณาลองอีกครั้ง<br><button id="retryLoad">ลองใหม่</button></div>';
      $('retryLoad').onclick = init;
    }
  }
  $('sourceSelect').addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('source', $('sourceSelect').value);
    history.replaceState(null, '', url);
    init();
  });
  $('budgetBand').addEventListener('change', render);
  $('rankingSort').addEventListener('change', render);
  $('valueFormula').innerHTML = channels.formulaHTML();
  channels.watchChanges(async () => {
    if (!dataset) return;
    let registry = null;
    try { registry = await readJSON('data/ranking_manual_offers.json'); } catch (_) { /* Fail closed until the next refresh. */ }
    dataset = channels.attach(dataset,registry);
    activeCategory = dataset.categories.find(c=>c.id===activeCategory.id);
    render();
  });
  $('categorySelect').addEventListener('change', () => { location.hash = $('categorySelect').value; });
  $('listingSearch').addEventListener('input', () => { if (dataset) render(); });
  $('rankingView').addEventListener('click', () => { if (dataset) { review = false; render(); } });
  $('reviewView').addEventListener('click', () => { if (dataset) { review = true; render(); } });
  root.addEventListener('hashchange', () => { if (dataset) selectCategory(); });
  init();
})(typeof window !== 'undefined' ? window : globalThis);
