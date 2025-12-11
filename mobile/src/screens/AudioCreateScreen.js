import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { useAudioPlayer, useAudioRecorder, setAudioModeAsync, RecordingPresets } from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import api from '../services/api';
import { colors, borderRadius, spacing } from '../theme';

export default function AudioCreateScreen({ navigation }) {
  const [activeTab, setActiveTab] = useState('record'); // 'record', 'ai', or 'mix'

  // Recording state
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordedUri, setRecordedUri] = useState(null);
  const [recordingName, setRecordingName] = useState('');

  // AI state
  const [ttsConfigured, setTtsConfigured] = useState(false);
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [ttsText, setTtsText] = useState('');
  const [ttsName, setTtsName] = useState('');
  const [isAd, setIsAd] = useState(false);
  const [stability, setStability] = useState(0.5);
  const [similarityBoost, setSimilarityBoost] = useState(0.75);
  const [generating, setGenerating] = useState(false);
  const [voiceModalVisible, setVoiceModalVisible] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Generated audio preview state
  const [generatedAudio, setGeneratedAudio] = useState(null); // { id, filename }

  // Mix (Vinheta) state
  const [musicList, setMusicList] = useState([]);
  const [selectedMusic, setSelectedMusic] = useState(null);
  const [musicModalVisible, setMusicModalVisible] = useState(false);
  const [mixText, setMixText] = useState('');
  const [mixName, setMixName] = useState('');
  const [mixVoice, setMixVoice] = useState(null);
  const [introDuration, setIntroDuration] = useState(5);
  const [outroDuration, setOutroDuration] = useState(5);
  const [fadeOutDuration, setFadeOutDuration] = useState(3);
  const [musicDuckingVolume, setMusicDuckingVolume] = useState(0.2);
  const [mixGenerating, setMixGenerating] = useState(false);
  const [mixGeneratedAudio, setMixGeneratedAudio] = useState(null);

  // Audio hooks
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recordingPlayer = useAudioPlayer(recordedUri ? { uri: recordedUri } : null);
  const generatedPlayer = useAudioPlayer(null);

  const timerRef = useRef(null);

  useEffect(() => {
    checkTTSStatus();
    loadMusicList();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Check TTS API status
  const checkTTSStatus = async () => {
    try {
      const status = await api.getTTSStatus();
      setTtsConfigured(status.configured);
      if (status.configured) {
        loadVoices();
      }
    } catch (error) {
      console.error('Error checking TTS status:', error);
    }
  };

  // Load music list for mix feature
  const loadMusicList = async () => {
    try {
      const list = await api.getMusicList();
      // Filter only music (not ads)
      setMusicList(list.filter(m => !m.is_ad));
    } catch (error) {
      console.error('Error loading music list:', error);
    }
  };

  const loadVoices = async () => {
    try {
      const data = await api.getTTSVoices();
      setVoices(data.voices || []);
      if (data.voices && data.voices.length > 0) {
        setSelectedVoice(data.voices[0]);
      }
    } catch (error) {
      console.error('Error loading voices:', error);
    }
  };

  // ============ RECORDING FUNCTIONS ============

  const startRecording = async () => {
    try {
      // Configure audio mode for recording
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecordingDuration(0);
      setRecordedUri(null);

      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Error starting recording:', error);
      Alert.alert('Erro', 'Falha ao iniciar gravacao. Verifique as permissões do microfone.');
    }
  };

  const stopRecording = async () => {
    try {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      await recorder.stop();
      setRecordedUri(recorder.uri);

      // Configure audio mode for playback
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch (error) {
      console.error('Error stopping recording:', error);
    }
  };

  const playRecording = async () => {
    try {
      // Configure audio mode for iOS playback
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (recordingPlayer.playing) {
        recordingPlayer.pause();
      } else {
        recordingPlayer.seekTo(0);
        recordingPlayer.play();
      }
    } catch (error) {
      console.error('Error playing recording:', error);
    }
  };

  const stopPlaying = () => {
    recordingPlayer.pause();
  };

  const uploadRecording = async () => {
    if (!recordedUri) {
      Alert.alert('Erro', 'Nenhuma gravacao para enviar');
      return;
    }

    if (!recordingName.trim()) {
      Alert.alert('Erro', 'Digite um nome para o audio');
      return;
    }

    setUploading(true);
    try {
      const fileName = `${recordingName.trim()}.m4a`;

      await api.uploadMusic(recordedUri, fileName, isAd);

      Alert.alert('Sucesso', 'Audio enviado com sucesso!');
      setRecordedUri(null);
      setRecordingName('');
      setRecordingDuration(0);
      navigation.goBack();
    } catch (error) {
      console.error('Upload error:', error);
      Alert.alert('Erro', 'Falha ao enviar audio');
    } finally {
      setUploading(false);
    }
  };

  const discardRecording = () => {
    Alert.alert('Descartar', 'Deseja descartar esta gravacao?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: () => {
          setRecordedUri(null);
          setRecordingDuration(0);
          setRecordingName('');
        },
      },
    ]);
  };

  // ============ AI GENERATION FUNCTIONS ============

  const generateAudio = async () => {
    if (!ttsText.trim()) {
      Alert.alert('Erro', 'Digite o texto para gerar o audio');
      return;
    }

    if (!selectedVoice) {
      Alert.alert('Erro', 'Selecione uma voz');
      return;
    }

    setGenerating(true);
    try {
      const result = await api.generateTTS(ttsText, selectedVoice.voice_id, {
        stability,
        similarityBoost,
        name: ttsName || null,
        isAd,
      });

      // Show preview instead of navigating back
      setGeneratedAudio({
        id: result.music_id,
        filename: result.filename,
      });
    } catch (error) {
      console.error('TTS error:', error);
      Alert.alert('Erro', error.message || 'Falha ao gerar audio');
    } finally {
      setGenerating(false);
    }
  };

  const playGeneratedAudio = async () => {
    if (!generatedAudio) return;

    try {
      // Configure audio mode for iOS playback
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (generatedPlayer.playing) {
        generatedPlayer.pause();
      } else {
        const audioUrl = `${api.getServerUrl()}/api/music/download/${generatedAudio.id}`;
        generatedPlayer.replace({ uri: audioUrl });
        generatedPlayer.play();
      }
    } catch (error) {
      console.error('Playback error:', error);
      Alert.alert('Erro', 'Não foi possível reproduzir o áudio');
    }
  };

  const confirmGeneratedAudio = () => {
    Alert.alert(
      'Sucesso',
      `Áudio "${generatedAudio.filename}" salvo no repertório!`
    );
    resetGeneratedAudio();
    navigation.goBack();
  };

  const discardGeneratedAudio = async () => {
    Alert.alert('Descartar', 'Deseja descartar este áudio?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: async () => {
          try {
            // Delete from server
            await api.deleteMusic(generatedAudio.id);
          } catch (error) {
            console.error('Delete error:', error);
          }
          resetGeneratedAudio();
        },
      },
    ]);
  };

  const resetGeneratedAudio = () => {
    generatedPlayer.pause();
    setGeneratedAudio(null);
  };

  // ============ MIX (VINHETA) FUNCTIONS ============

  const generateMixedAudio = async () => {
    if (!mixText.trim()) {
      Alert.alert('Erro', 'Digite o texto da locução');
      return;
    }

    if (!selectedMusic) {
      Alert.alert('Erro', 'Selecione uma música de fundo');
      return;
    }

    const voice = mixVoice || selectedVoice;
    if (!voice) {
      Alert.alert('Erro', 'Selecione uma voz');
      return;
    }

    setMixGenerating(true);
    try {
      const result = await api.generateMixedAudio({
        text: mixText,
        voiceId: voice.voice_id,
        stability,
        similarityBoost,
        backgroundMusicId: selectedMusic.id,
        introDuration,
        outroDuration,
        fadeOutDuration,
        musicDuckingVolume,
        name: mixName || null,
        isAd: true,
      });

      setMixGeneratedAudio({
        id: result.music_id,
        filename: result.filename,
        duration: result.duration,
        ttsDuration: result.tts_duration,
      });
    } catch (error) {
      console.error('Mix error:', error);
      Alert.alert('Erro', error.message || 'Falha ao gerar vinheta');
    } finally {
      setMixGenerating(false);
    }
  };

  const playMixGeneratedAudio = async () => {
    if (!mixGeneratedAudio) return;

    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (generatedPlayer.playing) {
        generatedPlayer.pause();
      } else {
        const audioUrl = `${api.getServerUrl()}/api/music/download/${mixGeneratedAudio.id}`;
        generatedPlayer.replace({ uri: audioUrl });
        generatedPlayer.play();
      }
    } catch (error) {
      console.error('Playback error:', error);
      Alert.alert('Erro', 'Não foi possível reproduzir o áudio');
    }
  };

  const confirmMixGeneratedAudio = () => {
    Alert.alert(
      'Sucesso',
      `Vinheta "${mixGeneratedAudio.filename}" salva no repertório!`
    );
    resetMixGeneratedAudio();
    navigation.goBack();
  };

  const discardMixGeneratedAudio = async () => {
    Alert.alert('Descartar', 'Deseja descartar esta vinheta?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteMusic(mixGeneratedAudio.id);
          } catch (error) {
            console.error('Delete error:', error);
          }
          resetMixGeneratedAudio();
        },
      },
    ]);
  };

  const resetMixGeneratedAudio = () => {
    generatedPlayer.pause();
    setMixGeneratedAudio(null);
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // ============ RENDER ============

  return (
    <View style={styles.container}>
      {/* Tab Buttons */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'record' && styles.tabActive]}
          onPress={() => setActiveTab('record')}
        >
          <Text style={[styles.tabText, activeTab === 'record' && styles.tabTextActive]}>
            🎙️ Gravar
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'ai' && styles.tabActive]}
          onPress={() => setActiveTab('ai')}
        >
          <Text style={[styles.tabText, activeTab === 'ai' && styles.tabTextActive]}>
            🤖 IA
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'mix' && styles.tabActive]}
          onPress={() => setActiveTab('mix')}
        >
          <Text style={[styles.tabText, activeTab === 'mix' && styles.tabTextActive]}>
            🎬 Vinheta
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {activeTab === 'record' ? (
          // ============ RECORDING TAB ============
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Gravar Audio</Text>
            <Text style={styles.sectionSubtitle}>
              Grave sua voz ou qualquer audio diretamente pelo app
            </Text>

            {/* Recording Controls */}
            <View style={styles.recordingContainer}>
              {!recordedUri ? (
                <>
                  <View style={styles.timerContainer}>
                    <Text style={styles.timer}>{formatDuration(recordingDuration)}</Text>
                    {recorder.isRecording && <View style={styles.recordingIndicator} />}
                  </View>

                  <TouchableOpacity
                    style={[styles.recordButton, recorder.isRecording && styles.recordButtonActive]}
                    onPress={recorder.isRecording ? stopRecording : startRecording}
                  >
                    <View style={[styles.recordButtonInner, recorder.isRecording && styles.stopButton]} />
                  </TouchableOpacity>

                  <Text style={styles.recordHint}>
                    {recorder.isRecording ? 'Toque para parar' : 'Toque para gravar'}
                  </Text>
                </>
              ) : (
                <>
                  <View style={styles.recordedContainer}>
                    <Text style={styles.recordedLabel}>Gravacao concluida!</Text>
                    <Text style={styles.recordedDuration}>{formatDuration(recordingDuration)}</Text>

                    <View style={styles.playbackButtons}>
                      <TouchableOpacity
                        style={styles.playbackBtn}
                        onPress={recordingPlayer.playing ? stopPlaying : playRecording}
                      >
                        <Text style={styles.playbackBtnText}>
                          {recordingPlayer.playing ? '⏹️ Parar' : '▶️ Ouvir'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.discardBtn} onPress={discardRecording}>
                        <Text style={styles.discardBtnText}>🗑️ Descartar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.uploadForm}>
                    <Text style={styles.inputLabel}>Nome do audio</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Ex: Vinheta de Natal"
                      placeholderTextColor={colors.textMuted}
                      value={recordingName}
                      onChangeText={setRecordingName}
                    />

                    <TouchableOpacity
                      style={styles.typeToggle}
                      onPress={() => setIsAd(!isAd)}
                    >
                      <View style={[styles.checkbox, isAd && styles.checkboxActive]}>
                        {isAd && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                      <Text style={styles.typeToggleText}>Marcar como propaganda</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.uploadBtn, uploading && styles.uploadBtnDisabled]}
                      onPress={uploadRecording}
                      disabled={uploading}
                    >
                      {uploading ? (
                        <ActivityIndicator color={colors.text} />
                      ) : (
                        <Text style={styles.uploadBtnText}>📤 Enviar para o servidor</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        ) : activeTab === 'ai' ? (
          // ============ AI TAB ============
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Gerar Audio com IA</Text>
            <Text style={styles.sectionSubtitle}>
              Use ElevenLabs para criar audios a partir de texto
            </Text>

            {!ttsConfigured ? (
              <View style={styles.notConfigured}>
                <Text style={styles.notConfiguredIcon}>⚠️</Text>
                <Text style={styles.notConfiguredText}>
                  API ElevenLabs não configurada
                </Text>
                <Text style={styles.notConfiguredHint}>
                  Configure ELEVENLABS_API_KEY no servidor
                </Text>
              </View>
            ) : generatedAudio ? (
              // ============ GENERATED AUDIO PREVIEW ============
              <View style={styles.generatedPreview}>
                <View style={styles.generatedIconContainer}>
                  <Text style={styles.generatedIcon}>🎵</Text>
                </View>
                <Text style={styles.generatedTitle}>Áudio Gerado!</Text>
                <Text style={styles.generatedFilename}>{generatedAudio.filename}</Text>

                <View style={styles.previewActions}>
                  <TouchableOpacity
                    style={[styles.previewPlayBtn, generatedPlayer.playing && styles.previewPlayBtnActive]}
                    onPress={playGeneratedAudio}
                  >
                    <Text style={styles.previewPlayBtnText}>
                      {generatedPlayer.playing ? '⏹ Parar' : '▶️ Ouvir Preview'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.confirmActions}>
                  <TouchableOpacity
                    style={styles.confirmBtn}
                    onPress={confirmGeneratedAudio}
                  >
                    <Text style={styles.confirmBtnText}>✓ Manter no Repertório</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.discardGeneratedBtn}
                    onPress={discardGeneratedAudio}
                  >
                    <Text style={styles.discardGeneratedBtnText}>🗑️ Descartar e Tentar Novamente</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                {/* Voice Selection */}
                <Text style={styles.inputLabel}>Voz</Text>
                <TouchableOpacity
                  style={styles.voiceSelector}
                  onPress={() => setVoiceModalVisible(true)}
                >
                  <Text style={styles.voiceSelectorText}>
                    {selectedVoice ? selectedVoice.name : 'Selecionar voz...'}
                  </Text>
                  <Text style={styles.voiceSelectorArrow}>▼</Text>
                </TouchableOpacity>

                {/* Text Input */}
                <Text style={styles.inputLabel}>Texto para converter em audio</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Digite o texto que sera convertido em audio..."
                  placeholderTextColor={colors.textMuted}
                  value={ttsText}
                  onChangeText={setTtsText}
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                />

                {/* Name Input */}
                <Text style={styles.inputLabel}>Nome do arquivo (opcional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: Propaganda Loja X"
                  placeholderTextColor={colors.textMuted}
                  value={ttsName}
                  onChangeText={setTtsName}
                />

                {/* Settings */}
                <View style={styles.settingsRow}>
                  <View style={styles.settingItem}>
                    <Text style={styles.settingLabel}>Estabilidade: {Math.round(stability * 100)}%</Text>
                    <View style={styles.sliderContainer}>
                      <TouchableOpacity onPress={() => setStability(Math.max(0, stability - 0.1))}>
                        <Text style={styles.sliderBtn}>−</Text>
                      </TouchableOpacity>
                      <View style={styles.sliderTrack}>
                        <View style={[styles.sliderFill, { width: `${stability * 100}%` }]} />
                      </View>
                      <TouchableOpacity onPress={() => setStability(Math.min(1, stability + 0.1))}>
                        <Text style={styles.sliderBtn}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.settingItem}>
                    <Text style={styles.settingLabel}>Similaridade: {Math.round(similarityBoost * 100)}%</Text>
                    <View style={styles.sliderContainer}>
                      <TouchableOpacity onPress={() => setSimilarityBoost(Math.max(0, similarityBoost - 0.1))}>
                        <Text style={styles.sliderBtn}>−</Text>
                      </TouchableOpacity>
                      <View style={styles.sliderTrack}>
                        <View style={[styles.sliderFill, { width: `${similarityBoost * 100}%` }]} />
                      </View>
                      <TouchableOpacity onPress={() => setSimilarityBoost(Math.min(1, similarityBoost + 0.1))}>
                        <Text style={styles.sliderBtn}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                {/* Type Toggle */}
                <TouchableOpacity
                  style={styles.typeToggle}
                  onPress={() => setIsAd(!isAd)}
                >
                  <View style={[styles.checkbox, isAd && styles.checkboxActive]}>
                    {isAd && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={styles.typeToggleText}>Marcar como propaganda</Text>
                </TouchableOpacity>

                {/* Generate Button */}
                <TouchableOpacity
                  style={[styles.generateBtn, generating && styles.generateBtnDisabled]}
                  onPress={generateAudio}
                  disabled={generating}
                >
                  {generating ? (
                    <>
                      <ActivityIndicator color={colors.text} />
                      <Text style={styles.generateBtnText}>Gerando...</Text>
                    </>
                  ) : (
                    <Text style={styles.generateBtnText}>🎵 Gerar Audio</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : activeTab === 'mix' ? (
          // ============ MIX (VINHETA) TAB ============
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Criar Vinheta</Text>
            <Text style={styles.sectionSubtitle}>
              Música de fundo + locução com IA
            </Text>

            {!ttsConfigured ? (
              <View style={styles.notConfigured}>
                <Text style={styles.notConfiguredIcon}>⚠️</Text>
                <Text style={styles.notConfiguredText}>
                  API ElevenLabs não configurada
                </Text>
                <Text style={styles.notConfiguredHint}>
                  Configure ELEVENLABS_API_KEY no servidor
                </Text>
              </View>
            ) : mixGeneratedAudio ? (
              // ============ MIX GENERATED AUDIO PREVIEW ============
              <View style={styles.generatedPreview}>
                <View style={styles.generatedIconContainer}>
                  <Text style={styles.generatedIcon}>🎬</Text>
                </View>
                <Text style={styles.generatedTitle}>Vinheta Criada!</Text>
                <Text style={styles.generatedFilename}>{mixGeneratedAudio.filename}</Text>
                <Text style={styles.mixDurationInfo}>
                  Duração: {Math.round(mixGeneratedAudio.duration)}s
                </Text>

                <View style={styles.previewActions}>
                  <TouchableOpacity
                    style={[styles.previewPlayBtn, generatedPlayer.playing && styles.previewPlayBtnActive]}
                    onPress={playMixGeneratedAudio}
                  >
                    <Text style={styles.previewPlayBtnText}>
                      {generatedPlayer.playing ? '⏹ Parar' : '▶️ Ouvir Preview'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.confirmActions}>
                  <TouchableOpacity
                    style={styles.confirmBtn}
                    onPress={confirmMixGeneratedAudio}
                  >
                    <Text style={styles.confirmBtnText}>✓ Salvar no Repertório</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.discardGeneratedBtn}
                    onPress={discardMixGeneratedAudio}
                  >
                    <Text style={styles.discardGeneratedBtnText}>🗑️ Descartar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                {/* Background Music Selection */}
                <Text style={styles.inputLabel}>Música de Fundo</Text>
                <TouchableOpacity
                  style={styles.voiceSelector}
                  onPress={() => setMusicModalVisible(true)}
                >
                  <Text style={styles.voiceSelectorText}>
                    {selectedMusic ? selectedMusic.original_name : 'Selecionar música...'}
                  </Text>
                  <Text style={styles.voiceSelectorArrow}>▼</Text>
                </TouchableOpacity>

                {/* Voice Selection */}
                <Text style={styles.inputLabel}>Voz para Locução</Text>
                <TouchableOpacity
                  style={styles.voiceSelector}
                  onPress={() => setVoiceModalVisible(true)}
                >
                  <Text style={styles.voiceSelectorText}>
                    {(mixVoice || selectedVoice)?.name || 'Selecionar voz...'}
                  </Text>
                  <Text style={styles.voiceSelectorArrow}>▼</Text>
                </TouchableOpacity>

                {/* Text Input */}
                <Text style={styles.inputLabel}>Texto da Locução</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Digite o texto que será falado sobre a música..."
                  placeholderTextColor={colors.textMuted}
                  value={mixText}
                  onChangeText={setMixText}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />

                {/* Name Input */}
                <Text style={styles.inputLabel}>Nome da Vinheta (opcional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: Vinheta Promocional Loja X"
                  placeholderTextColor={colors.textMuted}
                  value={mixName}
                  onChangeText={setMixName}
                />

                {/* Timing Settings */}
                <View style={styles.mixSettingsContainer}>
                  <Text style={styles.mixSettingsTitle}>⏱️ Configurações de Tempo</Text>

                  <View style={styles.mixSettingRow}>
                    <Text style={styles.mixSettingLabel}>Intro (música normal): {introDuration}s</Text>
                    <View style={styles.mixSliderRow}>
                      <TouchableOpacity onPress={() => setIntroDuration(Math.max(1, introDuration - 1))}>
                        <Text style={styles.sliderBtn}>−</Text>
                      </TouchableOpacity>
                      <View style={styles.sliderTrack}>
                        <View style={[styles.sliderFill, { width: `${(introDuration / 15) * 100}%` }]} />
                      </View>
                      <TouchableOpacity onPress={() => setIntroDuration(Math.min(15, introDuration + 1))}>
                        <Text style={styles.sliderBtn}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.mixSettingRow}>
                    <Text style={styles.mixSettingLabel}>Outro (música normal após fala): {outroDuration}s</Text>
                    <View style={styles.mixSliderRow}>
                      <TouchableOpacity onPress={() => setOutroDuration(Math.max(1, outroDuration - 1))}>
                        <Text style={styles.sliderBtn}>−</Text>
                      </TouchableOpacity>
                      <View style={styles.sliderTrack}>
                        <View style={[styles.sliderFill, { width: `${(outroDuration / 15) * 100}%` }]} />
                      </View>
                      <TouchableOpacity onPress={() => setOutroDuration(Math.min(15, outroDuration + 1))}>
                        <Text style={styles.sliderBtn}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.mixSettingRow}>
                    <Text style={styles.mixSettingLabel}>Fade Out Final: {fadeOutDuration}s</Text>
                    <View style={styles.mixSliderRow}>
                      <TouchableOpacity onPress={() => setFadeOutDuration(Math.max(1, fadeOutDuration - 1))}>
                        <Text style={styles.sliderBtn}>−</Text>
                      </TouchableOpacity>
                      <View style={styles.sliderTrack}>
                        <View style={[styles.sliderFill, { width: `${(fadeOutDuration / 10) * 100}%` }]} />
                      </View>
                      <TouchableOpacity onPress={() => setFadeOutDuration(Math.min(10, fadeOutDuration + 1))}>
                        <Text style={styles.sliderBtn}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.mixSettingRow}>
                    <Text style={styles.mixSettingLabel}>Volume música durante fala: {Math.round(musicDuckingVolume * 100)}%</Text>
                    <View style={styles.mixSliderRow}>
                      <TouchableOpacity onPress={() => setMusicDuckingVolume(Math.max(0.1, musicDuckingVolume - 0.1))}>
                        <Text style={styles.sliderBtn}>−</Text>
                      </TouchableOpacity>
                      <View style={styles.sliderTrack}>
                        <View style={[styles.sliderFill, { width: `${musicDuckingVolume * 100}%` }]} />
                      </View>
                      <TouchableOpacity onPress={() => setMusicDuckingVolume(Math.min(0.5, musicDuckingVolume + 0.1))}>
                        <Text style={styles.sliderBtn}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                {/* Timeline Preview */}
                <View style={styles.timelinePreview}>
                  <Text style={styles.timelineTitle}>📊 Preview da Timeline</Text>
                  <View style={styles.timelineBar}>
                    <View style={[styles.timelineSegment, styles.introSegment, { flex: introDuration }]}>
                      <Text style={styles.timelineSegmentText}>🎵</Text>
                    </View>
                    <View style={[styles.timelineSegment, styles.voiceSegment, { flex: 5 }]}>
                      <Text style={styles.timelineSegmentText}>🗣️</Text>
                    </View>
                    <View style={[styles.timelineSegment, styles.outroSegment, { flex: outroDuration }]}>
                      <Text style={styles.timelineSegmentText}>🎵</Text>
                    </View>
                    <View style={[styles.timelineSegment, styles.fadeSegment, { flex: fadeOutDuration }]}>
                      <Text style={styles.timelineSegmentText}>📉</Text>
                    </View>
                  </View>
                  <View style={styles.timelineLegend}>
                    <Text style={styles.legendItem}>🎵 Música normal</Text>
                    <Text style={styles.legendItem}>🗣️ Locução + música baixa</Text>
                    <Text style={styles.legendItem}>📉 Fade out</Text>
                  </View>
                </View>

                {/* Generate Button */}
                <TouchableOpacity
                  style={[styles.generateBtn, styles.mixGenerateBtn, mixGenerating && styles.generateBtnDisabled]}
                  onPress={generateMixedAudio}
                  disabled={mixGenerating}
                >
                  {mixGenerating ? (
                    <>
                      <ActivityIndicator color={colors.text} />
                      <Text style={styles.generateBtnText}>Gerando Vinheta...</Text>
                    </>
                  ) : (
                    <Text style={styles.generateBtnText}>🎬 Criar Vinheta</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : null}
      </ScrollView>

      {/* Voice Selection Modal */}
      <Modal
        visible={voiceModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setVoiceModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setVoiceModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Selecionar Voz</Text>
            <ScrollView style={styles.voiceList}>
              {voices.map((voice) => (
                <TouchableOpacity
                  key={voice.voice_id}
                  style={[
                    styles.voiceItem,
                    selectedVoice?.voice_id === voice.voice_id && styles.voiceItemActive,
                  ]}
                  onPress={() => {
                    setSelectedVoice(voice);
                    setVoiceModalVisible(false);
                  }}
                >
                  <Text style={styles.voiceName}>{voice.name}</Text>
                  <Text style={styles.voiceCategory}>{voice.category}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setVoiceModalVisible(false)}
            >
              <Text style={styles.modalCloseBtnText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Music Selection Modal */}
      <Modal
        visible={musicModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMusicModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setMusicModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Selecionar Música de Fundo</Text>
            <ScrollView style={styles.voiceList}>
              {musicList.map((music) => (
                <TouchableOpacity
                  key={music.id}
                  style={[
                    styles.voiceItem,
                    selectedMusic?.id === music.id && styles.voiceItemActive,
                  ]}
                  onPress={() => {
                    setSelectedMusic(music);
                    setMusicModalVisible(false);
                  }}
                >
                  <Text style={styles.voiceName}>{music.original_name}</Text>
                  <Text style={styles.voiceCategory}>
                    {music.duration ? `${Math.round(music.duration)}s` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
              {musicList.length === 0 && (
                <Text style={styles.emptyListText}>Nenhuma música disponível</Text>
              )}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setMusicModalVisible(false)}
            >
              <Text style={styles.modalCloseBtnText}>Fechar</Text>
            </TouchableOpacity>
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
  tabContainer: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: {
    backgroundColor: colors.gold + '20',
    borderColor: colors.gold,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  tabTextActive: {
    color: colors.gold,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: spacing.lg,
  },
  section: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },

  // Recording styles
  recordingContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  timer: {
    fontSize: 48,
    fontWeight: '300',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  recordingIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.danger,
    marginLeft: spacing.md,
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surface,
    borderWidth: 4,
    borderColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  recordButtonActive: {
    borderColor: colors.textMuted,
  },
  recordButtonInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.danger,
  },
  stopButton: {
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
  recordHint: {
    color: colors.textMuted,
    fontSize: 14,
  },

  // Recorded state
  recordedContainer: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  recordedLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.success,
    marginBottom: spacing.xs,
  },
  recordedDuration: {
    fontSize: 24,
    color: colors.text,
    marginBottom: spacing.md,
  },
  playbackButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  playbackBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
  },
  playbackBtnText: {
    color: colors.text,
    fontWeight: '500',
  },
  discardBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  discardBtnText: {
    color: colors.danger,
    fontWeight: '500',
  },

  // Upload form
  uploadForm: {
    width: '100%',
  },
  inputLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  typeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  checkmark: {
    color: colors.background,
    fontWeight: '700',
    fontSize: 14,
  },
  typeToggleText: {
    color: colors.text,
    fontSize: 15,
  },
  uploadBtn: {
    backgroundColor: colors.success,
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  uploadBtnDisabled: {
    opacity: 0.6,
  },
  uploadBtnText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },

  // AI styles
  notConfigured: {
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
  },
  notConfiguredIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  notConfiguredText: {
    color: colors.warning,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  notConfiguredHint: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  voiceSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  voiceSelectorText: {
    color: colors.text,
    fontSize: 15,
  },
  voiceSelectorArrow: {
    color: colors.textMuted,
    fontSize: 12,
  },
  settingsRow: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  settingItem: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  settingLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sliderBtn: {
    color: colors.gold,
    fontSize: 24,
    fontWeight: '600',
    paddingHorizontal: spacing.sm,
  },
  sliderTrack: {
    flex: 1,
    height: 8,
    backgroundColor: colors.surfaceLight,
    borderRadius: 4,
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
    backgroundColor: colors.gold,
    borderRadius: 4,
  },
  generateBtn: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  generateBtnDisabled: {
    opacity: 0.6,
  },
  generateBtnText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
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
    padding: spacing.lg,
    width: '100%',
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  voiceList: {
    maxHeight: 300,
  },
  voiceItem: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceLight,
  },
  voiceItemActive: {
    backgroundColor: colors.gold + '30',
    borderWidth: 1,
    borderColor: colors.gold,
  },
  voiceName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  voiceCategory: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  modalCloseBtnText: {
    color: colors.textMuted,
    fontSize: 15,
  },

  // Generated audio preview styles
  generatedPreview: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  generatedIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.success + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  generatedIcon: {
    fontSize: 40,
  },
  generatedTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.success,
    marginBottom: spacing.xs,
  },
  generatedFilename: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  previewActions: {
    width: '100%',
    marginBottom: spacing.xl,
  },
  previewPlayBtn: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.gold,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  previewPlayBtnActive: {
    backgroundColor: colors.gold + '20',
  },
  previewPlayBtnText: {
    color: colors.gold,
    fontSize: 18,
    fontWeight: '600',
  },
  confirmActions: {
    width: '100%',
    gap: spacing.md,
  },
  confirmBtn: {
    backgroundColor: colors.success,
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  discardGeneratedBtn: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  discardGeneratedBtnText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '500',
  },

  // Mix (Vinheta) styles
  mixSettingsContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  mixSettingsTitle: {
    color: colors.gold,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  mixSettingRow: {
    marginBottom: spacing.md,
  },
  mixSettingLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: spacing.xs,
  },
  mixSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mixGenerateBtn: {
    backgroundColor: colors.gold,
    marginBottom: spacing.xl,
  },
  mixDurationInfo: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: spacing.lg,
  },

  // Timeline Preview
  timelinePreview: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  timelineTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  timelineBar: {
    flexDirection: 'row',
    height: 40,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  timelineSegment: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  timelineSegmentText: {
    fontSize: 16,
  },
  introSegment: {
    backgroundColor: colors.success + '40',
  },
  voiceSegment: {
    backgroundColor: colors.gold + '60',
  },
  outroSegment: {
    backgroundColor: colors.success + '40',
  },
  fadeSegment: {
    backgroundColor: colors.textMuted + '40',
  },
  timelineLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  legendItem: {
    color: colors.textMuted,
    fontSize: 11,
  },
  emptyListText: {
    color: colors.textMuted,
    textAlign: 'center',
    padding: spacing.lg,
  },
});
