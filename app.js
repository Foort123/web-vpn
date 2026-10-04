// Состояние приложения
let currentRole = 'client';
let peer = null;
let activeConnection = null;
let pendingRequests = new Map();
let txBytes = 0;
let rxBytes = 0;
let pingTimer = null;
let wsBridge = null;

// Инициализация интерфейса
document.addEventListener('DOMContentLoaded', () => {
  initPeer();
  initWebSocketBridge();
});

// Переключение ролей Client <-> Exit Node
function switchRole(role) {
  currentRole = role;
  document.querySelectorAll('.role-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.panel-section').forEach(p => p.classList.remove('active'));

  if (role === 'client') {
    document.getElementById('btn-role-client').classList.add('active');
    document.getElementById('client-panel').classList.add('active');
    document.getElementById('target-id-box').style.display = 'block';
  } else {
    document.getElementById('btn-role-exit').classList.add('active');
    document.getElementById('exit-panel').classList.add('active');
    document.getElementById('target-id-box').style.display = 'none';
  }
}

// Инициализация WebRTC через PeerJS с публичными STUN серверами
function initPeer() {
  updateStatus('connecting', 'Инициализация STUN/WebRTC...');

  // STUN-серверы Google для пробития NAT
  const config = {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  };

  peer = new Peer(config);

  peer.on('open', (id) => {
    document.getElementById('my-peer-id').value = id;
    updateStatus('disconnected', 'Готов к подключению');
    logExit(`[WebRTC] Ваш Peer ID готов: ${id}`, 'log-success');

    // Проверяем hash в URL — если там передан ID, авто-подключаемся
    const hashId = window.location.hash.replace('#', '').trim();
    if (hashId && currentRole === 'client') {
      document.getElementById('remote-peer-id').value = hashId;
      connectToPeer();
    }
  });

  // Входящие соединения (актуально для Exit Node)
  peer.on('connection', (conn) => {
    handleIncomingConnection(conn);
  });

  peer.on('error', (err) => {
    console.error('Peer error:', err);
    updateStatus('disconnected', `Ошибка: ${err.type || err.message}`);
    logExit(`[Ошибка WebRTC] ${err.type || err.message}`, 'log-error');
  });
}

// Клиент инициирует соединение с Выходным Узлом
function connectToPeer() {
  const remoteId = document.getElementById('remote-peer-id').value.trim();
  if (!remoteId) {
    alert('Пожалуйста, введите Peer ID выходного узла!');
    return;
  }

  updateStatus('connecting', 'Соединение через WebRTC...');
  const conn = peer.connect(remoteId, { reliable: true });
  setupConnection(conn);
}

// Обработка входящего соединения на Выходном Узле
function handleIncomingConnection(conn) {
  logExit(`[WebRTC] Входящее подключение от клиента: ${conn.peer}`, 'log-info');
  setupConnection(conn);
}

// Настройка DataChannel
function setupConnection(conn) {
  activeConnection = conn;

  conn.on('open', () => {
    updateStatus('connected', 'Подключено (WebRTC P2P)');
    logExit(`[Туннель] Защищённый канал открыт с ${conn.peer}`, 'log-success');

    // Запуск цикла пинга для замера задержки
    startPing();
  });

  conn.on('data', (data) => {
    handleDataPacket(data);
  });

  conn.on('close', () => {
    updateStatus('disconnected', 'Соединение разорвано');
    logExit(`[Туннель] Клиент отключился`, 'log-warn');
    activeConnection = null;
    stopPing();
  });

  conn.on('error', (err) => {
    console.error('Conn error:', err);
    logExit(`[Ошибка канала] ${err.message}`, 'log-error');
  });
}

// Маршрутизация пакетов по DataChannel
function handleDataPacket(data) {
  const bytes = JSON.stringify(data).length;
  rxBytes += bytes;
  updateStats();

  if (data.type === 'PING') {
    // Ответ на пинг
    sendPacket({ type: 'PONG', timestamp: data.timestamp });
    return;
  }

  if (data.type === 'PONG') {
    const rtt = Date.now() - data.timestamp;
    document.getElementById('stat-ping').innerText = `${rtt} ms`;
    return;
  }

  // --- ЛОГИКА ВЫХОДНОГО УЗЛА (EXIT NODE) ---
  if (data.type === 'PROXY_REQ') {
    logExit(`[Запрос] ${data.method} ${data.url}`, 'log-info');
    processExitNodeRequest(data);
    return;
  }

  // --- ЛОГИКА КЛИЕНТА (CLIENT) ---
  if (data.type === 'PROXY_RES') {
    const resolver = pendingRequests.get(data.id);
    if (resolver) {
      resolver(data);
      pendingRequests.delete(data.id);
    }
    return;
  }

  // Данные для локального SOCKS5 моста
  if (data.type === 'SOCKS_RAW' && wsBridge && wsBridge.readyState === WebSocket.OPEN) {
    wsBridge.send(data.payload);
  }
}

