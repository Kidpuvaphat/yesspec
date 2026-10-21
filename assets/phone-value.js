(function (root) {
  'use strict';
  const sources = root.PhoneSpecs || (typeof require === 'function' ? require('./phone-specs.js') : null);
  const groupLabels = {performance:'ประสิทธิภาพ CPU',memory:'หน่วยความจำ',camera:'กล้องและวิดีโอ',display:'หน้าจอ',battery:'แบตเตอรี่และชาร์จ',updates:'การอัปเดตระบบ'};
  const profiles = [
    ['balanced','สมดุล',[25,10,20,15,20,10]],
    ['photo','ถ่ายรูป',[15,5,45,15,10,10]],
    ['gaming','เล่นเกม',[40,10,5,25,15,5]],
    ['work','ทำงาน',[20,20,10,10,15,25]],
    ['live','ไลฟ์สด',[25,10,25,15,20,5]],
    ['battery','เน้นแบตเตอรี่',[10,5,5,10,60,10]]
  ].map(([id,label,weights])=>({id,label,weights:Object.fromEntries(Object.keys(groupLabels).map((key,i)=>[key,weights[i]]))}));
  // Fixed editorial references; missing evidence never redistributes its weight.
  const metrics = {
    performance:[['geekbench6_single','Geekbench 6 Single-core',40,3000],['geekbench6_multi','Geekbench 6 Multi-core',60,10000]],
    memory:[['ram_gb','RAM จริง (ไม่รวม RAM เสมือน)',50,12],['storage_gb','ความจุ',50,512]],
    camera:[['camera_ois','กันสั่น OIS กล้องหลัก',30,'boolean'],['camera_ultrawide','กล้อง Ultrawide',15,'boolean'],['camera_optical_zoom','เลนส์เทเล: ระยะออปติคัล',20,5],['camera_rear_video','วิดีโอกล้องหลัง',20,1],['camera_front_video','วิดีโอกล้องหน้า',15,1]],
    display:[['display_oled','ชนิดจอ OLED / LCD',25,'display'],['display_ppi','ความหนาแน่นพิกเซล',25,450],['refresh_hz','รีเฟรชเรต',30,120],['display_hbm_nits','ความสว่าง HBM',20,1200]],
    battery:[['battery_mah','ความจุแบตเตอรี่',60,6000],['wired_watts','กำลังชาร์จสายที่รองรับ',30,80],['wireless_watts','กำลังชาร์จไร้สายที่รองรับ',10,30]],
    updates:[['os_upgrades','จำนวนรุ่น OS ที่ประกาศรองรับ',40,7],['security_years','ระยะสนับสนุนความปลอดภัยรวมที่ประกาศ',60,7]]
  };
  const baseKeys = new Set(['geekbench6_single','geekbench6_multi','ram_gb','storage_gb','battery_mah','refresh_hz']);
  const zeroAllowed = new Set(['camera_optical_zoom','wireless_watts','os_upgrades','security_years']);
  const profileFor = id => profiles.find(p=>p.id === id) || profiles[0];
  function normalized(value,reference,key) {
    if (reference === 'boolean' || reference === 'display') return typeof value === 'boolean' ? (value ? 1 : reference === 'display' ? .6 : 0) : null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!zeroAllowed.has(key) && value === 0)) return null;
    if (key.endsWith('_video') && value > 1) return null;
    return Math.min(value/reference,1);
  }
  function evaluate(spec = {}, inputs = {}, profile = 'balanced', now = Date.now()) {
    const selected = profileFor(profile), missing = [], groups = [];
    const date = Date.parse(inputs.checked_at);
    const dated = Number.isFinite(date) && date <= now;
    let low = 0, high = 0, coverage = 0;
    for (const [id,definitions] of Object.entries(metrics)) {
      let groupLow = 0, groupHigh = 0, groupCoverage = 0;
      const details = definitions.map(([key,label,baseWeight,reference])=>{
        const weight = id === 'camera' && selected.id === 'live' ? ({camera_ois:15,camera_ultrawide:5,camera_optical_zoom:0,camera_rear_video:25,camera_front_video:55}[key]) : baseWeight;
        const evidence = inputs.metrics?.[key];
        const value = baseKeys.has(key) ? spec[key] : dated && sources?.officialURL(evidence?.url) && evidence?.source_field ? evidence.value : null;
        const fraction = normalized(value,reference,key);
        const known = fraction !== null;
        groupLow += known ? weight*fraction : 0;
        groupHigh += known ? weight*fraction : weight;
        groupCoverage += known ? weight : 0;
        if (!known && weight) missing.push({key,label,group:id,weight:selected.weights[id]*weight/100});
        return {key,label,weight,known,value:known ? value : null,score:known ? fraction*100 : 50,
          url:known ? baseKeys.has(key) ? key.startsWith('geekbench') ? spec.benchmark_url : spec.spec_url : evidence.url : null,
          note:known && !baseKeys.has(key) ? evidence.note || '' : ''};
      });
      const weight = selected.weights[id];
      low += weight*groupLow/100; high += weight*groupHigh/100; coverage += weight*groupCoverage/100;
      groups.push({id,label:groupLabels[id],weight,score:(groupLow+groupHigh)/2,low:groupLow,high:groupHigh,coverage:groupCoverage,metrics:details});
    }
    const spec_score = (low+high)/2, eligible = coverage >= 50;
    return {profile:selected.id,score_kind:'suitability',score:eligible ? Math.round(spec_score*10000)/10000 : null,
      spec_score,score_low:low,score_high:high,spec_score_low:low,spec_score_high:high,
      provisional:missing.length > 0,coverage,missing,groups,
      reason:eligible ? '' : 'รอหลักฐานสเปกอย่างน้อย 50% ของน้ำหนัก · ยังไม่จัดอันดับ'};
  }
  const api = {profiles,metrics,groupLabels,profileFor,evaluate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PhoneValue = api;
})(typeof window !== 'undefined' ? window : globalThis);
