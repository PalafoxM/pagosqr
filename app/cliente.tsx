import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, Stack } from "expo-router";
import QRCode from "react-native-qrcode-svg";

import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  ClienteProfile,
  EstablecimientoFic,
  getClienteProfile,
  getEstablecimientosFic,
  getFallbackClienteProfile,
} from "@/services/client-data";
import { AuthSession, clearSession, getStoredSession } from "@/services/auth";
import {
  PaymentRequestNotification,
  approvePaymentRequest,
  observePaymentRequests,
  rejectPaymentRequest,
} from "@/services/notifications";

type ClienteTab = "datos" | "establecimientos" | "cuenta";

const tabs: { id: ClienteTab; label: string }[] = [
  { id: "datos", label: "Mis datos" },
  { id: "establecimientos", label: "FIC" },
  { id: "cuenta", label: "Cuenta" },
];

const openMapsForEstablecimiento = async (item: EstablecimientoFic) => {
  const query = [item.ubicacion, item.direccion, item.dsc_establecimiento]
    .filter(Boolean)
    .join(" ");

  if (!query) {
    return;
  }

  const encodedQuery = encodeURIComponent(query);
  const url =
    Platform.OS === "ios"
      ? `maps:0,0?q=${encodedQuery}`
      : `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;

  await Linking.openURL(url);
};

export default function ClienteScreen() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [activeTab, setActiveTab] = useState<ClienteTab>("datos");
  const [profile, setProfile] = useState<ClienteProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [establecimientos, setEstablecimientos] = useState<EstablecimientoFic[]>([]);
  const [establecimientosLoading, setEstablecimientosLoading] = useState(false);
  const [establecimientosError, setEstablecimientosError] = useState("");
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequestNotification | null>(null);
  const [paymentActionLoading, setPaymentActionLoading] = useState<"approve" | "reject" | null>(
    null,
  );
  const [paymentActionMessage, setPaymentActionMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    getStoredSession().then((storedSession) => {
      if (!mounted) {
        return;
      }

      if (!storedSession || storedSession.user.id_perfil !== 3) {
        clearSession();
        router.replace("/");
        return;
      }

      setSession(storedSession);
      setProfile(getFallbackClienteProfile(storedSession));
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

    let mounted = true;
    setProfileLoading(true);
    setProfileError("");

    getClienteProfile(session)
      .then((nextProfile) => {
        if (mounted) {
          setProfile(nextProfile);
        }
      })
      .catch((error) => {
        if (mounted) {
          setProfileError(
            error instanceof Error ? error.message : "No se pudo consultar vw_usuario.",
          );
        }
      })
      .finally(() => {
        if (mounted) {
          setProfileLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let mounted = true;
    setEstablecimientosLoading(true);
    setEstablecimientosError("");

    getEstablecimientosFic(session.token)
      .then((items) => {
        if (mounted) {
          setEstablecimientos(items);
        }
      })
      .catch((error) => {
        if (mounted) {
          setEstablecimientosError(
            error instanceof Error
              ? error.message
              : "No se pudieron consultar los establecimientos.",
          );
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
  }, [session]);

  const handleLogout = useCallback(async () => {
    await clearSession();
    router.replace("/");
  }, []);

  useEffect(() => {
    return observePaymentRequests((nextPaymentRequest) => {
      setPaymentRequest(nextPaymentRequest);
      setPaymentActionMessage("");
      setActiveTab("datos");
    });
  }, []);

  const handlePaymentAction = async (action: "approve" | "reject") => {
    if (!session || !paymentRequest?.transactionId) {
      return;
    }

    setPaymentActionLoading(action);
    setPaymentActionMessage("");

    try {
      if (action === "approve") {
        await approvePaymentRequest(session.token, paymentRequest.transactionId);
        setPaymentActionMessage("Pago aprobado correctamente.");
      } else {
        await rejectPaymentRequest(session.token, paymentRequest.transactionId);
        setPaymentActionMessage("Pago rechazado correctamente.");
      }

      setPaymentRequest(null);
    } catch (paymentError) {
      setPaymentActionMessage(
        paymentError instanceof Error ? paymentError.message : "No se pudo responder el pago.",
      );
    } finally {
      setPaymentActionLoading(null);
    }
  };

  const qrPayload = useMemo(() => {
    if (!session) {
      return "";
    }

    return JSON.stringify({
      tipo: "PAGOS_FIC_CLIENTE",
      id_usuario: session.user.id_usuario,
      nombre_completo: profile?.nombre_completo || session.user.nombre,
      id_perfil: session.user.id_perfil,
    });
  }, [profile?.nombre_completo, session]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      style={styles.screen}>
      <Stack.Screen options={{ title: "Cliente" }} />

      {checkingSession ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#0f766e" size="large" />
        </View>
      ) : (
        <>
          <View style={styles.banner}>
            <View style={styles.medallion}>
              <Text style={styles.medallionText}>FIC</Text>
              <View style={styles.lance} />
            </View>
            <View style={styles.bannerCopy}>
              <Text style={styles.kicker}>Festival Internacional Cervantino</Text>
              <Text style={styles.title}>Hola, {profile?.nombre_completo || "cliente"}</Text>
              <Text style={styles.body}>Credencial inspirada en Don Quijote.</Text>
            </View>
            <Pressable
              accessibilityLabel="Cerrar sesion"
              accessibilityRole="button"
              onPress={handleLogout}
              style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}>
              <IconSymbol
                color="#fff8e8"
                name="rectangle.portrait.and.arrow.right"
                size={22}
              />
            </Pressable>
          </View>

          <View style={styles.tabBar}>
            {tabs.map((tab) => {
              const selected = activeTab === tab.id;

              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  key={tab.id}
                  onPress={() => setActiveTab(tab.id)}
                  style={[styles.tabButton, selected && styles.tabButtonActive]}>
                  <Text style={[styles.tabText, selected && styles.tabTextActive]}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {paymentRequest ? (
            <View style={styles.paymentPanel}>
              <Text style={styles.paymentKicker}>Solicitud de pago</Text>
              <Text style={styles.paymentTitle}>
                {paymentRequest.vendorName || "Proveedor FIC"}
              </Text>
              {paymentRequest.description ? (
                <Text style={styles.paymentText}>{paymentRequest.description}</Text>
              ) : null}
              <View style={styles.paymentTotalRow}>
                <Text style={styles.paymentText}>Total</Text>
                <Text style={styles.paymentTotal}>
                  ${Number(paymentRequest.total || 0).toFixed(2)}
                </Text>
              </View>
              <View style={styles.paymentActions}>
                <Pressable
                  disabled={Boolean(paymentActionLoading)}
                  onPress={() => handlePaymentAction("reject")}
                  style={({ pressed }) => [
                    styles.rejectButton,
                    (pressed || paymentActionLoading === "reject") && styles.pressed,
                  ]}>
                  <Text style={styles.rejectButtonText}>Rechazar</Text>
                </Pressable>
                <Pressable
                  disabled={Boolean(paymentActionLoading)}
                  onPress={() => handlePaymentAction("approve")}
                  style={({ pressed }) => [
                    styles.approveButton,
                    (pressed || paymentActionLoading === "approve") && styles.pressed,
                  ]}>
                  {paymentActionLoading === "approve" ? (
                    <ActivityIndicator color="#fff8e8" />
                  ) : (
                    <Text style={styles.approveButtonText}>Aprobar</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : null}

          {paymentActionMessage ? (
            <Text style={styles.paymentMessage}>{paymentActionMessage}</Text>
          ) : null}

          {activeTab === "datos" ? (
            <View style={styles.panel}>
              <View style={styles.qrBox}>
                {qrPayload ? (
                  <View style={styles.qrFrame}>
                    <QRCode
                      backgroundColor="#fff8e8"
                      color="#24160f"
                      size={210}
                      value={qrPayload}
                    />
                  </View>
                ) : (
                  <Text style={styles.emptyQr}>En espera de codigo QR</Text>
                )}
              </View>

              <InfoRow label="Nombre completo" value={profile?.nombre_completo} />
              <InfoRow label="NIP" value={profile?.nip} />
              <InfoRow label="Monto deposito" value={profile?.monto_deposito} />
              <InfoRow label="ID usuario" value={String(session?.user.id_usuario || "")} />

              {profileLoading ? <ActivityIndicator color="#0f766e" /> : null}
              {profileError ? <Text style={styles.warning}>{profileError}</Text> : null}
            </View>
          ) : null}

          {activeTab === "establecimientos" ? (
            <View style={styles.panel}>
              {establecimientosLoading ? <ActivityIndicator color="#0f766e" /> : null}

              {establecimientosError ? (
                <Text style={styles.warning}>{establecimientosError}</Text>
              ) : null}

              {!establecimientosLoading && !establecimientosError && establecimientos.length === 0 ? (
                <Text style={styles.emptyText}>No hay establecimientos FIC para mostrar.</Text>
              ) : null}

              {establecimientos.map((item, index) => (
                <View
                  key={`${item.id_establecimiento || item.dsc_establecimiento}-${index}`}
                  style={styles.establecimientoItem}>
                  <Text style={styles.establecimientoTitle}>
                    {item.dsc_establecimiento || "Establecimiento"}
                  </Text>
                  <Text style={styles.establecimientoText}>
                    {item.ubicacion || "Sin ubicacion"}
                  </Text>
                  <Text style={styles.establecimientoText}>
                    {item.direccion || "Sin direccion"}
                  </Text>
                  <Pressable
                    disabled={!item.ubicacion && !item.direccion}
                    onPress={() => openMapsForEstablecimiento(item)}
                    style={({ pressed }) => [
                      styles.mapButton,
                      (!item.ubicacion && !item.direccion) && styles.mapButtonDisabled,
                      pressed && styles.pressed,
                    ]}>
                    <IconSymbol color="#fff8e8" name="location.fill" size={20} />
                    <Text style={styles.mapButtonText}>Abrir mapa</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {activeTab === "cuenta" ? (
            <View style={styles.panel}>
              <InfoRow label="Usuario" value={session?.user.usuario} />
              <InfoRow label="Perfil" value="Cliente (3)" />

              <Pressable onPress={handleLogout} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Cerrar sesion</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function InfoRow({
  label,
  selectable,
  value,
}: {
  label: string;
  selectable?: boolean;
  value?: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable={selectable} style={styles.value}>
        {value || "Sin dato"}
      </Text>
    </View>
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
    borderCurve: "continuous",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 16,
    padding: 16,
  },
  logoutButton: {
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
  medallion: {
    alignItems: "center",
    backgroundColor: "#8f1d2c",
    borderColor: "#d5a84f",
    borderRadius: 34,
    borderWidth: 3,
    height: 68,
    justifyContent: "center",
    overflow: "hidden",
    width: 68,
  },
  medallionText: {
    color: "#fff8e8",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0,
  },
  lance: {
    backgroundColor: "#d5a84f",
    height: 2,
    position: "absolute",
    transform: [{ rotate: "-35deg" }],
    width: 82,
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
    fontSize: 25,
    fontWeight: "900",
  },
  body: {
    color: "#6f5639",
    fontSize: 16,
    lineHeight: 23,
  },
  tabBar: {
    backgroundColor: "#e7d7b5",
    borderColor: "#3b2619",
    borderCurve: "continuous",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    padding: 4,
  },
  tabButton: {
    alignItems: "center",
    borderRadius: 6,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 8,
  },
  tabButtonActive: {
    backgroundColor: "#8f1d2c",
  },
  tabText: {
    color: "#3b2619",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  tabTextActive: {
    color: "#fff8e8",
  },
  panel: {
    backgroundColor: "#fff8e8",
    borderColor: "#3b2619",
    borderCurve: "continuous",
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  paymentPanel: {
    backgroundColor: "#24160f",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 18,
  },
  paymentKicker: {
    color: "#d5a84f",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  paymentTitle: {
    color: "#fff8e8",
    fontSize: 20,
    fontWeight: "900",
  },
  paymentText: {
    color: "#e7d7b5",
    fontSize: 15,
    lineHeight: 21,
  },
  paymentTotalRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  paymentTotal: {
    color: "#fff8e8",
    fontSize: 28,
    fontWeight: "900",
  },
  paymentActions: {
    flexDirection: "row",
    gap: 10,
  },
  rejectButton: {
    alignItems: "center",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
  },
  rejectButtonText: {
    color: "#fff8e8",
    fontSize: 15,
    fontWeight: "900",
  },
  approveButton: {
    alignItems: "center",
    backgroundColor: "#8f1d2c",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
  },
  approveButtonText: {
    color: "#fff8e8",
    fontSize: 15,
    fontWeight: "900",
  },
  paymentMessage: {
    color: "#8f1d2c",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  qrBox: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#f6e8c8",
    borderColor: "#d5a84f",
    borderCurve: "continuous",
    borderRadius: 8,
    borderWidth: 2,
    justifyContent: "center",
    minHeight: 246,
    padding: 18,
    width: "100%",
  },
  qrFrame: {
    backgroundColor: "#fff8e8",
    borderColor: "#3b2619",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  emptyQr: {
    color: "#6f5639",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  infoRow: {
    gap: 5,
  },
  label: {
    color: "#8f1d2c",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  value: {
    color: "#24160f",
    fontSize: 16,
    lineHeight: 22,
  },
  warning: {
    color: "#8f1d2c",
    fontSize: 14,
    lineHeight: 20,
  },
  emptyText: {
    color: "#6f5639",
    fontSize: 15,
    lineHeight: 22,
  },
  establecimientoItem: {
    backgroundColor: "#f9efd9",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  establecimientoTitle: {
    color: "#24160f",
    fontSize: 17,
    fontWeight: "800",
  },
  establecimientoText: {
    color: "#6f5639",
    fontSize: 14,
    lineHeight: 20,
  },
  mapButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#3b2619",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 14,
  },
  mapButtonDisabled: {
    opacity: 0.45,
  },
  mapButtonText: {
    color: "#fff8e8",
    fontSize: 14,
    fontWeight: "800",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#8f1d2c",
    borderColor: "#6f141f",
    borderCurve: "continuous",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 50,
  },
  secondaryButtonText: {
    color: "#fff8e8",
    fontSize: 16,
    fontWeight: "800",
  },
});
