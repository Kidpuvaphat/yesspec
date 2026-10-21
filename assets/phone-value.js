(function (root) {
  'use strict';
  const sources = root.PhoneSpecs || (typeof require === 'function' ? require('./phone-specs.js') : null);
  const version = 'yesspec-usage-v3';
  const metric = (key,label,weight,proxy = [],note = '') => ({key,label,weight,proxy,note,protocol_id:'yesspec-v3:'+key});
  const group = (label,metrics) => ({label,metrics});
  // An outcome is scored once: a reviewed task test replaces its specification proxies.
  // Proxy weights remain fixed when evidence is missing; their uncertainty is displayed.
  const groupDefinitions = {
    daily_tasks:group('ความลื่นในการใช้แอปทั่วไปและสลับแอป',[
      metric('daily_response','เปิดและใช้แอปทั่วไป',60,[['geekbench6_single',60],['geekbench6_multi',40]]),
      metric('daily_switching','กลับเข้าแอปและสลับงาน',40,[['ram_gb',100]])]),
    daily_power:group('แบตเตอรี่และการชาร์จในชีวิตประจำวัน',[
      metric('daily_endurance','ระยะใช้งานประจำวัน',80,[['battery_mah',100]]),
      metric('charge_recovery','เวลาเติมแบต 20–80%',20,[['wired_watts',100]])]),
    daily_display:group('จอสำหรับอ่าน ดูวิดีโอ และใช้นอกอาคาร',[
      metric('display_readability','ความชัดและการอ่านนอกอาคาร',60,[['display_ppi',50],['display_hbm_nits',50]]),
      metric('display_viewing','ภาพและความลื่นขณะดูเนื้อหา',40,[['display_oled',50],['refresh_hz',50]])]),
    daily_camera:group('คุณภาพภาพถ่ายทั่วไป',[metric('photo_main_image','รายละเอียด สี และช่วงแสงจากกล้องหลัก',100)]),
    daily_communication:group('โทร เสียง และการเชื่อมต่อ',[
      metric('call_audio','เสียงสนทนา',50),metric('network_reliability','ความเสถียรของการเชื่อมต่อ',50)]),
    daily_support:group('ระยะอัปเดตและการสนับสนุนที่เหลือ',[
      metric('remaining_security','ระยะอัปเดตความปลอดภัยที่เหลือ',100,[['security_remaining_years',100]])]),
    photo_main:group('คุณภาพภาพจากกล้องหลัก',[metric('photo_main_image','รายละเอียด สี และช่วงแสงจากกล้องหลัก',100)]),
    photo_lowlight:group('ถ่ายกลางคืนและแสงน้อย',[metric('photo_lowlight_image','รายละเอียด นอยส์ และภาพเบลอในแสงน้อย',100)]),
    photo_lenses:group('เลนส์และคุณภาพการซูม',[
      metric('photo_wide','มุมกว้างที่ใช้งานได้',25,[['camera_ultrawide',100]]),
      metric('photo_optical_reach','ระยะออปติคัลของเลนส์เทเลที่ยืนยันได้',25,[['camera_optical_zoom',100]]),
      metric('photo_lens_quality','คุณภาพและความสม่ำเสมอระหว่างเลนส์และระยะซูม',50)]),
    photo_people:group('ภาพบุคคลและเซลฟี',[metric('photo_people_image','สีผิว ใบหน้า และการแยกฉากหลัง',100)]),
    photo_capture:group('โฟกัสและจับจังหวะ',[metric('photo_capture_response','โฟกัส ชัตเตอร์ และภาพเคลื่อนไหว',100)]),
    photo_endurance:group('ถ่ายต่อเนื่องได้นาน',[
      metric('photo_runtime','ระยะเวลาถ่ายรูปต่อแบตหนึ่งรอบ',75,[['battery_mah',100]]),
      metric('photo_thermal_continuity','กล้องยังทำงานต่อเนื่องเมื่อใช้นาน',25)]),
    game_sustained:group('ความลื่นต่อเนื่อง',[
      metric('game_fps','FPS เฉลี่ยในเกมและกราฟิกเดียวกัน',62.5),
      metric('game_frame_consistency','ความสม่ำเสมอของเฟรมและอาการกระตุก',37.5)]),
    game_display:group('จอและการควบคุม',[
      metric('game_touch_response','ความหน่วงจากการสัมผัสถึงภาพ',40),
      metric('game_motion_clarity','ความชัดขณะภาพเคลื่อนไหว',35,[['refresh_hz',100]]),
      metric('game_visibility','ความชัดและการมองเห็นภาพเกม',25,[['display_ppi',50],['display_hbm_nits',50]])]),
    game_power:group('ระยะเวลาเล่นและเติมแบต',[
      metric('game_runtime','ระยะเวลาเล่นเกมต่อแบตหนึ่งรอบ',75,[['battery_mah',100]]),
      metric('charge_recovery','เวลาเติมแบต 20–80%',25,[['wired_watts',100]])]),
    game_comfort:group('ความสบายในการเล่นนาน',[
      metric('game_surface_heat','ความร้อนที่มือสัมผัส',50),
      metric('game_handling','น้ำหนักและการถือเล่น',50,[['weight_g',100]])]),
    game_audio_network:group('เสียงและการเชื่อมต่อ',[
      metric('game_audio','เสียงเกมและการสื่อสาร',50),
      metric('game_network','ความเสถียรของการเชื่อมต่อขณะเล่น',50)]),
    work_tasks:group('ทำงานและสลับแอป',[
      metric('work_response','เปิดเอกสาร เว็บ และแอปทำงาน',60,[['geekbench6_single',60],['geekbench6_multi',40]]),
      metric('work_switching','กลับเข้าแอปงานโดยไม่โหลดใหม่',40,[['ram_gb',100]])]),
    work_power:group('แบตเตอรี่ระหว่างวัน',[
      metric('work_runtime','ระยะใช้งานเอกสาร เว็บ และประชุม',75,[['battery_mah',100]]),
      metric('charge_recovery','เวลาเติมแบต 20–80%',25,[['wired_watts',100]])]),
    work_display:group('จอสำหรับอ่านและป้อนข้อมูล',[
      metric('display_readability','ความชัดและการอ่านนอกอาคาร',70,[['display_ppi',50],['display_hbm_nits',50]]),
      metric('work_input_space','พื้นที่ใช้งานและความสะดวกในการป้อนข้อมูล',30)]),
    work_meetings:group('ประชุมและติดต่อสื่อสาร',[
      metric('meeting_image','ภาพที่ผู้ร่วมประชุมได้รับ',40),
      metric('meeting_audio','เสียงพูดและเสียงผู้ร่วมประชุม',35),
      metric('meeting_connection','ความต่อเนื่องของการประชุม',25)]),
    work_support:group('ความปลอดภัยและการสนับสนุน',[
      metric('remaining_security','ระยะอัปเดตความปลอดภัยที่เหลือ',100,[['security_remaining_years',100]])]),
    work_files:group('จัดการไฟล์และเครื่องมือทำงาน',[
      metric('work_storage','พื้นที่เก็บงานที่เพียงพอ',50,[['storage_gb',100]]),
      metric('work_file_transfer','การโอนไฟล์',25,[['usb_mbps',100]]),
      metric('work_tools','แบ่งหน้าจอและอุปกรณ์ทำงาน',25)]),
    live_image:group('ภาพที่ผู้ชมได้รับ',[metric('live_delivered_image','ภาพปลายทางผ่านแอปไลฟ์จริง',100)]),
    live_continuity:group('ความต่อเนื่องของไลฟ์',[metric('live_stream_continuity','เฟรมตก แอปค้าง และการทำงานเมื่อร้อน',100)]),
    live_power:group('ระยะเวลาและการจ่ายไฟ',[
      metric('live_runtime','ระยะเวลาไลฟ์ต่อแบตหนึ่งรอบ',75,[['battery_mah',100]]),
      metric('live_external_power','การไลฟ์ขณะชาร์จหรือจ่ายไฟภายนอก',25)]),
    live_audio:group('คุณภาพเสียง',[metric('live_delivered_audio','เสียงพูด เสียงรบกวน และไมค์ภายนอก',100)]),
    live_controls:group('การเชื่อมต่อและควบคุมไลฟ์',[
      metric('live_network','การเชื่อมต่อในเครือข่ายที่ควบคุม',50),
      metric('live_operation','สลับกล้องและควบคุมระหว่างไลฟ์',50)]),
    battery_active:group('ระยะเวลาใช้งานจริง',[
      metric('battery_web','ระยะใช้เว็บและโซเชียล',100/3,[['battery_mah',100]]),
      metric('battery_video','ระยะดูวิดีโอ',100/3,[['battery_mah',100]]),
      metric('battery_calls','ระยะโทร',100/6,[['battery_mah',100]]),
      metric('battery_navigation','ระยะนำทาง',100/6,[['battery_mah',100]])]),
    battery_standby:group('การกินไฟขณะพัก',[metric('battery_idle','การลดของแบตขณะพักเครื่อง',100)]),
    battery_charge:group('เวลาชาร์จจริง',[metric('charge_recovery','เวลาเติมแบต 20–80%',100,[['wired_watts',100]])]),
    battery_health:group('การรักษาสุขภาพแบต',[
      metric('battery_cycle_health','ความทนต่อรอบชาร์จ',70,[['battery_cycles_80',100]]),
      metric('battery_charge_management','การจำกัดการชาร์จเพื่อรักษาแบต',30,[['charge_limit',100]])])
  };
  const profiles = [
    ['balanced','ใช้งานทั่วไป / สมดุล','แอปทั่วไป แบต จอ ภาพถ่าย การสื่อสาร และการสนับสนุน',{daily_tasks:25,daily_power:25,daily_display:15,daily_camera:15,daily_communication:10,daily_support:10}],
    ['photo','ถ่ายรูป','ภาพสวย หลายระยะ เก็บภาพทัน และถ่ายต่อเนื่อง',{photo_main:25,photo_lowlight:20,photo_lenses:20,photo_people:15,photo_capture:10,photo_endurance:10}],
    ['gaming','เล่นเกม','เกมและการตั้งค่าเดียวกัน ความลื่นต่อเนื่อง ควบคุมทัน เล่นได้นาน',{game_sustained:40,game_display:20,game_power:20,game_comfort:10,game_audio_network:10}],
    ['work','ทำงาน','เอกสาร เว็บ แชต หลายแอป และประชุม',{work_tasks:25,work_power:20,work_display:15,work_meetings:15,work_support:15,work_files:10}],
    ['live','ไลฟ์สดต่อเนื่อง','แอป กล้อง และเครือข่ายเดียวกัน ประเมินสิ่งที่ผู้ชมได้รับ',{live_image:30,live_continuity:25,live_power:20,live_audio:15,live_controls:10}],
    ['battery','แบตอึด','ระยะใช้งาน พักเครื่อง ชาร์จ และสุขภาพแบต',{battery_active:60,battery_standby:15,battery_charge:15,battery_health:10}]
  ].map(([id,label,description,weights])=>({id,label,description,weights}));
  const groupLabels = Object.fromEntries(Object.entries(groupDefinitions).map(([id,g])=>[id,g.label]));
  const proxyRubric = [
    ['geekbench6_single','Geekbench 6 Single-core',3000,'ตัวแทนการตอบสนองของ CPU ไม่ใช่ FPS หรือภาพถ่าย'],
    ['geekbench6_multi','Geekbench 6 Multi-core',10000,'ตัวแทนงาน CPU หลายแกน ไม่ใช่ผลทดสอบสลับแอป'],
    ['ram_gb','RAM จริง',12,'ตัวแทนพื้นที่รองรับหลายแอป ไม่รวม RAM เสมือน'],
    ['storage_gb','ความจุเก็บงาน',256,'ความจุที่เพียงพอต่องาน จำกัดแต้มที่ 256 GB'],
    ['battery_mah','ความจุแบตเตอรี่',6000,'ประมาณจากความจุร่วมกัน ไม่ใช่ชั่วโมงใช้งานของแต่ละงาน'],
    ['wired_watts','กำลังชาร์จสาย',80,'กำลังสูงสุดเป็นตัวแทน ไม่ใช่เวลาชาร์จจริง'],
    ['display_ppi','ความหนาแน่นพิกเซล',450,'ตัวแทนความละเอียด ไม่ยืนยันความอ่านง่ายทั้งหมด'],
    ['display_hbm_nits','ความสว่าง HBM',1200,'ใช้ HBM ที่ระบุเท่านั้น ไม่ใช้ peak แทน'],
    ['display_oled','ชนิดจอ OLED / LCD','display','OLED 100 / LCD 60 เป็นเกณฑ์ประมาณของเว็บ ไม่ใช่ผลวัดสี'],
    ['refresh_hz','รีเฟรชเรตสูงสุด',120,'ตัวแทนความสามารถจอ ไม่ใช่ FPS หรือความหน่วงสัมผัส'],
    ['camera_ultrawide','การรองรับกล้อง Ultrawide','boolean','ตัวแทนความครอบคลุมมุมกว้าง ไม่ยืนยันคุณภาพภาพ'],
    ['camera_optical_zoom','ระยะออปติคัลของเลนส์เทเล',5,'ตัวแทนระยะเลนส์เทเล ไม่ยืนยันคุณภาพหรือระยะระหว่างกล้องหลักกับเลนส์เทเล'],
    ['weight_g','น้ำหนักเครื่อง','weight','170 g หรือน้อยกว่า = 100; 280 g หรือมากกว่า = 0; ระหว่างนั้นเชิงเส้น ไม่ยืนยันความถนัดมือ'],
    ['usb_mbps','ความเร็วพอร์ต USB ที่รองรับ',5000,'ตัวแทนความสามารถพอร์ต ไม่ใช่ความเร็วโอนไฟล์จริง'],
    ['security_remaining_years','ระยะความปลอดภัยที่เหลือ',5,'คำนวณจากวันสิ้นสุดที่ยืนยันได้ จำกัดที่ 5 ปี'],
    ['battery_cycles_80','รอบชาร์จก่อนเหลือความจุ 80%',1000,'ตามเงื่อนไขที่ผู้ผลิตประกาศ ไม่ยืนยันอายุใช้งานของทุกเครื่อง'],
    ['charge_limit','รองรับการจำกัดการชาร์จ','boolean','รองรับ = 100; ยืนยันว่าไม่รองรับ = 0']
  ].map(([key,label,reference,description])=>({key,label,reference,description}));
  const proxyByKey = Object.fromEntries(proxyRubric.map(p=>[p.key,p]));
  for (const definition of Object.values(groupDefinitions)) {
    for (const m of definition.metrics) m.proxyDescription=m.proxy.map(([key,weight])=>{
      const p=proxyByKey[key];
      return p.label+' '+weight+'% ของหัวข้อนี้'+(typeof p.reference==='number'?' · คะแนนเต็มเมื่อถึง '+p.reference:'')+' · '+p.description;
    }).join(' / ');
  }
  const baseKeys = new Set(['geekbench6_single','geekbench6_multi','ram_gb','storage_gb','battery_mah','refresh_hz']);
  const zeroAllowed = new Set(['camera_optical_zoom','wired_watts','security_remaining_years']);
  const profileFor = id => profiles.find(p=>p.id === id) || profiles[0];
  const clamp = n => Math.max(0,Math.min(1,n));
  const round = n => Math.round(n*1000000)/1000000;
  function safeURL(raw) {
    if (typeof raw !== 'string' || /[\s<>"'\\\u0000-\u001f]/.test(raw)) return '';
    try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password && !u.port ? raw : ''; }
    catch (_) { return ''; }
  }
  function dateStamp(raw) {
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(raw)) return NaN;
    const dateOnly=raw.slice(0,10),midnight=Date.parse(dateOnly+'T00:00:00Z');
    if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0,10)!==dateOnly) return NaN;
    return Date.parse(raw);
  }
  function validDate(raw,now) {
    const stamp=dateStamp(raw);
    return Number.isFinite(stamp) && stamp <= now;
  }
  function officialFact(inputs,key,now) {
    const fact=inputs.metrics?.[key];
    return validDate(inputs.checked_at,now) && fact && sources?.officialURL(fact.url) &&
      typeof fact.source_field === 'string' && fact.source_field.trim() ? fact : null;
  }
  function proxyFact(spec,inputs,key,now) {
    const def=proxyByKey[key];
    let value=null,url='',note='';
    if (key === 'security_remaining_years') {
      // Total promised years alone cannot establish how much support remains.
      const end=officialFact(inputs,'security_support_end',now);
      if (end && typeof end.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(end.value) && Number.isFinite(dateStamp(end.value))) {
        value=Math.max(0,(Date.parse(end.value+'T23:59:59Z')-now)/(365.2425*86400000));url=end.url;
        note='สิ้นสุดการสนับสนุน '+end.value;
      } else {
        const start=officialFact(inputs,'security_support_start',now),years=officialFact(inputs,'security_years',now);
        if (start && years && validDate(start.value,now) && typeof years.value === 'number' && Number.isFinite(years.value) && years.value >= 0) {
          const endTime=Date.parse(start.value)+years.value*365.2425*86400000;
          value=Math.max(0,(endTime-now)/(365.2425*86400000));url=years.url;
          note='เริ่มนับตามหลักฐาน '+start.value+' · ระยะรวม '+years.value+' ปี · แหล่งวันเริ่ม '+start.url;
        }
      }
    } else if (baseKeys.has(key)) {
      const checked=spec.checked_at || inputs.base_checked_at;
      const benchmark=key.startsWith('geekbench');
      const benchmarkURL=safeURL(spec.benchmark_url);
      const benchmarkOK=benchmarkURL && new URL(benchmarkURL).hostname === 'browser.geekbench.com' && /^\/v6\/cpu\/\d+\/?$/.test(new URL(benchmarkURL).pathname);
      if (validDate(checked,now) && safeURL(spec.spec_url) && (!benchmark || benchmarkOK)) {
        value=spec[key];url=benchmark?spec.benchmark_url:spec.spec_url;
      }
    } else {
      const fact=officialFact(inputs,key,now);
      if (fact) {value=fact.value;url=fact.url;note=fact.note || '';}
    }
    let fraction=null;
    if (def.reference === 'boolean' || def.reference === 'display') {
      if (typeof value === 'boolean') fraction=value?1:def.reference === 'display'?.6:0;
    } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && (value > 0 || zeroAllowed.has(key))) {
      fraction=def.reference === 'weight'?clamp((280-value)/110):clamp(value/def.reference);
    }
    if (fraction === null) return null;
    return {key,label:def.label,value:typeof value==='number'?round(value):value,
      url,note:[def.description,note].filter(Boolean).join(' · '),score:fraction*100};
  }
  function measuredFact(inputs,definition,now) {
    // A historical opaque score cannot represent support remaining today.
    if (definition.key === 'remaining_security') return null;
    const fact=inputs.usage_evidence?.[definition.key];
    return fact && typeof inputs.model === 'string' && inputs.model.trim() && fact.model === inputs.model &&
      fact.kind === 'measured' && fact.reviewed === true && fact.rubric_version === version && fact.protocol_id === definition.protocol_id &&
      typeof fact.score === 'number' && Number.isFinite(fact.score) && fact.score >= 0 && fact.score <= 100 &&
      safeURL(fact.url) && validDate(fact.checked_at,now) && validDate(fact.tested_at,now) && Date.parse(fact.tested_at) <= Date.parse(fact.checked_at) &&
      typeof fact.method === 'string' && fact.method.trim().length >= 16 ? fact : null;
  }
  function evaluate(spec = {}, inputs = {}, profile = 'balanced', now = Date.now()) {
    spec=spec || {};inputs=inputs || {};
    const selected=profileFor(profile),missing=[],estimated=[],groups=[];
    let low=0,high=0,measured=0,proxy=0;
    for (const [id,groupWeight] of Object.entries(selected.weights)) {
      const definition=groupDefinitions[id];
      let groupLow=0,groupHigh=0,groupMeasured=0,groupProxy=0;
      const details=definition.metrics.map(m=>{
        const globalWeight=groupWeight*m.weight/100,actual=measuredFact(inputs,m,now);
        let metricLow=0,metricHigh=100,metricMeasured=0,metricProxy=0,evidence=[],url='',note='',type='missing';
        if (actual) {
          metricLow=metricHigh=actual.score;metricMeasured=100;type='measured';url=actual.url;note=actual.method;
          evidence=[{key:m.key,label:'ผลทดสอบที่ตรวจทานแล้ว',value:actual.score,url,note:'ทดสอบ '+actual.tested_at+' · '+actual.method}];
        } else if (m.proxy.length) {
          metricLow=0;metricHigh=0;
          for (const [key,weight] of m.proxy) {
            const fact=proxyFact(spec,inputs,key,now);
            if (fact) {
              metricLow+=weight*fact.score/100;metricHigh+=weight*fact.score/100;metricProxy+=weight;evidence.push(fact);
            } else {
              metricHigh+=weight;
              missing.push({key:m.key+':'+key,label:m.label+' · รอ '+proxyByKey[key].label,group:id,weight:round(globalWeight*weight/100),outcome:m.key});
            }
          }
          if (metricProxy) {type='spec_proxy';note='ประมาณจากสเปก ไม่ใช่ผลทดสอบของหัวข้อนี้';url=evidence[0].url;}
        } else {
          missing.push({key:m.key,label:m.label,group:id,weight:round(globalWeight),outcome:m.key});
        }
        const metricScore=(metricLow+metricHigh)/2,metricCoverage=metricMeasured+metricProxy;
        if (metricProxy) estimated.push({key:m.key,label:m.label,group:id,weight:round(globalWeight*metricProxy/100)});
        groupLow+=m.weight*metricLow/100;groupHigh+=m.weight*metricHigh/100;
        groupMeasured+=m.weight*metricMeasured/100;groupProxy+=m.weight*metricProxy/100;
        return {key:m.key,label:m.label,weight:m.weight,contribution_weight:round(globalWeight),protocol_id:m.protocol_id,
          known:metricCoverage>0,evidence_type:type,score:metricScore,value:actual?actual.score:null,url,note,evidence,
          coverage:round(metricCoverage),measured_coverage:round(metricMeasured),proxy_coverage:round(metricProxy),missing_coverage:round(100-metricCoverage)};
      });
      low+=groupWeight*groupLow/100;high+=groupWeight*groupHigh/100;
      measured+=groupWeight*groupMeasured/100;proxy+=groupWeight*groupProxy/100;
      groups.push({id,label:definition.label,weight:groupWeight,score:(groupLow+groupHigh)/2,low:groupLow,high:groupHigh,
        coverage:round(groupMeasured+groupProxy),measured_coverage:round(groupMeasured),proxy_coverage:round(groupProxy),
        missing_coverage:round(100-groupMeasured-groupProxy),metrics:details});
    }
    const coverage=round(measured+proxy),spec_score=round((low+high)/2),eligible=coverage>=50;
    return {version,profile:selected.id,score_kind:'suitability',score:eligible?Math.round(spec_score*10000)/10000:null,
      spec_score,score_low:round(low),score_high:round(high),spec_score_low:round(low),spec_score_high:round(high),
      provisional:proxy>0 || missing.length>0,coverage,measured_coverage:round(measured),proxy_coverage:round(proxy),missing_coverage:round(100-coverage),
      evidence_status:!eligible?'pending':proxy>0 || missing.length>0?'estimated':'measured',missing,estimated,groups,
      reason:eligible?'':'รอข้อมูลที่ใช้ประเมินอย่างน้อย 50% ของน้ำหนัก · ยังไม่จัดอันดับ'};
  }
  const metrics=Object.fromEntries(Object.entries(groupDefinitions).map(([id,g])=>[id,g.metrics]));
  const api={version,profiles,metrics,groupLabels,groupDefinitions,proxyRubric,profileFor,evaluate};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  root.PhoneValue=api;
})(typeof window !== 'undefined'?window:globalThis);
