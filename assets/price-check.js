(function (root) {
  'use strict';
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => '฿' + Number(n).toLocaleString('th-TH',{maximumFractionDigits:2});
  const time = value => new Date(value).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
  function selectedOffer(current, result, index, confirmation) {
    const candidate = result?.candidates?.[index];
    if (!confirmation?.matched || !['regular','vip','coupon','flash_sale'].includes(confirmation.price_type) ||
        result.requested_url !== current.url || result.status !== 'candidates_found' ||
        !candidate || candidate.currency !== 'THB' || !Number.isFinite(candidate.amount) || candidate.amount <= 0 ||
        !Number.isFinite(Date.parse(result.checked_at))) return null;
    return {...current, price:String(candidate.amount), price_type:confirmation.price_type,
      variant:confirmation.variant.trim(), note:confirmation.note.trim(),
      price_lookup:{requested_url:result.requested_url,resolved_url:result.resolved_url,
        amount:candidate.amount,checked_at:result.checked_at,confirmed:true}};
  }
  function create({dialog, api, apply, manual}) {
    let active = null, request = 0;
    function close() {
      ++request; active?.controller.abort(); active = null;
      if (dialog.open) dialog.close();
    }
    function cancel() { close(); }
    dialog.addEventListener('cancel', event => {event.preventDefault(); cancel();});
    dialog.addEventListener('close', () => { if (active && !dialog.open) close(); });
    function shell(context, content) {
      const pf = root.RankingOffers.names[context.platform];
      dialog.innerHTML = `<div class="check-header"><div><p class="eyebrow">${e(pf)}</p><h2 id="priceCheckTitle">ตรวจราคาจากลิงก์</h2></div><button type="button" data-check-close aria-label="ปิดหน้าตรวจราคา">✕</button></div><p class="check-product">สินค้าในอันดับ: ${e(context.title)}</p><p>ราคาในฟอร์ม: <strong>${context.offer.price ? money(context.offer.price) : '—'}</strong></p>${content}<div class="check-footer"><a href="${e(context.offer.url)}" target="_blank" rel="noopener noreferrer">เปิดหน้าสินค้า ↗</a><button type="button" data-check-manual>กรอกราคาเอง</button></div>`;
    }
    function canConfirm() {
      return !!dialog.querySelector('[name="priceCandidate"]:checked') &&
        !!dialog.querySelector('#checkMatched')?.checked && !!dialog.querySelector('#checkPriceType')?.value;
    }
    function renderResult(context, result) {
      const hasPrices = result.status === 'candidates_found' && result.candidates.length;
      const ranges = result.ranges?.length ? `<p>ช่วงราคาที่พบ: ${result.ranges.map(r=>`${money(r.low)} – ${money(r.high)}`).join(' · ')}</p>` : '';
      shell(context, `<p class="check-message" role="status">${e(result.message)}</p><p class="muted">ตรวจเมื่อ ${e(time(result.checked_at))} · อ่านหน้าสาธารณะ ไม่ใช้สถานะล็อกอินในเบราว์เซอร์</p>${ranges}${hasPrices ? `<form id="priceConfirmForm"><fieldset><legend>เลือกราคาที่ต้องการใช้</legend>${result.candidates.map((c,i)=>`<label class="price-candidate"><input type="radio" name="priceCandidate" value="${i}" required><span><strong>${money(c.amount)}</strong><span>${e(c.product_title)}</span><small>${c.variant ? 'ตัวเลือก/รหัสที่หน้าร้านระบุ: '+e(c.variant) : 'หน้าร้านไม่ได้ระบุตัวเลือกของราคานี้'}</small></span></label>`).join('')}</fieldset><p class="check-warning">ราคานี้อาจยังไม่รวมสิทธิ์สมาชิกหรือคูปอง กรุณาเปิดหน้าสินค้าตรวจราคาและตัวเลือกให้ตรงก่อนยืนยัน</p><label for="checkPriceType">ยืนยันประเภทราคา<select id="checkPriceType" required><option value="">เลือกประเภทราคา</option><option value="regular">ราคาปกติ</option><option value="vip">VIP / สมาชิก</option><option value="coupon">มีเงื่อนไขคูปอง</option><option value="flash_sale">แฟลชเซล</option></select></label><label for="checkVariant">ตัวเลือก / ความจุ / ขนาดที่ตรวจแล้ว<input id="checkVariant" maxlength="500" value="${e(context.offer.variant)}"></label><label for="checkNote">เงื่อนไขราคา<input id="checkNote" maxlength="500" value="${e(context.offer.note)}"></label><label class="match-check"><input id="checkMatched" type="checkbox" required><span>ฉันตรวจแล้วว่าร้าน รุ่น ตัวเลือก และเงื่อนไขตรงกับราคาที่จะใช้</span></label><p class="muted">การยืนยันจะใส่ราคาในฟอร์มก่อน ยังไม่เผยแพร่จนกดบันทึกรายการ</p><button class="primary" id="confirmCheckedPrice" type="submit" disabled>ยืนยันและใส่ราคาในฟอร์ม</button></form>` : '<p>ราคาเดิมยังอยู่ในฟอร์ม คุณสามารถแก้ไขและบันทึกเองได้</p>'}`);
      const form = dialog.querySelector('#priceConfirmForm');
      if (!form) return;
      form.addEventListener('change', () => {dialog.querySelector('#confirmCheckedPrice').disabled = !canConfirm();});
      form.addEventListener('submit', event => {
        event.preventDefault(); if (!active || !canConfirm()) return;
        const value = selectedOffer(context.offer,result,Number(dialog.querySelector('[name="priceCandidate"]:checked').value),{
          matched:dialog.querySelector('#checkMatched').checked,price_type:dialog.querySelector('#checkPriceType').value,
          variant:dialog.querySelector('#checkVariant').value,note:dialog.querySelector('#checkNote').value});
        if (value && apply(context,value)) close();
      });
    }
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-check-close]')) close();
      if (event.target.closest('[data-check-manual]')) {const context=active?.context;close();if(context)manual(context);}
    });
    async function open(context) {
      close();
      const ticket = ++request, controller = new AbortController();
      active = {context,controller};
      shell(context,'<p class="check-message" role="status">กำลังตรวจราคา… ยังไม่เปลี่ยนราคาในฟอร์ม</p>');
      dialog.showModal();
      try {
        const result = await api('/api/admin/check-ranking-price',{platform:context.platform,url:context.offer.url},{signal:controller.signal});
        if (ticket !== request || !active) return;
        if (result.requested_url !== context.offer.url || result.platform !== context.platform) throw new Error('ผลตรวจไม่ตรงกับลิงก์ที่เลือก กรุณาตรวจใหม่');
        renderResult(context,result);
      } catch (error) {
        if (ticket !== request || !active || error.name === 'AbortError') return;
        shell(context,`<p class="check-message" role="status">${e(error.message || 'ตรวจราคาไม่ได้')}</p><p>ราคาเดิมยังอยู่ คุณสามารถเปิดหน้าสินค้าแล้วกรอกเองได้</p>`);
      }
    }
    return {open,close};
  }
  const api = {create,selectedOffer};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PriceCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
