import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { router } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { clearSession, getHomePathForProfile, getStoredSession, login } from '@/services/auth';

export default function LoginScreen() {
  const [usuario, setUsuario] = useState('');
  const [contrasenia, setContrasenia] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let mounted = true;

    getStoredSession()
      .then((session) => {
        if (mounted && session) {
          const homePath = getHomePathForProfile(session.user.id_perfil);

          if (homePath) {
            router.replace(homePath);
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

  const canSubmit = usuario.trim().length > 0 && contrasenia.length > 0 && !loading;

  const handleLogin = async () => {
    if (!canSubmit) {
      setError('Escribe usuario y contrasenia.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const session = await login(usuario, contrasenia);
      const homePath = getHomePathForProfile(session.user.id_perfil);

      if (!homePath) {
        await clearSession();
        setError('Este perfil no tiene acceso a la app.');
        return;
      }

      router.replace(homePath);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'No se pudo iniciar sesion.');
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
                <Text style={styles.title}>FIC 2026</Text>
                <Text style={styles.subtitle}>En un lugar de la Mancha...</Text>
              </View>

              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setUsuario}
                placeholder="Vuestro Usuario"
                placeholderTextColor="#c8b9a0"
                returnKeyType="next"
                style={styles.input}
                value={usuario}
              />

              <View style={styles.passwordRow}>
                <TextInput
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
});
