(function() {
  var EMBED_URL = window.CHATBOT_EMBED_URL || 'http://localhost:3000/';
  var EVENTS_URL = EMBED_URL.replace(/\/$/, '') + '/api/events';
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

  // Iframe — closed by default. Opening is now an explicit action (launcher
  // click or teaser body click) so visitors aren't auto-interrupted.
  var frame = document.createElement('iframe');
  frame.src = EMBED_URL;
  frame.title = 'Aquarius Lawyers chat assistant';
  frame.style.cssText = 'position:fixed;bottom:90px;right:20px;width:400px;height:600px;border:none;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.15);z-index:9999;display:none';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open chat');
  btn.innerHTML = '💬';
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#61BBCA;color:#fff;border:none;font-size:24px;cursor:pointer;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.2)';

  var teaser = null;

  function dismissTeaser() {
    if (teaser && teaser.parentNode) {
      teaser.parentNode.removeChild(teaser);
      teaser = null;
    }
    try { sessionStorage.setItem(TEASER_FLAG_KEY, '1'); } catch { /* noop */ }
  }

  function openChat(source) {
    frame.style.display = 'block';
    btn.innerHTML = '✕';
    btn.setAttribute('aria-label', 'Close chat');
    dismissTeaser();
    if (source === 'teaser') trackEvent('teaser_clicked');
    trackEvent('chat_opened', { source: source });
  }

  function closeChat() {
    frame.style.display = 'none';
    btn.innerHTML = '💬';
    btn.setAttribute('aria-label', 'Open chat');
    trackEvent('chat_closed');
  }

  btn.onclick = function() {
    if (frame.style.display === 'none') openChat('launcher'); else closeChat();
  };

  document.body.appendChild(frame);
  document.body.appendChild(btn);

  // Teaser nudge — desktop only, once per session.
  // sessionStorage is per-tab/per-host, so different embedding sites stay
  // independent and a new tab on the same site gets a fresh teaser.
  var isDesktop = false;
  try { isDesktop = window.matchMedia(DESKTOP_QUERY).matches; } catch { /* old browser */ }
  if (!isDesktop) return;

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
