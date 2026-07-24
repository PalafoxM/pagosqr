import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import SignatureScreen, {
  SignatureViewRef,
} from "react-native-signature-canvas";

import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  AuthSession,
  clearSession,
  getStoredSession,
  isClientProfile,
  saveSession,
} from "@/services/auth";
import {
  activateClienteQr,
  ClienteProfile,
  DailyConsumptionItem,
  EstablecimientoFic,
  getClienteDailyConsumption,
  getClienteProfile,
  getEstablecimientosFic,
  getFallbackClienteProfile,
} from "@/services/client-data";
import {
  approvePaymentRequest,
  getTransactionTime,
  observeBalanceUpdates,
  observePaymentRequests,
  PaymentRequestNotification,
  registerPushToken,
  rejectPaymentRequest,
} from "@/services/notifications";

type ClienteTab = "datos" | "establecimientos" | "cuenta";
type ActivationStep =
  | "idle"
  | "front"
  | "front_review"
  | "back"
  | "back_review"
  | "signature"
  | "summary";

const PAYMENT_TIMEOUT_SECONDS = 60;
const STATUS_MESSAGE_CLEAR_DELAY_MS = 3000;

const SCREEN_WIDTH = Dimensions.get("window").width;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const CAMERA_CONTAINER_WIDTH = SCREEN_WIDTH - 32;
const CARD_FRAME_WIDTH = CAMERA_CONTAINER_WIDTH * 0.9;
const CARD_FRAME_HEIGHT = CARD_FRAME_WIDTH / 1.585;

const tabs: { id: ClienteTab; label: string }[] = [
  { id: "datos", label: "Mis datos" },
  { id: "establecimientos", label: "FIC" },
  { id: "cuenta", label: "Cuenta" },
];

const formatPaymentTotal = (value: unknown) =>
  `$${Number(value || 0).toFixed(2)}`;

const formatBalance = (value: unknown) => Number(value || 0).toFixed(2);

const logClienteSaldo = (
  message: string,
  details?: Record<string, unknown>,
) => {
  console.log(`[cliente:saldo] ${message}`, details || {});
};

const normalizeSearchText = (value: unknown) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

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
  .m-signature-pad {
    touch-action: none;
  }
  .m-signature-pad--body canvas {
    touch-action: none;
  }
