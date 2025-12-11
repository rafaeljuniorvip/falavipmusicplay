"""
FalaVIP Music Player - Servidor
FastAPI + WebSocket para controle remoto do player
"""

import os
import json
import uuid
import asyncio
import random
import aiosqlite
import httpx
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()  # Carrega variáveis do arquivo .env
from datetime import datetime, timedelta
from typing import Optional, Dict, List

from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Para extrair duração de áudio
try:
    from mutagen import File as MutagenFile
    from mutagen.mp3 import MP3
    from mutagen.mp4 import MP4
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False
    print("AVISO: mutagen não instalado - duração das músicas não será extraída")

# Diretórios
BASE_DIR = Path(__file__).parent
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", str(BASE_DIR / "storage")))
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
DB_PATH = DATA_DIR / "database.db"

# Garantir que os diretórios existam
STORAGE_DIR.mkdir(exist_ok=True, parents=True)
STATIC_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True, parents=True)

app = FastAPI(title="FalaVIP Music Player")

# CORS para permitir conexões do cliente
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gerenciador de conexões WebSocket
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.player_status = {
            "current_song": None,
            "is_playing": False,
            "volume": 0.5,
            "connected": False,
            "position": 0,
            "duration": 0,
            "remaining": 0
        }

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

    async def send_to_player(self, message: dict):
        """Envia mensagem para o player (primeira conexão)"""
        if self.active_connections:
            try:
                await self.active_connections[0].send_json(message)
            except:
                pass

manager = ConnectionManager()


# Função para extrair duração de áudio
def get_audio_duration(filepath: Path) -> float:
    """Extrai duração de um arquivo de áudio em segundos"""
    if not MUTAGEN_AVAILABLE:
        return 0.0

    try:
        ext = filepath.suffix.lower()
        if ext == '.mp3':
            audio = MP3(str(filepath))
            return audio.info.length
        elif ext in ('.m4a', '.mp4', '.aac'):
            audio = MP4(str(filepath))
            return audio.info.length
        else:
            # Fallback genérico
            audio = MutagenFile(str(filepath))
            if audio and audio.info:
                return audio.info.length
    except Exception as e:
        print(f"Erro ao extrair duração de {filepath}: {e}")

    return 0.0


# Modelos Pydantic
class VolumeUpdate(BaseModel):
    volume: float  # 0.0 a 1.0

class VolumeSchedule(BaseModel):
    time_start: str  # HH:MM
    time_end: str    # HH:MM
    volume: float  # Volume único (se não usar gradiente)
    volume_start: Optional[float] = None  # Volume inicial (gradiente)
    volume_end: Optional[float] = None    # Volume final (gradiente)
    is_gradient: bool = False             # Se True, usa gradiente entre volume_start e volume_end

class AdConfig(BaseModel):
    music_id: str
    interval_type: str = "minutes"  # "minutes" ou "songs"
    interval_value: int  # A cada X minutos ou X músicas
    enabled: bool = True

class HourlyVolumes(BaseModel):
    volumes: Dict[str, float]  # {"0": 0.5, "1": 0.5, ..., "23": 0.5}

class ScheduledSong(BaseModel):
    music_id: str
    time: str  # HH:MM
    repeat_daily: bool = True

class PlayNextSong(BaseModel):
    music_id: str


# Inicialização do banco de dados
async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        # Tabela de músicas
        await db.execute("""
            CREATE TABLE IF NOT EXISTS music (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                original_name TEXT NOT NULL,
                is_ad INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Tabela de configurações
        await db.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)

        # Tabela de agendamentos de volume
        await db.execute("""
            CREATE TABLE IF NOT EXISTS volume_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                time_start TEXT NOT NULL,
                time_end TEXT NOT NULL,
                volume REAL NOT NULL,
                volume_start REAL,
                volume_end REAL,
                is_gradient INTEGER DEFAULT 0
            )
        """)

        # Tabela de propagandas agendadas
        await db.execute("""
            CREATE TABLE IF NOT EXISTS ad_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                music_id TEXT NOT NULL,
                interval_minutes INTEGER DEFAULT 30,
                interval_type TEXT DEFAULT 'minutes',
                interval_value INTEGER DEFAULT 30,
                rotation_order INTEGER DEFAULT 0,
                enabled INTEGER DEFAULT 1,
                FOREIGN KEY (music_id) REFERENCES music(id)
            )
        """)

        # Migração: adicionar novas colunas se não existirem
        try:
            await db.execute("ALTER TABLE ad_schedules ADD COLUMN interval_type TEXT DEFAULT 'minutes'")
        except:
            pass
        try:
            await db.execute("ALTER TABLE ad_schedules ADD COLUMN interval_value INTEGER DEFAULT 30")
        except:
            pass
        try:
            await db.execute("ALTER TABLE ad_schedules ADD COLUMN rotation_order INTEGER DEFAULT 0")
        except:
            pass
        # Migração: adicionar duration à tabela music
        try:
            await db.execute("ALTER TABLE music ADD COLUMN duration REAL DEFAULT 0")
        except:
            pass

        # Migração: adicionar colunas de gradiente à tabela volume_schedules
        try:
            await db.execute("ALTER TABLE volume_schedules ADD COLUMN volume_start REAL")
        except:
            pass
        try:
            await db.execute("ALTER TABLE volume_schedules ADD COLUMN volume_end REAL")
        except:
            pass
        try:
            await db.execute("ALTER TABLE volume_schedules ADD COLUMN is_gradient INTEGER DEFAULT 0")
        except:
            pass

        # Tabela de volumes por hora (0-23)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS hourly_volumes (
                hour INTEGER PRIMARY KEY,
                volume REAL DEFAULT 0.5
            )
        """)

        # Inicializar volumes padrão para todas as 24 horas
        for hour in range(24):
            await db.execute(
                "INSERT OR IGNORE INTO hourly_volumes (hour, volume) VALUES (?, 0.5)",
                (hour,)
            )

        # Tabela de músicas agendadas
        await db.execute("""
            CREATE TABLE IF NOT EXISTS scheduled_songs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                music_id TEXT NOT NULL,
                scheduled_time TEXT NOT NULL,
                repeat_daily INTEGER DEFAULT 1,
                FOREIGN KEY (music_id) REFERENCES music(id)
            )
        """)

        # Tabela de logs de atividade
        await db.execute("""
            CREATE TABLE IF NOT EXISTS activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                type TEXT NOT NULL,
                description TEXT NOT NULL,
                details TEXT
            )
        """)

        # Tabela de playlist gerada
        await db.execute("""
            CREATE TABLE IF NOT EXISTS generated_playlist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                position INTEGER NOT NULL,
                music_id TEXT NOT NULL,
                music_name TEXT NOT NULL,
                duration REAL DEFAULT 0,
                scheduled_time TEXT NOT NULL,
                event_type TEXT DEFAULT 'music',
                played INTEGER DEFAULT 0,
                FOREIGN KEY (music_id) REFERENCES music(id)
            )
        """)

        # Tabela de metadados de música (classificação por IA)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS music_metadata (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                music_id TEXT NOT NULL UNIQUE,
                artist TEXT,
                title TEXT,
                album TEXT,
                genre TEXT,
                year TEXT,
                obs TEXT,
                raw_response TEXT,
                classified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (music_id) REFERENCES music(id)
            )
        """)

        # Configuração inicial de volume
        await db.execute("""
            INSERT OR IGNORE INTO settings (key, value) VALUES ('volume', '0.5')
        """)

        await db.commit()


@app.on_event("startup")
async def startup():
    await init_db()


# ============ ROTAS DE MÚSICA ============

@app.get("/api/music/list")
async def list_music():
    """Lista todas as músicas disponíveis"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM music ORDER BY created_at DESC") as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


@app.post("/api/music/upload")
async def upload_music(file: UploadFile = File(...), is_ad: str = "false"):
    """Upload de nova música"""
    # Converter is_ad de string para boolean (FormData envia como string)
    is_ad_bool = is_ad.lower() in ('true', '1', 'yes')

    # Gerar ID único
    music_id = str(uuid.uuid4())

    # Salvar arquivo
    ext = Path(file.filename).suffix
    filename = f"{music_id}{ext}"
    filepath = STORAGE_DIR / filename

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    # Extrair duração do áudio
    duration = get_audio_duration(filepath)
    print(f"Upload: {file.filename} | Duração: {duration:.1f}s")

    # Salvar no banco
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO music (id, filename, original_name, is_ad, duration) VALUES (?, ?, ?, ?, ?)",
            (music_id, filename, file.filename, 1 if is_ad_bool else 0, duration)
        )
        await db.commit()

    # Notificar clientes sobre nova música - incluir flag para regenerar playlist
    await manager.broadcast({
        "type": "music_added",
        "music_id": music_id,
        "filename": file.filename,
        "regenerate_playlist": True
    })

    return {"id": music_id, "filename": file.filename, "duration": duration}


