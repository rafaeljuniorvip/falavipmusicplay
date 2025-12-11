"""
Agendador de volumes e propagandas
"""

import threading
import time
from datetime import datetime, timedelta
from typing import Callable, Optional


class Scheduler:
    def __init__(self):
        # Agendamentos de volume (range-based)
        self.volume_schedules: list[dict] = []

        # Volumes por hora (0-23 -> volume)
        self.hourly_volumes: dict = {}

        # Propagandas agendadas
        self.ad_schedules: list[dict] = []

        # Músicas agendadas por horário
        self.scheduled_songs: list[dict] = []

        # Último horário que cada propaganda tocou
        self.last_ad_played: dict = {}

        # Contador de músicas para propagandas "a cada X músicas"
        self.songs_played_count: int = 0

        # Índice de rotação para múltiplas propagandas
        self.current_ad_rotation_index: int = 0

        # Callbacks
        self.on_volume_change: Optional[Callable[[float], None]] = None
        self.on_play_ad: Optional[Callable[[str], None]] = None
        self.on_play_song: Optional[Callable[[str], None]] = None

        # Thread de monitoramento
        self._scheduler_thread: Optional[threading.Thread] = None
        self._running: bool = False

        # Volume atual (para comparação)
        self._current_scheduled_volume: Optional[float] = None
        self._last_hour_checked: int = -1

    def update_schedules(self, volume_schedules: list, ad_schedules: list,
                        scheduled_songs: list, hourly_volumes: dict = None):
        """Atualiza todos os agendamentos"""
        self.volume_schedules = volume_schedules
        self.ad_schedules = ad_schedules
        self.scheduled_songs = scheduled_songs
        if hourly_volumes:
            self.hourly_volumes = hourly_volumes
        print(f"Schedules atualizados: {len(ad_schedules)} ads, {len(scheduled_songs)} músicas, {len(hourly_volumes or {})} volumes/hora")

    def on_song_finished(self):
        """Chamado quando uma música termina de tocar"""
        self.songs_played_count += 1
        print(f"Músicas tocadas: {self.songs_played_count}")
        self._check_song_based_ads()

    def _time_str_to_minutes(self, time_str: str) -> int:
        """Converte HH:MM para minutos desde meia-noite"""
        parts = time_str.split(':')
        return int(parts[0]) * 60 + int(parts[1])

    def _get_current_minutes(self) -> int:
        """Retorna minutos desde meia-noite"""
        now = datetime.now()
        return now.hour * 60 + now.minute

    def _check_hourly_volume(self):
        """Verifica e aplica volume por hora"""
        current_hour = datetime.now().hour

        # Só verifica se mudou de hora
        if current_hour == self._last_hour_checked:
            return

        self._last_hour_checked = current_hour

        # Busca volume para a hora atual
        volume = self.hourly_volumes.get(current_hour) or self.hourly_volumes.get(str(current_hour))

        if volume is not None:
            if self._current_scheduled_volume != volume:
                self._current_scheduled_volume = volume
                print(f"Aplicando volume da hora {current_hour}: {int(volume * 100)}%")
                if self.on_volume_change:
                    self.on_volume_change(volume)

    def _check_volume_schedule(self):
        """Verifica agendamentos de volume (range-based) com suporte a gradiente"""
        if not self.volume_schedules:
            return

        current_minutes = self._get_current_minutes()

        for schedule in self.volume_schedules:
            start = self._time_str_to_minutes(schedule['time_start'])
            end = self._time_str_to_minutes(schedule['time_end'])

            # Verificar se estamos no intervalo
            in_range = False
            if start <= end:
                in_range = start <= current_minutes <= end
            else:
                # Intervalo que cruza meia-noite
                in_range = current_minutes >= start or current_minutes <= end

            if in_range:
                # Verificar se é gradiente
                is_gradient = schedule.get('is_gradient', False)

                if is_gradient:
                    # Calcular volume interpolado
                    volume_start = schedule.get('volume_start', schedule['volume'])
                    volume_end = schedule.get('volume_end', schedule['volume'])

                    # Calcular posição relativa no intervalo (0.0 a 1.0)
                    if start <= end:
                        total_minutes = end - start
                        elapsed = current_minutes - start
                    else:
                        # Intervalo que cruza meia-noite
                        total_minutes = (1440 - start) + end  # 1440 = 24*60
                        if current_minutes >= start:
                            elapsed = current_minutes - start
                        else:
                            elapsed = (1440 - start) + current_minutes

                    if total_minutes > 0:
                        progress = elapsed / total_minutes
                        volume = volume_start + (volume_end - volume_start) * progress
                    else:
                        volume = volume_start
                else:
                    # Volume fixo
                    volume = schedule['volume']

                # Arredondar para evitar atualizações desnecessárias
                volume = round(volume, 3)

                if self._current_scheduled_volume != volume:
                    self._current_scheduled_volume = volume
                    print(f"Volume agendado: {int(volume * 100)}% {'(gradiente)' if is_gradient else ''}")
                    if self.on_volume_change:
                        self.on_volume_change(volume)
                return

    def _get_time_based_ads(self) -> list[dict]:
        """Retorna propagandas baseadas em tempo"""
        return [
            ad for ad in self.ad_schedules
            if ad.get('enabled', True) and
               (ad.get('interval_type', 'minutes') == 'minutes' or ad.get('interval_type') is None)
        ]

    def _get_song_based_ads(self) -> list[dict]:
        """Retorna propagandas baseadas em contagem de músicas"""
        return [
            ad for ad in self.ad_schedules
            if ad.get('enabled', True) and ad.get('interval_type') == 'songs'
        ]

    def _check_ad_schedule(self):
        """Verifica propagandas baseadas em tempo"""
        now = datetime.now()
        time_ads = self._get_time_based_ads()

        if not time_ads:
            return

        # Ordena por rotation_order para rotação sequencial
        time_ads.sort(key=lambda x: x.get('rotation_order', 0))

        for schedule in time_ads:
            schedule_id = schedule['id']
            interval = schedule.get('interval_value') or schedule.get('interval_minutes', 30)
            music_id = schedule['music_id']

            last_played = self.last_ad_played.get(f"time_{schedule_id}")

            if last_played is None or (now - last_played).total_seconds() >= interval * 60:
                self.last_ad_played[f"time_{schedule_id}"] = now
                print(f"Tocando propaganda (tempo): {music_id}")
                if self.on_play_ad:
                    self.on_play_ad(music_id)
                return  # Uma propaganda por vez

    def _check_song_based_ads(self):
        """Verifica propagandas baseadas em contagem de músicas"""
        song_ads = self._get_song_based_ads()

        if not song_ads:
            return

        # Ordena por rotation_order para rotação sequencial
        song_ads.sort(key=lambda x: x.get('rotation_order', 0))

        # Encontra o menor intervalo configurado
        min_interval = min(
            ad.get('interval_value', 5)
            for ad in song_ads
        )

        if self.songs_played_count >= min_interval:
            # Pega a próxima propaganda na rotação
            ad_index = self.current_ad_rotation_index % len(song_ads)
            ad_to_play = song_ads[ad_index]

            # Reseta contador e avança rotação
            self.songs_played_count = 0
            self.current_ad_rotation_index += 1

            print(f"Tocando propaganda (músicas): {ad_to_play['music_id']} (rotação {ad_index + 1}/{len(song_ads)})")
            if self.on_play_ad:
                self.on_play_ad(ad_to_play['music_id'])

    def _check_scheduled_songs(self):
        """Verifica se deve tocar música agendada"""
        now = datetime.now()
        current_time = now.strftime('%H:%M')

        for schedule in self.scheduled_songs:
            scheduled_time = schedule['scheduled_time']

            if scheduled_time == current_time:
                schedule_key = f"song_{schedule['id']}"
                last_played = self.last_ad_played.get(schedule_key)

                if last_played is None or (now - last_played).total_seconds() >= 60:
                    self.last_ad_played[schedule_key] = now
                    print(f"Tocando música agendada: {schedule['music_id']}")
                    if self.on_play_song:
                        self.on_play_song(schedule['music_id'])
                    return

    def _scheduler_loop(self):
        """Loop principal do agendador"""
        while self._running:
            try:
                self._check_hourly_volume()
                self._check_volume_schedule()
                self._check_ad_schedule()
                self._check_scheduled_songs()
            except Exception as e:
                print(f"Erro no scheduler: {e}")

            time.sleep(10)

    def start(self):
        """Inicia o agendador"""
        if self._scheduler_thread and self._scheduler_thread.is_alive():
            return

        self._running = True
        self._scheduler_thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self._scheduler_thread.start()
        print("Scheduler iniciado")

    def stop(self):
        """Para o agendador"""
        self._running = False
        if self._scheduler_thread:
            self._scheduler_thread.join(timeout=1)
        print("Scheduler parado")
