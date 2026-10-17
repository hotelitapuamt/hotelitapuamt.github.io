/* Hotel Itapuã — estatísticas próprias + Google (GA4 / Ads / GTM) + Meta Pixel.
   Os códigos (IDs) NÃO ficam aqui: o administrador cola no painel (aba Marketing)
   e este script lê do banco. Enquanto não houver ID, só as estatísticas próprias
   (sem cookies e sem dados pessoais) funcionam. Debug: abra o site com ?ht_debug=1 */
(function () {
  'use strict';
  var SB = 'https://hayslcuhsqnlatcpllqk.supabase.co';
  var KEY = 'sb_publishable_YmQUUMpw2e7jY-XVtGWSUg_0Yx6N0Ox';
  var DEBUG = /[?&]ht_debug=1/.test(location.search);

  function store(kind) {
    return function (k, v) {
      try {
        var s = window[kind];
        if (v === undefined) return s.getItem(k);
        if (v === null) { s.removeItem(k); return null; }
        s.setItem(k, v); return v;
      } catch (e) { return null; }
    };
  }
  var ls = store('localStorage'), ss = store('sessionStorage');
  function log() { if (DEBUG && window.console) console.log.apply(console, ['[HT]'].concat([].slice.call(arguments))); }

  /* equipe: ?notrack=1 neste aparelho para não contar as próprias visitas (?notrack=0 desfaz) */
  if (/[?&]notrack=1/.test(location.search)) ls('ht_notrack', '1');
  if (/[?&]notrack=0/.test(location.search)) ls('ht_notrack', null);
  var OFF = ls('ht_notrack') === '1' || navigator.doNotTrack === '1' ||
            (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !DEBUG);

  /* ---------- sessão e origem do visitante ---------- */
  function rid() {
    var a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  var sid = ss('ht_sid');
  if (!sid) { sid = rid(); ss('ht_sid', sid); }

  function attribution() {
    var saved = ss('ht_attr');
    if (saved) { try { return JSON.parse(saved); } catch (e) {} }
    var q = new URLSearchParams(location.search);
    var src = q.get('utm_source'), med = q.get('utm_medium'), cmp = q.get('utm_campaign');
    if (!src) {
      if (q.get('gclid') || q.get('gbraid') || q.get('wbraid')) { src = 'google'; med = med || 'cpc'; }
      else if (q.get('fbclid')) { src = 'meta'; med = med || 'social'; }
      else if (document.referrer) {
        try {
          var h = new URL(document.referrer).hostname.replace(/^www\./, '');
          if (h !== location.hostname.replace(/^www\./, '')) {
            src = h; med = 'referral';
            if (/(^|\.)google\./.test(h)) { src = 'google'; med = 'organic'; }
            else if (/instagram\./.test(h)) { src = 'instagram'; med = 'social'; }
            else if (/(facebook|fb)\./.test(h)) { src = 'facebook'; med = 'social'; }
            else if (/(bing|duckduckgo|yahoo)\./.test(h)) { src = h.split('.')[0]; med = 'organic'; }
          }
        } catch (e) {}
      }
    }
    var a = { s: (src || '').toLowerCase().slice(0, 80), m: (med || '').toLowerCase().slice(0, 80), c: (cmp || '').slice(0, 120) };
    ss('ht_attr', JSON.stringify(a)); return a;
  }
  var A = attribution();
  var ua = navigator.userAgent || '';
  var device = (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) ? 'tablet'
             : (/Mobi|iPhone|Android/i.test(ua) || window.innerWidth < 768) ? 'mobile' : 'desktop';

  /* ---------- estatísticas próprias (sem cookies, sem dados pessoais) ---------- */
  function send(ev, label) {
    if (OFF) { log('(desligado)', ev, label || ''); return; }
    log('evento', ev, label || '');
    try {
      fetch(SB + '/rest/v1/site_events', {
        method: 'POST', keepalive: true,
        headers: { apikey: KEY, 'content-type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ session_id: sid, event: ev, path: location.pathname.slice(0, 200),
          label: label ? String(label).slice(0, 80) : null, source: A.s || null, medium: A.m || null,
          campaign: A.c || null, device: device })
      }).catch(function () {});
    } catch (e) {}
  }

  /* ---------- consentimento (LGPD / Consent Mode v2) ---------- */
  var CK = 'ht_consent';
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
                               analytics_storage: 'denied', wait_for_update: 500 });
  function consentUpdate(granted) {
    var v = granted ? 'granted' : 'denied';
    gtag('consent', 'update', { ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v });
  }
  if (ls(CK) === 'granted') consentUpdate(true);

  /* ---------- carregamento das tags (IDs vindos do painel) ---------- */
  var CFG = null, GOOGLE = null, ready = false, pending = [];
  var RX = { ga4: /^G-[A-Z0-9]{4,14}$/, gtm: /^GTM-[A-Z0-9]{4,10}$/, ads: /^AW-\d{6,12}$/, label: /^[\w-]{4,40}$/, pixel: /^\d{8,20}$/ };
  function clean(v) {
    function ok(rx, x) { return x && rx.test(x) ? x : ''; }
    return { ga4: ok(RX.ga4, v.ga4_id), gtm: ok(RX.gtm, v.gtm_id), ads: ok(RX.ads, v.google_ads_id),
             label: ok(RX.label, v.google_ads_whatsapp_label), pixel: ok(RX.pixel, v.meta_pixel_id) };
  }
  function getSettings(cb) {
    var c = ss('ht_cfg');
    if (c) { try { var o = JSON.parse(c); if (Date.now() - o.t < 600000) return cb(o.v); } catch (e) {} }
    fetch(SB + '/rest/v1/site_settings?select=key,value', { headers: { apikey: KEY } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var v = {}; rows.forEach(function (r) { v[r.key] = (r.value || '').trim(); });
        ss('ht_cfg', JSON.stringify({ t: Date.now(), v: v })); cb(v);
      }).catch(function () { cb({}); });
  }
  function loadScript(src) { var s = document.createElement('script'); s.async = true; s.src = src; document.head.appendChild(s); }

  function initGoogle() {
    if (OFF) return;
    if (CFG.gtm) {
      window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      loadScript('https://www.googletagmanager.com/gtm.js?id=' + CFG.gtm); GOOGLE = 'gtm'; return;
    }
    var first = CFG.ga4 || CFG.ads; if (!first) return;
    loadScript('https://www.googletagmanager.com/gtag/js?id=' + first);
    gtag('js', new Date());
    if (CFG.ga4) gtag('config', CFG.ga4);
    if (CFG.ads) gtag('config', CFG.ads);
    GOOGLE = 'gtag';
  }
  function initMeta() {
    if (OFF || !CFG.pixel || window.fbq) return;
    /* código oficial do Pixel */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', CFG.pixel); window.fbq('track', 'PageView');
  }

  /* eventos para Google / Meta */
  function g(name, params) {
    if (GOOGLE === 'gtm') { var o = { event: name }; for (var k in params) o[k] = params[k]; window.dataLayer.push(o); }
    else if (GOOGLE === 'gtag') gtag('event', name, params);
  }
  function m(name, params) { if (window.fbq && ls(CK) === 'granted') window.fbq('track', name, params || {}); }
  function thirdParty(ev, label) {
    switch (ev) {
      case 'whatsapp_click':
        g('generate_lead', { method: 'whatsapp', lead_source: label });
        if (CFG.ads && CFG.label && GOOGLE === 'gtag') gtag('event', 'conversion', { send_to: CFG.ads + '/' + CFG.label });
        m('Lead', { content_name: label }); break;
      case 'phone_click': g('contact', { method: 'phone' }); m('Contact'); break;
      case 'map_click': g('view_map', {}); m('FindLocation'); break;
      case 'room_click': g('view_item', { items: [{ item_name: label }] }); m('ViewContent', { content_name: label, content_type: 'room' }); break;
      case 'scroll_50': g('scroll_depth', { percent: 50 }); break;
      case 'scroll_90': g('scroll_depth', { percent: 90 }); break;
      case 'section_view': g('section_view', { section: label }); break;
    }
  }
  function track(ev, label) {
    send(ev, label);
    if (ready) thirdParty(ev, label); else pending.push([ev, label]);
  }

  /* ---------- aviso de cookies ---------- */
  function hasTags() { return !!(CFG && (CFG.ga4 || CFG.gtm || CFG.ads || CFG.pixel)); }
  function css() {
    var s = document.createElement('style');
    s.textContent =
      '#ht-cookie{position:fixed;left:12px;right:12px;bottom:12px;bottom:max(12px,env(safe-area-inset-bottom));max-width:560px;margin:0 auto;z-index:1000;' +
      'background:#2c2d31;color:#f4efe5;border:1px solid rgba(244,239,229,.18);border-radius:6px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:15px;line-height:1.45;font-family:inherit}' +
      '#ht-cookie p{margin:0 0 12px}#ht-cookie a{color:#e0a97f;text-decoration:underline}' +
      '#ht-cookie .b{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}' +
      '#ht-cookie button{min-height:44px;padding:0 18px;border-radius:4px;font:inherit;font-weight:600;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}' +
      '#ht-cookie .no{background:transparent;color:#f4efe5;border:1px solid rgba(244,239,229,.35)}' +
      '#ht-cookie .yes{background:#c4865b;color:#1c1d20;border:1px solid #c4865b}' +
      '#ht-cookie button:active{transform:scale(.97)}' +
      '.ht-lnk{color:inherit;opacity:.75;text-decoration:underline;margin-left:10px}';
    document.head.appendChild(s);
  }
  function banner() {
    if (!hasTags() || document.getElementById('ht-cookie')) return;
    var d = document.createElement('div'); d.id = 'ht-cookie'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Privacidade');
    var p = document.createElement('p');
    p.appendChild(document.createTextNode('Usamos cookies para medir visitas e mostrar anúncios do hotel. Você escolhe. '));
    var a = document.createElement('a'); a.href = 'privacidade/'; a.textContent = 'Política de privacidade'; p.appendChild(a);
    var b = document.createElement('div'); b.className = 'b';
    var no = document.createElement('button'); no.type = 'button'; no.className = 'no'; no.textContent = 'Recusar';
    var yes = document.createElement('button'); yes.type = 'button'; yes.className = 'yes'; yes.textContent = 'Aceitar';
    b.appendChild(no); b.appendChild(yes); d.appendChild(p); d.appendChild(b); document.body.appendChild(d);
    function done(ok) {
      ls(CK, ok ? 'granted' : 'denied'); consentUpdate(ok); if (ok) initMeta();
      send(ok ? 'consent_accept' : 'consent_refuse'); d.remove();
    }
    no.addEventListener('click', function () { done(false); });
    yes.addEventListener('click', function () { done(true); });
  }

  /* ---------- cliques, rolagem e seções ---------- */
  function waLabel(a) {
    if (a.classList.contains('nav-cta') || a.closest('.menu')) return 'Menu';
    if (a.closest('.hero')) return 'Topo';
    if (a.closest('.room')) return (a.textContent || '').replace(/^\s*Reservar\s*/i, '').trim() || 'Quarto';
    if (a.closest('footer')) return 'Rodapé';
    return 'Outro';
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null; if (!a) return;
    var h = a.getAttribute('href') || '';
    if (/wa\.me|api\.whatsapp\.com|whatsapp\.com\/send/i.test(h)) track('whatsapp_click', waLabel(a));
    else if (/^tel:/i.test(h)) track('phone_click', 'telefone');
    else if (/maps\.app\.goo\.gl|google\.[a-z.]+\/maps|goo\.gl\/maps/i.test(h)) track('map_click', 'mapa');
    else if (a.closest('.rate-strip')) track('room_click', ((a.querySelector('.t') || {}).textContent || '').trim());
    else if (a.getAttribute('data-ht') === 'cookies') { e.preventDefault(); banner(); }
  }, true);

  var fired = {};
  function scrollDepth() {
    var h = document.documentElement, total = Math.max(h.scrollHeight - window.innerHeight, 1);
    var pct = Math.round((window.scrollY / total) * 100);
    if (pct >= 50 && !fired.s50) { fired.s50 = 1; track('scroll_50'); }
    if (pct >= 90 && !fired.s90) { fired.s90 = 1; track('scroll_90'); }
  }
  window.addEventListener('scroll', scrollDepth, { passive: true });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); track('section_view', en.target.id); } });
    }, { threshold: 0.4 });
    ['quartos', 'comodidades', 'galeria', 'localizacao'].forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
  }

  /* ---------- início ---------- */
  send('page_view');
  css();
  getSettings(function (v) {
    CFG = clean(v);
    log('configuração ativa', CFG);
    var links = document.querySelectorAll('[data-ht="cookies"]');
    for (var i = 0; i < links.length; i++) links[i].style.display = hasTags() ? '' : 'none';
    initGoogle();
    if (ls(CK) === 'granted') initMeta();
    ready = true;
    pending.splice(0).forEach(function (x) { thirdParty(x[0], x[1]); });
    if (hasTags() && ls(CK) === null) banner();
  });

  window.HT = { track: track, reopenConsent: banner, debug: function () { return { sid: sid, attribution: A, device: device, cfg: CFG, google: GOOGLE, off: OFF }; } };
})();
