import tkinter as tk
from tkinter import ttk, messagebox
from typing import Callable, Optional
from pathlib import Path
from config import SERVER_URL, save_settings

# Theme Colors (ERP Style)
COLORS = {
    "bg_main": "#0f172a",      # Slate 900
    "bg_card": "#1e293b",      # Slate 800
    "bg_input": "#334155",     # Slate 700
    "text_primary": "#f8fafc", # Slate 50
    "text_secondary": "#94a3b8", # Slate 400
    "accent": "#3b82f6",       # Blue 500
    "accent_hover": "#2563eb", # Blue 600
    "success": "#22c55e",      # Green 500
    "danger": "#ef4444"        # Red 500
}

class PlayerGUI:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("FalaVIP Music Player")
        self.root.geometry("450x550")
        self.root.configure(bg=COLORS["bg_main"])
        self.root.resizable(False, False)

        # Callbacks
        self.on_play: Optional[Callable[[], None]] = None
        self.on_pause: Optional[Callable[[], None]] = None
        self.on_skip: Optional[Callable[[], None]] = None
        self.on_volume_change: Optional[Callable[[float], None]] = None

        self._setup_ui()

    def _setup_ui(self):
        # --- Header ---
        header = tk.Frame(self.root, bg=COLORS["bg_main"], pady=20)
        header.pack(fill=tk.X, padx=20)

        title = tk.Label(
            header,
            text="FalaVIP Player",
            font=("Segoe UI", 18, "bold"),
            fg=COLORS["accent"],
            bg=COLORS["bg_main"]
        )
        title.pack(side=tk.LEFT)

        self.settings_btn = tk.Button(
            header,
            text="⚙️",
            font=("Segoe UI", 12),
            bg=COLORS["bg_card"],
            fg=COLORS["text_secondary"],
            activebackground=COLORS["bg_input"],
            activeforeground=COLORS["text_primary"],
            bd=0,
            cursor="hand2",
            command=self._open_settings
        )
        self.settings_btn.pack(side=tk.RIGHT)

        # --- Now Playing Card ---
        self.now_playing_frame = tk.Frame(self.root, bg=COLORS["bg_card"], padx=25, pady=25)
        self.now_playing_frame.pack(fill=tk.X, padx=20, pady=(0, 15))

        tk.Label(
            self.now_playing_frame,
            text="TOCANDO AGORA",
            font=("Segoe UI", 8, "bold"),
            fg=COLORS["text_secondary"],
            bg=COLORS["bg_card"]
        ).pack(anchor="w")

        self.song_label = tk.Label(
            self.now_playing_frame,
            text="Nenhuma música carregada",
            font=("Segoe UI", 14, "bold"),
            fg=COLORS["text_primary"],
            bg=COLORS["bg_card"],
            wraplength=380,
            justify="left"
        )
        self.song_label.pack(anchor="w", pady=(5, 10))

        self.playing_status = tk.Label(
            self.now_playing_frame,
            text="⏸ Parado",
            font=("Segoe UI", 10),
            fg=COLORS["text_secondary"],
            bg=COLORS["bg_card"]
        )
        self.playing_status.pack(anchor="w")

        # --- Progress Bar ---
        progress_frame = tk.Frame(self.now_playing_frame, bg=COLORS["bg_card"])
        progress_frame.pack(fill=tk.X, pady=(15, 5))

        self.progress_bar = ttk.Progressbar(
            progress_frame,
            mode='determinate',
            length=380
        )
        self.progress_bar.pack(fill=tk.X)

        # --- Time Display ---
        time_frame = tk.Frame(self.now_playing_frame, bg=COLORS["bg_card"])
        time_frame.pack(fill=tk.X)

        self.time_current = tk.Label(
            time_frame,
            text="0:00",
            font=("Segoe UI", 9),
            fg=COLORS["text_secondary"],
            bg=COLORS["bg_card"]
        )
        self.time_current.pack(side=tk.LEFT)

        self.time_remaining = tk.Label(
            time_frame,
            text="-0:00",
            font=("Segoe UI", 9),
            fg=COLORS["text_secondary"],
            bg=COLORS["bg_card"]
        )
        self.time_remaining.pack(side=tk.RIGHT)

        self.time_total = tk.Label(
            time_frame,
            text="0:00",
            font=("Segoe UI", 9),
            fg=COLORS["text_secondary"],
            bg=COLORS["bg_card"]
        )
        self.time_total.pack(side=tk.RIGHT, padx=(0, 10))

        tk.Label(
            time_frame,
            text="/",
            font=("Segoe UI", 9),
            fg=COLORS["text_secondary"],
            bg=COLORS["bg_card"]
        ).pack(side=tk.RIGHT)

        # --- Next Up ---
        self.next_frame = tk.Frame(self.root, bg=COLORS["bg_main"], padx=5)
        self.next_frame.pack(fill=tk.X, padx=20, pady=(0, 25))

        tk.Label(
            self.next_frame,
            text="PRÓXIMA:",
            font=("Segoe UI", 8, "bold"),
            fg=COLORS["text_secondary"],
            bg=COLORS["bg_main"]
        ).pack(side=tk.LEFT)

        self.next_song_label = tk.Label(
            self.next_frame,
            text="-",
            font=("Segoe UI", 9),
            fg=COLORS["text_secondary"],
            bg=COLORS["bg_main"]
        )
        self.next_song_label.pack(side=tk.LEFT, padx=5)

        # --- Controls ---
        controls_frame = tk.Frame(self.root, bg=COLORS["bg_main"])
        controls_frame.pack(pady=10)

        btn_props = {
            "font": ("Segoe UI", 16),
            "bg": COLORS["bg_card"],
            "fg": COLORS["text_primary"],
            "activebackground": COLORS["bg_input"],
            "activeforeground": COLORS["text_primary"],
            "bd": 0,
            "cursor": "hand2",
            "width": 5
        }

        self.pause_btn = tk.Button(controls_frame, text="⏸", command=self._on_pause_click, **btn_props)
        self.play_btn = tk.Button(controls_frame, text="▶", command=self._on_play_click, **btn_props)
        self.play_btn.config(bg=COLORS["accent"], fg="white", activebackground=COLORS["accent_hover"]) # Highlight Play
        self.skip_btn = tk.Button(controls_frame, text="⏭", command=self._on_skip_click, **btn_props)

        self.pause_btn.pack(side=tk.LEFT, padx=10)
        self.play_btn.pack(side=tk.LEFT, padx=10)
        self.skip_btn.pack(side=tk.LEFT, padx=10)

        # --- Volume ---
        vol_frame = tk.Frame(self.root, bg=COLORS["bg_main"], pady=20)
        vol_frame.pack(fill=tk.X, padx=40)

        tk.Label(vol_frame, text="🔊", bg=COLORS["bg_main"], fg=COLORS["text_secondary"]).pack(side=tk.LEFT)

        self.volume_scale = ttk.Scale(
            vol_frame, from_=0, to=100, orient=tk.HORIZONTAL
        )
        self.volume_scale.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=10)

        self.volume_value = tk.Label(
            vol_frame, text="50%", bg=COLORS["bg_main"], fg=COLORS["text_primary"], font=("Segoe UI", 9, "bold"), width=4
        )
        self.volume_value.pack(side=tk.LEFT)

        # Configurar callback e valor inicial DEPOIS de criar volume_value
        self.volume_scale.config(command=self._on_volume_change)
        self.volume_scale.set(50)

        # --- Footer Status ---
        footer = tk.Frame(self.root, bg=COLORS["bg_card"], height=30)
        footer.pack(side=tk.BOTTOM, fill=tk.X)
        footer.pack_propagate(False)

        self.status_dot = tk.Label(footer, text="●", bg=COLORS["bg_card"], fg=COLORS["danger"])
        self.status_dot.pack(side=tk.LEFT, padx=(15, 5))

        self.status_text = tk.Label(footer, text="Desconectado", bg=COLORS["bg_card"], fg=COLORS["text_secondary"], font=("Segoe UI", 8))
        self.status_text.pack(side=tk.LEFT)
        
        self.sync_label = tk.Label(footer, text="", bg=COLORS["bg_card"], fg=COLORS["text_secondary"], font=("Segoe UI", 8))
        self.sync_label.pack(side=tk.RIGHT, padx=15)


    # --- Updates ---

    def _format_time(self, seconds: float) -> str:
        """Formata segundos para M:SS ou H:MM:SS"""
        if seconds < 0:
            seconds = 0
        total_seconds = int(seconds)
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        secs = total_seconds % 60

        if hours > 0:
            return f"{hours}:{minutes:02d}:{secs:02d}"
        return f"{minutes}:{secs:02d}"

    def update_time(self, position: float, duration: float, remaining: float):
        """Atualiza informações de tempo da música"""
        self.time_current.config(text=self._format_time(position))
        self.time_total.config(text=self._format_time(duration))
        self.time_remaining.config(text=f"-{self._format_time(remaining)}")

        # Atualizar barra de progresso
        if duration > 0:
            progress = (position / duration) * 100
            self.progress_bar['value'] = progress
        else:
            self.progress_bar['value'] = 0

    def update_song(self, song_name: str, is_playing: bool = True):
        self.song_label.config(text=song_name if song_name else "Nenhuma música")
        self.playing_status.config(text="▶ Tocando" if is_playing else "⏸ Pausado")
        self.playing_status.config(fg=COLORS["success"] if is_playing else COLORS["text_secondary"])

    def update_next_song(self, song_name: str):
        self.next_song_label.config(text=song_name if song_name else "Fim da playlist")

    def update_volume(self, volume: float):
        perc = int(volume * 100)
        self.volume_scale.set(perc)
        self.volume_value.config(text=f"{perc}%")

    def update_status(self, connected: bool, text: str = None):
        self.status_dot.config(fg=COLORS["success"] if connected else COLORS["danger"])
        self.status_text.config(text=text or ("Conectado" if connected else "Desconectado"))

    def update_sync_info(self, text: str):
        self.sync_label.config(text=text)

    # --- Actions ---
    def _on_play_click(self):
        if self.on_play: self.on_play()
    
    def _on_pause_click(self):
        if self.on_pause: self.on_pause()
        
    def _on_skip_click(self):
        if self.on_skip: self.on_skip()

    def _on_volume_change(self, val):
        v = int(float(val))
        self.volume_value.config(text=f"{v}%")
        if self.on_volume_change: self.on_volume_change(v / 100)

    def _open_settings(self):
        win = tk.Toplevel(self.root)
        win.title("Configurações")
        win.geometry("400x200")
        win.configure(bg=COLORS["bg_main"])
        
        # ... (Mantendo logica simples para settings, mas com cores novas)
        frame = tk.Frame(win, bg=COLORS["bg_main"], padx=20, pady=20)
        frame.pack(fill=tk.BOTH, expand=True)
        
        tk.Label(frame, text="Servidor URL:", bg=COLORS["bg_main"], fg=COLORS["text_primary"]).pack(anchor="w")
        
        entry = tk.Entry(frame, bg=COLORS["bg_input"], fg=COLORS["text_primary"], insertbackground="white")
        entry.insert(0, SERVER_URL)
        entry.pack(fill=tk.X, pady=5)
        
        def save():
            url = entry.get().strip()
            if save_settings({"server_url": url}):
                messagebox.showinfo("Salvo", "Reinicie o app.", parent=win)
                win.destroy()
        
        tk.Button(frame, text="Salvar", bg=COLORS["accent"], fg="white", command=save, bd=0, padx=15, pady=5).pack(pady=15)

    def run(self): self.root.mainloop()
    def quit(self): 
        self.root.quit()
        self.root.destroy()


if __name__ == "__main__":
    try:
        from main import main
        main()
    except ImportError:
        # Visual Test Mode
        app = PlayerGUI()
        app.update_song("Bohemian Rhapsody - Queen", True)
        app.update_next_song("Stairway to Heaven - Led Zeppelin")
        app.update_status(True, "Conectado (Teste)")
        app.run()
