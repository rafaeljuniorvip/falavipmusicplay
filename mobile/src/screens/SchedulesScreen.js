import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  FlatList,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import api from '../services/api';
import { colors, borderRadius, spacing } from '../theme';

const TABS = ['Preview', 'Volumes', 'Períodos', 'Patrocinadores'];

export default function SchedulesScreen() {
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState([]);
  const [hourlyVolumes, setHourlyVolumes] = useState({});
  const [adSchedules, setAdSchedules] = useState([]);
  const [volumeSchedules, setVolumeSchedules] = useState([]);
  const [musicList, setMusicList] = useState([]);

  // Modal states
  const [volumeModalVisible, setVolumeModalVisible] = useState(false);
  const [volumeMode, setVolumeMode] = useState('single'); // 'single' or 'range'
  const [selectedHour, setSelectedHour] = useState(null);
  const [selectedVolume, setSelectedVolume] = useState(50);
  // Range mode states
  const [startHour, setStartHour] = useState(0);
  const [endHour, setEndHour] = useState(23);
  const [startVolume, setStartVolume] = useState(50);
  const [endVolume, setEndVolume] = useState(50);

  const [adModalVisible, setAdModalVisible] = useState(false);
  const [editingAdSchedule, setEditingAdSchedule] = useState(null);
  const [selectedMusicId, setSelectedMusicId] = useState(null);
  const [intervalType, setIntervalType] = useState('minutes');
  const [intervalValue, setIntervalValue] = useState(30);
  const [regenerating, setRegenerating] = useState(false);

  // Volume schedule (time-based) modal states
  const [volumeScheduleModalVisible, setVolumeScheduleModalVisible] = useState(false);
  const [editingVolumeSchedule, setEditingVolumeSchedule] = useState(null);
  const [scheduleStartHour, setScheduleStartHour] = useState(6);
  const [scheduleStartMinute, setScheduleStartMinute] = useState(0);
  const [scheduleEndHour, setScheduleEndHour] = useState(22);
  const [scheduleEndMinute, setScheduleEndMinute] = useState(0);
  const [scheduleVolume, setScheduleVolume] = useState(50);
  // Gradient mode states
  const [isGradient, setIsGradient] = useState(false);
  const [scheduleVolumeStart, setScheduleVolumeStart] = useState(20);
  const [scheduleVolumeEnd, setScheduleVolumeEnd] = useState(80);

  const fetchData = useCallback(async () => {
    try {
      const [previewData, settings, music] = await Promise.all([
        api.getPlaylistPreview(24),
        api.getSettings(),
        api.getMusicList(),
      ]);

      setPreview(previewData.events || previewData || []);
      setHourlyVolumes(settings.hourly_volumes || {});
      setAdSchedules(settings.ad_schedules || []);
      setVolumeSchedules(settings.volume_schedules || []);
      setMusicList(music.music || music || []);
    } catch (error) {
      console.error('Error fetching schedules:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const formatTime = (isoString) => {
    if (!isoString) return '--:--';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '--:--';
      const hours = date.getHours().toString().padStart(2, '0');
      const mins = date.getMinutes().toString().padStart(2, '0');
      return `${hours}:${mins}`;
    } catch {
      return '--:--';
    }
  };

  const getEventStyle = (type) => {
    switch (type) {
      case 'ad': return { color: colors.gold, label: 'PAT', fullLabel: 'Patrocinador' };
      case 'scheduled_song': return { color: colors.info, label: 'AGD', fullLabel: 'Agendada' };
      case 'volume': return { color: colors.success, label: 'VOL', fullLabel: 'Volume' };
      case 'random_music': return { color: colors.success, label: 'MUS', fullLabel: 'Música' };
      case 'music': return { color: colors.success, label: 'MUS', fullLabel: 'Música' };
      default: return { color: colors.textMuted, label: '---', fullLabel: 'Evento' };
    }
  };

  // Volume editing functions
  const openVolumeModal = (hour = null) => {
    if (hour !== null) {
      setVolumeMode('single');
      setSelectedHour(hour);
      const vol = hourlyVolumes[hour] || hourlyVolumes[String(hour)] || 0.5;
      setSelectedVolume(Math.round(vol * 100));
    } else {
      setVolumeMode('range');
      setStartHour(6);
      setEndHour(22);
      setStartVolume(50);
      setEndVolume(50);
    }
    setVolumeModalVisible(true);
  };

  const saveVolume = async () => {
    try {
      const newVolumes = { ...hourlyVolumes };

      if (volumeMode === 'single') {
        newVolumes[String(selectedHour)] = selectedVolume / 100;
        await api.setHourlyVolumes(newVolumes);
        setHourlyVolumes(newVolumes);
        Alert.alert('Sucesso', `Volume das ${selectedHour}h: ${selectedVolume}%`);
      } else {
        // Calculate gradient for range
        const start = Math.min(startHour, endHour);
        const end = Math.max(startHour, endHour);
        const volStart = startHour <= endHour ? startVolume : endVolume;
        const volEnd = startHour <= endHour ? endVolume : startVolume;
        const hours = end - start;

        for (let h = start; h <= end; h++) {
          const progress = hours === 0 ? 1 : (h - start) / hours;
          const vol = Math.round(volStart + (volEnd - volStart) * progress);
          newVolumes[String(h)] = vol / 100;
        }

        await api.setHourlyVolumes(newVolumes);
        setHourlyVolumes(newVolumes);
        Alert.alert('Sucesso', `Volumes de ${start}h a ${end}h atualizados!`);
      }

      setVolumeModalVisible(false);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível salvar o volume');
    }
  };

  const adjustValue = (current, delta, min, max, step = 1) => {
    const newValue = current + delta * step;
    return Math.max(min, Math.min(max, newValue));
  };

  // Ad schedule functions
  const openAdModal = (schedule = null) => {
    const ads = musicList.filter(m => m.is_ad);
    if (ads.length === 0) {
      Alert.alert('Aviso', 'Não há áudios de patrocinadores cadastrados. Primeiro marque um áudio como patrocinador na aba Músicas.');
      return;
    }
    if (schedule) {
      setEditingAdSchedule(schedule);
      setSelectedMusicId(schedule.music_id);
      setIntervalType(schedule.interval_type || 'minutes');
      setIntervalValue(schedule.interval_value || schedule.interval_minutes || 30);
    } else {
      setEditingAdSchedule(null);
      setSelectedMusicId(ads[0]?.id || null);
      setIntervalType('minutes');
      setIntervalValue(30);
    }
    setAdModalVisible(true);
  };

  const saveAdSchedule = async () => {
    if (!selectedMusicId) {
      Alert.alert('Erro', 'Selecione um áudio');
      return;
    }
    if (intervalValue < 1) {
      Alert.alert('Erro', 'O intervalo deve ser maior que zero');
      return;
    }

    try {
      if (editingAdSchedule) {
        await api.updateAdSchedule(editingAdSchedule.id, selectedMusicId, intervalType, intervalValue, true);
        Alert.alert('Sucesso', 'Agendamento atualizado!');
      } else {
        await api.addAdSchedule(selectedMusicId, intervalType, intervalValue, true);
        Alert.alert('Sucesso', 'Agendamento adicionado!');
      }
      await fetchData();
      setAdModalVisible(false);
      setEditingAdSchedule(null);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível salvar o agendamento');
    }
  };

  const handleRegeneratePlaylist = async () => {
    Alert.alert(
      'Regenerar Playlist',
      'Deseja regenerar a playlist? Isso irá reorganizar todas as músicas.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Regenerar',
          onPress: async () => {
            setRegenerating(true);
            try {
              await api.regeneratePlaylist();
              await fetchData();
              Alert.alert('Sucesso', 'Playlist regenerada!');
            } catch (error) {
              Alert.alert('Erro', 'Não foi possível regenerar a playlist');
            } finally {
              setRegenerating(false);
            }
          },
        },
      ]
    );
  };

  const toggleAdSchedule = async (scheduleId) => {
    try {
      await api.toggleAdSchedule(scheduleId);
      await fetchData();
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível alterar o status');
    }
  };

  const deleteAdSchedule = async (scheduleId, musicName) => {
    Alert.alert(
      'Confirmar exclusão',
      `Deseja remover o agendamento de "${musicName}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteAdSchedule(scheduleId);
              await fetchData();
            } catch (error) {
              Alert.alert('Erro', 'Não foi possível excluir');
            }
          },
        },
      ]
    );
  };

  // Volume schedule (time-based) functions
  const openVolumeScheduleModal = (schedule = null) => {
    if (schedule) {
      setEditingVolumeSchedule(schedule);
      const [startH, startM] = (schedule.time_start || '06:00').split(':').map(Number);
      const [endH, endM] = (schedule.time_end || '22:00').split(':').map(Number);
      setScheduleStartHour(startH || 6);
      setScheduleStartMinute(startM || 0);
      setScheduleEndHour(endH || 22);
      setScheduleEndMinute(endM || 0);
      setScheduleVolume(Math.round((schedule.volume || 0.5) * 100));
      // Gradient data
      setIsGradient(schedule.is_gradient || false);
      setScheduleVolumeStart(Math.round((schedule.volume_start || 0.2) * 100));
      setScheduleVolumeEnd(Math.round((schedule.volume_end || 0.8) * 100));
    } else {
      setEditingVolumeSchedule(null);
      setScheduleStartHour(6);
      setScheduleStartMinute(0);
      setScheduleEndHour(22);
      setScheduleEndMinute(0);
      setScheduleVolume(50);
      // Reset gradient
      setIsGradient(false);
      setScheduleVolumeStart(20);
      setScheduleVolumeEnd(80);
    }
    setVolumeScheduleModalVisible(true);
  };

  const formatTimeString = (h, m) => {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  const saveVolumeSchedule = async () => {
    const timeStart = formatTimeString(scheduleStartHour, scheduleStartMinute);
    const timeEnd = formatTimeString(scheduleEndHour, scheduleEndMinute);
    const volume = scheduleVolume / 100;
    const volumeStart = isGradient ? scheduleVolumeStart / 100 : null;
    const volumeEnd = isGradient ? scheduleVolumeEnd / 100 : null;

    try {
      if (editingVolumeSchedule) {
        await api.updateVolumeSchedule(editingVolumeSchedule.id, timeStart, timeEnd, volume, isGradient, volumeStart, volumeEnd);
        Alert.alert('Sucesso', 'Período de volume atualizado!');
      } else {
        await api.addVolumeSchedule(timeStart, timeEnd, volume, isGradient, volumeStart, volumeEnd);
        Alert.alert('Sucesso', 'Período de volume adicionado!');
      }
      await fetchData();
      setVolumeScheduleModalVisible(false);
      setEditingVolumeSchedule(null);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível salvar o período');
    }
  };

  const deleteVolumeSchedule = async (scheduleId) => {
    Alert.alert(
      'Confirmar exclusão',
      'Deseja remover este período de volume?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteVolumeSchedule(scheduleId);
              await fetchData();
            } catch (error) {
              Alert.alert('Erro', 'Não foi possível excluir');
            }
          },
        },
      ]
    );
  };

  const renderVolumeScheduleItem = ({ item }) => {
    const isGrad = item.is_gradient;
    const volStart = Math.round((item.volume_start || 0) * 100);
    const volEnd = Math.round((item.volume_end || 0) * 100);
    const volFixed = Math.round((item.volume || 0.5) * 100);

    return (
      <TouchableOpacity
        style={styles.volumeScheduleItem}
        onPress={() => openVolumeScheduleModal(item)}
        activeOpacity={0.7}
      >
        <View style={styles.volumeScheduleTimeContainer}>
          <Text style={styles.volumeScheduleTime}>{item.time_start}</Text>
          <Text style={styles.volumeScheduleArrow}>→</Text>
          <Text style={styles.volumeScheduleTime}>{item.time_end}</Text>
        </View>
        <View style={styles.volumeScheduleVolumeContainer}>
          {isGrad ? (
            <View style={styles.gradientBarContainer}>
              <View style={[styles.gradientBarStart, { height: `${volStart}%` }]} />
              <View style={styles.gradientBarMiddle} />
              <View style={[styles.gradientBarEnd, { height: `${volEnd}%` }]} />
            </View>
          ) : (
            <View style={[styles.volumeScheduleBar, { width: `${volFixed}%` }]} />
          )}
          <Text style={styles.volumeScheduleVolumeText}>
            {isGrad ? `${volStart}% → ${volEnd}%` : `${volFixed}%`}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => deleteVolumeSchedule(item.id)}
        >
          <Text style={styles.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderPreviewItem = ({ item }) => {
    const style = getEventStyle(item.type);
    return (
      <View style={styles.eventItem}>
        <Text style={styles.eventTime}>{formatTime(item.time)}</Text>
        <View style={[styles.eventBadge, { backgroundColor: style.color + '20' }]}>
          <Text style={[styles.eventBadgeText, { color: style.color }]}>{style.label}</Text>
        </View>
        <Text style={styles.eventName} numberOfLines={1}>
          {item.description || 'Evento'}
        </Text>
        {item.duration > 0 && (
          <Text style={styles.eventDuration}>
            {Math.floor(item.duration / 60)}:{Math.floor(item.duration % 60).toString().padStart(2, '0')}
          </Text>
        )}
      </View>
    );
  };

  const renderVolumeBar = (hour) => {
    const volume = hourlyVolumes[hour] || hourlyVolumes[String(hour)] || 0.5;
    const isCurrentHour = new Date().getHours() === hour;
    const isNightHour = hour >= 22 || hour <= 5;

    return (
      <TouchableOpacity
        key={hour}
        style={styles.volumeBarContainer}
        onPress={() => openVolumeModal(hour)}
        activeOpacity={0.7}
      >
        <View style={styles.volumeBarWrapper}>
          <View
            style={[
              styles.volumeBar,
              { height: `${volume * 100}%` },
              isCurrentHour && styles.volumeBarCurrent,
              isNightHour && !isCurrentHour && styles.volumeBarNight,
            ]}
          />
        </View>
        <Text style={[styles.volumeHour, isCurrentHour && styles.volumeHourCurrent]}>
          {hour}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderVolumeCell = (hour) => {
    const volume = hourlyVolumes[hour] || hourlyVolumes[String(hour)] || 0.5;
    const isCurrentHour = new Date().getHours() === hour;

    return (
      <TouchableOpacity
        key={hour}
        style={[styles.volumeCell, isCurrentHour && styles.volumeCellCurrent]}
        onPress={() => openVolumeModal(hour)}
        activeOpacity={0.7}
      >
        <Text style={[styles.volumeCellHour, isCurrentHour && styles.volumeCellTextCurrent]}>
          {hour.toString().padStart(2, '0')}h
        </Text>
        <Text style={[styles.volumeCellValue, isCurrentHour && styles.volumeCellTextCurrent]}>
          {Math.round(volume * 100)}%
        </Text>
      </TouchableOpacity>
    );
  };

  const getMusicName = (musicId) => {
    const music = musicList.find(m => m.id === musicId);
    return music?.original_name || 'Áudio desconhecido';
  };

  const renderAdSchedule = ({ item }) => {
    const musicName = item.original_name || item.music_name || getMusicName(item.music_id);
    return (
      <TouchableOpacity style={styles.adItem} onPress={() => openAdModal(item)} activeOpacity={0.7}>
        <TouchableOpacity style={styles.adIconContainer} onPress={() => toggleAdSchedule(item.id)} activeOpacity={0.7}>
          <Text style={styles.adIcon}>{item.enabled ? '★' : '☆'}</Text>
        </TouchableOpacity>
        <View style={styles.adInfo}>
          <Text style={styles.adName} numberOfLines={1}>{musicName}</Text>
          <Text style={styles.adInterval}>A cada {item.interval_value || item.interval_minutes || '?'} {item.interval_type === 'songs' ? 'músicas' : 'minutos'}</Text>
        </View>
        <TouchableOpacity style={[styles.adStatus, item.enabled && styles.adStatusEnabled]} onPress={() => toggleAdSchedule(item.id)}>
          <Text style={[styles.adStatusText, item.enabled && styles.adStatusTextEnabled]}>{item.enabled ? 'Ativo' : 'Inativo'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteAdSchedule(item.id, musicName)}>
          <Text style={styles.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  const adAudios = musicList.filter(m => m.is_ad);

  return (
    <View style={styles.container}>
      {/* Tabs */}
      <View style={styles.tabsContainer}>
        {TABS.map((tab, index) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === index && styles.tabActive]}
            onPress={() => setActiveTab(index)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeTab === index && styles.tabTextActive]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {activeTab === 0 && (
        <View style={styles.flex1}>
          <TouchableOpacity
            style={[styles.regenerateButton, regenerating && styles.regenerateButtonDisabled]}
            onPress={handleRegeneratePlaylist}
            disabled={regenerating}
            activeOpacity={0.8}
          >
            {regenerating ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <View style={styles.regenerateContent}>
                <Text style={styles.regenerateIcon}>↻</Text>
                <Text style={styles.regenerateText}>Regenerar Playlist</Text>
              </View>
            )}
          </TouchableOpacity>
          <FlatList
            data={preview}
            keyExtractor={(item, index) => `${item.time}-${item.position}-${index}`}
            renderItem={renderPreviewItem}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={<Text style={styles.listHeader}>Próximas 24 horas de programação</Text>}
            ListEmptyComponent={<Text style={styles.emptyText}>Nenhum evento agendado</Text>}
          />
        </View>
      )}

      {activeTab === 1 && (
        <ScrollView
          style={styles.scrollContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />
          }
        >
          <TouchableOpacity
            style={styles.batchEditButton}
            onPress={() => openVolumeModal(null)}
            activeOpacity={0.8}
          >
            <Text style={styles.batchEditIcon}>◷</Text>
            <View style={styles.batchEditTextContainer}>
              <Text style={styles.batchEditTitle}>Editar Intervalo de Horas</Text>
              <Text style={styles.batchEditHint}>Configure volume gradual entre horários</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Volume por Hora</Text>
            <Text style={styles.cardHint}>Toque em uma barra para ajustar</Text>
            <View style={styles.volumeChart}>
              {Array.from({ length: 24 }, (_, i) => renderVolumeBar(i))}
            </View>
            <View style={styles.volumeLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.gold }]} />
                <Text style={styles.legendText}>Hora atual</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
                <Text style={styles.legendText}>Dia</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.info }]} />
                <Text style={styles.legendText}>Noite (22h-5h)</Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Valores por Hora</Text>
            <Text style={styles.cardHint}>Toque em uma célula para editar</Text>
            <View style={styles.volumeGrid}>
              {Array.from({ length: 24 }, (_, hour) => renderVolumeCell(hour))}
            </View>
          </View>
        </ScrollView>
      )}

      {activeTab === 2 && (
        <View style={styles.flex1}>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => openVolumeScheduleModal(null)}
            activeOpacity={0.8}
          >
            <Text style={styles.addButtonIcon}>+</Text>
            <Text style={styles.addButtonText}>Adicionar Período</Text>
          </TouchableOpacity>

          <FlatList
            data={volumeSchedules}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderVolumeScheduleItem}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />
            }
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <Text style={styles.listHeader}>
                Configure o volume para períodos específicos (HH:MM)
              </Text>
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyIcon}>◷</Text>
                <Text style={styles.emptyText}>Nenhum período configurado</Text>
                <Text style={styles.emptyHint}>Adicione períodos com horário de início e fim precisos</Text>
              </View>
            }
          />
        </View>
      )}

      {activeTab === 3 && (
        <View style={styles.flex1}>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => openAdModal(null)}
            activeOpacity={0.8}
          >
            <Text style={styles.addButtonIcon}>+</Text>
            <Text style={styles.addButtonText}>Adicionar Patrocinador</Text>
          </TouchableOpacity>

          <FlatList
            data={adSchedules}
            keyExtractor={(item) => String(item.id || item.music_id)}
            renderItem={renderAdSchedule}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />
            }
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <Text style={styles.listHeader}>
                {adAudios.length} áudio(s) de patrocinador disponível(is)
              </Text>
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyIcon}>★</Text>
                <Text style={styles.emptyText}>Nenhum agendamento de patrocinador</Text>
                <Text style={styles.emptyHint}>Adicione áudios de merchandising dos patrocinadores</Text>
              </View>
            }
          />
        </View>
      )}

      {/* Volume Edit Modal */}
      <Modal
        visible={volumeModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setVolumeModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{volumeMode === 'single' ? `Volume das ${selectedHour}h` : 'Editar Intervalo'}</Text>
            <Text style={styles.modalSubtitle}>{volumeMode === 'single' ? 'Ajuste o volume para este horário' : 'Configure volume gradual entre horários'}</Text>

            {volumeMode === 'single' ? (
              <View>
                <View style={styles.stepperContainer}>
                  <TouchableOpacity style={styles.stepperBtn} onPress={() => setSelectedVolume(v => adjustValue(v, -10, 0, 100))}>
                    <Text style={styles.stepperBtnText}>-10</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.stepperBtn} onPress={() => setSelectedVolume(v => adjustValue(v, -1, 0, 100))}>
                    <Text style={styles.stepperBtnText}>-1</Text>
                  </TouchableOpacity>
                  <View style={styles.stepperValue}>
                    <Text style={styles.stepperValueText}>{selectedVolume}%</Text>
                  </View>
                  <TouchableOpacity style={styles.stepperBtn} onPress={() => setSelectedVolume(v => adjustValue(v, 1, 0, 100))}>
                    <Text style={styles.stepperBtnText}>+1</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.stepperBtn} onPress={() => setSelectedVolume(v => adjustValue(v, 10, 0, 100))}>
                    <Text style={styles.stepperBtnText}>+10</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.presetButtons}>
                  {[0, 25, 50, 75, 100].map((p) => (
                    <TouchableOpacity key={p} style={[styles.presetBtn, selectedVolume === p && styles.presetBtnActive]} onPress={() => setSelectedVolume(p)}>
                      <Text style={[styles.presetBtnText, selectedVolume === p && styles.presetBtnTextActive]}>{p}%</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <View>
                <View style={styles.rangeRow}>
                  <View style={styles.rangeColumn}>
                    <Text style={styles.rangeLabel}>Hora Inicial</Text>
                    <View style={styles.stepperContainerSmall}>
                      <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setStartHour(h => adjustValue(h, -1, 0, 23))}>
                        <Text style={styles.stepperBtnText}>-</Text>
                      </TouchableOpacity>
                      <View style={styles.stepperValueSmall}>
                        <Text style={styles.stepperValueTextSmall}>{startHour}h</Text>
                      </View>
                      <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setStartHour(h => adjustValue(h, 1, 0, 23))}>
                        <Text style={styles.stepperBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.rangeColumn}>
                    <Text style={styles.rangeLabel}>Hora Final</Text>
                    <View style={styles.stepperContainerSmall}>
                      <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setEndHour(h => adjustValue(h, -1, 0, 23))}>
                        <Text style={styles.stepperBtnText}>-</Text>
                      </TouchableOpacity>
                      <View style={styles.stepperValueSmall}>
                        <Text style={styles.stepperValueTextSmall}>{endHour}h</Text>
                      </View>
                      <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setEndHour(h => adjustValue(h, 1, 0, 23))}>
                        <Text style={styles.stepperBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
                <View style={styles.rangeRow}>
                  <View style={styles.rangeColumn}>
                    <Text style={styles.rangeLabel}>Volume Inicial</Text>
                    <View style={styles.stepperContainerSmall}>
                      <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setStartVolume(v => adjustValue(v, -5, 0, 100, 5))}>
                        <Text style={styles.stepperBtnText}>-5</Text>
                      </TouchableOpacity>
                      <View style={styles.stepperValueSmall}>
                        <Text style={styles.stepperValueTextSmall}>{startVolume}%</Text>
                      </View>
                      <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setStartVolume(v => adjustValue(v, 5, 0, 100, 5))}>
                        <Text style={styles.stepperBtnText}>+5</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.rangeColumn}>
                    <Text style={styles.rangeLabel}>Volume Final</Text>
                    <View style={styles.stepperContainerSmall}>
                      <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setEndVolume(v => adjustValue(v, -5, 0, 100, 5))}>
                        <Text style={styles.stepperBtnText}>-5</Text>
                      </TouchableOpacity>
                      <View style={styles.stepperValueSmall}>
                        <Text style={styles.stepperValueTextSmall}>{endVolume}%</Text>
                      </View>
                      <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setEndVolume(v => adjustValue(v, 5, 0, 100, 5))}>
                        <Text style={styles.stepperBtnText}>+5</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
                <View style={styles.rangePreview}>
                  <Text style={styles.rangePreviewText}>De {Math.min(startHour, endHour)}h a {Math.max(startHour, endHour)}h: {startHour <= endHour ? startVolume : endVolume}% → {startHour <= endHour ? endVolume : startVolume}%</Text>
                </View>
              </View>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setVolumeModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={saveVolume}>
                <Text style={styles.modalSaveText}>Salvar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Ad Schedule Modal */}
      <Modal
        visible={adModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { setAdModalVisible(false); setEditingAdSchedule(null); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editingAdSchedule ? 'Editar Agendamento' : 'Novo Agendamento'}</Text>
            <Text style={styles.modalSubtitle}>Configure a reprodução do patrocinador</Text>

            <Text style={styles.inputLabel}>Áudio do Patrocinador</Text>
            <ScrollView style={styles.musicPicker} horizontal={false} nestedScrollEnabled>
              {adAudios.map((music) => (
                <TouchableOpacity
                  key={music.id}
                  style={[
                    styles.musicOption,
                    selectedMusicId === music.id && styles.musicOptionSelected,
                  ]}
                  onPress={() => setSelectedMusicId(music.id)}
                >
                  <Text style={[
                    styles.musicOptionText,
                    selectedMusicId === music.id && styles.musicOptionTextSelected,
                  ]} numberOfLines={1}>
                    {music.original_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.inputLabel}>Tipo de Intervalo</Text>
            <View style={styles.intervalTypeRow}>
              <TouchableOpacity
                style={[
                  styles.intervalTypeBtn,
                  intervalType === 'minutes' && styles.intervalTypeBtnActive,
                ]}
                onPress={() => setIntervalType('minutes')}
              >
                <Text style={[
                  styles.intervalTypeBtnText,
                  intervalType === 'minutes' && styles.intervalTypeBtnTextActive,
                ]}>
                  Minutos
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.intervalTypeBtn,
                  intervalType === 'songs' && styles.intervalTypeBtnActive,
                ]}
                onPress={() => setIntervalType('songs')}
              >
                <Text style={[
                  styles.intervalTypeBtnText,
                  intervalType === 'songs' && styles.intervalTypeBtnTextActive,
                ]}>
                  Músicas
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>A cada quantos {intervalType === 'minutes' ? 'minutos' : 'músicas'}?</Text>
            <View style={styles.stepperContainer}>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => setIntervalValue(v => adjustValue(v, -1, 1, 999, intervalType === 'minutes' ? 5 : 1))}>
                <Text style={styles.stepperBtnText}>{intervalType === 'minutes' ? '-5' : '-1'}</Text>
              </TouchableOpacity>
              <View style={styles.stepperValue}>
                <Text style={styles.stepperValueText}>{intervalValue}</Text>
                <Text style={styles.stepperValueUnit}>{intervalType === 'minutes' ? 'min' : 'músicas'}</Text>
              </View>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => setIntervalValue(v => adjustValue(v, 1, 1, 999, intervalType === 'minutes' ? 5 : 1))}>
                <Text style={styles.stepperBtnText}>{intervalType === 'minutes' ? '+5' : '+1'}</Text>
              </TouchableOpacity>
            </View>
            {intervalType === 'minutes' && (
              <View style={styles.presetButtonsSmall}>
                {[15, 30, 45, 60, 90].map((m) => (
                  <TouchableOpacity key={m} style={[styles.presetBtnSmall, intervalValue === m && styles.presetBtnActive]} onPress={() => setIntervalValue(m)}>
                    <Text style={[styles.presetBtnTextSmall, intervalValue === m && styles.presetBtnTextActive]}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {intervalType === 'songs' && (
              <View style={styles.presetButtonsSmall}>
                {[3, 5, 7, 10, 15].map((s) => (
                  <TouchableOpacity key={s} style={[styles.presetBtnSmall, intervalValue === s && styles.presetBtnActive]} onPress={() => setIntervalValue(s)}>
                    <Text style={[styles.presetBtnTextSmall, intervalValue === s && styles.presetBtnTextActive]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => { setAdModalVisible(false); setEditingAdSchedule(null); }}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={saveAdSchedule}
              >
                <Text style={styles.modalSaveText}>{editingAdSchedule ? 'Salvar' : 'Adicionar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Volume Schedule (Time-based) Modal */}
      <Modal
        visible={volumeScheduleModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { setVolumeScheduleModalVisible(false); setEditingVolumeSchedule(null); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editingVolumeSchedule ? 'Editar Período' : 'Novo Período'}</Text>
            <Text style={styles.modalSubtitle}>Configure volume para um período específico</Text>

            <Text style={styles.inputLabel}>Horário de Início</Text>
            <View style={styles.timeRow}>
              <View style={styles.timeColumn}>
                <Text style={styles.timeLabel}>Hora</Text>
                <View style={styles.stepperContainerSmall}>
                  <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setScheduleStartHour(h => adjustValue(h, -1, 0, 23))}>
                    <Text style={styles.stepperBtnText}>-</Text>
                  </TouchableOpacity>
                  <View style={styles.stepperValueSmall}>
                    <Text style={styles.stepperValueTextSmall}>{scheduleStartHour.toString().padStart(2, '0')}</Text>
                  </View>
                  <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setScheduleStartHour(h => adjustValue(h, 1, 0, 23))}>
                    <Text style={styles.stepperBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.timeSeparator}>:</Text>
              <View style={styles.timeColumn}>
                <Text style={styles.timeLabel}>Min</Text>
                <View style={styles.stepperContainerSmall}>
                  <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setScheduleStartMinute(m => adjustValue(m, -5, 0, 55, 5))}>
                    <Text style={styles.stepperBtnText}>-5</Text>
                  </TouchableOpacity>
                  <View style={styles.stepperValueSmall}>
                    <Text style={styles.stepperValueTextSmall}>{scheduleStartMinute.toString().padStart(2, '0')}</Text>
                  </View>
                  <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setScheduleStartMinute(m => adjustValue(m, 5, 0, 55, 5))}>
                    <Text style={styles.stepperBtnText}>+5</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <Text style={styles.inputLabel}>Horário de Fim</Text>
            <View style={styles.timeRow}>
              <View style={styles.timeColumn}>
                <Text style={styles.timeLabel}>Hora</Text>
                <View style={styles.stepperContainerSmall}>
                  <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setScheduleEndHour(h => adjustValue(h, -1, 0, 23))}>
                    <Text style={styles.stepperBtnText}>-</Text>
                  </TouchableOpacity>
                  <View style={styles.stepperValueSmall}>
                    <Text style={styles.stepperValueTextSmall}>{scheduleEndHour.toString().padStart(2, '0')}</Text>
                  </View>
                  <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setScheduleEndHour(h => adjustValue(h, 1, 0, 23))}>
                    <Text style={styles.stepperBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.timeSeparator}>:</Text>
              <View style={styles.timeColumn}>
                <Text style={styles.timeLabel}>Min</Text>
                <View style={styles.stepperContainerSmall}>
                  <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setScheduleEndMinute(m => adjustValue(m, -5, 0, 55, 5))}>
                    <Text style={styles.stepperBtnText}>-5</Text>
                  </TouchableOpacity>
                  <View style={styles.stepperValueSmall}>
                    <Text style={styles.stepperValueTextSmall}>{scheduleEndMinute.toString().padStart(2, '0')}</Text>
                  </View>
                  <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setScheduleEndMinute(m => adjustValue(m, 5, 0, 55, 5))}>
                    <Text style={styles.stepperBtnText}>+5</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <Text style={styles.inputLabel}>Modo de Volume</Text>
            <View style={styles.intervalTypeRow}>
              <TouchableOpacity
                style={[styles.intervalTypeBtn, !isGradient && styles.intervalTypeBtnActive]}
                onPress={() => setIsGradient(false)}
              >
                <Text style={[styles.intervalTypeBtnText, !isGradient && styles.intervalTypeBtnTextActive]}>
                  Fixo
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.intervalTypeBtn, isGradient && styles.gradientBtnActive]}
                onPress={() => setIsGradient(true)}
              >
                <Text style={[styles.intervalTypeBtnText, isGradient && styles.gradientBtnTextActive]}>
                  Gradativo
                </Text>
              </TouchableOpacity>
            </View>

            {!isGradient ? (
              <View>
                <Text style={styles.inputLabel}>Volume Fixo</Text>
                <View style={styles.stepperContainer}>
                  <TouchableOpacity style={styles.stepperBtn} onPress={() => setScheduleVolume(v => adjustValue(v, -10, 0, 100))}>
                    <Text style={styles.stepperBtnText}>-10</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.stepperBtn} onPress={() => setScheduleVolume(v => adjustValue(v, -1, 0, 100))}>
                    <Text style={styles.stepperBtnText}>-1</Text>
                  </TouchableOpacity>
                  <View style={styles.stepperValue}>
                    <Text style={styles.stepperValueText}>{scheduleVolume}%</Text>
                  </View>
                  <TouchableOpacity style={styles.stepperBtn} onPress={() => setScheduleVolume(v => adjustValue(v, 1, 0, 100))}>
                    <Text style={styles.stepperBtnText}>+1</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.stepperBtn} onPress={() => setScheduleVolume(v => adjustValue(v, 10, 0, 100))}>
                    <Text style={styles.stepperBtnText}>+10</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.presetButtons}>
                  {[0, 25, 50, 75, 100].map((p) => (
                    <TouchableOpacity key={p} style={[styles.presetBtn, scheduleVolume === p && styles.presetBtnActive]} onPress={() => setScheduleVolume(p)}>
                      <Text style={[styles.presetBtnText, scheduleVolume === p && styles.presetBtnTextActive]}>{p}%</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <View>
                <View style={styles.gradientVolumeRow}>
                  <View style={styles.gradientVolumeColumn}>
                    <Text style={styles.inputLabel}>Volume Inicial</Text>
                    <View style={styles.stepperContainerSmall}>
                      <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setScheduleVolumeStart(v => adjustValue(v, -5, 0, 100, 5))}>
                        <Text style={styles.stepperBtnText}>-5</Text>
                      </TouchableOpacity>
                      <View style={styles.stepperValueSmall}>
                        <Text style={styles.stepperValueTextSmall}>{scheduleVolumeStart}%</Text>
                      </View>
                      <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setScheduleVolumeStart(v => adjustValue(v, 5, 0, 100, 5))}>
                        <Text style={styles.stepperBtnText}>+5</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.gradientArrowContainer}>
                    <Text style={styles.gradientArrow}>→</Text>
                  </View>
                  <View style={styles.gradientVolumeColumn}>
                    <Text style={styles.inputLabel}>Volume Final</Text>
                    <View style={styles.stepperContainerSmall}>
                      <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setScheduleVolumeEnd(v => adjustValue(v, -5, 0, 100, 5))}>
                        <Text style={styles.stepperBtnText}>-5</Text>
                      </TouchableOpacity>
                      <View style={styles.stepperValueSmall}>
                        <Text style={styles.stepperValueTextSmall}>{scheduleVolumeEnd}%</Text>
                      </View>
                      <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setScheduleVolumeEnd(v => adjustValue(v, 5, 0, 100, 5))}>
                        <Text style={styles.stepperBtnText}>+5</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
                <Text style={styles.gradientHint}>O volume subirá gradualmente minuto a minuto</Text>
              </View>
            )}

            <View style={[styles.schedulePreview, isGradient && styles.schedulePreviewGradient]}>
              <Text style={[styles.schedulePreviewText, isGradient && styles.schedulePreviewTextGradient]}>
                {formatTimeString(scheduleStartHour, scheduleStartMinute)} → {formatTimeString(scheduleEndHour, scheduleEndMinute)}
                {isGradient ? ` = ${scheduleVolumeStart}% → ${scheduleVolumeEnd}%` : ` = ${scheduleVolume}%`}
              </Text>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => { setVolumeScheduleModalVisible(false); setEditingVolumeSchedule(null); }}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={saveVolumeSchedule}
              >
                <Text style={styles.modalSaveText}>{editingVolumeSchedule ? 'Salvar' : 'Adicionar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex1: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    margin: spacing.lg,
    borderRadius: borderRadius.md,
    padding: spacing.xs,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: borderRadius.sm,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.text,
  },
  listContent: {
    padding: spacing.lg,
    paddingTop: 0,
  },
  listHeader: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  scrollContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  cardHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.lg,
  },
  eventItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eventTime: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    width: 48,
  },
  eventBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    marginRight: spacing.sm,
  },
  eventBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  eventName: {
    color: colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  eventDuration: {
    color: colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  emptyIcon: {
    color: colors.gold,
    fontSize: 48,
    marginBottom: spacing.md,
    opacity: 0.5,
  },
  emptyText: {
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: 16,
  },
  emptyHint: {
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: 13,
    marginTop: spacing.xs,
    opacity: 0.7,
  },
  volumeChart: {
    flexDirection: 'row',
    height: 120,
    alignItems: 'flex-end',
  },
  volumeBarContainer: {
    flex: 1,
    alignItems: 'center',
  },
  volumeBarWrapper: {
    width: '70%',
    height: 100,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.sm,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  volumeBar: {
    width: '100%',
    backgroundColor: colors.success,
  },
  volumeBarCurrent: {
    backgroundColor: colors.gold,
  },
  volumeBarNight: {
    backgroundColor: colors.info,
  },
  volumeHour: {
    color: colors.textMuted,
    fontSize: 9,
    marginTop: spacing.xs,
  },
  volumeHourCurrent: {
    color: colors.gold,
    fontWeight: '600',
  },
  volumeLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  volumeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  volumeCell: {
    width: '23%',
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    alignItems: 'center',
  },
  volumeCellCurrent: {
    backgroundColor: colors.gold,
  },
  volumeCellHour: {
    color: colors.textMuted,
    fontSize: 11,
  },
  volumeCellValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  volumeCellTextCurrent: {
    color: colors.background,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    margin: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  addButtonIcon: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '600',
  },
  addButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  regenerateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  regenerateButtonDisabled: {
    opacity: 0.6,
  },
  regenerateContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  regenerateIcon: {
    color: colors.background,
    fontSize: 18,
    fontWeight: '700',
  },
  regenerateText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '600',
  },
  batchEditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.gold,
    borderStyle: 'dashed',
  },
  batchEditIcon: {
    color: colors.gold,
    fontSize: 24,
    width: 44,
    height: 44,
    backgroundColor: colors.gold + '20',
    borderRadius: 22,
    textAlign: 'center',
    lineHeight: 44,
    marginRight: spacing.md,
  },
  batchEditTextContainer: {
    flex: 1,
  },
  batchEditTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  batchEditHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginVertical: spacing.md,
  },
  stepperBtn: {
    width: 48,
    height: 44,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepperBtnText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  stepperValue: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  stepperValueText: {
    color: colors.gold,
    fontSize: 32,
    fontWeight: '700',
  },
  stepperValueUnit: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  stepperContainerSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.sm,
    padding: spacing.xs,
  },
  stepperBtnSmall: {
    width: 36,
    height: 36,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperValueSmall: {
    paddingHorizontal: spacing.md,
    minWidth: 50,
    alignItems: 'center',
  },
  stepperValueTextSmall: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  rangeRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  rangeColumn: {
    flex: 1,
  },
  rangeLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  rangePreview: {
    backgroundColor: colors.gold + '15',
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.gold + '30',
  },
  rangePreviewText: {
    color: colors.gold,
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },
  presetButtonsSmall: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  presetBtnSmall: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.sm,
  },
  presetBtnTextSmall: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  adItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  adIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.gold + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  adIcon: {
    color: colors.gold,
    fontSize: 18,
  },
  adInfo: {
    flex: 1,
  },
  adName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  adInterval: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  adStatus: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceLight,
    marginRight: spacing.sm,
  },
  adStatusEnabled: {
    backgroundColor: colors.success + '20',
  },
  adStatusText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  adStatusTextEnabled: {
    color: colors.success,
  },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.error + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtnText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  presetButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  presetBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
  },
  presetBtnActive: {
    backgroundColor: colors.gold,
  },
  presetBtnText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  presetBtnTextActive: {
    color: colors.background,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    backgroundColor: colors.success,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  modalSaveText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  inputLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  musicPicker: {
    maxHeight: 120,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  musicOption: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  musicOptionSelected: {
    backgroundColor: colors.gold + '20',
  },
  musicOptionText: {
    color: colors.text,
    fontSize: 14,
  },
  musicOptionTextSelected: {
    color: colors.gold,
    fontWeight: '500',
  },
  intervalTypeRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  intervalTypeBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  intervalTypeBtnActive: {
    backgroundColor: colors.gold + '20',
    borderColor: colors.gold,
  },
  intervalTypeBtnText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  intervalTypeBtnTextActive: {
    color: colors.gold,
  },
  // Volume Schedule (time-based) styles
  volumeScheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  volumeScheduleTimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  volumeScheduleTime: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  volumeScheduleArrow: {
    color: colors.textMuted,
    fontSize: 14,
  },
  volumeScheduleVolumeContainer: {
    flex: 1,
    height: 24,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.sm,
    marginHorizontal: spacing.md,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  volumeScheduleBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.success,
    borderRadius: borderRadius.sm,
  },
  volumeScheduleVolumeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    zIndex: 1,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  timeColumn: {
    alignItems: 'center',
  },
  timeLabel: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: spacing.xs,
  },
  timeSeparator: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    paddingBottom: spacing.sm,
  },
  schedulePreview: {
    backgroundColor: colors.success + '15',
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.success + '30',
  },
  schedulePreviewText: {
    color: colors.success,
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  schedulePreviewGradient: {
    backgroundColor: colors.gold + '15',
    borderColor: colors.gold + '30',
  },
  schedulePreviewTextGradient: {
    color: colors.gold,
  },
  // Gradient mode styles
  gradientBtnActive: {
    backgroundColor: colors.gold + '20',
    borderColor: colors.gold,
  },
  gradientBtnTextActive: {
    color: colors.gold,
  },
  gradientVolumeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  gradientVolumeColumn: {
    flex: 1,
  },
  gradientArrowContainer: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
  },
  gradientArrow: {
    color: colors.gold,
    fontSize: 20,
    fontWeight: '700',
  },
  gradientHint: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: spacing.md,
    fontStyle: 'italic',
  },
  gradientBarContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 2,
  },
  gradientBarStart: {
    width: 8,
    backgroundColor: colors.gold,
    borderRadius: 2,
  },
  gradientBarMiddle: {
    flex: 1,
    height: 2,
    backgroundColor: colors.gold + '50',
    alignSelf: 'center',
  },
  gradientBarEnd: {
    width: 8,
    backgroundColor: colors.success,
    borderRadius: 2,
  },
});
