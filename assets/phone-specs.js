(function (root) {
  'use strict';
  const groups = [
    {id:'identity',label:'รุ่นและตลาดอ้างอิง',hint:'ชื่อรุ่นเดียวกันอาจมีสเปกต่างกันตามประเทศและรหัสเครื่อง',fields:[['model_code','รหัสรุ่น'],['market','ตลาดของข้อมูลอ้างอิง']]},
    {id:'performance',label:'ชิปและหน่วยความจำ',hint:'แยก RAM จริงจาก RAM เสมือน และตรวจคู่ RAM/ความจุของรุ่นย่อยที่ซื้อ',fields:[['chipset','ชิปประมวลผล'],['cpu','CPU'],['gpu','GPU'],['ram_options','ตัวเลือก RAM จริง'],['ram_type','ชนิด RAM'],['storage_options','ตัวเลือกความจุ'],['storage_type','ชนิดหน่วยเก็บข้อมูล'],['micro_sd','เพิ่ม microSD']]},
    {id:'display',label:'หน้าจอ',hint:'ความสว่าง typical, HBM และ peak วัดคนละเงื่อนไข ไม่ควรเทียบเป็นตัวเลขเดียว',fields:[['display_inches','ขนาดจอหลัก (นิ้ว)'],['display_type','ชนิดจอ'],['resolution','ความละเอียดจอ'],['refresh_hz','รีเฟรชเรตสูงสุด (Hz)'],['brightness','ความสว่างและเงื่อนไข'],['cover_display','จอนอก / จอรอง'],['glass','กระจกหน้าจอ']]},
    {id:'camera',label:'กล้องและวิดีโอ',hint:'ดูเลนส์ OIS ระยะซูมและวิดีโอร่วมกัน จำนวน MP อย่างเดียวไม่ยืนยันคุณภาพภาพถ่าย',fields:[['rear_camera','ชุดกล้องหลัง'],['main_ois','กันสั่น OIS กล้องหลัก'],['ultrawide','กล้องมุมกว้างพิเศษ'],['telephoto','กล้องซูม / ระยะซูม'],['front_camera','กล้องหน้า'],['video','วิดีโอสูงสุดและกันสั่น']]},
    {id:'power',label:'แบตเตอรี่และการชาร์จ',hint:'mAh ไม่ใช่ระยะเวลาใช้งานจริง กำลังชาร์จสูงสุดขึ้นกับหัวชาร์จ สาย และเงื่อนไขผู้ผลิต',fields:[['battery_mah','แบตเตอรี่ (mAh / ชนิดค่าที่ระบุ)'],['wired_charging','ชาร์จผ่านสาย'],['wireless_charging','ชาร์จไร้สาย / ย้อนกลับ'],['charger_in_box','หัวชาร์จในกล่อง']]},
    {id:'software',label:'ระบบและการอัปเดต',hint:'เวอร์ชันตอนเปิดตัวอาจต่างจากซอฟต์แวร์ปัจจุบัน ระยะอัปเดตต้องมีประกาศของรุ่นนั้น',fields:[['os','ระบบปฏิบัติการ / UI ที่อ้างอิง'],['update_policy','นโยบายอัปเดต OS / ความปลอดภัย']]},
    {id:'connectivity',label:'เครือข่ายและการใช้งาน',hint:'ตรวจย่านความถี่ eSIM และ NFC ตามประเทศ รุ่นย่อย และผู้ให้บริการ',fields:[['network','4G / 5G และย่านความถี่'],['sim','ช่อง SIM'],['esim','eSIM'],['wifi','Wi-Fi'],['bluetooth','Bluetooth'],['nfc','NFC'],['usb','พอร์ต / ความเร็ว USB / จอภายนอก'],['audio','ลำโพง / ช่องหูฟัง'],['biometrics','สแกนนิ้ว / ใบหน้า']]},
    {id:'body',label:'ตัวเครื่องและความทนทาน',hint:'ระดับ IP เป็นผลทดสอบตามเงื่อนไข ไม่ใช่การรับประกันความเสียหายจากน้ำ',fields:[['dimensions','ขนาดตัวเครื่อง'],['weight_g','น้ำหนัก'],['ip_rating','กันน้ำ / ฝุ่น'],['materials','วัสดุตัวเครื่อง']]},
    {id:'support',label:'ประกันและบริการ',hint:'นโยบายผู้ผลิตไม่ยืนยันว่าเครื่องจากทุกตะกร้ามีประกันไทย ต้องตรวจร้านและใบเสร็จ',fields:[['warranty','เงื่อนไขประกันที่ยืนยันได้']]}
  ];
  const keys = groups.flatMap(g=>g.fields.map(([key])=>key));
  const esc = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function officialURL(raw) {
    if (typeof raw !== 'string' || /[\s<>"'\\\u0000-\u001f]/.test(raw)) return '';
    try {
      const u=new URL(raw), domains=['samsung.com','apple.com','mi.com','po.co','oppo.com','realme.com','vivo.com','iqoo.com','honor.com','meizu.com'];
      const deviceRegistry=u.hostname==='storage.googleapis.com'&&u.pathname==='/play_public/supported_devices.html'&&!u.search;
      return u.protocol==='https:' && !u.username && !u.password && !u.port && (deviceRegistry||domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d))) ? raw : '';
    } catch (_) { return ''; }
  }
  function field(research,key) {
    const fact=research?.comparison?.fields?.[key];
    return fact && ['string','number'].includes(typeof fact.value) && String(fact.value).trim() &&
      (typeof fact.value!=='number'||Number.isFinite(fact.value)) && officialURL(fact.url) ? fact : null;
  }
  function cellHTML(fact) {
    return fact ? `<a class="phone-fact" href="${esc(fact.url)}" target="_blank" rel="noopener noreferrer">${esc(fact.value)} <span aria-label="แหล่งอ้างอิง">↗</span></a>${fact.note?`<small class="phone-fact-note">${esc(fact.note)}</small>`:''}` : '<span class="phone-unknown">— ยังไม่ยืนยัน</span>';
  }
  function detailsHTML(research) {
    if (!research?.comparison) return '';
    const count=keys.filter(k=>field(research,k)).length;
    return `<div class="phone-full-specs"><p>ข้อมูลสเปกยืนยันได้ ${count}/${keys.length} ช่อง · ตรวจ ${esc(research.comparison.checked_at)} · ช่องว่างหมายถึงยังไม่ยืนยัน ไม่ใช่ไม่รองรับ</p>${groups.map(g=>`<details class="phone-spec-group"><summary>${esc(g.label)}</summary><p>${esc(g.hint)}</p><dl>${g.fields.map(([key,label])=>`<div><dt>${esc(label)}</dt><dd>${cellHTML(field(research,key))}</dd></div>`).join('')}</dl></details>`).join('')}${research.comparison.notes?.length?`<ul>${research.comparison.notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}</div>`;
  }
  const api={groups,keys,esc,officialURL,field,cellHTML,detailsHTML};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.PhoneSpecs=api;
})(typeof window!=='undefined'?window:globalThis);