`;

const isPaymentAlreadyResolvedError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("la solicitud ha expirado") ||
    normalized.includes("tiempo de espera agotado")
  ) {
    return false;
  }

  return (
    normalized.includes("solicitud no encontrada") ||
    normalized.includes("solicitud ya fue atendida") ||
    normalized.includes("la solicitud ya fue atendida") ||
    normalized.includes("http 404") ||
    normalized.includes("http 409")
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
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [establecimientos, setEstablecimientos] = useState<
    EstablecimientoFic[]
  >([]);
  const [establecimientosSearch, setEstablecimientosSearch] = useState("");
  const [establecimientosLoading, setEstablecimientosLoading] = useState(false);
  const [establecimientosError, setEstablecimientosError] = useState("");
  const [paymentRequest, setPaymentRequest] =
    useState<PaymentRequestNotification | null>(null);
  const [paymentActionLoading, setPaymentActionLoading] = useState<
    "approve" | "reject" | null
  >(null);
  const [paymentActionMessage, setPaymentActionMessage] = useState("");
  const [paymentTimeoutSeconds, setPaymentTimeoutSeconds] = useState(
    PAYMENT_TIMEOUT_SECONDS,
  );
  const [activationStep, setActivationStep] = useState<ActivationStep>("idle");
  const [ineFront, setIneFront] = useState<string | null>(null);
  const [ineBack, setIneBack] = useState<string | null>(null);
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const [activationCaptureLoading, setActivationCaptureLoading] =
    useState(false);
  const [activationCameraActive, setActivationCameraActive] = useState(false);
  const [activationCameraReady, setActivationCameraReady] = useState(false);
  const [cameraMountReady, setCameraMountReady] = useState(false);
  const [hasSignatureStrokes, setHasSignatureStrokes] = useState(false);
  const [activationLoading, setActivationLoading] = useState(false);
  const [activationMessage, setActivationMessage] = useState("");
  const [activationError, setActivationError] = useState("");
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraLayout, setCameraLayout] = useState({ width: 0, height: 0 });
  const [activationModalVisible, setActivationModalVisible] = useState(false);
  const [frontPhotoUri, setFrontPhotoUri] = useState<string | null>(null);
  const [backPhotoUri, setBackPhotoUri] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [signatureKey, setSignatureKey] = useState(0);
  const [dailyConsumption, setDailyConsumption] = useState<
    DailyConsumptionItem[]
  >([]);
  const [dailyConsumptionLoading, setDailyConsumptionLoading] = useState(false);
  const [dailyConsumptionError, setDailyConsumptionError] = useState("");
  const [dailyConsumptionRefreshTrigger, setDailyConsumptionRefreshTrigger] =
    useState(0);
  const cameraRef = useRef<any>(null);
  const signatureRef = useRef<SignatureViewRef | null>(null);
  const cameraMountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const sessionRef = useRef<AuthSession | null>(null);
  const profileRef = useRef<ClienteProfile | null>(null);
  const paymentRequestRef = useRef<PaymentRequestNotification | null>(null);
  const paymentTimeoutRef = useRef<number | null>(null);
  const profileRequestIdRef = useRef(0);
  const profileRefreshInFlightRef = useRef(false);
  const registeredPushTokenForSessionRef = useRef("");
  const sessionToken = session?.token || "";
  const sessionUserId = session?.user.id_usuario || 0;
  const statusMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const isProcessingPaymentRef = useRef(false);
  const processedPaymentIdsRef = useRef<Set<string>>(new Set());

  const clearPaymentMessage = useCallback(() => {
    if (statusMessageTimeoutRef.current) {
      clearTimeout(statusMessageTimeoutRef.current);
      statusMessageTimeoutRef.current = null;
    }
    setPaymentActionMessage("");
  }, []);

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

    if (
      !activeSession ||
      registeredPushTokenForSessionRef.current === sessionToken
    ) {
      return;
    }

    registeredPushTokenForSessionRef.current = sessionToken;
    registerPushToken(activeSession.token, activeSession.user.id_usuario).catch(
      (pushError) => {
        console.warn("No se pudo registrar push token.", pushError);
        registeredPushTokenForSessionRef.current = "";
      },
    );
  }, [sessionToken, sessionUserId]);

  useEffect(() => {
    paymentRequestRef.current = paymentRequest;
  }, [paymentRequest]);

  useEffect(() => {
    if (
      !paymentRequest ||
      paymentRequest.status === "approved" ||
      paymentRequest.status === "rejected"
    ) {
      if (paymentTimeoutRef.current) {
        clearInterval(paymentTimeoutRef.current);
        paymentTimeoutRef.current = null;
      }
      setPaymentTimeoutSeconds(PAYMENT_TIMEOUT_SECONDS);
      return;
    }

    if (paymentActionLoading !== null) {
      return;
    }

    let mounted = true;

    const syncBackendTime = async () => {
      if (!sessionRef.current || !paymentRequest.transactionId) return;
      try {
        const timeData = await getTransactionTime(
          sessionRef.current.token,
          paymentRequest.transactionId,
        );
        if (!mounted) return;

        setPaymentTimeoutSeconds(timeData.remaining_seconds);

        if (timeData.remaining_seconds <= 0 || timeData.status !== "pending") {
          if (paymentTimeoutRef.current) {
            clearInterval(paymentTimeoutRef.current);
            paymentTimeoutRef.current = null;
          }

          setPaymentRequest(null);
          isProcessingPaymentRef.current = false;

          if (
            timeData.status === "rejected" ||
            timeData.status === "rechazado" ||
            timeData.remaining_seconds <= 0
          ) {
            setPaymentActionMessage(
              "Tiempo de espera agotado. El pago ha sido rechazado.",
            );
          } else {
            setPaymentActionMessage("Esta solicitud de pago ya fue atendida.");
          }

          if (statusMessageTimeoutRef.current)
            clearTimeout(statusMessageTimeoutRef.current);
          statusMessageTimeoutRef.current = setTimeout(() => {
            setPaymentActionMessage("");
          }, STATUS_MESSAGE_CLEAR_DELAY_MS) as unknown as number;
        }
      } catch (error) {
        console.warn("Error sincronizando temporizador con backend", error);
      }
    };

    syncBackendTime();
    paymentTimeoutRef.current = setInterval(
      syncBackendTime,
      1000,
    ) as unknown as number;

    return () => {
      mounted = false;
      if (paymentTimeoutRef.current) {
        clearInterval(paymentTimeoutRef.current);
        paymentTimeoutRef.current = null;
      }
      setPaymentTimeoutSeconds(PAYMENT_TIMEOUT_SECONDS);
    };
  }, [paymentRequest, paymentActionLoading]);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }

    let mounted = true;
    setDailyConsumptionLoading(true);
    setDailyConsumptionError("");

    getClienteDailyConsumption(sessionToken)
      .then((items) => {
        if (mounted) {
          setDailyConsumption(items);
        }
      })
      .catch((error) => {
        if (mounted) {
          setDailyConsumption([]);
          setDailyConsumptionError(
            error instanceof Error
              ? error.message
              : "No se pudo consultar el consumo diario.",
          );
        }
      })
      .finally(() => {
        if (mounted) {
          setDailyConsumptionLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [sessionToken, dailyConsumptionRefreshTrigger]);

  useEffect(() => {
    const isCameraStep =
      activationStep === "front" || activationStep === "back";

    if (cameraMountTimerRef.current) {
      clearTimeout(cameraMountTimerRef.current);
      cameraMountTimerRef.current = null;
    }

    setActivationCameraReady(false);
    setCameraMountReady(false);

    if (!isCameraStep || !activationModalVisible) {
      setActivationCameraActive(false);
      return;
    }

    cameraMountTimerRef.current = setTimeout(() => {
      cameraMountTimerRef.current = null;
      setActivationCameraActive(true);
      setCameraMountReady(true);
    }, 180);

    return () => {
      if (cameraMountTimerRef.current) {
        clearTimeout(cameraMountTimerRef.current);
        cameraMountTimerRef.current = null;
      }
      setActivationCameraActive(false);
      setCameraMountReady(false);
    };
  }, [activationStep, activationModalVisible, cameraKey]);

  useEffect(() => {
    let mounted = true;

    getStoredSession().then((storedSession) => {
      if (!mounted) {
        return;
      }

      if (!storedSession || !isClientProfile(storedSession.user.id_perfil)) {
        clearSession();
        router.replace("/");
        return;
      }

      logClienteSaldo("sesión almacenada cargada", {
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
          const nextSession = mergeSessionWithProfile(
            activeSession,
            nextProfile,
          );
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

  const closeActivationModal = useCallback(() => {
    setActivationModalVisible(false);
    setActivationStep("idle");
    setActivationCaptureLoading(false);
    setActivationCameraActive(false);
    setActivationCameraReady(false);
    setCameraMountReady(false);
    setIneFront(null);
    setIneBack(null);
    setFrontPhotoUri(null);
    setBackPhotoUri(null);
    setSignatureImage(null);
    setHasSignatureStrokes(false);
    setActivationError("");
    setActivationMessage("");
    setCameraLayout({ width: 0, height: 0 });
    setCameraKey((prev) => prev + 1);
    setSignatureKey((prev) => prev + 1);
  }, []);

  const resetActivation = useCallback(() => {
    setActivationStep("idle");
    setActivationCaptureLoading(false);
    setActivationCameraActive(false);
    setActivationCameraReady(false);
    setCameraMountReady(false);
    setIneFront(null);
    setIneBack(null);
    setFrontPhotoUri(null);
    setBackPhotoUri(null);
    setSignatureImage(null);
    setHasSignatureStrokes(false);
    setActivationError("");
    setActivationMessage("");
    setSignatureKey((prev) => prev + 1);
  }, []);

  const handleStartActivation = useCallback(async () => {
    const activeProfile = profileRef.current;
    const activeSession = sessionRef.current;
    const activeQr =
      Number(activeProfile?.activo_qr ?? activeSession?.user.activo_qr ?? 0) ===
      1;

    if (activeQr) {
      setActivationMessage("QR activado.");
      setActivationError("");
      return;
    }

    setActivationMessage("");
    setActivationError("");

    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();

      if (!permission.granted) {
        setActivationError(
          "Se necesita permiso de cámara para fotografiar la credencial.",
        );
        return;
      }
    }

    setIneFront(null);
    setIneBack(null);
    setFrontPhotoUri(null);
    setBackPhotoUri(null);
    setSignatureImage(null);
    setHasSignatureStrokes(false);
    setActivationCaptureLoading(false);
    setActivationCameraReady(false);
    setCameraMountReady(false);
    setCameraLayout({ width: 0, height: 0 });
    setCameraKey((prev) => prev + 1);
    setSignatureKey((prev) => prev + 1);
    setActivationStep("front");
    setActivationModalVisible(true);
  }, [cameraPermission?.granted, requestCameraPermission]);

  const cropToCardFrame = useCallback(
    async (uri: string, photoWidth: number, photoHeight: number) => {
      if (!cameraLayout.width || !cameraLayout.height) {
        return uri;
      }

      const viewWidth = cameraLayout.width;
      const viewHeight = cameraLayout.height;

      const scale = Math.max(viewWidth / photoWidth, viewHeight / photoHeight);

      const displayedWidth = photoWidth * scale;
      const displayedHeight = photoHeight * scale;

      const offsetX = (viewWidth - displayedWidth) / 2;
      const offsetY = (viewHeight - displayedHeight) / 2;

      const frameX = (viewWidth - CARD_FRAME_WIDTH) / 2;
      const frameY = viewHeight * 0.15;

      const cropX = Math.round((frameX - offsetX) / scale);
      const cropY = Math.round((frameY - offsetY) / scale);
      const cropWidth = Math.round(CARD_FRAME_WIDTH / scale);
      const cropHeight = Math.round(CARD_FRAME_HEIGHT / scale);

      const safeOriginX = Math.max(0, Math.min(cropX, photoWidth - cropWidth));
      const safeOriginY = Math.max(
        0,
        Math.min(cropY, photoHeight - cropHeight),
      );
      const safeWidth = Math.min(cropWidth, photoWidth - safeOriginX);
      const safeHeight = Math.min(cropHeight, photoHeight - safeOriginY);

      const result = await ImageManipulator.manipulateAsync(
        uri,
        [
          {
            crop: {
              originX: safeOriginX,
              originY: safeOriginY,
              width: safeWidth,
              height: safeHeight,
            },
          },
        ],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
      );

      return result.uri;
    },
    [cameraLayout],
  );

  const handleCaptureIne = useCallback(async () => {
    if (
      activationCaptureLoading ||
      !activationCameraReady ||
      !cameraRef.current ||
      !["front", "back"].includes(activationStep)
    ) {
      return;
    }

    setActivationCaptureLoading(true);
    setActivationError("");

    try {
      const picture = await cameraRef.current.takePictureAsync({
        quality: 1.0,
        base64: false,
        skipProcessing: false,
      });

      if (!picture?.uri) {
        throw new Error("No se obtuvo una imagen válida.");
      }

      const imageInfo = await ImageManipulator.manipulateAsync(
        picture.uri,
        [],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
      );

      const croppedUri = await cropToCardFrame(
        imageInfo.uri,
        imageInfo.width,
        imageInfo.height,
      );

      const manipResult = await ImageManipulator.manipulateAsync(
        croppedUri,
        [],
        {
          compress: 0.92,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        },
      );

      if (!manipResult?.base64) {
        throw new Error("No se pudo convertir la imagen recortada.");
      }

      const imageData = `data:image/jpeg;base64,${manipResult.base64}`;

      if (activationStep === "front") {
        setIneFront(imageData);
        setFrontPhotoUri(manipResult.uri);
        setActivationStep("front_review");
      } else if (activationStep === "back") {
        setIneBack(imageData);
        setBackPhotoUri(manipResult.uri);
        setActivationStep("back_review");
      }
    } catch (captureError) {
      setActivationError(
        captureError instanceof Error
          ? captureError.message
          : "No se pudo tomar la fotografía.",
      );
    } finally {
      setActivationCaptureLoading(false);
    }
  }, [
    activationCameraReady,
    activationCaptureLoading,
    activationStep,
    cropToCardFrame,
  ]);

  const goToNextStep = useCallback(() => {
    if (activationStep === "front_review" && ineFront) {
      setActivationStep("back");
      return;
    }

    if (activationStep === "back_review" && ineBack) {
      setActivationStep("signature");
      setSignatureKey((prev) => prev + 1);
      return;
    }
  }, [activationStep, ineFront, ineBack]);

  const retakeCurrentSide = useCallback(() => {
    if (activationStep === "front_review") {
      setIneFront(null);
      setFrontPhotoUri(null);
      setActivationStep("front");
      return;
    }

    if (activationStep === "back_review") {
      setIneBack(null);
      setBackPhotoUri(null);
      setActivationStep("back");
      return;
    }

    if (activationStep === "summary") {
      setActivationStep("signature");
      setSignatureKey((prev) => prev + 1);
    }
  }, [activationStep]);

  const handleReviewSignature = useCallback(() => {
    if (!hasSignatureStrokes) {
      setActivationError("Firma con tu dedo antes de continuar.");
      return;
    }

    setActivationError("");
    signatureRef.current?.readSignature();
  }, [hasSignatureStrokes]);

  const saveActivationWithSignature = useCallback(
    async (signature: string) => {
      const activeSession = sessionRef.current;

      if (!activeSession || !ineFront || !ineBack || !signature) {
        setActivationError(
          "Captura frente, reverso y firma para activar el QR.",
        );
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
          "Documentos guardados correctamente. Tu activación QR quedó en revisión.",
        );
        closeActivationModal();
      } catch (activationSaveError) {
        setActivationError(
          activationSaveError instanceof Error
            ? activationSaveError.message
            : "No se pudo guardar la activación QR.",
        );
      } finally {
        setActivationLoading(false);
      }
    },
    [ineBack, ineFront, closeActivationModal],
  );

  const handleSubmitActivation = useCallback(() => {
    if (!ineFront || !ineBack || !signatureImage) {
      setActivationError("Captura frente, reverso y firma para activar el QR.");
      return;
    }

    setActivationLoading(true);
    setActivationError("");
    void saveActivationWithSignature(signatureImage);
  }, [ineBack, ineFront, signatureImage, saveActivationWithSignature]);

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
        setDailyConsumptionRefreshTrigger((prev) => prev + 1);
      } finally {
        profileRefreshInFlightRef.current = false;
      }
    },
    [],
  );

  const applyBalanceUpdate = useCallback(
    async (
      balanceUpdate: {
        current_balance?: unknown;
        monto_deposito_hotel?: unknown;
        hotel_balance?: unknown;
      },
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
        ? formatBalance(
            balanceUpdate.monto_deposito_hotel ?? balanceUpdate.hotel_balance,
          )
        : currentProfile?.monto_deposito_hotel ||
          activeSession.user.monto_deposito_hotel;

      logClienteSaldo("saldo actualizado por notificación", {
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

      if (
        reason !== "hotel_check_in" &&
        balanceUpdate.current_balance !== undefined
      ) {
        setDailyConsumptionRefreshTrigger((prev) => prev + 1);
      }
    },
    [setDailyConsumptionRefreshTrigger],
  );

  const handlePaymentAction = useCallback(
    async (
      action: "approve" | "reject",
      request: PaymentRequestNotification | null = paymentRequestRef.current,
    ) => {
      const activeSession = sessionRef.current;
      if (!activeSession || !request?.transactionId) return;

      if (paymentTimeoutRef.current) {
        clearInterval(paymentTimeoutRef.current);
        paymentTimeoutRef.current = null;
      }

      const transactionKey = String(request.transactionId);
      processedPaymentIdsRef.current.add(transactionKey);

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

          setPaymentActionMessage("Pago aprobado correctamente.");

          if (statusMessageTimeoutRef.current) {
            clearTimeout(statusMessageTimeoutRef.current);
          }
          statusMessageTimeoutRef.current = setTimeout(() => {
            setPaymentActionMessage("");
          }, STATUS_MESSAGE_CLEAR_DELAY_MS) as unknown as number;

          logClienteSaldo("pago aprobado, consultando saldo real", {
            transactionId: request.transactionId,
          });

          setPaymentRequest(null);
          isProcessingPaymentRef.current = false;

          await refreshClienteProfile(sessionRef.current || activeSession);
          setDailyConsumptionRefreshTrigger((prev) => prev + 1);
        } else {
          await rejectPaymentRequest(
            activeSession.token,
            request.transactionId,
          );
          setPaymentActionMessage("Pago rechazado correctamente.");
          if (statusMessageTimeoutRef.current) {
            clearTimeout(statusMessageTimeoutRef.current);
          }
          statusMessageTimeoutRef.current = setTimeout(() => {
            setPaymentActionMessage("");
          }, STATUS_MESSAGE_CLEAR_DELAY_MS) as unknown as number;
        }

        setPaymentRequest(null);
        isProcessingPaymentRef.current = false;
      } catch (paymentError) {
        const errorMessage =
          paymentError instanceof Error
            ? paymentError.message
            : String(paymentError);
        const lowerMsg = errorMessage.toLowerCase();

        if (
          lowerMsg.includes("la solicitud ha expirado") ||
          lowerMsg.includes("tiempo de espera agotado")
        ) {
          setPaymentActionMessage(
            "Tiempo de espera agotado. El pago ha sido rechazado.",
          );
          if (statusMessageTimeoutRef.current)
            clearTimeout(statusMessageTimeoutRef.current);
          statusMessageTimeoutRef.current = setTimeout(
            () => setPaymentActionMessage(""),
            STATUS_MESSAGE_CLEAR_DELAY_MS,
          ) as unknown as number;
          setPaymentRequest(null);
          isProcessingPaymentRef.current = false;
          return;
        }

        if (isPaymentAlreadyResolvedError(paymentError)) {
          setPaymentRequest(null);
          isProcessingPaymentRef.current = false;
          setPaymentActionMessage("Esta solicitud de pago ya fue atendida.");
          if (statusMessageTimeoutRef.current) {
            clearTimeout(statusMessageTimeoutRef.current);
          }
          statusMessageTimeoutRef.current = setTimeout(() => {
            setPaymentActionMessage("");
          }, STATUS_MESSAGE_CLEAR_DELAY_MS) as unknown as number;
          await refreshClienteProfile(sessionRef.current || activeSession);
          return;
        }

        setPaymentActionMessage(
          paymentError instanceof Error
            ? paymentError.message
            : "No se pudo responder el pago.",
        );
        if (statusMessageTimeoutRef.current) {
          clearTimeout(statusMessageTimeoutRef.current);
        }
        statusMessageTimeoutRef.current = setTimeout(() => {
          setPaymentActionMessage("");
        }, STATUS_MESSAGE_CLEAR_DELAY_MS) as unknown as number;
      } finally {
        setPaymentActionLoading(null);
      }
    },
    [refreshClienteProfile, setDailyConsumptionRefreshTrigger],
  );

  useEffect(() => {
    const unsubscribe = observePaymentRequests((nextPaymentRequest, source) => {
      const transactionKey = String(nextPaymentRequest.transactionId || "");

      if (!transactionKey) return;
      if (processedPaymentIdsRef.current.has(transactionKey)) {
        console.log("[cliente] pago ya procesado, ignorando", transactionKey);

        setPaymentRequest(null);
        setPaymentActionMessage("Esta solicitud de pago ya fue atendida.");

        if (statusMessageTimeoutRef.current) {
          clearTimeout(statusMessageTimeoutRef.current);
        }
        statusMessageTimeoutRef.current = setTimeout(
          () => setPaymentActionMessage(""),
          3000,
        ) as unknown as number;

        return;
      }
      if (isProcessingPaymentRef.current) {
        console.log(
          "[cliente] ya procesando un pago, ignorando",
          transactionKey,
        );
        return;
      }

      const currentSession = sessionRef.current;
      if (!currentSession) return;

      getTransactionTime(currentSession.token, transactionKey)
        .then((timeData) => {
          if (timeData.status === "pending") {
            isProcessingPaymentRef.current = true;
            setPaymentRequest(nextPaymentRequest);
            setPaymentActionMessage("");
            setActiveTab("datos");
          } else {
            setPaymentRequest(null);
            setPaymentActionMessage("Esta solicitud de pago ya fue atendida.");
            if (statusMessageTimeoutRef.current)
              clearTimeout(statusMessageTimeoutRef.current);
            statusMessageTimeoutRef.current = setTimeout(
              () => setPaymentActionMessage(""),
              3000,
            ) as unknown as number;
          }
        })
        .catch((error) => {
          console.warn(
            "[cliente] error al consultar estado de transacción",
            error,
          );
          isProcessingPaymentRef.current = true;
          setPaymentRequest(nextPaymentRequest);
          setPaymentActionMessage("");
          setActiveTab("datos");
        });
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    return observeBalanceUpdates((balanceUpdate, source) => {
      void applyBalanceUpdate(balanceUpdate, source);
    });
  }, [applyBalanceUpdate]);

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

  const filteredEstablecimientos = useMemo(() => {
    const searchTerm = normalizeSearchText(establecimientosSearch);

    if (!searchTerm) {
      return establecimientos;
    }

    return establecimientos.filter((item) =>
      [item.dsc_establecimiento, item.ubicacion, item.direccion].some((value) =>
        normalizeSearchText(value).includes(searchTerm),
      ),
    );
  }, [establecimientos, establecimientosSearch]);

  const qrActivo =
    Number(profile?.activo_qr ?? session?.user.activo_qr ?? 0) === 1;
  const activationSubmitted = Boolean(activationMessage);
  const refreshDisabled = manualRefreshing || profileLoading;

  const handleRefreshScreen = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession || refreshDisabled) {
      return;
    }

    setManualRefreshing(true);
    setProfileError("");

    try {
      await refreshClienteProfile(activeSession);
    } catch (refreshError) {
      setProfileError(
        refreshError instanceof Error
          ? refreshError.message
          : "No se pudo actualizar la pantalla.",
      );
    } finally {
      setManualRefreshing(false);
    }
  }, [refreshDisabled, refreshClienteProfile]);

  const renderActivationModal = () => {
    if (!activationModalVisible) {
      return null;
    }

    const renderFrontStep = () => (
      <View style={styles.modalStepContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Frente de INE</Text>
          <Text style={styles.modalSubtitle}>
            Coloca el frente de tu credencial dentro del marco
          </Text>
        </View>

        <View
          style={styles.modalCameraContainer}
          key={`camera-front-${cameraKey}`}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setCameraLayout({ width, height });
          }}
        >
          {cameraMountReady ? (
            <CameraView
              key={`camera-view-front-${cameraKey}`}
              ref={cameraRef}
              style={styles.cameraView}
              active={activationCameraActive}
              facing="back"
              onCameraReady={() => setActivationCameraReady(true)}
              onMountError={(cameraError) => {
                setActivationCameraActive(false);
                setActivationError(
                  cameraError?.message ||
                    "No se pudo iniciar la cámara. Intenta de nuevo.",
                );
              }}
            />
          ) : null}
          {!activationCameraReady ? (
            <View style={styles.cameraLoadingOverlay} pointerEvents="none">
              <ActivityIndicator color="#fff8e8" size="small" />
            </View>
          ) : null}
          <View style={styles.cameraOverlay} pointerEvents="none">
            <View style={styles.overlayTop} />
            <View style={styles.overlayMiddle}>
              <View style={styles.overlaySide} />
              <View style={styles.cardFrame}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              <View style={styles.overlaySide} />
            </View>
            <View style={styles.overlayBottom}>
              <Text style={styles.overlayHint}>
                Mantén el documento plano y bien iluminado
              </Text>
            </View>
          </View>
        </View>

        {activationError ? (
          <Text style={styles.modalError}>{activationError}</Text>
        ) : null}

        <View style={styles.modalActions}>
          <Pressable
            onPress={closeActivationModal}
            style={[styles.modalSecondaryButton, styles.modalCancelButton]}
          >
            <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
          </Pressable>
          <Pressable
            disabled={activationCaptureLoading || !activationCameraReady}
            onPress={handleCaptureIne}
            style={[
              styles.modalPrimaryButton,
              (activationCaptureLoading || !activationCameraReady) &&
                styles.modalButtonDisabled,
            ]}
          >
            {activationCaptureLoading ? (
              <ActivityIndicator color="#fff8e8" size="small" />
            ) : (
              <Text style={styles.modalPrimaryButtonText}>Tomar foto</Text>
            )}
          </Pressable>
        </View>
      </View>
    );

    const renderFrontReviewStep = () => (
      <View style={styles.modalStepContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Revisar frente de INE</Text>
          <Text style={styles.modalSubtitle}>
            Verifica que la imagen sea legible antes de continuar
          </Text>
        </View>

        <View style={styles.modalReviewContainer}>
          {frontPhotoUri ? (
            <Image
              source={{ uri: frontPhotoUri }}
              style={styles.modalReviewImage}
              resizeMode="contain"
            />
          ) : null}
        </View>

        {activationError ? (
          <Text style={styles.modalError}>{activationError}</Text>
        ) : null}

        <View style={styles.modalActions}>
          <Pressable
            onPress={closeActivationModal}
            style={[styles.modalSecondaryButton, styles.modalCancelButton]}
          >
            <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
          </Pressable>
          <Pressable
            onPress={retakeCurrentSide}
            style={[styles.modalSecondaryButton, styles.modalRetakeButton]}
          >
            <Text style={styles.modalSecondaryButtonText}>Repetir</Text>
          </Pressable>
          <Pressable onPress={goToNextStep} style={styles.modalPrimaryButton}>
            <Text style={styles.modalPrimaryButtonText}>Continuar</Text>
          </Pressable>
        </View>
      </View>
    );

    const renderBackStep = () => (
      <View style={styles.modalStepContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Reverso de INE</Text>
          <Text style={styles.modalSubtitle}>
            Ahora coloca el reverso de tu credencial dentro del marco
          </Text>
        </View>

        <View
          style={styles.modalCameraContainer}
          key={`camera-back-${cameraKey}`}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setCameraLayout({ width, height });
          }}
        >
          {cameraMountReady ? (
            <CameraView
              key={`camera-view-back-${cameraKey}`}
              ref={cameraRef}
              style={styles.cameraView}
              active={activationCameraActive}
              facing="back"
              onCameraReady={() => setActivationCameraReady(true)}
              onMountError={(cameraError) => {
                setActivationCameraActive(false);
                setActivationError(
                  cameraError?.message ||
                    "No se pudo iniciar la cámara. Intenta de nuevo.",
                );
              }}
            />
          ) : null}
          {!activationCameraReady ? (
            <View style={styles.cameraLoadingOverlay} pointerEvents="none">
              <ActivityIndicator color="#fff8e8" size="small" />
            </View>
          ) : null}
          <View style={styles.cameraOverlay} pointerEvents="none">
            <View style={styles.overlayTop} />
            <View style={styles.overlayMiddle}>
              <View style={styles.overlaySide} />
              <View style={styles.cardFrame}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              <View style={styles.overlaySide} />
            </View>
            <View style={styles.overlayBottom}>
              <Text style={styles.overlayHint}>
                Mantén el documento plano y bien iluminado
              </Text>
            </View>
          </View>
        </View>

        {activationError ? (
          <Text style={styles.modalError}>{activationError}</Text>
        ) : null}

        <View style={styles.modalActions}>
          <Pressable
            onPress={closeActivationModal}
            style={[styles.modalSecondaryButton, styles.modalCancelButton]}
          >
            <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
          </Pressable>
          <Pressable
            disabled={activationCaptureLoading || !activationCameraReady}
            onPress={handleCaptureIne}
            style={[
              styles.modalPrimaryButton,
              (activationCaptureLoading || !activationCameraReady) &&
                styles.modalButtonDisabled,
            ]}
          >
            {activationCaptureLoading ? (
              <ActivityIndicator color="#fff8e8" size="small" />
            ) : (
              <Text style={styles.modalPrimaryButtonText}>Tomar foto</Text>
            )}
          </Pressable>
        </View>
      </View>
    );

    const renderBackReviewStep = () => (
      <View style={styles.modalStepContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Revisar reverso de INE</Text>
          <Text style={styles.modalSubtitle}>
            Verifica que la imagen sea legible antes de continuar
          </Text>
        </View>

        <View style={styles.modalReviewContainer}>
          {backPhotoUri ? (
            <Image
              source={{ uri: backPhotoUri }}
              style={styles.modalReviewImage}
              resizeMode="contain"
            />
          ) : null}
        </View>

        {activationError ? (
          <Text style={styles.modalError}>{activationError}</Text>
        ) : null}

        <View style={styles.modalActions}>
          <Pressable
            onPress={closeActivationModal}
            style={[styles.modalSecondaryButton, styles.modalCancelButton]}
          >
            <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
          </Pressable>
          <Pressable
            onPress={retakeCurrentSide}
            style={[styles.modalSecondaryButton, styles.modalRetakeButton]}
          >
            <Text style={styles.modalSecondaryButtonText}>Repetir</Text>
          </Pressable>
          <Pressable onPress={goToNextStep} style={styles.modalPrimaryButton}>
            <Text style={styles.modalPrimaryButtonText}>Continuar</Text>
          </Pressable>
        </View>
      </View>
    );

    const renderSignatureStep = () => (
      <View style={styles.modalStepContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Firma del titular</Text>
          <Text style={styles.modalSubtitle}>
            Firma dentro del recuadro para completar tu activación
          </Text>
        </View>

        <View
          style={styles.modalSignatureContainer}
          key={`signature-${signatureKey}`}
        >
          {signatureImage ? (
            <Image
              source={{ uri: signatureImage }}
              style={styles.modalSignaturePreview}
              resizeMode="contain"
            />
          ) : (
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
              penColor="#263B80"
              onBegin={() => {
                setActivationError("");
                setHasSignatureStrokes(true);
              }}
              onEmpty={() => {
                setHasSignatureStrokes(false);
                setSignatureImage(null);
                setActivationError("Firma con tu dedo antes de continuar.");
              }}
              onError={(signatureError) => {
                setActivationError(
                  signatureError instanceof Error
                    ? signatureError.message
                    : "No se pudo abrir el panel de firma.",
                );
              }}
              onOK={(signature) => {
                setSignatureImage(signature);
                setActivationStep("summary");
              }}
              scrollable={false}
              style={styles.modalSignatureCanvas}
              webStyle={signatureCanvasWebStyle}
              webviewProps={{
                androidLayerType: "hardware",
                cacheEnabled: true,
                nestedScrollEnabled: false,
                overScrollMode: "never",
                scrollEnabled: false,
              }}
            />
          )}
        </View>

        {activationError ? (
          <Text style={styles.modalError}>{activationError}</Text>
        ) : null}
        {activationMessage ? (
          <Text style={styles.modalSuccess}>{activationMessage}</Text>
        ) : null}

        <View style={styles.modalActions}>
          <Pressable
            onPress={() => {
              signatureRef.current?.clearSignature();
              setSignatureImage(null);
              setHasSignatureStrokes(false);
              setActivationError("");
            }}
            style={[styles.modalSecondaryButton, styles.modalClearButton]}
          >
            <Text style={styles.modalSecondaryButtonText}>Limpiar</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setActivationStep("back_review");
            }}
            style={[styles.modalSecondaryButton, styles.modalBackButton]}
          >
            <Text style={styles.modalSecondaryButtonText}>Volver</Text>
          </Pressable>
          <Pressable
            disabled={
              activationLoading || (!signatureImage && !hasSignatureStrokes)
            }
            onPress={() => {
              if (signatureImage) {
                setActivationStep("summary");
                return;
              }
              handleReviewSignature();
            }}
            style={[
              styles.modalPrimaryButton,
              styles.modalSaveButton,
              (activationLoading ||
                (!signatureImage && !hasSignatureStrokes)) &&
                styles.modalButtonDisabled,
            ]}
          >
            {activationLoading ? (
              <ActivityIndicator color="#fff8e8" size="small" />
            ) : (
              <Text style={styles.modalPrimaryButtonText}>Revisar</Text>
            )}
          </Pressable>
        </View>
      </View>
    );

    const renderSummaryStep = () => (
      <View style={styles.modalStepContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Revisión final</Text>
          <Text style={styles.modalSubtitle}>
            Verifica que la información sea correcta antes de enviar
          </Text>
        </View>

        <ScrollView
          style={styles.modalSummaryScroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 8 }}
        >
          <Text style={styles.modalSummaryLabel}>Frente de INE</Text>
          {frontPhotoUri ? (
            <Image
              source={{ uri: frontPhotoUri }}
              style={styles.modalSummaryImage}
              resizeMode="contain"
            />
          ) : null}

          <Text style={styles.modalSummaryLabel}>Reverso de INE</Text>
          {backPhotoUri ? (
            <Image
              source={{ uri: backPhotoUri }}
              style={styles.modalSummaryImage}
              resizeMode="contain"
            />
          ) : null}

          <Text style={styles.modalSummaryLabel}>Firma</Text>
          {signatureImage ? (
            <View style={styles.modalSummarySignatureWrapper}>
              <Image
                source={{ uri: signatureImage }}
                style={styles.modalSummarySignature}
                resizeMode="contain"
              />
            </View>
          ) : (
            <View style={styles.modalSummarySignatureWrapper}>
              <Text style={styles.modalSummarySignaturePlaceholder}>
                No hay firma capturada
              </Text>
            </View>
          )}
        </ScrollView>

        {activationError ? (
          <Text style={styles.modalError}>{activationError}</Text>
        ) : null}
        {activationMessage ? (
          <Text style={styles.modalSuccess}>{activationMessage}</Text>
        ) : null}

        <View style={styles.modalActions}>
          <Pressable
            onPress={() => {
              setActivationStep("signature");
              setSignatureKey((prev) => prev + 1);
            }}
            style={[styles.modalSecondaryButton, styles.modalBackButton]}
          >
            <Text style={styles.modalSecondaryButtonText}>Volver</Text>
          </Pressable>
          <Pressable
            disabled={activationLoading || !signatureImage}
            onPress={handleSubmitActivation}
            style={[
              styles.modalPrimaryButton,
              styles.modalSaveButton,
              (activationLoading || !signatureImage) &&
                styles.modalButtonDisabled,
            ]}
          >
            {activationLoading ? (
              <ActivityIndicator color="#fff8e8" size="small" />
            ) : (
              <Text style={styles.modalPrimaryButtonText}>Guardar</Text>
            )}
          </Pressable>
        </View>
      </View>
    );

    return (
      <Modal
        visible={activationModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeActivationModal}
      >
        <SafeAreaView style={styles.modalContainer}>
          {activationStep === "front" && renderFrontStep()}
          {activationStep === "front_review" && renderFrontReviewStep()}
          {activationStep === "back" && renderBackStep()}
          {activationStep === "back_review" && renderBackReviewStep()}
          {activationStep === "signature" && renderSignatureStep()}
          {activationStep === "summary" && renderSummaryStep()}
        </SafeAreaView>
      </Modal>
    );
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
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
              <Text style={styles.kicker}>Hospedaje y Alimentos FIC</Text>
              <Text style={styles.title}>
                Hola, {profile?.nombre_completo || "cliente"}
              </Text>
              <Text style={styles.body}>
                de cuyo nombre no quiero acordarme...
              </Text>
            </View>
            <View style={styles.bannerActions}>
              <Pressable
                accessibilityLabel="Refrescar pantalla"
                accessibilityRole="button"
                disabled={refreshDisabled}
                onPress={handleRefreshScreen}
                style={({ pressed }) => [
                  styles.headerIconButton,
                  refreshDisabled && styles.headerIconButtonDisabled,
                  pressed && styles.pressed,
                ]}
              >
                {manualRefreshing ? (
                  <ActivityIndicator color="#fff8e8" size="small" />
                ) : (
                  <IconSymbol
                    color="#fff8e8"
                    name="arrow.clockwise"
                    size={22}
                  />
                )}
              </Pressable>
              <Pressable
                accessibilityLabel="Cerrar sesión"
                accessibilityRole="button"
                onPress={handleLogout}
                style={({ pressed }) => [
                  styles.headerIconButton,
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
              {paymentRequest && paymentRequest.status === "pending" ? (
                <View style={styles.timeoutContainer}>
                  <Text style={styles.timeoutLabel}>
                    Tiempo restante para aprobar
                  </Text>
                  <Text style={styles.timeoutValue}>
                    {paymentTimeoutSeconds}s
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {paymentActionMessage ? (
            <Text style={styles.paymentMessage}>{paymentActionMessage}</Text>
          ) : null}

          {activeTab === "datos" ? (
            <View style={styles.panel}>
              <View style={styles.balanceGrid}>
                <View style={styles.balancePanel}>
                  <Text style={styles.balanceLabel}>Saldo disponible</Text>
                  <Text style={styles.balanceValue}>
                    {displayedBalance === null
                      ? "Consultando..."
                      : `$${formatBalance(displayedBalance)}`}
                  </Text>
                </View>
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
                value={"FIC-" + String(session?.user.id_usuario || "") + "-QR"}
              />

              <View style={styles.consumoSection}>
                <Text style={styles.consumoSectionTitle}>Consumo diario</Text>
                {dailyConsumptionLoading ? (
                  <ActivityIndicator color="#0f766e" size="small" />
                ) : dailyConsumptionError ? (
                  <Text style={styles.warning}>{dailyConsumptionError}</Text>
                ) : dailyConsumption.length === 0 ? (
                  <Text style={styles.emptyText}>
                    Sin consumo registrado hoy.
                  </Text>
                ) : (
                  dailyConsumption.map((item, index) => (
                    <View key={`consumo-${index}`} style={styles.consumoItem}>
                      <Text style={styles.consumoItemName}>
                        {item.establecimiento}
                      </Text>
                      <Text style={styles.consumoItemTotal}>
                        ${item.total_gastado.toFixed(2)}
                      </Text>
                    </View>
                  ))
                )}
              </View>

              {profileLoading ? <ActivityIndicator color="#0f766e" /> : null}
              {profileError ? (
                <Text style={styles.warning}>{profileError}</Text>
              ) : null}
            </View>
          ) : null}

          {activeTab === "establecimientos" ? (
            <View style={styles.panel}>
              <TextInput
                accessibilityLabel="Buscar establecimiento FIC"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setEstablecimientosSearch}
                placeholder="Buscar establecimiento"
                placeholderTextColor="#9b876a"
                style={styles.searchInput}
                value={establecimientosSearch}
              />

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

              {!establecimientosLoading &&
              !establecimientosError &&
              establecimientos.length > 0 &&
              filteredEstablecimientos.length === 0 ? (
                <Text style={styles.emptyText}>
                  No se encontraron establecimientos con esa búsqueda.
                </Text>
              ) : null}

              {filteredEstablecimientos.map((item, index) => (
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
                  disabled={
                    activationLoading || qrActivo || activationSubmitted
                  }
                  onPress={handleStartActivation}
                  style={({ pressed }) => [
                    styles.activationButton,
                    pressed && styles.pressed,
                    (activationLoading || qrActivo || activationSubmitted) &&
                      styles.mapButtonDisabled,
                  ]}
                >
                  <IconSymbol
                    color="#fff8e8"
                    name="qrcode.viewfinder"
                    size={20}
                  />
                  <Text style={styles.activationButtonText}>
                    {qrActivo
                      ? "QR activado"
                      : activationSubmitted
                        ? "Activación enviada"
                        : "Activar QR"}
                  </Text>
                </Pressable>

                {activationError && !activationModalVisible ? (
                  <Text style={styles.warning}>{activationError}</Text>
                ) : null}
                {activationMessage && !activationModalVisible ? (
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

      {renderActivationModal()}
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
    paddingBottom: 40,
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
  bannerActions: {
    gap: 8,
  },
  headerIconButton: {
    alignItems: "center",
    backgroundColor: "#CD1125",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  headerIconButtonDisabled: {
    opacity: 0.62,
  },
  pressed: {
    opacity: 0.72,
  },
  medallion: {
    alignItems: "center",
    backgroundColor: "#CD1125",
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
    color: "#CD1125",
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
    backgroundColor: "#CD1125",
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
    backgroundColor: "#CD1125",
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
    color: "#CD1125",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  balanceGrid: {
    gap: 8,
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
    color: "#CD1125",
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
    color: "#CD1125",
    fontSize: 14,
    lineHeight: 20,
  },
  emptyText: {
    color: "#6f5639",
    fontSize: 15,
    lineHeight: 22,
  },
  searchInput: {
    backgroundColor: "#fff8e8",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    color: "#24160f",
    fontSize: 16,
    minHeight: 46,
    paddingHorizontal: 14,
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
  activationMessage: {
    color: "#15803d",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#CD1125",
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
  modalContainer: {
    flex: 1,
    backgroundColor: "#f3ead5",
    paddingTop: Platform.OS === "ios" ? 0 : 0,
  },
  modalStepContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
    justifyContent: "center",
    paddingTop: Platform.OS === "ios" ? 40 : 20,
  },
  modalHeader: {
    paddingTop: 4,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  modalTitle: {
    color: "#24160f",
    fontSize: 20,
    fontWeight: "900",
  },
  modalSubtitle: {
    color: "#6f5639",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  modalCameraContainer: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#24160f",
    height: SCREEN_HEIGHT * 0.45,
    width: "100%",
    alignSelf: "center",
  },
  cameraView: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  cameraLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#24160f",
  },
  modalReviewContainer: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#e7d7b5",
    height: SCREEN_HEIGHT * 0.35,
    width: "100%",
    alignSelf: "center",
  },
  modalReviewImage: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
  modalSignatureContainer: {
    backgroundColor: "#fff8e8",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#3b2619",
    height: SCREEN_HEIGHT * 0.35,
    width: "100%",
    alignSelf: "center",
  },
  modalSignatureCanvas: {
    width: "100%",
    height: "100%",
  },
  modalSignaturePreview: {
    width: "100%",
    height: "100%",
    borderRadius: 8,
    backgroundColor: "#fff8e8",
  },
  modalActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 8,
    paddingBottom: Platform.OS === "ios" ? 20 : 12,
    justifyContent: "center",
    marginHorizontal: 4,
  },
  modalPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#CD1125",
    borderColor: "#6f141f",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 24,
    flex: 1,
    minWidth: 100,
  },
  modalPrimaryButtonText: {
    color: "#fff8e8",
    fontSize: 15,
    fontWeight: "900",
  },
  modalSecondaryButton: {
    alignItems: "center",
    backgroundColor: "#fff8e8",
    borderColor: "#CD1125",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
    flex: 1,
    minWidth: 80,
  },
  modalSecondaryButtonText: {
    color: "#CD1125",
    fontSize: 14,
    fontWeight: "800",
  },
  modalCancelButton: {
    borderColor: "#6f5639",
    flex: 0.6,
  },
  modalRetakeButton: {
    borderColor: "#6f5639",
    flex: 0.6,
  },
  modalBackButton: {
    borderColor: "#6f5639",
  },
  modalClearButton: {
    borderColor: "#6f5639",
    flex: 0.5,
  },
  modalSaveButton: {
    backgroundColor: "#15803d",
    borderColor: "#166534",
    flex: 1,
  },
  modalButtonDisabled: {
    opacity: 0.5,
  },
  modalError: {
    color: "#CD1125",
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 4,
    textAlign: "center",
  },
  modalSuccess: {
    color: "#15803d",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
    paddingVertical: 4,
    textAlign: "center",
  },
  modalSummaryScroll: {
    flex: 1,
    paddingHorizontal: 4,
    maxHeight: SCREEN_HEIGHT * 0.45,
  },
  modalSummaryLabel: {
    color: "#24160f",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 6,
  },
  modalSummaryImage: {
    width: "100%",
    height: SCREEN_HEIGHT * 0.2,
    borderRadius: 10,
    backgroundColor: "#e7d7b5",
    marginBottom: 8,
    resizeMode: "contain",
  },
  modalSummarySignature: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
  modalSummarySignatureWrapper: {
    width: "100%",
    height: SCREEN_HEIGHT * 0.15,
    backgroundColor: "#fff8e8",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d5a84f",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    marginBottom: 8,
  },
  modalSummarySignaturePlaceholder: {
    color: "#6f5639",
    fontSize: 14,
    textAlign: "center",
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "column",
  },
  overlayTop: {
    height: "15%",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  overlayMiddle: {
    flexDirection: "row",
    height: CARD_FRAME_HEIGHT,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    paddingTop: 14,
  },
  overlayHint: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
    opacity: 0.85,
  },
  cardFrame: {
    width: CARD_FRAME_WIDTH,
    height: CARD_FRAME_HEIGHT,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
  },
  corner: {
    position: "absolute",
    width: 22,
    height: 22,
    borderColor: "#FFFFFF",
  },
  cornerTL: {
    top: -2,
    left: -2,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 10,
  },
  cornerTR: {
    top: -2,
    right: -2,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 10,
  },
  cornerBL: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 10,
  },
  cornerBR: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 10,
  },
  timeoutContainer: {
    alignItems: "center",
    backgroundColor: "#f9efd9",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 12,
    marginTop: 8,
  },
  timeoutLabel: {
    color: "#3b2619",
    fontSize: 14,
    fontWeight: "800",
  },
  timeoutValue: {
    color: "#CD1125",
    fontSize: 22,
    fontWeight: "900",
  },
  consumoSection: {
    backgroundColor: "#f9efd9",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  consumoSectionTitle: {
    color: "#CD1125",
    fontSize: 14,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  consumoItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#e7d7b5",
  },
  consumoItemName: {
    color: "#24160f",
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  consumoItemTotal: {
    color: "#CD1125",
    fontSize: 16,
    fontWeight: "900",
  },
});
