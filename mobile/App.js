import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet } from 'react-native';

import PlayerScreen from './src/screens/PlayerScreen';
import SchedulesScreen from './src/screens/SchedulesScreen';
import MusicScreen from './src/screens/MusicScreen';
import AudioCreateScreen from './src/screens/AudioCreateScreen';
import LogsScreen from './src/screens/LogsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator();

const Tab = createBottomTabNavigator();

const TabIcon = ({ name, focused }) => {
  const icons = {
    Player: '♪',
    Agenda: '◷',
    Músicas: '♫',
    Histórico: '☰',
    Ajustes: '⚙',
  };

  return (
    <View style={[
      styles.tabIconContainer,
      focused && styles.tabIconContainerActive
    ]}>
      <Text style={[
        styles.tabIcon,
        { color: focused ? colors.gold : colors.textMuted }
      ]}>
        {icons[name]}
      </Text>
    </View>
  );
};

const stackScreenOptions = {
  headerStyle: {
    backgroundColor: colors.surface,
  },
  headerTintColor: colors.gold,
  headerTitleStyle: {
    fontWeight: '600',
    fontSize: 17,
  },
  headerShadowVisible: false,
};

// Stack navigator for Music tab
function MusicStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="MusicList"
        component={MusicScreen}
        options={{ title: 'Musicas de Natal' }}
      />
      <Stack.Screen
        name="AudioCreate"
        component={AudioCreateScreen}
        options={{ title: 'Criar Audio' }}
      />
    </Stack.Navigator>
  );
}

const screenOptions = {
  headerStyle: {
    backgroundColor: colors.surface,
    elevation: 0,
    shadowOpacity: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTintColor: colors.gold,
  headerTitleStyle: {
    fontWeight: '600',
    fontSize: 17,
  },
  tabBarStyle: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    height: 70,
    paddingBottom: 12,
    paddingTop: 8,
  },
  tabBarActiveTintColor: colors.gold,
  tabBarInactiveTintColor: colors.textMuted,
  tabBarLabelStyle: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
};

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Tab.Navigator screenOptions={screenOptions}>
        <Tab.Screen
          name="Player"
          component={PlayerScreen}
          options={{
            title: 'Player',
            headerTitle: 'Natal Iluminado 2025',
            tabBarIcon: ({ focused }) => <TabIcon name="Player" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Agenda"
          component={SchedulesScreen}
          options={{
            title: 'Agenda',
            headerTitle: 'Programação',
            tabBarIcon: ({ focused }) => <TabIcon name="Agenda" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Músicas"
          component={MusicStack}
          options={{
            title: 'Músicas',
            headerShown: false,
            tabBarIcon: ({ focused }) => <TabIcon name="Músicas" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Histórico"
          component={LogsScreen}
          options={{
            title: 'Histórico',
            headerTitle: 'Histórico',
            tabBarIcon: ({ focused }) => <TabIcon name="Histórico" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Ajustes"
          component={SettingsScreen}
          options={{
            title: 'Ajustes',
            headerTitle: 'Ajustes',
            tabBarIcon: ({ focused }) => <TabIcon name="Ajustes" focused={focused} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  tabIconContainerActive: {
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
  },
  tabIcon: {
    fontSize: 18,
  },
});