@app.get("/api/music/download/{music_id}")
async def download_music(music_id: str):
    """Download de música específica"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM music WHERE id = ?", (music_id,)) as cursor:
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Música não encontrada")

            filepath = STORAGE_DIR / row["filename"]
            if not filepath.exists():
                raise HTTPException(status_code=404, detail="Arquivo não encontrado")

            return FileResponse(
                filepath,
                filename=row["original_name"],
                media_type="audio/mpeg"
            )


class MusicUpdate(BaseModel):
    is_ad: Optional[bool] = None


@app.patch("/api/music/{music_id}")
async def update_music(music_id: str, data: MusicUpdate):
    """Atualiza uma música"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM music WHERE id = ?", (music_id,)) as cursor:
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Música não encontrada")

        if data.is_ad is not None:
            await db.execute("UPDATE music SET is_ad = ? WHERE id = ?", (data.is_ad, music_id))
            await db.commit()

    # Notificar clientes
    await manager.broadcast({
        "type": "music_updated",
        "music_id": music_id
    })

    return {"success": True}


@app.delete("/api/music/{music_id}")
async def delete_music(music_id: str):
    """Remove uma música"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM music WHERE id = ?", (music_id,)) as cursor:
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Música não encontrada")

            # Deletar arquivo
            filepath = STORAGE_DIR / row["filename"]
            if filepath.exists():
                filepath.unlink()

            # Deletar do banco
            await db.execute("DELETE FROM music WHERE id = ?", (music_id,))
            await db.commit()

    # Notificar clientes - incluir flag para regenerar playlist
    await manager.broadcast({
        "type": "music_deleted",
        "music_id": music_id,
        "regenerate_playlist": True
    })

    return {"success": True}


# ============ ROTAS DE PLAYLIST ============

@app.post("/api/music/scan-durations")
async def scan_music_durations():
    """Escaneia todas as músicas e atualiza suas durações (migração)"""
    updated = 0
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT id, filename, duration FROM music") as cursor:
            rows = await cursor.fetchall()

        for row in rows:
            if row["duration"] == 0 or row["duration"] is None:
                filepath = STORAGE_DIR / row["filename"]
                if filepath.exists():
                    duration = get_audio_duration(filepath)
                    if duration > 0:
                        await db.execute(
                            "UPDATE music SET duration = ? WHERE id = ?",
                            (duration, row["id"])
                        )
                        updated += 1
                        print(f"Atualizado: {row['filename']} = {duration:.1f}s")

        await db.commit()

    return {"success": True, "updated": updated}


async def generate_playlist_internal(hours: int = 24, from_position: int = 0) -> List[dict]:
    """
    Gera playlist para as próximas X horas.
    Inclui músicas aleatórias, propagandas por tempo/músicas, e músicas agendadas.
    """
    now = datetime.now()
    end_time = now + timedelta(hours=hours)
    playlist = []
    position = from_position

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Obter todas as músicas (não propagandas) com duração
        async with db.execute(
            "SELECT id, original_name, duration FROM music WHERE is_ad = 0 AND duration > 0"
        ) as cursor:
            music_rows = await cursor.fetchall()
            music_list = [dict(row) for row in music_rows]

        if not music_list:
            return []

        # Embaralhar músicas
        random.shuffle(music_list)
        music_index = 0

        # Obter propagandas ativas
        async with db.execute(
            """SELECT as_.*, m.original_name, m.duration as ad_duration
               FROM ad_schedules as_
               JOIN music m ON as_.music_id = m.id
               WHERE as_.enabled = 1"""
        ) as cursor:
            ad_schedules = [dict(row) for row in await cursor.fetchall()]

        # Separar propagandas por tipo
        time_based_ads = [a for a in ad_schedules if a.get('interval_type', 'minutes') == 'minutes']
        song_based_ads = [a for a in ad_schedules if a.get('interval_type') == 'songs']

        # Obter músicas agendadas
        async with db.execute(
            """SELECT ss.*, m.original_name, m.duration
               FROM scheduled_songs ss
               JOIN music m ON ss.music_id = m.id"""
        ) as cursor:
            scheduled_songs = [dict(row) for row in await cursor.fetchall()]

        # Obter volumes por hora
        async with db.execute("SELECT hour, volume FROM hourly_volumes") as cursor:
            hourly_volumes = {row["hour"]: row["volume"] for row in await cursor.fetchall()}

    # Tracking de propagandas
    last_ad_time = {ad['id']: now for ad in time_based_ads}
    songs_since_last_ad = 0
    ad_rotation_index = 0

    current_time = now
    last_hour_added = -1

    while current_time < end_time:
        # Verificar mudança de volume por hora
        current_hour = current_time.hour
        if current_hour != last_hour_added and current_hour in hourly_volumes:
            # Adicionar evento de volume apenas na primeira passagem de cada hora
            if position == from_position or current_hour != now.hour:
                playlist.append({
                    "position": position,
                    "music_id": None,
                    "music_name": f"Volume ajustado para {int(hourly_volumes[current_hour] * 100)}%",
                    "duration": 0,
                    "scheduled_time": current_time.isoformat(),
                    "event_type": "volume"
                })
                position += 1
            last_hour_added = current_hour

        # Verificar música agendada para este horário
        current_time_str = current_time.strftime('%H:%M')
        scheduled_now = [s for s in scheduled_songs if s['scheduled_time'] == current_time_str]

        for scheduled in scheduled_now:
            playlist.append({
                "position": position,
                "music_id": scheduled['music_id'],
                "music_name": scheduled['original_name'],
                "duration": scheduled['duration'] or 180,
                "scheduled_time": current_time.isoformat(),
                "event_type": "scheduled_song"
            })
            position += 1
            current_time += timedelta(seconds=scheduled['duration'] or 180)
            continue

        # Verificar propaganda por tempo
        ad_to_play = None
        for ad in time_based_ads:
            interval_minutes = ad.get('interval_value') or ad.get('interval_minutes', 30)
            if (current_time - last_ad_time[ad['id']]).total_seconds() >= interval_minutes * 60:
                ad_to_play = ad
                last_ad_time[ad['id']] = current_time
                break

        # Verificar propaganda por número de músicas
        if not ad_to_play and song_based_ads:
            min_interval = min(a.get('interval_value', 5) for a in song_based_ads)
            if songs_since_last_ad >= min_interval:
                ad_to_play = song_based_ads[ad_rotation_index % len(song_based_ads)]
                ad_rotation_index += 1
                songs_since_last_ad = 0

        if ad_to_play:
            ad_duration = ad_to_play.get('ad_duration') or 30
            playlist.append({
                "position": position,
                "music_id": ad_to_play['music_id'],
                "music_name": ad_to_play['original_name'],
                "duration": ad_duration,
                "scheduled_time": current_time.isoformat(),
                "event_type": "ad"
            })
            position += 1
            current_time += timedelta(seconds=ad_duration)
            continue

        # Adicionar música aleatória
        if music_list:
            music = music_list[music_index % len(music_list)]
            music_index += 1

            playlist.append({
                "position": position,
                "music_id": music['id'],
                "music_name": music['original_name'],
                "duration": music['duration'],
                "scheduled_time": current_time.isoformat(),
                "event_type": "music"
            })
            position += 1
            current_time += timedelta(seconds=music['duration'])
            songs_since_last_ad += 1
        else:
            # Sem músicas, avançar 1 minuto
            current_time += timedelta(minutes=1)

    return playlist


@app.post("/api/playlist/generate")
async def generate_playlist(hours: int = 24):
    """Gera uma nova playlist para as próximas X horas"""
    playlist = await generate_playlist_internal(hours)

    # Salvar no banco
    async with aiosqlite.connect(DB_PATH) as db:
        # Limpar playlist anterior
        await db.execute("DELETE FROM generated_playlist")

        # Inserir nova playlist
        for item in playlist:
            await db.execute(
                """INSERT INTO generated_playlist
                   (position, music_id, music_name, duration, scheduled_time, event_type, played)
                   VALUES (?, ?, ?, ?, ?, ?, 0)""",
                (item['position'], item['music_id'] or '', item['music_name'],
                 item['duration'], item['scheduled_time'], item['event_type'])
            )

        await db.commit()

    # Notificar clientes
    await manager.broadcast({
        "type": "playlist_generated",
        "count": len(playlist)
    })

    return {"success": True, "count": len(playlist), "playlist": playlist[:50]}


@app.get("/api/playlist")
async def get_playlist(limit: int = 100, include_played: bool = False):
    """Obtém a playlist gerada"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        if include_played:
            query = "SELECT * FROM generated_playlist ORDER BY position LIMIT ?"
            params = (limit,)
        else:
            query = "SELECT * FROM generated_playlist WHERE played = 0 ORDER BY position LIMIT ?"
            params = (limit,)

        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


