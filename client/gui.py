"""
Interface gráfica do player usando tkinter
"""

import tkinter as tk
import tkinter as tk
from tkinter import ttk, messagebox
from typing import Callable, Optional
from config import SERVER_URL, save_settings


class PlayerGUI:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("FalaVIP Music Player")
        self.root.geometry("400x300")
        self.root.resizable(False, False)

        # Cores
        self.bg_color = "#1a1a2e"
        self.fg_color = "#ffffff"
        self.accent_color = "#00d9ff"
        self.success_color = "#00ff88"

        self.root.configure(bg=self.bg_color)

        # Callbacks
        self.on_play: Optional[Callable[[], None]] = None
        self.on_pause: Optional[Callable[[], None]] = None
        self.on_skip: Optional[Callable[[], None]] = None
        self.on_volume_change: Optional[Callable[[float], None]] = None

        self._setup_ui()

    def _setup_ui(self):
        """Configura a interface"""
        # Frame principal
        main_frame = tk.Frame(self.root, bg=self.bg_color, padx=20, pady=20)
        main_frame.pack(fill=tk.BOTH, expand=True)

        # Título
        title = tk.Label(
            main_frame,
            text="FalaVIP Music Player",
            font=("Segoe UI", 16, "bold"),
            fg=self.accent_color,
            bg=self.bg_color
        )
        title.pack(pady=(0, 20))

        # Status de conexão
        status_frame = tk.Frame(main_frame, bg=self.bg_color)
        status_frame.pack(fill=tk.X, pady=(0, 15))

        self.status_indicator = tk.Label(
            status_frame,
            text="●",
            font=("Segoe UI", 12),
            fg="#ff4444",
            bg=self.bg_color
        )
        self.status_indicator.pack(side=tk.LEFT)

        self.status_label = tk.Label(
            status_frame,
            text="Desconectado",
            font=("Segoe UI", 10),
            fg="#888888",
            bg=self.bg_color
        )
        self.status_label.pack(side=tk.LEFT, padx=(5, 0))

        # Música atual
        self.song_frame = tk.Frame(main_frame, bg="#2a2a4e", padx=15, pady=15)
        self.song_frame.pack(fill=tk.X, pady=(0, 15))

        self.song_label = tk.Label(
            self.song_frame,
            text="Nenhuma música",
            font=("Segoe UI", 11, "bold"),
            fg=self.fg_color,
            bg="#2a2a4e",
            wraplength=350
        )
        self.song_label.pack()

        self.playing_label = tk.Label(
            self.song_frame,
            text="Parado",
            font=("Segoe UI", 9),
            fg="#888888",
            bg="#2a2a4e"
        )
        self.playing_label.pack()

        # Controles
        controls_frame = tk.Frame(main_frame, bg=self.bg_color)
        controls_frame.pack(pady=(0, 15))

        btn_style = {
            "font": ("Segoe UI", 14),
            "width": 4,
            "height": 1,
            "bd": 0,
            "cursor": "hand2"
        }

        self.pause_btn = tk.Button(
            controls_frame,
            text="⏸",
            bg="#3a3a5e",
            fg=self.fg_color,
            activebackground="#4a4a7e",
            activeforeground=self.fg_color,
            command=self._on_pause_click,
            **btn_style
        )
        self.pause_btn.pack(side=tk.LEFT, padx=5)

        self.play_btn = tk.Button(
            controls_frame,
            text="▶",
            bg="#3a3a5e",
            fg=self.fg_color,
            activebackground="#4a4a7e",
            activeforeground=self.fg_color,
            command=self._on_play_click,
            **btn_style
        )
        self.play_btn.pack(side=tk.LEFT, padx=5)

        self.skip_btn = tk.Button(
            controls_frame,
            text="⏭",
            bg="#3a3a5e",
            fg=self.fg_color,
            activebackground="#4a4a7e",
            activeforeground=self.fg_color,
            command=self._on_skip_click,
            **btn_style
        )
        self.skip_btn.pack(side=tk.LEFT, padx=5)

        # Botão de Configurações
        self.settings_btn = tk.Button(
            controls_frame,
            text="⚙️",
            bg="#3a3a5e",
            fg=self.fg_color,
            activebackground="#4a4a7e",
            activeforeground=self.fg_color,
            command=self._open_settings,
            **btn_style
        )
        self.settings_btn.pack(side=tk.LEFT, padx=5)

        # Volume
        volume_frame = tk.Frame(main_frame, bg=self.bg_color)
        volume_frame.pack(fill=tk.X)

        volume_label = tk.Label(
            volume_frame,
            text="🔊",
            font=("Segoe UI", 12),
            fg=self.fg_color,
            bg=self.bg_color
        )
        volume_label.pack(side=tk.LEFT)

        self.volume_scale = ttk.Scale(
            volume_frame,
            from_=0,
            to=100,
            orient=tk.HORIZONTAL,
            command=self._on_volume_change
        )
        self.volume_scale.set(50)
        self.volume_scale.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=10)

        self.volume_value = tk.Label(
            volume_frame,
            text="50%",
            font=("Segoe UI", 10),
            fg=self.fg_color,
            bg=self.bg_color,
            width=5
        )
        self.volume_value.pack(side=tk.LEFT)

        # Info de sincronização
        self.sync_label = tk.Label(
            main_frame,
            text="",
            font=("Segoe UI", 9),
            fg="#888888",
            bg=self.bg_color
        )
        self.sync_label.pack(pady=(15, 0))

    def _on_play_click(self):
        if self.on_play:
            self.on_play()

    def _on_pause_click(self):
        if self.on_pause:
            self.on_pause()

    def _on_skip_click(self):
        if self.on_skip:
            self.on_skip()

    def _on_volume_change(self, value):
        volume = int(float(value))
        self.volume_value.config(text=f"{volume}%")
        if self.on_volume_change:
            self.on_volume_change(volume / 100)

    def update_song(self, song_name: str, is_playing: bool = True):
        """Atualiza música atual na interface"""
        self.song_label.config(text=song_name if song_name else "Nenhuma música")
        self.playing_label.config(text="▶ Tocando" if is_playing else "⏸ Pausado")

    def update_volume(self, volume: float):
        """Atualiza volume na interface"""
        volume_percent = int(volume * 100)
        self.volume_scale.set(volume_percent)
        self.volume_value.config(text=f"{volume_percent}%")

    def update_status(self, connected: bool, status_text: str = None):
        """Atualiza status de conexão"""
        if connected:
            self.status_indicator.config(fg=self.success_color)
            self.status_label.config(text=status_text or "Conectado")
        else:
            self.status_indicator.config(fg="#ff4444")
            self.status_label.config(text=status_text or "Desconectado")

    def update_sync_info(self, text: str):
        """Atualiza informação de sincronização"""
        self.sync_label.config(text=text)

    def run(self):
        """Inicia o loop principal da GUI"""
        self.root.mainloop()

    def schedule(self, ms: int, callback: Callable):
        """Agenda uma função para executar após X milissegundos"""
        self.root.after(ms, callback)

    def quit(self):
        """Fecha a aplicação"""
        self.root.quit()
        self.root.destroy()

    def _open_settings(self):
        """Abre janela de configurações"""
        settings_window = tk.Toplevel(self.root)
        settings_window.title("Configurações")
        settings_window.geometry("400x200")
        settings_window.configure(bg=self.bg_color)
        settings_window.resizable(False, False)

        # Frame principal
        frame = tk.Frame(settings_window, bg=self.bg_color, padx=20, pady=20)
        frame.pack(fill=tk.BOTH, expand=True)

        # Label do servidor
        lbl_server = tk.Label(
            frame,
            text="Endereço do Servidor:",
            font=("Segoe UI", 10),
            fg=self.fg_color,
            bg=self.bg_color
        )
        lbl_server.pack(anchor="w", pady=(0, 5))

        # Entry do servidor
        entry_server = tk.Entry(
            frame,
            font=("Segoe UI", 10),
            bg="#3a3a5e",
            fg=self.fg_color,
            insertbackground=self.fg_color
        )
        entry_server.insert(0, SERVER_URL)
        entry_server.pack(fill=tk.X, pady=(0, 20))

        # Botão Salvar
        def save():
            new_url = entry_server.get().strip()
            if not new_url:
                messagebox.showerror("Erro", "O endereço do servidor não pode estar vazio.", parent=settings_window)
                return

            if save_settings({"server_url": new_url}):
                messagebox.showinfo(
                    "Sucesso",
                    "Configurações salvas!\nReinicie o aplicativo para aplicar as alterações.",
                    parent=settings_window
                )
                settings_window.destroy()
            else:
                messagebox.showerror("Erro", "Falha ao salvar configurações.", parent=settings_window)

        btn_save = tk.Button(
            frame,
            text="Salvar",
            bg=self.accent_color,
            fg="#000000",
            font=("Segoe UI", 10, "bold"),
            command=save,
            cursor="hand2",
            padx=20,
            pady=5
        )
        btn_save.pack()


if __name__ == "__main__":
    app = PlayerGUI()
    app.update_song("Música de Teste.mp3", True)
    app.update_sync_info("Sincronizado: 10 baixadas | 50 músicas")
    app.update_status(True, "Conectado (Teste)")
    app.run()
