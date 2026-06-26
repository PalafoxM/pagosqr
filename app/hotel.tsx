import { CameraView, useCameraPermissions } from "expo-camera";
import { router, Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { AuthSession, clearSession, getStoredSession } from "@/services/auth";
import {
  createHotelCheckIn,
  HotelCheckInResult,
  parseHotelClientQrPayload,
} from "@/services/hotel-data";
import { registerPushToken } from "@/services/notifications";

const isHotelUser = (session: AuthSession | null) =>
  session?.user.id_perfil === 2 &&
  (session.user.id_tipo_proveedor === 2 || session.user.id_tipo_proveedor === 3);

const formatCheckInDate = (value: string | undefined) => {
  if (!value) {
    return "";
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("es-MX", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatMoney = (value: unknown) => `$${Number(value || 0).toFixed(2)}`;

export default function HotelScreen() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [qrCode, setQrCode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<HotelCheckInResult | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const parsedClient = useMemo(() => parseHotelClientQrPayload(qrCode), [qrCode]);

  useEffect(() => {
    let mounted = true;

    getStoredSession().then((storedSession) => {
      if (!mounted) {
        return;
      }

      if (!isHotelUser(storedSession)) {
        clearSession();
        router.replace("/");
        return;
      }

      setSession(storedSession);
      setCheckingSession(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    registerPushToken(session.token).catch((pushError) => {
      console.warn("No se pudo registrar push token.", pushError);
    });
  }, [session]);

  const handleLogout = async () => {
    await clearSession();
    router.replace("/");
  };

  const handleOpenScanner = async () => {
    setError("");

    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();

      if (!permission.granted) {
        setError("Se necesita permiso de camara para escanear el QR.");
        return;
      }
    }

    setScannerOpen(true);
  };

  const handleReset = () => {
    setQrCode("");
    setResult(null);
    setError("");
    setScannerOpen(false);
  };

  const handleCheckIn = async () => {
    if (!session || !parsedClient) {
      setError("Escanea un QR de cliente valido para registrar check-in.");
      return;
    }

    setSubmitting(true);
    setError("");
    setResult(null);

    try {
      const checkInResult = await createHotelCheckIn(session.token, {
        qrCode: qrCode.trim(),
        clientUserId: parsedClient.id_usuario,
      });

      setResult(checkInResult);
      setQrCode("");
      setScannerOpen(false);
    } catch (checkInError) {
      setError(
        checkInError instanceof Error
          ? checkInError.message
          : "No se pudo registrar el check-in.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
    >
      <Stack.Screen options={{ title: "Hotel" }} />

      {checkingSession ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#d5a84f" size="large" />
        </View>
      ) : (
        <>
          <View style={styles.banner}>
            <View style={styles.medallion}>
              <IconSymbol color="#fff8e8" name="building.2.fill" size={30} />
            </View>
            <View style={styles.bannerCopy}>
              <Text style={styles.kicker}>Hotel FIC</Text>
              <Text style={styles.title}>{session?.user.nombre || "Recepcion"}</Text>
              <Text style={styles.body}>
                {session?.user.id_tipo_proveedor === 3 ? "Gerencia" : "Recepcion"}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Cerrar sesion"
              accessibilityRole="button"
              onPress={handleLogout}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <IconSymbol
                color="#fff8e8"
                name="rectangle.portrait.and.arrow.right"
                size={22}
              />
            </Pressable>
          </View>

          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Pressable
                accessibilityLabel="Nuevo check-in"
                accessibilityRole="button"
                onPress={handleReset}
                style={({ pressed }) => [styles.newCheckInButton, pressed && styles.pressed]}
              >
                <IconSymbol color="#fff8e8" name="qrcode.viewfinder" size={22} />
                <Text style={styles.newCheckInButtonText}>Nuevo check-in</Text>
              </Pressable>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>QR del cliente</Text>
              <View style={styles.qrInputRow}>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setQrCode}
                  placeholder="Escanea o pega el codigo QR"
                  placeholderTextColor="#9b876a"
                  style={[styles.input, styles.qrInput]}
                  value={parsedClient?.nombre_completo ?? qrCode}
                />
                <Pressable
                  accessibilityLabel="Escanear codigo QR"
                  accessibilityRole="button"
                  onPress={handleOpenScanner}
                  style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}
                >
                  <IconSymbol color="#fff8e8" name="qrcode.viewfinder" size={22} />
                </Pressable>
              </View>
              {parsedClient ? (
                <Text style={styles.clientPreview}>
                  {parsedClient.nombre_completo || "Cliente"} listo para check-in
                </Text>
              ) : null}
            </View>

            {scannerOpen ? (
              <View style={styles.scannerPanel}>
                <View style={styles.cameraShell}>
                  <CameraView
                    active={scannerOpen}
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    facing="back"
                    onBarcodeScanned={(scanResult) => {
                      if (scanResult.data) {
                        setQrCode(scanResult.data);
                        setScannerOpen(false);
                      }
                    }}
                    style={styles.camera}
                  />
                  <View pointerEvents="none" style={styles.scannerOverlay}>
                    <View style={styles.scannerFrame} />
                    <Text style={styles.scannerText}>Alinea el QR del cliente</Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => setScannerOpen(false)}
                  style={({ pressed }) => [styles.closeScannerButton, pressed && styles.pressed]}
                >
                  <Text style={styles.closeScannerText}>Cerrar escaner</Text>
                </Pressable>
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              disabled={!parsedClient || submitting}
              onPress={handleCheckIn}
              style={({ pressed }) => [
                styles.primaryButton,
                (!parsedClient || submitting || pressed) && styles.primaryButtonPressed,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#fff8e8" />
              ) : (
                <>
                  <IconSymbol color="#fff8e8" name="checkmark.seal.fill" size={20} />
                  <Text style={styles.primaryButtonText}>Registrar check-in</Text>
                </>
              )}
            </Pressable>
          </View>

          {result ? (
            <View style={styles.resultPanel}>
              <Text style={styles.resultTitle}>Check-in registrado</Text>
              <Text style={styles.resultText}>
                Cliente: {result.nombre_completo || result.id_usuario}
              </Text>
              <Text style={styles.resultText}>
                Fecha: {formatCheckInDate(result.fecha_check_in)}
              </Text>
              {result.tarifa_noche !== undefined ? (
                <Text style={styles.resultText}>
                  Tarifa descontada: {formatMoney(result.tarifa_noche)}
                </Text>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#2a2118",
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 18,
    paddingBottom: 36,
  },
  centered: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 420,
  },
  banner: {
    alignItems: "center",
    backgroundColor: "#24160f",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    padding: 16,
  },
  medallion: {
    alignItems: "center",
    backgroundColor: "#8f1d2c",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  bannerCopy: {
    flex: 1,
    gap: 4,
  },
  kicker: {
    color: "#d5a84f",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: "#fff8e8",
    fontSize: 21,
    fontWeight: "900",
  },
  body: {
    color: "#e7d7b5",
    fontSize: 14,
    lineHeight: 20,
  },
  iconButton: {
    alignItems: "center",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  panel: {
    backgroundColor: "#fff8e8",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    gap: 18,
    padding: 16,
  },
  panelHeader: {
    alignItems: "center",
    flexDirection: "row",
  },
  newCheckInButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#8f1d2c",
    borderColor: "#6f141f",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  newCheckInButtonText: {
    color: "#fff8e8",
    fontSize: 15,
    fontWeight: "900",
  },
  field: {
    gap: 7,
  },
  label: {
    color: "#8f1d2c",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: "#f9efd9",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    color: "#24160f",
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  qrInputRow: {
    flexDirection: "row",
    gap: 10,
  },
  qrInput: {
    flex: 1,
  },
  scanButton: {
    alignItems: "center",
    backgroundColor: "#3b2619",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    width: 54,
  },
  scannerPanel: {
    backgroundColor: "#24160f",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    overflow: "hidden",
    padding: 10,
  },
  cameraShell: {
    borderRadius: 8,
    height: 320,
    overflow: "hidden",
    position: "relative",
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.18)",
    gap: 18,
    justifyContent: "center",
  },
  scannerFrame: {
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 3,
    height: 210,
    width: 210,
  },
  scannerText: {
    color: "#fff8e8",
    fontSize: 15,
    fontWeight: "900",
  },
  closeScannerButton: {
    alignItems: "center",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  closeScannerText: {
    color: "#fff8e8",
    fontSize: 14,
    fontWeight: "900",
  },
  clientPreview: {
    color: "#3b2619",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  error: {
    color: "#8f1d2c",
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#8f1d2c",
    borderColor: "#6f141f",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 54,
  },
  primaryButtonPressed: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: "#fff8e8",
    fontSize: 16,
    fontWeight: "900",
  },
  resultPanel: {
    backgroundColor: "#dcfce7",
    borderColor: "#15803d",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  resultTitle: {
    color: "#14532d",
    fontSize: 18,
    fontWeight: "900",
  },
  resultText: {
    color: "#166534",
    fontSize: 15,
    lineHeight: 21,
  },
  pressed: {
    opacity: 0.72,
  },
});
