import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  clearRememberedCredentials,
  clearSession,
  getHomePathForProfile,
  getRememberedCredentials,
  getStoredSession,
  login,
  saveRememberedCredentials,
} from '@/services/auth';
import { registerPushToken } from '@/services/notifications';

const APP_VERSION = Constants.expoConfig?.version || '1.0.0';
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 60000;

const registerSessionPushToken = async (token: string, userId?: number) => {
  try {
    const pushToken = await registerPushToken(token, userId);

    if (!pushToken) {
      console.warn('No se obtuvo token push para este dispositivo.');
    }
  } catch (pushError) {
    console.warn('No se pudo registrar push token.', pushError);
  }
};

export default function LoginScreen() {
  const [usuario, setUsuario] = useState('');
  const [contrasenia, setContrasenia] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberUser, setRememberUser] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  useEffect(() => {
    let mounted = true;

    getRememberedCredentials().then((credentials) => {
      if (mounted && credentials) {
        setUsuario(credentials.usuario);
        setRememberUser(true);
      }
    });

    getStoredSession()
      .then((session) => {
        if (mounted && session) {
          const homePath = getHomePathForProfile(
            session.user.id_perfil,
            session.user.id_tipo_proveedor,
          );

          if (homePath) {
            registerSessionPushToken(session.token, session.user.id_usuario);
            router.replace(homePath as never);
            return;
          }

          clearSession();
        }
      })
      .finally(() => {
        if (mounted) {
          setCheckingSession(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const isLocked = lockedUntil > Date.now();
  const canSubmit = usuario.trim().length > 0 && contrasenia.length > 0 && !loading && !isLocked;

  const handleLogin = async () => {
    if (isLocked) {
      const remainingSeconds = Math.ceil((lockedUntil - Date.now()) / 1000);
      setError(`Demasiados intentos. Espera ${remainingSeconds} segundos.`);
      return;
    }

    if (!canSubmit) {
      setError('Escribe usuario y contrasenia.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const session = await login(usuario, contrasenia);
      const homePath = getHomePathForProfile(
        session.user.id_perfil,
        session.user.id_tipo_proveedor,
      );

      if (!homePath) {
        await clearSession();
        setError('Este perfil no tiene acceso a la app.');
        return;
      }

      if (rememberUser) {
        await saveRememberedCredentials({ usuario });
      } else {
        await clearRememberedCredentials();
      }

      setFailedAttempts(0);
      setLockedUntil(0);
      await registerSessionPushToken(session.token, session.user.id_usuario);
      router.replace(homePath as never);
    } catch (loginError) {
      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);

      if (nextAttempts >= MAX_LOGIN_ATTEMPTS) {
        setLockedUntil(Date.now() + LOGIN_LOCK_MS);
        setError('Demasiados intentos. Espera 60 segundos.');
      } else {
        setError(loginError instanceof Error ? loginError.message : 'No se pudo iniciar sesion.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#c9a15a" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.screen}>
      <ImageBackground
        resizeMode="cover"
        source={require('../images/Cervantes.jpg')}
        style={styles.background}>
        <View style={styles.scrim}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}>
            <View style={styles.form}>
              <View style={styles.header}>
                <Image
                  resizeMode="contain"
                  source={require('../assets/logo2.png')}
                  style={styles.logo}
                />
                <Text style={styles.title}>FIC 2026</Text>
                <Text style={styles.subtitle}>En un lugar de la Mancha...</Text>
              </View>

              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={80}
                onChangeText={setUsuario}
                placeholder="Vuestro Usuario"
                placeholderTextColor="#c8b9a0"
                returnKeyType="next"
                style={styles.input}
                value={usuario}
              />

              <View style={styles.passwordRow}>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={128}
                  onChangeText={setContrasenia}
                  onSubmitEditing={handleLogin}
                  placeholder="Palabra Secreta"
                  placeholderTextColor="#c8b9a0"
                  returnKeyType="go"
                  secureTextEntry={!showPassword}
                  style={[styles.input, styles.passwordInput]}
                value={contrasenia}
              />
              <Pressable
                accessibilityLabel={showPassword ? 'Ocultar contrasenia' : 'Ver contrasenia'}
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => setShowPassword((visible) => !visible)}
                style={({ pressed }) => [styles.eyeButton, pressed && styles.eyeButtonPressed]}>
                <IconSymbol
                  color="#e2cfaa"
                  name={showPassword ? 'eye.slash' : 'eye'}
                  size={24}
                />
              </Pressable>
              </View>

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: rememberUser }}
                onPress={() => setRememberUser((checked) => !checked)}
                style={({ pressed }) => [styles.rememberRow, pressed && styles.rememberRowPressed]}>
                <View style={[styles.checkbox, rememberUser && styles.checkboxChecked]}>
                  {rememberUser ? <Text style={styles.checkboxMark}>x</Text> : null}
                </View>
                <Text style={styles.rememberText}>Recordar usuario</Text>
              </Pressable>

              {error ? (
                <Text selectable style={styles.error}>
                  {error}
                </Text>
              ) : null}

              <Pressable
                disabled={!canSubmit}
                onPress={handleLogin}
                style={({ pressed }) => [
                  styles.button,
                  (!canSubmit || pressed) && styles.buttonPressed,
                ]}>
                {loading ? (
                  <ActivityIndicator color="#fff3d3" />
                ) : (
                  <Text style={styles.buttonText}>Adentrarse</Text>
                )}
              </Pressable>
              <Text style={styles.version}>Version {APP_VERSION}</Text>
            </View>
          </ScrollView>
        </View>
      </ImageBackground>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#110d0b',
  },
  centered: {
    alignItems: 'center',
    backgroundColor: '#110d0b',
    flex: 1,
    justifyContent: 'center',
  },
  background: {
    flex: 1,
  },
  scrim: {
    backgroundColor: 'rgba(13, 10, 8, 0.34)',
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 44,
  },
  header: {
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    height: 82,
    marginBottom: 2,
    width: 160,
  },
  title: {
    color: '#fff3d3',
    fontSize: 38,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  subtitle: {
    color: '#e2cfaa',
    fontSize: 16,
    lineHeight: 24,
  },
  form: {
    backgroundColor: 'rgba(25, 35, 66, 0.78)',
    borderColor: 'rgba(226, 207, 170, 0.46)',
    borderCurve: 'continuous',
    borderRadius: 8,
    borderWidth: 1,
    gap: 16,
    padding: 24,
    shadowColor: '#000000',
    shadowOffset: { height: 14, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
  },
  input: {
    backgroundColor: 'rgba(255, 243, 211, 0.08)',
    borderColor: 'rgba(226, 207, 170, 0.46)',
    borderCurve: 'continuous',
    borderRadius: 8,
    borderWidth: 1,
    color: '#fff3d3',
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  passwordRow: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 54,
  },
  eyeButton: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    top: 0,
    width: 52,
  },
  eyeButtonPressed: {
    opacity: 0.6,
  },
  rememberRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  rememberRowPressed: {
    opacity: 0.7,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: 'rgba(226, 207, 170, 0.7)',
    borderRadius: 4,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkboxChecked: {
    backgroundColor: '#b13f4b',
    borderColor: '#ffcf83',
  },
  checkboxMark: {
    color: '#fff3d3',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 16,
  },
  rememberText: {
    color: '#e2cfaa',
    fontSize: 14,
    fontWeight: '700',
  },
  error: {
    color: '#ffcf83',
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#b13f4b',
    borderCurve: 'continuous',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  buttonPressed: {
    opacity: 0.72,
  },
  buttonText: {
    color: '#fff3d3',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  version: {
    color: '#e2cfaa',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
});
