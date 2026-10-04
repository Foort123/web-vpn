import { connect } from 'cloudflare:sockets';

const userID = 'd342d11e-d424-4583-b36e-524ab1f0afa4';

export default {
  async fetch(request, env, ctx) {
    try {
      const upgradeHeader = request.headers.get('Upgrade');
      const url = new URL(request.url);

      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response(generateHtml(url.host, userID), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

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
  },
};

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
  const cleanIP = '104.16.132.229';
  const vlessLink = `vless://${uuid}@${cleanIP}:443?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=%2F#VPN`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>VLESS VPN</title>
  <style>
    body { background: #0d1117; color: #c9d1d9; font-family: sans-serif; padding: 30px; text-align: center; }
    .box { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 24px; max-width: 650px; margin: 0 auto; word-break: break-all; }
    h2 { color: #58a6ff; }
    textarea { width: 100%; height: 110px; background: #0d1117; color: #79c0ff; border: 1px solid #30363d; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px; }
    .btn { background: #238636; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; margin-top: 14px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="box">
    <h2>🎉 Ваш VLESS сервер готов!</h2>
    <textarea id="t" readonly>${vlessLink}</textarea><br>
    <button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('t').value); alert('Скопировано!')">📋 Скопировать ключ VLESS</button>
  </div>
</body>
</html>`;
}
