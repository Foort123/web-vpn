// Данные рабочего аккаунта Cloudflare WARP
const configData = {
  v4: "172.16.0.2",
  v6: "2606:4700:110:87a2:74fe:d0b3:98ca:70b9",
  privateKey: "CFGzanbDHvEEFEjuhRfT3T4bFkO7b7vUgtON2QmMs3c=",
  peerPublicKey: "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=",
  dns: "1.1.1.1, 1.0.0.1",
  endpoint: "162.159.192.1:2408",
  preset: "balanced"
};

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

  // Обновление QR-кода через API генерации
  const qrImg = document.getElementById('qr-image');
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(confText)}`;
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

// Копирование в буфер обмена с мгновенной визуальной индикацией на кнопке
function copyConfig() {
  const textarea = document.getElementById('config-text');
  const btn = document.getElementById('btn-copy');
  
  if (textarea) {
    textarea.focus();
    textarea.select();
  }

  const textToCopy = textarea ? textarea.value : buildConfigText();

  // 1. Попытка через navigator.clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textToCopy).then(() => {
      showCopySuccess(btn);
    }).catch(() => {
      // 2. Фоллбэк через execCommand
      fallbackCopy(textarea, btn);
    });
  } else {
    fallbackCopy(textarea, btn);
  }
}

function fallbackCopy(textarea, btn) {
  try {
    if (textarea) {
      document.execCommand('copy');
      showCopySuccess(btn);
    }
  } catch (err) {
    alert("Выделите текст в поле и нажмите Ctrl+C");
  }
}

function showCopySuccess(btn) {
  if (!btn) return;
  const originalText = btn.innerHTML;
  btn.innerHTML = "✅ Скопировано!";
  btn.style.backgroundColor = "#2ea043";
  setTimeout(() => {
    btn.innerHTML = originalText;
    btn.style.backgroundColor = "";
  }, 2000);
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  updateUI();
});
