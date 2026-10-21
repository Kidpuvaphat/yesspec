(function (root) {
  'use strict';
  const P=root.PhoneSpecs || (typeof require==='function'?require('./phone-specs.js'):null);
  const R=root.RankingOffers || (typeof require==='function'?require('./ranking-offers.js'):null);
  const rankingData=root.RankingData || (typeof require==='function'?require('./ranking-data.js'):null);
  const images=root.PhoneImages || (typeof require==='function'?require('./phone-images.js'):null);
  const e=P.esc, storageKey='yesspec_compare_phones_v1';
  const profileKey='yesspec_usage_profile_v2';
  const validProfile=id=>(R.profiles||[]).some(p=>p.id===id)?id:'balanced';
  const profileLabel=id=>(R.profiles||[]).find(p=>p.id===id)?.label||'สมดุล';
  function readProfile() {try{return validProfile(root.localStorage.getItem(profileKey));}catch(_){return 'balanced';}}
  const money=n=>typeof n==='number'&&Number.isFinite(n)&&n>0?'฿'+n.toLocaleString('th-TH',{maximumFractionDigits:2}):'—';
  const date=raw=>Number.isFinite(Date.parse(raw))?new Date(raw).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}):'—';
  function cleanSelection(values,items) {
    const valid=new Set(items.map(i=>i.listing_id));
    return [...new Set(Array.isArray(values)?values:[])].filter(id=>valid.has(id)).slice(0,4);
  }
  function research(item) {return R.researchedSpecs(item)?item.spec_research:null;}
  function purchaseLinks(item) {
    const links=(item.purchase_offers||[]).filter(o=>R.validURL(o.url,o.platform)).map(o=>{
      const url=o.platform==='shopee'?(root.ShopeeAffiliate?.build(o.url,`compare${item.item_id}`)||o.url):o.url;
      const price=o.source==='manual'&&typeof o.price==='number'&&Number.isFinite(o.price)&&o.price>0
        ? `<small>ราคาที่กรอก ${money(o.price)} · ${e(o.variant||'ยังไม่ระบุตัวเลือก')}<br>บันทึก ${date(o.recorded_at)} · ตรวจราคาปัจจุบันก่อนซื้อ</small>`:'';
      return `<div><a href="${e(url)}" target="_blank" rel="sponsored noopener noreferrer">ดูบน ${e(R.names[o.platform])} ↗</a>${price}</div>`;
    }).join('');
    return links?`<div class="compare-buy-links">${links}</div>`:'';
  }
  function scoreCell(s,suitability=false) {
    const measured=s.measured_coverage??0,proxy=s.proxy_coverage??s.coverage??0,missing=s.missing_coverage??Math.max(0,100-(s.coverage||0));
    const evidence=`<small class="score-evidence-summary">ผลทดสอบ ${measured.toFixed(1)}% · ประมาณจากสเปก ${proxy.toFixed(1)}% · ขาดข้อมูล ${missing.toFixed(1)}%</small>`;
    if(!Number.isFinite(s.score))return `<span class="phone-unknown">รอข้อมูล</span><small>${e(s.reason)}</small>${evidence}`;
    const decimals=suitability?2:4,provisional=s.provisional||proxy>0||missing>0;
    return `<strong>${s.score.toFixed(decimals)}${suitability?' / 100':''}</strong>${provisional?'<span class="score-provisional">คะแนนประมาณการ</span>':'<span class="score-measured">คะแนนจากผลทดสอบ</span>'}${evidence}${missing>0&&Number.isFinite(s.score_low)&&Number.isFinite(s.score_high)?`<small>ช่วงจากข้อมูลที่ขาด ${s.score_low.toFixed(decimals)}–${s.score_high.toFixed(decimals)}</small>`:''}`;
  }
  function summaryRows(items,now,profile='balanced') {
    const scores=items.map(i=>R.valueScore(i,now,profile));
    const suitability=items.map(i=>R.suitabilityScore(i,now,profile));
    return [
      {label:'ราคาอ้างอิง / ราคาพร้อมคำนวณ',cells:items.map((i,n)=>{
        const p=R.referencePrice(i,now),s=scores[n];
        return p?`<span class="compare-price">${money(p.price)}</span><small>ราคาต่ำสุดที่ผู้ดูแลพบ · ${date(p.recorded_at)}${p.stale?' · เกิน 48 ชม. ควรตรวจใหม่':''}<br>ราคาที่ลิงก์ซื้ออาจต่างกัน${p.note?'<br>'+e(p.note):''}</small>`:s.price?`<span class="compare-price">${money(s.price)}</span><small>ราคาตะกร้าที่ใช้คำนวณ · ${e(R.names[s.platform])}</small>`:'<span class="phone-unknown">— ยังไม่มีราคาพร้อมคำนวณ</span>';
      })},
      {label:'ตัวเลือกที่สเปกจัดอันดับอ้างอิง',cells:items.map((i,n)=>i.value_specs?.variant?`${e(i.value_specs.variant)}<small>${suitability[n].variant_confirmed?'ยืนยัน RAM / ความจุที่ใช้อ้างอิงแล้ว · ส่วนที่ขาดใช้ค่าประมาณ':'ยังรอยืนยันตัวเลือก / ข้อมูลที่กรอก'}</small>`:'<span class="phone-unknown">— ยังไม่เลือกความจุ</span>')},
      {label:'ตัวเลือกของราคาที่กรอก',cells:items.map((i,n)=>e(R.referencePrice(i,now)?.variant||scores[n].variant||'— ยังไม่ระบุ'))},
      {label:`คะแนนเหมาะกับการใช้งาน · ${profileLabel(profile)}`,cells:suitability.map(s=>scoreCell(s,true))},
      {label:`ความคุ้มค่า · ${profileLabel(profile)} (คะแนน / 1,000 บาท)`,cells:scores.map(s=>scoreCell(s))},
      {label:'องค์ประกอบคะแนนและข้อมูลที่ขาด',cells:suitability.map(s=>R.scoreDetailsHTML(s))},
      {label:'ลิงก์ซื้อ',cells:items.map(i=>purchaseLinks(i)||'<span class="phone-unknown">— ยังไม่มีลิงก์</span>')},
      {label:'สิ่งที่ต้องตรวจเพิ่ม',cells:items.map(i=>{
        const r=research(i),notes=[...(r?.notes||[]),...(r?.comparison?.notes||[])];
        return notes.length?`<details><summary>ดูหมายเหตุ ${notes.length} ข้อ</summary>${notes.map(n=>`<small>${e(n)}</small>`).join('')}</details>`:'—';
      })}
    ];
  }
  function benchmarkRows(items) {
    return [['single','Geekbench 6 · Single-core'],['multi','Geekbench 6 · Multi-core']].map(([key,label])=>({label,cells:items.map(i=>{
      const b=research(i)?.benchmark;
      return b&&R.sourceURL(b.url,true)&&Number.isFinite(b[key])?`<a href="${e(b.url)}" target="_blank" rel="noopener noreferrer">${e(b[key].toLocaleString('th-TH'))} ↗</a><small>เวอร์ชัน ${e(b.version)} · ${e(b.model_code)}<br>ทดสอบ ${e(b.upload_date)} · RAM ที่ระบบรายงาน ${e(b.tested_ram_gb_reported??'—')} GB</small>`:'<span class="phone-unknown">— ยังไม่ยืนยันผลตรงรุ่น</span>';
    })}));
  }
  function tableHTML(items,differences=false,now=Date.now(),profile='balanced') {
    if(!items.length)return '<p class="comparison-empty">เลือกรุ่นที่ต้องการจากช่องด้านบน แล้วดูสเปกข้างกัน</p>';
    const rowHTML=(label,cells)=>differences&&items.length>1&&new Set(cells).size===1?'':`<tr><th scope="row">${e(label)}</th>${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`;
    const groupHTML=(label,hint,body)=>body?`<tr class="group-heading"><th colspan="${items.length+1}" scope="rowgroup">${e(label)}<small>${e(hint)}</small></th></tr>${body}`:'';
    const summary=summaryRows(items,now,profile).map(r=>rowHTML(r.label,r.cells)).join('');
    const benchmark=benchmarkRows(items).map(r=>rowHTML(r.label,r.cells)).join('');
    const body=P.groups.map(g=>{
      const rows=g.fields.map(([key,label])=>{
        const facts=items.map(i=>P.field(research(i),key));
        // Compare values and qualifiers, not source URLs: identical specs from different sources are still equal.
        if(differences&&items.length>1&&new Set(facts.map(f=>JSON.stringify([f?.value??null,f?.note??'']))).size===1)return '';
        return `<tr><th scope="row">${e(label)}</th>${facts.map(f=>`<td>${P.cellHTML(f)}</td>`).join('')}</tr>`;
      }).join('');
      return groupHTML(g.label,g.hint,rows);
    }).join('');
    return `<table class="comparison-table" style="min-width:${150+items.length*240}px"><caption>เทียบ ${items.length} รุ่น · ${P.keys.length} หัวข้อสเปก พร้อมราคาและผลทดสอบ${differences?' · แสดงเฉพาะข้อมูลที่ต่างกัน':''}</caption><colgroup><col style="width:150px">${items.map(()=>'<col style="width:240px">').join('')}</colgroup><thead><tr><th scope="col">สิ่งที่ใช้เปรียบเทียบ</th>${items.map(i=>`<th scope="col">${images?.slotHTML(i) || ''}${e(i.display_name||i.title)}<small>สเปกยืนยันได้ ${P.keys.filter(k=>P.field(research(i),k)).length}/${P.keys.length} ช่อง<br>ตรวจ ${e(research(i)?.comparison?.checked_at||'—')}</small></th>`).join('')}</tr></thead><tbody>${groupHTML('ราคาและตัวเลือกในการจัดอันดับ','ตัวเลือกของราคาและสเปกต้องตรงกัน จึงนำมาคำนวณความคุ้มค่าได้',summary)}${groupHTML('ผลทดสอบประสิทธิภาพอ้างอิง','ผลสาธารณะหนึ่งครั้งต่อรุ่น ไม่ใช่ค่าเฉลี่ย และไม่ยืนยันตัวเลือกในตะกร้า ระบบปฏิบัติการและเวอร์ชันทดสอบอาจต่างกัน',benchmark)}${body}</tbody></table>`;
  }
  function installPicker(doc) {
    if(doc.getElementById('phoneCompare'))return;
    const namesKey='yesspec_compare_names_v1',names=new Map();
    let selected=[];
    try{selected=JSON.parse(root.localStorage.getItem(storageKey)||'[]');}catch(_){}
    selected=[...new Set(Array.isArray(selected)?selected:[])].filter(id=>/^\d+\/\d+$/.test(id)).slice(0,4);
    try{
      const saved=JSON.parse(root.localStorage.getItem(namesKey)||'{}');
      if(saved&&typeof saved==='object'&&!Array.isArray(saved))Object.entries(saved).forEach(([id,name])=>{
        if(/^\d+\/\d+$/.test(id)&&typeof name==='string'&&name.trim())names.set(id,name.trim().slice(0,160));
      });
    }catch(_){}
    const tray=doc.createElement('div');tray.className='phone-compare-tray';tray.setAttribute('aria-label','รุ่นที่เลือกเปรียบเทียบ');doc.body.append(tray);
    function update(message='',persist=false) {
      const buttons=Array.from(doc.querySelectorAll('[data-compare-id]'));
      buttons.forEach(b=>{
        const name=b.dataset.compareName||b.closest?.('.listing')?.querySelector('h3')?.textContent;
        if(typeof name==='string'&&name.trim())names.set(b.dataset.compareId,name.trim().slice(0,160));
      });
      tray.hidden=!selected.length&&!message;
      tray.innerHTML=`<div class="compare-tray-selection"><span class="compare-tray-count" role="status">เลือกเทียบ ${selected.length}/4 รุ่น${message?' · '+e(message):''}</span><div class="compare-tray-models" role="list" aria-label="รุ่นที่เลือก ปัดหรือเลื่อนเพื่อดูทั้งหมด" tabindex="0">${selected.map(id=>{
        const name=names.get(id)||`รุ่น ${id}`;
        return `<span class="compare-tray-chip" role="listitem"><span class="compare-tray-model-name" title="${e(name)}">${e(name)}</span><button type="button" data-compare-remove="${e(id)}" aria-label="นำ ${e(name)} ออกจากการเปรียบเทียบ"><span aria-hidden="true">×</span></button></span>`;
      }).join('')}</div></div><div class="compare-tray-actions"><a class="compare-tray-open" href="compare.html?models=${encodeURIComponent(selected.join(','))}&amp;profile=${encodeURIComponent(readProfile())}">เทียบ ${selected.length} รุ่น ↗</a><button type="button" data-compare-clear>ล้างทั้งหมด</button></div>`;
      buttons.forEach(b=>{
        const picked=selected.includes(b.dataset.compareId);b.setAttribute('aria-pressed',String(picked));b.textContent=picked?'✓ เลือกเทียบแล้ว':'＋ เทียบสเปก';
      });
      if(persist)try{
        root.localStorage.setItem(storageKey,JSON.stringify(selected));
        root.localStorage.setItem(namesKey,JSON.stringify(Object.fromEntries(selected.filter(id=>names.has(id)).map(id=>[id,names.get(id)]))));
      }catch(_){}
    }
    doc.addEventListener('click',event=>{
      const button=event.target.closest('[data-compare-id]');
      if(button){
        const id=button.dataset.compareId;if(!/^\d+\/\d+$/.test(id))return;
        if(selected.includes(id))selected=selected.filter(i=>i!==id);
        else if(selected.length===4){update('เทียบได้สูงสุด 4 รุ่น · กดรุ่นที่เลือกเพื่อนำออก');return;}
        else selected.push(id);
        update('',true);
      } else {
        const remove=event.target.closest('[data-compare-remove]');
        if(remove){
          const id=remove.dataset.compareRemove,index=selected.indexOf(id);
          if(index<0)return;
          selected=selected.filter(value=>value!==id);update('',true);
          const next=selected[Math.min(index,selected.length-1)];
          (next?tray.querySelector?.(`[data-compare-remove="${next}"]`):doc.querySelector?.(`[data-compare-id="${id}"]`))?.focus();
        } else if(event.target.closest('[data-compare-clear]')) {selected=[];update('',true);}
      }
    });
    doc.addEventListener('change',event=>{
      if(['categoryTop20Profile','rankingProfile'].includes(event.target.id))update();
    });
    root.addEventListener('storage',event=>{
      if(event.key===profileKey){update();return;}
      if(event.key===namesKey){
        try{
          const next=JSON.parse(event.newValue||'{}');
          if(next&&typeof next==='object'&&!Array.isArray(next))Object.entries(next).forEach(([id,name])=>{
            if(/^\d+\/\d+$/.test(id)&&typeof name==='string'&&name.trim())names.set(id,name.trim().slice(0,160));
          });
          update();
        }catch(_){}
        return;
      }
      if(event.key!==storageKey)return;
      try{const next=JSON.parse(event.newValue||'[]');selected=[...new Set(Array.isArray(next)?next:[])].filter(id=>/^\d+\/\d+$/.test(id)).slice(0,4);update();}catch(_){}
    });
    for(const id of ['categoryTop20Results','rankingResults']) {
      const target=doc.getElementById(id);
      if(target)new MutationObserver(()=>update()).observe(target,{childList:true});
    }
    update();
  }
  async function start(doc) {
    const $=id=>doc.getElementById(id);
    if(!$('phoneCompare')){installPicker(doc);return;}
    const store=rankingData.create({fetcher:(...args)=>root.fetch(...args),host:root});
    let items=[],selected=[],selectionLoaded=false;
    let profile=validProfile(new URLSearchParams(root.location.search).get('profile')||readProfile());
    function render(persist=false) {
      const activeSlot=doc.activeElement?.matches?.('[data-compare-slot]')?doc.activeElement.id:null;
      $('comparisonCount').textContent=`เลือก ${selected.length}/4 รุ่น`;
      $('modelSelectors').innerHTML=Array.from({length:4},(_,n)=>`<label for="compareModel${n}">มือถือ ${n+1}<select id="compareModel${n}" data-compare-slot="${n}"><option value="">เลือกรุ่น${n>1?'เพิ่มเติม':''}</option>${items.map(i=>`<option value="${e(i.listing_id)}" ${selected[n]===i.listing_id?'selected':''} ${selected.includes(i.listing_id)&&selected[n]!==i.listing_id?'disabled':''}>${e(i.display_name)}</option>`).join('')}</select></label>`).join('');
      $('comparisonTable').innerHTML=tableHTML(selected.map(id=>items.find(i=>i.listing_id===id)),$('differencesOnly').checked,Date.now(),profile);
      $('comparisonFormula').innerHTML=R.formulaHTML(profile);
      const url=new URL(root.location.href);
      if(selected.length)url.searchParams.set('models',selected.join(','));else url.searchParams.delete('models');
      url.searchParams.set('profile',profile);
      root.history.replaceState(null,'',url);$('comparisonPermalink').href=url.href;
      if(persist)try{root.localStorage.setItem(storageKey,JSON.stringify(selected));}catch(_){}
      if(activeSlot)doc.getElementById(activeSlot)?.focus({preventScroll:true});
    }
    function applySnapshot(snapshot) {
      const data=snapshot.dataset;
      if(!data || data.catalog_mode!=='smartphone_30') {
        $('compareStatus').innerHTML=`${e(snapshot.message || 'โหลดข้อมูลไม่ได้ กรุณาลองใหม่')} <button type="button" id="retryComparison">ลองใหม่</button>`;
        $('retryComparison').onclick=()=>load(true);
        $('compareControls').hidden=true;
        $('comparisonTable').innerHTML='';
        return;
      }
      items=data.categories.flatMap(c=>c.items).sort((a,b)=>a.display_name.localeCompare(b.display_name));
      const initial=!selectionLoaded;
      if(initial) {
        const params=new URLSearchParams(root.location.search);let ids=params.has('models')?params.get('models').split(','):null;
        if(ids===null)try{ids=JSON.parse(root.localStorage.getItem(storageKey)||'[]');}catch(_){}
        selected=cleanSelection(ids,items);
        selectionLoaded=true;
      } else selected=cleanSelection(selected,items);
      $('compareControls').hidden=false;
      $('compareStatus').textContent=snapshot.status==='ready'?'':snapshot.message;
      render(initial);
    }
    async function load(refresh=false) {
      applySnapshot(await store.load(refresh));
    }
    $('modelSelectors').addEventListener('change',event=>{
      if(!event.target.hasAttribute('data-compare-slot'))return;
      const slots=Array.from({length:4},(_,n)=>doc.getElementById('compareModel'+n).value);
      selected=cleanSelection(slots,items);render(true);
    });
    $('differencesOnly').addEventListener('change',()=>render());
    $('resetComparison').addEventListener('click',()=>{selected=[];render(true);});
    $('comparisonProfile').innerHTML=(R.profiles||[]).map(p=>`<option value="${e(p.id)}">${e(p.label)}</option>`).join('');
    $('comparisonProfile').value=profile;
    $('comparisonProfile').addEventListener('change',event=>{
      profile=validProfile(event.target.value);
      try{root.localStorage.setItem(profileKey,profile);}catch(_){}
      render();
    });
    $('comparisonFormula').innerHTML=R.formulaHTML(profile);
    store.watch(applySnapshot);await load();
  }
  const api={cleanSelection,research,tableHTML,summaryRows,benchmarkRows};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.PhoneComparison=api;
  if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',()=>start(root.document));else start(root.document);}
})(typeof window!=='undefined'?window:globalThis);
