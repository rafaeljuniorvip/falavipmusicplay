# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FalaVIP Music Player is a client-server music player system with remote control capabilities. It consists of:
- **Server**: FastAPI backend with WebSocket support for real-time control
- **Client**: Windows desktop application with tkinter GUI and pygame audio

## Commands

### Server
```bash
cd server
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
# Or run directly:
python main.py
```

### Client
```bash
cd client
pip install -r requirements.txt
python main.py
```

### Docker (Server)
```bash
cd server
docker build -t falavipmusicplayer .
docker run -p 8000:8000 -v ./storage:/app/storage -v ./data:/app/data falavipmusicplayer
```

### Build Windows Executable
```bash
cd client
pip install pyinstaller
pyinstaller --onefile --windowed --name "FalaVIPMusicPlayer" main.py
```

## Architecture

### Server (`server/`)
- `main.py`: Single-file FastAPI application with:
  - REST API for music management (`/api/music/*`, `/api/settings/*`, `/api/player/*`)
  - WebSocket endpoint (`/ws`) for real-time bidirectional communication
  - SQLite database via aiosqlite for persistence (music, settings, schedules)
  - Static file serving for web interface from `static/`
  - `ConnectionManager` class handles WebSocket connections and broadcasts

### Client (`client/`)
- `main.py`: Entry point, orchestrates all components via `FalaVIPPlayer` class
- `player.py`: `MusicPlayer` class using pygame-ce for audio playback, auto-advances playlist
- `sync.py`: `MusicSync` class synchronizes local music folder with server via REST API
- `scheduler.py`: `Scheduler` class handles time-based volume changes and scheduled playback
- `websocket_client.py`: `NativeWebSocketClient` for real-time server commands
- `gui.py`: `PlayerGUI` tkinter interface with playback controls and settings
- `config.py`: Configuration loading from `settings.json`, defaults to `localhost:8000`

### Communication Flow
1. Client connects to server via WebSocket
2. Server sends `init` message with current settings
3. Client sends `player_status` updates periodically
4. Server broadcasts commands (`play`, `pause`, `skip`, `volume_change`) to all connected clients
5. Music files synced via REST API (`/api/music/download/{id}`)

### Data Storage
- Server: SQLite database at `data/database.db`, music files in `storage/`
- Client: Local `music/` folder synced from server, `settings.json` for config

## Key Patterns

- All client components communicate via callbacks (set as attributes like `on_song_change`, `on_sync_complete`)
- GUI updates must use `root.after()` for thread safety since callbacks run in background threads
- Server uses Pydantic models for request validation
- Environment variables `STORAGE_DIR` and `DATA_DIR` configure server paths in Docker
