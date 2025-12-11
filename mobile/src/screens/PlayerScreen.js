import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Animated,
  Easing,
} from 'react-native';
import Slider from '@react-native-community/slider';
import api from '../services/api';
import websocket from '../services/websocket';
import { colors, borderRadius, spacing } from '../theme';

// Componente de luzes de Natal animadas
const ChristmasLights = () => {
  const lightColors = ['#ff0000', '#ffd700', '#00ff00', '#ff0000', '#ffd700', '#00ff00', '#ff0000', '#ffd700', '#00ff00'];
  const animations = useRef(lightColors.map(() => new Animated.Value(0.3))).current;

  useEffect(() => {
    const animateLight = (index) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(animations[index], {
            toValue: 1,
            duration: 500 + Math.random() * 500,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
          Animated.timing(animations[index], {
            toValue: 0.3,
            duration: 500 + Math.random() * 500,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
        ])
      ).start();
    };

    animations.forEach((_, index) => {
      setTimeout(() => animateLight(index), index * 150);
    });
  }, []);

  return (
    <View style={styles.lightsContainer}>
      <View style={styles.lightsWire} />
      {lightColors.map((color, index) => (
        <Animated.View
          key={index}
          style={[
            styles.lightBulb,
            {
              backgroundColor: color,
              opacity: animations[index],
              shadowColor: color,
              shadowOpacity: 1,
              shadowRadius: 8,
              elevation: 5,
            },
          ]}
        />
      ))}
    </View>
  );
};

// Flocos de neve animados
const Snowflakes = () => {
  const snowflakes = useRef(
    Array.from({ length: 12 }, () => ({
      anim: new Animated.Value(0),
      left: Math.random() * 100,
      delay: Math.random() * 3000,
      duration: 4000 + Math.random() * 3000,
      size: 8 + Math.random() * 8,
    }))
  ).current;

  useEffect(() => {
    snowflakes.forEach((flake) => {
      const animate = () => {
        flake.anim.setValue(0);
        Animated.timing(flake.anim, {
          toValue: 1,
          duration: flake.duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start(() => animate());
      };
      setTimeout(animate, flake.delay);
    });
  }, []);

  return (
    <View style={styles.snowContainer}>
      {snowflakes.map((flake, index) => (
        <Animated.Text
          key={index}
          style={[
            styles.snowflake,
            {
              left: `${flake.left}%`,
              fontSize: flake.size,
              opacity: flake.anim.interpolate({
                inputRange: [0, 0.1, 0.9, 1],
                outputRange: [0, 0.8, 0.8, 0],
              }),
              transform: [
                {
                  translateY: flake.anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-20, 400],
                  }),
                },
                {
                  translateX: flake.anim.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [0, 15, 0],
                  }),
                },
              ],
            },
          ]}
        >
          ❄
        </Animated.Text>
      ))}
    </View>
  );
};