@app.post("/api/playlist/mark-played/{position}")
async def mark_song_played(position: int):
    """Marca uma música como tocada"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE generated_playlist SET played = 1 WHERE position <= ?",
            (position,)
        )
        await db.commit()

    return {"success": True}


@app.post("/api/playlist/skip")
async def skip_and_regenerate():
    """Pula a música atual e toca a próxima (sem regenerar imediatamente)"""
    skipped_song = None
    next_song = None
    next_position = 1

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Encontrar primeira música não tocada (atual)
        async with db.execute(
            "SELECT position, music_name FROM generated_playlist WHERE played = 0 ORDER BY position LIMIT 1"
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                current_pos = row['position']
                skipped_song = row['music_name']
                next_position = current_pos + 1

                # Marcar como tocada/pulada
                await db.execute(
                    "UPDATE generated_playlist SET played = 1 WHERE position = ?",
                    (current_pos,)
                )
                await db.commit()

        # Verificar qual é a próxima música (pode ser a inserida manualmente)
        async with db.execute(
            "SELECT position, music_name FROM generated_playlist WHERE played = 0 ORDER BY position LIMIT 1"
        ) as cursor:
            next_row = await cursor.fetchone()
            if next_row:
                next_song = next_row['music_name']

        # Contar quantas músicas restam na playlist
        async with db.execute(
            "SELECT COUNT(*) as remaining FROM generated_playlist WHERE played = 0"
        ) as cursor:
            count_row = await cursor.fetchone()
            remaining = count_row['remaining'] if count_row else 0

    # Só regenerar se restam poucas músicas (menos de 10)
    if remaining < 10:
        # Encontrar a última posição da playlist
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT MAX(position) as max_pos FROM generated_playlist"
            ) as cursor:
                max_row = await cursor.fetchone()
                last_position = max_row['max_pos'] if max_row and max_row['max_pos'] else 0

        # Gerar mais músicas a partir da última posição
        new_playlist = await generate_playlist_internal(hours=24, from_position=last_position + 1)

        # Inserir nova playlist no banco
        async with aiosqlite.connect(DB_PATH) as db:
            for item in new_playlist:
                await db.execute(
                    """INSERT INTO generated_playlist
                       (position, music_id, music_name, duration, scheduled_time, event_type, played)
                       VALUES (?, ?, ?, ?, ?, ?, 0)""",
                    (item['position'], item['music_id'] or '', item['music_name'],
                     item['duration'], item['scheduled_time'], item['event_type'])
                )
            await db.commit()

    # Notificar clientes
    await manager.broadcast({
        "type": "playlist_updated",
        "action": "skip",
        "skipped_song": skipped_song,
        "next_song": next_song,
        "message": f"Música pulada: {skipped_song}"
    })

    return {
        "success": True,
        "skipped_song": skipped_song,
        "next_song": next_song,
        "next_position": next_position
    }


@app.get("/api/playlist/next")
async def get_next_song():
    """Obtém a próxima música a tocar"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT * FROM generated_playlist
               WHERE played = 0 AND event_type IN ('music', 'ad', 'scheduled_song')
               ORDER BY position LIMIT 1"""
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return dict(row)
            return None


class InsertSongRequest(BaseModel):
    music_id: str


@app.post("/api/playlist/insert-next")
async def insert_song_next(data: InsertSongRequest):
    """
    Insere uma música para tocar logo após a atual.
    Preserva a playlist existente, apenas insere no meio.
    """
    music_id = data.music_id

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Verificar se a música existe
        async with db.execute(
            "SELECT id, original_name, duration FROM music WHERE id = ?", (music_id,)
        ) as cursor:
            music = await cursor.fetchone()
            if not music:
                raise HTTPException(status_code=404, detail="Música não encontrada")

        # Encontrar a posição atual (primeira não tocada)
        async with db.execute(
            "SELECT position, scheduled_time, duration FROM generated_playlist WHERE played = 0 ORDER BY position LIMIT 1"
        ) as cursor:
            current = await cursor.fetchone()

        if not current:
            # Se não há playlist, gerar uma nova com a música no início
            await generate_playlist(hours=24)
            # Buscar a nova posição
            async with db.execute(
                "SELECT MAX(position) as max_pos FROM generated_playlist"
            ) as cursor:
                max_row = await cursor.fetchone()
                insert_position = (max_row['max_pos'] or 0) + 1

            insert_time = datetime.now()
        else:
            current_position = current['position']
            current_duration = current['duration'] or 180

            # Calcular o horário para a música inserida
            try:
                current_time = datetime.fromisoformat(current['scheduled_time'])
            except:
                current_time = datetime.now()

            insert_time = current_time + timedelta(seconds=current_duration)
            insert_position = current_position + 1

            # Deslocar todas as posições futuras para abrir espaço
            await db.execute(
                "UPDATE generated_playlist SET position = position + 1 WHERE position >= ? AND played = 0",
                (insert_position,)
            )

        # Inserir a música solicitada na posição
        await db.execute(
            """INSERT INTO generated_playlist
               (position, music_id, music_name, duration, scheduled_time, event_type, played)
               VALUES (?, ?, ?, ?, ?, 'music', 0)""",
            (insert_position, music_id, music['original_name'],
             music['duration'] or 180, insert_time.isoformat())
        )

        await db.commit()

    # Notificar clientes
    await manager.broadcast({
        "type": "playlist_updated",
        "inserted_song": music['original_name'],
        "message": f"Música '{music['original_name']}' inserida como próxima"
    })

    return {
        "success": True,
        "inserted": {
            "music_id": music_id,
            "music_name": music['original_name'],
            "position": insert_position,
            "scheduled_time": insert_time.isoformat()
        }
    }


# ============ ROTAS DE CONFIGURAÇÕES ============

@app.get("/api/settings")
async def get_settings():
    """Obter todas as configurações"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Volume atual
        async with db.execute("SELECT value FROM settings WHERE key = 'volume'") as cursor:
            row = await cursor.fetchone()
            volume = float(row["value"]) if row else 0.5

        # Agendamentos de volume
        async with db.execute("SELECT * FROM volume_schedules") as cursor:
            volume_schedules = [dict(row) for row in await cursor.fetchall()]

        # Propagandas agendadas
        async with db.execute("""
            SELECT a.*, m.original_name
            FROM ad_schedules a
            JOIN music m ON a.music_id = m.id
        """) as cursor:
            ad_schedules = [dict(row) for row in await cursor.fetchall()]

        # Músicas agendadas
        async with db.execute("""
            SELECT s.*, m.original_name
            FROM scheduled_songs s
            JOIN music m ON s.music_id = m.id
        """) as cursor:
            scheduled_songs = [dict(row) for row in await cursor.fetchall()]

        # Volumes por hora
        async with db.execute("SELECT hour, volume FROM hourly_volumes ORDER BY hour") as cursor:
            rows = await cursor.fetchall()
            hourly_volumes = {str(row['hour']): row['volume'] for row in rows}

        # Garantir que todas as 24 horas estejam presentes
        for h in range(24):
            if str(h) not in hourly_volumes:
                hourly_volumes[str(h)] = 0.5

        return {
            "volume": volume,
            "volume_schedules": volume_schedules,
            "ad_schedules": ad_schedules,
            "scheduled_songs": scheduled_songs,
            "hourly_volumes": hourly_volumes,
            "player_status": manager.player_status
        }


@app.post("/api/settings/volume")
async def set_volume(data: VolumeUpdate):
    """Definir volume"""
    volume = max(0.0, min(1.0, data.volume))

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE settings SET value = ? WHERE key = 'volume'",
            (str(volume),)
        )
        await db.commit()

    # Enviar para o player
    await manager.broadcast({
        "type": "volume_change",
        "volume": volume
    })

    # Log de volume manual
    await log_activity("volume_manual", f"Volume ajustado para {int(volume * 100)}%")

    return {"success": True, "volume": volume}


@app.post("/api/settings/volume-schedule")
async def add_volume_schedule(data: VolumeSchedule):
    """Adicionar agendamento de volume (com suporte a gradiente)"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """INSERT INTO volume_schedules
               (time_start, time_end, volume, volume_start, volume_end, is_gradient)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (data.time_start, data.time_end, data.volume,
             data.volume_start, data.volume_end, 1 if data.is_gradient else 0)
        )
        await db.commit()
        schedule_id = cursor.lastrowid

    await broadcast_schedules()
    return {"success": True, "id": schedule_id}