// Выходной узел выполняет реальный HTTP-запрос в свободный интернет
async function processExitNodeRequest(req) {
  const startTime = Date.now();
  try {
    const response = await fetch(req.url, {
      method: req.method,
      headers: req.headers || {}
    });

    const contentType = response.headers.get('content-type') || '';
    let responseData = '';

    if (contentType.includes('application/json') || contentType.includes('text/')) {
      responseData = await response.text();
    } else {
      // Бинарные данные (изображения и т.д.) кодируем в base64
      const blob = await response.blob();
      responseData = await blobToBase64(blob);
    }

    const duration = Date.now() - startTime;
    logExit(`[Ответ] ${req.url} -> ${response.status} (${duration}ms)`, 'log-success');

    sendPacket({
      type: 'PROXY_RES',
      id: req.id,
      status: response.status,
      statusText: response.statusText,
      contentType: contentType,
      data: responseData,
      duration: duration
    });
  } catch (err) {
    logExit(`[Ошибка Fetch] ${req.url} -> ${err.message}`, 'log-error');
    sendPacket({
      type: 'PROXY_RES',
      id: req.id,
      status: 502,
      statusText: 'Bad Gateway (Exit Node Fetch Error)',
      contentType: 'text/plain',
      data: `Ошибка выполнения запроса на выходном узле: ${err.message}\n\nПримечание: в браузере некоторые сайты блокируются политикой CORS. Для полного 100% доступа запустите headless-ноду в Node.js (exit-node.js).`,
      duration: Date.now() - startTime
    });
  }
}

// Отправка пакета в WebRTC DataChannel
function sendPacket(obj) {
  if (activeConnection && activeConnection.open) {
    const payloadSize = JSON.stringify(obj).length;
    txBytes += payloadSize;
    updateStats();
    activeConnection.send(obj);
  }
}

// Клиент отправляет запрос через прокси-интерфейс
async function sendProxyRequest() {
  if (!activeConnection || !activeConnection.open) {
    alert('Сначала подключитесь к выходному узлу!');
    return;
  }

  const url = document.getElementById('proxy-url').value.trim();
  const method = document.getElementById('request-method').value;
  if (!url) return;

  const btn = document.getElementById('btn-send-request');
  btn.disabled = true;
  btn.innerText = 'Загрузка...';

  const reqId = 'req_' + Math.random().toString(36).substr(2, 9);
  const startTime = Date.now();

  const promise = new Promise((resolve) => {
    pendingRequests.set(reqId, resolve);
  });

  // Отправляем пакет запроса по WebRTC
  sendPacket({
    type: 'PROXY_REQ',
    id: reqId,
    method: method,
    url: url
  });

  const res = await promise;
  btn.disabled = false;
  btn.innerText = 'Перейти';

  // Отображаем результаты
  document.getElementById('response-status').innerText = `${res.status} ${res.statusText}`;
  document.getElementById('response-time').innerText = `${res.duration || (Date.now() - startTime)} ms`;

  // Заполняем Raw вкладку
  document.getElementById('response-raw').innerText = 
    `HTTP Status: ${res.status} ${res.statusText}\nContent-Type: ${res.contentType}\n\n${res.data}`;

  // Рендерим HTML в безопасный IFrame
  const iframe = document.getElementById('response-frame');
  if (res.contentType.includes('text/html')) {
    iframe.srcdoc = res.data;
  } else if (res.contentType.includes('image/')) {
    iframe.srcdoc = `<img src="${res.data}" style="max-width: 100%;">`;
  } else {
    iframe.srcdoc = `<pre style="font-family: monospace; padding: 10px; word-break: break-all;">${escapeHtml(res.data)}</pre>`;
  }
}

// Замер задержки (Ping/Pong)
function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (activeConnection && activeConnection.open) {
      sendPacket({ type: 'PING', timestamp: Date.now() });
    }
  }, 2000);
}

function stopPing() {
  if (pingTimer) clearInterval(pingTimer);
  document.getElementById('stat-ping').innerText = '-- ms';
}

// Вспомогательные функции UI
function updateStatus(state, text) {
  const badge = document.getElementById('connection-status-badge');
  badge.className = `badge badge-${state}`;
  badge.innerText = text;
}

function updateStats() {
  document.getElementById('stat-tx').innerText = `${(txBytes / 1024).toFixed(1)} KB`;
  document.getElementById('stat-rx').innerText = `${(rxBytes / 1024).toFixed(1)} KB`;
}

function copyMyId() {
  const idInput = document.getElementById('my-peer-id');
  navigator.clipboard.writeText(idInput.value);
  alert('ID скопирован в буфер обмена! Передайте его клиенту.');
}

function switchResponseTab(tab) {
  document.querySelectorAll('.tabs .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.response-container .tab-content').forEach(c => c.classList.remove('active'));

  if (tab === 'preview') {
    document.querySelectorAll('.tabs .tab-btn')[0].classList.add('active');
    document.getElementById('tab-preview').classList.add('active');
  } else {
    document.querySelectorAll('.tabs .tab-btn')[1].classList.add('active');
    document.getElementById('tab-raw').classList.add('active');
  }
}

function logExit(msg, className = 'log-info') {
  const container = document.getElementById('exit-logs');
  if (!container) return;
  const entry = document.createElement('div');
  entry.className = `log-entry ${className}`;
  const time = new Date().toLocaleTimeString();
  entry.innerText = `[${time}] ${msg}`;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Опциональный локальный WebSocket-мост для системного SOCKS5
function initWebSocketBridge() {
  try {
    wsBridge = new WebSocket('ws://localhost:8765');
    wsBridge.onopen = () => {
      const badge = document.getElementById('ws-bridge-badge');
      badge.className = 'badge badge-connected';
      badge.innerText = 'Подключен (127.0.0.1:1080)';
    };
    wsBridge.onclose = () => {
      const badge = document.getElementById('ws-bridge-badge');
      badge.className = 'badge badge-disconnected';
      badge.innerText = 'Не подключен';
    };
  } catch (e) {
    // Мост не запущен локально, это нормально для чистого веб-режима
  }
}