// Papai Noel animado
const AnimatedSanta = () => {
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Animação de pulo
    Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, {
          toValue: -8,
          duration: 600,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
        Animated.timing(bounceAnim, {
          toValue: 0,
          duration: 600,
          easing: Easing.bounce,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Animação de balançar
    Animated.loop(
      Animated.sequence([
        Animated.timing(waveAnim, {
          toValue: 1,
          duration: 400,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
        Animated.timing(waveAnim, {
          toValue: -1,
          duration: 400,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
        Animated.timing(waveAnim, {
          toValue: 0,
          duration: 400,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.santaContainer,
        {
          transform: [
            { translateY: bounceAnim },
            {
              rotate: waveAnim.interpolate({
                inputRange: [-1, 0, 1],
                outputRange: ['-5deg', '0deg', '5deg'],
              }),
            },
          ],
        },
      ]}
    >
      <Text style={styles.santaEmoji}>🎅</Text>
    </Animated.View>
  );
};

// Estrela piscante
const TwinklingStar = ({ style }) => {
  const twinkle = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(twinkle, {
          toValue: 1,
          duration: 1000,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
        Animated.timing(twinkle, {
          toValue: 0.3,
          duration: 1000,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <Animated.Text style={[styles.twinkleStar, style, { opacity: twinkle }]}>
      ✦
    </Animated.Text>
  );
};

export default function PlayerScreen() {
  const [status, setStatus] = useState({
    currentSong: null,
    isPlaying: false,
    volume: 0.5,
    position: 0,
    duration: 0,
    remaining: 0,
  });
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Guarda o último volume que enviamos para o servidor
  const lastSentVolume = useRef(null);
  const volumeAdjustTimeout = useRef(null);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status.isPlaying) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1000,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status.isPlaying]);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.getPlayerStatus();
      const serverVolume = data.volume || 0.5;

      setStatus(prev => {
        // Se temos um volume pendente que acabamos de enviar, e o servidor ainda não refletiu,
        // mantemos o valor local. Caso contrário, aceitamos o valor do servidor.
        let newVolume = serverVolume;
        if (lastSentVolume.current !== null) {
          // Se o servidor retornou um valor muito próximo do que enviamos, limpa o pending
          if (Math.abs(serverVolume - lastSentVolume.current) < 0.02) {
            lastSentVolume.current = null;
          } else {
            // Servidor ainda não refletiu nossa mudança, manter valor local
            newVolume = prev.volume;
          }
        }

        return {
          currentSong: data.current_song,
          isPlaying: data.is_playing,
          volume: newVolume,
          position: data.position || 0,
          duration: data.duration || 0,
          remaining: data.remaining || 0,
        };
      });
      setConnected(true);
    } catch (error) {
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    websocket.connect();

    const unsubConnect = websocket.on('connect', () => {
      setConnected(true);
      fetchStatus();
    });

    const unsubDisconnect = websocket.on('disconnect', () => {
      setConnected(false);
    });

    const unsubStatus = websocket.on('playerStatus', (data) => {
      if (data.current_song !== undefined) {
        setStatus(prev => {
          const serverVolume = data.volume ?? prev.volume;

          // Se temos um volume pendente que acabamos de enviar
          let newVolume = serverVolume;
          if (lastSentVolume.current !== null) {
            // Se o servidor retornou um valor muito próximo do que enviamos, limpa o pending
            if (Math.abs(serverVolume - lastSentVolume.current) < 0.02) {
              lastSentVolume.current = null;
            } else {
              // Servidor ainda não refletiu nossa mudança, manter valor local
              newVolume = prev.volume;
            }
          }

          return {
            ...prev,
            currentSong: data.current_song,
            isPlaying: data.is_playing ?? prev.isPlaying,
            volume: newVolume,
            position: data.position ?? prev.position,
            duration: data.duration ?? prev.duration,
            remaining: data.remaining ?? prev.remaining,
          };
        });
      }
    });

    const interval = setInterval(fetchStatus, 5000);

    return () => {
      unsubConnect();
      unsubDisconnect();
      unsubStatus();
      clearInterval(interval);
      if (volumeAdjustTimeout.current) {
        clearTimeout(volumeAdjustTimeout.current);
      }
    };
  }, [fetchStatus]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchStatus();
    setRefreshing(false);
  }, [fetchStatus]);

  const handlePlay = async () => {
    try {
      await api.play();
      setStatus(prev => ({ ...prev, isPlaying: true }));
    } catch (error) {
      console.error('Play error:', error);
    }
  };

  const handlePause = async () => {
    try {
      await api.pause();
      setStatus(prev => ({ ...prev, isPlaying: false }));
    } catch (error) {
      console.error('Pause error:', error);
    }
  };

  const handleSkip = async () => {
    try {
      await api.skip();
    } catch (error) {
      console.error('Skip error:', error);
    }
  };

  const handleVolumeChange = async (value) => {
    // Cancela timeout anterior se existir
    if (volumeAdjustTimeout.current) {
      clearTimeout(volumeAdjustTimeout.current);
    }

    // Guarda o valor que estamos enviando
    lastSentVolume.current = value;

    setStatus(prev => ({ ...prev, volume: value }));
  };

  const handleVolumeComplete = async (value) => {
    try {
      // Guarda o valor final enviado
      lastSentVolume.current = value;
      await api.setVolume(value);

      // Após 3 segundos, limpa o pending para aceitar qualquer valor do servidor
      volumeAdjustTimeout.current = setTimeout(() => {
        lastSentVolume.current = null;
      }, 3000);
    } catch (error) {
      console.error('Volume error:', error);
      lastSentVolume.current = null;
    }
  };

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  const progress = status.duration ? (status.position / status.duration) : 0;

  return (
    <View style={styles.mainContainer}>
      {/* Flocos de neve no fundo */}
      <Snowflakes />

      {/* Estrelas decorativas */}
      <TwinklingStar style={{ top: 60, left: 20 }} />
      <TwinklingStar style={{ top: 100, right: 30 }} />
      <TwinklingStar style={{ top: 180, left: 50 }} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.gold}
          />
        }
      >
        {/* Luzes de Natal no topo */}
        <ChristmasLights />

        {/* Header com Papai Noel */}
        <View style={styles.headerDecor}>
          <AnimatedSanta />
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Natal Iluminado</Text>
            <Text style={styles.headerSubtitle}>Itapecerica-MG • 2025</Text>
          </View>
          <Text style={styles.treeEmoji}>🎄</Text>
        </View>

        {/* Status Badge */}
        <View style={[styles.statusBadge, connected ? styles.statusOnline : styles.statusOffline]}>
          <View style={[styles.statusDot, { backgroundColor: connected ? colors.success : colors.error }]} />
          <Text style={styles.statusText}>
            {connected ? 'Transmitindo' : 'Desconectado'}
          </Text>
        </View>

        {/* Now Playing Card */}
        <Animated.View style={[styles.card, { transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.cardHeader}>
            <Text style={styles.musicIcon}>🎵</Text>
            <Text style={styles.cardLabel}>TOCANDO AGORA</Text>
            <Text style={styles.musicIcon}>🎵</Text>
          </View>
          <Text style={styles.songTitle} numberOfLines={2}>
            {status.currentSong || 'Nenhuma música'}
          </Text>

          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            <View style={styles.timeContainer}>
              <Text style={styles.timeText}>{formatTime(status.position)}</Text>
              <Text style={styles.timeText}>-{formatTime(status.remaining)}</Text>
            </View>
          </View>
        </Animated.View>

        {/* Controls */}
        <View style={styles.controlsContainer}>
          <TouchableOpacity
            style={[styles.controlBtn, styles.playBtn]}
            onPress={status.isPlaying ? handlePause : handlePlay}
            activeOpacity={0.8}
          >
            <Text style={styles.playIcon}>
              {status.isPlaying ? '❚❚' : '▶'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPress={handleSkip}
            activeOpacity={0.7}
          >
            <Text style={styles.skipIcon}>▶▶</Text>
          </TouchableOpacity>
        </View>

        {/* Volume Card */}
        <View style={styles.card}>
          <View style={styles.volumeHeader}>
            <View style={styles.volumeTitleContainer}>
              <Text style={styles.volumeIcon}>🔊</Text>
              <Text style={styles.volumeLabel}>Volume das Caixas</Text>
            </View>
            <Text style={styles.volumeValue}>{Math.round(status.volume * 100)}%</Text>
          </View>
          <Text style={styles.volumeHint}>Controle o volume das caixas de som do centro</Text>
          <View style={styles.sliderContainer}>
            <Text style={styles.sliderIcon}>🔈</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={1}
              value={status.volume}
              onValueChange={handleVolumeChange}
              onSlidingComplete={handleVolumeComplete}
              minimumTrackTintColor={colors.success}
              maximumTrackTintColor={colors.surfaceLight}
              thumbTintColor={colors.gold}
            />
            <Text style={styles.sliderIcon}>🔊</Text>
          </View>
        </View>

        {/* Footer festivo */}
        <View style={styles.footer}>
          <Text style={styles.footerEmojis}>🎄 ⭐ 🎁 ⭐ 🎄</Text>
          <Text style={styles.footerText}>Gestão: Papelaria Ponto VIP</Text>
          <Text style={styles.footerWish}>Feliz Natal!</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Luzes de Natal
  lightsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: 40,
    marginBottom: spacing.md,
    position: 'relative',
  },
  lightsWire: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#333',
    borderRadius: 1,
  },
  lightBulb: {
    width: 12,
    height: 16,
    borderRadius: 6,
    marginTop: 10,
  },
  // Flocos de neve
  snowContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  snowflake: {
    position: 'absolute',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  // Estrelas
  twinkleStar: {
    position: 'absolute',
    color: colors.gold,
    fontSize: 16,
    zIndex: 1,
  },
  // Papai Noel
  santaContainer: {
    marginRight: spacing.sm,
  },
  santaEmoji: {
    fontSize: 40,
  },
  treeEmoji: {
    fontSize: 36,
  },
  // Header
  headerDecor: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  headerTextContainer: {
    alignItems: 'center',
    marginHorizontal: spacing.md,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  // Status
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    marginBottom: spacing.lg,
  },
  statusOnline: {
    backgroundColor: 'rgba(76, 175, 80, 0.3)',
  },
  statusOffline: {
    backgroundColor: 'rgba(255, 107, 107, 0.3)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  musicIcon: {
    fontSize: 16,
  },
  cardLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  songTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '600',
    marginBottom: spacing.xl,
    lineHeight: 28,
    textAlign: 'center',
  },
  // Progress
  progressContainer: {
    marginTop: spacing.sm,
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.surfaceLight,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.success,
    borderRadius: 2,
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  timeText: {
    color: colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  // Controls
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    marginVertical: spacing.lg,
  },
  controlBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  playIcon: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  skipIcon: {
    color: colors.textSecondary,
    fontSize: 16,
    letterSpacing: -4,
  },
  // Volume
  volumeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  volumeTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  volumeIcon: {
    fontSize: 18,
  },
  volumeLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  volumeValue: {
    color: colors.gold,
    fontSize: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  volumeHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.md,
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slider: {
    flex: 1,
    marginHorizontal: spacing.sm,
  },
  sliderIcon: {
    fontSize: 16,
  },
  // Footer
  footer: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerEmojis: {
    fontSize: 20,
    marginBottom: spacing.sm,
    letterSpacing: 4,
  },
  footerText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  footerWish: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
});
