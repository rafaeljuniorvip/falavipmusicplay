"""
Cliente WebSocket para comunicação com o servidor
"""

import json
import threading
import time
from typing import Callable, Optional

import socketio


class WebSocketClient:
    def __init__(self, server_url: str):
        self.server_url = server_url.rstrip('/')
        self.sio = socketio.Client(reconnection=True, reconnection_attempts=0)
        self.connected = False

        # Callbacks
        self.on_connect: Optional[Callable[[], None]] = None
        self.on_disconnect: Optional[Callable[[], None]] = None
        self.on_volume_change: Optional[Callable[[float], None]] = None
        self.on_play_next: Optional[Callable[[str], None]] = None
        self.on_play: Optional[Callable[[], None]] = None
        self.on_pause: Optional[Callable[[], None]] = None
        self.on_skip: Optional[Callable[[], None]] = None
        self.on_schedule_updated: Optional[Callable[[], None]] = None
        self.on_music_updated: Optional[Callable[[], None]] = None
        self.on_init: Optional[Callable[[dict], None]] = None

        # Configurações recebidas do servidor
        self.settings: dict = {}

        self._setup_handlers()

    def _setup_handlers(self):
        """Configura handlers de eventos"""

        @self.sio.event
        def connect():
            self.connected = True
            if self.on_connect:
                self.on_connect()

        @self.sio.event
        def disconnect():
            self.connected = False
            if self.on_disconnect:
                self.on_disconnect()

        @self.sio.on('*')
        def catch_all(event, data):
            # Fallback para eventos não tratados
            pass

    def connect(self):
        """Conecta ao servidor WebSocket"""
        # Usar websocket nativo em vez do socket.io
        # Como o servidor usa FastAPI WebSocket nativo, precisamos usar uma abordagem diferente
        pass

    def disconnect(self):
        """Desconecta do servidor"""
        try:
            self.sio.disconnect()
        except:
            pass


class NativeWebSocketClient:
    """Cliente WebSocket nativo para FastAPI WebSocket"""

    def __init__(self, server_url: str):
        self.server_url = server_url.rstrip('/')
        self.ws_url = self.server_url.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws'
        self.connected = False
        self._ws = None
        self._running = False
        self._thread: Optional[threading.Thread] = None

        # Callbacks
        self.on_connect: Optional[Callable[[], None]] = None
        self.on_disconnect: Optional[Callable[[], None]] = None
        self.on_volume_change: Optional[Callable[[float], None]] = None
        self.on_play_next: Optional[Callable[[str], None]] = None
        self.on_play: Optional[Callable[[], None]] = None
        self.on_pause: Optional[Callable[[], None]] = None
        self.on_skip: Optional[Callable[[], None]] = None
        self.on_schedule_updated: Optional[Callable[[], None]] = None
        self.on_music_updated: Optional[Callable[[], None]] = None
        self.on_init: Optional[Callable[[dict], None]] = None

        # Configurações recebidas do servidor
        self.settings: dict = {}

    def _handle_message(self, message: dict):
        """Processa mensagem recebida"""
        msg_type = message.get('type')

        if msg_type == 'init':
            self.settings = message.get('settings', {})
            if self.on_init:
                self.on_init(self.settings)

        elif msg_type == 'volume_change':
            volume = message.get('volume', 0.5)
            if self.on_volume_change:
                self.on_volume_change(volume)

        elif msg_type == 'play_next':
            music_id = message.get('music_id')
            if music_id and self.on_play_next:
                self.on_play_next(music_id)

        elif msg_type == 'play':
            if self.on_play:
                self.on_play()

        elif msg_type == 'pause':
            if self.on_pause:
                self.on_pause()

        elif msg_type == 'skip':
            if self.on_skip:
                self.on_skip()

        elif msg_type == 'schedule_updated':
            if self.on_schedule_updated:
                self.on_schedule_updated()

        elif msg_type == 'music_added' or msg_type == 'music_deleted':
            if self.on_music_updated:
                self.on_music_updated()

    def _connection_loop(self):
        """Loop de conexão WebSocket"""
        import websocket

        while self._running:
            try:
                self._ws = websocket.create_connection(self.ws_url, timeout=30)
                self.connected = True

                if self.on_connect:
                    self.on_connect()

                while self._running and self.connected:
                    try:
                        data = self._ws.recv()
                        if data:
                            message = json.loads(data)
                            self._handle_message(message)
                    except websocket.WebSocketTimeoutException:
                        continue
                    except Exception as e:
                        print(f"Erro ao receber mensagem: {e}")
                        break

            except Exception as e:
                print(f"Erro de conexão WebSocket: {e}")

            self.connected = False
            if self.on_disconnect:
                self.on_disconnect()

            if self._running:
                time.sleep(5)  # Aguardar antes de reconectar

    def send_status(self, current_song: str, is_playing: bool, volume: float):
        """Envia status do player para o servidor"""
        if self._ws and self.connected:
            try:
                message = {
                    "type": "player_status",
                    "current_song": current_song,
                    "is_playing": is_playing,
                    "volume": volume
                }
                self._ws.send(json.dumps(message))
            except Exception as e:
                print(f"Erro ao enviar status: {e}")

    def connect(self):
        """Inicia conexão em thread separada"""
        if self._thread and self._thread.is_alive():
            return

        self._running = True
        self._thread = threading.Thread(target=self._connection_loop, daemon=True)
        self._thread.start()

    def disconnect(self):
        """Desconecta do servidor"""
        self._running = False
        if self._ws:
            try:
                self._ws.close()
            except:
                pass
        if self._thread:
            self._thread.join(timeout=2)
