/* Public Affiliate ID verified against the account UI on 2026-10-19.
 * Official Product Feed format: https://help.shopee.co.th/portal/10/article/172214
 * A tracked link does not prove that a subsequent order earns commission.
 */
(function (root) {
  'use strict';
  const affiliateId = '15385610012';
  const landingHosts = ['shopee.co.th', 'www.shopee.co.th'];
  const redirectHosts = ['s.shopee.co.th', 'shope.ee'];
  function landing(value, depth = 0) {
    if (depth > 2 || typeof value !== 'string' || /["'<>\\\n\r]/.test(value)) return '';
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return '';
      if (redirectHosts.includes(u.hostname) && u.pathname === '/an_redir') {
        return landing(u.searchParams.get('origin_link'), depth + 1);
      }
      if (!landingHosts.includes(u.hostname)) return '';
      // Do not disguise the old incomplete /product/<item> URLs as working carts.
      if (u.pathname.startsWith('/product/') && !/^\/product\/[1-9]\d*\/[1-9]\d*\/?$/.test(u.pathname)) return '';
      const ids = u.pathname.match(/^\/(?:universal-link\/)?product\/([1-9]\d*)\/([1-9]\d*)\/?$/)
        || u.pathname.match(/-i\.([1-9]\d*)\.([1-9]\d*)\/?$/);
      if (ids) {
        const clean = new URL(`https://shopee.co.th/product/${ids[1]}/${ids[2]}`);
        const model = u.searchParams.get('model_id');
        if (model && /^[1-9]\d*$/.test(model)) clean.searchParams.set('model_id', model);
        return clean.href;
      }
      for (const key of [...u.searchParams.keys()]) {
        if (/^utm_|^af_|^(affiliate_id|sub_id|uls_trackid|gads_t_sig|sp_atk|sp_tk|xptdk|smtt)$/.test(key)) u.searchParams.delete(key);
      }
      u.hash = '';
      return u.href;
    } catch (_) { return ''; }
  }
  function build(value, tag = 'website') {
    const target = landing(value);
    if (!target) return '';
    const subId = String(tag).replace(/[^a-zA-Z0-9]/g, '').slice(0, 40) || 'website';
    const u = new URL('https://s.shopee.co.th/an_redir');
    u.searchParams.set('origin_link', target);
    u.searchParams.set('affiliate_id', affiliateId);
    u.searchParams.set('sub_id', `yesspec-${subId}---`);
    return u.href;
  }
  function isTracked(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && u.hostname === 's.shopee.co.th' && u.pathname === '/an_redir'
        && !u.username && !u.password && (!u.port || u.port === '443')
        && u.searchParams.getAll('affiliate_id').length === 1
        && u.searchParams.getAll('origin_link').length === 1
        && u.searchParams.get('affiliate_id') === affiliateId
        && !!landing(u.searchParams.get('origin_link'))
        && landing(u.searchParams.get('origin_link')) === u.searchParams.get('origin_link');
    } catch (_) { return false; }
  }
  function applyAnchor(a) {
    const raw = a.getAttribute('href');
    if (!raw) return;
    const url = build(raw, a.dataset.affiliateTag || 'website');
    if (!url) return;
    if (!isTracked(raw)) a.setAttribute('href', url);
    const rel = new Set((a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
    ['sponsored', 'noopener', 'noreferrer'].forEach(v => rel.add(v));
    const next = [...rel].join(' ');
    if (a.getAttribute('rel') !== next) a.setAttribute('rel', next);
    a.dataset.affiliateState = 'tracked_link';
  }
  const api = {affiliateId, landing, build, isTracked};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ShopeeAffiliate = api;
  if (!root.document) return;
  function applyTree(node) {
    if (node.nodeType !== 1) return;
    if (node.matches('a[href]')) applyAnchor(node);
    node.querySelectorAll('a[href]').forEach(applyAnchor);
  }
  function start() {
    applyTree(document.body);
    new MutationObserver(changes => {
      for (const change of changes) {
        if (change.type === 'attributes') applyAnchor(change.target);
        else change.addedNodes.forEach(applyTree);
      }
    }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['href']});
    // Covers anchors inserted and clicked before the observer callback runs.
    document.addEventListener('click', event => {
      const a = event.target.closest?.('a[href]');
      if (a) applyAnchor(a);
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
