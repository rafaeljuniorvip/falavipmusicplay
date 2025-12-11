// ============ STATE ============
const state = {
    currentSong: null,
    isPlaying: false,
    volume: 50,
    connected: false,
    musicList: [],
    filteredMusic: [],
    currentFilter: 'all',
    searchQuery: '',
    hourlyVolumes: {},
    adSchedules: [],
    scheduledSongs: [],
    volumeSchedules: [], // Time-based volume periods
    editingMusicId: null,
    editingAdId: null,    // For ad schedule editing
    editingPeriodId: null, // For period editing
    periodIsGradient: false, // Gradient mode toggle
    confirmCallback: null,
    // Upload
    uploadAsAd: false,
    // Logs
    logs: [],
    logsFilter: 'all',
    logsPage: 1,
    logsPerPage: 50,
    logsTotal: 0
};

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
    // Verificar URL inicial
    const initialView = getViewFromURL() || 'dashboard';
    navigateTo(initialView, false);

    initWebSocket();
    setupEventListeners();
    setupScheduleListeners();
    setupPeriodsListeners();
    setupMusicLibraryListeners();
    setupPreviewListeners();
    setupSettingsListeners();
    setupLogsListeners();

    // Listener para botões voltar/avançar do navegador
    window.addEventListener('popstate', (event) => {
        const view = event.state?.view || getViewFromURL() || 'dashboard';
        navigateTo(view, false);
    });
});

function getViewFromURL() {
    const hash = window.location.hash.slice(1); // Remove o #
    const validViews = ['dashboard', 'music', 'schedules', 'preview', 'logs', 'settings'];
    return validViews.includes(hash) ? hash : null;
}

// ============ EVENT LISTENERS ============
function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const view = e.currentTarget.dataset.view;
            navigateTo(view);
        });
    });

    // Main Player Controls
    document.getElementById('btn-play')?.addEventListener('click', () => {
        API.play();
    });
    document.getElementById('btn-pause')?.addEventListener('click', () => {
        API.pause();
    });
    document.getElementById('btn-skip')?.addEventListener('click', () => {
        API.skip();
    });
    document.getElementById('btn-prev')?.addEventListener('click', () => {
        // Not implemented - placeholder
    });

    // Sidebar Player Controls
    document.getElementById('sidebar-btn-play')?.addEventListener('click', () => {
        API.play();
    });
    document.getElementById('sidebar-btn-pause')?.addEventListener('click', () => {
        API.pause();
    });
    document.getElementById('sidebar-btn-skip')?.addEventListener('click', () => {
        API.skip();
    });

    // Volume Slider
    const volSlider = document.getElementById('volume-slider');
    volSlider?.addEventListener('input', (e) => {
        const value = e.target.value;
        document.getElementById('volume-value').textContent = `${value}%`;
    });
    volSlider?.addEventListener('change', (e) => {
        API.setVolume(parseFloat(e.target.value) / 100);
    });
}

function setupMusicLibraryListeners() {
    // File Upload
    document.getElementById('file-upload')?.addEventListener('change', handleFileUpload);
    document.getElementById('drop-zone-input')?.addEventListener('change', handleFileUpload);

    // Drop Zone
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            uploadFiles(files);
        });
    }

    // Search
    document.getElementById('music-search')?.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.toLowerCase();
        filterMusicList();
    });

    // Filter Buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            state.currentFilter = e.target.dataset.filter;
            filterMusicList();
        });
    });

    // Toggle Buttons for Edit Modal
    document.getElementById('toggle-music')?.addEventListener('click', () => {
        document.getElementById('toggle-music').classList.add('active');
        document.getElementById('toggle-ad').classList.remove('active');
    });
    document.getElementById('toggle-ad')?.addEventListener('click', () => {
        document.getElementById('toggle-ad').classList.add('active');
        document.getElementById('toggle-music').classList.remove('active');
    });
}

function setupSettingsListeners() {
    document.getElementById('import-file')?.addEventListener('change', handleImportSchedules);
}

// ============ ROUTER ============
function navigateTo(viewName, updateURL = true) {
    // Update page title
    const titles = {
        dashboard: 'Painel de Controle',
        music: 'Biblioteca de Músicas',
        schedules: 'Agendamentos',
        preview: 'Preview da Programação',
        logs: 'Logs de Atividade',
        settings: 'Configurações'
    };
    document.getElementById('page-title').textContent = titles[viewName] || viewName;

    // Update URL
    if (updateURL) {
        const newURL = `#${viewName}`;
        history.pushState({ view: viewName }, titles[viewName], newURL);
    }

    // Update Sidebar
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Hide all views
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));

    // Show target view
    const target = document.getElementById(`view-${viewName}`);
    if (target) {
        target.classList.add('active');

        // Load data specific to view
        if (viewName === 'dashboard') loadDashboard();
        if (viewName === 'music') loadMusicLibrary();
        if (viewName === 'schedules') loadSchedules();
        if (viewName === 'preview') loadPreview();
        if (viewName === 'logs') loadLogs();
        if (viewName === 'settings') {
            loadSettings();
            updatePlaylistStatus();
        }
    }
}

// ============ DASHBOARD ============
async function loadDashboard() {
    try {
        const [music, settings, preview] = await Promise.all([
            API.getMusicList(),
            API.getSettings(),
            API.getSchedulePreview(6) // Next 6 hours
        ]);

        state.musicList = music;

        // Stats
        const totalSongs = music.filter(m => !m.is_ad).length;
        const totalAds = music.filter(m => m.is_ad).length;
        const activeSchedules = (settings.ad_schedules?.length || 0) +
                               (settings.scheduled_songs?.length || 0);

        document.getElementById('stat-total-songs').textContent = totalSongs;
        document.getElementById('stat-total-ads').textContent = totalAds;
        document.getElementById('stat-active-schedules').textContent = activeSchedules;

        // Player Status
        updatePlayerUI(settings.player_status);

        // Upcoming Events
        renderUpcomingEvents(preview);
    } catch (err) {
        console.error('Error loading dashboard:', err);
    }
}

function renderUpcomingEvents(preview) {
    const container = document.getElementById('upcoming-events-list');
    if (!container) return;

    if (!preview?.events || preview.events.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Nenhum evento próximo</p></div>';
        return;
    }

    container.innerHTML = '';

    const typeLabels = {
        volume: 'Volume',
        ad: 'Propaganda',
        scheduled_song: 'Agendada',
        random_music: 'Aleatória',
        song: 'Música',
        info: 'Info'
    };

    // Mostrar todos os eventos (incluindo músicas aleatórias)
    // Limitar a 10 eventos para não poluir o dashboard
    preview.events.slice(0, 10).forEach(event => {
        const time = new Date(event.time).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });

        const item = document.createElement('div');
        item.className = 'event-item';
        item.innerHTML = `
            <span class="event-time">${time}</span>
            <span class="event-type ${event.type}">${typeLabels[event.type] || event.type}</span>
            <span class="event-description">${event.description || ''}</span>
        `;
        container.appendChild(item);
    });
}

