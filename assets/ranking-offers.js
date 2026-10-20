(function (root) {
  'use strict';
  const hosts = {
    shopee: ['shopee.co.th', 'www.shopee.co.th', 's.shopee.co.th', 'shp.ee'],
    lazada: ['lazada.co.th', 'www.lazada.co.th', 's.lazada.co.th'],
    tiktok: ['tiktok.com', 'www.tiktok.com', 'shop.tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com']
  };
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
  function researchedSpecs(item) {
    return item.spec_research?.model === item.display_name && sameBinding(item,item.spec_research?.binding)
      ? item.researched_value_specs || null : null;
  }
  function researchHTML(research) {
    if (!research || !Array.isArray(research.facts)) return '';
    const e = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const link = (url,label) => sourceURL(url) ? `<a href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(label)} ↗</a>` : e(label);
    const benchmark = research.benchmark;
    return `<details class="spec-research"><summary>สเปกและหลักฐาน · ${benchmark ? 'มี Geekbench 6' : 'ยังไม่ยืนยัน Geekbench 6'}</summary><p>ตรวจแหล่งข้อมูล ${e(research.checked_at)} · สเปกอ้างอิงของรุ่น ผู้ดูแลอาจเลือกความจุอื่นได้</p><dl>${research.facts.map(f=>`<div><dt>${e(f.label)}</dt><dd>${f.value == null ? '— ยังไม่ยืนยัน' : link(f.url,f.value)}</dd></div>`).join('')}</dl>${benchmark ? `<p>${link(benchmark.url,`Geekbench ${benchmark.version} · ${benchmark.single} / ${benchmark.multi} (Single / Multi)`)}<br><small>รหัสเครื่อง ${e(benchmark.model_code)} · RAM ที่ระบบรายงาน ${e(benchmark.tested_ram_gb_reported ?? '—')} GB · ทดสอบ ${e(benchmark.upload_date)}<br>ผลสาธารณะหนึ่งครั้ง ไม่ใช่ค่าเฉลี่ยรุ่น และไม่ยืนยันความจุ สี หรือประเทศของเครื่องในตะกร้า</small></p>` : '<p>เว้นคะแนนไว้จนกว่าจะยืนยันผล Geekbench 6 ของรุ่นนี้ได้</p>'}${research.notes?.length ? `<ul>${research.notes.map(n=>`<li>${e(n)}</li>`).join('')}</ul>` : ''}</details>`;
  }
  function valueScore(item, now = Date.now()) {
    const spec = item.value_specs;
    const pending = reason => ({score:null, spec_score:null, reason});
    if (!spec?.verified || !spec.variant || !sourceURL(spec.spec_url) || !sourceURL(spec.benchmark_url,true) ||
        !Number.isFinite(Date.parse(spec.checked_at)) || Date.parse(spec.checked_at) > now ||
        !specMetrics.every(([key]) => typeof spec[key] === 'number' && Number.isFinite(spec[key]) && spec[key] > 0)) {
      return pending('รอสเปกครบและแหล่งอ้างอิงที่ผู้ดูแลยืนยัน');
    }
    const offers = (item.purchase_offers || []).filter(o => validURL(o.url,o.platform) && o.source === 'manual' &&
      typeof o.price === 'number' && Number.isFinite(o.price) && o.price > 0 &&
      variantKey(o.variant) === variantKey(spec.variant));
    if (!offers.length) return pending('รอราคาที่กรอกและตัวเลือกตรงกับสเปก');
    const fresh = offers.filter(o => {
      const lookup = o.price_lookup;
      const recorded = Date.parse(lookup?.confirmed && lookup.requested_url === o.url && lookup.amount === o.price ? lookup.checked_at : o.recorded_at);
      return Number.isFinite(recorded) && recorded <= now && now - recorded <= 48 * 3600000;
    }).sort((a,b)=>a.price-b.price || a.platform.localeCompare(b.platform));
    if (!fresh.length) return pending('ราคาที่ใช้คำนวณเกิน 48 ชม. · รอยืนยันราคาใหม่');
    const offer = fresh[0];
    const specScore = specMetrics.reduce((sum,[key,,weight,reference]) => sum + weight * Math.min(spec[key]/reference,1),0);
    return {score:Math.round(specScore*1000/offer.price*10000)/10000,
      spec_score:specScore, price:offer.price, platform:offer.platform, variant:spec.variant, reason:''};
  }
  function rankValue(items, now = Date.now()) {
    const ranked = items.map(item => ({...item, source_rank:item.source_rank ?? item.rank, value_result:valueScore(item,now)}));
    ranked.sort((a,b) => (b.value_result.score ?? -Infinity) - (a.value_result.score ?? -Infinity) ||
      (a.source_rank ?? Infinity) - (b.source_rank ?? Infinity) || a.listing_id.localeCompare(b.listing_id));
    let previous, rank;
    return ranked.map((item,index) => {
      const score = item.value_result.score;
      if (score !== null && score !== previous) rank = index+1;
      previous = score;
      return {...item, value_rank:score === null ? null : rank};
    });
  }
  function orderItems(items, mode = 'value', now = Date.now()) {
    const ranked = rankValue(items,now);
    if (mode === 'sales') ranked.sort((a,b) => a.source_rank-b.source_rank || a.listing_id.localeCompare(b.listing_id));
    return ranked.map(i=>({...i, rank:mode === 'sales' ? i.source_rank : i.value_rank, ranking_mode:mode}));
  }
  function formulaHTML() {
    return '<strong>ความคุ้มค่า = คะแนนสเปก × 1,000 ÷ ราคาสุทธิ (บาท)</strong>' +
      '<p>คะแนนสูงขึ้นได้อันดับดีขึ้น · คะแนนสเปกเต็ม 100 = ผลรวม น้ำหนัก × min(ค่าจริง ÷ ค่าอ้างอิง, 1)</p>' +
      '<ul>' + specMetrics.map(([,label,weight,reference])=>`<li>${label}: ${weight}% · ค่าอ้างอิง ${reference.toLocaleString('th-TH')}</li>`).join('') + '</ul>' +
      '<p>สูตร yesspec v1 ให้น้ำหนักด้านประสิทธิภาพ หน่วยความจำ แบตเตอรี่และจอ ไม่รวมคุณภาพกล้อง ระบบปฏิบัติการหรือบริการหลังขาย ค่าอ้างอิงเป็นเกณฑ์ของเว็บ และ mAh ไม่ใช่ผลทดสอบอายุแบตเตอรี่</p>' +
      '<p>ใช้ราคาต่ำสุดที่ผู้ดูแลบันทึกภายใน 48 ชั่วโมงจากช่องทางที่มีลิงก์และชื่อตัวเลือกตรงกับสเปก รวมคูปอง / VIP / แฟลชเซลตามเงื่อนไขที่ระบุ สเปกต้องครบและผู้ดูแลยืนยันแหล่งอ้างอิง คะแนนเท่ากันใช้อันดับร่วม รายการข้อมูลไม่ครบอยู่ท้ายและยังไม่มีอันดับความคุ้มค่า</p>' +
      '<p>คำนวณใหม่เมื่อบันทึกและเปิดหน้าเว็บ หน้าเว็บที่เปิดอยู่ตรวจข้อมูลทุก 60 วินาทีและเมื่อกลับมาเปิดแท็บ</p>' +
      '<a href="https://www.geekbench.com/doc/geekbench6-cpu-workloads.pdf" target="_blank" rel="noopener noreferrer">คำอธิบายการทดสอบ Geekbench 6 ↗</a>';
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
    return {...data, categories:data.categories.map(c => ({...c, items:c.items.map(item => ({...item,
      value_specs:sameBinding(item,registry?.items?.[item.listing_id]?.binding) && Object.prototype.hasOwnProperty.call(registry.items[item.listing_id],'value_specs')
        ? registry.items[item.listing_id].value_specs : researchedSpecs(item),
      purchase_offers:resolve(item, registry), purchase_offers_unavailable:registry?.schema_version !== 1
    }))}))};
  }
  const api = {names, validURL, sameBinding, defaultShopee, resolve, attach,
    specMetrics, sourceURL, valueScore, rankValue, orderItems, formulaHTML, watchChanges, researchedSpecs, researchHTML};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RankingOffers = api;
})(typeof window !== 'undefined' ? window : globalThis);
