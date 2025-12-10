"""
Player de música usando pygame
"""

import os
import random
import threading
from pathlib import Path
from typing import Callable, Optional

import pygame


class MusicPlayer:
    def __init__(self, music_folder: str):
        self.music_folder = Path(music_folder)
        self.music_folder.mkdir(exist_ok=True)

        # Inicializar pygame mixer
        pygame.mixer.init()

        # Estado do player
        self.playlist: list[str] = []
        self.current_index: int = -1
        self.current_song: Optional[str] = None
        self.is_playing: bool = False
        self.volume: float = 0.5
        self.next_song_override: Optional[str] = None

        # Callbacks
        self.on_song_change: Optional[Callable[[str], None]] = None
        self.on_song_end: Optional[Callable[[], None]] = None

        # Thread de monitoramento
        self._monitor_thread: Optional[threading.Thread] = None
        self._running: bool = False

        # Definir volume inicial
        pygame.mixer.music.set_volume(self.volume)

    def scan_music_folder(self) -> list[str]:
        """Escaneia a pasta de músicas e retorna lista de arquivos"""
        extensions = {'.mp3', '.wav', '.ogg', '.flac', '.m4a'}
        files = []

        if self.music_folder.exists():
            for file in self.music_folder.iterdir():
                if file.suffix.lower() in extensions:
                    files.append(str(file))

        return files

    def load_playlist(self, shuffle: bool = True):
        """Carrega playlist da pasta de músicas"""
        self.playlist = self.scan_music_folder()

        if shuffle and self.playlist:
            random.shuffle(self.playlist)

        self.current_index = -1

    def get_next_song(self) -> Optional[str]:
        """Obtém próxima música a tocar"""
        # Se há uma música forçada, usar ela
        if self.next_song_override:
            song = self.next_song_override
            self.next_song_override = None
            return song

        if not self.playlist:
            return None

        # Avançar para próxima
        self.current_index += 1

        # Se chegou ao fim, embaralhar novamente
        if self.current_index >= len(self.playlist):
            random.shuffle(self.playlist)
            self.current_index = 0

        return self.playlist[self.current_index]

    def play(self, song_path: Optional[str] = None):
        """Toca uma música específica ou a próxima da playlist"""
        if song_path:
            self.current_song = song_path
        else:
            self.current_song = self.get_next_song()

        if not self.current_song or not os.path.exists(self.current_song):
            print(f"Música não encontrada: {self.current_song}")
            return False

        try:
            pygame.mixer.music.load(self.current_song)
            pygame.mixer.music.play()
            self.is_playing = True

            if self.on_song_change:
                self.on_song_change(Path(self.current_song).name)

            return True
        except Exception as e:
            print(f"Erro ao reproduzir: {e}")
            return False

    def pause(self):
        """Pausa a reprodução"""
        if self.is_playing:
            pygame.mixer.music.pause()
            self.is_playing = False

    def unpause(self):
        """Continua a reprodução"""
        if not self.is_playing and self.current_song:
            pygame.mixer.music.unpause()
            self.is_playing = True

    def stop(self):
        """Para a reprodução"""
        pygame.mixer.music.stop()
        self.is_playing = False
        self.current_song = None

    def skip(self):
        """Pula para próxima música"""
        self.play()

    def set_volume(self, volume: float):
        """Define o volume (0.0 a 1.0)"""
        self.volume = max(0.0, min(1.0, volume))
        pygame.mixer.music.set_volume(self.volume)

    def set_next_song(self, song_path: str):
        """Define a próxima música a ser tocada"""
        self.next_song_override = song_path

    def is_music_playing(self) -> bool:
        """Verifica se há música tocando"""
        return pygame.mixer.music.get_busy()

    def _monitor_loop(self):
        """Loop de monitoramento para detectar fim de música"""
        while self._running:
            if self.is_playing and not self.is_music_playing():
                # Música terminou, tocar próxima
                if self.on_song_end:
                    self.on_song_end()
                self.play()

            pygame.time.wait(500)  # Verificar a cada 500ms

    def start_monitoring(self):
        """Inicia thread de monitoramento"""
        if self._monitor_thread and self._monitor_thread.is_alive():
            return

        self._running = True
        self._monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._monitor_thread.start()

    def stop_monitoring(self):
        """Para thread de monitoramento"""
        self._running = False
        if self._monitor_thread:
            self._monitor_thread.join(timeout=1)

    def get_status(self) -> dict:
        """Retorna status atual do player"""
        return {
            "current_song": Path(self.current_song).name if self.current_song else None,
            "is_playing": self.is_playing,
            "volume": self.volume,
            "playlist_count": len(self.playlist)
        }

    def cleanup(self):
        """Limpa recursos"""
        self.stop_monitoring()
        self.stop()
        pygame.mixer.quit()
