"""Configurações do cliente"""

import json
from pathlib import Path

# URL do servidor padrão
DEFAULT_SERVER_URL = "https://falavipmusic.viptecnologia.com.br"

def load_settings():
    """Carrega configurações do arquivo settings.json"""
    settings_path = Path("settings.json")
    if settings_path.exists():
        try:
            with open(settings_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Erro ao carregar settings.json: {e}")
    return {}

def save_settings(settings):
    """Salva configurações no arquivo settings.json"""
    try:
        with open("settings.json", 'w', encoding='utf-8') as f:
            json.dump(settings, f, indent=2)
        return True
    except Exception as e:
        print(f"Erro ao salvar settings.json: {e}")
        return False

_settings = load_settings()

# URL do servidor
SERVER_URL = _settings.get('server_url', DEFAULT_SERVER_URL)
# Remover barra final se existir
if SERVER_URL.endswith('/'):
    SERVER_URL = SERVER_URL[:-1]
    
WEBSOCKET_URL = SERVER_URL

# Pasta local para músicas
MUSIC_FOLDER = "music"

# Intervalo de sincronização (em segundos)
SYNC_INTERVAL = 60

# Volume padrão (0.0 a 1.0)
DEFAULT_VOLUME = 0.5
