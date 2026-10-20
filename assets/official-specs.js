(function (root) {
  'use strict';
  const domains = {
    Apple: ['support.apple.com', 'www.apple.com'], LG: ['www.lg.com'],
    Philips: ['www.philips.co.th'], Panasonic: ['www.panasonic.com'],
    Tribit: ['tribit.com'], DJI: ['www.dji.com']
  };
  const fields = new Set(['chip', 'display', 'resolution', 'weight', 'capacity', 'motor', 'loading',
    'cadr', 'room_area', 'power', 'cool_shot', 'foldable', 'bluetooth', 'protection', 'sensor', 'screen']);
  function validSource(source, brand) {
    try {
      const url = new URL(source.url);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        domains[brand]?.includes(url.hostname) && Number.isFinite(Date.parse(source.checked_at));
    } catch (_) { return false; }
  }
  function variantEvidence(item) {
    return JSON.stringify({count: item.price?.model_count ?? null,
      examples: (item.price?.model_examples || []).map(model => ({id: model.id, name: model.name}))});
  }
  function resolve(item, registry) {
    if (registry?.schema_version !== 1 || item.source !== 'shopee_affiliate_csv') return null;
    if (item.listing_id !== `${item.shop_id}/${item.item_id}` || item.product_url !== `https://shopee.co.th/product/${item.listing_id}`) return null;
    const binding = registry.listings?.[item.listing_id];
    // Matching a brand word or a similar name is insufficient. Re-check any changed title/options.
    if (!binding || binding.review_status !== 'model_matched' || binding.title !== item.title ||
        binding.variant_evidence !== variantEvidence(item)) return null;
    const model = registry.models?.[binding.model_key];
    if (!model || !validSource(model.source, model.brand) || !Array.isArray(model.fields)) return null;
    const confirmed = model.fields.filter(field => fields.has(field.key) && field.status === 'verified' &&
      typeof field.value === 'string' && field.value.trim() && typeof field.label === 'string');
    if (!confirmed.length) return null;
    return {model_key: binding.model_key, model: model.model, brand: model.brand, source: {...model.source},
      fields: confirmed.map(field => ({key: field.key, label: field.label, value: field.value})),
      scope: 'model_only', selected_variant: null, seller_warranty: null};
  }
  function attach(dataset, registry) {
    let verified = 0, total = 0;
    const categories = dataset.categories.map(category => ({...category, items: category.items.map(item => {
      const official_specs = resolve(item, registry);
      total++;
      if (official_specs) verified++;
      return {...item, official_specs};
    })}));
    return {...dataset, categories, official_spec_coverage: {verified, pending: total - verified, total,
      registry_available: registry?.schema_version === 1}};
  }
  const api = {validSource, variantEvidence, resolve, attach};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OfficialSpecs = api;
})(typeof window !== 'undefined' ? window : globalThis);
