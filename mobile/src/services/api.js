import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@falavip_server_url';
const DEFAULT_URL = 'https://falavipmusic.viptecnologia.com.br';

class ApiService {
  constructor() {
    this.baseUrl = DEFAULT_URL;
    this.loadServerUrl();
  }

  async loadServerUrl() {
    try {
      const url = await AsyncStorage.getItem(STORAGE_KEY);
      if (url) {
        this.baseUrl = url;
      }
    } catch (e) {
      console.error('Error loading server URL:', e);
    }
  }

  async setServerUrl(url) {
    this.baseUrl = url.replace(/\/$/, '');
    await AsyncStorage.setItem(STORAGE_KEY, this.baseUrl);
  }

  getServerUrl() {
    return this.baseUrl;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}/api${endpoint}`;
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`API Error (${endpoint}):`, error);
      throw error;
    }
  }

  async get(endpoint) {
    return this.request(endpoint);
  }

  async post(endpoint, data = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async put(endpoint, data = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async patch(endpoint, data = {}) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async delete(endpoint) {
    return this.request(endpoint, {
      method: 'DELETE',
    });
  }

  // Player controls
  async getPlayerStatus() {
    return this.get('/player/status');
  }

  async play() {
    return this.post('/player/play');
  }

  async pause() {
    return this.post('/player/pause');
  }

  async skip() {
    return this.post('/player/skip');
  }

  async setVolume(volume) {
    return this.post('/settings/volume', { volume });
  }

  // Settings & Schedules
  async getSettings() {
    return this.get('/settings');
  }

  async getHourlyVolumes() {
    return this.get('/settings/hourly-volumes');
  }

  async setHourlyVolumes(volumes) {
    return this.post('/settings/hourly-volumes', { volumes });
  }

  // Volume Schedules (time-based with minutes, with gradient support)
  async addVolumeSchedule(timeStart, timeEnd, volume, isGradient = false, volumeStart = null, volumeEnd = null) {
    return this.post('/settings/volume-schedule', {
      time_start: timeStart,
      time_end: timeEnd,
      volume: volume,
      is_gradient: isGradient,
      volume_start: volumeStart,
      volume_end: volumeEnd,
    });
  }

  async updateVolumeSchedule(scheduleId, timeStart, timeEnd, volume, isGradient = false, volumeStart = null, volumeEnd = null) {
    return this.put(`/settings/volume-schedule/${scheduleId}`, {
      time_start: timeStart,
      time_end: timeEnd,
      volume: volume,
      is_gradient: isGradient,
      volume_start: volumeStart,
      volume_end: volumeEnd,
    });
  }

  async deleteVolumeSchedule(scheduleId) {
    return this.delete(`/settings/volume-schedule/${scheduleId}`);
  }

  // Playlist
  async getPlaylist() {
    return this.get('/playlist');
  }

  async getPlaylistPreview(hours = 24) {
    return this.get(`/schedules/preview?hours=${hours}`);
  }

  async insertSongNext(musicId) {
    return this.post('/playlist/insert-next', { music_id: musicId });
  }

  async regeneratePlaylist() {
    return this.post('/playlist/generate');
  }

  // Music
  async getMusicList() {
    return this.get('/music/list');
  }

  async uploadMusic(fileUri, fileName, isAd = false) {
    const url = `${this.baseUrl}/api/music/upload`;
    const formData = new FormData();
    formData.append('file', {
      uri: fileUri,
      name: fileName,
      type: 'audio/mpeg',
    });
    formData.append('is_ad', isAd ? 'true' : 'false');

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
    return await response.json();
  }

  async updateMusic(musicId, data) {
    return this.patch(`/music/${musicId}`, data);
  }

  async deleteMusic(musicId) {
    return this.delete(`/music/${musicId}`);
  }

  // Logs
  async getLogs(limit = 100, offset = 0, type = null) {
    let endpoint = `/logs?limit=${limit}&offset=${offset}`;
    if (type) {
      endpoint += `&type=${type}`;
    }
    return this.get(endpoint);
  }

  // Ad Schedules (Patrocinadores)
  async addAdSchedule(musicId, intervalType, intervalValue, enabled = true) {
    return this.post('/settings/ad-schedule', {
      music_id: musicId,
      interval_type: intervalType,
      interval_value: intervalValue,
      enabled: enabled,
    });
  }

  async deleteAdSchedule(scheduleId) {
    return this.delete(`/settings/ad-schedule/${scheduleId}`);
  }

  async toggleAdSchedule(scheduleId) {
    return this.post(`/settings/ad-schedule/${scheduleId}/toggle`);
  }

  async updateAdSchedule(scheduleId, musicId, intervalType, intervalValue, enabled = true) {
    return this.put(`/settings/ad-schedule/${scheduleId}`, {
      music_id: musicId,
      interval_type: intervalType,
      interval_value: intervalValue,
      enabled: enabled,
    });
  }

  // Scheduled Songs
  async getScheduledSongs() {
    return this.get('/settings/scheduled-songs');
  }

  // TTS (Text-to-Speech) - ElevenLabs
  async getTTSStatus() {
    return this.get('/tts/status');
  }

  async getTTSVoices() {
    return this.get('/tts/voices');
  }

  async generateTTS(text, voiceId, options = {}) {
    return this.post('/tts/generate', {
      text,
      voice_id: voiceId,
      model_id: options.modelId || 'eleven_multilingual_v2',
      stability: options.stability || 0.5,
      similarity_boost: options.similarityBoost || 0.75,
      name: options.name || null,
      is_ad: options.isAd || false,
    });
  }

  // Audio Mixing (TTS + Background Music)
  async generateMixedAudio(options) {
    return this.post('/tts/mix', {
      text: options.text,
      voice_id: options.voiceId,
      model_id: options.modelId || 'eleven_multilingual_v2',
      stability: options.stability || 0.5,
      similarity_boost: options.similarityBoost || 0.75,
      background_music_id: options.backgroundMusicId,
      intro_duration: options.introDuration || 5.0,
      outro_duration: options.outroDuration || 5.0,
      fade_out_duration: options.fadeOutDuration || 3.0,
      music_volume: options.musicVolume || 1.0,
      music_ducking_volume: options.musicDuckingVolume || 0.2,
      voice_volume: options.voiceVolume || 1.0,
      fade_duration: options.fadeDuration || 0.5,
      name: options.name || null,
      is_ad: options.isAd !== undefined ? options.isAd : true,
    });
  }

  async previewMixTiming(backgroundMusicId, textLength, introDuration, outroDuration, fadeOutDuration) {
    const params = new URLSearchParams({
      background_music_id: backgroundMusicId,
      text_length: textLength,
      intro_duration: introDuration,
      outro_duration: outroDuration,
      fade_out_duration: fadeOutDuration,
    });
    return this.get(`/tts/mix/preview-timing?${params}`);
  }

  async addScheduledSong(musicId, time) {
    return this.post('/settings/scheduled-song', {
      music_id: musicId,
      time: time,
    });
  }

  async deleteScheduledSong(scheduleId) {
    return this.delete(`/settings/scheduled-song/${scheduleId}`);
  }
}

export default new ApiService();
