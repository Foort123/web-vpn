import urllib.request
import json
import base64
import datetime
import random
from cryptography.hazmat.primitives.asymmetric import x25519

def generate_warp_config():
    # 1. Генерируем ключевую пару Curve25519
    priv = x25519.X25519PrivateKey.generate()
    pub = priv.public_key()
    priv_b64 = base64.b64encode(priv.private_bytes_raw()).decode('utf-8')
    pub_b64 = base64.b64encode(pub.public_bytes_raw()).decode('utf-8')

    # 2. Регистрируемся в Cloudflare WARP
    endpoint_ver = random.randint(100, 999)
    url = f"https://api.cloudflareclient.com/v0a{endpoint_ver}/reg"
    
    body = json.dumps({
        'key': pub_b64,
        'install_id': '',
        'fcm_token': '',
        'tos': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'model': 'PC',
        'serial_number': '',
        'type': 'Android',
        'locale': 'en_US'
    }).encode('utf-8')

    req = urllib.request.Request(url, data=body, headers={
        'Content-Type': 'application/json; charset=UTF-8',
        'User-Agent': 'okhttp/3.12.1'
    }, method='POST')

    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode('utf-8'))

    v4 = res['config']['interface']['addresses']['v4']
    v6 = res['config']['interface']['addresses']['v6']
    peer_pub = res['config']['peers'][0]['public_key']
    
    # Список проверенных рабочих IP-эндпоинтов Cloudflare (для обхода блокировки engage.cloudflareclient.com)
    clean_endpoints = [
        "162.159.192.1:2408",
        "162.159.193.1:2408",
        "162.159.192.5:2408",
        "188.114.96.1:2408",
        "188.114.97.1:2408"
    ]
    endpoint = random.choice(clean_endpoints)

    # Формируем готовый AmneziaWG конфиг с мусорными пакетами и заголовками для обхода DPI
    conf_content = f"""[Interface]
Address = {v4}/32, {v6}/128
PrivateKey = {priv_b64}
DNS = 1.1.1.1, 1.0.0.1
Jc = 4
Jmin = 40
Jmax = 70
H1 = 1
H2 = 2
H3 = 3
H4 = 4

[Peer]
PublicKey = {peer_pub}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = {endpoint}
"""

    return {
        "private_key": priv_b64,
        "public_key": pub_b64,
        "peer_pub": peer_pub,
        "v4": v4,
        "v6": v6,
        "endpoint": endpoint,
        "conf": conf_content
    }

if __name__ == '__main__':
    data = generate_warp_config()
    print("Generated successfully!")
    print(data['conf'])
    
    # Сохраняем raw конфиг для прямой ссылки
    with open("warp.conf", "w", encoding="utf-8") as f:
        f.write(data['conf'])
        
    with open("config.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
