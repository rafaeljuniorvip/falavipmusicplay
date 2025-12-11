"""
Sincronização de músicas com o servidor
"""

import os
import json
import hashlib
import threading
import time
from pathlib import Path
from typing import Callable, Optional

import requests

# Arquivos de cache para operação offline
CACHE_FILE = "schedule_cache.json"
MUSIC_CACHE_FILE = "music_cache.json"


class MusicSync:
    def __init__(self, server_url: str, music_folder: str, sync_interval: int = 60):
        self.server_url = server_url.rstrip('/')
        self.music_folder = Path(music_folder)
        self.music_folder.mkdir(exist_ok=True)
        self.sync_interval = sync_interval

        # Mapeamento de ID para arquivo local
        self.id_to_file: dict[str, str] = {}

        # Conjunto de arquivos que são propagandas (não devem entrar na playlist)
        self.ad_files: set[str] = set()

        # Cache de schedules para offline
        self.cache_path = self.music_folder.parent / CACHE_FILE
        self.music_cache_path = self.music_folder.parent / MUSIC_CACHE_FILE
        self.cached_schedules: dict = {}
        self.is_offline: bool = False
        self._load_cache()
        self._load_music_cache()

        # Callbacks
        self.on_sync_complete: Optional[Callable[[int, int], None]] = None
        self.on_sync_error: Optional[Callable[[str], None]] = None
        self.on_schedules_updated: Optional[Callable[[dict], None]] = None

        # Thread de sincronização
        self._sync_thread: Optional[threading.Thread] = None
        self._running: bool = False

    def _load_cache(self):
        """Carrega cache de schedules do arquivo local"""
        try:
            if self.cache_path.exists():
                with open(self.cache_path, 'r', encoding='utf-8') as f:
                    self.cached_schedules = json.load(f)
                print(f"Cache carregado: {len(self.cached_schedules)} itens")
        except Exception as e:
            print(f"Erro ao carregar cache: {e}")
            self.cached_schedules = {}

    def _save_cache(self, schedules: dict):
        """Salva schedules no cache local"""
        try:
            with open(self.cache_path, 'w', encoding='utf-8') as f:
                json.dump(schedules, f, indent=2, ensure_ascii=False)
            self.cached_schedules = schedules
            print("Cache de schedules atualizado")
        except Exception as e:
            print(f"Erro ao salvar cache: {e}")

    def _load_music_cache(self):
        """Carrega cache de músicas (mapeamento ID -> arquivo)"""
        try:
            if self.music_cache_path.exists():
                with open(self.music_cache_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.id_to_file = data.get('id_to_file', {})
                    self.ad_files = set(data.get('ad_files', []))
                print(f"Cache de músicas carregado: {len(self.id_to_file)} arquivos, {len(self.ad_files)} propagandas")
        except Exception as e:
            print(f"Erro ao carregar cache de músicas: {e}")

    def _save_music_cache(self):
        """Salva cache de músicas para operação offline"""
        try:
            data = {
                'id_to_file': self.id_to_file,
                'ad_files': list(self.ad_files)
            }
            with open(self.music_cache_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            print("Cache de músicas atualizado")
        except Exception as e:
            print(f"Erro ao salvar cache de músicas: {e}")

    def get_schedules(self) -> dict:
        """Obtém schedules do servidor ou do cache se offline"""
        try:
            response = requests.get(f"{self.server_url}/api/settings", timeout=10)
            response.raise_for_status()
            schedules = response.json()
            self._save_cache(schedules)  # Atualiza cache
            self.is_offline = False
            return schedules
        except Exception as e:
            print(f"Servidor inacessível, usando cache: {e}")
            self.is_offline = True
            return self.cached_schedules

    def sync_schedules(self) -> dict:
        """Sincroniza schedules e notifica via callback"""
        schedules = self.get_schedules()
        if schedules and self.on_schedules_updated:
            self.on_schedules_updated(schedules)
        return schedules

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

        # Se offline, usar cache de músicas
        if not server_music:
            self.is_offline = True
            print("Modo offline: usando cache de músicas")
            # Verificar arquivos locais e usar mapeamento do cache
            local_files = self.get_local_files()
            print(f"Modo offline: {len(local_files)} músicas locais, {len(self.id_to_file)} no cache")
            if self.on_sync_complete:
                self.on_sync_complete(0, 0)
            return 0, 0

        self.is_offline = False
        server_files = {m['original_name']: m for m in server_music}

        # Obter arquivos locais
        local_files = self.get_local_files()

        # Limpar lista de ads e reconstruir
        self.ad_files.clear()

        # Baixar músicas novas
        for filename, music_info in server_files.items():
            if filename not in local_files:
                if self.download_music(music_info['id'], filename):
                    downloaded += 1

            # Atualizar mapeamento mesmo se já existe
            filepath = self.music_folder / filename
            if filepath.exists():
                self.id_to_file[music_info['id']] = str(filepath)

                # Marcar se é propaganda
                if music_info.get('is_ad', False):
                    self.ad_files.add(str(filepath))

        # Remover músicas que não existem mais no servidor
        for filename in local_files:
            if filename not in server_files:
                filepath = self.music_folder / filename
                try:
                    filepath.unlink()
                    deleted += 1
                except:
                    pass

        # Salvar cache de músicas para operação offline
        self._save_music_cache()

        print(f"Sync completo: {len(self.id_to_file)} arquivos, {len(self.ad_files)} propagandas")

        if self.on_sync_complete:
            self.on_sync_complete(downloaded, deleted)

        return downloaded, deleted

    def get_file_by_id(self, music_id: str) -> Optional[str]:
        """Obtém caminho do arquivo pelo ID"""
        return self.id_to_file.get(music_id)

    def get_music_files(self) -> list[str]:
        """Retorna lista de arquivos de MÚSICA (exclui propagandas)"""
        all_files = []
        extensions = {'.mp3', '.wav', '.ogg', '.flac', '.m4a'}

        if self.music_folder.exists():
            for file in self.music_folder.iterdir():
                if file.suffix.lower() in extensions:
                    filepath = str(file)
                    # Só inclui se NÃO for propaganda
                    if filepath not in self.ad_files:
                        all_files.append(filepath)

        return all_files

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

    def get_next_from_server(self) -> Optional[dict]:
        """Obtém próxima música da playlist do servidor"""
        try:
            response = requests.get(f"{self.server_url}/api/playlist/next", timeout=5)
            if response.status_code == 200:
                data = response.json()
                if data and data.get('music_id'):
                    return data
            return None
        except Exception as e:
            print(f"Erro ao obter próxima música do servidor: {e}")
            return None

    def mark_song_played(self, position: int) -> bool:
        """Marca uma música como tocada no servidor"""
        try:
            response = requests.post(
                f"{self.server_url}/api/playlist/mark-played/{position}",
                timeout=5
            )
            return response.status_code == 200
        except Exception as e:
            print(f"Erro ao marcar música como tocada: {e}")
            return False

    def notify_skip(self) -> bool:
        """Notifica o servidor que uma música foi pulada"""
        try:
            response = requests.post(f"{self.server_url}/api/playlist/skip", timeout=5)
            return response.status_code == 200
        except Exception as e:
            print(f"Erro ao notificar skip: {e}")
            return False

    def send_log(self, log_type: str, description: str, details: str = None):
        """Envia um log de atividade para o servidor"""
        try:
            data = {
                "type": log_type,
                "description": description,
                "details": details
            }
            response = requests.post(
                f"{self.server_url}/api/logs",
                json=data,
                timeout=10
            )
            response.raise_for_status()  # Levanta exceção para códigos de erro HTTP
            result = response.json()
            if result.get('success'):
                print(f"Log enviado: [{log_type}] {description}")
                return True
            return False
        except requests.exceptions.ConnectionError:
            print(f"Erro de conexão ao enviar log - servidor inacessível")
            return False
        except requests.exceptions.Timeout:
            print(f"Timeout ao enviar log")
            return False
        except Exception as e:
            print(f"Erro ao enviar log: {type(e).__name__}: {e}")
            return False
