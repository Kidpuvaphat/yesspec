(function () {
  'use strict';
  const $ = id => document.getElementById(id), names = RankingOffers.names;
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields = ['url','price','price_type','variant','note'];
  const drafts = new Map();
  const saveFeedback = new Map();
  let categories = [], rows = new Map(), busy = false;
  const profileKey = 'yesspec_usage_profile_v2';
  const validProfile = id => RankingOffers.profiles.some(p=>p.id===id) ? id : 'balanced';
  let profile = 'balanced';
  try { profile=validProfile(localStorage.getItem(profileKey)); } catch (_) {}
  const profileLabel = () => RankingOffers.profiles.find(p=>p.id===profile)?.label || 'สมดุล';
  const token = () => localStorage.getItem('yesspec_admin_token') || '';
  const status = (message, target) => {
    $('status').textContent = message;
    $('status').hidden = !!target;
    if (target) target.textContent = message;
  };
  const feedback = (card, area, platform) => card?.querySelector?.(platform ? `[data-channel="${platform}"] [data-feedback="${area}"]` : `[data-feedback="${area}"]`);
  const formOffer = offer => ({...Object.fromEntries(fields.map(k => [k, String(offer?.[k] ?? (k === 'price_type' ? 'regular' : ''))])), price_lookup:offer?.price_lookup || null});
  const specFields = [...RankingOffers.specMetrics.map(([key])=>key), 'variant','spec_url','benchmark_url'];
  const formSpecs = specs => ({...Object.fromEntries(specFields.map(key=>[key,String(specs?.[key] ?? '')])), verified:specs?.verified === true});
  const formReference = row => ({price:String(row.reference_price?.price ?? ''),
    variant:String(row.reference_price?.variant ?? row.value_specs?.variant ?? ''),
    note:String(row.reference_price?.note ?? '')});
  function getDraft(row) {
    saveFeedback.delete(row.listing_id);
    if (!drafts.has(row.listing_id)) drafts.set(row.listing_id, {revision:row.revision, reset:[], reconfirm:[], reference_reconfirm:false, reference_price:formReference(row), offers:Object.fromEntries(Object.keys(names).map(p => [p, formOffer(row.offers[p])])), value_specs:formSpecs(row.value_specs)});
    return drafts.get(row.listing_id);
  }
  function changes(row) {
    const draft = drafts.get(row.listing_id);
    if (!draft) return null;
    const offers = Object.fromEntries(Object.keys(names).filter(p => !draft.reset.includes(p) && (draft.reconfirm.includes(p) || JSON.stringify(draft.offers[p]) !== JSON.stringify(formOffer(row.offers[p])))).map(p => [p, draft.offers[p]]));
    const specChanged = JSON.stringify(draft.value_specs) !== JSON.stringify(formSpecs(row.value_specs));
    const referenceChanged = draft.reference_reconfirm || JSON.stringify(draft.reference_price) !== JSON.stringify(formReference(row));
    return Object.keys(offers).length || draft.reset.length || specChanged || referenceChanged ? {listing_id:row.listing_id, revision:draft.revision, offers, reset:draft.reset, ...(specChanged ? {value_specs:draft.value_specs} : {}), ...(referenceChanged ? {reference_price:draft.reference_price} : {})} : null;
  }
  function renderReference(row) {
    const value = drafts.get(row.listing_id)?.reference_price || formReference(row);
    const prefix = row.listing_id.replace('/', '-') + '-reference';
    const input = (key,label,type='text') => `<label for="${prefix}-${key}">${label}<input id="${prefix}-${key}" data-reference="${key}" type="${type}" ${type === 'number' ? 'min="0.01" max="100000000" step="0.01" inputmode="decimal"' : 'maxlength="500"'} value="${e(value[key])}"></label>`;
    return `<section class="reference-editor"><h3>ราคาต่ำสุดที่พบ</h3><p class="muted">ใช้จัดอันดับได้โดยไม่ต้องมีลิงก์ซื้อ · ระบุ RAM / ความจุให้ตรงกับสเปก</p><div class="pair">${input('price','ราคาที่พบ (บาท)','number')}${input('variant','ตัวเลือกของราคานี้ เช่น RAM 8GB / ROM 128GB')}</div>${input('note','เงื่อนไข / ที่มาของราคา (ถ้ามี)')}<p class="muted">ราคาอ้างอิงสำหรับจัดอันดับ · ราคาที่ลิงก์ซื้ออาจต่างกัน${row.reference_price?.recorded_at ? '<br>บันทึกล่าสุด '+e(new Date(row.reference_price.recorded_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})) : ''}</p><details class="reference-options"><summary>ยืนยันราคาเดิม / ล้างราคา</summary><div class="channel-actions"><button type="button" data-reference-reconfirm>ตรวจแล้ว ราคายังเท่าเดิม</button><button type="button" data-reference-clear>ล้างราคาอ้างอิง</button></div><small class="muted">ใช้ราคาอ้างอิงจนกว่าจะแก้หรือล้างค่า หากเว้นว่างจะใช้ราคาตะกร้าที่ตรงตัวเลือกและยังไม่เกิน 48 ชั่วโมงแทน</small></details><p class="action-feedback" data-feedback="reference" role="status" aria-live="polite"></p></section>`;
  }
  function updateDirty() {
    const count = [...rows.values()].filter(changes).length;
    $('saveAll').disabled = busy || !count;
    $('saveAll').textContent = count ? `บันทึก ${count} รายการที่แก้ไข` : 'บันทึกที่แก้ไข';
    $('dirtyCount').textContent = busy ? 'กำลังบันทึก…' : count ? `ยังไม่บันทึก ${count} รายการ · อันดับยังใช้ราคาที่บันทึกแล้ว` : 'ไม่มีการแก้ไขค้างอยู่';
    document.querySelectorAll('.product-card').forEach(card => {
      const dirty = !!changes(rows.get(card.dataset.id));
      card.classList.toggle('dirty', dirty);
      card.querySelector('[data-save]').disabled = busy || !dirty;
      card.querySelectorAll('[data-check]').forEach(button => {
        const url = card.querySelector(`[data-platform="${button.dataset.check}"][data-field="url"]`).value;
        button.disabled = busy || !RankingOffers.validURL(url,button.dataset.check);
      });
      card.querySelector('.card-footer .card-message').textContent = saveFeedback.get(card.dataset.id) || (dirty ? 'ยังไม่บันทึก · บันทึกเพื่อคำนวณอันดับใหม่' : '');
    });
  }
  function renderChannel(row, platform, value) {
    const key = row.listing_id.replace('/', '-'), prefix = `${key}-${platform}`;
    const input = (field, label, type = 'text') => `<label for="${prefix}-${field}">${label}<input id="${prefix}-${field}" type="${type}" ${type === 'number' ? 'min="0.01" step="0.01" inputmode="decimal"' : 'maxlength="'+(field === 'url' ? '4096' : '500')+'"'} ${type === 'url' ? 'inputmode="url" autocapitalize="none" spellcheck="false" autocomplete="off"' : ''} data-platform="${platform}" data-field="${field}" value="${e(value[field])}"></label>`;
    const safe = RankingOffers.validURL(value.url, platform);
    return `<section class="channel" data-channel="${platform}" aria-label="${names[platform]}"><h3>${names[platform]}</h3>${input('url','ลิงก์ตะกร้า / Affiliate','url')}<p class="action-feedback" data-feedback="url" role="status" aria-live="polite"></p><div class="pair">${input('price','ราคาของตะกร้านี้ (บาท · เว้นได้)','number')}<label for="${prefix}-price_type">ประเภทราคา<select id="${prefix}-price_type" data-platform="${platform}" data-field="price_type">${[['regular','ราคาปกติ'],['vip','VIP / สมาชิก'],['coupon','มีเงื่อนไขคูปอง'],['flash_sale','แฟลชเซล']].map(([v,l]) => `<option value="${v}" ${value.price_type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>${input('variant','ตัวเลือก / ความจุ / ขนาด (ถ้าทราบ)')}${input('note','เงื่อนไขคูปอง / โปรโมชัน (ถ้ามี)')}<div class="channel-actions"><a data-open="${platform}" ${safe ? `href="${e(safe)}"` : 'hidden'} target="_blank" rel="noopener noreferrer">เปิดตะกร้า ↗</a><button type="button" data-check="${platform}" ${safe ? '' : 'disabled'}>ตรวจราคาจากลิงก์</button><button type="button" data-reconfirm="${platform}">ยืนยันราคาที่ตรวจอีกครั้ง</button><button type="button" data-clear="${platform}">ลบลิงก์ / ซ่อนช่องทาง</button>${platform === 'shopee' ? '<button type="button" data-reset="shopee">คืนลิงก์ต้นทาง / ล้างราคา</button>' : ''}</div><p class="action-feedback" data-feedback="actions" role="status" aria-live="polite"></p><small>${row.offers[platform]?.price_lookup ? 'อ่านจากหน้าสินค้า '+e(new Date(row.offers[platform].price_lookup.checked_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}))+' · ผู้ดูแลยืนยันแล้ว' : row.offers[platform]?.source === 'shopee_affiliate_csv' ? 'ข้อมูลเริ่มต้นจากฟีด · ยังไม่ทราบเวลาอัปเดตราคา' : row.offers[platform]?.recorded_at ? 'บันทึกล่าสุด '+e(new Date(row.offers[platform].recorded_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})) : value.url ? 'รอกรอกราคาหลังคูปอง · เว้นว่างไว้ได้' : 'เว้นว่างไว้ได้ ช่องทางนี้จะยังไม่แสดง'}</small></section>`;
  }
  function renderSpecs(row) {
    const specs = drafts.get(row.listing_id)?.value_specs || formSpecs(row.value_specs);
    const input = (key,label,type='text') => `<label>${label}<input data-spec="${key}" type="${type}" ${type === 'number' ? 'min="0.01" max="100000" step="any" inputmode="decimal"' : 'maxlength="4096"'} value="${e(specs[key])}"></label>`;
    return `<details class="value-spec-editor"><summary>สเปกสำหรับคำนวณความคุ้มค่า · ${specs.verified ? 'ยืนยันแล้ว' : 'รอกรอก / ยืนยัน'}</summary><p class="muted">ยืนยัน RAM ความจุ ชื่อตัวเลือก และลิงก์สเปกให้ตรงกับราคา · ข้อมูลอื่นที่ไม่ทราบเว้นว่างเพื่อใช้ค่าประมาณ หากกรอก Geekbench ต้องเป็นเวอร์ชัน 6 ของรุ่นนี้และมีลิงก์ผลทดสอบ</p>${RankingOffers.researchHTML(row.spec_research)}${row.spec_research?.memory_options?.length > 1 ? `<label>เลือก RAM / ความจุจากสเปกทางการ<select data-memory-option><option value="">เลือกให้ตรงกับสินค้าที่จะกรอกราคา</option>${row.spec_research.memory_options.map((o,index)=>`<option value="${index}">${e(o.label)}</option>`).join('')}</select></label>` : ''}<p class="action-feedback" data-feedback="specs" role="status" aria-live="polite"></p><div class="spec-grid">${RankingOffers.specMetrics.map(([key,label])=>input(key,label,'number')).join('')}${input('variant','ตัวเลือกที่สเปกนี้อ้างอิง เช่น RAM 8GB / ROM 128GB')}${input('spec_url','ลิงก์สเปกอ้างอิง HTTPS','url')}${input('benchmark_url','ลิงก์ผลทดสอบ browser.geekbench.com/v6/cpu/...','url')}</div><label class="spec-confirm"><input data-spec="verified" type="checkbox" ${specs.verified ? 'checked' : ''}>ฉันตรวจแหล่งอ้างอิงแล้ว ข้อมูลที่กรอกตรงรุ่นและตัวเลือกที่ระบุ (หากกรอก Geekbench ต้องเป็นผลของรุ่นนี้) · ช่องที่เว้นใช้ค่าประมาณ</label></details>`;
  }
  function render() {
    const category = categories.find(c => c.id === $('category').value);
    if (!category) return;
    const q = $('search').value.trim().toLowerCase(), filter = $('filter').value, band = $('budgetBand').value;
    const bandOptions = '<option value="all">ทุกช่วงงบ</option>' + (category.price_bands || []).map(b => `<option value="${e(b.id)}">${e(b.label)} (${b.count})</option>`).join('');
    if ($('budgetBand').innerHTML !== bandOptions) { $('budgetBand').innerHTML = bandOptions; $('budgetBand').value = (category.price_bands || []).some(b => b.id === band) ? band : 'all'; }
    const mode = $('rankingSort').value;
    const ordered = RankingOffers.orderItems(category.items.map(row=>({...row,purchase_offers:Object.entries(row.offers).filter(([,o])=>o).map(([platform,o])=>({...o,platform}))})),mode,Date.now(),profile);
    const visible = ordered.filter(row => `${row.title} ${row.shop_name}`.toLowerCase().includes(q) && ($('budgetBand').value === 'all' || row.price_band === $('budgetBand').value) && (filter === 'all' || (filter === 'unranked' ? row.rank === null : filter === 'provisional' ? row.value_result.provisional : filter === 'benchmark_pending' ? !(row.value_specs?.geekbench6_single && row.value_specs?.geekbench6_multi && row.value_specs?.benchmark_url) : filter === 'specs_pending' ? !row.value_specs?.verified : filter === 'unpriced' ? !(Number(drafts.get(row.listing_id)?.reference_price.price ?? row.reference_price?.price) > 0 || Object.keys(names).some(p=>Number(drafts.get(row.listing_id)?.offers[p]?.price ?? row.offers[p]?.price) > 0)) : !(drafts.get(row.listing_id)?.offers[filter]?.url ?? row.offers[filter]?.url))));
    const orderLabel = mode==='sales'?'ยอดขายต้นทาง · ไม่ระบุช่วงเวลา':`${mode==='suitability'?'คะแนนเหมาะกับการใช้งาน':'ความคุ้มค่า'} · ${profileLabel()} · จัดอันดับได้ ${ordered.filter(i=>i.rank!=null).length} รุ่น (ชั่วคราว ${ordered.filter(i=>i.rank!=null&&i.value_result?.provisional).length})`;
    $('count').textContent = `${visible.length} / ${category.items.length} รุ่น · ${orderLabel}`;
    const activeFilters = Number($('budgetBand').value !== 'all') + Number(filter !== 'all');
    $('filterSummary').textContent = `ตัวกรองเพิ่มเติม${activeFilters ? ` (${activeFilters})` : ''}`;
    $('valueFormula').innerHTML = RankingOffers.formulaHTML(profile);
    $('products').innerHTML = visible.map((row, index) => {
      const values = drafts.get(row.listing_id)?.offers || Object.fromEntries(Object.keys(names).map(p => [p,formOffer(row.offers[p])]));
      const active = Object.keys(names).filter(p => values[p].url).map(p => names[p]).join(' · ') || 'ยังไม่มีช่องทางซื้อ';
      const score = row.value_result, suitability = row.score_kind==='suitability', decimals = suitability?2:4;
      const measured=score.measured_coverage??0,proxy=score.proxy_coverage??score.coverage??0,missing=score.missing_coverage??Math.max(0,100-(score.coverage||0));
      const evidence=`<br>ผลทดสอบ ${measured.toFixed(1)}% · ประมาณจากสเปก ${proxy.toFixed(1)}% · ขาดข้อมูล ${missing.toFixed(1)}%`;
      const provisional=score.provisional||proxy>0||missing>0;
      const scoreSummary = (!Number.isFinite(score.score)?`รอข้อมูล · ${e(score.reason)}`:`${suitability?'คะแนนเหมาะกับการใช้งาน':'ความคุ้มค่า'} · ${e(profileLabel())} ${score.score.toFixed(decimals)}${suitability?' / 100':' คะแนน / 1,000 บาท'}${provisional?` · <span class="score-provisional">${mode!=='sales'&&row.rank!=null?'อันดับชั่วคราว · ':''}คะแนนประมาณการ</span>`:' · คะแนนจากผลทดสอบ'}${missing>0&&Number.isFinite(score.score_low)&&Number.isFinite(score.score_high)?`<br>ช่วงจากข้อมูลที่ขาด ${score.score_low.toFixed(decimals)}–${score.score_high.toFixed(decimals)}`:''}`)+evidence;
      const savedPrice = Number(row.reference_price?.price);
      const compactScore = mode === 'sales' ? 'ยอดขายต้นทาง · ไม่ระบุช่วงเวลา' : row.rank === null ? 'รอข้อมูลสำหรับจัดอันดับ' : `${suitability ? 'เหมาะสม' : 'คุ้มค่า'} ${score.score.toFixed(decimals)}${suitability ? ' / 100' : ' / 1,000 บาท'}${provisional ? ' · อันดับชั่วคราว' : ''}`;
      return `<details class="product-card" data-id="${row.listing_id}" ${index === 0 || saveFeedback.has(row.listing_id) ? 'open' : ''}><summary><span class="number">${row.rank ?? '—'}</span><div class="product-identity"><div class="product-title">${e(row.title)}</div><div class="product-meta">${e(row.price_band_label)} · ${e(compactScore)}</div></div><div class="summary-price">${savedPrice > 0 ? `<strong>฿${savedPrice.toLocaleString('th-TH',{maximumFractionDigits:2})}</strong><span>ราคาอ้างอิงที่บันทึก</span>` : '<span class="awaiting-price">รอกรอกราคาอ้างอิง</span>'}</div><span class="expand-label" aria-hidden="true">แก้ไข</span></summary><form data-product-form>${renderReference(row)}<div class="card-footer"><span class="card-message" role="status"></span><button type="submit" class="primary" data-save>บันทึกและคำนวณอันดับ</button></div>${row.needs_review.length ? '<p class="card-message">ชื่อหรือตัวเลือกในฟีดเปลี่ยน กรุณาจับคู่ตะกร้าใหม่</p>' : ''}<details class="score-overview"><summary>คะแนนและข้อมูลที่ยังขาด${provisional ? ' · คะแนนประมาณการ' : ''}</summary><p class="score-summary">${scoreSummary}</p>${RankingOffers.scoreDetailsHTML(score)}</details><details class="purchase-editor"><summary>ลิงก์ซื้อ / Affiliate <span class="muted">· ${e(active)}</span></summary><p class="muted">กรอกภายหลังได้ · ร้านในฟีด: ${e(row.shop_name)}</p><div class="channels">${Object.keys(names).map(p => renderChannel(row,p,values[p])).join('')}</div></details>${renderSpecs(row)}</form></details>`;
    }).join('') || '<p>ไม่พบรายการตามตัวกรองนี้</p>';
    updateDirty();
  }
  function loggedOut() {
    checks.close();
    localStorage.removeItem('yesspec_admin_token');
    $('dashboard').hidden = $('logout').hidden = true; $('loginPanel').hidden = false;
    status('กรุณาเข้าสู่ระบบเพื่อจัดการลิงก์และราคา');
  }
  async function api(path, data, options = {}) {
    const res = await fetch(path, {cache:'no-store', ...options, headers:{'Content-Type':'application/json', 'X-Admin-Token':token()}, ...(data ? {method:'POST',body:JSON.stringify(data)} : {})});
    if (res.status === 401) { loggedOut(); throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); }
    const result = await res.json();
    if (!res.ok || !result.ok) throw new Error(result.error || 'โหลดข้อมูลไม่ได้');
    return result;
  }
  async function load(message = '') {
    if (!token()) { loggedOut(); return; }
    try {
      const selected = $('category').value, data = await api('/api/admin/ranking-products');
      categories = data.categories; rows = new Map(categories.flatMap(c => c.items.map(row => [row.listing_id,row])));
      $('category').innerHTML = categories.map(c => `<option value="${e(c.id)}">${e(c.icon)} ${e(c.name)} (${c.items.length})</option>`).join('');
      $('categoryField').hidden = categories.length <= 1;
      if (categories.some(c => c.id === selected)) $('category').value = selected;
      $('total').textContent = `${data.total} รุ่น · กรอกราคาที่พบ แล้วบันทึกเพื่อคำนวณอันดับใหม่`;
      $('dashboard').hidden = $('logout').hidden = false; $('loginPanel').hidden = $('retry').hidden = true;
      render(); status(message);
    } catch (error) { status(error.message === 'Failed to fetch' ? 'ติดต่อหลังบ้านไม่ได้ กรุณาตรวจว่า Admin API ทำงานอยู่' : error.message); $('retry').hidden = false; }
  }
  async function save(selected) {
    if (busy) return;
    const products = selected.map(changes).filter(Boolean);
    if (!products.length) return;
    const showSaveError = message => {
      products.forEach(product => saveFeedback.set(product.listing_id,message));
      status(message); updateDirty();
    };
    for (const product of products) {
      const price = product.reference_price?.price;
      if (price && (!Number.isFinite(Number(price)) || Number(price) <= 0 || Number(price) > 100000000)) {
        showSaveError('ราคาต่ำสุดที่พบต้องมากกว่า 0 หรือเว้นว่างไว้'); return;
      }
    }
    for (const product of products) for (const [p, v] of Object.entries(product.offers)) {
      if (v.url && !RankingOffers.validURL(v.url,p)) { showSaveError(`ลิงก์ตะกร้า ${names[p]} ไม่ถูกต้อง กรุณาตรวจช่องที่กรอก`); return; }
      if (v.url && v.price && (!Number.isFinite(Number(v.price)) || Number(v.price) <= 0)) { showSaveError('ราคาต้องมากกว่า 0 หรือเว้นว่างไว้'); return; }
    }
    busy = true;
    updateDirty();
    document.querySelectorAll('#dashboard input, #dashboard select, #dashboard button').forEach(el => {el.disabled = true;});
    try {
      const result = await api('/api/admin/save-ranking-offers', {products});
      saveFeedback.clear();
      products.forEach(p => { drafts.delete(p.listing_id); saveFeedback.set(p.listing_id,'บันทึกและคำนวณอันดับใหม่แล้ว'); });
      try { localStorage.setItem('yesspec_offers_updated',String(Date.now())); } catch (_) { /* A saved price must still refresh when browser storage is unavailable. */ }
      await load(`บันทึก ${result.updated_count} รายการและคำนวณอันดับใหม่แล้ว`);
    } catch (error) {
      products.forEach(p => saveFeedback.set(p.listing_id,error.message+' · ยังไม่บันทึก ข้อมูลยังอยู่ในฟอร์ม'));
      status(error.message+' · ข้อมูลที่แก้ไขยังอยู่ในฟอร์ม');
    }
    finally { busy = false; document.querySelectorAll('#dashboard input, #dashboard select, #dashboard button').forEach(el => {el.disabled = false;}); updateDirty(); }
  }
  $('products').addEventListener('input', event => {
    const target = event.target, card = target.closest('.product-card');
    if (!card || busy) return;
    target.closest('.channel, .reference-editor, .value-spec-editor')?.querySelectorAll?.('.action-feedback')?.forEach(message => { message.textContent = ''; });
    if (target.dataset.reference) {
      const draft = getDraft(rows.get(card.dataset.id));
      draft.reference_price[target.dataset.reference] = target.value;
      updateDirty(); return;
    }
    if (target.hasAttribute('data-memory-option')) {
      const row = rows.get(card.dataset.id);
      const option = target.value === '' ? null : row.spec_research?.memory_options?.[Number(target.value)];
      if (!option) return;
      const draft = getDraft(row);
      for (const key of ['ram_gb','storage_gb']) {
        draft.value_specs[key] = String(option[key] ?? '');
        card.querySelector(`[data-spec="${key}"]`).value = draft.value_specs[key];
      }
      if (!draft.reference_price.price) {
        draft.reference_price.variant = option.label;
        card.querySelector('[data-reference="variant"]').value = option.label;
      }
      draft.value_specs.variant = option.label;
      card.querySelector('[data-spec="variant"]').value = option.label;
      draft.value_specs.verified = false;
      card.querySelector('[data-spec="verified"]').checked = false;
      status('เลือกความจุแล้ว · ตรวจสเปกและยืนยัน ใช้ชื่อตัวเลือกเดียวกันในช่องราคา แล้วบันทึก', feedback(card,'specs'));
      updateDirty(); return;
    }
    if (target.dataset.spec) {
      const draft = getDraft(rows.get(card.dataset.id));
      draft.value_specs[target.dataset.spec] = target.type === 'checkbox' ? target.checked : target.value;
      if (target.dataset.spec !== 'verified') {
        draft.value_specs.verified = false;
        card.querySelector('[data-spec="verified"]').checked = false;
      }
      updateDirty(); return;
    }
    if (!target.dataset.field) return;
    const draft = getDraft(rows.get(card.dataset.id)), pf = target.dataset.platform;
    draft.reset = draft.reset.filter(p => p !== pf);
    if (target.dataset.field === 'url' && draft.offers[pf].url.trim() !== target.value.trim()) {
      // Prices and conditions belong to the old cart until the new cart is checked.
      draft.offers[pf] = formOffer(null);
      for (const field of fields.filter(f => f !== 'url')) {
        card.querySelector(`[data-platform="${pf}"][data-field="${field}"]`).value = draft.offers[pf][field];
      }
      status('เปลี่ยนลิงก์ตะกร้าแล้ว · กรอกหรือตรวจราคาของลิงก์ใหม่ แล้วกดบันทึกเพื่อเปลี่ยนปุ่มซื้อบนเว็บ', feedback(card,'url',pf));
    }
    draft.offers[pf][target.dataset.field] = target.value;
    draft.offers[pf].price_lookup = null;
    if (target.dataset.field === 'url') {
      const link = card.querySelector(`[data-open="${pf}"]`), safe = RankingOffers.validURL(target.value,pf);
      link.hidden = !safe; if (safe) link.href = safe; else link.removeAttribute('href');
    }
    updateDirty();
  });
  $('products').addEventListener('click', event => {
    if ((event.target.hasAttribute('data-reference-clear') || event.target.hasAttribute('data-reference-reconfirm')) && !busy) {
      const card = event.target.closest('.product-card'), row = rows.get(card.dataset.id), draft = getDraft(row);
      if (event.target.hasAttribute('data-reference-clear')) {
        draft.reference_price = {price:'',variant:draft.value_specs.variant,note:''};
        draft.reference_reconfirm = false;
        card.querySelector('.reference-editor').outerHTML = renderReference(row);
        status('ล้างราคาอ้างอิงในฟอร์มแล้ว · กดบันทึกเพื่อคำนวณอันดับใหม่', feedback(card,'reference'));
      } else {
        if (!(Number(draft.reference_price.price)>0)) { status('กรอกราคาต่ำสุดที่พบก่อนยืนยัน', feedback(card,'reference')); return; }
        draft.reference_reconfirm = true;
        status('ยืนยันราคาที่ตรวจแล้ว · กดบันทึกเพื่ออัปเดตเวลาราคาอ้างอิง', feedback(card,'reference'));
      }
      updateDirty(); return;
    }
    if (event.target.dataset.check && !busy) {
      const card = event.target.closest('.product-card'), row = rows.get(card.dataset.id), platform = event.target.dataset.check;
      const offer = drafts.get(row.listing_id)?.offers[platform] || formOffer(row.offers[platform]);
      if (!RankingOffers.validURL(offer.url,platform)) {status('กรุณาใส่ลิงก์ตะกร้าให้ตรงช่องก่อนตรวจราคา', feedback(card,'actions',platform));return;}
      checks.open({listing_id:row.listing_id,revision:row.revision,title:row.title,platform,offer:{...offer}});
      return;
    }
    if (event.target.dataset.reconfirm && !busy) {
      const card = event.target.closest('.product-card'), row = rows.get(card.dataset.id), pf = event.target.dataset.reconfirm;
      const draft = getDraft(row), value = draft.offers[pf];
      if (!RankingOffers.validURL(value.url,pf) || !(Number(value.price)>0)) { status('กรอกลิงก์และราคาที่ตรวจพบก่อนยืนยัน', feedback(card,'actions',pf)); return; }
      draft.reset = draft.reset.filter(p=>p!==pf);
      if (!draft.reconfirm.includes(pf)) draft.reconfirm.push(pf);
      value.price_lookup = null;
      updateDirty(); status('ยืนยันราคาที่ตรวจแล้ว · กดบันทึกเพื่ออัปเดตเวลาและคำนวณอันดับใหม่', feedback(card,'actions',pf));
      return;
    }
    const clear = event.target.dataset.clear, reset = event.target.dataset.reset;
    if ((!clear && !reset) || busy) return;
    const card = event.target.closest('.product-card'), row = rows.get(card.dataset.id), draft = getDraft(row), pf = clear || reset;
    draft.offers[pf] = formOffer(reset ? row.feed_offer : null);
    draft.reset = draft.reset.filter(p => p !== pf); if (reset) draft.reset.push(pf);
    // Update this form in place so other open cards and unsaved inputs stay intact.
    const channel = event.target.closest('.channel');
    channel.outerHTML = renderChannel(row,pf,draft.offers[pf]); updateDirty();
    status(reset ? 'คืนลิงก์ต้นทางและล้างราคาในฟอร์มแล้ว · กดบันทึกเพื่ออัปเดตช่องทางซื้อ' : 'ลบลิงก์ในฟอร์มแล้ว · กดบันทึกเพื่อซ่อนช่องทางซื้อ', feedback(card,'actions',pf));
  });
  $('products').addEventListener('submit', event => {event.preventDefault(); save([rows.get(event.target.closest('.product-card').dataset.id)]);});
  $('saveAll').addEventListener('click', () => save([...rows.values()]));
  for (const id of ['category','filter','budgetBand','rankingSort']) $(id).addEventListener('change', render);
  $('rankingProfile').innerHTML = RankingOffers.profiles.map(p=>`<option value="${e(p.id)}">${e(p.label)}</option>`).join('');
  $('rankingProfile').value = profile;
  $('rankingProfile').addEventListener('change',event=>{
    profile=validProfile(event.target.value);
    try { localStorage.setItem(profileKey,profile); } catch (_) {}
    render();
  });
  $('valueFormula').innerHTML = RankingOffers.formulaHTML(profile);
  $('search').addEventListener('input', render);
  $('retry').addEventListener('click', () => load());
  $('reload').addEventListener('click', () => {
    if (![...rows.values()].some(changes) || confirm('โหลดข้อมูลล่าสุดและทิ้งการแก้ไขที่ยังไม่บันทึกทั้งหมดหรือไม่?')) {
      drafts.clear(); load('โหลดข้อมูลล่าสุดแล้ว');
    }
  });
  $('logout').addEventListener('click', () => { if (![...rows.values()].some(changes) || confirm('มีข้อมูลที่แก้ไขในฟอร์ม ต้องการออกจากระบบหรือไม่?')) {drafts.clear(); loggedOut();} });
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    try { const result = await api('/api/admin/login', {username:$('username').value.trim(),password:$('password').value}); localStorage.setItem('yesspec_admin_token', result.token); $('password').value=''; await load(); }
    catch(error) {status(error.message);}
  });
  window.addEventListener('beforeunload', event => {if ([...rows.values()].some(changes)) {event.preventDefault();event.returnValue='';}});
  const checks = PriceCheck.create({dialog:$('priceCheckDialog'),api,
    apply(context, value) {
      const row = rows.get(context.listing_id);
      const card = [...document.querySelectorAll('.product-card')].find(c=>c.dataset.id===context.listing_id);
      const current = row && (drafts.get(row.listing_id)?.offers[context.platform] || formOffer(row.offers[context.platform]));
      if (!row || row.revision !== context.revision || JSON.stringify(current) !== JSON.stringify(context.offer)) {
        checks.close(); status('ข้อมูลในฟอร์มเปลี่ยนแล้ว กรุณาตรวจราคาใหม่', feedback(card,'actions',context.platform)); return false;
      }
      const draft = getDraft(row); draft.offers[context.platform] = value;
      draft.reset = draft.reset.filter(p=>p!==context.platform);
      if (card) card.querySelector(`[data-check="${context.platform}"]`).closest('.channel').outerHTML = renderChannel(row,context.platform,value);
      updateDirty(); status('ใส่ราคาที่คุณยืนยันในฟอร์มแล้ว · กดบันทึกรายการเพื่อเผยแพร่', feedback(card,'actions',context.platform));
      return true;
    },
    manual(context) {
      const card = [...document.querySelectorAll('.product-card')].find(c=>c.dataset.id===context.listing_id);
      card?.querySelector(`[data-platform="${context.platform}"][data-field="price"]`)?.focus();
    }
  });
  load();
})();