@app.delete("/api/settings/volume-schedule/{schedule_id}")
async def delete_volume_schedule(schedule_id: int):
    """Remover agendamento de volume"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM volume_schedules WHERE id = ?", (schedule_id,))
        await db.commit()

    await broadcast_schedules()
    return {"success": True}


@app.put("/api/settings/volume-schedule/{schedule_id}")
async def update_volume_schedule(schedule_id: int, data: VolumeSchedule):
    """Atualizar agendamento de volume (com suporte a gradiente)"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """UPDATE volume_schedules
               SET time_start = ?, time_end = ?, volume = ?,
                   volume_start = ?, volume_end = ?, is_gradient = ?
               WHERE id = ?""",
            (data.time_start, data.time_end, data.volume,
             data.volume_start, data.volume_end, 1 if data.is_gradient else 0, schedule_id)
        )
        await db.commit()

    await broadcast_schedules()
    return {"success": True, "id": schedule_id}


@app.post("/api/settings/ad-schedule")
async def add_ad_schedule(data: AdConfig):
    """Adicionar propaganda agendada"""
    async with aiosqlite.connect(DB_PATH) as db:
        # Obter próxima ordem de rotação
        async with db.execute("SELECT COALESCE(MAX(rotation_order), 0) + 1 FROM ad_schedules") as cursor:
            row = await cursor.fetchone()
            next_order = row[0] if row else 1

        cursor = await db.execute(
            """INSERT INTO ad_schedules
               (music_id, interval_type, interval_value, interval_minutes, rotation_order, enabled)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (data.music_id, data.interval_type, data.interval_value, data.interval_value, next_order, 1 if data.enabled else 0)
        )
        await db.commit()
        schedule_id = cursor.lastrowid

    # Broadcast com dados completos
    await broadcast_schedules()

    return {"success": True, "id": schedule_id}


@app.delete("/api/settings/ad-schedule/{schedule_id}")
async def delete_ad_schedule(schedule_id: int):
    """Remover propaganda agendada"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM ad_schedules WHERE id = ?", (schedule_id,))
        await db.commit()

    await broadcast_schedules()
    return {"success": True}


@app.post("/api/settings/ad-schedule/{schedule_id}/toggle")
async def toggle_ad_schedule(schedule_id: int):
    """Ativar/desativar propaganda"""
    async with aiosqlite.connect(DB_PATH) as db:
        # Inverter o estado atual
        await db.execute(
            "UPDATE ad_schedules SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?",
            (schedule_id,)
        )
        await db.commit()

    await broadcast_schedules()
    return {"success": True}


@app.put("/api/settings/ad-schedule/{schedule_id}")
async def update_ad_schedule(schedule_id: int, data: AdConfig):
    """Atualizar propaganda agendada"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """UPDATE ad_schedules
               SET music_id = ?, interval_type = ?, interval_value = ?, interval_minutes = ?, enabled = ?
               WHERE id = ?""",
            (data.music_id, data.interval_type, data.interval_value, data.interval_value, 1 if data.enabled else 0, schedule_id)
        )
        await db.commit()

    await broadcast_schedules()
    return {"success": True, "id": schedule_id}


@app.post("/api/settings/scheduled-song")
async def add_scheduled_song(data: ScheduledSong):
    """Adicionar música agendada para horário específico"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO scheduled_songs (music_id, scheduled_time, repeat_daily) VALUES (?, ?, ?)",
            (data.music_id, data.time, 1 if data.repeat_daily else 0)
        )
        await db.commit()
        schedule_id = cursor.lastrowid

    await broadcast_schedules()
    return {"success": True, "id": schedule_id}


@app.delete("/api/settings/scheduled-song/{schedule_id}")
async def delete_scheduled_song(schedule_id: int):
    """Remover música agendada"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM scheduled_songs WHERE id = ?", (schedule_id,))
        await db.commit()

    await broadcast_schedules()
    return {"success": True}


# ============ VOLUMES POR HORA ============

@app.get("/api/settings/hourly-volumes")
async def get_hourly_volumes():
    """Obter volumes de todas as 24 horas"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT hour, volume FROM hourly_volumes ORDER BY hour") as cursor:
            rows = await cursor.fetchall()
            volumes = {str(row['hour']): row['volume'] for row in rows}

        # Garantir todas as 24 horas
        for h in range(24):
            if str(h) not in volumes:
                volumes[str(h)] = 0.5

        return {"hourly_volumes": volumes}


@app.post("/api/settings/hourly-volumes")
async def set_hourly_volumes(data: HourlyVolumes):
    """Definir volumes para cada hora (0-23)"""
    async with aiosqlite.connect(DB_PATH) as db:
        for hour_str, volume in data.volumes.items():
            hour = int(hour_str)
            if 0 <= hour <= 23:
                vol = max(0.0, min(1.0, volume))
                await db.execute(
                    "INSERT OR REPLACE INTO hourly_volumes (hour, volume) VALUES (?, ?)",
                    (hour, vol)
                )
        await db.commit()

    # Broadcast com dados completos
    await broadcast_schedules()

    return {"success": True}


# ============ PREVIEW DE AGENDAMENTO ============

