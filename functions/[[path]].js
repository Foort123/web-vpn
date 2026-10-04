import { connect } from 'cloudflare:sockets';

// Уникальный UUID для авторизации
const userID = 'd342d11e-d424-4583-b36e-524ab1f0afa4';

export async function onRequest(context) {
  const { request } = context;
  try {
    const upgradeHeader = request.headers.get('Upgrade');
    const url = new URL(request.url);

    // Если запрос из обычного браузера — отдаём страницу с готовым VLESS ключом
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response(generateHtml(url.host, userID), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Обработка WebSocket VLESS туннеля
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    server.accept();

    handleVLESS(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  } catch (err) {
    return new Response(err.toString(), { status: 500 });
  }
}

async function handleVLESS(webSocket) {
  let remoteSocket = null;

  webSocket.addEventListener('message', async (event) => {
    try {
      const buffer = event.data;
      if (!remoteSocket) {
        const vlessHeader = processVlessHeader(buffer);
        if (!vlessHeader) {
          webSocket.close();
          return;
        }

        // Подключаемся к целевому хосту через Cloudflare сокет
        remoteSocket = connect({
          hostname: vlessHeader.address,
          port: vlessHeader.port,
        });

        const writer = remoteSocket.writable.getWriter();
        if (vlessHeader.rawData.byteLength > 0) {
          await writer.write(vlessHeader.rawData);
        }
        writer.releaseLock();

        pipeRemoteToWebSocket(remoteSocket, webSocket);
      } else {
        const writer = remoteSocket.writable.getWriter();
        await writer.write(buffer);
        writer.releaseLock();
      }
    } catch (e) {
      webSocket.close();
    }
  });

  webSocket.addEventListener('close', () => {
    if (remoteSocket) remoteSocket.close();
  });
}

function processVlessHeader(buffer) {
  if (buffer.byteLength < 24) return null;
  const view = new DataView(buffer);
  const version = view.getUint8(0);
  
  const optLength = view.getUint8(17);
  const portIndex = 18 + optLength + 1;
  const port = view.getUint16(portIndex);
  
  const addrType = view.getUint8(portIndex + 2);
  let addrIndex = portIndex + 3;
  let address = '';

  if (addrType === 1) {
    address = `${view.getUint8(addrIndex)}.${view.getUint8(addrIndex+1)}.${view.getUint8(addrIndex+2)}.${view.getUint8(addrIndex+3)}`;
    addrIndex += 4;
  } else if (addrType === 2) {
    const addrLen = view.getUint8(addrIndex);
    addrIndex += 1;
    address = new TextDecoder().decode(buffer.slice(addrIndex, addrIndex + addrLen));
    addrIndex += addrLen;
  } else if (addrType === 3) {
    addrIndex += 16;
  }

  const rawData = buffer.slice(addrIndex);
  return { version, address, port, rawData };
}

async function pipeRemoteToWebSocket(remoteSocket, webSocket) {
  const reader = remoteSocket.readable.getReader();
  const vlessResponseHeader = new Uint8Array([0, 0]);
  let isFirstPacket = true;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (isFirstPacket) {
        const combined = new Uint8Array(vlessResponseHeader.length + value.length);
        combined.set(vlessResponseHeader, 0);
        combined.set(value, vlessResponseHeader.length);
        webSocket.send(combined);
        isFirstPacket = false;
      } else {
        webSocket.send(value);
      }
    }
  } catch (e) {
  } finally {
    webSocket.close();
  }
}

function generateHtml(host, uuid) {
  // Чистый Anycast IP Cloudflare
  const cleanIP = '104.16.132.229';
  const vlessLink = `vless://${uuid}@${cleanIP}:443?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=%2F#Pages-VPN`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Cloudflare Pages VLESS VPN</title>
  <style>
    body { background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 30px; text-align: center; }
    .box { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 24px; max-width: 650px; margin: 0 auto; word-break: break-all; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
    h2 { color: #58a6ff; margin-bottom: 12px; }
    .badge { display: inline-block; background: rgba(63, 185, 80, 0.15); color: #3fb950; border: 1px solid #3fb950; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: bold; margin-bottom: 16px; }
    textarea { width: 100%; height: 110px; background: #0d1117; color: #79c0ff; border: 1px solid #30363d; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px; line-height: 1.4; box-sizing: border-box; }
    .btn { background: #238636; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; margin-top: 14px; font-weight: bold; font-size: 14px; transition: 0.2s; }
    .btn:hover { background: #2ea043; }
    p { font-size: 14px; color: #8b949e; line-height: 1.5; }
    .guide { text-align: left; margin-top: 20px; background: #0d1117; padding: 14px; border-radius: 6px; border: 1px solid #30363d; font-size: 13px; }
    .guide ol { padding-left: 20px; }
    .guide li { margin-bottom: 6px; }
  </style>
</head>
<body>
  <div class="box">
    <div class="badge">● Сервер активен (Cloudflare Pages)</div>
    <h2>🎉 Ваш личный VLESS сервер готов!</h2>
    <p>Работает в доменной зоне <strong>*.pages.dev</strong>, которая открывается в РФ без блокировок:</p>
    
    <textarea id="t" readonly>${vlessLink}</textarea>
    <br>
    <button class="btn" id="cp" onclick="navigator.clipboard.writeText(document.getElementById('t').value); this.innerText='✅ Скопировано в буфер!'; setTimeout(()=>this.innerText='📋 Скопировать ключ VLESS', 2000)">📋 Скопировать ключ VLESS</button>

    <div class="guide">
      <strong>Как подключить:</strong>
      <ol>
        <li>Скопируйте ключ по кнопке выше.</li>
        <li>Откройте <strong>Amnezia VPN</strong> ➔ «Добавить» ➔ «Файл с настройками или ключ».</li>
        <li>Вставьте ключ и нажмите «Подключиться».</li>
      </ol>
    </div>
  </div>
</body>
</html>`;
}
