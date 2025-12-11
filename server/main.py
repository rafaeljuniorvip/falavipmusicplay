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

from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect
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
    print("="*50 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)