// ============ MUSIC LIBRARY ============
async function loadMusicLibrary() {
    try {
        const music = await API.getMusicList();
        state.musicList = music;
        state.filteredMusic = music;
        filterMusicList();
    } catch (err) {
        console.error('Error loading music library:', err);
        showToast('Erro ao carregar biblioteca', 'error');
    }
}

function filterMusicList() {
    let filtered = state.musicList;

    // Apply type filter
    if (state.currentFilter === 'music') {
        filtered = filtered.filter(m => !m.is_ad);
    } else if (state.currentFilter === 'ad') {
        filtered = filtered.filter(m => m.is_ad);
    }

    // Apply search
    if (state.searchQuery) {
        filtered = filtered.filter(m =>
            m.original_name.toLowerCase().includes(state.searchQuery)
        );
    }

    state.filteredMusic = filtered;
    renderMusicTable();
}

function renderMusicTable() {
    const tbody = document.getElementById('music-table-body');
    if (!tbody) return;

    if (state.filteredMusic.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    <div class="empty-state-icon">🎵</div>
                    <p>Nenhuma música encontrada</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '';
    state.filteredMusic.forEach(song => {
        const tr = document.createElement('tr');
        const durationStr = song.duration ? formatTime(song.duration) : '-';
        tr.innerHTML = `
            <td>
                <button class="btn-icon" onclick="playSong('${song.id}')" title="Reproduzir">▶</button>
                <button class="btn-icon" onclick="insertSongNext('${song.id}', '${song.original_name.replace(/'/g, "\\'")}')" title="Tocar como próxima">⏭</button>
            </td>
            <td>${song.original_name}</td>
            <td>
                <span class="badge ${song.is_ad ? 'ad' : 'music'}">
                    ${song.is_ad ? '📢 Propaganda' : '🎵 Música'}
                </span>
            </td>
            <td>${durationStr}</td>
            <td>${new Date(song.created_at).toLocaleDateString('pt-BR')}</td>
            <td>
                <button class="btn-icon" onclick="editMusic('${song.id}')" title="Editar">✏️</button>
                <button class="btn-icon delete" onclick="confirmDeleteMusic('${song.id}')" title="Excluir">🗑</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function handleFileUpload(e) {
    const files = e.target.files;
    if (files.length > 0) {
        await uploadFiles(files);
        e.target.value = ''; // Reset input
    }
}

async function uploadFiles(files) {
    showLoading('Enviando arquivos...');
    let uploaded = 0;
    let failed = 0;

    const isAd = state.uploadAsAd;
    const typeLabel = isAd ? 'propaganda(s)' : 'música(s)';

    for (const file of files) {
        try {
            await API.uploadMusic(file, isAd);
            uploaded++;
        } catch (err) {
            failed++;
            console.error('Upload failed:', file.name, err);
        }
    }

    hideLoading();

    if (uploaded > 0) {
        showToast(`${uploaded} ${typeLabel} enviada(s)`, 'success');
        loadMusicLibrary();
        loadDashboard();
    }
    if (failed > 0) {
        showToast(`${failed} arquivo(s) falharam`, 'error');
    }
}

// Upload type toggle
window.setUploadType = function(isAd) {
    state.uploadAsAd = isAd;

    const musicBtn = document.getElementById('upload-type-music');
    const adBtn = document.getElementById('upload-type-ad');

    if (isAd) {
        musicBtn?.classList.remove('active');
        adBtn?.classList.add('active');
    } else {
        adBtn?.classList.remove('active');
        musicBtn?.classList.add('active');
    }
};

window.playSong = async (id) => {
    try {
        await API.next(id);
        showToast('Enviado para reprodução', 'success');
    } catch (err) {
        showToast('Erro ao enviar', 'error');
    }
};

window.editMusic = (id) => {
    const music = state.musicList.find(m => m.id === id);
    if (!music) return;

    state.editingMusicId = id;
    document.getElementById('edit-music-name').value = music.original_name;

    // Set toggle state
    const toggleMusic = document.getElementById('toggle-music');
    const toggleAd = document.getElementById('toggle-ad');

    if (music.is_ad) {
        toggleAd.classList.add('active');
        toggleMusic.classList.remove('active');
    } else {
        toggleMusic.classList.add('active');
        toggleAd.classList.remove('active');
    }

    document.getElementById('edit-music-modal').classList.add('active');
};

window.closeEditModal = () => {
    document.getElementById('edit-music-modal').classList.remove('active');
    state.editingMusicId = null;
};

window.saveEditMusic = async () => {
    if (!state.editingMusicId) return;

    const isAd = document.getElementById('toggle-ad').classList.contains('active');

    try {
        await API.updateMusic(state.editingMusicId, { is_ad: isAd });
        showToast('Áudio atualizado', 'success');
        closeEditModal();
        loadMusicLibrary();
    } catch (err) {
        showToast('Erro ao atualizar', 'error');
    }
};

window.confirmDeleteMusic = (id) => {
    showConfirm('Excluir Áudio', 'Tem certeza que deseja excluir este arquivo?', async (confirmed) => {
        if (confirmed) {
            try {
                await API.deleteMusic(id);
                showToast('Áudio excluído', 'success');
                loadMusicLibrary();
                loadDashboard();
            } catch (err) {
                showToast('Erro ao excluir', 'error');
            }
        }
    });
};

// ============ SCHEDULE MODULE ============
function setupScheduleListeners() {
    // Tab switching
    document.querySelectorAll('.schedule-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const tabName = e.currentTarget.dataset.tab;
            switchScheduleTab(tabName);
        });
    });

    // Ad form
    document.getElementById('btn-add-ad')?.addEventListener('click', () => {
        document.getElementById('ad-edit-id').value = '';
        document.getElementById('ad-music-select').value = '';
        document.getElementById('ad-interval').value = '30';
        document.querySelector('input[name="interval-type"][value="minutes"]').checked = true;
        document.getElementById('ad-form').style.display = 'block';
    });
    document.getElementById('btn-cancel-ad')?.addEventListener('click', () => {
        document.getElementById('ad-form').style.display = 'none';
    });
    document.getElementById('btn-save-ad')?.addEventListener('click', saveAdSchedule);

    // Interval type radio
    document.querySelectorAll('input[name="interval-type"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const label = document.getElementById('interval-label');
            label.textContent = e.target.value === 'minutes' ? 'Minutos' : 'Músicas';
        });
    });

    // Song form
    document.getElementById('btn-add-song')?.addEventListener('click', () => {
        document.getElementById('song-edit-id').value = '';
        document.getElementById('song-music-select').value = '';
        document.getElementById('song-time').value = '';
        document.getElementById('song-repeat').checked = true;
        document.getElementById('song-form').style.display = 'block';
    });
    document.getElementById('btn-cancel-song')?.addEventListener('click', () => {
        document.getElementById('song-form').style.display = 'none';
    });
    document.getElementById('btn-save-song')?.addEventListener('click', saveScheduledSong);

    // Volume save
    document.getElementById('btn-save-volumes')?.addEventListener('click', saveHourlyVolumes);
}

window.switchScheduleTab = function(tabName) {
    // Update tab buttons
    document.querySelectorAll('.schedule-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.toggle('active', c.id === `tab-${tabName}`);
    });
};

async function loadSchedules() {
    try {
        const [settings, music] = await Promise.all([
            API.getSettings(),
            API.getMusicList()
        ]);

        console.log('Settings loaded:', settings);
        console.log('Volume schedules:', settings.volume_schedules);

        state.musicList = music;
        state.adSchedules = settings.ad_schedules || [];
        state.scheduledSongs = settings.scheduled_songs || [];
        state.hourlyVolumes = settings.hourly_volumes || {};
        state.volumeSchedules = settings.volume_schedules || [];

        renderAdTable();
        renderSongsTable();
        renderVolumeChart();
        renderPeriodsTable();
        populateMusicSelects(music);
    } catch (err) {
        console.error('Error loading schedules:', err);
        showToast('Erro ao carregar agendamentos', 'error');
    }
}

function populateMusicSelects(music) {
    const adSelect = document.getElementById('ad-music-select');
    const songSelect = document.getElementById('song-music-select');

    const ads = music.filter(m => m.is_ad);
    const songs = music.filter(m => !m.is_ad);

    if (adSelect) {
        // Show all audio for ads, prioritizing those marked as ad
        const options = ads.length > 0 ? ads : music;
        adSelect.innerHTML = '<option value="">Selecione um áudio...</option>' +
            options.map(m => `<option value="${m.id}">${m.original_name}</option>`).join('');
    }

    if (songSelect) {
        // Show all audio for songs, prioritizing those marked as music
        const options = songs.length > 0 ? songs : music;
        songSelect.innerHTML = '<option value="">Selecione uma música...</option>' +
            options.map(m => `<option value="${m.id}">${m.original_name}</option>`).join('');
    }
}

// ============ AD SCHEDULES ============
function renderAdTable() {
    const tbody = document.getElementById('ad-table-body');
    if (!tbody) return;

    if (state.adSchedules.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    <div class="empty-state-icon">📢</div>
                    <p>Nenhuma propaganda agendada</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '';
    state.adSchedules.forEach((ad, index) => {
        const intervalType = ad.interval_type || 'minutes';
        const intervalValue = ad.interval_value || ad.interval_minutes || 30;
        const intervalText = intervalType === 'minutes'
            ? `A cada ${intervalValue} minutos`
            : `A cada ${intervalValue} músicas`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="badge">${index + 1}</span></td>
            <td>${ad.original_name || 'Desconhecido'}</td>
            <td><span class="badge ${intervalType}">${intervalText}</span></td>
            <td>
                <span class="badge ${ad.enabled ? 'enabled' : 'disabled'}">
                    ${ad.enabled ? 'Ativo' : 'Inativo'}
                </span>
            </td>
            <td>
                <button class="btn-icon" onclick="editAd(${ad.id})" title="Editar">✏️</button>
                <button class="btn-icon" onclick="toggleAd(${ad.id})" title="${ad.enabled ? 'Desativar' : 'Ativar'}">
                    ${ad.enabled ? '⏸' : '▶'}
                </button>
                <button class="btn-icon delete" onclick="deleteAd(${ad.id})" title="Excluir">🗑</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function saveAdSchedule() {
    const editId = document.getElementById('ad-edit-id').value;
    const musicId = document.getElementById('ad-music-select').value;
    const intervalType = document.querySelector('input[name="interval-type"]:checked').value;
    const intervalValue = parseInt(document.getElementById('ad-interval').value);

    if (!musicId) {
        showToast('Selecione um áudio', 'error');
        return;
    }

    if (!intervalValue || intervalValue < 1) {
        showToast('Informe um intervalo válido', 'error');
        return;
    }

    try {
        if (editId) {
            // Editing existing ad schedule
            const ad = state.adSchedules.find(a => a.id == editId);
            await API.updateAdSchedule(parseInt(editId), musicId, intervalType, intervalValue, ad?.enabled ?? true);
            showToast('Propaganda atualizada!', 'success');
        } else {
            // Adding new ad schedule
            await API.addAdSchedule(musicId, intervalType, intervalValue);
            showToast('Propaganda adicionada!', 'success');
        }
        document.getElementById('ad-form').style.display = 'none';
        state.editingAdId = null;
        loadSchedules();
    } catch (err) {
        showToast('Erro ao salvar propaganda', 'error');
    }
}

window.editAd = function(id) {
    const ad = state.adSchedules.find(a => a.id === id);
    if (!ad) return;

    state.editingAdId = id;
    document.getElementById('ad-edit-id').value = id;
    document.getElementById('ad-music-select').value = ad.music_id;
    document.getElementById('ad-interval').value = ad.interval_value || ad.interval_minutes || 30;

    const intervalType = ad.interval_type || 'minutes';
    document.querySelector(`input[name="interval-type"][value="${intervalType}"]`).checked = true;

    // Update interval label
    const label = document.getElementById('interval-label');
    label.textContent = intervalType === 'minutes' ? 'Minutos' : 'Músicas';

    document.getElementById('ad-form').style.display = 'block';
};

window.toggleAd = async (id) => {
    try {
        await API.toggleAdSchedule(id);
        loadSchedules();
    } catch (err) {
        showToast('Erro ao alterar status', 'error');
    }
};

window.deleteAd = async (id) => {
    showConfirm('Remover Propaganda', 'Tem certeza que deseja remover esta propaganda?', async (confirmed) => {
        if (confirmed) {
            try {
                await API.deleteAdSchedule(id);
                loadSchedules();
                showToast('Propaganda removida', 'success');
            } catch (err) {
                showToast('Erro ao remover', 'error');
            }
        }
    });
};

// ============ SCHEDULED SONGS ============
function renderSongsTable() {
    const tbody = document.getElementById('songs-table-body');
    if (!tbody) return;

    if (state.scheduledSongs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="empty-state">
                    <div class="empty-state-icon">🎵</div>
                    <p>Nenhuma música agendada</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '';
    state.scheduledSongs.forEach(song => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${song.original_name || 'Desconhecido'}</td>
            <td><strong>${song.scheduled_time}</strong></td>
            <td>
                <span class="badge ${song.repeat_daily ? 'enabled' : 'disabled'}">
                    ${song.repeat_daily ? 'Sim' : 'Não'}
                </span>
            </td>
            <td>
                <button class="btn-icon delete" onclick="deleteScheduledSong(${song.id})" title="Excluir">🗑</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function saveScheduledSong() {
    const musicId = document.getElementById('song-music-select').value;
    const time = document.getElementById('song-time').value;
    const repeatDaily = document.getElementById('song-repeat').checked;

    if (!musicId) {
        showToast('Selecione uma música', 'error');
        return;
    }

    if (!time) {
        showToast('Informe o horário', 'error');
        return;
    }

    try {
        await API.addScheduledSong(musicId, time, repeatDaily);
        document.getElementById('song-form').style.display = 'none';
        loadSchedules();
        showToast('Música agendada!', 'success');
    } catch (err) {
        showToast('Erro ao agendar música', 'error');
    }
}

window.deleteScheduledSong = async (id) => {
    showConfirm('Remover Agendamento', 'Tem certeza que deseja remover este agendamento?', async (confirmed) => {
        if (confirmed) {
            try {
                await API.deleteScheduledSong(id);
                loadSchedules();
                showToast('Agendamento removido', 'success');
            } catch (err) {
                showToast('Erro ao remover', 'error');
            }
        }
    });
};

// ============ HOURLY VOLUME CHART ============
let isDragging = false;
let dragBar = null;

window.renderVolumeChart = function() {
    const container = document.getElementById('volume-bars');
    if (!container) return;

    container.innerHTML = '';
    const currentHour = new Date().getHours();

    for (let hour = 0; hour < 24; hour++) {
        const volume = state.hourlyVolumes[hour] ?? state.hourlyVolumes[String(hour)] ?? 0.5;
        const bar = document.createElement('div');
        bar.className = 'volume-bar' + (hour === currentHour ? ' current-hour' : '');
        bar.style.height = `${volume * 100}%`;
        bar.dataset.hour = hour;
        bar.dataset.volume = Math.round(volume * 100);

        bar.addEventListener('mousedown', startVolumeDrag);
        bar.addEventListener('touchstart', startVolumeDrag, { passive: false });

        container.appendChild(bar);
    }

    // Global mouse events for dragging
    document.addEventListener('mousemove', handleVolumeDrag);
    document.addEventListener('mouseup', stopVolumeDrag);
    document.addEventListener('touchmove', handleVolumeDrag, { passive: false });
    document.addEventListener('touchend', stopVolumeDrag);
};

function startVolumeDrag(e) {
    e.preventDefault();
    isDragging = true;
    dragBar = e.target;
    dragBar.classList.add('dragging');
    handleVolumeDrag(e);
}

function handleVolumeDrag(e) {
    if (!isDragging || !dragBar) return;

    const container = document.getElementById('volume-bars');
    const rect = container.getBoundingClientRect();

    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const y = clientY - rect.top;
    const height = rect.height;

    // Calculate volume (inverted because 0 is at bottom)
    let volume = 1 - (y / height);
    volume = Math.max(0.05, Math.min(1, volume)); // Min 5% to keep bar visible

    const hour = parseInt(dragBar.dataset.hour);
    state.hourlyVolumes[String(hour)] = volume;

    dragBar.style.height = `${volume * 100}%`;
    dragBar.dataset.volume = Math.round(volume * 100);
}

function stopVolumeDrag() {
    if (dragBar) {
        dragBar.classList.remove('dragging');
    }
    isDragging = false;
    dragBar = null;
}

async function saveHourlyVolumes() {
    try {
        await API.setHourlyVolumes(state.hourlyVolumes);
        showToast('Volumes salvos!', 'success');
    } catch (err) {
        showToast('Erro ao salvar volumes', 'error');
    }
}

// ============ PERÍODOS (TIME-BASED VOLUME SCHEDULES) ============
function setupPeriodsListeners() {
    console.log('Setting up periods listeners...');

    // Add period button
    const addBtn = document.getElementById('btn-add-period');
    console.log('btn-add-period found:', !!addBtn);

    addBtn?.addEventListener('click', () => {
        console.log('Add period button clicked');
        state.editingPeriodId = null;
        document.getElementById('period-edit-id').value = '';
        document.getElementById('period-time-start').value = '08:00';
        document.getElementById('period-time-end').value = '18:00';
        document.getElementById('period-volume').value = '50';
        document.getElementById('period-volume-display').textContent = '50%';
        document.getElementById('period-volume-start').value = '20';
        document.getElementById('period-volume-start-display').textContent = '20%';
        document.getElementById('period-volume-end').value = '80';
        document.getElementById('period-volume-end-display').textContent = '80%';

        // Reset to fixed mode
        state.periodIsGradient = false;
        document.getElementById('period-mode-fixed').classList.add('active');
        document.getElementById('period-mode-gradient').classList.remove('active');
        document.getElementById('period-fixed-inputs').style.display = 'block';
        document.getElementById('period-gradient-inputs').style.display = 'none';

        document.getElementById('period-form').style.display = 'block';
    });

    // Cancel period button
    document.getElementById('btn-cancel-period')?.addEventListener('click', () => {
        document.getElementById('period-form').style.display = 'none';
        state.editingPeriodId = null;
    });

    // Save period button
    document.getElementById('btn-save-period')?.addEventListener('click', savePeriodSchedule);

    // Gradient mode toggle
    document.getElementById('period-mode-fixed')?.addEventListener('click', () => {
        state.periodIsGradient = false;
        document.getElementById('period-mode-fixed').classList.add('active');
        document.getElementById('period-mode-gradient').classList.remove('active');
        document.getElementById('period-fixed-inputs').style.display = 'block';
        document.getElementById('period-gradient-inputs').style.display = 'none';
    });

    document.getElementById('period-mode-gradient')?.addEventListener('click', () => {
        state.periodIsGradient = true;
        document.getElementById('period-mode-gradient').classList.add('active');
        document.getElementById('period-mode-fixed').classList.remove('active');
        document.getElementById('period-fixed-inputs').style.display = 'none';
        document.getElementById('period-gradient-inputs').style.display = 'block';
        updateGradientPreview();
    });

    // Update displays on slider change
    document.getElementById('period-volume')?.addEventListener('input', (e) => {
        document.getElementById('period-volume-display').textContent = `${e.target.value}%`;
    });

    document.getElementById('period-volume-start')?.addEventListener('input', (e) => {
        document.getElementById('period-volume-start-display').textContent = `${e.target.value}%`;
        updateGradientPreview();
    });

    document.getElementById('period-volume-end')?.addEventListener('input', (e) => {
        document.getElementById('period-volume-end-display').textContent = `${e.target.value}%`;
        updateGradientPreview();
    });
}

function updateGradientPreview() {
    const startVal = document.getElementById('period-volume-start')?.value || 20;
    const endVal = document.getElementById('period-volume-end')?.value || 80;

    document.getElementById('gradient-preview-start').textContent = `${startVal}%`;
    document.getElementById('gradient-preview-end').textContent = `${endVal}%`;
}

function renderPeriodsTable() {
    console.log('renderPeriodsTable called, volumeSchedules:', state.volumeSchedules);
    const tbody = document.getElementById('periods-table-body');
    console.log('periods-table-body found:', !!tbody);
    if (!tbody) return;

    if (state.volumeSchedules.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="empty-state">
                    <div class="empty-state-icon">⏱️</div>
                    <p>Nenhum período de volume configurado</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '';
    state.volumeSchedules.forEach((period) => {
        const tr = document.createElement('tr');

        let volumeDisplay;
        if (period.is_gradient && period.volume_start != null && period.volume_end != null) {
            const startPct = Math.round(period.volume_start * 100);
            const endPct = Math.round(period.volume_end * 100);
            volumeDisplay = `
                <div class="gradient-indicator">
                    <div class="gradient-bar gradient"></div>
                    <div class="gradient-values">
                        <span class="start">${startPct}%</span>
                        <span class="arrow">→</span>
                        <span class="end">${endPct}%</span>
                    </div>
                </div>
            `;
        } else {
            const volumePct = Math.round((period.volume || 0.5) * 100);
            volumeDisplay = `
                <div class="gradient-indicator">
                    <div class="gradient-bar fixed"></div>
                    <span class="gradient-label">${volumePct}%</span>
                </div>
            `;
        }

        tr.innerHTML = `
            <td><span class="period-time">${period.time_start}</span></td>
            <td><span class="period-time">${period.time_end}</span></td>
            <td>${volumeDisplay}</td>
            <td>
                <button class="btn-icon" onclick="editPeriod(${period.id})" title="Editar">✏️</button>
                <button class="btn-icon delete" onclick="deletePeriod(${period.id})" title="Excluir">🗑</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function savePeriodSchedule() {
    const editId = document.getElementById('period-edit-id').value;
    const timeStart = document.getElementById('period-time-start').value;
    const timeEnd = document.getElementById('period-time-end').value;

    if (!timeStart || !timeEnd) {
        showToast('Informe os horários de início e fim', 'error');
        return;
    }

    let volume, isGradient, volumeStart, volumeEnd;

    if (state.periodIsGradient) {
        isGradient = true;
        volumeStart = parseFloat(document.getElementById('period-volume-start').value) / 100;
        volumeEnd = parseFloat(document.getElementById('period-volume-end').value) / 100;
        volume = volumeStart; // Use start as default volume
    } else {
        isGradient = false;
        volume = parseFloat(document.getElementById('period-volume').value) / 100;
        volumeStart = null;
        volumeEnd = null;
    }

    try {
        if (editId) {
            await API.updateVolumeSchedule(parseInt(editId), timeStart, timeEnd, volume, isGradient, volumeStart, volumeEnd);
            showToast('Período atualizado!', 'success');
        } else {
            await API.addVolumeSchedule(timeStart, timeEnd, volume, isGradient, volumeStart, volumeEnd);
            showToast('Período adicionado!', 'success');
        }
        document.getElementById('period-form').style.display = 'none';
        state.editingPeriodId = null;
        loadSchedules();
    } catch (err) {
        showToast('Erro ao salvar período', 'error');
    }
}

window.editPeriod = function(id) {
    const period = state.volumeSchedules.find(p => p.id === id);
    if (!period) return;

    state.editingPeriodId = id;
    document.getElementById('period-edit-id').value = id;
    document.getElementById('period-time-start').value = period.time_start;
    document.getElementById('period-time-end').value = period.time_end;

    if (period.is_gradient && period.volume_start != null && period.volume_end != null) {
        state.periodIsGradient = true;
        document.getElementById('period-mode-gradient').classList.add('active');
        document.getElementById('period-mode-fixed').classList.remove('active');
        document.getElementById('period-fixed-inputs').style.display = 'none';
        document.getElementById('period-gradient-inputs').style.display = 'block';
        const startVal = Math.round(period.volume_start * 100);
        const endVal = Math.round(period.volume_end * 100);
        document.getElementById('period-volume-start').value = startVal;
        document.getElementById('period-volume-end').value = endVal;
        document.getElementById('period-volume-start-display').textContent = `${startVal}%`;
        document.getElementById('period-volume-end-display').textContent = `${endVal}%`;
        updateGradientPreview();
    } else {
        state.periodIsGradient = false;
        document.getElementById('period-mode-fixed').classList.add('active');
        document.getElementById('period-mode-gradient').classList.remove('active');
        document.getElementById('period-fixed-inputs').style.display = 'block';
        document.getElementById('period-gradient-inputs').style.display = 'none';
        const volVal = Math.round((period.volume || 0.5) * 100);
        document.getElementById('period-volume').value = volVal;
        document.getElementById('period-volume-display').textContent = `${volVal}%`;
    }

    document.getElementById('period-form').style.display = 'block';
};

window.deletePeriod = async function(id) {
    showConfirm('Remover Período', 'Tem certeza que deseja remover este período de volume?', async (confirmed) => {
        if (confirmed) {
            try {
                await API.deleteVolumeSchedule(id);
                loadSchedules();
                showToast('Período removido', 'success');
            } catch (err) {
                showToast('Erro ao remover', 'error');
            }
        }
    });
};

// Volume Presets
window.applyVolumePreset = function(preset) {
    const presets = {
        full: () => {
            for (let i = 0; i < 24; i++) state.hourlyVolumes[String(i)] = 1;
        },
        commercial: () => {
            // Lower volume early morning and late night
            for (let i = 0; i < 24; i++) {
                if (i >= 8 && i <= 18) {
                    state.hourlyVolumes[String(i)] = 1;
                } else if (i >= 6 && i <= 20) {
                    state.hourlyVolumes[String(i)] = 0.7;
                } else {
                    state.hourlyVolumes[String(i)] = 0.4;
                }
            }
        },
        night: () => {
            // Low volume at night, normal during day
            for (let i = 0; i < 24; i++) {
                if (i >= 7 && i <= 22) {
                    state.hourlyVolumes[String(i)] = 0.8;
                } else {
                    state.hourlyVolumes[String(i)] = 0.3;
                }
            }
        }
    };

    if (presets[preset]) {
        presets[preset]();
        renderVolumeChart();
        showToast('Preset aplicado! Clique em Salvar para confirmar.', 'info');
    }
};

// ============ PREVIEW PAGE ============
async function loadPreview() {
    const hoursSelect = document.getElementById('preview-hours');
    const hours = hoursSelect ? parseInt(hoursSelect.value) : 6;

    try {
        const preview = await API.getSchedulePreview(hours);
        updatePreviewStats(preview);
        updateTimelineMarks(hours);
        renderPreviewTimeline(preview);
        renderPreviewSequence(preview);
    } catch (err) {
        console.error('Error loading preview:', err);
        showToast('Erro ao carregar preview', 'error');
    }
}

function updatePreviewStats(preview) {
    const stats = preview.stats || {};
    document.getElementById('preview-stat-music').textContent = stats.random_music || 0;
    document.getElementById('preview-stat-ads').textContent = stats.ads || 0;
    document.getElementById('preview-stat-scheduled').textContent = stats.scheduled_songs || 0;
    document.getElementById('preview-stat-volume').textContent = stats.volume_changes || 0;
}

function updateTimelineMarks(hours) {
    const marks = [
        Math.round(hours * 0.25),
        Math.round(hours * 0.5),
        Math.round(hours * 0.75),
        hours
    ];

    for (let i = 0; i < 4; i++) {
        const el = document.getElementById(`timeline-mark-${i + 1}`);
        if (el) el.textContent = `+${marks[i]}h`;
    }
}

function renderPreviewTimeline(preview) {
    const timeline = document.getElementById('schedule-timeline');
    if (!timeline) return;

    timeline.innerHTML = '';

    if (!preview?.events || preview.events.length === 0) {
        return;
    }

    const start = new Date(preview.start);
    const end = new Date(preview.end);
    const totalMs = end - start;

    // Only show some events on timeline to avoid clutter
    const timelineEvents = preview.events.filter(e =>
        e.type === 'ad' || e.type === 'scheduled_song' || e.type === 'volume'
    );

    timelineEvents.forEach(event => {
        const eventTime = new Date(event.time);
        const position = ((eventTime - start) / totalMs) * 100;

        const el = document.createElement('div');
        el.className = `timeline-event ${event.type}`;
        el.style.left = `${Math.min(95, Math.max(0, position))}%`;

        const name = event.description || '';
        el.textContent = name.length > 15 ? name.substring(0, 15) + '...' : name;
        el.title = `${new Date(event.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} - ${name}`;

        timeline.appendChild(el);
    });
}

function renderPreviewSequence(preview) {
    const list = document.getElementById('preview-list');
    const countEl = document.getElementById('preview-count');
    if (!list) return;

    if (!preview?.events || preview.events.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>Nenhum evento para exibir</p></div>';
        if (countEl) countEl.textContent = '0 itens';
        return;
    }

    if (countEl) countEl.textContent = `${preview.events.length} itens`;

    list.innerHTML = '';

    const typeLabels = {
        random_music: 'Música Aleatória',
        ad: 'Propaganda',
        scheduled_song: 'Música Agendada',
        volume: 'Volume'
    };

    let itemNumber = 0;

    preview.events.forEach(event => {
        itemNumber++;
        const time = new Date(event.time).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });

        const item = document.createElement('div');
        item.className = `sequence-item ${event.type}${event.placeholder ? ' placeholder' : ''}`;

        let intervalBadge = '';
        if (event.interval) {
            intervalBadge = `<span class="sequence-interval">${event.interval}</span>`;
        }

        item.innerHTML = `
            <span class="sequence-number">#${itemNumber}</span>
            <span class="sequence-time">${time}</span>
            <span class="sequence-type ${event.type}">${typeLabels[event.type] || event.type}</span>
            <span class="sequence-description">${event.description || ''}</span>
            ${intervalBadge}
        `;

        list.appendChild(item);
    });
}

// Setup preview listeners
function setupPreviewListeners() {
    document.getElementById('btn-refresh-preview')?.addEventListener('click', loadPreview);
    document.getElementById('preview-hours')?.addEventListener('change', loadPreview);
}

// ============ SETTINGS ============
async function loadSettings() {
    try {
        const [music, settings] = await Promise.all([
            API.getMusicList(),
            API.getSettings()
        ]);

        // Storage stats
        const totalFiles = music.length;
        const musicCount = music.filter(m => !m.is_ad).length;
        const adCount = music.filter(m => m.is_ad).length;

        document.getElementById('storage-files').textContent = totalFiles;
        document.getElementById('storage-music').textContent = musicCount;
        document.getElementById('storage-ads').textContent = adCount;

        // Client status
        const playerStatus = settings.player_status;
        if (playerStatus?.connected) {
            document.getElementById('client-status').textContent = playerStatus.is_playing ? 'Reproduzindo' : 'Conectado';
            document.getElementById('client-status').className = 'info-value status-online';
        } else {
            document.getElementById('client-status').textContent = 'Desconectado';
            document.getElementById('client-status').className = 'info-value status-offline';
        }

        document.getElementById('synced-count').textContent = totalFiles;
        document.getElementById('last-sync').textContent = new Date().toLocaleString('pt-BR');
    } catch (err) {
        console.error('Error loading settings:', err);
    }
}

window.exportSchedules = async function() {
    try {
        const settings = await API.getSettings();
        const data = {
            ad_schedules: settings.ad_schedules,
            scheduled_songs: settings.scheduled_songs,
            hourly_volumes: settings.hourly_volumes,
            exported_at: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `falavip-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        showToast('Backup exportado!', 'success');
    } catch (err) {
        showToast('Erro ao exportar', 'error');
    }
};

async function handleImportSchedules(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        showConfirm('Importar Agendamentos', 'Isso substituirá todos os agendamentos atuais. Continuar?', async (confirmed) => {
            if (confirmed) {
                // Import hourly volumes
                if (data.hourly_volumes) {
                    await API.setHourlyVolumes(data.hourly_volumes);
                }

                showToast('Agendamentos importados! Recarregando...', 'success');
                setTimeout(() => location.reload(), 1500);
            }
        });
    } catch (err) {
        showToast('Erro ao importar arquivo', 'error');
    }

    e.target.value = '';
}

window.clearAllSchedules = function() {
    showConfirm('Limpar Agendamentos', 'Isso removerá TODOS os agendamentos. Esta ação não pode ser desfeita!', async (confirmed) => {
        if (confirmed) {
            try {
                // Clear all ad schedules
                for (const ad of state.adSchedules) {
                    await API.deleteAdSchedule(ad.id);
                }

                // Clear all scheduled songs
                for (const song of state.scheduledSongs) {
                    await API.deleteScheduledSong(song.id);
                }

                // Reset hourly volumes to 50%
                const defaultVolumes = {};
                for (let i = 0; i < 24; i++) {
                    defaultVolumes[String(i)] = 0.5;
                }
                await API.setHourlyVolumes(defaultVolumes);

                showToast('Agendamentos limpos!', 'success');
                loadSchedules();
            } catch (err) {
                showToast('Erro ao limpar agendamentos', 'error');
            }
        }
    });
};

// ============ LOGS ============
function setupLogsListeners() {
    // Log filter buttons
    document.querySelectorAll('[data-log-filter]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-log-filter]').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            state.logsFilter = e.target.dataset.logFilter;
            state.logsPage = 1;
            loadLogs();
        });
    });

    // Pagination buttons
    document.getElementById('logs-prev-btn')?.addEventListener('click', () => {
        if (state.logsPage > 1) {
            state.logsPage--;
            loadLogs();
        }
    });

    document.getElementById('logs-next-btn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(state.logsTotal / state.logsPerPage);
        if (state.logsPage < totalPages) {
            state.logsPage++;
            loadLogs();
        }
    });
}

async function loadLogs() {
    try {
        const offset = (state.logsPage - 1) * state.logsPerPage;
        const response = await API.getLogs(state.logsFilter, state.logsPerPage, offset);

        state.logs = response.logs || [];
        state.logsTotal = response.total || 0;

        renderLogsTable();
        updateLogsPagination();
        await loadLogsStats();
    } catch (err) {
        console.error('Error loading logs:', err);
        showToast('Erro ao carregar logs', 'error');
    }
}

async function loadLogsStats() {
    try {
        const [musicLogs, adLogs, volumeLogs] = await Promise.all([
            API.getLogs('music', 1, 0),
            API.getLogs('ad', 1, 0),
            API.getLogs('volume_manual', 1, 0).then(async r => {
                const scheduled = await API.getLogs('volume_scheduled', 1, 0);
                return { total: (r.total || 0) + (scheduled.total || 0) };
            })
        ]);

        document.getElementById('log-stat-music').textContent = musicLogs.total || 0;
        document.getElementById('log-stat-ad').textContent = adLogs.total || 0;
        document.getElementById('log-stat-volume').textContent = volumeLogs.total || 0;
    } catch (err) {
        console.error('Error loading log stats:', err);
    }
}

function renderLogsTable() {
    const tbody = document.getElementById('logs-table-body');
    if (!tbody) return;

    if (state.logs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="logs-empty">
                    <div class="logs-empty-icon">📋</div>
                    <p>Nenhum log encontrado</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '';

    const typeLabels = {
        music: '🎵 Música',
        ad: '📢 Propaganda',
        volume_manual: '🔊 Vol. Manual',
        volume_scheduled: '⏰ Vol. Agendado',
        app: '📱 App',
        connection: '🔗 Conexão'
    };

    state.logs.forEach(log => {
        const date = new Date(log.timestamp);
        const formattedDate = date.toLocaleDateString('pt-BR') + ' ' +
                              date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formattedDate}</td>
            <td><span class="log-type ${log.type}">${typeLabels[log.type] || log.type}</span></td>
            <td>${log.description || '-'}</td>
            <td>${log.details || '-'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function updateLogsPagination() {
    const totalPages = Math.max(1, Math.ceil(state.logsTotal / state.logsPerPage));

    document.getElementById('logs-current-page').textContent = state.logsPage;
    document.getElementById('logs-total-pages').textContent = totalPages;

    const prevBtn = document.getElementById('logs-prev-btn');
    const nextBtn = document.getElementById('logs-next-btn');

    if (prevBtn) prevBtn.disabled = state.logsPage <= 1;
    if (nextBtn) nextBtn.disabled = state.logsPage >= totalPages;
}

window.refreshLogs = function() {
    state.logsPage = 1;
    loadLogs();
    showToast('Logs atualizados', 'success');
};

window.clearOldLogs = function() {
    showConfirm('Limpar Logs Antigos', 'Isso removerá logs com mais de 30 dias. Continuar?', async (confirmed) => {
        if (confirmed) {
            try {
                await API.clearLogs(30);
                loadLogs();
                showToast('Logs antigos removidos', 'success');
            } catch (err) {
                showToast('Erro ao limpar logs', 'error');
            }
        }
    });
};

// ============ WEBSOCKET ============
let ws = null;
let wsReconnectTimeout = null;

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
        updateConnectionStatus(true);
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWsMessage(data);
    };

    ws.onclose = () => {
        updateConnectionStatus(false);
        // Reconnect after 3 seconds
        wsReconnectTimeout = setTimeout(initWebSocket, 3000);
    };

    ws.onerror = () => {
        ws.close();
    };
}

function handleWsMessage(data) {
    if (data.type === 'player_status' || data.type === 'init') {
        const status = data.settings?.player_status || data;
        updatePlayerUI(status);
    }

    if (data.type === 'volume_change') {
        const volValue = Math.round(data.volume * 100);
        const volSlider = document.getElementById('volume-slider');
        const volValueEl = document.getElementById('volume-value');
        const statVolume = document.getElementById('stat-volume');

        if (volSlider) volSlider.value = volValue;
        if (volValueEl) volValueEl.textContent = `${volValue}%`;
        if (statVolume) statVolume.textContent = `${volValue}%`;
    }

    if (data.type === 'music_added' || data.type === 'music_deleted') {
        // Refresh current view
        const musicView = document.getElementById('view-music');
        const dashView = document.getElementById('view-dashboard');

        if (musicView?.classList.contains('active')) {
            loadMusicLibrary();
        }
        if (dashView?.classList.contains('active')) {
            loadDashboard();
        }
    }

    if (data.type === 'schedule_updated') {
        const schedulesView = document.getElementById('view-schedules');
        if (schedulesView?.classList.contains('active')) {
            loadSchedules();
        }
    }
}

function updateConnectionStatus(connected) {
    state.connected = connected;
    const badge = document.getElementById('connection-status');

    if (badge) {
        if (connected) {
            badge.classList.remove('offline');
            badge.classList.add('online');
            badge.querySelector('.status-text').textContent = 'Online';
        } else {
            badge.classList.remove('online');
            badge.classList.add('offline');
            badge.querySelector('.status-text').textContent = 'Offline';
        }
    }
}

function updatePlayerUI(status) {
    if (!status) return;

    const currentSongEl = document.getElementById('current-song-name');
    const sidebarSongEl = document.getElementById('sidebar-song-name');
    const playBtn = document.getElementById('btn-play');
    const pauseBtn = document.getElementById('btn-pause');
    const sidebarPlayBtn = document.getElementById('sidebar-btn-play');
    const sidebarPauseBtn = document.getElementById('sidebar-btn-pause');
    const statusBadge = document.getElementById('player-status-badge');
    const volSlider = document.getElementById('volume-slider');
    const volValueEl = document.getElementById('volume-value');

    // Song Name
    const songName = status.current_song || 'Nenhuma música';
    if (currentSongEl) currentSongEl.textContent = songName;
    if (sidebarSongEl) sidebarSongEl.textContent = songName;

    // Play/Pause Buttons
    if (status.is_playing) {
        if (playBtn) playBtn.style.display = 'none';
        if (pauseBtn) pauseBtn.style.display = 'flex';
        if (sidebarPlayBtn) sidebarPlayBtn.style.display = 'none';
        if (sidebarPauseBtn) sidebarPauseBtn.style.display = 'flex';
        if (statusBadge) {
            statusBadge.textContent = 'Reproduzindo';
            statusBadge.classList.add('playing');
        }
    } else {
        if (playBtn) playBtn.style.display = 'flex';
        if (pauseBtn) pauseBtn.style.display = 'none';
        if (sidebarPlayBtn) sidebarPlayBtn.style.display = 'flex';
        if (sidebarPauseBtn) sidebarPauseBtn.style.display = 'none';
        if (statusBadge) {
            statusBadge.textContent = 'Pausado';
            statusBadge.classList.remove('playing');
        }
    }

    // Volume
    const volValue = Math.round((status.volume ?? 0.5) * 100);
    if (volSlider) volSlider.value = volValue;
    if (volValueEl) volValueEl.textContent = `${volValue}%`;

    const statVolume = document.getElementById('stat-volume');
    if (statVolume) statVolume.textContent = `${volValue}%`;

    // Time & Progress
    const position = status.position || 0;
    const duration = status.duration || 0;
    const remaining = status.remaining || 0;

    const timeCurrent = document.getElementById('player-time-current');
    const timeTotal = document.getElementById('player-time-total');
    const timeRemaining = document.getElementById('player-time-remaining');
    const progressFill = document.getElementById('player-progress-fill');

    if (timeCurrent) timeCurrent.textContent = formatTime(position);
    if (timeTotal) timeTotal.textContent = formatTime(duration);
    if (timeRemaining) timeRemaining.textContent = `-${formatTime(remaining)}`;

    if (progressFill && duration > 0) {
        const progress = (position / duration) * 100;
        progressFill.style.width = `${Math.min(100, progress)}%`;
    } else if (progressFill) {
        progressFill.style.width = '0%';
    }

    state.isPlaying = status.is_playing;
    state.volume = volValue;
}

// ============ TIME FORMATTING ============
function formatTime(seconds) {
    if (!seconds || seconds < 0) return '0:00';
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// ============ UI HELPERS ============
function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function showLoading(text = 'Carregando...') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-overlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
}

function showConfirm(title, message, callback) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    state.confirmCallback = callback;
    document.getElementById('confirm-modal').classList.add('active');
}

window.closeConfirmModal = function(confirmed) {
    document.getElementById('confirm-modal').classList.remove('active');
    if (state.confirmCallback) {
        state.confirmCallback(confirmed);
        state.confirmCallback = null;
    }
};

// ============ PLAYLIST MANAGEMENT ============
async function insertSongNext(musicId, musicName) {
    showConfirm(
        'Inserir Música',
        `Deseja inserir "${musicName}" como a próxima música a tocar? A playlist será regenerada.`,
        async (confirmed) => {
            if (!confirmed) return;

            showLoading('Inserindo música...');
            try {
                const response = await fetch('/api/playlist/insert-next', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ music_id: musicId })
                });
                const data = await response.json();
                hideLoading();

                if (data.success) {
                    showToast(`✓ "${musicName}" será a próxima!`, 'success');
                    loadPreview(); // Atualizar preview
                    loadDashboard(); // Atualizar dashboard
                } else {
                    showToast('Erro ao inserir música', 'error');
                }
            } catch (err) {
                hideLoading();
                showToast('Erro ao inserir música', 'error');
                console.error(err);
            }
        }
    );
}

async function scanMusicDurations() {
    showLoading('Escaneando durações...');
    try {
        const response = await fetch('/api/music/scan-durations', { method: 'POST' });
        const data = await response.json();
        hideLoading();

        if (data.success) {
            showToast(`✓ ${data.updated} músicas atualizadas com duração`, 'success');
            loadMusicLibrary(); // Recarregar biblioteca
        } else {
            showToast('Erro ao escanear durações', 'error');
        }
    } catch (err) {
        hideLoading();
        showToast('Erro ao escanear durações', 'error');
        console.error(err);
    }
}

async function generatePlaylist() {
    showLoading('Gerando playlist...');
    try {
        const response = await fetch('/api/playlist/generate?hours=24', { method: 'POST' });
        const data = await response.json();
        hideLoading();

        if (data.success) {
            showToast(`✓ Playlist gerada com ${data.count} itens`, 'success');
            updatePlaylistStatus();
            loadPreview(); // Atualizar preview se estiver na tela
        } else {
            showToast('Erro ao gerar playlist', 'error');
        }
    } catch (err) {
        hideLoading();
        showToast('Erro ao gerar playlist', 'error');
        console.error(err);
    }
}

async function updatePlaylistStatus() {
    try {
        const response = await fetch('/api/playlist?limit=1000');
        const playlist = await response.json();

        const statusEl = document.getElementById('playlist-status');
        const countEl = document.getElementById('playlist-count');

        if (statusEl && countEl) {
            if (playlist && playlist.length > 0) {
                const notPlayed = playlist.filter(p => !p.played).length;
                statusEl.textContent = '✓ Gerada';
                statusEl.style.color = '#22c55e';
                countEl.textContent = `${playlist.length} itens (${notPlayed} pendentes)`;
            } else {
                statusEl.textContent = '⚠️ Não gerada';
                statusEl.style.color = '#f59e0b';
                countEl.textContent = '-';
            }
        }
    } catch (err) {
        console.error('Erro ao verificar playlist:', err);
    }
}

// Chamar ao carregar settings
const originalLoadSettings = typeof loadSettings === 'function' ? loadSettings : null;
async function loadSettingsWithPlaylist() {
    if (originalLoadSettings) await originalLoadSettings();
    await updatePlaylistStatus();
}
