// Host-page launcher script. Mirror of src/app/demo/chat-widget-embed.tsx —
// keep both surfaces in lockstep when changing widget UX.
(function() {
  var EMBED_URL = window.CHATBOT_EMBED_URL || 'http://localhost:3000/';
  var EMBED_ORIGIN = null;
  try { EMBED_ORIGIN = new URL(EMBED_URL, window.location.href).origin; } catch { /* noop */ }
  var EVENTS_URL = EMBED_URL.replace(/\/$/, '') + '/api/events';
  var STATE_KEY = 'aq_widget_state';     // 'open' | 'minimized'
  var TEASER_FLAG_KEY = 'aq_teaser_shown';
  var TEASER_DELAY_MS = 3000;
  var DESKTOP_QUERY = '(min-width: 768px)';

  // Fire-and-forget analytics. keepalive lets the request survive a page
  // navigation. Failures are intentionally silent — analytics must never
  // break the widget for the visitor.
  function trackEvent(name, properties) {
    try {
      fetch(EVENTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: name, properties: properties || {} }),
        keepalive: true,
        mode: 'cors',
        credentials: 'omit'
      }).catch(function () { /* noop */ });
    } catch { /* noop */ }
  }

  function readState() {
    try { return sessionStorage.getItem(STATE_KEY); } catch { return null; }
  }
  function writeState(s) {
    try { sessionStorage.setItem(STATE_KEY, s); } catch { /* noop */ }
  }
  function sourceTaggedEmbedUrl(url) {
    var source = '';
    try { source = window.location.href; } catch { source = ''; }
    if (!source) return url;
    try {
      var tagged = new URL(url, window.location.href);
      tagged.searchParams.set('leadSourceUrl', source);
      return tagged.toString();
    } catch {
      var sep = url.indexOf('?') === -1 ? '?' : '&';
      return url + sep + 'leadSourceUrl=' + encodeURIComponent(source);
    }
  }

  var isDesktop = false;
  try { isDesktop = window.matchMedia(DESKTOP_QUERY).matches; } catch { /* noop */ }

  // Desktop-only auto-open. On mobile, every page boots minimised regardless
  // of stored state — auto-opening would cover the host page on small screens.
  var stored = readState();
  var initialState;
  if (!isDesktop) {
    initialState = 'minimized';
  } else if (stored === 'minimized') {
    initialState = 'minimized';
  } else {
    initialState = 'open';
  }

  var frame = document.createElement('iframe');
  frame.src = sourceTaggedEmbedUrl(EMBED_URL);
  frame.title = 'Aquarius Lawyers chat assistant';
  frame.style.cssText = 'position:fixed;bottom:90px;right:20px;width:400px;height:600px;border:none;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.15);z-index:9999;display:' + (initialState === 'open' ? 'block' : 'none');

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#61BBCA;color:#fff;border:none;font-size:24px;cursor:pointer;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.2)';

  function applyState(s) {
    if (s === 'open') {
      frame.style.display = 'block';
      btn.innerHTML = '–';
      btn.setAttribute('aria-label', 'Minimize chat');
    } else {
      frame.style.display = 'none';
      btn.innerHTML = '💬';
      btn.setAttribute('aria-label', 'Open chat');
    }
  }
  applyState(initialState);
  if (initialState === 'open' && stored !== 'open') {
    writeState('open');
    if (!stored) trackEvent('chat_opened', { source: 'auto' });
  }

  var teaser = null;

  function dismissTeaser() {
    if (teaser && teaser.parentNode) {
      teaser.parentNode.removeChild(teaser);
      teaser = null;
    }
    try { sessionStorage.setItem(TEASER_FLAG_KEY, '1'); } catch { /* noop */ }
  }

  function openChat(source) {
    writeState('open');
    applyState('open');
    dismissTeaser();
    if (source === 'teaser') trackEvent('teaser_clicked');
    trackEvent('chat_opened', { source: source });
  }

  function minimizeChat(source) {
    writeState('minimized');
    applyState('minimized');
    trackEvent('chat_minimized', { source: source || 'launcher' });
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function isEmbedMessage(value) {
    if (!isPlainObject(value)) return false;
    var keys = Object.keys(value);
    if (keys.length !== 2 || keys.indexOf('source') === -1 || keys.indexOf('type') === -1) return false;
    return value.source === 'aq-chat' && (
      value.type === 'minimize' ||
      value.type === 'payment_confirmed' ||
      value.type === 'appointment_booked'
    );
  }

  function pushConversion(name) {
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: name });
    } catch { /* noop */ }
  }

  function redirectToThankYou() {
    try {
      var target = new URL('/lp/criminal-law/thank-you/', window.location.href);
      window.location.assign(target.href);
    } catch { /* noop */ }
  }

  function conversionAlreadyHandled(type) {
    if (handledConversions[type]) return true;
    try { return sessionStorage.getItem('aq_conversion_' + type) === '1'; } catch { return false; }
  }

  function markConversionHandled(type) {
    handledConversions[type] = true;
    try { sessionStorage.setItem('aq_conversion_' + type, '1'); } catch { /* noop */ }
  }

  var handledConversions = {
    payment_confirmed: false,
    appointment_booked: false
  };

  btn.onclick = function() {
    if (frame.style.display === 'none') openChat('launcher'); else minimizeChat('launcher');
  };

  // Listen for control messages from the iframe (Minimize button inside the
  // chat panel). Validate the envelope strictly — host pages may have other
  // postMessage listeners and we mustn't trust unrelated traffic.
  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!EMBED_ORIGIN || event.origin !== EMBED_ORIGIN) return;
    if (event.source !== frame.contentWindow) return;
    if (!isEmbedMessage(data)) return;
    if (data.type === 'minimize') {
      minimizeChat('panel');
      return;
    }
    if (conversionAlreadyHandled(data.type)) return;
    markConversionHandled(data.type);
    if (data.type === 'payment_confirmed') {
      pushConversion('aq_payment_confirmed');
      return;
    }
    if (data.type === 'appointment_booked') {
      pushConversion('aq_appointment_booked');
      redirectToThankYou();
    }
  });

  document.body.appendChild(frame);
  document.body.appendChild(btn);

  // Teaser nudge — desktop-minimised only. With desktop auto-open as the
  // default, the teaser only fires when the visitor has explicitly minimised
  // earlier in this tab. On mobile, teaser still fires once per session.
  if (initialState === 'open') return;

  var alreadyShown = false;
  try { alreadyShown = sessionStorage.getItem(TEASER_FLAG_KEY) === '1'; } catch { /* noop */ }
  if (alreadyShown) return;

  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* noop */ }

  teaser = document.createElement('div');
  teaser.setAttribute('role', 'status');
  teaser.setAttribute('aria-live', 'polite');
  teaser.style.cssText = [
    'position:fixed',
    'bottom:28px',
    'right:96px',
    'z-index:9998',
    'background:#ffffff',
    'color:#1f2937',
    'font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Open Sans",sans-serif',
    'border-radius:16px',
    'box-shadow:0 0 0 1px rgba(0,0,0,0.05),0 8px 24px rgba(0,0,0,0.12)',
    'padding:0',
    'opacity:0',
    'transform:translateY(4px)',
    reduceMotion ? 'transition:none' : 'transition:opacity 300ms ease,transform 300ms ease'
  ].join(';');

  var bodyBtn = document.createElement('button');
  bodyBtn.type = 'button';
  bodyBtn.style.cssText = 'background:transparent;border:none;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:12px 36px 12px 16px;border-radius:16px';
  bodyBtn.textContent = 'Need legal help? Ask me anything →';
  bodyBtn.onclick = function() { openChat('teaser'); };

  var dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.setAttribute('aria-label', 'Dismiss chat teaser');
  dismissBtn.style.cssText = 'position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;background:transparent;border:none;color:#9ca3af;cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center';
  dismissBtn.innerHTML = '✕';
  dismissBtn.onclick = function(e) {
    e.stopPropagation();
    dismissTeaser();
    trackEvent('teaser_dismissed');
  };

  teaser.appendChild(bodyBtn);
  teaser.appendChild(dismissBtn);
  document.body.appendChild(teaser);

  setTimeout(function() {
    if (!teaser) return;
    teaser.style.opacity = '1';
    teaser.style.transform = 'translateY(0)';
    trackEvent('teaser_shown');
  }, TEASER_DELAY_MS);
})();
