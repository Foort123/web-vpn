// Данные рабочего аккаунта Cloudflare WARP, сгенерированные и проверенные
const configData = {
  v4: "172.16.0.2",
  v6: "2606:4700:110:87a2:74fe:d0b3:98ca:70b9",
  privateKey: "CFGzanbDHvEEFEjuhRfT3T4bFkO7b7vUgtON2QmMs3c=",
  peerPublicKey: "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=",
  dns: "1.1.1.1, 1.0.0.1",
  endpoint: "162.159.192.1:2408",
  preset: "balanced"
};

let qrCodeInstance = null;

// Пресеты параметров AmneziaWG для обхода блокировок DPI
const presets = {
  balanced: {
    name: "Сбалансированный AmneziaWG",
    jc: 4,
    jmin: 40,
    jmax: 70,
    h1: 1,
    h2: 2,
    h3: 3,
    h4: 4
  },
  aggressive: {
    name: "Агрессивный обход DPI",
    jc: 8,
    jmin: 50,
    jmax: 120,
    h1: 7,
    h2: 8,
    h3: 9,
    h4: 10
  },
  stealth: {
    name: "Ультра-стелс",
    jc: 6,
    jmin: 60,
    jmax: 140,
    h1: 14201238,
    h2: 87521094,
    h3: 33491820,
    h4: 98127394
  },
  wireguard: {
    name: "Чистый WireGuard",
    jc: null
  }
};

// Формирование текста конфигурации
function buildConfigText() {
  const p = presets[configData.preset];
  let text = `[Interface]
Address = ${configData.v4}/32, ${configData.v6}/128
PrivateKey = ${configData.privateKey}
DNS = ${configData.dns}
`;

  // Добавляем параметры AmneziaWG, если это не чистый WireGuard
  if (p.jc !== null) {
    text += `Jc = ${p.jc}
Jmin = ${p.jmin}
Jmax = ${p.jmax}
H1 = ${p.h1}
H2 = ${p.h2}
H3 = ${p.h3}
H4 = ${p.h4}
`;
  }

  text += `
[Peer]
PublicKey = ${configData.peerPublicKey}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = ${configData.endpoint}
`;

  return text;
}

// Обновление UI и QR-кода
function updateUI() {
  const confText = buildConfigText();
  const textarea = document.getElementById('config-text');
  if (textarea) textarea.value = confText;

  // Обновление QR-кода
  const qrElem = document.getElementById('qrcode');
  if (qrElem && typeof QRCode !== 'undefined') {
    qrElem.innerHTML = '';
    qrCodeInstance = new QRCode(qrElem, {
      text: confText,
      width: 170,
      height: 170,
      colorDark: "#ffffff",
      colorLight: "#161b22",
      correctLevel: QRCode.CorrectLevel.L
    });
  }
}

// Применение пресета
function applyPreset() {
  const sel = document.getElementById('preset-select');
  configData.preset = sel.value;
  updateUI();
}

// Выбор эндпоинта
function updateEndpoint() {
  const sel = document.getElementById('endpoint-select');
  configData.endpoint = sel.value;
  updateUI();
}

// Копирование в буфер обмена
function copyConfig() {
  const text = buildConfigText();
  navigator.clipboard.writeText(text).then(() => {
    alert("✅ Конфиг Amnezia скопирован в буфер обмена!\n\nОткройте приложение Amnezia, нажмите «Добавить туннель» -> «Файл с настройками или ключ» и вставьте его.");
  }).catch(() => {
    const textarea = document.getElementById('config-text');
    textarea.select();
    document.execCommand('copy');
    alert("✅ Конфиг скопирован!");
  });
}

// Скачивание файла warp.conf
function downloadConf() {
  const text = buildConfigText();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'warp.conf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  updateUI();
});
