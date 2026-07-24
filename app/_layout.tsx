import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus, View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { clearSession, getStoredSession } from '@/services/auth';

const SESSION_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityAtRef = useRef(Date.now());

  const clearInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  const closeSessionByInactivity = useCallback(async () => {
    clearInactivityTimer();

    const storedSession = await getStoredSession();
    if (!storedSession) {
      return;
    }

    await clearSession();
    router.replace('/');
  }, [clearInactivityTimer]);

  const resetInactivityTimer = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    clearInactivityTimer();
    inactivityTimerRef.current = setTimeout(() => {
      void closeSessionByInactivity();
    }, SESSION_INACTIVITY_TIMEOUT_MS);
  }, [clearInactivityTimer, closeSessionByInactivity]);

  useEffect(() => {
    resetInactivityTimer();

    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          const inactiveFor = Date.now() - lastActivityAtRef.current;

          if (inactiveFor >= SESSION_INACTIVITY_TIMEOUT_MS) {
            void closeSessionByInactivity();
            return;
          }

          resetInactivityTimer();
          return;
        }

        clearInactivityTimer();
      },
    );

    return () => {
      subscription.remove();
      clearInactivityTimer();
    };
  }, [clearInactivityTimer, closeSessionByInactivity, resetInactivityTimer]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <View onTouchStart={resetInactivityTimer} style={{ flex: 1 }}>
        <Stack>
          <Stack.Screen name="index" options={{ title: 'Acceso', headerShown: false }} />
          <Stack.Screen name="cliente" options={{ title: 'Cliente' }} />
          <Stack.Screen name="proveedor" options={{ title: 'Escanear' }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="auto" />
      </View>
    </ThemeProvider>
  );
}
