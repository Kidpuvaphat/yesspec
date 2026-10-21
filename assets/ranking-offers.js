(function (root) {
  'use strict';
  const hosts = {
    shopee: ['shopee.co.th', 'www.shopee.co.th', 's.shopee.co.th', 'shp.ee'],
    lazada: ['lazada.co.th', 'www.lazada.co.th', 's.lazada.co.th'],
    tiktok: ['tiktok.com', 'www.tiktok.com', 'shop.tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com']
  };
  const phoneSpecs = root.PhoneSpecs || (typeof require === 'function' ? require('./phone-specs.js') : null);
  const phoneValue = root.PhoneValue || (typeof require === 'function' ? require('./phone-value.js') : null);
  const profiles = phoneValue.profiles;
  const names = {shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok Shop'};
  // Editorial scoring rubric v1. Caps are fixed reference points, not market maxima.
  const specMetrics = [
    ['geekbench6_single','Geekbench 6 · Single-core',15,3000],
    ['geekbench6_multi','Geekbench 6 · Multi-core',25,10000],
    ['ram_gb','RAM จริง (GB ไม่รวม RAM เสมือน)',15,12],
    ['storage_gb','ความจุ (GB)',15,512],
    ['battery_mah','แบตเตอรี่ (mAh)',15,6000],
    ['refresh_hz','รีเฟรชเรตจอ (Hz)',15,120]
  ];
  function sourceURL(raw, benchmark = false) {
    try {
      const u = new URL(raw);
      return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
        !/[\s<>"'\\\u0000-\u001f]/.test(raw) &&
        (!benchmark || (u.hostname === 'browser.geekbench.com' && /^\/v6\/cpu\/\d+\/?$/.test(u.pathname))) ? raw : '';
    } catch (_) { return ''; }
  }
  const variantKey = value => String(value || '').trim().toLocaleLowerCase('en-US').replace(/\s+/g,' ');
  function boundResearch(item) {
    const r = item.spec_research;
    if (!r) return null;
    const adminBound = item.research_identity && r.model === item.title && r.binding?.title === item.source_title &&
      JSON.stringify(item.research_identity) === JSON.stringify(r.binding);
    return adminBound || (r.model === item.display_name && sameBinding(item,r.binding)) ? r : null;
  }
  function researchedSpecs(item) {
    return boundResearch(item) ? item.researched_value_specs || item.spec_research.value_specs || null : null;
  }
  function researchHTML(research) {
    if (!research || !Array.isArray(research.facts)) return '';
    const e = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const link = (url,label) => sourceURL(url) ? `<a href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(label)} ↗</a>` : e(label);
    const benchmark = research.benchmark;
    return `<details class="spec-research"><summary>สเปกและหลักฐาน · ${benchmark ? 'มี Geekbench 6' : 'ยังไม่ยืนยัน Geekbench 6'}</summary><p>ตรวจแหล่งข้อมูล ${e(research.checked_at)} · สเปกอ้างอิงของรุ่น ผู้ดูแลอาจเลือกความจุอื่นได้</p>${phoneSpecs?.detailsHTML(research) || `<dl>${research.facts.map(f=>`<div><dt>${e(f.label)}</dt><dd>${f.value == null ? '— ยังไม่ยืนยัน' : link(f.url,f.value)}</dd></div>`).join('')}</dl>`}${benchmark ? `<p>${link(benchmark.url,`Geekbench ${benchmark.version} · ${benchmark.single} / ${benchmark.multi} (Single / Multi)`)}<br><small>รหัสเครื่อง ${e(benchmark.model_code)} · RAM ที่ระบบรายงาน ${e(benchmark.tested_ram_gb_reported ?? '—')} GB · ทดสอบ ${e(benchmark.upload_date)}<br>ผลสาธารณะหนึ่งครั้ง ไม่ใช่ค่าเฉลี่ยรุ่น และไม่ยืนยันความจุ สี หรือประเทศของเครื่องในตะกร้า</small></p>` : '<p>เว้นคะแนนไว้จนกว่าจะยืนยันผล Geekbench 6 ของรุ่นนี้ได้</p>'}${research.notes?.length ? `<ul>${research.notes.map(n=>`<li>${e(n)}</li>`).join('')}</ul>` : ''}</details>`;
  }
  function referencePrice(item, now = Date.now()) {
    const price = item.reference_price, recorded = Date.parse(price?.recorded_at);
    return price?.source === 'manual_reference' && typeof price.price === 'number' &&
      Number.isFinite(price.price) && price.price > 0 && price.price <= 100000000 &&
      Number.isFinite(recorded) && recorded <= now
      ? {...price, stale:now - recorded > 48 * 3600000} : null;
  }
  function suitabilityScore(item, now = Date.now(), profile = 'balanced') {
    const selected = phoneValue.profileFor(profile), research = boundResearch(item), spec = item.value_specs;
    const pending = reason => ({profile:selected.id,score_kind:'suitability',score:null,spec_score:null,provisional:true,coverage:0,missing:[],groups:[],reason});
    if (item.purchase_offers_unavailable) return pending('โหลดข้อมูลที่ยืนยันไว้ไม่สำเร็จ · กรุณาลองใหม่');
    const fromResearch = research && (item.value_specs_source === 'research' ||
      (!item.value_specs_source && JSON.stringify(spec) === JSON.stringify(researchedSpecs(item))));
    const date = Date.parse(fromResearch ? spec?.checked_at || research.value_inputs?.base_checked_at : spec?.checked_at);
    const hasGB = spec?.geekbench6_single != null || spec?.geekbench6_multi != null;
    if (!spec || (!fromResearch && !spec.verified) || !sourceURL(spec.spec_url) ||
        (hasGB && !sourceURL(spec.benchmark_url,true)) || !Number.isFinite(date) || date > now) {
      return pending('รอสเปกและแหล่งอ้างอิงที่ผู้ดูแลยืนยัน · ช่องที่ยังขาดประมาณการได้');
    }
    const inputs = research?.value_inputs?.model === research?.model ? research?.value_inputs : null;
    if (inputs?.model_identity_confirmed === false) return pending('รอตรวจชื่อรุ่นกับตะกร้าที่ขัดแย้งกันก่อนจัดอันดับ');
    const result = phoneValue.evaluate(spec,inputs || {},selected.id,now);
    return {...result, variant:spec.variant || '', variant_confirmed:fromResearch ? inputs?.variant_confirmed === true :
      !!spec.variant && typeof spec.ram_gb === 'number' && spec.ram_gb > 0 && typeof spec.storage_gb === 'number' && spec.storage_gb > 0};
  }
  function valueScore(item, now = Date.now(), profile = 'balanced') {
    const suitability = suitabilityScore(item,now,profile), spec = item.value_specs;
    const pending = reason => ({...suitability,score_kind:'value',score:null,score_low:null,score_high:null,reason});
    if (suitability.score === null) return pending(suitability.reason);
    if (!suitability.variant_confirmed || !spec.variant) return pending('รอยืนยันรุ่นย่อยและ RAM / ความจุของราคาให้ตรงกับสเปก');
    const scored = price => ({...suitability,...price,score_kind:'value',reason:'',
      score:Math.round(suitability.spec_score*1000/price.price*10000)/10000,
      score_low:suitability.spec_score_low*1000/price.price,score_high:suitability.spec_score_high*1000/price.price});
    // An explicit reference price wins; an invalid one cannot fall back silently.
    if (item.reference_price) {
      const reference = referencePrice(item,now);
      if (!reference) return pending('รอตรวจราคาต่ำสุดที่พบและเวลาบันทึก');
      if (variantKey(reference.variant) !== variantKey(spec.variant)) return pending('ระบุตัวเลือกของราคาต่ำสุดที่พบให้ตรงกับสเปก');
      return scored({price:reference.price,platform:null,price_source:'manual_reference',recorded_at:reference.recorded_at,stale:reference.stale});
    }
    const offers = (item.purchase_offers || []).filter(o => validURL(o.url,o.platform) && o.source === 'manual' &&
      typeof o.price === 'number' && Number.isFinite(o.price) && o.price > 0 && o.price <= 100000000 &&
      variantKey(o.variant) === variantKey(spec.variant));
    if (!offers.length) return pending('รอราคาที่กรอกและตัวเลือกตรงกับสเปก');
    const fresh = offers.filter(o => {
      const lookup = o.price_lookup;
      const recorded = Date.parse(lookup?.confirmed && lookup.requested_url === o.url && lookup.amount === o.price ? lookup.checked_at : o.recorded_at);
      return Number.isFinite(recorded) && recorded <= now && now - recorded <= 48 * 3600000;
    }).sort((a,b)=>a.price-b.price || a.platform.localeCompare(b.platform));
    if (!fresh.length) return pending('ราคาที่ใช้คำนวณเกิน 48 ชม. · รอยืนยันราคาใหม่');
    return scored({price:fresh[0].price,platform:fresh[0].platform,price_source:'manual_cart'});
  }
  function rankValue(items, now = Date.now(), profile = 'balanced', mode = 'value') {
    const score = mode === 'suitability' ? suitabilityScore : valueScore;
    const ranked = items.map(item => ({...item, source_rank:item.source_rank ?? item.rank, value_result:score(item,now,profile)}));
    ranked.sort((a,b) => (b.value_result.score ?? -Infinity) - (a.value_result.score ?? -Infinity) ||
      (a.source_rank ?? Infinity) - (b.source_rank ?? Infinity) || a.listing_id.localeCompare(b.listing_id));
    let previous, rank;
    return ranked.map((item,index) => {
      const score = item.value_result.score;
      if (score !== null && score !== previous) rank = index+1;
      previous = score;
      return {...item, value_rank:score === null ? null : rank,score_kind:item.value_result.score_kind};
    });
  }
  function orderItems(items, mode = 'value', now = Date.now(), profile = 'balanced') {
    const ranked = rankValue(items,now,profile,mode);
    if (mode === 'sales') ranked.sort((a,b) => a.source_rank-b.source_rank || a.listing_id.localeCompare(b.listing_id));
    return ranked.map(i=>({...i, rank:mode === 'sales' ? i.source_rank : i.value_rank, ranking_mode:mode}));
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function scoreDetailsHTML(result) {
    if (!result?.groups?.length) return '';
    const metricHTML = m => {
      if (!m.weight) return '';
      const value = !m.known ? 'ยังไม่ยืนยัน · ใช้ค่ากลางประมาณการ' : typeof m.value === 'boolean' ?
        m.key === 'display_oled' ? m.value ? 'OLED' : 'LCD' : m.value ? 'มี' : 'ไม่มี' : String(m.value);
      const evidence = sourceURL(m.url) ? `<a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(value)} ↗</a>` : esc(value);
      return `<li>${esc(m.label)}: ${evidence}${m.note ? `<small>${esc(m.note)}</small>` : ''}</li>`;
    };
    return `<details class="score-details"><summary>รายละเอียดคะแนน · หลักฐาน ${result.coverage.toFixed(1)}%</summary><div class="score-breakdown">${result.groups.map(g=>`<details><summary><strong>${esc(g.label)}</strong> · น้ำหนัก ${g.weight}% · ${g.score.toFixed(1)} / 100${g.coverage < 100 ? ' (ประมาณการบางส่วน)' : ''}</summary><ul>${g.metrics.map(metricHTML).join('')}</ul></details>`).join('')}</div><p>ช่วงคะแนนสเปก ${result.spec_score_low.toFixed(1)}–${result.spec_score_high.toFixed(1)} / 100 คำนวณโดยให้ข้อมูลที่ขาดได้ 0 ถึงเต็มน้ำหนัก ไม่ใช่ช่วงความเชื่อมั่นทางสถิติ อันดับใช้ค่ากลางของช่วง จึงอาจสลับเมื่อยืนยันข้อมูลเพิ่ม</p>${result.missing.length ? `<p>ข้อมูลที่ยังขาด: ${result.missing.map(m=>esc(m.label)).join(' · ')}</p>` : ''}<p>คะแนนจากสเปกตามเกณฑ์ของเว็บ ไม่ใช่ผลทดสอบคุณภาพภาพถ่าย FPS ความร้อน หรือชั่วโมงไลฟ์ต่อเนื่อง</p></details>`;
  }
  function formulaHTML(profile = 'balanced') {
    const selected = phoneValue.profileFor(profile);
    return `<strong>โปรไฟล์ ${esc(selected.label)} · สูตร yesspec v2</strong><p>คะแนนเหมาะกับการใช้งาน = คะแนนสเปกถ่วงน้ำหนัก (เต็ม 100) · ความคุ้มค่า = คะแนนนั้น × 1,000 ÷ ราคาสุทธิ (บาท)</p><ul>${Object.entries(selected.weights).map(([id,w])=>`<li>${phoneValue.groupLabels[id]} ${w}%</li>`).join('')}</ul>` +
      '<p>แต่ละค่าสเปกเทียบกับเกณฑ์คงที่และจำกัดคะแนนสูงสุด ไม่ให้คะแนนเพิ่มจาก RAM เสมือน หรือจำนวนเมกะพิกเซลเพียงอย่างเดียว</p>' +
      '<p>ข้อมูลที่ยังไม่ยืนยันคงเว้นว่าง แต่ในการจัดอันดับให้ค่ากลาง 50% ของน้ำหนักส่วนนั้น พร้อมแสดงช่วงคะแนนและป้ายอันดับชั่วคราว ไม่กระจายน้ำหนักไปให้ข้อมูลที่เหลือ ต้องมีหลักฐานอย่างน้อย 50% ของน้ำหนักจึงได้อันดับ</p>' +
      '<details><summary>เกณฑ์ย่อยและค่าอ้างอิง</summary><p>CPU: Single-core 40% / 3,000 และ Multi-core 60% / 10,000 · หน่วยความจำ: RAM จริง 50% / 12GB และความจุ 50% / 512GB</p><p>กล้อง: OIS 30%, Ultrawide 15%, เลนส์เทเลออปติคัล 20% / 5×, วิดีโอหลัง 20%, วิดีโอหน้า 15% · โปรไฟล์ไลฟ์ใช้ 15 / 5 / 0 / 25 / 55% ตามลำดับ ไม่นับการครอปเซ็นเซอร์เป็นเลนส์เทเล</p><p>วิดีโอ: 720p30 = 20%, 1080p30 = 35%, 1080p60 = 50%, 4K30 = 70%, 4K60 = 85%, 4K120 หรือ 8K30 = 100% ขององค์ประกอบวิดีโอ · OIS / Ultrawide: มี = 100%, ยืนยันว่าไม่มี = 0%</p><p>จอ: ชนิดจอ 25% (OLED=100%, LCD=60% เป็นความชอบตามเกณฑ์เว็บ), ความหนาแน่นพิกเซล 25% / 450ppi, รีเฟรชเรต 30% / 120Hz, HBM 20% / 1,200nits ไม่นำ peak มาแทน HBM</p><p>แบตเตอรี่: ความจุ 60% / 6,000mAh, ชาร์จสาย 30% / 80W, ไร้สาย 10% / 30W · mAh เป็นเพียงตัวแทนด้านความจุ ไม่ใช่ผลทดสอบระยะใช้งาน และ rated / typical อาจต่างกัน</p><p>อัปเดต: จำนวนรุ่น OS 40% / 7 รุ่น, ระยะสนับสนุนความปลอดภัยรวมที่ประกาศ 60% / 7 ปี เป็นระยะรวมตามสัญญา ไม่ใช่จำนวนปีที่เหลือ ณ วันนี้</p></details>' +
      '<p>เล่นเกมใช้ CPU / จอเป็นตัวแทน ยังไม่มีคะแนน GPU หรือ FPS ต่อเนื่อง กล้องและไลฟ์ประเมินความสามารถจากสเปก ไม่รับรองคุณภาพภาพจริง ความร้อน ความเสถียรเครือข่าย หรือชั่วโมงไลฟ์</p>' +
      '<p>ใช้ราคาต่ำสุดที่ผู้ดูแลพบเป็นหลัก แม้ไม่มีตะกร้า ใช้จนกว่าจะแก้หรือล้างค่า เกิน 48 ชม. จะแจ้งให้ตรวจใหม่ ราคานี้อาจต่างจากลิงก์ซื้อและไม่รับรองว่าต่ำสุดทั้งตลาด หากเว้นไว้ใช้ราคาตะกร้าที่มีลิงก์และยืนยันภายใน 48 ชม. ต้องตรงรุ่นย่อย RAM และความจุที่ยืนยันไว้</p>' +
      '<p>คำนวณใหม่เมื่อบันทึกและเปิดหน้าเว็บ หน้าเปิดอยู่ตรวจข้อมูลทุก 60 วินาทีและเมื่อกลับแท็บ คะแนนเท่ากันใช้อันดับร่วม อันดับยอดขายยังใช้ข้อมูลต้นทางแยกจากสูตรนี้</p>';
  }
  function watchChanges(callback) {
    if (!root.document || !root.addEventListener) return;
    let busy = false;
    const refresh = async () => {
      if (busy || root.document.hidden) return;
      busy = true;
      try { await callback(); } finally { busy = false; }
    };
    root.addEventListener('storage', event => {if (event.key === 'yesspec_offers_updated') refresh();});
    root.addEventListener('focus', refresh);
    root.document.addEventListener('visibilitychange', refresh);
    root.setInterval(refresh,60000);
  }
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
    const manual = item => {
      const entry = registry?.items?.[item.listing_id];
      if (!sameBinding(item,entry?.binding) || !Object.prototype.hasOwnProperty.call(entry,'value_specs')) return false;
      const a = entry.value_specs, b = researchedSpecs(item);
      const equal = a && b && [...specMetrics.map(([key])=>key),'variant','spec_url','benchmark_url','verified','checked_at'].every(key=>a[key] === b[key]);
      return entry.value_specs_source === 'manual' || !equal;
    };
    return {...data, categories:data.categories.map(c => ({...c, items:c.items.map(item => ({...item,
      reference_price:registry?.schema_version === 1 && sameBinding(item,registry?.items?.[item.listing_id]?.binding)
        ? registry.items[item.listing_id].reference_price || null : null,
      value_specs_source:manual(item) ? 'manual' : 'research',
      value_specs:manual(item)
        ? registry.items[item.listing_id].value_specs : researchedSpecs(item),
      purchase_offers:resolve(item, registry), purchase_offers_unavailable:registry?.schema_version !== 1
    }))}))};
  }
  const api = {names, validURL, sameBinding, defaultShopee, resolve, attach,
    specMetrics, sourceURL, valueScore, suitabilityScore, profiles, scoreDetailsHTML, rankValue, orderItems, formulaHTML, watchChanges, researchedSpecs, researchHTML, referencePrice};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RankingOffers = api;
})(typeof window !== 'undefined' ? window : globalThis);
