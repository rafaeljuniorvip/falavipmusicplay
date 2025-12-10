"""
FalaVIP Music Player - Servidor
FastAPI + WebSocket para controle remoto do player
"""

import os
import json
import uuid
import asyncio
import aiosqlite
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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
            "connected": False
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


# Modelos Pydantic
class VolumeUpdate(BaseModel):
    volume: float  # 0.0 a 1.0

class VolumeSchedule(BaseModel):
    time_start: str  # HH:MM
    time_end: str    # HH:MM
    volume: float

class AdConfig(BaseModel):
    music_id: str
    interval_minutes: int  # A cada X minutos
    enabled: bool = True

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
                volume REAL NOT NULL
            )
        """)

        # Tabela de propagandas agendadas
        await db.execute("""
            CREATE TABLE IF NOT EXISTS ad_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                music_id TEXT NOT NULL,
                interval_minutes INTEGER NOT NULL,
                enabled INTEGER DEFAULT 1,
                FOREIGN KEY (music_id) REFERENCES music(id)
            )
        """)

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
async def upload_music(file: UploadFile = File(...), is_ad: bool = False):
    """Upload de nova música"""
    # Gerar ID único
    music_id = str(uuid.uuid4())

    # Salvar arquivo
    ext = Path(file.filename).suffix
    filename = f"{music_id}{ext}"
    filepath = STORAGE_DIR / filename

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    # Salvar no banco
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO music (id, filename, original_name, is_ad) VALUES (?, ?, ?, ?)",
            (music_id, filename, file.filename, 1 if is_ad else 0)
        )
        await db.commit()

    # Notificar clientes sobre nova música
    await manager.broadcast({
        "type": "music_added",
        "music_id": music_id,
        "filename": file.filename
    })

    return {"id": music_id, "filename": file.filename}


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

    # Notificar clientes
    await manager.broadcast({
        "type": "music_deleted",
        "music_id": music_id
    })

    return {"success": True}


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

        return {
            "volume": volume,
            "volume_schedules": volume_schedules,
            "ad_schedules": ad_schedules,
            "scheduled_songs": scheduled_songs,
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

    return {"success": True, "volume": volume}


@app.post("/api/settings/volume-schedule")
async def add_volume_schedule(data: VolumeSchedule):
    """Adicionar agendamento de volume"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO volume_schedules (time_start, time_end, volume) VALUES (?, ?, ?)",
            (data.time_start, data.time_end, data.volume)
        )
        await db.commit()
        schedule_id = cursor.lastrowid

    # Notificar player
    await manager.broadcast({
        "type": "schedule_updated",
        "schedule_type": "volume"
    })

    return {"success": True, "id": schedule_id}


@app.delete("/api/settings/volume-schedule/{schedule_id}")
async def delete_volume_schedule(schedule_id: int):
    """Remover agendamento de volume"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM volume_schedules WHERE id = ?", (schedule_id,))
        await db.commit()

    await manager.broadcast({
        "type": "schedule_updated",
        "schedule_type": "volume"
    })

    return {"success": True}


@app.post("/api/settings/ad-schedule")
async def add_ad_schedule(data: AdConfig):
    """Adicionar propaganda agendada"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO ad_schedules (music_id, interval_minutes, enabled) VALUES (?, ?, ?)",
            (data.music_id, data.interval_minutes, 1 if data.enabled else 0)
        )
        await db.commit()
        schedule_id = cursor.lastrowid

    await manager.broadcast({
        "type": "schedule_updated",
        "schedule_type": "ad"
    })

    return {"success": True, "id": schedule_id}


@app.delete("/api/settings/ad-schedule/{schedule_id}")
async def delete_ad_schedule(schedule_id: int):
    """Remover propaganda agendada"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM ad_schedules WHERE id = ?", (schedule_id,))
        await db.commit()

    await manager.broadcast({
        "type": "schedule_updated",
        "schedule_type": "ad"
    })

    return {"success": True}


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

    await manager.broadcast({
        "type": "schedule_updated",
        "schedule_type": "song"
    })

    return {"success": True, "id": schedule_id}


@app.delete("/api/settings/scheduled-song/{schedule_id}")
async def delete_scheduled_song(schedule_id: int):
    """Remover música agendada"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM scheduled_songs WHERE id = ?", (schedule_id,))
        await db.commit()

    await manager.broadcast({
        "type": "schedule_updated",
        "schedule_type": "song"
    })

    return {"success": True}


# ============ CONTROLE DO PLAYER ============

@app.post("/api/player/next")
async def play_next(data: PlayNextSong):
    """Define a próxima música a ser tocada"""
    await manager.broadcast({
        "type": "play_next",
        "music_id": data.music_id
    })
    return {"success": True}


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
    """Pular para próxima música"""
    await manager.broadcast({"type": "skip"})
    return {"success": True}


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
                    "connected": True
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
        return index_path.read_text()
    return "<h1>FalaVIP Music Player</h1><p>Interface não encontrada</p>"


# Montar arquivos estáticos
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