@app.get("/api/schedules/preview")
async def get_schedule_preview(hours: int = 6, avg_song_duration: int = 4, use_generated: bool = True):
    """
    Gera preview completo do agendamento.
    - Se use_generated=True e playlist existe, usa playlist gerada (mais preciso)
    - Senão, simula com duração média
    """
    # Tentar usar playlist gerada se disponível
    if use_generated:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM generated_playlist ORDER BY position LIMIT 500"
            ) as cursor:
                rows = await cursor.fetchall()

            if rows and len(rows) > 10:
                # Usar playlist gerada
                events = []
                for row in rows:
                    event_type = row['event_type']
                    # Mapear tipos para o formato esperado pelo frontend
                    if event_type == 'music':
                        event_type = 'random_music'

                    events.append({
                        "time": row['scheduled_time'],
                        "type": event_type,
                        "subtype": "generated",
                        "description": row['music_name'],
                        "music_id": row['music_id'] if row['music_id'] else None,
                        "duration": row['duration'],
                        "played": row['played'] == 1,
                        "position": row['position']
                    })

                now = datetime.now()
                stats = {
                    "random_music": len([e for e in events if e['type'] == 'random_music']),
                    "ads": len([e for e in events if e['type'] == 'ad']),
                    "scheduled_songs": len([e for e in events if e['type'] == 'scheduled_song']),
                    "volume_changes": len([e for e in events if e['type'] == 'volume']),
                    "total_items": len(events),
                    "source": "generated_playlist"
                }

                return {
                    "start": now.isoformat(),
                    "end": (now + timedelta(hours=hours)).isoformat(),
                    "hours": hours,
                    "events": events,
                    "stats": stats,
                    "generated": True
                }
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Volumes por hora
        async with db.execute("SELECT hour, volume FROM hourly_volumes") as cursor:
            hourly_volumes = {row['hour']: row['volume'] for row in await cursor.fetchall()}

        # Propagandas por tempo (minutos)
        async with db.execute("""
            SELECT a.*, m.original_name
            FROM ad_schedules a
            JOIN music m ON a.music_id = m.id
            WHERE a.enabled = 1 AND (a.interval_type = 'minutes' OR a.interval_type IS NULL)
            ORDER BY a.rotation_order
        """) as cursor:
            time_ads = [dict(row) for row in await cursor.fetchall()]

        # Propagandas por músicas
        async with db.execute("""
            SELECT a.*, m.original_name
            FROM ad_schedules a
            JOIN music m ON a.music_id = m.id
            WHERE a.enabled = 1 AND a.interval_type = 'songs'
            ORDER BY a.rotation_order
        """) as cursor:
            song_ads = [dict(row) for row in await cursor.fetchall()]

        # Músicas agendadas (horário fixo)
        async with db.execute("""
            SELECT s.*, m.original_name
            FROM scheduled_songs s
            JOIN music m ON s.music_id = m.id
        """) as cursor:
            scheduled_songs = [dict(row) for row in await cursor.fetchall()]

        # Total de músicas disponíveis (não propagandas)
        async with db.execute("SELECT COUNT(*) FROM music WHERE is_ad = 0") as cursor:
            row = await cursor.fetchone()
            total_music_count = row[0] if row else 0

    now = datetime.now()
    end_time = now + timedelta(hours=hours)
    events = []

    # Pré-calcular músicas agendadas para o período
    scheduled_times = set()
    for song in scheduled_songs:
        try:
            song_hour, song_minute = map(int, song['scheduled_time'].split(':'))
            for day_offset in range((hours // 24) + 2):
                event_time = now.replace(hour=song_hour, minute=song_minute, second=0, microsecond=0)
                event_time += timedelta(days=day_offset)
                if now <= event_time <= end_time:
                    scheduled_times.add(event_time)
                    events.append({
                        "time": event_time.isoformat(),
                        "type": "scheduled_song",
                        "subtype": "fixed",
                        "description": song['original_name'],
                        "music_id": song['music_id']
                    })
        except:
            pass

    # Simular sequência de reprodução
    current_time = now
    song_counter = 0  # Contador de músicas para ads por quantidade
    song_ad_rotation_index = 0  # Índice de rotação para ads por músicas
    random_song_counter = 0

    # Para ads por tempo: próximo momento que cada ad deve tocar
    # Começa após o intervalo inicial
    next_time_ad = {}
    for ad in time_ads:
        interval = ad.get('interval_value') or ad.get('interval_minutes', 30)
        next_time_ad[ad['id']] = now + timedelta(minutes=interval)

    # Eventos de mudança de volume por hora
    volume_events = []
    current_volume = hourly_volumes.get(now.hour, 0.5)
    for h in range(hours + 1):
        event_time = now + timedelta(hours=h)
        hour = event_time.hour
        volume = hourly_volumes.get(hour, 0.5)

        if h == 0 or volume != current_volume:
            volume_events.append({
                "time": event_time.replace(minute=0, second=0, microsecond=0).isoformat(),
                "hour": hour,
                "type": "volume",
                "subtype": "hourly",
                "description": f"Volume ajustado para {int(volume * 100)}%",
                "volume": volume
            })
            current_volume = volume

    events.extend(volume_events)

    # Simular reprodução
    while current_time < end_time:
        # Verificar se há música agendada neste momento (com tolerância de 1 minuto)
        scheduled_now = None
        for song in scheduled_songs:
            try:
                song_hour, song_minute = map(int, song['scheduled_time'].split(':'))
                for day_offset in range((hours // 24) + 2):
                    scheduled_time = now.replace(hour=song_hour, minute=song_minute, second=0, microsecond=0)
                    scheduled_time += timedelta(days=day_offset)
                    if abs((current_time - scheduled_time).total_seconds()) < 60:
                        scheduled_now = song
                        break
            except:
                pass
            if scheduled_now:
                break

        if scheduled_now:
            # Música agendada - já foi adicionada acima, só avança o tempo
            current_time += timedelta(minutes=avg_song_duration)
            continue

        # Verificar se é hora de propaganda por tempo
        ad_to_play = None
        if time_ads:
            for ad in time_ads:
                scheduled_ad_time = next_time_ad.get(ad['id'])
                if scheduled_ad_time and current_time >= scheduled_ad_time:
                    ad_to_play = ad
                    # Agendar próxima execução
                    interval = ad.get('interval_value') or ad.get('interval_minutes', 30)
                    next_time_ad[ad['id']] = current_time + timedelta(minutes=interval)
                    break

        # Verificar se é hora de propaganda por músicas
        song_ad_to_play = None
        if song_ads and song_counter > 0:
            for ad in song_ads:
                interval = ad.get('interval_value', 5)
                if song_counter % interval == 0:
                    song_ad_to_play = song_ads[song_ad_rotation_index % len(song_ads)]
                    song_ad_rotation_index += 1
                    break

        if ad_to_play:
            # Propaganda por tempo
            events.append({
                "time": current_time.isoformat(),
                "type": "ad",
                "subtype": "time",
                "description": ad_to_play['original_name'],
                "music_id": ad_to_play['music_id'],
                "interval": f"A cada {ad_to_play.get('interval_value', 30)} min"
            })
            current_time += timedelta(minutes=2)  # Propagandas são mais curtas
        elif song_ad_to_play:
            # Propaganda por músicas
            events.append({
                "time": current_time.isoformat(),
                "type": "ad",
                "subtype": "songs",
                "description": song_ad_to_play['original_name'],
                "music_id": song_ad_to_play['music_id'],
                "interval": f"A cada {song_ad_to_play.get('interval_value', 5)} músicas"
            })
            current_time += timedelta(minutes=2)
        else:
            # Música aleatória
            random_song_counter += 1
            events.append({
                "time": current_time.isoformat(),
                "type": "random_music",
                "subtype": "random",
                "description": f"Música Aleatória #{random_song_counter}",
                "placeholder": True
            })
            song_counter += 1
            current_time += timedelta(minutes=avg_song_duration)

    # Ordenar por tempo
    events.sort(key=lambda x: x['time'])

    # Estatísticas
    stats = {
        "random_music": len([e for e in events if e['type'] == 'random_music']),
        "ads": len([e for e in events if e['type'] == 'ad']),
        "scheduled_songs": len([e for e in events if e['type'] == 'scheduled_song']),
        "volume_changes": len([e for e in events if e['type'] == 'volume']),
        "total_music_available": total_music_count
    }

    # Debug info
    debug = {
        "time_ads_count": len(time_ads),
        "song_ads_count": len(song_ads),
        "time_ads_intervals": [
            {
                "name": ad.get('original_name'),
                "interval_type": ad.get('interval_type'),
                "interval_value": ad.get('interval_value'),
                "interval_minutes": ad.get('interval_minutes')
            }
            for ad in time_ads
        ],
        "song_ads_intervals": [
            {
                "name": ad.get('original_name'),
                "interval_type": ad.get('interval_type'),
                "interval_value": ad.get('interval_value')
            }
            for ad in song_ads
        ]
    }

    return {
        "start": now.isoformat(),
        "end": end_time.isoformat(),
        "hours": hours,
        "avg_song_duration": avg_song_duration,
        "events": events,
        "stats": stats,
        "debug": debug
    }


# ============ LOGS DE ATIVIDADE ============

class LogEntry(BaseModel):
    type: str  # "music", "ad", "volume_manual", "volume_scheduled"
    description: str
    details: Optional[str] = None


@app.get("/api/logs")
async def get_logs(
    type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
):
    """Lista logs de atividade com filtros opcionais"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        if type:
            query = """
                SELECT * FROM activity_logs
                WHERE type = ?
                ORDER BY timestamp DESC
                LIMIT ? OFFSET ?
            """
            params = (type, limit, offset)
        else:
            query = """
                SELECT * FROM activity_logs
                ORDER BY timestamp DESC
                LIMIT ? OFFSET ?
            """
            params = (limit, offset)

        async with db.execute(query, params) as cursor:
            logs = [dict(row) for row in await cursor.fetchall()]

        # Contar total
        if type:
            count_query = "SELECT COUNT(*) FROM activity_logs WHERE type = ?"
            count_params = (type,)
        else:
            count_query = "SELECT COUNT(*) FROM activity_logs"
            count_params = ()

        async with db.execute(count_query, count_params) as cursor:
            row = await cursor.fetchone()
            total = row[0] if row else 0

        return {
            "logs": logs,
            "total": total,
            "limit": limit,
            "offset": offset
        }


@app.post("/api/logs")
async def create_log(data: LogEntry):
    """Cria um novo registro de log"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """INSERT INTO activity_logs (type, description, details)
               VALUES (?, ?, ?)""",
            (data.type, data.description, data.details)
        )
        await db.commit()
        log_id = cursor.lastrowid

    return {"success": True, "id": log_id}


@app.delete("/api/logs")
async def clear_logs(before_days: int = 30):
    """Limpa logs mais antigos que X dias"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """DELETE FROM activity_logs
               WHERE timestamp < datetime('now', ?)""",
            (f'-{before_days} days',)
        )
        await db.commit()

    return {"success": True}


async def log_activity(log_type: str, description: str, details: str = None):
    """Helper para criar logs internamente"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO activity_logs (type, description, details)
               VALUES (?, ?, ?)""",
            (log_type, description, details)
        )
        await db.commit()


# ============ BROADCAST DE SCHEDULES ============

async def broadcast_schedules():
    """Envia todos os dados de agendamento para os clientes"""
    settings = await get_settings()
    await manager.broadcast({
        "type": "schedule_updated",
        "volume_schedules": settings.get('volume_schedules', []),
        "ad_schedules": settings.get('ad_schedules', []),
        "scheduled_songs": settings.get('scheduled_songs', []),
        "hourly_volumes": settings.get('hourly_volumes', {})
    })


# ============ CONTROLE DO PLAYER ============

@app.post("/api/player/next")
async def play_next(data: PlayNextSong):
    """Define a próxima música a ser tocada"""
    await manager.broadcast({
        "type": "play_next",
        "music_id": data.music_id
    })
    return {"success": True}


@app.get("/api/player/status")
async def player_status():
    """Obter status atual do player"""
    return manager.player_status


@app.post("/api/player/play")
async def player_play():
    """Continuar reprodução"""
    await manager.broadcast({"type": "play"})
    return {"success": True}


@app.post("/api/player/pause")
async def player_pause():
    """Pausar reprodução"""
    await manager.broadcast({"type": "pause"})
    return {"success": True}


@app.post("/api/player/skip")
async def player_skip():
    """Pular para próxima música e regenerar playlist"""
    # Primeiro regenerar a playlist
    result = await skip_and_regenerate()

    # Depois enviar comando de skip para o cliente
    await manager.broadcast({"type": "skip"})

    return result


# ============ ELEVENLABS TTS API ============

# Configuração ElevenLabs (API Key deve ser definida como variável de ambiente)
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")

# Configuração OpenRouter (para classificação de músicas com IA)
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "google/gemini-2.0-flash-001")

class TTSRequest(BaseModel):
    text: str
    voice_id: str = "21m00Tcm4TlvDq8ikWAM"  # Rachel (default)
    model_id: str = "eleven_multilingual_v2"
    stability: float = 0.5
    similarity_boost: float = 0.75
    name: Optional[str] = None  # Nome do arquivo gerado
    is_ad: bool = False  # Se é propaganda ou música


@app.get("/api/tts/voices")
async def get_elevenlabs_voices():
    """Lista vozes disponíveis no ElevenLabs"""
    if not ELEVENLABS_API_KEY:
        raise HTTPException(status_code=500, detail="API Key do ElevenLabs não configurada")

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                "https://api.elevenlabs.io/v1/voices",
                headers={"xi-api-key": ELEVENLABS_API_KEY}
            )
            response.raise_for_status()
            data = response.json()

            # Retornar lista simplificada de vozes
            voices = []
            for voice in data.get("voices", []):
                voices.append({
                    "voice_id": voice.get("voice_id"),
                    "name": voice.get("name"),
                    "category": voice.get("category", "custom"),
                    "preview_url": voice.get("preview_url"),
                    "labels": voice.get("labels", {})
                })

            return {"voices": voices}
        except httpx.HTTPError as e:
            raise HTTPException(status_code=500, detail=f"Erro ao buscar vozes: {str(e)}")


@app.post("/api/tts/generate")
async def generate_tts(data: TTSRequest):
    """Gera áudio a partir de texto usando ElevenLabs"""
    if not ELEVENLABS_API_KEY:
        raise HTTPException(status_code=500, detail="API Key do ElevenLabs não configurada. Configure ELEVENLABS_API_KEY.")

    if not data.text.strip():
        raise HTTPException(status_code=400, detail="Texto não pode estar vazio")

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            # Chamada à API ElevenLabs
            response = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{data.voice_id}",
                headers={
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json"
                },
                json={
                    "text": data.text,
                    "model_id": data.model_id,
                    "voice_settings": {
                        "stability": data.stability,
                        "similarity_boost": data.similarity_boost
                    }
                }
            )
            response.raise_for_status()

            # Salvar o áudio gerado
            audio_content = response.content

            # Gerar nome do arquivo
            if data.name:
                safe_name = "".join(c for c in data.name if c.isalnum() or c in (' ', '-', '_')).strip()
                safe_name = safe_name[:50]  # Limitar tamanho
            else:
                safe_name = f"tts_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

            music_id = str(uuid.uuid4())
            filename = f"{music_id}.mp3"
            filepath = STORAGE_DIR / filename

            # Salvar arquivo
            with open(filepath, "wb") as f:
                f.write(audio_content)

            # Obter duração
            duration = None
            if MUTAGEN_AVAILABLE:
                try:
                    audio = MP3(str(filepath))
                    duration = audio.info.length
                except:
                    pass

            # Salvar no banco de dados
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    """INSERT INTO music (id, filename, original_name, duration, is_ad, created_at)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (music_id, filename, f"{safe_name}.mp3", duration, data.is_ad, datetime.now().isoformat())
                )
                await db.commit()

            # Notificar clientes
            await manager.broadcast({
                "type": "music_added",
                "music_id": music_id,
                "music_name": f"{safe_name}.mp3"
            })

            return {
                "success": True,
                "music_id": music_id,
                "filename": f"{safe_name}.mp3",
                "duration": duration,
                "is_ad": data.is_ad
            }

        except httpx.HTTPStatusError as e:
            error_detail = "Erro na API ElevenLabs"
            try:
                error_json = e.response.json()
                error_detail = error_json.get("detail", {}).get("message", str(e))
            except:
                pass
            raise HTTPException(status_code=e.response.status_code, detail=error_detail)
        except httpx.HTTPError as e:
            raise HTTPException(status_code=500, detail=f"Erro de conexão: {str(e)}")


@app.get("/api/tts/status")
async def get_tts_status():
    """Verifica se a API ElevenLabs está configurada"""
    return {
        "configured": bool(ELEVENLABS_API_KEY),
        "api_key_set": len(ELEVENLABS_API_KEY) > 0
    }


# ============ AUDIO MIXING (TTS + Background Music) ============

class MixAudioRequest(BaseModel):
    text: str  # Texto para TTS
    voice_id: str = "21m00Tcm4TlvDq8ikWAM"
    model_id: str = "eleven_multilingual_v2"
    stability: float = 0.5
    similarity_boost: float = 0.75

    # Música de fundo
    background_music_id: str  # ID da música de fundo

    # Configurações de timing (em segundos)
    intro_duration: float = 5.0  # Tempo de música normal no início
    outro_duration: float = 5.0  # Tempo de música normal após a fala
    fade_out_duration: float = 3.0  # Duração do fade out final

    # Configurações de volume
    music_volume: float = 1.0  # Volume da música durante intro/outro (0.0 a 1.0)
    music_ducking_volume: float = 0.2  # Volume da música durante a fala (0.0 a 1.0)
    voice_volume: float = 1.0  # Volume da voz (0.0 a 1.0)
    fade_duration: float = 0.5  # Duração do fade entre volumes

    # Metadados
    name: Optional[str] = None
    is_ad: bool = True


@app.post("/api/tts/mix")
async def generate_mixed_audio(data: MixAudioRequest):
    """
    Gera áudio mixado: música de fundo + locução TTS

    Estrutura do áudio:
    1. [intro_duration] segundos de música em volume normal
    2. Fade down da música para music_ducking_volume
    3. Locução TTS com música baixa de fundo
    4. Fade up da música para volume normal
    5. [outro_duration] segundos de música em volume normal
    6. Fade out final de [fade_out_duration] segundos
    """
    import subprocess
    import tempfile

    if not ELEVENLABS_API_KEY:
        raise HTTPException(status_code=500, detail="API Key do ElevenLabs não configurada")

    if not data.text.strip():
        raise HTTPException(status_code=400, detail="Texto não pode estar vazio")

    # Buscar música de fundo
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM music WHERE id = ?", (data.background_music_id,)) as cursor:
            bg_music = await cursor.fetchone()
            if not bg_music:
                raise HTTPException(status_code=404, detail="Música de fundo não encontrada")

    bg_music_path = STORAGE_DIR / bg_music["filename"]
    if not bg_music_path.exists():
        raise HTTPException(status_code=404, detail="Arquivo de música não encontrado")

    # Gerar TTS
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{data.voice_id}",
                headers={
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json"
                },
                json={
                    "text": data.text,
                    "model_id": data.model_id,
                    "voice_settings": {
                        "stability": data.stability,
                        "similarity_boost": data.similarity_boost
                    }
                }
            )
            response.raise_for_status()
            tts_content = response.content
        except httpx.HTTPStatusError as e:
            error_detail = "Erro na API ElevenLabs"
            try:
                error_json = e.response.json()
                error_detail = error_json.get("detail", {}).get("message", str(e))
            except:
                pass
            raise HTTPException(status_code=e.response.status_code, detail=error_detail)

    # Criar arquivos temporários
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tts_file:
        tts_file.write(tts_content)
        tts_path = tts_file.name

    try:
        # Obter duração do TTS
        tts_duration = 0
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", tts_path],
                capture_output=True, text=True
            )
            tts_duration = float(result.stdout.strip())
        except:
            tts_duration = 10  # Fallback

        # Calcular tempos
        intro = data.intro_duration
        outro = data.outro_duration
        fade_out = data.fade_out_duration
        fade_time = data.fade_duration

        # Tempo total necessário de música
        total_duration = intro + tts_duration + outro + fade_out

        # Volumes
        vol_normal = data.music_volume
        vol_duck = data.music_ducking_volume
        vol_voice = data.voice_volume

        # Gerar nome do arquivo
        if data.name:
            safe_name = "".join(c for c in data.name if c.isalnum() or c in (' ', '-', '_')).strip()[:50]
        else:
            safe_name = f"mix_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

        music_id = str(uuid.uuid4())
        output_filename = f"{music_id}.mp3"
        output_path = STORAGE_DIR / output_filename

        # FFmpeg complex filter para mixagem
        # Estrutura:
        # - Música: volume normal -> fade down -> volume baixo -> fade up -> volume normal -> fade out
        # - Voz: delay de intro_duration segundos, com volume configurado

        # Pontos de mudança de volume na música:
        # t=0: vol_normal
        # t=intro: começa fade down
        # t=intro+fade_time: vol_duck (durante TTS)
        # t=intro+tts_duration: começa fade up
        # t=intro+tts_duration+fade_time: vol_normal
        # t=intro+tts_duration+outro: começa fade out
        # t=total_duration: vol=0

        t1 = intro  # Início do fade down
        t2 = intro + fade_time  # Fim do fade down
        t3 = intro + tts_duration  # Início do fade up
        t4 = intro + tts_duration + fade_time  # Fim do fade up
        t5 = intro + tts_duration + outro  # Início do fade out final
        t6 = total_duration  # Fim

        # Filter complex para FFmpeg
        filter_complex = (
            # Input 0: música de fundo, loop se necessário e cortar no tempo total
            f"[0:a]aloop=loop=-1:size=2e+09,atrim=0:{total_duration},"
            # Aplicar curva de volume: normal -> duck -> normal -> fade out
            f"volume='{vol_normal}':enable='lt(t,{t1})',"
            f"volume='{vol_normal}-({vol_normal}-{vol_duck})*(t-{t1})/{fade_time}':enable='between(t,{t1},{t2})',"
            f"volume='{vol_duck}':enable='between(t,{t2},{t3})',"
            f"volume='{vol_duck}+({vol_normal}-{vol_duck})*(t-{t3})/{fade_time}':enable='between(t,{t3},{t4})',"
            f"volume='{vol_normal}':enable='between(t,{t4},{t5})',"
            f"volume='{vol_normal}*(1-(t-{t5})/{fade_out})':enable='gte(t,{t5})',"
            f"aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[bg];"
            # Input 1: TTS com delay e volume
            f"[1:a]adelay={int(intro * 1000)}|{int(intro * 1000)},volume={vol_voice},"
            f"aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[voice];"
            # Mixar os dois
            f"[bg][voice]amix=inputs=2:duration=first:dropout_transition=0[out]"
        )

        # Executar FFmpeg
        cmd = [
            "ffmpeg", "-y",
            "-i", str(bg_music_path),
            "-i", tts_path,
            "-filter_complex", filter_complex,
            "-map", "[out]",
            "-c:a", "libmp3lame", "-b:a", "192k",
            str(output_path)
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            print(f"FFmpeg error: {result.stderr}")
            raise HTTPException(status_code=500, detail=f"Erro ao mixar áudio: {result.stderr[:200]}")

        # Obter duração final
        final_duration = None
        if MUTAGEN_AVAILABLE:
            try:
                audio = MP3(str(output_path))
                final_duration = audio.info.length
            except:
                pass

        # Salvar no banco de dados
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                """INSERT INTO music (id, filename, original_name, duration, is_ad, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (music_id, output_filename, f"{safe_name}.mp3", final_duration, data.is_ad, datetime.now().isoformat())
            )
            await db.commit()

        # Notificar clientes
        await manager.broadcast({
            "type": "music_added",
            "music_id": music_id,
            "music_name": f"{safe_name}.mp3"
        })

        return {
            "success": True,
            "music_id": music_id,
            "filename": f"{safe_name}.mp3",
            "duration": final_duration,
            "tts_duration": tts_duration,
            "total_duration": total_duration,
            "is_ad": data.is_ad,
            "config": {
                "intro": intro,
                "outro": outro,
                "fade_out": fade_out,
                "music_volume": vol_normal,
                "ducking_volume": vol_duck
            }
        }

    finally:
        # Limpar arquivo temporário
        try:
            os.unlink(tts_path)
        except:
            pass


@app.get("/api/tts/mix/preview-timing")
async def preview_mix_timing(
    background_music_id: str,
    text_length: int = 100,
    intro_duration: float = 5.0,
    outro_duration: float = 5.0,
    fade_out_duration: float = 3.0
):
    """
    Calcula e retorna uma previsão dos timings do áudio mixado
    (útil para o app mostrar uma prévia antes de gerar)
    """
    # Estimar duração do TTS (aproximadamente 150 palavras por minuto, ~5 caracteres por palavra)
    estimated_words = text_length / 5
    estimated_tts_duration = (estimated_words / 150) * 60  # em segundos

    # Mínimo de 2 segundos
    estimated_tts_duration = max(2.0, estimated_tts_duration)

    total_duration = intro_duration + estimated_tts_duration + outro_duration + fade_out_duration

    return {
        "estimated_tts_duration": round(estimated_tts_duration, 1),
        "total_duration": round(total_duration, 1),
        "timeline": {
            "intro_start": 0,
            "intro_end": intro_duration,
            "voice_start": intro_duration,
            "voice_end": round(intro_duration + estimated_tts_duration, 1),
            "outro_start": round(intro_duration + estimated_tts_duration, 1),
            "outro_end": round(intro_duration + estimated_tts_duration + outro_duration, 1),
            "fade_out_start": round(intro_duration + estimated_tts_duration + outro_duration, 1),
            "fade_out_end": round(total_duration, 1)
        }
    }


# ============ AI MUSIC CLASSIFICATION (OpenRouter) ============

class ClassifyRequest(BaseModel):
    music_id: str


class MusicMetadataUpdate(BaseModel):
    artist: Optional[str] = None
    title: Optional[str] = None
    album: Optional[str] = None
    genre: Optional[str] = None
    year: Optional[str] = None
    obs: Optional[str] = None


@app.get("/api/ai/status")
async def get_ai_status():
    """Verifica se a API OpenRouter está configurada"""
    return {
        "configured": bool(OPENROUTER_API_KEY),
        "model": OPENROUTER_MODEL
    }


@app.get("/api/music/{music_id}/metadata")
async def get_music_metadata(music_id: str):
    """Obtém metadados de uma música específica"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM music_metadata WHERE music_id = ?", (music_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return dict(row)
            return None


@app.get("/api/music/metadata/all")
async def get_all_music_metadata():
    """Obtém metadados de todas as músicas classificadas"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT m.*, mm.artist, mm.title, mm.album, mm.genre, mm.year, mm.obs, mm.classified_at
               FROM music m
               LEFT JOIN music_metadata mm ON m.id = mm.music_id
               ORDER BY m.created_at DESC"""
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


@app.post("/api/ai/classify/{music_id}")
async def classify_music(music_id: str):
    """Classifica uma música usando IA via OpenRouter"""
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="API Key do OpenRouter não configurada. Configure OPENROUTER_API_KEY no .env")

    # Buscar música
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM music WHERE id = ?", (music_id,)) as cursor:
            music = await cursor.fetchone()
            if not music:
                raise HTTPException(status_code=404, detail="Música não encontrada")

    filename = music["original_name"]

    # Prompt para a IA
    prompt = f"""Analise o nome deste arquivo de áudio e extraia as informações da música.

Nome do arquivo: {filename}

Retorne APENAS um JSON válido com o seguinte formato (sem markdown, sem código, apenas o JSON puro):
{{
    "artist": "Nome do artista ou banda",
    "title": "Título da música",
    "album": "Nome do álbum (se identificável, senão null)",
    "genre": "Gênero musical (se identificável, senão null)",
    "year": "Ano (se identificável, senão null)",
    "obs": "Observações adicionais sobre a música ou artista (curiosidades, se conhecer)"
}}

Regras:
- Se o nome do arquivo contiver "artista - música", separe corretamente
- Se não conseguir identificar algum campo, use null
- Tente identificar o gênero musical se conhecer a música/artista
- Em "obs" você pode adicionar informações interessantes sobre a música se a conhecer
- Responda APENAS com o JSON, nada mais"""

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://falavipmusic.com",
                    "X-Title": "FalaVIP Music Player"
                },
                json={
                    "model": OPENROUTER_MODEL,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.3
                }
            )
            response.raise_for_status()
            data = response.json()

            # Extrair resposta
            ai_response = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            # Tentar parsear o JSON da resposta
            try:
                # Limpar possíveis marcadores de código
                clean_response = ai_response.strip()
                if clean_response.startswith("```json"):
                    clean_response = clean_response[7:]
                if clean_response.startswith("```"):
                    clean_response = clean_response[3:]
                if clean_response.endswith("```"):
                    clean_response = clean_response[:-3]
                clean_response = clean_response.strip()

                metadata = json.loads(clean_response)
            except json.JSONDecodeError:
                # Se não conseguir parsear, tentar extrair campos manualmente
                metadata = {
                    "artist": None,
                    "title": filename,
                    "album": None,
                    "genre": None,
                    "year": None,
                    "obs": f"Não foi possível classificar automaticamente. Resposta da IA: {ai_response[:200]}"
                }

            # Salvar no banco de dados
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    """INSERT OR REPLACE INTO music_metadata
                       (music_id, artist, title, album, genre, year, obs, raw_response, classified_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        music_id,
                        metadata.get("artist"),
                        metadata.get("title"),
                        metadata.get("album"),
                        metadata.get("genre"),
                        metadata.get("year"),
                        metadata.get("obs"),
                        ai_response,
                        datetime.now().isoformat()
                    )
                )
                await db.commit()

            return {
                "success": True,
                "music_id": music_id,
                "filename": filename,
                "metadata": metadata
            }

        except httpx.HTTPStatusError as e:
            error_detail = "Erro na API OpenRouter"
            try:
                error_json = e.response.json()
                error_detail = error_json.get("error", {}).get("message", str(e))
            except:
                pass
            raise HTTPException(status_code=e.response.status_code, detail=error_detail)
        except httpx.HTTPError as e:
            raise HTTPException(status_code=500, detail=f"Erro de conexão: {str(e)}")


from sse_starlette.sse import EventSourceResponse

@app.get("/api/ai/classify-all-stream")
async def classify_all_music_stream(request: Request, batch_size: int = 5):
    """Classifica todas as músicas não classificadas com progresso em tempo real (SSE)"""
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="API Key do OpenRouter não configurada")

    async def event_generator():
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT m.id, m.original_name FROM music m
                   LEFT JOIN music_metadata mm ON m.id = mm.music_id
                   WHERE mm.music_id IS NULL"""
            ) as cursor:
                unclassified = await cursor.fetchall()

        total = len(unclassified)

        if total == 0:
            yield {
                "event": "complete",
                "data": json.dumps({"total": 0, "classified": 0, "failed": 0, "message": "Nenhuma música para classificar"})
            }
            return

        classified = 0
        failed = 0

        # Enviar início
        yield {
            "event": "start",
            "data": json.dumps({"total": total, "message": f"Iniciando classificação de {total} músicas..."})
        }

        # Processar em batches paralelos
        for i in range(0, total, batch_size):
            # Verificar se cliente desconectou
            if await request.is_disconnected():
                return

            batch = unclassified[i:i + batch_size]

            # Criar tasks para processamento paralelo
            tasks = []
            for music in batch:
                tasks.append(classify_single_music_with_result(music["id"], music["original_name"]))

            # Executar batch em paralelo
            results = await asyncio.gather(*tasks)

            # Processar resultados e enviar progresso
            for result in results:
                if result["success"]:
                    classified += 1
                else:
                    failed += 1

                # Enviar progresso para cada música
                yield {
                    "event": "progress",
                    "data": json.dumps({
                        "current": classified + failed,
                        "total": total,
                        "classified": classified,
                        "failed": failed,
                        "percent": round(((classified + failed) / total) * 100),
                        "music_name": result["name"],
                        "artist": result.get("artist"),
                        "title": result.get("title"),
                        "success": result["success"],
                        "error": result.get("error")
                    })
                }

        # Enviar conclusão
        yield {
            "event": "complete",
            "data": json.dumps({
                "total": total,
                "classified": classified,
                "failed": failed,
                "message": f"Concluído! {classified} classificadas, {failed} falhas"
            })
        }

    return EventSourceResponse(event_generator())


