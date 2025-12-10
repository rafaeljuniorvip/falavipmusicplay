"""
Agendador de volumes e propagandas
"""

import threading
import time
from datetime import datetime, timedelta
from typing import Callable, Optional


class Scheduler:
    def __init__(self):
        # Agendamentos de volume
        self.volume_schedules: list[dict] = []

        # Propagandas agendadas
        self.ad_schedules: list[dict] = []

        # Músicas agendadas por horário
        self.scheduled_songs: list[dict] = []

        # Último horário que cada propaganda tocou
        self.last_ad_played: dict[int, datetime] = {}

        # Callbacks
        self.on_volume_change: Optional[Callable[[float], None]] = None
        self.on_play_ad: Optional[Callable[[str], None]] = None
        self.on_play_song: Optional[Callable[[str], None]] = None

        # Thread de monitoramento
        self._scheduler_thread: Optional[threading.Thread] = None
        self._running: bool = False

        # Volume atual (para comparação)
        self._current_scheduled_volume: Optional[float] = None

    def update_schedules(self, volume_schedules: list, ad_schedules: list, scheduled_songs: list):
        """Atualiza todos os agendamentos"""
        self.volume_schedules = volume_schedules
        self.ad_schedules = ad_schedules
        self.scheduled_songs = scheduled_songs

    def _time_str_to_minutes(self, time_str: str) -> int:
        """Converte HH:MM para minutos desde meia-noite"""
        parts = time_str.split(':')
        return int(parts[0]) * 60 + int(parts[1])

    def _get_current_minutes(self) -> int:
        """Retorna minutos desde meia-noite"""
        now = datetime.now()
        return now.hour * 60 + now.minute

    def _check_volume_schedule(self):
        """Verifica se deve ajustar o volume"""
        current_minutes = self._get_current_minutes()

        for schedule in self.volume_schedules:
            start = self._time_str_to_minutes(schedule['time_start'])
            end = self._time_str_to_minutes(schedule['time_end'])
            volume = schedule['volume']

            # Verificar se estamos no intervalo
            in_range = False
            if start <= end:
                # Intervalo normal (ex: 08:00 - 18:00)
                in_range = start <= current_minutes <= end
            else:
                # Intervalo que cruza meia-noite (ex: 22:00 - 06:00)
                in_range = current_minutes >= start or current_minutes <= end

            if in_range and self._current_scheduled_volume != volume:
                self._current_scheduled_volume = volume
                if self.on_volume_change:
                    self.on_volume_change(volume)
                return

    def _check_ad_schedule(self):
        """Verifica se deve tocar propaganda"""
        now = datetime.now()

        for schedule in self.ad_schedules:
            if not schedule.get('enabled', True):
                continue

            schedule_id = schedule['id']
            interval = schedule['interval_minutes']
            music_id = schedule['music_id']

            # Verificar última vez que tocou
            last_played = self.last_ad_played.get(schedule_id)

            if last_played is None or (now - last_played).total_seconds() >= interval * 60:
                self.last_ad_played[schedule_id] = now
                if self.on_play_ad:
                    self.on_play_ad(music_id)
                return  # Tocar apenas uma propaganda por vez

    def _check_scheduled_songs(self):
        """Verifica se deve tocar música agendada"""
        now = datetime.now()
        current_time = now.strftime('%H:%M')

        for schedule in self.scheduled_songs:
            scheduled_time = schedule['scheduled_time']

            # Verificar se é o horário (com tolerância de 1 minuto)
            if scheduled_time == current_time:
                # Verificar se já tocou neste minuto
                schedule_key = f"song_{schedule['id']}"
                last_played = self.last_ad_played.get(schedule_key)

                if last_played is None or (now - last_played).total_seconds() >= 60:
                    self.last_ad_played[schedule_key] = now
                    if self.on_play_song:
                        self.on_play_song(schedule['music_id'])
                    return

    def _scheduler_loop(self):
        """Loop principal do agendador"""
        while self._running:
            try:
                self._check_volume_schedule()
                self._check_ad_schedule()
                self._check_scheduled_songs()
            except Exception as e:
                print(f"Erro no scheduler: {e}")

            time.sleep(10)  # Verificar a cada 10 segundos

    def start(self):
        """Inicia o agendador"""
        if self._scheduler_thread and self._scheduler_thread.is_alive():
            return

        self._running = True
        self._scheduler_thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self._scheduler_thread.start()

    def stop(self):
        """Para o agendador"""
        self._running = False
        if self._scheduler_thread:
            self._scheduler_thread.join(timeout=1)
