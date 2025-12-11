import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import api from '../services/api';
import { colors, borderRadius, spacing } from '../theme';

const LOG_TYPES = [
  { key: null, label: 'Todos' },
  { key: 'music', label: 'Músicas' },
  { key: 'ad', label: 'Patrocínios' },
  { key: 'volume_manual', label: 'Volume' },
  { key: 'app', label: 'Sistema' },
  { key: 'connection', label: 'Conexão' },
];

export default function LogsScreen() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedType, setSelectedType] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const fetchLogs = useCallback(async (reset = false) => {
    try {
      const offset = reset ? 0 : logs.length;
      const data = await api.getLogs(50, offset, selectedType);
      const newLogs = data.logs || data || [];

      if (reset) {
        setLogs(newLogs);
      } else {
        setLogs(prev => [...prev, ...newLogs]);
      }

      setHasMore(newLogs.length === 50);
    } catch (error) {
      console.error('Error fetching logs:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [selectedType, logs.length]);

  useEffect(() => {
    setLoading(true);
    fetchLogs(true);
  }, [selectedType]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchLogs(true);
    setRefreshing(false);
  }, [fetchLogs]);

  const onEndReached = () => {
    if (!loadingMore && hasMore) {
      setLoadingMore(true);
      fetchLogs(false);
    }
  };

  const formatDateTime = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getLogStyle = (type) => {
    switch (type) {
      case 'music': return { color: colors.success, label: 'Música', icon: '♪' };
      case 'ad': return { color: colors.gold, label: 'Patrocínio', icon: '★' };
      case 'volume_manual': return { color: colors.info, label: 'Volume', icon: '◉' };
      case 'volume_scheduled': return { color: colors.success, label: 'Vol. Auto', icon: '◷' };
      case 'app': return { color: colors.textSecondary, label: 'Sistema', icon: '⚙' };
      case 'connection': return { color: colors.error, label: 'Conexão', icon: '◌' };
      default: return { color: colors.textMuted, label: type || 'Evento', icon: '•' };
    }
  };

  const renderLogItem = ({ item }) => {
    const style = getLogStyle(item.type);

    return (
      <View style={styles.logItem}>
        <View style={styles.logHeader}>
          <View style={[styles.logIconContainer, { backgroundColor: style.color + '20' }]}>
            <Text style={[styles.logIcon, { color: style.color }]}>{style.icon}</Text>
          </View>
          <View style={styles.logHeaderInfo}>
            <Text style={[styles.logType, { color: style.color }]}>{style.label}</Text>
            <Text style={styles.logTime}>{formatDateTime(item.timestamp)}</Text>
          </View>
        </View>
        <Text style={styles.logMessage}>{item.description}</Text>
        {item.details && (
          <Text style={styles.logDetails}>{item.details}</Text>
        )}
      </View>
    );
  };

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={colors.gold} />
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Filter Chips */}
      <View style={styles.filterWrapper}>
        <FlatList
          horizontal
          data={LOG_TYPES}
          keyExtractor={(item) => item.key || 'all'}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContainer}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.filterChip,
                selectedType === item.key && styles.filterChipActive,
              ]}
              onPress={() => setSelectedType(item.key)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.filterText,
                  selectedType === item.key && styles.filterTextActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Logs List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.gold} />
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item, index) => item.id?.toString() || index.toString()}
          renderItem={renderLogItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>☰</Text>
              <Text style={styles.emptyText}>Nenhum registro encontrado</Text>
              <Text style={styles.emptyHint}>O histórico de atividades aparecerá aqui</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  filterWrapper: {
    backgroundColor: colors.background,
  },
  filterContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  filterTextActive: {
    color: colors.text,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: spacing.lg,
    paddingTop: 0,
    flexGrow: 1,
  },
  logItem: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  logIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  logIcon: {
    fontSize: 14,
  },
  logHeaderInfo: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logType: {
    fontSize: 12,
    fontWeight: '600',
  },
  logTime: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  logMessage: {
    color: colors.text,
    fontSize: 14,
    marginLeft: 32 + spacing.md,
  },
  logDetails: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: spacing.xs,
    marginLeft: 32 + spacing.md,
  },
  footer: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
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
