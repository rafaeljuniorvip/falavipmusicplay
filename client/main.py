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

# Verificar instância única ANTES de importar outras coisas
from splash import check_single_instance, show_already_running, SplashScreen

if not check_single_instance():
    show_already_running()
    sys.exit(0)

from config import SERVER_URL, WEBSOCKET_URL, MUSIC_FOLDER, SYNC_INTERVAL, DEFAULT_VOLUME
from player import MusicPlayer
from sync import MusicSync
from scheduler import Scheduler
from websocket_client import NativeWebSocketClient
from gui import PlayerGUI


class FalaVIPPlayer:
    def __init__(self, create_gui=True):
        # Diretório base
        self.base_dir = Path(__file__).parent
        self.music_dir = self.base_dir / MUSIC_FOLDER

        # Componentes (GUI é criada separadamente se create_gui=False)
        self.player = MusicPlayer(str(self.music_dir))
        self.sync = MusicSync(SERVER_URL, str(self.music_dir), SYNC_INTERVAL)
        self.scheduler = Scheduler()
        self.ws_client = NativeWebSocketClient(WEBSOCKET_URL)
        self.gui = None

        # Estado
        self.is_running = True
        self.use_server_playlist = True  # Usar playlist do servidor quando disponível
        self.current_playlist_position = None  # Posição atual na playlist do servidor

        if create_gui:
            self.gui = PlayerGUI()
            self._setup_callbacks()

    def init_gui(self):
        """Inicializa a GUI (deve ser chamado na main thread)"""
        if self.gui is None:
            self.gui = PlayerGUI()
            self._setup_callbacks()

    def _get_next_from_server(self) -> bool:
        """Tenta obter próxima música do servidor e definir no player"""
        if not self.use_server_playlist:
            return False

        try:
            next_item = self.sync.get_next_from_server()
            if next_item and next_item.get('music_id'):
                music_id = next_item['music_id']
                event_type = next_item.get('event_type', 'music')
                position = next_item.get('position')

                # Obter caminho do arquivo
                filepath = self.sync.get_file_by_id(music_id)
                if filepath:
                    is_ad = event_type == 'ad'
                    self.player.set_next_song(filepath, is_ad=is_ad)
                    self.current_playlist_position = position
                    print(f"Próxima do servidor: {next_item.get('music_name')} (pos: {position}, tipo: {event_type})")
                    return True
                else:
                    print(f"Arquivo não encontrado para ID: {music_id}")
        except Exception as e:
            print(f"Erro ao obter próxima do servidor: {e}")

        return False

    def _mark_current_played(self):
        """Marca a música atual como tocada no servidor"""
        if self.current_playlist_position is not None:
            threading.Thread(
                target=self.sync.mark_song_played,
                args=(self.current_playlist_position,),
                daemon=True
            ).start()

    def _setup_callbacks(self):
        """Configura todos os callbacks"""

        # Callbacks do Player
        def on_song_change(song_name):
            next_song = self.player.peek_next_song()
            next_song_name = Path(next_song).name if next_song else None

            self.gui.root.after(0, lambda: self.gui.update_song(song_name, True))
            self.gui.root.after(0, lambda: self.gui.update_next_song(next_song_name))
            self._send_status()

            # Enviar log de música ou propaganda tocada
            if self.player.is_playing_ad:
                threading.Thread(
                    target=self.sync.send_log,
                    args=("ad", f"Propaganda tocada: {song_name}"),
                    daemon=True
                ).start()
            else:
                threading.Thread(
                    target=self.sync.send_log,
                    args=("music", f"Música tocada: {song_name}"),
                    daemon=True
                ).start()

        def on_song_end():
            # Marcar música atual como tocada no servidor
            self._mark_current_played()

            # Só conta como música se NÃO era propaganda (para scheduler local)
            if not self.player.is_playing_ad:
                self.scheduler.on_song_finished()

            # Tentar obter próxima música do servidor
            # Se conseguir, a próxima música já estará definida no player
            if not self._get_next_from_server():
                print("Usando playlist local (servidor não disponível)")

        self.player.on_song_change = on_song_change
        self.player.on_song_end = on_song_end

        # Callbacks do Sync
        def on_sync_complete(downloaded, deleted):
            # Carregar apenas MÚSICAS (excluindo propagandas)
            music_files = self.sync.get_music_files()
            self.player.load_playlist(shuffle=True, music_files=music_files)

            if self.sync.is_offline:
                msg = f"⚠️ MODO OFFLINE | {len(self.player.playlist)} músicas em cache"
            else:
                msg = f"✓ Sincronizado: {downloaded}↓ {deleted}✕ | {len(self.player.playlist)} músicas"
            self.gui.root.after(0, lambda: self.gui.update_sync_info(msg))

        def on_sync_error(error):
            self.gui.root.after(0, lambda: self.gui.update_sync_info(f"Erro: {error}"))

        def on_schedules_updated(schedules):
            # Callback quando schedules são atualizados via sync
            self.scheduler.update_schedules(
                schedules.get('volume_schedules', []),
                schedules.get('ad_schedules', []),
                schedules.get('scheduled_songs', []),
                schedules.get('hourly_volumes', {})
            )

        self.sync.on_sync_complete = on_sync_complete
        self.sync.on_sync_error = on_sync_error
        self.sync.on_schedules_updated = on_schedules_updated

        # Callbacks do WebSocket
        def on_ws_connect():
            self.gui.root.after(0, lambda: self.gui.update_status(True, "Conectado ao servidor"))
            self._send_status()
            # Log de conexão estabelecida
            threading.Thread(
                target=self.sync.send_log,
                args=("connection", "Conexão estabelecida com o servidor"),
                daemon=True
            ).start()

        def on_ws_disconnect():
            self.gui.root.after(0, lambda: self.gui.update_status(False, "Desconectado - Modo Offline"))
            self.gui.root.after(0, lambda: self.gui.update_sync_info(f"⚠️ OFFLINE | {len(self.player.playlist)} músicas em cache"))
            # Log de conexão perdida (pode falhar se offline)
            threading.Thread(
                target=self.sync.send_log,
                args=("connection", "Conexão perdida com o servidor"),
                daemon=True
            ).start()

        def on_init(settings):
            # Atualizar configurações
            volume = settings.get('volume', DEFAULT_VOLUME)
            self.player.set_volume(volume)
            self.gui.root.after(0, lambda: self.gui.update_volume(volume))

            # Atualizar scheduler com todos os dados incluindo hourly_volumes
            self.scheduler.update_schedules(
                settings.get('volume_schedules', []),
                settings.get('ad_schedules', []),
                settings.get('scheduled_songs', []),
                settings.get('hourly_volumes', {})
            )

            # Salvar no cache para operação offline
            self.sync._save_cache(settings)

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
            # Skip vindo do servidor (dashboard) - playlist já foi regenerada
            # Buscar próxima música antes de pular
            self._get_next_from_server()
            self.player.skip()

        def on_schedule_updated(data):
            # Atualizar scheduler com os novos dados de schedule (enviados via WebSocket)
            self.scheduler.update_schedules(
                data.get('volume_schedules', []),
                data.get('ad_schedules', []),
                data.get('scheduled_songs', []),
                data.get('hourly_volumes', {})
            )

            # Salvar no cache para operação offline
            self.sync._save_cache(data)

        def on_music_updated():
            # Sincronizar músicas
            threading.Thread(target=self.sync.sync, daemon=True).start()

        def on_playlist_updated(data):
            # Playlist foi atualizada/regenerada no servidor
            # Buscar próxima música do servidor para manter sincronizado
            print("Playlist atualizada no servidor, sincronizando...")
            self._get_next_from_server()

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
        self.ws_client.on_playlist_updated = on_playlist_updated

        # Callbacks do Scheduler
        def on_scheduled_volume(volume):
            self.player.set_volume(volume)
            self.gui.root.after(0, lambda: self.gui.update_volume(volume))

            # Enviar log de volume agendado
            threading.Thread(
                target=self.sync.send_log,
                args=("volume_scheduled", f"Volume ajustado para {int(volume * 100)}%", "Ajuste automático por hora"),
                daemon=True
            ).start()

        def on_play_ad(music_id):
            # Apenas define a propaganda como próxima música
            # O player tocará automaticamente quando a música atual terminar
            filepath = self.sync.get_file_by_id(music_id)
            if filepath:
                self.player.set_next_song(filepath, is_ad=True)
                print(f"Propaganda agendada: {Path(filepath).name}")

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
            def do_skip():
                # Notificar servidor sobre o skip (aguarda regeneração)
                if self.sync.notify_skip():
                    # Servidor regenerou, buscar próxima música correta
                    self._get_next_from_server()
                else:
                    # Offline - usar playlist local
                    print("Skip offline - usando playlist local")
                # Pular para próxima
                self.player.skip()

            # Executar em thread para não bloquear GUI
            threading.Thread(target=do_skip, daemon=True).start()

        def gui_volume(volume):
            self.player.set_volume(volume)
            self._send_status()
            # Log de alteração manual de volume
            threading.Thread(
                target=self.sync.send_log,
                args=("volume_manual", f"Volume ajustado para {int(volume * 100)}%", "Ajuste pelo cliente"),
                daemon=True
            ).start()

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
                self.player.volume,
                self.player.get_position(),
                self.player.current_duration,
                self.player.get_remaining()
            )

    def _status_update_loop(self):
        """Loop para enviar status periodicamente"""
        if self.is_running:
            self._send_status()
            self.gui.root.after(5000, self._status_update_loop)

    def _time_update_loop(self):
        """Loop para atualizar tempo na GUI (a cada 500ms)"""
        if self.is_running:
            position = self.player.get_position()
            duration = self.player.current_duration
            remaining = self.player.get_remaining()
            self.gui.update_time(position, duration, remaining)
            self.gui.root.after(500, self._time_update_loop)

    def start(self):
        """Inicia a aplicação (com carregamento completo)"""
        print("Iniciando FalaVIP Music Player...")

        # Log de início do aplicativo
        threading.Thread(
            target=self.sync.send_log,
            args=("app", "Aplicativo iniciado"),
            daemon=True
        ).start()

        # Sincronizar músicas inicialmente
        self.gui.update_sync_info("Sincronizando músicas...")
        self.sync.sync()

        # Carregar schedules do servidor ou cache (para operação offline)
        schedules = self.sync.sync_schedules()
        if schedules:
            self.scheduler.update_schedules(
                schedules.get('volume_schedules', []),
                schedules.get('ad_schedules', []),
                schedules.get('scheduled_songs', []),
                schedules.get('hourly_volumes', {})
            )
            if self.sync.is_offline:
                print("Schedules carregados do CACHE (modo offline)")
            else:
                print("Schedules carregados do servidor")

        # Carregar playlist (apenas músicas, sem propagandas)
        music_files = self.sync.get_music_files()
        self.player.load_playlist(shuffle=True, music_files=music_files)

        self._start_components()

    def start_gui_only(self):
        """Inicia apenas a GUI (carregamento já foi feito pelo splash)"""
        print("Iniciando FalaVIP Music Player...")

        # Log de início do aplicativo
        threading.Thread(
            target=self.sync.send_log,
            args=("app", "Aplicativo iniciado"),
            daemon=True
        ).start()

        self._start_components()

    def _start_components(self):
        """Inicia componentes e GUI"""
        # Atualizar info depois que o mainloop iniciar
        def update_initial_info():
            if self.sync.is_offline:
                self.gui.update_sync_info(f"⚠️ MODO OFFLINE | {len(self.player.playlist)} músicas em cache")
                self.gui.update_status(False, "Offline - Usando cache")
            else:
                self.gui.update_sync_info(f"✓ {len(self.player.playlist)} músicas na playlist")

        self.gui.root.after(100, update_initial_info)

        # Iniciar componentes
        self.player.start_monitoring()
        self.sync.start_sync()
        self.scheduler.start()
        self.ws_client.connect()

        # Iniciar loop de status
        self.gui.root.after(1000, self._status_update_loop)

        # Iniciar loop de atualização de tempo
        self.gui.root.after(500, self._time_update_loop)

        # Definir volume inicial
        self.player.set_volume(DEFAULT_VOLUME)
        self.gui.update_volume(DEFAULT_VOLUME)

        # Iniciar reprodução - tentar usar playlist do servidor
        if self.player.playlist:
            # Tentar obter primeira música do servidor
            if not self.sync.is_offline and self._get_next_from_server():
                print("Usando playlist do servidor")
            else:
                print("Usando playlist local")
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

        # Log de encerramento do aplicativo (síncrono para garantir envio)
        try:
            self.sync.send_log("app", "Aplicativo encerrado")
        except:
            pass

        self.player.cleanup()
        self.sync.stop_sync()
        self.scheduler.stop()
        self.ws_client.disconnect()
        self.gui.quit()



