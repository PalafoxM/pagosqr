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
import { registerPushToken } from "@/services/notifications";
import {
  ChargeResult,
  createProviderCharge,
  getProviderChargeStatus,
  getProviderEstablecimientos,
  PaymentMethod,
  ProviderEstablecimiento,
} from "@/services/provider-data";

const TIP_PERCENTAGES = [0, 5, 10, 15];

const moneyFromText = (value: string) => {
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseClientQrPayload = (value: string) => {
  try {
    const payload = JSON.parse(value) as {
      tipo?: string;
      id_usuario?: number;
      id_perfil?: number;
      nombre_completo?: string;
    };

    if (
      payload.tipo === "PAGOS_FIC_CLIENTE" &&
      Number(payload.id_perfil) === 3 &&
      Number(payload.id_usuario) > 0
    ) {
      return {
        id_usuario: Number(payload.id_usuario),
        nombre_completo: String(payload.nombre_completo || ""),
      };
    }
  } catch {}

  return null;
};

export default function ProveedorScreen() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [establecimientos, setEstablecimientos] = useState<ProviderEstablecimiento[]>([]);
  const [selectedEstablecimientoId, setSelectedEstablecimientoId] = useState(0);
  const [establecimientosLoading, setEstablecimientosLoading] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [amount, setAmount] = useState("");
  const [tipPercentage, setTipPercentage] = useState(0);
  const [description, setDescription] = useState("Consumo en establecimiento");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("app");
  const [nip, setNip] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ChargeResult | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const parsedClient = useMemo(() => parseClientQrPayload(qrCode), [qrCode]);

  useEffect(() => {
    let mounted = true;

    getStoredSession().then((storedSession) => {
      if (!mounted) {
        return;
      }

      if (!storedSession || storedSession.user.id_perfil !== 2) {
        clearSession();
        router.replace("/");
        return;
      }

      if (
        storedSession.user.id_tipo_proveedor === 2 ||
        storedSession.user.id_tipo_proveedor === 3
      ) {
        router.replace("/hotel" as never);
        return;
      }

      setSession(storedSession);
      setSelectedEstablecimientoId(storedSession.user.id_establecimiento || 0);
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

    registerPushToken(session.token, session.user.id_usuario).catch((pushError) => {
      console.warn("No se pudo registrar push token.", pushError);
    });
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let mounted = true;
    const providerRef = session.user.no_proveedor || session.user.id_usuario;

    setEstablecimientosLoading(true);
    getProviderEstablecimientos(session.token, providerRef)
      .then((items) => {
        if (!mounted) {
          return;
        }

        setEstablecimientos(items);

        if (!selectedEstablecimientoId && items[0]?.id_establecimiento) {
          setSelectedEstablecimientoId(Number(items[0].id_establecimiento));
        }
      })
      .catch(() => {
        if (mounted) {
          setEstablecimientos([]);
        }
      })
      .finally(() => {
        if (mounted) {
          setEstablecimientosLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [selectedEstablecimientoId, session]);

  const subtotal = useMemo(() => moneyFromText(amount), [amount]);
  const tipAmount = useMemo(
    () => Number(((subtotal * tipPercentage) / 100).toFixed(2)),
    [subtotal, tipPercentage],
  );
  const total = subtotal + tipAmount;
  const selectedEstablecimiento = establecimientos.find(
    (item) => Number(item.id_establecimiento) === selectedEstablecimientoId,
  );
  const canCharge =
    Boolean(session) &&
    Boolean(parsedClient?.id_usuario) &&
    subtotal > 0 &&
    selectedEstablecimientoId > 0 &&
    !submitting &&
    (paymentMethod === "app" || nip.trim().length > 0);
  const isPaymentApproved = result?.status === "approved";
  const isPaymentPending = result?.status === "pending";

  const handleLogout = async () => {
    await clearSession();
    router.replace("/");
  };

  const handleResetCharge = () => {
    setQrCode("");
    setAmount("");
    setTipPercentage(0);
    setDescription("Consumo en establecimiento");
    setPaymentMethod("app");
    setNip("");
    setError("");
    setResult(null);
    setScannerOpen(false);
  };

  useEffect(() => {
    if (!session || !result?.supportsStatusPolling || result.status !== "pending") {
      return;
    }

    let mounted = true;
    const transactionId = result.id || result.transaction_id;

    if (!transactionId) {
      return;
    }

    const pollStatus = async () => {
      try {
        const nextResult = await getProviderChargeStatus(session.token, transactionId);

        if (mounted && nextResult.status && nextResult.status !== "pending") {
          setResult((currentResult) => ({
            ...currentResult,
            ...nextResult,
            supportsStatusPolling: false,
          }));
        }
      } catch (statusError) {
        console.warn("No se pudo consultar estatus del cobro.", statusError);
      }
    };

    pollStatus();
    const intervalId = setInterval(pollStatus, 3000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [result, session]);

  const handleCharge = async () => {
    if (!session || !canCharge) {
      setError("Escanea un QR de cliente valido y completa establecimiento y monto.");
      return;
    }

    setSubmitting(true);
    setError("");
    setResult(null);

    try {
      const chargeResult = await createProviderCharge(session.token, {
        qrCode: qrCode.trim(),
        clientUserId: parsedClient?.id_usuario,
        clientId: parsedClient?.id_usuario,
        id_usuario: parsedClient?.id_usuario,
        amount: subtotal,
        tip: tipAmount,
        description: description.trim() || "Consumo en establecimiento",
        paymentMethod,
        nip: paymentMethod === "nip" ? nip.trim() : undefined,
        idEstablecimiento: selectedEstablecimientoId,
      });
      setResult(chargeResult);
      setQrCode("");
      setAmount("");
      setTipPercentage(0);
      setNip("");
    } catch (chargeError) {
      setError(chargeError instanceof Error ? chargeError.message : "No se pudo realizar el cobro.");
    } finally {
      setSubmitting(false);
    }
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

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={styles.screen}>
      <Stack.Screen options={{ title: "Cobro" }} />

      {checkingSession ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#d5a84f" size="large" />
        </View>
      ) : (
        <>
          <View style={styles.banner}>
            <View style={styles.medallion}>
              <IconSymbol color="#fff8e8" name="creditcard.fill" size={30} />
            </View>
            <View style={styles.bannerCopy}>
              <Text style={styles.kicker}>Proveedor FIC</Text>
              <Text style={styles.title}>{session?.user.nombre || "Comercio"}</Text>
              <Text style={styles.body}>
                {selectedEstablecimiento?.dsc_establecimiento || "Caja de cobro"}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Cerrar sesión"
              accessibilityRole="button"
              onPress={handleLogout}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
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
                accessibilityLabel="Nuevo cobro"
                accessibilityRole="button"
                onPress={handleResetCharge}
                style={({ pressed }) => [styles.newChargeButton, pressed && styles.pressed]}>
                <IconSymbol color="#fff8e8" name="qrcode.viewfinder" size={22} />
                <Text style={[styles.panelTitle, styles.newChargeButtonText]}>Nuevo cobro</Text>
              </Pressable>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Establecimiento</Text>
              {establecimientosLoading ? <ActivityIndicator color="#8f1d2c" /> : null}
              <View style={styles.establishmentList}>
                {establecimientos.length > 0 ? (
                  establecimientos.map((item) => {
                    const selected =
                      Number(item.id_establecimiento) === selectedEstablecimientoId;

                    return (
                      <Pressable
                        key={item.id_establecimiento}
                        onPress={() =>
                          setSelectedEstablecimientoId(Number(item.id_establecimiento))
                        }
                        style={[styles.establishmentPill, selected && styles.establishmentPillActive]}>
                        <Text
                          style={[
                            styles.establishmentPillText,
                            selected && styles.establishmentPillTextActive,
                          ]}>
                          {item.dsc_establecimiento || `#${item.id_establecimiento}`}
                        </Text>
                      </Pressable>
                    );
                  })
                ) : (
                  <Text style={styles.hintText}>Sin establecimientos asignados.</Text>
                )}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>QR del cliente</Text>
              <View style={styles.qrInputRow}>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setQrCode}
                  placeholder="Escanea o pega el código QR"
                  placeholderTextColor="#9b876a"
                  style={[styles.input, styles.qrInput]}
                  value={parsedClient?.nombre_completo ?? qrCode}
                />
                <Pressable
                  accessibilityLabel="Escanear código QR"
                  accessibilityRole="button"
                  onPress={handleOpenScanner}
                  style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}>
                  <IconSymbol color="#fff8e8" name="qrcode.viewfinder" size={22} />
                </Pressable>
              </View>
              {parsedClient ? (
                <Text style={styles.clientPreview}>
                  {parsedClient.nombre_completo || "Cliente"}
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
                    onBarcodeScanned={(result) => {
                      if (result.data) {
                        setQrCode(result.data);
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
                  style={({ pressed }) => [styles.closeScannerButton, pressed && styles.pressed]}>
                  <Text style={styles.closeScannerText}>Cerrar escaner</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.moneyRow}>
              <View style={[styles.field, styles.moneyField]}>
                <Text style={styles.label}>Monto</Text>
                <TextInput
                  keyboardType="decimal-pad"
                  onChangeText={setAmount}
                  placeholder="0.00"
                  placeholderTextColor="#9b876a"
                  style={styles.input}
                  value={amount}
                />
              </View>
            </View>

            <View style={styles.field}>
              <View style={styles.tipHeader}>
                <Text style={styles.label}>Propina</Text>
                <Text style={styles.tipAmountText}>${tipAmount.toFixed(2)}</Text>
              </View>
              <View style={styles.tipPercentageList}>
                {TIP_PERCENTAGES.map((percentage) => {
                  const selected = tipPercentage === percentage;

                  return (
                    <Pressable
                      accessibilityRole="button"
                      key={percentage}
                      onPress={() => setTipPercentage(percentage)}
                      style={({ pressed }) => [
                        styles.tipPercentageButton,
                        selected && styles.tipPercentageButtonActive,
                        pressed && styles.pressed,
                      ]}>
                      <Text
                        style={[
                          styles.tipPercentageText,
                          selected && styles.tipPercentageTextActive,
                        ]}>
                        {percentage}%
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Descripcion</Text>
              <TextInput
                onChangeText={setDescription}
                placeholder="Consumo en establecimiento"
                placeholderTextColor="#9b876a"
                style={styles.input}
                value={description}
              />
            </View>

            <View style={styles.segmented}>
              <Pressable
                onPress={() => setPaymentMethod("app")}
                style={[styles.segment, paymentMethod === "app" && styles.segmentActive]}>
                <Text
                  style={[
                    styles.segmentText,
                    paymentMethod === "app" && styles.segmentTextActive,
                  ]}>
                  Notificacion
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setPaymentMethod("nip")}
                style={[styles.segment, paymentMethod === "nip" && styles.segmentActive]}>
                <Text
                  style={[
                    styles.segmentText,
                    paymentMethod === "nip" && styles.segmentTextActive,
                  ]}>
                  NIP
                </Text>
              </Pressable>
            </View>

            {paymentMethod === "nip" ? (
              <View style={styles.field}>
                <Text style={styles.label}>NIP del cliente</Text>
                <TextInput
                  keyboardType="number-pad"
                  onChangeText={setNip}
                  placeholder="NIP"
                  placeholderTextColor="#9b876a"
                  secureTextEntry
                  style={styles.input}
                  value={nip}
                />
              </View>
            ) : null}

            <View style={styles.totalBox}>
              <Text style={styles.totalLabel}>Total a cobrar</Text>
              <Text style={styles.totalValue}>${total.toFixed(2)}</Text>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              disabled={!canCharge || isPaymentApproved || isPaymentPending}
              onPress={handleCharge}
              style={({ pressed }) => [
                styles.primaryButton,
                isPaymentApproved && styles.primaryButtonSuccess,
                isPaymentPending && styles.primaryButtonWaiting,
                (!canCharge || pressed) &&
                  !isPaymentApproved &&
                  !isPaymentPending &&
                  styles.primaryButtonPressed,
              ]}>
              {submitting ? (
                <ActivityIndicator color="#fff8e8" />
              ) : (
                <>
                  <IconSymbol color="#fff8e8" name="checkmark.seal.fill" size={20} />
                  <Text style={styles.primaryButtonText}>
                    {isPaymentApproved
                      ? "Realizado"
                      : isPaymentPending
                        ? "Esperando aprobacion"
                        : paymentMethod === "app"
                          ? "Enviar notificacion"
                          : "Cobrar ahora"}
                  </Text>
                </>
              )}
            </Pressable>
          </View>

          {result ? (
            <View style={[styles.resultPanel, isPaymentApproved && styles.resultPanelSuccess]}>
              <Text style={styles.resultTitle}>
                {result.status === "approved" ? "Pago realizado" : "Solicitud enviada"}
              </Text>
              <Text style={styles.resultText}>Folio: {result.transaction_id || result.id}</Text>
              <Text style={styles.resultText}>Total: ${(Number(result.total) || total).toFixed(2)}</Text>
              {result.status === "pending" ? (
                <Text style={styles.resultHint}>El cliente debe aprobar la solicitud en su app.</Text>
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
    backgroundColor: "#f3ead5",
  },
  content: {
    gap: 18,
    padding: 24,
  },
  centered: {
    alignItems: "center",
    minHeight: 260,
    justifyContent: "center",
  },
  banner: {
    alignItems: "center",
    backgroundColor: "#fff8e8",
    borderColor: "#3b2619",
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
    borderRadius: 34,
    borderWidth: 3,
    height: 68,
    justifyContent: "center",
    width: 68,
  },
  bannerCopy: {
    flex: 1,
    gap: 5,
  },
  kicker: {
    color: "#8f1d2c",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: "#24160f",
    fontSize: 24,
    fontWeight: "900",
  },
  body: {
    color: "#6f5639",
    fontSize: 15,
    lineHeight: 21,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "#8f1d2c",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  pressed: {
    opacity: 0.72,
  },
  panel: {
    backgroundColor: "#fff8e8",
    borderColor: "#3b2619",
    borderRadius: 8,
    borderWidth: 1,
    gap: 16,
    padding: 18,
  },
  panelHeader: {
    alignItems: "center",
    flexDirection: "row",
  },
  newChargeButton: {
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
  newChargeButtonText: {
    color: "#fff8e8",
    fontSize: 15,
  },
  panelTitle: {
    color: "#24160f",
    fontSize: 20,
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
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  cameraShell: {
    borderRadius: 8,
    height: 320,
    overflow: "hidden",
    position: "relative",
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.18)",
    justifyContent: "center",
    gap: 18,
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
    minHeight: 42,
    justifyContent: "center",
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
  establishmentList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  establishmentPill: {
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  establishmentPillActive: {
    backgroundColor: "#8f1d2c",
    borderColor: "#8f1d2c",
  },
  establishmentPillText: {
    color: "#3b2619",
    fontSize: 13,
    fontWeight: "800",
  },
  establishmentPillTextActive: {
    color: "#fff8e8",
  },
  hintText: {
    color: "#6f5639",
    fontSize: 14,
    lineHeight: 20,
  },
  moneyRow: {
    flexDirection: "row",
    gap: 12,
  },
  moneyField: {
    flex: 1,
  },
  tipHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tipAmountText: {
    color: "#3b2619",
    fontSize: 16,
    fontWeight: "900",
  },
  tipPercentageList: {
    flexDirection: "row",
    gap: 8,
  },
  tipPercentageButton: {
    alignItems: "center",
    backgroundColor: "#f9efd9",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  tipPercentageButtonActive: {
    backgroundColor: "#8f1d2c",
    borderColor: "#8f1d2c",
  },
  tipPercentageText: {
    color: "#3b2619",
    fontSize: 14,
    fontWeight: "900",
  },
  tipPercentageTextActive: {
    color: "#fff8e8",
  },
  segmented: {
    backgroundColor: "#e7d7b5",
    borderColor: "#3b2619",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    padding: 4,
  },
  segment: {
    alignItems: "center",
    borderRadius: 6,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  segmentActive: {
    backgroundColor: "#3b2619",
  },
  segmentText: {
    color: "#3b2619",
    fontSize: 14,
    fontWeight: "900",
  },
  segmentTextActive: {
    color: "#fff8e8",
  },
  totalBox: {
    backgroundColor: "#24160f",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  totalLabel: {
    color: "#d5a84f",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  totalValue: {
    color: "#fff8e8",
    fontSize: 34,
    fontWeight: "900",
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
  primaryButtonSuccess: {
    backgroundColor: "#15803d",
    borderColor: "#166534",
    opacity: 1,
  },
  primaryButtonWaiting: {
    backgroundColor: "#6f5639",
    borderColor: "#3b2619",
    opacity: 1,
  },
  primaryButtonText: {
    color: "#fff8e8",
    fontSize: 16,
    fontWeight: "900",
  },
  resultPanel: {
    backgroundColor: "#f9efd9",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  resultPanelSuccess: {
    backgroundColor: "#dcfce7",
    borderColor: "#15803d",
  },
  resultTitle: {
    color: "#24160f",
    fontSize: 18,
    fontWeight: "900",
  },
  resultText: {
    color: "#3b2619",
    fontSize: 15,
    lineHeight: 21,
  },
  resultHint: {
    color: "#6f5639",
    fontSize: 14,
    lineHeight: 20,
  },
});
