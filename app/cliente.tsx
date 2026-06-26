import { CameraView, useCameraPermissions } from "expo-camera";
import { router, Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import SignatureScreen, { SignatureViewRef } from "react-native-signature-canvas";

import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  AuthSession,
  clearSession,
  getStoredSession,
  saveSession,
} from "@/services/auth";
import {
  activateClienteQr,
  ClienteProfile,
  EstablecimientoFic,
  getClienteProfile,
  getEstablecimientosFic,
  getFallbackClienteProfile,
} from "@/services/client-data";
import {
  approvePaymentRequest,
  getPaymentRequestNotifications,
  observeBalanceUpdates,
  observePaymentRequests,
  PaymentRequestNotification,
  registerPushToken,
  rejectPaymentRequest,
  shouldUseInAppPaymentPolling,
} from "@/services/notifications";

type ClienteTab = "datos" | "establecimientos" | "cuenta";
type ActivationStep = "idle" | "front" | "back" | "signature";

const HANDLED_PAYMENT_REQUESTS_KEY = "pagosfic.handledPaymentRequests";
const MAX_STORED_PAYMENT_REQUESTS = 80;

const tabs: { id: ClienteTab; label: string }[] = [
  { id: "datos", label: "Mis datos" },
  { id: "establecimientos", label: "FIC" },
  { id: "cuenta", label: "Cuenta" },
];

const formatPaymentTotal = (value: unknown) =>
  `$${Number(value || 0).toFixed(2)}`;

const formatBalance = (value: unknown) => Number(value || 0).toFixed(2);

const logClienteSaldo = (message: string, details?: Record<string, unknown>) => {
  console.log(`[cliente:saldo] ${message}`, details || {});
};

const mergeSessionWithProfile = (
  currentSession: AuthSession,
  nextProfile: ClienteProfile,
): AuthSession => ({
  ...currentSession,
  user: {
    ...currentSession.user,
    nombre: nextProfile.nombre_completo || currentSession.user.nombre,
    nip: nextProfile.nip || currentSession.user.nip,
    monto_deposito: nextProfile.monto_deposito,
    monto_deposito_hotel: nextProfile.monto_deposito_hotel,
    tarifa_noche: nextProfile.tarifa_noche,
    tiene_alimentos: nextProfile.tiene_alimentos,
    tiene_hospedaje: nextProfile.tiene_hospedaje,
    activo_qr: nextProfile.activo_qr,
    qr: nextProfile.qr || currentSession.user.qr,
  },
});

const signatureCanvasWebStyle = `
  .m-signature-pad {
    background-color: #fff8e8;
    border: 0;
    box-shadow: none;
    height: 100%;
    width: 100%;
  }
  .m-signature-pad--body {
    border: 0;
    bottom: 0;
    left: 0;
    right: 0;
    top: 0;
  }
  .m-signature-pad--body canvas {
    background-color: #fff8e8;
    border-radius: 8px;
    height: 100% !important;
    width: 100% !important;
  }
  .m-signature-pad--footer {
    display: none;
  }
  body, html {
    background-color: #fff8e8;
    height: 100%;
    margin: 0;
    overflow: hidden;
    width: 100%;
  }
`;


