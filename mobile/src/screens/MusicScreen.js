import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import api from '../services/api';
import websocket from '../services/websocket';
import { colors, borderRadius, spacing } from '../theme';

export default function MusicScreen({ navigation }) {
  const [music, setMusic] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedMusic, setSelectedMusic] = useState(null);
  const [playingId, setPlayingId] = useState(null);

  // Audio player hook
  const player = useAudioPlayer(null);

  const fetchMusic = useCallback(async () => {
    try {
      const data = await api.getMusicList();
      setMusic(data.music || data || []);
    } catch (error) {
      console.error('Error fetching music:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMusic();
  }, [fetchMusic]);

  useEffect(() => {
    const unsubscribe = websocket.on('musicUpdated', () => {
      fetchMusic();
    });
    return unsubscribe;
  }, [fetchMusic]);

  // Stop playback when modal closes
  useEffect(() => {
    if (!modalVisible && player) {
      player.pause();
      setPlayingId(null);
    }
  }, [modalVisible, player]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMusic();
    setRefreshing(false);
  }, [fetchMusic]);

  const handlePreview = async (musicItem) => {
    try {
      // If same track is playing, stop it
      if (player.playing && playingId === musicItem.id) {
        player.pause();
        setPlayingId(null);
        return;
      }

      // Configure audio mode for iOS playback
      await setAudioModeAsync({
        playsInSilentMode: true,
      });

      // Get the audio URL
      const audioUrl = `${api.getServerUrl()}/api/music/download/${musicItem.id}`;

      // Replace source and play
      player.replace({ uri: audioUrl });
      player.play();
      setPlayingId(musicItem.id);
    } catch (error) {
      console.error('Preview error:', error);
      Alert.alert('Erro', 'Não foi possível reproduzir o áudio');
    }
  };

  const stopPreview = () => {
    player.pause();
    setPlayingId(null);
  };

  const handleUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      setUploading(true);

      await api.uploadMusic(file.uri, file.name);

      // Rebuild playlist after upload
      try {
        await api.regeneratePlaylist();
      } catch (e) {
        console.warn('Playlist rebuild skipped:', e);
      }

      Alert.alert('Sucesso', `"${file.name}" adicionada ao repertório!`);
      fetchMusic();
    } catch (error) {
      console.error('Upload error:', error);
      Alert.alert('Erro', 'Falha ao enviar música.');
    } finally {
      setUploading(false);
    }
  };

  const openMusicModal = (item) => {
    setSelectedMusic(item);
    setModalVisible(true);
  };

  const handleSetType = async (isAd) => {
    if (!selectedMusic) return;

    if (selectedMusic.is_ad === isAd) {
      setModalVisible(false);
      return;
    }

    try {
      await api.updateMusic(selectedMusic.id, { is_ad: isAd });
      const newType = isAd ? 'patrocinador' : 'música';
      Alert.alert('Sucesso', `Alterado para ${newType}!`);
      fetchMusic();
    } catch (error) {
      console.error('Set type error:', error);
      Alert.alert('Erro', 'Falha ao alterar tipo');
    }
    setModalVisible(false);
  };

  const handlePlayNext = async () => {
    if (!selectedMusic) return;

    try {
      await api.insertSongNext(selectedMusic.id);
      Alert.alert('Sucesso', 'Adicionado à fila!');
    } catch (error) {
      Alert.alert('Erro', 'Falha ao inserir na fila');
    }
    setModalVisible(false);
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const renderMusicItem = ({ item, index }) => (
    <TouchableOpacity
      style={styles.musicItem}
      onPress={() => openMusicModal(item)}
      activeOpacity={0.7}
    >
      <View style={styles.musicIndex}>
        <Text style={styles.musicIndexText}>{(index + 1).toString().padStart(2, '0')}</Text>
      </View>
      <View style={styles.musicInfo}>
        <Text style={styles.musicName} numberOfLines={1}>
          {item.original_name}
        </Text>
        <View style={styles.musicMeta}>
          <Text style={styles.musicDuration}>{formatDuration(item.duration)}</Text>
          <View style={[styles.typeBadge, item.is_ad ? styles.typeBadgeAd : styles.typeBadgeMusic]}>
            <Text style={[styles.typeBadgeText, item.is_ad ? styles.typeBadgeTextAd : styles.typeBadgeTextMusic]}>
              {item.is_ad ? 'PATROCINADOR' : 'MÚSICA'}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.chevron}>
        <Text style={styles.chevronText}>›</Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        {/* Upload Button */}
        <TouchableOpacity
          style={[styles.uploadBtn, uploading && styles.uploadBtnDisabled]}
          onPress={handleUpload}
          disabled={uploading}
          activeOpacity={0.8}
        >
          {uploading ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <>
              <Text style={styles.uploadIcon}>♪</Text>
              <View style={styles.uploadTextContainer}>
                <Text style={styles.uploadText}>Adicionar Música</Text>
                <Text style={styles.uploadHint}>Enviar arquivo de áudio</Text>
              </View>
            </>
          )}
        </TouchableOpacity>

        {/* Create Audio Button */}
        <TouchableOpacity
          style={styles.createAudioBtn}
          onPress={() => navigation.navigate('AudioCreate')}
          activeOpacity={0.8}
        >
          <Text style={styles.createAudioIcon}>🎙</Text>
          <View style={styles.uploadTextContainer}>
            <Text style={styles.uploadText}>Criar Áudio</Text>
            <Text style={styles.uploadHint}>Gravar ou gerar com I.A.</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Count */}
      <View style={styles.countContainer}>
        <View style={styles.countBadge}>
          <Text style={styles.countIcon}>★</Text>
          <Text style={styles.countText}>
            {music.length} {music.length === 1 ? 'música' : 'músicas'} no repertório
          </Text>
        </View>
      </View>

      {/* Music List */}
      <FlatList
        data={music}
        keyExtractor={(item) => item.id}
        renderItem={renderMusicItem}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>♪</Text>
            <Text style={styles.emptyText}>Nenhuma música no repertório</Text>
            <Text style={styles.emptyHint}>Adicione músicas de Natal para começar</Text>
          </View>
        }
      />

      {/* Music Options Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <View style={styles.modalContent}>
            {selectedMusic ? (
              <View>
                <Text style={styles.modalTitle} numberOfLines={2}>{selectedMusic.original_name}</Text>
                <Text style={styles.modalSubtitle}>{formatDuration(selectedMusic.duration)} - {selectedMusic.is_ad ? 'Patrocinador' : 'Música'}</Text>
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>TIPO DO ÁUDIO</Text>
                  <View style={styles.typeOptions}>
                    <TouchableOpacity
                      style={[styles.typeOption, !selectedMusic.is_ad && styles.typeOptionActive]}
                      onPress={() => handleSetType(false)}
                    >
                      <Text style={styles.typeOptionIcon}>♪</Text>
                      <Text style={[styles.typeOptionText, !selectedMusic.is_ad && styles.typeOptionTextActive]}>Música</Text>
                      {!selectedMusic.is_ad ? <Text style={styles.typeOptionCheck}>✓</Text> : null}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.typeOption, selectedMusic.is_ad && styles.typeOptionActiveAd]}
                      onPress={() => handleSetType(true)}
                    >
                      <Text style={styles.typeOptionIcon}>★</Text>
                      <Text style={[styles.typeOptionText, selectedMusic.is_ad && styles.typeOptionTextActiveAd]}>Patrocinador</Text>
                      {selectedMusic.is_ad ? <Text style={styles.typeOptionCheckAd}>✓</Text> : null}
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>AÇÕES</Text>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.previewBtn, player.playing && playingId === selectedMusic.id && styles.previewBtnActive]}
                    onPress={() => handlePreview(selectedMusic)}
                  >
                    <Text style={styles.actionBtnIcon}>{player.playing && playingId === selectedMusic.id ? '⏹' : '🔊'}</Text>
                    <Text style={styles.actionBtnText}>{player.playing && playingId === selectedMusic.id ? 'Parar Preview' : 'Ouvir Preview'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={handlePlayNext}>
                    <Text style={styles.actionBtnIcon}>▶</Text>
                    <Text style={styles.actionBtnText}>Tocar em Seguida</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}>
                  <Text style={styles.closeBtnText}>Fechar</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtons: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  uploadBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gold,
    borderStyle: 'dashed',
    gap: spacing.sm,
  },
  createAudioBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    gap: spacing.sm,
  },
  createAudioIcon: {
    fontSize: 24,
    width: 40,
    height: 40,
    backgroundColor: colors.primary + '30',
    borderRadius: 20,
    textAlign: 'center',
    lineHeight: 40,
  },
  uploadBtnDisabled: {
    opacity: 0.6,
  },
  uploadIcon: {
    color: colors.gold,
    fontSize: 22,
    width: 40,
    height: 40,
    backgroundColor: colors.gold + '20',
    borderRadius: 20,
    textAlign: 'center',
    lineHeight: 40,
  },
  uploadTextContainer: {
    flex: 1,
  },
  uploadText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  uploadHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  countContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  countIcon: {
    color: colors.gold,
    fontSize: 14,
  },
  countText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  musicItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  musicIndex: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  musicIndexText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  musicInfo: {
    flex: 1,
  },
  musicName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  musicMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  musicDuration: {
    color: colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  typeBadgeAd: {
    backgroundColor: colors.gold + '25',
  },
  typeBadgeMusic: {
    backgroundColor: colors.success + '20',
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  typeBadgeTextAd: {
    color: colors.gold,
  },
  typeBadgeTextMusic: {
    color: colors.success,
  },
  chevron: {
    width: 24,
    alignItems: 'center',
  },
  chevronText: {
    color: colors.textMuted,
    fontSize: 24,
    fontWeight: '300',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 16,
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
  modalSection: {
    marginBottom: spacing.lg,
  },
  modalSectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  typeOptions: {
    gap: spacing.sm,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeOptionActive: {
    backgroundColor: colors.success + '15',
    borderColor: colors.success,
  },
  typeOptionActiveAd: {
    backgroundColor: colors.gold + '15',
    borderColor: colors.gold,
  },
  typeOptionIcon: {
    color: colors.textMuted,
    fontSize: 18,
    width: 28,
  },
  typeOptionText: {
    color: colors.text,
    fontSize: 15,
    flex: 1,
  },
  typeOptionTextActive: {
    color: colors.success,
    fontWeight: '600',
  },
  typeOptionTextActiveAd: {
    color: colors.gold,
    fontWeight: '600',
  },
  typeOptionCheck: {
    color: colors.success,
    fontSize: 16,
    fontWeight: '700',
  },
  typeOptionCheckAd: {
    color: colors.gold,
    fontSize: 16,
    fontWeight: '700',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  previewBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  previewBtnActive: {
    backgroundColor: colors.gold + '20',
  },
  actionBtnIcon: {
    color: colors.text,
    fontSize: 14,
  },
  actionBtnText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  closeBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  closeBtnText: {
    color: colors.textMuted,
    fontSize: 15,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: spacing.xxl * 2,
  },
  emptyIcon: {
    color: colors.textMuted,
    fontSize: 48,
    marginBottom: spacing.md,
    opacity: 0.5,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '500',
  },
  emptyHint: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing.xs,
    opacity: 0.7,
  },
});