async def classify_single_music_with_result(music_id: str, music_name: str) -> dict:
    """Classifica uma música e retorna resultado detalhado"""
    try:
        result = await classify_music(music_id)
        metadata = result.get("metadata", {})
        print(f"✓ Classificado: {music_name} -> {metadata.get('artist')} - {metadata.get('title')}")
        return {
            "success": True,
            "name": music_name,
            "artist": metadata.get("artist"),
            "title": metadata.get("title"),
            "genre": metadata.get("genre")
        }
    except Exception as e:
        print(f"✗ Erro ao classificar {music_name}: {e}")
        return {
            "success": False,
            "name": music_name,
            "error": str(e)
        }


@app.put("/api/music/{music_id}/metadata")
async def update_music_metadata(music_id: str, data: MusicMetadataUpdate):
    """Atualiza metadados de uma música manualmente"""
    async with aiosqlite.connect(DB_PATH) as db:
        # Verificar se música existe
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT id FROM music WHERE id = ?", (music_id,)) as cursor:
            if not await cursor.fetchone():
                raise HTTPException(status_code=404, detail="Música não encontrada")

        # Verificar se já existe metadados
        async with db.execute("SELECT music_id FROM music_metadata WHERE music_id = ?", (music_id,)) as cursor:
            exists = await cursor.fetchone()

        if exists:
            # Atualizar
            await db.execute(
                """UPDATE music_metadata SET
                   artist = COALESCE(?, artist),
                   title = COALESCE(?, title),
                   album = COALESCE(?, album),
                   genre = COALESCE(?, genre),
                   year = COALESCE(?, year),
                   obs = COALESCE(?, obs),
                   classified_at = ?
                   WHERE music_id = ?""",
                (data.artist, data.title, data.album, data.genre, data.year, data.obs,
                 datetime.now().isoformat(), music_id)
            )
        else:
            # Inserir
            await db.execute(
                """INSERT INTO music_metadata (music_id, artist, title, album, genre, year, obs, classified_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (music_id, data.artist, data.title, data.album, data.genre, data.year, data.obs,
                 datetime.now().isoformat())
            )

        await db.commit()

    return {"success": True, "music_id": music_id}


@app.delete("/api/music/{music_id}/metadata")
async def delete_music_metadata(music_id: str):
    """Remove metadados de uma música (permite reclassificar)"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM music_metadata WHERE music_id = ?", (music_id,))
        await db.commit()
    return {"success": True, "music_id": music_id}