const loadHandledPaymentRequestKeys = async () => {
  try {
    const storedKeys = await SecureStore.getItemAsync(
      HANDLED_PAYMENT_REQUESTS_KEY,
    );
    const parsedKeys = storedKeys ? JSON.parse(storedKeys) : [];

    return Array.isArray(parsedKeys)
      ? parsedKeys.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
};

const saveHandledPaymentRequestKeys = async (keys: Set<string>) => {
  const nextKeys = Array.from(keys).slice(-MAX_STORED_PAYMENT_REQUESTS);
  await SecureStore.setItemAsync(
    HANDLED_PAYMENT_REQUESTS_KEY,
    JSON.stringify(nextKeys),
  );
};

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
  const [establecimientos, setEstablecimientos] = useState<
    EstablecimientoFic[]
  >([]);
  const [establecimientosLoading, setEstablecimientosLoading] = useState(false);
  const [establecimientosError, setEstablecimientosError] = useState("");
  const [paymentRequest, setPaymentRequest] =
    useState<PaymentRequestNotification | null>(null);
  const [paymentActionLoading, setPaymentActionLoading] = useState<
    "approve" | "reject" | null
  >(null);
  const [paymentActionMessage, setPaymentActionMessage] = useState("");
  const [handledPaymentRequestsLoaded, setHandledPaymentRequestsLoaded] =
    useState(false);
  const [activationStep, setActivationStep] = useState<ActivationStep>("idle");
  const [ineFront, setIneFront] = useState("");
  const [ineBack, setIneBack] = useState("");
  const [signatureImage, setSignatureImage] = useState("");
  const [signatureScrollLocked, setSignatureScrollLocked] = useState(false);
  const [activationLoading, setActivationLoading] = useState(false);
  const [activationMessage, setActivationMessage] = useState("");
  const [activationError, setActivationError] = useState("");
  const [activationCaptureHint, setActivationCaptureHint] = useState("");
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);
  const signatureRef = useRef<SignatureViewRef | null>(null);
  const signatureSubmitPendingRef = useRef(false);
  const sessionRef = useRef<AuthSession | null>(null);
  const profileRef = useRef<ClienteProfile | null>(null);
  const paymentRequestRef = useRef<PaymentRequestNotification | null>(null);
  const promptedPaymentRef = useRef<string | number | null>(null);
  const handledPaymentRequestsRef = useRef(new Set<string>());
  const profileRequestIdRef = useRef(0);
  const profileRefreshInFlightRef = useRef(false);
  const registeredPushTokenForSessionRef = useRef("");
  const sessionToken = session?.token || "";
  const sessionUserId = session?.user.id_usuario || 0;

  useEffect(() => {
    let mounted = true;

    loadHandledPaymentRequestKeys().then((keys) => {
      if (mounted) {
        handledPaymentRequestsRef.current = new Set(keys);
        setHandledPaymentRequestsLoaded(true);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const persistHandledPaymentRequest = useCallback(
    (transactionId: string | number | undefined) => {
      const key = String(transactionId || "");

      if (!key) {
        return;
      }

      handledPaymentRequestsRef.current.add(key);
      void saveHandledPaymentRequestKeys(handledPaymentRequestsRef.current);
    },
    [],
  );

  useEffect(() => {
    sessionRef.current = session;
    logClienteSaldo("session state actualizado", {
      id_usuario: session?.user.id_usuario,
      monto_sesion: session?.user.monto_deposito,
    });
  }, [session]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    const activeSession = sessionRef.current;

    if (!activeSession || registeredPushTokenForSessionRef.current === sessionToken) {
      return;
    }

    registeredPushTokenForSessionRef.current = sessionToken;
    registerPushToken(activeSession.token).catch((pushError) => {
      console.warn("No se pudo registrar push token.", pushError);
      registeredPushTokenForSessionRef.current = "";
    });
  }, [sessionToken, sessionUserId]);

  useEffect(() => {
    paymentRequestRef.current = paymentRequest;
  }, [paymentRequest]);

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

      logClienteSaldo("sesion almacenada cargada", {
        id_usuario: storedSession.user.id_usuario,
        monto_sesion: storedSession.user.monto_deposito,
      });

      setSession(storedSession);
      setProfile({
        ...getFallbackClienteProfile(storedSession),
        monto_deposito: "",
        monto_deposito_hotel: "",
      });
      setCheckingSession(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const activeSession = sessionRef.current;

    if (!activeSession || !sessionToken || !sessionUserId) {
      return;
    }

    let mounted = true;
    const requestId = ++profileRequestIdRef.current;
    setProfileLoading(true);
    setProfileError("");
    logClienteSaldo("consulta inicial perfil", {
      requestId,
      id_usuario: activeSession.user.id_usuario,
    });

    getClienteProfile(activeSession)
      .then((nextProfile) => {
        if (mounted && requestId === profileRequestIdRef.current) {
          const nextSession = mergeSessionWithProfile(activeSession, nextProfile);
          logClienteSaldo("consulta inicial perfil aplicada", {
            requestId,
            monto_deposito: nextProfile.monto_deposito,
          });
          setProfile(nextProfile);
          setSession(nextSession);
          sessionRef.current = nextSession;
          void saveSession(nextSession);
        }
      })
      .catch((error) => {
        if (mounted && requestId === profileRequestIdRef.current) {
          setProfileError(
            error instanceof Error
              ? error.message
              : "No se pudo consultar vw_usuario.",
          );
        }
      })
      .finally(() => {
        if (mounted && requestId === profileRequestIdRef.current) {
          setProfileLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [sessionToken, sessionUserId]);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }

    let mounted = true;
    setEstablecimientosLoading(true);
    setEstablecimientosError("");

    getEstablecimientosFic(sessionToken)
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
  }, [sessionToken]);

  const resetActivation = useCallback(() => {
    setActivationStep("idle");
    setIneFront("");
    setIneBack("");
    setSignatureImage("");
    setActivationCaptureHint("");
    setActivationError("");
  }, []);

  const handleStartActivation = useCallback(async () => {
    const activeProfile = profileRef.current;
    const activeSession = sessionRef.current;
    const activeQr = Number(activeProfile?.activo_qr ?? activeSession?.user.activo_qr ?? 0) === 1;

    if (activeQr) {
      setActivationMessage("QR activado.");
      setActivationError("");
      return;
    }

    setActivationMessage("");
    setActivationCaptureHint("");
    setActivationError("");

    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();

      if (!permission.granted) {
        setActivationError(
          "Se necesita permiso de camara para fotografiar la credencial.",
        );
        return;
      }
    }

    setIneFront("");
    setIneBack("");
    setSignatureImage("");
    setActivationStep("front");
  }, [cameraPermission?.granted, requestCameraPermission]);

  const handleCaptureIne = useCallback(async () => {
    if (!cameraRef.current || !["front", "back"].includes(activationStep)) {
      return;
    }

    setActivationError("");

    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.55,
        skipProcessing: true,
      });
      const imageData = `data:image/jpeg;base64,${photo.base64}`;

      if (activationStep === "front") {
        setIneFront(imageData);
        setActivationCaptureHint("Frente capturado. Siguiente: reverso.");
        setActivationStep("back");
        setTimeout(() => setActivationCaptureHint(""), 1600);
      } else {
        setIneBack(imageData);
        setActivationCaptureHint("Reverso capturado. Siguiente: firma.");
        setActivationStep("signature");
        setTimeout(() => setActivationCaptureHint(""), 1600);
      }
    } catch (captureError) {
      setActivationError(
        captureError instanceof Error
          ? captureError.message
          : "No se pudo tomar la fotografia.",
      );
    }
  }, [activationStep]);

  const saveActivationWithSignature = useCallback(
    async (signature: string) => {
      const activeSession = sessionRef.current;

      if (!activeSession || !ineFront || !ineBack || !signature) {
        setActivationError("Captura frente, reverso y firma para activar el QR.");
        setActivationLoading(false);
        return;
      }

      if (!signature.toLowerCase().startsWith("data:image/png")) {
        setActivationError(
          "La firma debe generarse como PNG. Limpia la firma e intenta de nuevo.",
        );
        setActivationLoading(false);
        return;
      }

      setActivationError("");
      setActivationMessage("");

      try {
        await activateClienteQr(activeSession.token, {
          ine_frontal: ineFront,
          ine_trasera: ineBack,
          firma: signature,
        });
        setActivationMessage(
          "Documentos guardados correctamente. Tu activacion QR quedo en revision.",
        );
        resetActivation();
      } catch (activationSaveError) {
        setActivationError(
          activationSaveError instanceof Error
            ? activationSaveError.message
            : "No se pudo guardar la activacion QR.",
        );
      } finally {
        setActivationLoading(false);
      }
    },
    [ineBack, ineFront, resetActivation],
  );

  const handleSubmitActivation = useCallback(() => {
    if (!ineFront || !ineBack) {
      setActivationError("Captura frente y reverso para activar el QR.");
      return;
    }

    signatureSubmitPendingRef.current = true;
    setActivationLoading(true);
    setActivationError("");
    signatureRef.current?.readSignature();
  }, [ineBack, ineFront]);
  const handleLogout = useCallback(async () => {
    await clearSession();
    router.replace("/");
  }, []);

  const refreshClienteProfile = useCallback(
    async (activeSession: AuthSession) => {
      if (profileRefreshInFlightRef.current) {
        logClienteSaldo("refresh manual esperando consulta previa", {
          id_usuario: activeSession.user.id_usuario,
        });
      }

      profileRefreshInFlightRef.current = true;
      const requestId = ++profileRequestIdRef.current;
      logClienteSaldo("refresh manual inicio", {
        requestId,
        id_usuario: activeSession.user.id_usuario,
        monto_sesion: activeSession.user.monto_deposito,
      });

      try {
        const nextProfile = await getClienteProfile(activeSession);

        if (requestId !== profileRequestIdRef.current) {
          logClienteSaldo("refresh manual descartado por respuesta vieja", {
            requestId,
            currentRequestId: profileRequestIdRef.current,
            monto_deposito: nextProfile.monto_deposito,
          });
          return;
        }

        logClienteSaldo("refresh manual aplicado", {
          requestId,
          monto_deposito: nextProfile.monto_deposito,
        });
        setProfile(nextProfile);

        const nextSession = mergeSessionWithProfile(activeSession, nextProfile);

        setSession(nextSession);
        sessionRef.current = nextSession;
        await saveSession(nextSession);
      } finally {
        profileRefreshInFlightRef.current = false;
      }
    },
    [],
  );

  const applyBalanceUpdate = useCallback(
    async (
      balanceUpdate: { current_balance?: unknown; monto_deposito_hotel?: unknown; hotel_balance?: unknown },
      reason: string,
    ) => {
      const activeSession = sessionRef.current;

      if (!activeSession) {
        return;
      }

      const currentProfile = profileRef.current;
      const hasFoodBalance =
        balanceUpdate.current_balance !== undefined &&
        balanceUpdate.current_balance !== null;
      const hasHotelBalance =
        (balanceUpdate.monto_deposito_hotel !== undefined &&
          balanceUpdate.monto_deposito_hotel !== null) ||
        (balanceUpdate.hotel_balance !== undefined &&
          balanceUpdate.hotel_balance !== null);

      if (!hasFoodBalance && !hasHotelBalance) {
        return;
      }

      const montoDeposito = hasFoodBalance
        ? formatBalance(balanceUpdate.current_balance)
        : currentProfile?.monto_deposito || activeSession.user.monto_deposito;
      const montoDepositoHotel = hasHotelBalance
        ? formatBalance(balanceUpdate.monto_deposito_hotel ?? balanceUpdate.hotel_balance)
        : currentProfile?.monto_deposito_hotel || activeSession.user.monto_deposito_hotel;

      logClienteSaldo("saldo actualizado por notificacion", {
        reason,
        monto_deposito: montoDeposito,
        monto_deposito_hotel: montoDepositoHotel,
      });

      const nextProfile = currentProfile
        ? {
            ...currentProfile,
            monto_deposito: montoDeposito,
            monto_deposito_hotel: montoDepositoHotel,
          }
        : {
            ...getFallbackClienteProfile(activeSession),
            monto_deposito: montoDeposito,
            monto_deposito_hotel: montoDepositoHotel,
          };
      const nextSession = mergeSessionWithProfile(activeSession, nextProfile);

      setProfile(nextProfile);
      setSession(nextSession);
      sessionRef.current = nextSession;
      await saveSession(nextSession);
    },
    [],
  );

  const handlePaymentAction = useCallback(
    async (
      action: "approve" | "reject",
      request: PaymentRequestNotification | null = paymentRequestRef.current,
    ) => {
      const activeSession = sessionRef.current;

      if (!activeSession || !request?.transactionId) {
        return;
      }

      setPaymentActionLoading(action);
      setPaymentActionMessage("");

      try {
        if (action === "approve") {
          logClienteSaldo("aprobando pago", {
            transactionId: request.transactionId,
            monto_actual_en_sesion: activeSession.user.monto_deposito,
          });
          await approvePaymentRequest(
            activeSession.token,
            request.transactionId,
          );
          logClienteSaldo("pago aprobado, consultando saldo real", {
            transactionId: request.transactionId,
          });
          await refreshClienteProfile(sessionRef.current || activeSession);

          persistHandledPaymentRequest(request.transactionId);
          setPaymentActionMessage("Pago aprobado correctamente.");
        } else {
          await rejectPaymentRequest(
            activeSession.token,
            request.transactionId,
          );
          persistHandledPaymentRequest(request.transactionId);
          setPaymentActionMessage("Pago rechazado correctamente.");
        }

        setPaymentRequest(null);
      } catch (paymentError) {
        setPaymentActionMessage(
          paymentError instanceof Error
            ? paymentError.message
            : "No se pudo responder el pago.",
        );
      } finally {
        setPaymentActionLoading(null);
      }
    },
    [persistHandledPaymentRequest, refreshClienteProfile],
  );

  const showPaymentRequestPrompt = useCallback(
    (nextPaymentRequest: PaymentRequestNotification) => {
      const transactionId = nextPaymentRequest.transactionId;
      const transactionKey = String(transactionId || "");

      if (
        !transactionId ||
        promptedPaymentRef.current === transactionId ||
        handledPaymentRequestsRef.current.has(transactionKey)
      ) {
        return;
      }

      promptedPaymentRef.current = transactionId;
      persistHandledPaymentRequest(transactionKey);

      const providerName = nextPaymentRequest.vendorName || "Proveedor FIC";
      const total = formatPaymentTotal(nextPaymentRequest.total);
      const description = nextPaymentRequest.description
        ? `\n\n${nextPaymentRequest.description}`
        : "";

      Alert.alert(
        "Solicitud de pago",
        `${providerName}\nTotal: ${total}${description}`,
        [
          {
            text: "Rechazar",
            style: "destructive",
            onPress: () => {
              promptedPaymentRef.current = null;
              handlePaymentAction("reject", nextPaymentRequest);
            },
          },
          {
            text: "Despues",
            style: "cancel",
            onPress: () => {
              promptedPaymentRef.current = null;
            },
          },
          {
            text: "Aprobar",
            onPress: () => {
              promptedPaymentRef.current = null;
              handlePaymentAction("approve", nextPaymentRequest);
            },
          },
        ],
      );
    },
    [handlePaymentAction, persistHandledPaymentRequest],
  );

  useEffect(() => {
    return observePaymentRequests((nextPaymentRequest, source) => {
      setPaymentRequest(nextPaymentRequest);
      setPaymentActionMessage("");
      setActiveTab("datos");

      if (source === "response") {
        showPaymentRequestPrompt(nextPaymentRequest);
      }
    });
  }, [showPaymentRequestPrompt]);

  useEffect(() => {
    return observeBalanceUpdates((balanceUpdate, source) => {
      void applyBalanceUpdate(balanceUpdate, source);
    });
  }, [applyBalanceUpdate]);

  useEffect(() => {
    if (
      !session ||
      !handledPaymentRequestsLoaded ||
      !shouldUseInAppPaymentPolling()
    ) {
      return;
    }

    let mounted = true;

    const pollPaymentRequests = async () => {
      try {
        const requests = await getPaymentRequestNotifications(session.token);
        const nextPaymentRequest = requests.find((request) => {
          const key = String(request.transactionId || "");
          return key && !handledPaymentRequestsRef.current.has(key);
        });

        if (mounted && nextPaymentRequest) {
          setPaymentRequest(nextPaymentRequest);
          setPaymentActionMessage("");
          setActiveTab("datos");
          showPaymentRequestPrompt(nextPaymentRequest);
        }
      } catch (pollError) {
        console.warn(
          "No se pudieron consultar solicitudes de pago.",
          pollError,
        );
      }
    };

    pollPaymentRequests();
    const intervalId = setInterval(pollPaymentRequests, 5000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [handledPaymentRequestsLoaded, session, showPaymentRequestPrompt]);

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
  const displayedBalance =
    profile?.monto_deposito !== undefined && profile.monto_deposito !== ""
      ? profile.monto_deposito
      : profileLoading
        ? null
        : "0";
  const displayedHotelBalance =
    profile?.monto_deposito_hotel !== undefined &&
    profile.monto_deposito_hotel !== ""
      ? profile.monto_deposito_hotel
      : profileLoading
        ? null
        : "0";
  const showFoodBalance = (profile?.tiene_alimentos ?? 1) === 1;
  const showHotelBalance = (profile?.tiene_hospedaje ?? 0) === 1;
  const qrActivo = Number(profile?.activo_qr ?? session?.user.activo_qr ?? 0) === 1;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      scrollEnabled={!signatureScrollLocked}
      style={styles.screen}
    >
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
              <Text style={styles.kicker}>
                Hospedaje y Alimentos FIC
              </Text>
              <Text style={styles.title}>
                Hola, {profile?.nombre_completo || "cliente"}
              </Text>
              <Text style={styles.body}>
                de cuyo nombre no quiero acordarme...
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Cerrar sesión"
              accessibilityRole="button"
              onPress={handleLogout}
              style={({ pressed }) => [
                styles.logoutButton,
                pressed && styles.pressed,
              ]}
            >
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
                  style={[styles.tabButton, selected && styles.tabButtonActive]}
                >
                  <Text
                    style={[styles.tabText, selected && styles.tabTextActive]}
                  >
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
                <Text style={styles.paymentText}>
                  {paymentRequest.description}
                </Text>
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
                    (pressed || paymentActionLoading === "reject") &&
                      styles.pressed,
                  ]}
                >
                  <Text style={styles.rejectButtonText}>Rechazar</Text>
                </Pressable>
                <Pressable
                  disabled={Boolean(paymentActionLoading)}
                  onPress={() => handlePaymentAction("approve")}
                  style={({ pressed }) => [
                    styles.approveButton,
                    (pressed || paymentActionLoading === "approve") &&
                      styles.pressed,
                  ]}
                >
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
              <View style={styles.balanceGrid}>
                {showFoodBalance ? (
                  <View style={styles.balancePanel}>
                    <Text style={styles.balanceLabel}>Saldo disponible</Text>
                    <Text style={styles.balanceValue}>
                      {displayedBalance === null
                        ? "Consultando..."
                        : `$${formatBalance(displayedBalance)}`}
                    </Text>
                  </View>
                ) : null}

                {showHotelBalance ? (
                  <View style={styles.balancePanel}>
                    <Text style={styles.balanceLabel}>Saldo hospedaje</Text>
                    <Text style={styles.balanceValue}>
                      {displayedHotelBalance === null
                        ? "Consultando..."
                        : `$${formatBalance(displayedHotelBalance)}`}
                    </Text>
                    <Text style={styles.balanceHint}>
                      Tarifa noche: ${formatBalance(profile?.tarifa_noche)}
                    </Text>
                  </View>
                ) : null}

                {!showFoodBalance && !showHotelBalance ? (
                  <View style={styles.balancePanel}>
                    <Text style={styles.balanceLabel}>Saldos</Text>
                    <Text style={styles.balanceHint}>
                      No hay beneficios activos para esta cuenta.
                    </Text>
                  </View>
                ) : null}
              </View>

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
                  <Text style={styles.emptyQr}>En espera de código QR</Text>
                )}
              </View>

              <InfoRow
                label="Nombre completo"
                value={profile?.nombre_completo}
              />
              <InfoRow
                label="ID usuario"
                value={String(session?.user.id_usuario || "")}
              />

              {profileLoading ? <ActivityIndicator color="#0f766e" /> : null}
              {profileError ? (
                <Text style={styles.warning}>{profileError}</Text>
              ) : null}
            </View>
          ) : null}

          {activeTab === "establecimientos" ? (
            <View style={styles.panel}>
              {establecimientosLoading ? (
                <ActivityIndicator color="#0f766e" />
              ) : null}

              {establecimientosError ? (
                <Text style={styles.warning}>{establecimientosError}</Text>
              ) : null}

              {!establecimientosLoading &&
              !establecimientosError &&
              establecimientos.length === 0 ? (
                <Text style={styles.emptyText}>
                  No hay establecimientos FIC para mostrar.
                </Text>
              ) : null}

              {establecimientos.map((item, index) => (
                <View
                  key={`${item.id_establecimiento || item.dsc_establecimiento}-${index}`}
                  style={styles.establecimientoItem}
                >
                  <Text style={styles.establecimientoTitle}>
                    {item.dsc_establecimiento || "Establecimiento"}
                  </Text>
                  <Text style={styles.establecimientoText}>
                    {item.ubicacion || "Sin ubicación"}
                  </Text>
                  <Text style={styles.establecimientoText}>
                    {item.direccion || "Sin dirección"}
                  </Text>
                  <Pressable
                    disabled={!item.ubicacion && !item.direccion}
                    onPress={() => openMapsForEstablecimiento(item)}
                    style={({ pressed }) => [
                      styles.mapButton,
                      !item.ubicacion &&
                        !item.direccion &&
                        styles.mapButtonDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <IconSymbol
                      color="#fff8e8"
                      name="location.fill"
                      size={20}
                    />
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
              <InfoRow label="NIP" value={profile?.nip || session?.user.nip} />

              <View style={styles.activationBox}>
                <Pressable
                  disabled={activationLoading || qrActivo}
                  onPress={handleStartActivation}
                  style={({ pressed }) => [
                    styles.activationButton,
                    pressed && styles.pressed,
                    (activationLoading || qrActivo) && styles.mapButtonDisabled,
                  ]}
                >
                  <IconSymbol
                    color="#fff8e8"
                    name="qrcode.viewfinder"
                    size={20}
                  />
                  <Text style={styles.activationButtonText}>
                    {qrActivo ? "QR activado" : "Activar QR"}
                  </Text>
                </Pressable>

                {!qrActivo && (activationStep === "front" || activationStep === "back") ? (
                  <View style={styles.activationCameraPanel}>
                    <View style={styles.activationProgressRow}>
                      <View style={[styles.activationStepPill, styles.activationStepPillActive]}>
                        <Text style={styles.activationStepPillText}>1 Frente</Text>
                      </View>
                      <View
                        style={[
                          styles.activationStepPill,
                          activationStep === "back" && styles.activationStepPillActive,
                        ]}
                      >
                        <Text style={styles.activationStepPillText}>2 Reverso</Text>
                      </View>
                      <View style={styles.activationStepPill}>
                        <Text style={styles.activationStepPillText}>3 Firma</Text>
                      </View>
                    </View>
                    <Text style={styles.activationTitle}>
                      {activationStep === "front"
                        ? "Coloca el frente de tu INE dentro del rectangulo"
                        : "Ahora coloca el reverso de tu INE dentro del rectangulo"}
                    </Text>
                    <View style={styles.activationCameraShell}>
                      <CameraView
                        ref={cameraRef}
                        active
                        animateShutter
                        facing="back"
                        style={styles.activationCamera}
                      />
                      <View pointerEvents="none" style={styles.ineOverlay}>
                        <View style={styles.ineGuideCard}>
                          <View style={styles.ineGuideTopRow}>
                            <Text style={styles.ineGuideTitle}>INE</Text>
                            <Text style={styles.ineGuideSide}>
                              {activationStep === "front" ? "FRENTE" : "REVERSO"}
                            </Text>
                          </View>
                          <View style={styles.ineGuidePhoto} />
                          <View style={styles.ineGuideLines}>
                            <View style={styles.ineGuideLineLong} />
                            <View style={styles.ineGuideLineShort} />
                          </View>
                        </View>
                        <Text style={styles.ineGuideHint}>
                          Alinea la credencial completa, sin cortar esquinas
                        </Text>
                      </View>
                      {activationCaptureHint ? (
                        <View style={styles.activationNextOverlay}>
                          <Text style={styles.activationNextText}>
                            {activationCaptureHint}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.activationActions}>
                      <Pressable
                        onPress={resetActivation}
                        style={styles.activationSecondaryButton}
                      >
                        <Text style={styles.activationSecondaryButtonText}>
                          Cancelar
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={handleCaptureIne}
                        style={styles.activationPrimaryButton}
                      >
                        <Text style={styles.activationPrimaryButtonText}>
                          {activationStep === "front"
                            ? "Tomar frente"
                            : "Tomar reverso"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {!qrActivo && activationStep === "signature" ? (
                  <View style={styles.signaturePanel}>
                    <Text style={styles.activationTitle}>
                      Firma con tu dedo
                    </Text>
                    {activationCaptureHint ? (
                      <View style={styles.activationNextBanner}>
                        <Text style={styles.activationNextBannerText}>
                          {activationCaptureHint}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.signatureBox}>
                      <SignatureScreen
                        ref={signatureRef}
                        autoClear={false}
                        backgroundColor="#fff8e8"
                        clearText="Limpiar"
                        confirmText="Guardar"
                        descriptionText=""
                        imageType="image/png"
                        maxWidth={3.2}
                        minWidth={1.2}
                        onBegin={() => {
                          setSignatureScrollLocked(true);
                          setActivationError("");
                        }}
                        onEmpty={() => {
                          signatureSubmitPendingRef.current = false;
                          setSignatureScrollLocked(false);
                          setActivationLoading(false);
                          setSignatureImage("");
                          setActivationError("Firma con tu dedo antes de guardar la activacion.");
                        }}
                        onEnd={() => {
                          setSignatureScrollLocked(false);
                          signatureRef.current?.readSignature();
                        }}
                        onError={(signatureError) => {
                          signatureSubmitPendingRef.current = false;
                          setSignatureScrollLocked(false);
                          setActivationLoading(false);
                          setActivationError(
                            signatureError instanceof Error
                              ? signatureError.message
                              : "No se pudo abrir el panel de firma.",
                          );
                        }}
                        onOK={(signature) => {
                          setSignatureScrollLocked(false);
                          setSignatureImage(signature);
                          if (signatureSubmitPendingRef.current) {
                            signatureSubmitPendingRef.current = false;
                            void saveActivationWithSignature(signature);
                          }
                        }}
                        penColor="#24160f"
                        scrollable={false}
                        style={styles.signatureCanvas}
                        webStyle={signatureCanvasWebStyle}
                        webviewProps={{
                          androidLayerType: "hardware",
                          cacheEnabled: true,
                          nestedScrollEnabled: false,
                          overScrollMode: "never",
                          scrollEnabled: false,
                        }}
                      />
                    </View>
                    <View style={styles.activationActions}>
                      <Pressable
                        onPress={() => {
                          setSignatureScrollLocked(false);
                          setSignatureImage("");
                          signatureRef.current?.clearSignature();
                        }}
                        style={styles.activationSecondaryButton}
                      >
                        <Text style={styles.activationSecondaryButtonText}>
                          Limpiar firma
                        </Text>
                      </Pressable>
                      <Pressable
                        disabled={
                          activationLoading || !signatureImage
                        }
                        onPress={handleSubmitActivation}
                        style={({ pressed }) => [
                          styles.activationPrimaryButton,
                          (pressed ||
                            activationLoading ||
                            !signatureImage) &&
                            styles.mapButtonDisabled,
                        ]}
                      >
                        {activationLoading ? (
                          <ActivityIndicator color="#fff8e8" />
                        ) : (
                          <Text style={styles.activationPrimaryButtonText}>
                            Guardar activacion
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {activationError ? (
                  <Text style={styles.warning}>{activationError}</Text>
                ) : null}
                {activationMessage ? (
                  <Text style={styles.activationMessage}>
                    {activationMessage}
                  </Text>
                ) : null}
              </View>

              <Pressable onPress={handleLogout} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Cerrar sesión</Text>
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
  balanceGrid: {
    gap: 12,
  },
  balancePanel: {
    backgroundColor: "#24160f",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  balanceLabel: {
    color: "#d5a84f",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  balanceValue: {
    color: "#fff8e8",
    fontSize: 38,
    fontWeight: "900",
    lineHeight: 44,
  },
  balanceHint: {
    color: "#e7d7b5",
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
  activationBox: {
    backgroundColor: "#f9efd9",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  activationButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#15803d",
    borderColor: "#166534",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 16,
  },
  activationButtonText: {
    color: "#fff8e8",
    fontSize: 15,
    fontWeight: "900",
  },
  activationCameraPanel: {
    gap: 12,
  },
  activationTitle: {
    color: "#24160f",
    fontSize: 16,
    fontWeight: "900",
  },
  activationProgressRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  activationStepPill: {
    backgroundColor: "#6f5639",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  activationStepPillActive: {
    backgroundColor: "#8f1d2c",
  },
  activationStepPillText: {
    color: "#fff8e8",
    fontSize: 12,
    fontWeight: "900",
  },
  activationCameraShell: {
    backgroundColor: "#24160f",
    borderColor: "#3b2619",
    borderRadius: 8,
    borderWidth: 1,
    height: 390,
    overflow: "hidden",
    position: "relative",
  },
  activationCamera: {
    ...StyleSheet.absoluteFillObject,
  },
  ineOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  ineGuideCard: {
    aspectRatio: 1.58,
    borderColor: "#fff8e8",
    borderRadius: 8,
    borderStyle: "dashed",
    borderWidth: 3,
    justifyContent: "space-between",
    maxWidth: 360,
    padding: 14,
    width: "88%",
  },
  ineGuideTopRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  ineGuideTitle: {
    color: "#fff8e8",
    fontSize: 26,
    fontWeight: "900",
  },
  ineGuideSide: {
    color: "#d5a84f",
    fontSize: 12,
    fontWeight: "900",
  },
  ineGuidePhoto: {
    backgroundColor: "rgba(255, 248, 232, 0.25)",
    borderColor: "rgba(255, 248, 232, 0.75)",
    borderRadius: 8,
    borderWidth: 1,
    height: "38%",
    width: "28%",
  },
  ineGuideLines: {
    gap: 7,
  },
  ineGuideLineLong: {
    backgroundColor: "rgba(255, 248, 232, 0.75)",
    borderRadius: 8,
    height: 7,
    width: "64%",
  },
  ineGuideLineShort: {
    backgroundColor: "rgba(255, 248, 232, 0.55)",
    borderRadius: 8,
    height: 7,
    width: "46%",
  },
  ineGuideHint: {
    backgroundColor: "rgba(36, 22, 15, 0.82)",
    borderRadius: 8,
    color: "#fff8e8",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    textAlign: "center",
  },
  activationNextOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: "rgba(21, 128, 61, 0.74)",
    justifyContent: "center",
    padding: 20,
  },
  activationNextText: {
    color: "#fff8e8",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  activationNextBanner: {
    backgroundColor: "#15803d",
    borderColor: "#166534",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  activationNextBannerText: {
    color: "#fff8e8",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  activationActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  activationPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#8f1d2c",
    borderColor: "#6f141f",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  activationPrimaryButtonText: {
    color: "#fff8e8",
    fontSize: 14,
    fontWeight: "900",
  },
  activationSecondaryButton: {
    alignItems: "center",
    backgroundColor: "#fff8e8",
    borderColor: "#8f1d2c",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  activationSecondaryButtonText: {
    color: "#8f1d2c",
    fontSize: 14,
    fontWeight: "900",
  },
  signaturePanel: {
    gap: 12,
  },
  signatureBox: {
    backgroundColor: "#fff8e8",
    borderColor: "#3b2619",
    borderRadius: 8,
    borderWidth: 1,
    height: 260,
    overflow: "hidden",
  },
  signatureCanvas: {
    height: 260,
    width: "100%",
  },
  activationMessage: {
    color: "#15803d",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
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
