"""
Player de música usando pygame
"""

import os
import random
import threading
from pathlib import Path
from typing import Callable, Optional

import pygame

# Para obter duração das músicas
try:
    from mutagen import File as MutagenFile
    from mutagen.mp3 import MP3
    from mutagen.mp4 import MP4
    from mutagen.oggvorbis import OggVorbis
    from mutagen.flac import FLAC
    from mutagen.wave import WAVE
    MUTAGEN_AVAILABLE = True
    print("Mutagen carregado com sucesso")
except ImportError as e:
    MUTAGEN_AVAILABLE = False
    print(f"Mutagen não disponível - duração das músicas não será exibida: {e}")


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
        self.is_playing_ad: bool = False  # True se tocando propaganda
        self._next_is_ad: bool = False  # Flag temporária para próxima música

        # Informações de tempo
        self.current_duration: float = 0.0  # Duração total em segundos
        self._play_start_time: float = 0.0  # Momento em que começou a tocar

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

    def load_playlist(self, shuffle: bool = True, music_files: list[str] = None):
        """Carrega playlist da pasta de músicas ou de uma lista fornecida"""
        if music_files is not None:
            # Usa lista fornecida (filtrada para excluir propagandas)
            self.playlist = music_files.copy()
        else:
            # Escaneia pasta (comportamento antigo)
            self.playlist = self.scan_music_folder()

        if shuffle and self.playlist:
            random.shuffle(self.playlist)

        self.current_index = -1
        print(f"Playlist carregada: {len(self.playlist)} músicas")

    def get_next_song(self) -> Optional[str]:
        """Obtém próxima música a tocar"""
        # Se há uma música forçada (propaganda ou música agendada), usar ela
        if self.next_song_override:
            song = self.next_song_override
            self.next_song_override = None
            self.is_playing_ad = self._next_is_ad
            self._next_is_ad = False
            return song

        # Música normal da playlist
        self.is_playing_ad = False

        if not self.playlist:
            return None

        # Avançar para próxima
        self.current_index += 1

        # Se chegou ao fim, embaralhar novamente
        if self.current_index >= len(self.playlist):
            random.shuffle(self.playlist)
            self.current_index = 0

        return self.playlist[self.current_index]

    def peek_next_song(self) -> Optional[str]:
        """Retorna a próxima música sem avançar"""
        if self.next_song_override:
            return self.next_song_override

        if not self.playlist:
            return None

        next_idx = self.current_index + 1
        if next_idx >= len(self.playlist):
            # Simular o shuffle reiniciando
            return self.playlist[0] if self.playlist else None
            
        return self.playlist[next_idx]

    def _get_audio_duration(self, filepath: str) -> float:
        """Obtém a duração de um arquivo de áudio em segundos"""
        if not MUTAGEN_AVAILABLE:
            print(f"Mutagen não disponível, tentando pygame para: {filepath}")
            # Fallback direto para pygame
            try:
                sound = pygame.mixer.Sound(filepath)
                duration = sound.get_length()
                del sound
                if duration > 0:
                    print(f"Duração via pygame: {duration:.1f}s")
                    return duration
            except Exception as e:
                print(f"Pygame também falhou: {e}")
            return 0.0

        try:
            ext = Path(filepath).suffix.lower()
            duration = 0.0

            # Tentar com classe específica primeiro (mais confiável)
            if ext == '.mp3':
                audio = MP3(filepath)
                duration = audio.info.length
            elif ext in ('.m4a', '.mp4', '.aac'):
                audio = MP4(filepath)
                duration = audio.info.length
            elif ext == '.ogg':
                audio = OggVorbis(filepath)
                duration = audio.info.length
            elif ext == '.flac':
                audio = FLAC(filepath)
                duration = audio.info.length
            elif ext == '.wav':
                audio = WAVE(filepath)
                duration = audio.info.length
            else:
                # Fallback para MutagenFile genérico
                audio = MutagenFile(filepath)
                if audio and audio.info:
                    duration = audio.info.length

            if duration > 0:
                print(f"Duração obtida: {filepath} = {duration:.1f}s")
            else:
                print(f"Duração não encontrada para: {filepath}")

            return duration

        except Exception as e:
            print(f"Erro ao obter duração de {filepath}: {type(e).__name__}: {e}")
            # Fallback: tentar com pygame.mixer.Sound (carrega arquivo na memória)
            try:
                sound = pygame.mixer.Sound(filepath)
                duration = sound.get_length()
                del sound  # Liberar memória
                if duration > 0:
                    print(f"Duração via pygame: {filepath} = {duration:.1f}s")
                    return duration
            except Exception as e2:
                print(f"Fallback pygame também falhou: {e2}")
            return 0.0

    def get_position(self) -> float:
        """Retorna a posição atual em segundos"""
        if not self.is_playing and not pygame.mixer.music.get_busy():
            return 0.0

        # pygame.mixer.music.get_pos() retorna em milissegundos
        pos_ms = pygame.mixer.music.get_pos()
        if pos_ms < 0:
            return 0.0

        return pos_ms / 1000.0

    def get_remaining(self) -> float:
        """Retorna o tempo restante em segundos"""
        if self.current_duration <= 0:
            return 0.0

        position = self.get_position()
        remaining = self.current_duration - position

        return max(0.0, remaining)

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
            # Obter duração antes de tocar
            self.current_duration = self._get_audio_duration(self.current_song)
            print(f"Tocando: {Path(self.current_song).name} | Duração: {self.current_duration:.1f}s")

            pygame.mixer.music.load(self.current_song)
            pygame.mixer.music.play()
            self.is_playing = True

            if self.on_song_change:
                self.on_song_change(Path(self.current_song).name)

            return True
        except Exception as e:
            print(f"Erro ao reproduzir: {e}")
            self.current_duration = 0.0
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

    def set_next_song(self, song_path: str, is_ad: bool = False):
        """Define a próxima música a ser tocada"""
        self.next_song_override = song_path
        self._next_is_ad = is_ad

    def is_music_playing(self) -> bool:
        """Verifica se há música tocando"""
        return pygame.mixer.music.get_busy()

    def _monitor_loop(self):
        """Loop de monitoramento para detectar fim de música"""
        while self._running:
            if self.is_playing and not self.is_music_playing():
                # Música terminou
                # Primeiro notifica o scheduler (que pode inserir propaganda como próxima)
                if self.on_song_end:
                    self.on_song_end()

                # Agora toca a próxima (será propaganda se scheduler definiu, ou música aleatória)
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
        position = self.get_position()
        duration = self.current_duration
        remaining = self.get_remaining()

        return {
            "current_song": Path(self.current_song).name if self.current_song else None,
            "is_playing": self.is_playing,
            "volume": self.volume,
            "playlist_count": len(self.playlist),
            "position": position,
            "duration": duration,
            "remaining": remaining
        }

    def cleanup(self):
        """Limpa recursos"""
        self.stop_monitoring()
        self.stop()
        pygame.mixer.quit()
