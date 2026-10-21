(function (root) {
  'use strict';
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize = name => String(name || '').trim().toLocaleLowerCase();
  function httpsURL(value) {
    try { const url = new URL(value); return url.protocol==='https:' && !url.username && !url.password ? url.href : ''; } catch (_) { return ''; }
  }
  function resolve(registry,id,model) {
    const record = registry?.schema_version===1 ? registry.items?.[id] : null;
    if (!record || record.status!=='verified' || !model || normalize(record.model)!==normalize(model) ||
        !/^assets\/phones\/[a-z0-9][a-z0-9-]*\.(?:png|jpe?g|webp)$/.test(record.asset_path || '') ||
        !/^[a-f0-9]{64}$/.test(record.sha256 || '') || !httpsURL(record.source_url) || !httpsURL(record.image_url) ||
        !['official','retailer','editorial'].includes(record.source_type) || !record.visual_checked ||
        !Number.isInteger(record.width) || !Number.isInteger(record.height) || record.width<=0 || record.height<=0) return null;
    return record;
  }
  function slotHTML(item, compact = false) {
    if (!/^\d+\/\d+$/.test(item?.listing_id || '')) return '';
    const model = item.display_name || item.title || '';
    return `<figure class="phone-image${compact?' phone-image--compact':''}" data-phone-image="${escapeHTML(item.listing_id)}" data-image-model="${escapeHTML(model)}" data-image-citation="${compact?'no':'yes'}"><span class="phone-image-placeholder">กำลังโหลดรูป</span></figure>`;
  }
  function imageHTML(record,citation=true) {
    const label = record.source_type==='official' ? 'รูปจากผู้ผลิต' : 'แหล่งที่มารูป';
    const photo = `<img src="${escapeHTML(record.asset_path)}?v=${record.sha256.slice(0,12)}" alt="${escapeHTML(record.alt || record.model)}" width="${record.width}" height="${record.height}" loading="lazy" decoding="async">`;
    return `${citation?`<a class="phone-image-preview" href="${escapeHTML(record.asset_path)}?v=${record.sha256.slice(0,12)}" target="_blank" rel="noopener noreferrer" aria-label="ดูรูป ${escapeHTML(record.model)} ขนาดเต็ม" title="ดูรูปขนาดเต็ม">${photo}</a>`:photo}<span class="phone-image-placeholder" hidden>รูปยังไม่พร้อม</span>${citation?`<figcaption><a href="${escapeHTML(record.source_url)}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(record.source_name)} · ตรวจ ${escapeHTML(record.checked_at)}">${label} ↗</a></figcaption>`:''}`;
  }
  function hydrate(doc,registry) {
    doc.querySelectorAll('[data-phone-image]:not([data-image-ready])').forEach(slot=>{
      slot.dataset.imageReady='true';
      const record=resolve(registry,slot.dataset.phoneImage,slot.dataset.imageModel);
      if (!record) { slot.innerHTML=`<span class="phone-image-placeholder">${registry?'ยังไม่ยืนยันรูป':'โหลดรูปไม่ได้ · ลองโหลดหน้าใหม่'}</span>`;slot.dataset.imageState='unavailable';return; }
      slot.innerHTML=imageHTML(record,slot.dataset.imageCitation!=='no');
      slot.dataset.imageState='verified';
      const image=slot.querySelector('img');
      image.addEventListener('error',()=>{
        image.hidden=true;
        slot.querySelector('.phone-image-placeholder').hidden=false;
        slot.dataset.imageState='failed';
      },{once:true});
    });
  }
  async function start(doc,fetcher) {
    let registry=null;
    try {
      const response=await fetcher('data/phone_images.json?v=20261021-images1',{cache:'no-cache'});
      if (response.ok) registry=await response.json();
    } catch (_) { /* Missing artwork must never stop ranking or price entry. */ }
    hydrate(doc,registry);
    const observer=new root.MutationObserver(()=>hydrate(doc,registry));
    for (const id of ['categoryTop20Results','rankingResults','comparisonTable','products']) {
      const target=doc.getElementById(id);
      if (target) observer.observe(target,{childList:true,subtree:true});
    }
    return observer;
  }
  const api={resolve,slotHTML,imageHTML,hydrate,start};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  root.PhoneImages=api;
  if (root.document) {
    const ready=()=>start(root.document,(...args)=>root.fetch(...args));
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
  }
})(typeof window!=='undefined'?window:globalThis);
