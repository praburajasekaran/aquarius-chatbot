(function() {
  var btn = document.createElement('button');
  btn.innerHTML = '✕';
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#61BBCA;color:#fff;border:none;font-size:24px;cursor:pointer;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.2)';

  var frame = document.createElement('iframe');
  frame.src = window.CHATBOT_EMBED_URL || 'http://localhost:3000/';
  frame.style.cssText = 'position:fixed;bottom:90px;right:20px;width:400px;height:600px;border:none;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.15);z-index:9999;display:block';

  btn.onclick = function() {
    var open = frame.style.display !== 'none';
    frame.style.display = open ? 'none' : 'block';
    btn.innerHTML = open ? '💬' : '✕';
  };

  document.body.appendChild(frame);
  document.body.appendChild(btn);
})();
