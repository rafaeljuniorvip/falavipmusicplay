"""
FalaVIP Music Player - Cliente Windows
Entry point principal
"""

import os
import sys
import threading
from pathlib import Path

# Adicionar diretório atual ao path
sys.path.insert(0, str(Path(__file__).parent))

from config import SERVER_URL, WEBSOCKET_URL, MUSIC_FOLDER, SYNC_INTERVAL, DEFAULT_VOLUME
from player import MusicPlayer
from sync import MusicSync
from scheduler import Scheduler
from websocket_client import NativeWebSocketClient
from gui import PlayerGUI


class FalaVIPPlayer:
    def __init__(self):
        # Diretório base
        self.base_dir = Path(__file__).parent
        self.music_dir = self.base_dir / MUSIC_FOLDER

        # Componentes
        self.player = MusicPlayer(str(self.music_dir))
        self.sync = MusicSync(SERVER_URL, str(self.music_dir), SYNC_INTERVAL)
        self.scheduler = Scheduler()
        self.ws_client = NativeWebSocketClient(WEBSOCKET_URL)
        self.gui = PlayerGUI()

        # Estado
        self.is_running = True

        self._setup_callbacks()

    def _setup_callbacks(self):
        """Configura todos os callbacks"""

        # Callbacks do Player
        def on_song_change(song_name):
            self.gui.root.after(0, lambda: self.gui.update_song(song_name, True))
            self._send_status()

        self.player.on_song_change = on_song_change

        # Callbacks do Sync
        def on_sync_complete(downloaded, deleted):
            self.player.load_playlist(shuffle=True)
            msg = f"Sincronizado: {downloaded} baixadas, {deleted} removidas | {len(self.player.playlist)} músicas"
            self.gui.root.after(0, lambda: self.gui.update_sync_info(msg))

        def on_sync_error(error):
            self.gui.root.after(0, lambda: self.gui.update_sync_info(f"Erro: {error}"))

        self.sync.on_sync_complete = on_sync_complete
        self.sync.on_sync_error = on_sync_error

        # Callbacks do WebSocket
        def on_ws_connect():
            self.gui.root.after(0, lambda: self.gui.update_status(True, "Conectado ao servidor"))
            self._send_status()

        def on_ws_disconnect():
            self.gui.root.after(0, lambda: self.gui.update_status(False, "Desconectado"))

        def on_init(settings):
            # Atualizar configurações
            volume = settings.get('volume', DEFAULT_VOLUME)
            self.player.set_volume(volume)
            self.gui.root.after(0, lambda: self.gui.update_volume(volume))

            # Atualizar scheduler
            self.scheduler.update_schedules(
                settings.get('volume_schedules', []),
                settings.get('ad_schedules', []),
                settings.get('scheduled_songs', [])
            )

        def on_volume_change(volume):
            self.player.set_volume(volume)
            self.gui.root.after(0, lambda: self.gui.update_volume(volume))

        def on_play_next(music_id):
            filepath = self.sync.get_file_by_id(music_id)
            if filepath:
                self.player.set_next_song(filepath)

        def on_play():
            self.player.unpause()
            self.gui.root.after(0, lambda: self.gui.update_song(
                self.player.current_song and Path(self.player.current_song).name,
                True
            ))
            self._send_status()

        def on_pause():
            self.player.pause()
            self.gui.root.after(0, lambda: self.gui.update_song(
                self.player.current_song and Path(self.player.current_song).name,
                False
            ))
            self._send_status()

        def on_skip():
            self.player.skip()

        def on_schedule_updated():
            # Recarregar configurações do servidor
            pass

        def on_music_updated():
            # Sincronizar músicas
            threading.Thread(target=self.sync.sync, daemon=True).start()

        self.ws_client.on_connect = on_ws_connect
        self.ws_client.on_disconnect = on_ws_disconnect
        self.ws_client.on_init = on_init
        self.ws_client.on_volume_change = on_volume_change
        self.ws_client.on_play_next = on_play_next
        self.ws_client.on_play = on_play
        self.ws_client.on_pause = on_pause
        self.ws_client.on_skip = on_skip
        self.ws_client.on_schedule_updated = on_schedule_updated
        self.ws_client.on_music_updated = on_music_updated

        # Callbacks do Scheduler
        def on_scheduled_volume(volume):
            self.player.set_volume(volume)
            self.gui.root.after(0, lambda: self.gui.update_volume(volume))

        def on_play_ad(music_id):
            filepath = self.sync.get_file_by_id(music_id)
            if filepath:
                self.player.set_next_song(filepath)
                self.player.skip()

        def on_scheduled_song(music_id):
            filepath = self.sync.get_file_by_id(music_id)
            if filepath:
                self.player.set_next_song(filepath)
                self.player.skip()

        self.scheduler.on_volume_change = on_scheduled_volume
        self.scheduler.on_play_ad = on_play_ad
        self.scheduler.on_play_song = on_scheduled_song

        # Callbacks da GUI
        def gui_play():
            if not self.player.current_song:
                self.player.play()
            else:
                self.player.unpause()
            self._send_status()

        def gui_pause():
            self.player.pause()
            self._send_status()

        def gui_skip():
            self.player.skip()

        def gui_volume(volume):
            self.player.set_volume(volume)
            self._send_status()

        self.gui.on_play = gui_play
        self.gui.on_pause = gui_pause
        self.gui.on_skip = gui_skip
        self.gui.on_volume_change = gui_volume

    def _send_status(self):
        """Envia status para o servidor"""
        if self.ws_client.connected:
            self.ws_client.send_status(
                self.player.current_song and Path(self.player.current_song).name,
                self.player.is_playing,
                self.player.volume
            )

    def _status_update_loop(self):
        """Loop para enviar status periodicamente"""
        if self.is_running:
            self._send_status()
            self.gui.root.after(5000, self._status_update_loop)

    def start(self):
        """Inicia a aplicação"""
        print("Iniciando FalaVIP Music Player...")

        # Sincronizar músicas inicialmente
        self.gui.update_sync_info("Sincronizando músicas...")
        self.sync.sync()

        # Carregar playlist
        self.player.load_playlist(shuffle=True)
        self.gui.update_sync_info(f"{len(self.player.playlist)} músicas na playlist")

        # Iniciar componentes
        self.player.start_monitoring()
        self.sync.start_sync()
        self.scheduler.start()
        self.ws_client.connect()

        # Iniciar loop de status
        self.gui.root.after(1000, self._status_update_loop)

        # Definir volume inicial
        self.player.set_volume(DEFAULT_VOLUME)
        self.gui.update_volume(DEFAULT_VOLUME)

        # Iniciar reprodução
        if self.player.playlist:
            self.player.play()

        # Tratar fechamento da janela
        def on_closing():
            self.stop()

        self.gui.root.protocol("WM_DELETE_WINDOW", on_closing)

        # Iniciar GUI
        self.gui.run()

    def stop(self):
        """Para a aplicação"""
        print("Encerrando FalaVIP Music Player...")
        self.is_running = False

        self.player.cleanup()
        self.sync.stop_sync()
        self.scheduler.stop()
        self.ws_client.disconnect()
        self.gui.quit()


def main():
    app = FalaVIPPlayer()
    try:
        app.start()
    except KeyboardInterrupt:
        app.stop()
    except Exception as e:
        print(f"Erro: {e}")
        app.stop()


if __name__ == "__main__":
    main()
