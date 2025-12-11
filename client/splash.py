"""
Splash Screen e Single Instance Lock para FalaVIP Music Player
"""

import tkinter as tk
from tkinter import ttk
import threading
import sys
import os
import tempfile
import ctypes
from pathlib import Path

# Mutex para single instance (Windows)
MUTEX_NAME = "FalaVIPMusicPlayer_SingleInstance"
mutex_handle = None


def check_single_instance():
    """Verifica se já existe uma instância rodando"""
    global mutex_handle

    try:
        # Tentar criar um mutex nomeado
        mutex_handle = ctypes.windll.kernel32.CreateMutexW(None, False, MUTEX_NAME)
        last_error = ctypes.windll.kernel32.GetLastError()

        # ERROR_ALREADY_EXISTS = 183
        if last_error == 183:
            # Já existe uma instância
            ctypes.windll.kernel32.CloseHandle(mutex_handle)
            return False
        return True
    except:
        # Fallback: usar arquivo de lock
        lock_file = Path(tempfile.gettempdir()) / "falavip_player.lock"

        if lock_file.exists():
            # Verificar se o processo ainda está rodando
            try:
                pid = int(lock_file.read_text().strip())
                # Verificar se PID existe
                ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
                return False
            except:
                pass

        # Criar lock file
        lock_file.write_text(str(os.getpid()))
        return True


def show_already_running():
    """Mostra mensagem de erro se já está rodando"""
    root = tk.Tk()
    root.withdraw()

    from tkinter import messagebox
    messagebox.showwarning(
        "FalaVIP Music Player",
        "O aplicativo já está em execução!\n\nVerifique a barra de tarefas ou a bandeja do sistema."
    )
    root.destroy()
    sys.exit(0)


class SplashScreen:
    """Tela de carregamento"""

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("FalaVIP Music Player")
        self.root.overrideredirect(True)  # Remove barra de título

        # Tamanho e posição centralizada
        width, height = 400, 250
        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        x = (screen_w - width) // 2
        y = (screen_h - height) // 2
        self.root.geometry(f"{width}x{height}+{x}+{y}")

        # Cores
        bg_color = "#0f172a"
        accent_color = "#3b82f6"
        text_color = "#f8fafc"
        text_muted = "#94a3b8"

        self.root.configure(bg=bg_color)

        # Frame principal com borda
        main_frame = tk.Frame(self.root, bg=bg_color, highlightbackground=accent_color, highlightthickness=2)
        main_frame.pack(fill=tk.BOTH, expand=True)

        # Logo/Título
        tk.Label(
            main_frame,
            text="🎵",
            font=("Segoe UI", 48),
            fg=accent_color,
            bg=bg_color
        ).pack(pady=(30, 10))

        tk.Label(
            main_frame,
            text="FalaVIP Music Player",
            font=("Segoe UI", 18, "bold"),
            fg=text_color,
            bg=bg_color
        ).pack()

        tk.Label(
            main_frame,
            text="Natal Iluminado 2025",
            font=("Segoe UI", 10),
            fg=text_muted,
            bg=bg_color
        ).pack(pady=(5, 20))

        # Status
        self.status_label = tk.Label(
            main_frame,
            text="Iniciando...",
            font=("Segoe UI", 9),
            fg=text_muted,
            bg=bg_color
        )
        self.status_label.pack()

        # Barra de progresso
        style = ttk.Style()
        style.theme_use('clam')
        style.configure(
            "Custom.Horizontal.TProgressbar",
            troughcolor=bg_color,
            background=accent_color,
            darkcolor=accent_color,
            lightcolor=accent_color,
            bordercolor=bg_color
        )

        self.progress = ttk.Progressbar(
            main_frame,
            style="Custom.Horizontal.TProgressbar",
            length=300,
            mode='determinate',
            maximum=100
        )
        self.progress.pack(pady=15)

        # Versão
        tk.Label(
            main_frame,
            text="v1.0",
            font=("Segoe UI", 8),
            fg=text_muted,
            bg=bg_color
        ).pack(side=tk.BOTTOM, pady=10)

        self.root.update()

    def update_status(self, message: str, progress: int = None):
        """Atualiza status e progresso"""
        self.status_label.config(text=message)
        if progress is not None:
            self.progress['value'] = progress
        self.root.update()

    def close(self):
        """Fecha a splash screen"""
        self.root.destroy()

    def run_with_callback(self, callback):
        """Executa callback e mantém splash visível"""
        def run():
            try:
                callback(self)
            except Exception as e:
                print(f"Erro no carregamento: {e}")
            finally:
                self.root.after(500, self.close)

        threading.Thread(target=run, daemon=True).start()
        self.root.mainloop()