def log_error(msg):
    try:
        with open("debug_log.txt", "a", encoding='utf-8') as f:
            import datetime
            timestamp = datetime.datetime.now().isoformat()
            f.write(f"[{timestamp}] {msg}\n")
    except:
        pass

def main():
    log_error("Iniciando main()...")
    # Mostrar splash screen durante carregamento
    splash = SplashScreen()

    app = None
    load_error = None

    def load_app(splash_screen):
        nonlocal app, load_error
        try:
            log_error("load_app iniciado")
            splash_screen.update_status_safe("Inicializando componentes...", 10)

            # Criar instância do player SEM GUI (GUI será criada na main thread depois)
            log_error("Criando instância FalaVIPPlayer")
            app = FalaVIPPlayer(create_gui=False)

            # Callback para mostrar progresso do download
            def on_download_progress(filename, current, total):
                # Truncar nome se muito longo
                display_name = filename[:35] + "..." if len(filename) > 38 else filename
                # Progresso visual mais suave
                percent = int((current / max(total, 1)) * 100)
                splash_screen.update_status_safe(f"Baixando prioridade ({current}/{total}): {display_name}", 30 + (percent // 2))

            app.sync.on_download_progress = on_download_progress

            splash_screen.update_status_safe("Buscando playlist e configs...", 25)
            
            # Atualizar configs primeiro
            log_error("Sincronizando agendamentos...")
            schedules = app.sync.sync_schedules()
            if schedules:
                app.scheduler.update_schedules(
                    schedules.get('volume_schedules', []),
                    schedules.get('ad_schedules', []),
                    schedules.get('scheduled_songs', []),
                    schedules.get('hourly_volumes', {})
                )

            # Sync prioritário (baixa as próximas 3 músicas se não tiver)
            log_error("Iniciando sync_priority...")
            splash_screen.update_status_safe("Verificando próximas músicas...", 40)
            app.sync.sync_priority(min_count=3, callback=on_download_progress)

            log_error("Carregando playlist no player...")
            splash_screen.update_status_safe("Preparando player...", 80)
            music_files = app.sync.get_music_files()
            app.player.load_playlist(shuffle=True, music_files=music_files)

            splash_screen.update_status_safe("Iniciando...", 95)
            # WebSocket será conectado depois

            splash_screen.update_status_safe("Pronto!", 100)
            log_error("load_app concluído com sucesso")

        except Exception as e:
            load_error = str(e)
            log_error(f"ERRO em load_app: {e}")
            print(f"Erro no carregamento: {e}")
            import traceback
            traceback.print_exc()
            log_error(traceback.format_exc())

    # Executar carregamento com splash
    try:
        splash.run_with_callback(load_app)
    except Exception as e:
        log_error(f"Erro ao rodar splash: {e}")

    # Se houve erro, mostrar mensagem
    if load_error:
        log_error(f"Exibindo mensagem de erro: {load_error}")
        try:
            import tkinter as tk
            root = tk.Tk()
            root.withdraw()
            from tkinter import messagebox
            messagebox.showerror("Erro", f"Falha ao iniciar:\n{load_error}")
            root.destroy()
        except Exception as e:
            log_error(f"Erro ao exibir messagebox: {e}")
        return

    # Se não carregou o app, sair
    if app is None:
        log_error("App é None, saindo.")
        return

    # Iniciar a aplicação principal (sem o carregamento inicial)
    try:
        log_error("Criando GUI na main thread...")
        app.init_gui()
        log_error("Iniciando GUI...")
        app.start_gui_only()
    except KeyboardInterrupt:
        try:
            app.stop()
        except:
            pass
    except Exception as e:
        log_error(f"Erro fatal na main loop: {e}")
        print(f"Erro: {e}")
        import traceback
        traceback.print_exc()
        try:
            app.stop()
        except:
            pass


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        with open("fatal_error.txt", "w") as f:
            import traceback
            f.write(traceback.format_exc())

