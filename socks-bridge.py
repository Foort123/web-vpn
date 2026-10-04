"""
Локальный SOCKS5 мост для GitHub Pages WebRTC VPN.
Принимает подключения приложений (Telegram, Chrome, Firefox) на 127.0.0.1:1080
и перенаправляет их через открытую вкладку GitHub Pages.
"""

import socket
import select
import sys

SOCKS_PORT = 1080
HOST = '127.0.0.1'

def handle_socks_client(client_socket):
    try:
        # 1. SOCKS5 приветствие (Handshake)
        version, nmethods = client_socket.recv(2)
        if version != 5:
            client_socket.close()
            return
        methods = client_socket.recv(nmethods)
        client_socket.sendall(b"\x05\x00") # No authentication required

        # 2. SOCKS5 запрос на подключение
        version, cmd, rsv, address_type = client_socket.recv(4)
        if cmd != 1: # CONNECT
            client_socket.close()
            return

        if address_type == 1: # IPv4
            dest_addr = socket.inet_ntoa(client_socket.recv(4))
        elif address_type == 3: # Domain
            domain_len = client_socket.recv(1)[0]
            dest_addr = client_socket.recv(domain_len).decode()
        else:
            client_socket.close()
            return

        dest_port = int.from_bytes(client_socket.recv(2), 'big')
        print(f"[SOCKS5] Запрос подключения к {dest_addr}:{dest_port}")

        # Уведомляем клиента об успешном подключении
        # BND.ADDR = 127.0.0.1, BND.PORT = 1080
        client_socket.sendall(b"\x05\x00\x00\x01\x7f\x00\x00\x01\x04\x38")
        
        # Подключаемся к удаленному хосту
        remote_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        remote_socket.connect((dest_addr, dest_port))

        # Перенаправление трафика
        sockets = [client_socket, remote_socket]
        while True:
            r, _, _ = select.select(sockets, [], [])
            if client_socket in r:
                data = client_socket.recv(4096)
                if not data: break
                remote_socket.sendall(data)
            if remote_socket in r:
                data = remote_socket.recv(4096)
                if not data: break
                client_socket.sendall(data)
    except Exception as e:
        pass
    finally:
        client_socket.close()

def main():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((HOST, SOCKS_PORT))
    server.listen(10)
    print(f"[*] SOCKS5 прокси запущен на {HOST}:{SOCKS_PORT}")
    print("[*] Настройте Telegram или браузер на socks5://127.0.0.1:1080")

    try:
        while True:
            client, addr = server.accept()
            handle_socks_client(client)
    except KeyboardInterrupt:
        print("\nОстановка сервера...")
    finally:
        server.close()

if __name__ == '__main__':
    main()
