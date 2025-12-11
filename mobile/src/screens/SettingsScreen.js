import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import api from '../services/api';
import websocket from '../services/websocket';
import { colors, borderRadius, spacing, eventInfo } from '../theme';

export default function SettingsScreen() {
  const [serverUrl, setServerUrl] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setServerUrl(api.getServerUrl());
  }, []);

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      await api.setServerUrl(serverUrl);
      await api.getSettings();
      Alert.alert('Conexão Estabelecida', 'O aplicativo está conectado ao servidor!');

      websocket.disconnect();
      websocket.connect();
    } catch (error) {
      Alert.alert('Erro de Conexão', 'Não foi possível conectar ao servidor. Verifique o endereço e tente novamente.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Event Header */}
      <View style={styles.eventHeader}>
        <Text style={styles.eventStar}>★</Text>
        <Text style={styles.eventName}>{eventInfo.name}</Text>
        <Text style={styles.eventYear}>{eventInfo.year}</Text>
        <Text style={styles.eventStar}>★</Text>
      </View>
      <Text style={styles.eventLocation}>{eventInfo.city} - {eventInfo.state}</Text>

      {/* Server Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CONEXÃO</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Endereço do Servidor</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="http://192.168.1.100:8000"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.hint}>
            Digite o IP do computador que está executando o servidor de áudio
          </Text>

          <TouchableOpacity
            style={[styles.btn, testing && styles.btnDisabled]}
            onPress={handleTestConnection}
            disabled={testing}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText}>
              {testing ? 'Conectando...' : 'Testar Conexão'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>SOBRE O EVENTO</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Evento</Text>
            <Text style={styles.aboutValue}>{eventInfo.name} {eventInfo.year}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Cidade</Text>
            <Text style={styles.aboutValue}>{eventInfo.city} - {eventInfo.state}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Gestão</Text>
            <Text style={styles.aboutValue}>{eventInfo.management}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Versão do App</Text>
            <Text style={styles.aboutValue}>{eventInfo.version}</Text>
          </View>
        </View>
      </View>

      {/* Help Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>COMO USAR</Text>
        <View style={styles.card}>
          <View style={styles.helpItem}>
            <View style={styles.helpNumber}>
              <Text style={styles.helpNumberText}>1</Text>
            </View>
            <View style={styles.helpContent}>
              <Text style={styles.helpTitle}>Servidor Ativo</Text>
              <Text style={styles.helpText}>Certifique-se de que o servidor de áudio está rodando no computador principal</Text>
            </View>
          </View>

          <View style={styles.helpItem}>
            <View style={styles.helpNumber}>
              <Text style={styles.helpNumberText}>2</Text>
            </View>
            <View style={styles.helpContent}>
              <Text style={styles.helpTitle}>Mesma Rede Wi-Fi</Text>
              <Text style={styles.helpText}>Conecte seu celular na mesma rede Wi-Fi do servidor</Text>
            </View>
          </View>

          <View style={styles.helpItem}>
            <View style={styles.helpNumber}>
              <Text style={styles.helpNumberText}>3</Text>
            </View>
            <View style={styles.helpContent}>
              <Text style={styles.helpTitle}>Endereço IP</Text>
              <Text style={styles.helpText}>Digite o endereço IP do servidor no campo acima</Text>
            </View>
          </View>

          <View style={styles.helpItem}>
            <View style={styles.helpNumber}>
              <Text style={styles.helpNumberText}>4</Text>
            </View>
            <View style={styles.helpContent}>
              <Text style={styles.helpTitle}>Testar Conexão</Text>
              <Text style={styles.helpText}>Clique em "Testar Conexão" para verificar a comunicação</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Volume Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>INFORMAÇÕES</Text>
        <View style={styles.card}>
          <View style={styles.infoItem}>
            <Text style={styles.infoIcon}>♪</Text>
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Caixas de Som</Text>
              <Text style={styles.infoText}>O volume controla as caixas de som espalhadas pelo centro da cidade</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoItem}>
            <Text style={styles.infoIcon}>◷</Text>
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Volume Automático</Text>
              <Text style={styles.infoText}>O volume é ajustado automaticamente conforme o horário (mais baixo durante a madrugada)</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoItem}>
            <Text style={styles.infoIcon}>★</Text>
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Patrocinadores</Text>
              <Text style={styles.infoText}>Os anúncios dos patrocinadores são reproduzidos automaticamente entre as músicas</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Desenvolvido para o {eventInfo.name} {eventInfo.year}</Text>
        <Text style={styles.footerSubtext}>Gestão: {eventInfo.management}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  eventStar: {
    color: colors.gold,
    fontSize: 20,
  },
  eventName: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  eventYear: {
    color: colors.gold,
    fontSize: 22,
    fontWeight: '700',
  },
  eventLocation: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  aboutLabel: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  aboutValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  helpItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  helpNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.gold + '30',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  helpNumberText: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: '700',
  },
  helpContent: {
    flex: 1,
  },
  helpTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  helpText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
  },
  infoIcon: {
    color: colors.gold,
    fontSize: 18,
    width: 32,
    marginRight: spacing.md,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  infoText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.lg,
  },
  footerText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  footerSubtext: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.xs,
    opacity: 0.7,
  },
});
