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
  // Legacy admin field definitions only; task scoring lives in PhoneValue.
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
    const pending = reason => ({profile:selected.id,score_kind:'suitability',score:null,spec_score:null,provisional:true,coverage:0,
      measured_coverage:0,proxy_coverage:0,missing_coverage:100,evidence_status:'pending',missing:[],estimated:[],groups:[],reason});
    if (item.purchase_offers_unavailable) return pending('โหลดข้อมูลที่ยืนยันไว้ไม่สำเร็จ · กรุณาลองใหม่');
    const fromResearch = research && (item.value_specs_source === 'research' ||
      (!item.value_specs_source && JSON.stringify(spec) === JSON.stringify(researchedSpecs(item))));
    const date = Date.parse(fromResearch ? spec?.checked_at || research.value_inputs?.base_checked_at : spec?.checked_at);
    if (!spec || (!fromResearch && !spec.verified) || !sourceURL(spec.spec_url) ||
        !Number.isFinite(date) || date > now) {
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
    const percentage = value => Number.isFinite(value) ? value.toFixed(1) : '0.0';
    const measured = result.measured_coverage ?? 0, proxy = result.proxy_coverage ?? result.coverage ?? 0;
    const missing = result.missing_coverage ?? Math.max(0,100 - (result.coverage || 0));
    const labels = {measured:'ผลทดสอบ',spec_proxy:'ประมาณจากสเปก',missing:'ยังไม่มีข้อมูล · ใช้ค่ากลางชั่วคราว'};
    const evidenceHTML = fact => {
      const value = typeof fact.value === 'boolean' ? fact.value ? 'มี' : 'ไม่มี' : fact.value ?? '—';
      const text = `${fact.label || fact.key || 'แหล่งอ้างอิง'}: ${value}`;
      return `${sourceURL(fact.url) ? `<a href="${esc(fact.url)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>` : esc(text)}${fact.note ? `<small>${esc(fact.note)}</small>` : ''}`;
    };
    const metricHTML = m => {
      if (!m.weight) return '';
      const kind = m.evidence_type || (m.known ? 'spec_proxy' : 'missing');
      const evidence = Array.isArray(m.evidence) && m.evidence.length ? `<ul class="score-evidence">${m.evidence.map(f=>`<li>${evidenceHTML(f)}</li>`).join('')}</ul>` : '';
      const citation = sourceURL(m.url) ? ` · <a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">แหล่งอ้างอิง ↗</a>` : '';
      return `<li data-evidence-type="${esc(kind)}"><strong>${esc(m.label)}</strong> · ${percentage(m.score)} / 100 · ${esc(labels[kind] || labels.missing)}<small>น้ำหนัก ${percentage(m.contribution_weight)}% ของคะแนนรวม${citation}</small>${m.missing_coverage > 0 ? `<small>หัวข้อนี้ยังขาดข้อมูล ${percentage(m.missing_coverage)}% · ส่วนที่ขาดใช้ค่ากลาง 50</small>` : ''}${m.note ? `<small>${esc(m.note)}</small>` : ''}${evidence}</li>`;
    };
    const range = missing > 0 && Number.isFinite(result.spec_score_low) && Number.isFinite(result.spec_score_high)
      ? `<p>ช่วงคะแนนจากข้อมูลที่ยังขาด ${result.spec_score_low.toFixed(1)}–${result.spec_score_high.toFixed(1)} / 100 ให้ส่วนที่ขาดได้ 0 ถึงเต็มน้ำหนัก และใช้ค่ากลาง 50 ในการคำนวณชั่วคราว ช่วงนี้ไม่ใช่ช่วงความเชื่อมั่นทางสถิติ และยังไม่รวมความคลาดเคลื่อนของคะแนนประมาณจากสเปก</p>` : '';
    return `<details class="score-details"><summary>รายละเอียดคะแนนและข้อมูลที่ขาด</summary><p class="score-evidence-summary">ผลทดสอบ ${percentage(measured)}% · ประมาณจากสเปก ${percentage(proxy)}% · ขาดข้อมูล ${percentage(missing)}% ของน้ำหนักคะแนน</p><div class="score-breakdown">${result.groups.filter(g=>g.weight>0).map(g=>`<details><summary><strong>${esc(g.label)}</strong> · น้ำหนัก ${g.weight}% · ${percentage(g.score)} / 100${(g.proxy_coverage || 0)>0 || g.coverage<100 ? ' (คะแนนประมาณการ)' : ''}</summary><ul>${g.metrics.map(metricHTML).join('')}</ul></details>`).join('')}</div>${range}${result.missing?.length ? `<p><strong>ข้อมูลที่ยังขาด:</strong> ${result.missing.map(m=>esc(m.label)).join(' · ')}</p>` : ''}${result.estimated?.length ? `<p><strong>หัวข้อที่ยังใช้สเปกประมาณ:</strong> ${result.estimated.map(m=>esc(m.label)).join(' · ')}</p>` : ''}<p>ผลทดสอบมีน้ำหนักก่อนการประมาณจากสเปกในหัวข้อเดียวกัน ไม่บวกคะแนนชิปซ้ำกับผลเกม หรือความจุแบตซ้ำกับระยะใช้งาน คะแนนประมาณการยังไม่ยืนยันคุณภาพภาพถ่าย FPS ความร้อน หรือชั่วโมงไลฟ์จริง</p></details>`;
  }
  function formulaHTML(profile = 'balanced') {
    const selected = phoneValue.profileFor(profile);
    const definition = id => phoneValue.groupDefinitions?.[id] || {label:phoneValue.groupLabels[id],metrics:[]};
    const criteria = Object.entries(selected.weights).map(([id,weight])=>({id,weight,...definition(id)}));
    const usedProxies = new Set(criteria.flatMap(g=>(g.metrics || []).flatMap(m=>(m.proxy || []).map(([key])=>key))));
    const rules = (phoneValue.proxyRubric || []).filter(rule=>usedProxies.has(rule.key));
    const proxyText = m => (m.proxy || []).map(([key,weight])=>`${rules.find(rule=>rule.key===key)?.label || key} ${weight}% ของหัวข้อนี้`).join(' · ');
    const references = rules.map(rule=>`<li>${esc(rule.label || rule.key)}${typeof rule.reference === 'number' ? ` · ค่าอ้างอิงเต็มคะแนน ${esc(rule.reference)}` : ''}: ${esc(rule.description || rule.reference)}</li>`).join('');
    return `<strong>โหมด ${esc(selected.label)} · สูตร yesspec v3</strong><p>${esc(selected.description || 'ให้คะแนนเฉพาะปัจจัยที่เกี่ยวข้องกับการใช้งานนี้')}</p><p>ความเหมาะสม = ผลรวมคะแนนย่อย 0–100 × น้ำหนักหัวข้อนั้น · ความคุ้มค่า = คะแนนความเหมาะสม × 1,000 ÷ ราคาที่ใช้จัดอันดับ (บาท)</p><ul>${criteria.map(g=>`<li>${esc(g.label)} ${g.weight}%</li>`).join('')}</ul>` +
      '<p>เลือกเรียง “ความเหมาะสม” เพื่อดูความสามารถในงานนี้ หรือ “ความคุ้มค่า” เพื่อดูคะแนนต่อราคา การแก้ราคาเปลี่ยนอันดับความคุ้มค่า ส่วนคะแนนความเหมาะสมเปลี่ยนเมื่อมีหลักฐานใหม่</p>' +
      '<p>แยกหลักฐานเป็นผลทดสอบ ประมาณจากสเปก และยังไม่มีข้อมูล โดยแสดงสัดส่วนตามน้ำหนักคะแนน ผลทดสอบที่เทียบเงื่อนไขกันได้ใช้แทนการประมาณในหัวข้อเดียวกัน ไม่บวกซ้ำ และไม่ปรับเกณฑ์ตามรุ่นที่แรงที่สุดในรายการ</p>' +
      '<p>ส่วนที่ยังไม่มีข้อมูลคงเว้นว่าง และใช้ค่ากลาง 50 / 100 ชั่วคราว ไม่กระจายน้ำหนักให้หัวข้ออื่น ต้องมีหลักฐานผลทดสอบหรือสเปกที่ใช้ประมาณได้รวมอย่างน้อย 50% ของน้ำหนักจึงได้อันดับ หากมีส่วนประมาณหรือขาดข้อมูล จะติดป้าย “คะแนนประมาณการ / อันดับชั่วคราว” แม้มีสเปกครบทุกหัวข้อ</p>' +
      `<details><summary>หัวข้อย่อยและเกณฑ์ที่ใช้</summary>${criteria.map(g=>`<p><strong>${esc(g.label)} · ${g.weight}%</strong></p><ul>${(g.metrics || []).map(m=>`<li>${esc(m.label)} · ${(g.weight*m.weight/100).toFixed(1)}% ของคะแนนรวม${m.proxy?.length ? `<small>การประมาณเมื่อไม่มีผลทดสอบ: ${esc(proxyText(m))}</small>` : '<small>ต้องมีผลทดสอบของหัวข้อนี้ ไม่ใช้สเปกทั่วไปแทน</small>'}</li>`).join('')}</ul>`).join('')}${references ? `<p><strong>เกณฑ์คงที่สำหรับการประมาณจากสเปก</strong></p><p>ค่าตัวเลขให้คะแนนตามสัดส่วนเทียบค่าอ้างอิง จำกัดที่ 0–100 ส่วนเกณฑ์ชนิดจอและการรองรับใช้ค่าที่ระบุ</p><ul>${references}</ul>` : ''}</details>` +
      '<p>สเปกที่ใช้ประมาณได้ต้องมีที่มาและตรงรุ่น จำนวนเมกะพิกเซล เลนส์ หรือซูมสูงสุดไม่ยืนยันภาพสวย Geekbench CPU ไม่แทน FPS เกม และการบันทึกวิดีโอ 4K ไม่ยืนยันคุณภาพไลฟ์ ระยะอัปเดตคิดจากเวลาที่เหลือ ไม่ใช้จำนวนปีรวมแทน</p>' +
      '<p>ใช้ราคาต่ำสุดที่ผู้ดูแลพบเป็นหลัก แม้ไม่มีตะกร้า ใช้จนกว่าจะแก้หรือล้างค่า เกิน 48 ชม. จะแจ้งให้ตรวจใหม่ ราคานี้อาจต่างจากลิงก์ซื้อและไม่รับรองว่าต่ำสุดทั้งตลาด หากเว้นไว้ใช้ราคาตะกร้าที่มีลิงก์และยืนยันภายใน 48 ชม. ต้องตรงรุ่นย่อย RAM และความจุที่ยืนยันไว้</p>' +
      '<p>บันทึกราคาแล้วคำนวณและเรียงอันดับใหม่ทันที หน้าเว็บที่เปิดอยู่ตรวจข้อมูลทุก 60 วินาทีและเมื่อกลับแท็บ คะแนนเท่ากันใช้อันดับร่วม อันดับยอดขายยังใช้ข้อมูลต้นทางแยกจากสูตรนี้</p>';
  }
  function watchChanges(callback) {
    if (!root.document || !root.addEventListener) return;
    let busy = false, queued = false;
    const refresh = async () => {
      if (root.document.hidden) return;
      if (busy) { queued = true; return; }
      busy = true;
      try {
        do {
          queued = false;
          await callback();
        } while (queued && !root.document.hidden);
      } finally { busy = false; }
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
