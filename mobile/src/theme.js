// ============================================
// Natal Iluminado 2025 - Itapecerica/MG
// Design System - Tema Natalino
// Gestão: Papelaria Ponto VIP
// ============================================

export const colors = {
  // Background - Vermelho escuro natalino
  background: '#1a0505',      // Vermelho muito escuro
  surface: '#2a0a0a',         // Vermelho escuro para cards
  surfaceLight: '#3a1515',    // Vermelho médio
  surfaceElevated: '#4a1a1a', // Vermelho elevado

  // Primary - Verde Natalino (para botões principais)
  primary: '#1b5e20',         // Verde Natal
  primaryLight: '#2e7d32',
  primaryDark: '#0d3d12',

  // Secondary - Dourado
  secondary: '#ffd700',
  secondaryLight: '#ffe44d',

  // Accent - Dourado
  gold: '#ffd700',
  goldDark: '#b8860b',

  // Text
  text: '#ffffff',
  textSecondary: '#e0c0c0',   // Tom rosado claro
  textMuted: '#a08080',       // Tom rosado escuro

  // Status
  success: '#4caf50',         // Verde claro
  warning: '#ffd700',         // Dourado
  error: '#ff6b6b',           // Vermelho claro (para contraste)
  info: '#64b5f6',

  // Accent colors
  accent: '#ffd700',          // Dourado
  accentAlt: '#4caf50',       // Verde

  // Border
  border: '#3a1515',
  borderLight: '#4a2020',

  // Christmas special
  christmasRed: '#c41e3a',
  christmasGreen: '#1b5e20',
  christmasGold: '#ffd700',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const borderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
};

export const typography = {
  h1: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  h2: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
  },
  h3: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  body: {
    fontSize: 15,
    color: colors.text,
  },
  caption: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  small: {
    fontSize: 11,
    color: colors.textMuted,
  },
};

// Informações do Evento
export const eventInfo = {
  name: 'Natal Iluminado',
  year: '2025',
  city: 'Itapecerica',
  state: 'MG',
  management: 'Papelaria Ponto VIP',
  version: '1.0.0',
};