@app.delete("/api/ai/clear-all-metadata")
async def clear_all_metadata():
    """Limpa TODOS os metadados (permite reclassificar tudo)"""
    async with aiosqlite.connect(DB_PATH) as db:
        result = await db.execute("SELECT COUNT(*) FROM music_metadata")
        count = (await result.fetchone())[0]
        await db.execute("DELETE FROM music_metadata")
        await db.commit()
    return {"success": True, "deleted": count}


@app.get("/api/music/artists")
async def get_artists():
    """Lista todos os artistas únicos"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT DISTINCT artist, COUNT(*) as count
               FROM music_metadata
               WHERE artist IS NOT NULL AND artist != ''
               GROUP BY artist
               ORDER BY artist"""
        ) as cursor:
            rows = await cursor.fetchall()
            return [{"artist": row["artist"], "count": row["count"]} for row in rows]


@app.get("/api/music/genres")
async def get_genres():
    """Lista todos os gêneros únicos"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT DISTINCT genre, COUNT(*) as count
               FROM music_metadata
               WHERE genre IS NOT NULL AND genre != ''
               GROUP BY genre
               ORDER BY genre"""
        ) as cursor:
            rows = await cursor.fetchall()
            return [{"genre": row["genre"], "count": row["count"]} for row in rows]


