(function (root) {
  'use strict';
  const ranking = root.RankingOffers || (typeof require === 'function' ? require('./ranking-offers.js') : null);
  const platforms = Object.keys(ranking.names);
  const offerFields = ['url', 'price', 'price_type', 'variant', 'note'];
  const referenceFields = ['price', 'variant', 'note'];
  const specFields = [...ranking.specMetrics.map(([key]) => key), 'variant', 'spec_url', 'benchmark_url'];
  const priceTypes = ['regular', 'vip', 'coupon', 'flash_sale'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const amountOK = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 100000000;
  const formOffer = offer => ({...Object.fromEntries(offerFields.map(key =>
    [key, String(offer?.[key] ?? (key === 'price_type' ? 'regular' : ''))])), price_lookup:clone(offer?.price_lookup || null)});
  const formSpecs = specs => ({...Object.fromEntries(specFields.map(key => [key, String(specs?.[key] ?? '')])),
    verified:specs?.verified === true});

  // One draft owns its original revision. Reading a newer row must never silently
  // rebase edits onto it; the server remains the authority for revision conflicts.
  function create(row) {
    const baseRow = clone(row);
    const baseline = {revision:baseRow.revision,
      offers:Object.fromEntries(platforms.map(platform => [platform, formOffer(baseRow.offers?.[platform])])),
      reference_price:{price:String(baseRow.reference_price?.price ?? ''),
        variant:String(baseRow.reference_price?.variant ?? baseRow.value_specs?.variant ?? ''),
        note:String(baseRow.reference_price?.note ?? '')},
      value_specs:formSpecs(baseRow.value_specs)};
    let state = clone(baseline), generation = 0, activeCheck = null, referenceReconfirm = false;
    const resets = new Set(), reconfirms = new Set();
    const view = () => clone(state);
    const invalidateCheck = () => { generation++; activeCheck = null; };
    function platformOK(platform) {
      if (!platforms.includes(platform)) throw new Error('ช่องทางซื้อไม่ถูกต้อง');
    }
    function fieldOK(field, fields) {
      if (!fields.includes(field)) throw new Error('ช่องข้อมูลไม่ถูกต้อง');
    }
    function change(intent) {
      const {type, platform, field, value} = intent;
      let cartChanged = false;
      if (type === 'offer' || type.endsWith('-offer')) platformOK(platform);
      switch (type) {
        case 'offer': {
          fieldOK(field, offerFields);
          const text = String(value ?? '');
          cartChanged = field === 'url' && state.offers[platform].url.trim() !== text.trim();
          if (cartChanged) { state.offers[platform] = formOffer(null); reconfirms.delete(platform); }
          state.offers[platform][field] = text;
          state.offers[platform].price_lookup = null;
          resets.delete(platform);
          break;
        }
        case 'reference':
          fieldOK(field, referenceFields);
          state.reference_price[field] = String(value ?? '');
          break;
        case 'spec':
          fieldOK(field, [...specFields, 'verified']);
          state.value_specs[field] = field === 'verified' ? value === true : String(value ?? '');
          if (field !== 'verified') state.value_specs.verified = false;
          break;
        case 'memory': {
          const index = Number(intent.index);
          const option = intent.index !== '' && Number.isInteger(index) && index >= 0
            ? baseRow.spec_research?.memory_options?.[index] : null;
          if (!option) throw new Error('ไม่พบตัวเลือก RAM / ความจุ');
          for (const key of ['ram_gb', 'storage_gb']) state.value_specs[key] = String(option[key] ?? '');
          state.value_specs.variant = String(option.label ?? '');
          state.value_specs.verified = false;
          if (!state.reference_price.price) state.reference_price.variant = state.value_specs.variant;
          break;
        }
        case 'clear-offer':
        case 'reset-offer':
          state.offers[platform] = formOffer(type === 'reset-offer' && platform === 'shopee' ? baseRow.feed_offer : null);
          resets.delete(platform);
          reconfirms.delete(platform);
          if (type === 'reset-offer') resets.add(platform);
          break;
        case 'reconfirm-offer': {
          const offer = state.offers[platform];
          if (!ranking.validURL(offer.url, platform) || !amountOK(offer.price)) {
            throw new Error('กรอกลิงก์และราคาที่ตรวจพบก่อนยืนยัน');
          }
          offer.price_lookup = null;
          resets.delete(platform);
          reconfirms.add(platform);
          break;
        }
        case 'clear-reference':
          state.reference_price = {price:'', variant:state.value_specs.variant, note:''};
          referenceReconfirm = false;
          break;
        case 'reconfirm-reference':
          if (!amountOK(state.reference_price.price)) throw new Error('กรอกราคาต่ำสุดที่พบก่อนยืนยัน');
          referenceReconfirm = true;
          break;
        default: throw new Error('คำสั่งแก้ไขไม่ถูกต้อง');
      }
      invalidateCheck();
      return {view:view(), cartChanged};
    }
    function changes() {
      const offers = Object.fromEntries(platforms.filter(platform => !resets.has(platform) &&
        (reconfirms.has(platform) || !equal(state.offers[platform], baseline.offers[platform])))
        .map(platform => [platform, state.offers[platform]]));
      const specChanged = !equal(state.value_specs, baseline.value_specs);
      const referenceChanged = referenceReconfirm || !equal(state.reference_price, baseline.reference_price);
      if (!Object.keys(offers).length && !resets.size && !specChanged && !referenceChanged) return null;
      return clone({listing_id:baseRow.listing_id, revision:baseline.revision, offers, reset:[...resets],
        ...(specChanged ? {value_specs:state.value_specs} : {}),
        ...(referenceChanged ? {reference_price:state.reference_price} : {})});
    }
    function prepare() {
      const patch = changes();
      if (!patch) return null;
      const reference = patch.reference_price?.price;
      if (reference && !amountOK(reference)) throw new Error('ราคาต่ำสุดที่พบต้องมากกว่า 0 หรือเว้นว่างไว้');
      for (const [platform, offer] of Object.entries(patch.offers)) {
        if (!offer.url) continue; // Clearing a channel also clears its price on the server.
        if (!ranking.validURL(offer.url, platform)) throw new Error(`ลิงก์ตะกร้า ${ranking.names[platform]} ไม่ถูกต้อง กรุณาตรวจช่องที่กรอก`);
        if (offer.price && !amountOK(offer.price)) throw new Error('ราคาต้องมากกว่า 0 หรือเว้นว่างไว้');
        if (!priceTypes.includes(offer.price_type)) throw new Error('ประเภทราคาไม่ถูกต้อง');
      }
      return patch;
    }
    function beginCheck(platform) {
      platformOK(platform);
      if (!ranking.validURL(state.offers[platform].url, platform)) throw new Error('กรุณาใส่ลิงก์ตะกร้าให้ตรงช่องก่อนตรวจราคา');
      const context = {listing_id:baseRow.listing_id, revision:baseline.revision, title:baseRow.title,
        platform, offer:clone(state.offers[platform])};
      // Context identity and generation reject results even after edit -> undo,
      // a RAM change, a newer check, or replacement with a freshly loaded draft.
      activeCheck = {context, generation, snapshot:clone(context)};
      return context;
    }
    function confirmCheck(context, result, index, confirmation) {
      if (!activeCheck || activeCheck.context !== context || activeCheck.generation !== generation ||
          !equal(context, activeCheck.snapshot)) return false;
      const {platform, offer} = activeCheck.snapshot;
      const candidate = Number.isInteger(index) && index >= 0 ? result?.candidates?.[index] : null;
      if (confirmation?.matched !== true || !priceTypes.includes(confirmation.price_type) ||
          result?.platform !== platform || result.requested_url !== offer.url || result.status !== 'candidates_found' ||
          !ranking.validURL(result.resolved_url, platform) || !candidate || candidate.currency !== 'THB' ||
          typeof candidate.amount !== 'number' || !amountOK(candidate.amount) ||
          !Number.isFinite(Date.parse(result.checked_at)) ||
          typeof confirmation.variant !== 'string' || typeof confirmation.note !== 'string') return false;
      state.offers[platform] = {...offer, price:String(candidate.amount), price_type:confirmation.price_type,
        variant:confirmation.variant.trim(), note:confirmation.note.trim(),
        price_lookup:{requested_url:result.requested_url, resolved_url:result.resolved_url,
          amount:candidate.amount, checked_at:result.checked_at, confirmed:true}};
      resets.delete(platform);
      invalidateCheck();
      return true;
    }
    return {view, change, changes, prepare, beginCheck, confirmCheck};
  }
  const api = {create};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RankingDraft = api;
})(typeof window !== 'undefined' ? window : globalThis);
