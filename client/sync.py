"""
Sincronização de músicas com o servidor
"""

import os
import hashlib
import threading
import time
from pathlib import Path
from typing import Callable, Optional

import requests


class MusicSync:
    def __init__(self, server_url: str, music_folder: str, sync_interval: int = 60):
        self.server_url = server_url.rstrip('/')
        self.music_folder = Path(music_folder)
        self.music_folder.mkdir(exist_ok=True)
        self.sync_interval = sync_interval

        # Mapeamento de ID para arquivo local
        self.id_to_file: dict[str, str] = {}

        # Callbacks
        self.on_sync_complete: Optional[Callable[[int, int], None]] = None
        self.on_sync_error: Optional[Callable[[str], None]] = None

        # Thread de sincronização
        self._sync_thread: Optional[threading.Thread] = None
        self._running: bool = False

    def get_server_music_list(self) -> list[dict]:
        """Obtém lista de músicas do servidor"""
        try:
            response = requests.get(f"{self.server_url}/api/music/list", timeout=30)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            if self.on_sync_error:
                self.on_sync_error(f"Erro ao obter lista: {e}")
            return []

    def get_local_files(self) -> set[str]:
        """Obtém lista de arquivos locais"""
        extensions = {'.mp3', '.wav', '.ogg', '.flac', '.m4a'}
        files = set()

        if self.music_folder.exists():
            for file in self.music_folder.iterdir():
                if file.suffix.lower() in extensions:
                    files.add(file.name)

        return files

    def download_music(self, music_id: str, filename: str) -> bool:
        """Baixa uma música do servidor"""
        try:
            response = requests.get(
                f"{self.server_url}/api/music/download/{music_id}",
                timeout=300,
                stream=True
            )
            response.raise_for_status()

            # Salvar arquivo
            filepath = self.music_folder / filename
            with open(filepath, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)

            # Atualizar mapeamento
            self.id_to_file[music_id] = str(filepath)

            return True
        except Exception as e:
            if self.on_sync_error:
                self.on_sync_error(f"Erro ao baixar {filename}: {e}")
            return False

    def sync(self) -> tuple[int, int]:
        """Sincroniza músicas com o servidor"""
        downloaded = 0
        deleted = 0

        # Obter lista do servidor
        server_music = self.get_server_music_list()
        server_files = {m['original_name']: m for m in server_music}

        # Obter arquivos locais
        local_files = self.get_local_files()

        # Baixar músicas novas
        for filename, music_info in server_files.items():
            if filename not in local_files:
                if self.download_music(music_info['id'], filename):
                    downloaded += 1

            # Atualizar mapeamento mesmo se já existe
            filepath = self.music_folder / filename
            if filepath.exists():
                self.id_to_file[music_info['id']] = str(filepath)

        # Remover músicas que não existem mais no servidor
        for filename in local_files:
            if filename not in server_files:
                filepath = self.music_folder / filename
                try:
                    filepath.unlink()
                    deleted += 1
                except:
                    pass

        if self.on_sync_complete:
            self.on_sync_complete(downloaded, deleted)

        return downloaded, deleted

    def get_file_by_id(self, music_id: str) -> Optional[str]:
        """Obtém caminho do arquivo pelo ID"""
        return self.id_to_file.get(music_id)

    def _sync_loop(self):
        """Loop de sincronização periódica"""
        while self._running:
            self.sync()
            time.sleep(self.sync_interval)

    def start_sync(self):
        """Inicia sincronização periódica"""
        if self._sync_thread and self._sync_thread.is_alive():
            return

        self._running = True
        self._sync_thread = threading.Thread(target=self._sync_loop, daemon=True)
        self._sync_thread.start()

    def stop_sync(self):
        """Para sincronização"""
        self._running = False
        if self._sync_thread:
            self._sync_thread.join(timeout=1)
