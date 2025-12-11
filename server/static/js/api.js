const API = {
    baseUrl: '/api',

    async getMusicList() {
        const res = await fetch(`${this.baseUrl}/music/list`);
        return await res.json();
    },

    async uploadMusic(file, isAd = false) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('is_ad', isAd);

        const res = await fetch(`${this.baseUrl}/music/upload`, {
            method: 'POST',
            body: formData
        });
        return await res.json();
    },

    async deleteMusic(id) {
        const res = await fetch(`${this.baseUrl}/music/${id}`, {
            method: 'DELETE'
        });
        return await res.json();
    },

    async updateMusic(id, data) {
        const res = await fetch(`${this.baseUrl}/music/${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        return await res.json();
    },

    async getSettings() {
        const res = await fetch(`${this.baseUrl}/settings`);
        return await res.json();
    },

    // Player Controls
    async play() {
        return await this.post('/player/play');
    },

    async pause() {
        return await this.post('/player/pause');
    },

    async next(musicId) {
        return await this.post('/player/next', { music_id: musicId });
    },

    async skip() {
        return await this.post('/player/skip');
    },

    async setVolume(volume) {
        return await this.post('/settings/volume', { volume });
    },

    // Volume Schedules (Time-based Periods with Gradient Support)
    async addVolumeSchedule(start, end, volume, isGradient = false, volumeStart = null, volumeEnd = null) {
        return await this.post('/settings/volume-schedule', {
            time_start: start,
            time_end: end,
            volume: volume,
            is_gradient: isGradient,
            volume_start: volumeStart,
            volume_end: volumeEnd
        });
    },

    async updateVolumeSchedule(id, start, end, volume, isGradient = false, volumeStart = null, volumeEnd = null) {
        return await this.put(`/settings/volume-schedule/${id}`, {
            time_start: start,
            time_end: end,
            volume: volume,
            is_gradient: isGradient,
            volume_start: volumeStart,
            volume_end: volumeEnd
        });
    },

    async deleteVolumeSchedule(id) {
        return await this.delete(`/settings/volume-schedule/${id}`);
    },

    // Hourly Volumes
    async getHourlyVolumes() {
        const res = await fetch(`${this.baseUrl}/settings/hourly-volumes`);
        return await res.json();
    },

    async setHourlyVolumes(volumes) {
        return await this.post('/settings/hourly-volumes', { volumes });
    },

    // Ad Schedules
    async addAdSchedule(musicId, intervalType, intervalValue) {
        return await this.post('/settings/ad-schedule', {
            music_id: musicId,
            interval_type: intervalType,
            interval_value: intervalValue,
            enabled: true
        });
    },

    async updateAdSchedule(id, musicId, intervalType, intervalValue, enabled = true) {
        return await this.put(`/settings/ad-schedule/${id}`, {
            music_id: musicId,
            interval_type: intervalType,
            interval_value: intervalValue,
            enabled: enabled
        });
    },

    async deleteAdSchedule(id) {
        return await this.delete(`/settings/ad-schedule/${id}`);
    },

    async toggleAdSchedule(id) {
        return await this.post(`/settings/ad-schedule/${id}/toggle`);
    },

    // Scheduled Songs
    async addScheduledSong(musicId, time, repeatDaily) {
        return await this.post('/settings/scheduled-song', {
            music_id: musicId,
            time: time,
            repeat_daily: repeatDaily
        });
    },

    async deleteScheduledSong(id) {
        return await this.delete(`/settings/scheduled-song/${id}`);
    },

    // Schedule Preview
    async getSchedulePreview(hours = 24) {
        const res = await fetch(`${this.baseUrl}/schedules/preview?hours=${hours}`);
        return await res.json();
    },

    // Logs
    async getLogs(type = null, limit = 50, offset = 0) {
        let url = `${this.baseUrl}/logs?limit=${limit}&offset=${offset}`;
        if (type && type !== 'all') {
            url += `&type=${type}`;
        }
        const res = await fetch(url);
        return await res.json();
    },

    async createLog(type, description, details = null) {
        return await this.post('/logs', { type, description, details });
    },

    async clearLogs(beforeDays = 30) {
        const res = await fetch(`${this.baseUrl}/logs?before_days=${beforeDays}`, {
            method: 'DELETE'
        });
        return await res.json();
    },

    // Generic Helpers
    async post(endpoint, data = {}) {
        const res = await fetch(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        return await res.json();
    },

    async put(endpoint, data = {}) {
        const res = await fetch(`${this.baseUrl}${endpoint}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        return await res.json();
    },

    async delete(endpoint) {
        const res = await fetch(`${this.baseUrl}${endpoint}`, {
            method: 'DELETE'
        });
        return await res.json();
    },

    // AI Classification
    async getAIStatus() {
        const res = await fetch(`${this.baseUrl}/ai/status`);
        return await res.json();
    },

    async classifyMusic(musicId) {
        return await this.post(`/ai/classify/${musicId}`);
    },

    async classifyAllMusic() {
        return await this.post('/ai/classify-all');
    },

    async getMusicMetadata(musicId) {
        const res = await fetch(`${this.baseUrl}/music/${musicId}/metadata`);
        return await res.json();
    },

    async getAllMusicMetadata() {
        const res = await fetch(`${this.baseUrl}/music/metadata/all`);
        return await res.json();
    },

    async updateMusicMetadata(musicId, data) {
        return await this.put(`/music/${musicId}/metadata`, data);
    },

    async getArtists() {
        const res = await fetch(`${this.baseUrl}/music/artists`);
        return await res.json();
    },

    async getGenres() {
        const res = await fetch(`${this.baseUrl}/music/genres`);
        return await res.json();
    },

    async getMusicByArtist(artist) {
        const res = await fetch(`${this.baseUrl}/music/by-artist/${encodeURIComponent(artist)}`);
        return await res.json();
    },

    async getMusicByGenre(genre) {
        const res = await fetch(`${this.baseUrl}/music/by-genre/${encodeURIComponent(genre)}`);
        return await res.json();
    },

    async deleteMusicMetadata(musicId) {
        return await this.delete(`/music/${musicId}/metadata`);
    },

    async clearAllMetadata() {
        return await this.delete('/ai/clear-all-metadata');
    }
};