@app.get("/api/music/by-artist/{artist}")
async def get_music_by_artist(artist: str):
    """Lista músicas de um artista específico"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT m.*, mm.artist, mm.title, mm.album, mm.genre, mm.year, mm.obs
               FROM music m
               JOIN music_metadata mm ON m.id = mm.music_id
               WHERE mm.artist = ?
               ORDER BY mm.title""",
            (artist,)
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


@app.get("/api/music/by-genre/{genre}")
async def get_music_by_genre(genre: str):
    """Lista músicas de um gênero específico"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT m.*, mm.artist, mm.title, mm.album, mm.genre, mm.year, mm.obs
               FROM music m
               JOIN music_metadata mm ON m.id = mm.music_id
               WHERE mm.genre = ?
               ORDER BY mm.artist, mm.title""",
            (genre,)
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


# ============ WEBSOCKET ============

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Enviar configurações iniciais
        settings = await get_settings()
        await websocket.send_json({
            "type": "init",
            "settings": settings
        })

        while True:
            data = await websocket.receive_json()

            # Atualizar status do player
            if data.get("type") == "player_status":
                manager.player_status = {
                    "current_song": data.get("current_song"),
                    "is_playing": data.get("is_playing", False),
                    "volume": data.get("volume", 0.5),
                    "connected": True,
                    "position": data.get("position", 0),
                    "duration": data.get("duration", 0),
                    "remaining": data.get("remaining", 0)
                }
                # Broadcast para outras conexões (interface web)
                await manager.broadcast({
                    "type": "player_status",
                    **manager.player_status
                })

            # Resposta a comandos
            elif data.get("type") == "command_response":
                await manager.broadcast(data)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        manager.player_status["connected"] = False
        await manager.broadcast({
            "type": "player_status",
            **manager.player_status
        })


# ============ INTERFACE WEB ============

@app.get("/", response_class=HTMLResponse)
async def get_index():
    """Página principal"""
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return index_path.read_text(encoding="utf-8")
    return "<h1>FalaVIP Music Player</h1><p>Interface não encontrada</p>"


# Montar arquivos estáticos
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    import uvicorn
    print("\n" + "="*50)
    print("SERVIDOR INICIADO!")
    print("Acesse no navegador: http://localhost:8000")
    print("Auto-reload ativado - alterações reiniciam o servidor")
    print("="*50 + "\n")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
