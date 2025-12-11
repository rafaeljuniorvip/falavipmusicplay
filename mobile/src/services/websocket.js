import api from './api';

class WebSocketService {
  constructor() {
    this.ws = null;
    this.reconnectTimeout = null;
    this.listeners = {
      connect: [],
      disconnect: [],
      playerStatus: [],
      playlistUpdated: [],
      scheduleUpdated: [],
      musicUpdated: [],
    };
  }

  connect() {
    const httpUrl = api.getServerUrl();
    const wsUrl = httpUrl.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws';

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.emit('connect');
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.emit('disconnect');
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error('Error parsing message:', e);
        }
      };
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.scheduleReconnect();
    }
  }

  handleMessage(data) {
    switch (data.type) {
      case 'init':
      case 'player_status':
        this.emit('playerStatus', data);
        break;
      case 'playlist_updated':
      case 'playlist_generated':
        this.emit('playlistUpdated', data);
        break;
      case 'schedule_updated':
        this.emit('scheduleUpdated', data);
        break;
      case 'music_updated':
      case 'music_added':
      case 'music_deleted':
        this.emit('musicUpdated', data);
        break;
      default:
        // Silently ignore other message types
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.reconnectTimeout = setTimeout(() => {
      console.log('Attempting to reconnect...');
      this.connect();
    }, 5000);
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(data));
    }
  }
}

export default new WebSocketService();
