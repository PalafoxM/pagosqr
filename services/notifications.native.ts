import Constants from "expo-constants";
import { Platform } from "react-native";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

export type PaymentRequestNotification = {
  type?: string;
  transactionId?: number | string;
  amount?: number;
  tip?: number;
  total?: number;
  vendorId?: number;
  vendorName?: string;
  description?: string;
  status?: string;
};

export type NotificationInteractionSource = "received" | "response";

export type PaymentApprovalResponse = {
  status?: "approved";
  current_balance?: number | string;
  transaction?: {
    id?: number | string;
    transaction_id?: string;
    amount?: number | string;
    tip?: number | string;
    total?: number | string;
    payment_id?: number | string;
  };
};
type NotificationRow = {
  id_notification?: number;
  id?: number;
  tipo?: string;
  data_json?: string | Record<string, unknown>;
  data?: Record<string, unknown>;
};

type ApiResponse<T> = {
  error?: boolean;
  respuesta?: string;
  data?: T;
};

type NotificationsModule = typeof import("expo-notifications");
type NotificationPayload = {
  request: {
    content: {
      data?: unknown;
    };
  };
};

const isExpoGoAndroid = Constants.appOwnership === "expo" && Platform.OS === "android";
let notificationHandlerConfigured = false;
let lastHandledNotificationResponseKey = "";
let expoGoAndroidWarningShown = false;

const getExpoProjectId = () =>
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
  Constants.expoConfig?.extra?.eas?.projectId ||
  Constants.easConfig?.projectId ||
  "";

const getApiBaseUrl = () => {
  if (!API_BASE_URL) {
    throw new Error("No esta configurado EXPO_PUBLIC_API_BASE_URL.");
  }

  return API_BASE_URL.replace(/\/$/, "");
};

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (isExpoGoAndroid) {
    if (!expoGoAndroidWarningShown) {
      console.warn(
        "[notifications] Expo Go en Android no soporta push remoto desde SDK 53; usa development build o build instalada.",
      );
      expoGoAndroidWarningShown = true;
    }

    return null;
  }

  const Notifications = await import("expo-notifications");

  if (!notificationHandlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    notificationHandlerConfigured = true;
  }

  return Notifications;
}

export const isPaymentRequestNotification = (
  data: unknown,
): data is PaymentRequestNotification => {
  const payload = data && typeof data === "object" ? (data as PaymentRequestNotification) : {};

  return payload.type === "PAYMENT_REQUEST" && Boolean(payload.transactionId);
};

const getNotificationResponseKey = (notification: NotificationPayload) => {
  const data = notification.request.content.data;
  const payload = data && typeof data === "object" ? (data as PaymentRequestNotification) : {};

  return [
    payload.type || "",
    payload.transactionId || "",
    payload.total || "",
    payload.vendorId || "",
  ].join(":");
};

const normalizePaymentRequestFromRow = (row: NotificationRow): PaymentRequestNotification | null => {
  let data: unknown = row.data || row.data_json;

  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }

  if (isPaymentRequestNotification(data)) {
    const status = String(data.status || "").toLowerCase();

    if (status && !["pending", "pendiente"].includes(status)) {
      return null;
    }

    return data;
  }

  return null;
};

async function postAuthenticated<T>(
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-API-Token": token,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const result = (await response.json()) as ApiResponse<T>;

  if (result.error) {
    throw new Error(result.respuesta || "La API devolvio un error.");
  }

  return result.data as T;
}

async function getAuthenticated<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "X-API-Token": token,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const result = (await response.json()) as ApiResponse<T>;

  if (result.error) {
    throw new Error(result.respuesta || "La API devolvio un error.");
  }

  return result.data as T;
}

async function savePushToken(token: string, expoPushToken: string) {
  const payload = {
    push_token: expoPushToken,
    platform: Platform.OS,
    app_version: Constants.expoConfig?.version || "",
  };

  console.log("[notifications] savePushToken inicio", {
    platform: payload.platform,
    appVersion: payload.app_version,
    tokenPreview: `${expoPushToken.slice(0, 18)}...`,
  });

  try {
    const result = await postAuthenticated("/auth/register-token", token, payload);
    console.log("[notifications] savePushToken /auth/register-token ok", result);
    return result;
  } catch (authError) {
    console.warn("[notifications] /auth/register-token fallo, intentando fallback", authError);
    const result = await postAuthenticated("/notifications/register-token", token, payload);
    console.log("[notifications] savePushToken fallback ok", result);
    return result;
  }
}

export async function registerPushToken(token: string) {
  console.log("[notifications] registerPushToken inicio");
  const Notifications = await loadNotifications();

  if (!Notifications) {
    console.warn("[notifications] modulo no disponible, no se registra push token");
    return null;
  }

  if (Platform.OS === "android") {
    console.log("[notifications] configurando canal Android default");
    await Notifications.setNotificationChannelAsync("default", {
      name: "Pagos FIC",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#8f1d2c",
    });
  }

  const currentPermissions = await Notifications.getPermissionsAsync();
  let finalStatus = currentPermissions.status;
  console.log("[notifications] permisos actuales", currentPermissions);

  if (finalStatus !== "granted") {
    const requestedPermissions = await Notifications.requestPermissionsAsync();
    finalStatus = requestedPermissions.status;
    console.log("[notifications] permisos solicitados", requestedPermissions);
  }

  if (finalStatus !== "granted") {
    console.warn("[notifications] permisos no concedidos", { finalStatus });
    return null;
  }

  const projectId = getExpoProjectId();
  console.log("[notifications] projectId", {
    projectId: projectId || null,
    hasEnvProjectId: Boolean(process.env.EXPO_PUBLIC_EAS_PROJECT_ID),
    hasExpoConfigProjectId: Boolean(Constants.expoConfig?.extra?.eas?.projectId),
    hasEasConfigProjectId: Boolean(Constants.easConfig?.projectId),
  });

  if (!projectId) {
    console.warn(
      "[notifications] falta EXPO_PUBLIC_EAS_PROJECT_ID; no se puede obtener Expo Push Token.",
    );
    return null;
  }

  const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  console.log("[notifications] expoPushToken obtenido", {
    tokenPreview: `${expoPushToken.slice(0, 18)}...`,
  });

  await savePushToken(token, expoPushToken);

  return expoPushToken;
}

export const registerDeviceForPushNotifications = registerPushToken;

export const shouldUseInAppPaymentPolling = () => Platform.OS === "android";

export async function getPaymentRequestNotifications(token: string) {
  const rows = await getAuthenticated<NotificationRow[]>("/notifications/my-notifications", token);

  return (rows || [])
    .map(normalizePaymentRequestFromRow)
    .filter((item): item is PaymentRequestNotification => Boolean(item));
}

export function observePaymentRequests(
  onPaymentRequest: (
    paymentRequest: PaymentRequestNotification,
    source: NotificationInteractionSource,
  ) => void,
) {
  console.log("[notifications] observePaymentRequests iniciado");
  let cleanup = () => {};
  let disposed = false;

  const showPaymentRequest = (
    notification: NotificationPayload,
    source: NotificationInteractionSource,
  ) => {
    const data = notification.request.content.data;
    console.log("[notifications] notificacion recibida", data);

    if (isPaymentRequestNotification(data)) {
      onPaymentRequest(data, source);
    }
  };

  loadNotifications()
    .then((Notifications) => {
      if (!Notifications || disposed) {
        return;
      }

      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response?.notification) {
          const responseKey = getNotificationResponseKey(response.notification);

          if (responseKey && responseKey === lastHandledNotificationResponseKey) {
            console.log("[notifications] ultima respuesta ya procesada", response.notification.request.content.data);
            return;
          }

          lastHandledNotificationResponseKey = responseKey;
          console.log("[notifications] ultima respuesta de notificacion", response.notification.request.content.data);
          showPaymentRequest(response.notification, "response");
        }
      });

      const receivedSubscription = Notifications.addNotificationReceivedListener(
        (notification) => {
          console.log("[notifications] listener received", notification.request.content.data);
          showPaymentRequest(notification, "received");
        },
      );
      const responseSubscription = Notifications.addNotificationResponseReceivedListener(
        (response) => {
          const responseKey = getNotificationResponseKey(response.notification);

          if (responseKey && responseKey === lastHandledNotificationResponseKey) {
            console.log("[notifications] respuesta ya procesada", response.notification.request.content.data);
            return;
          }

          lastHandledNotificationResponseKey = responseKey;
          console.log("[notifications] listener response", response.notification.request.content.data);
          showPaymentRequest(response.notification, "response");
        },
      );

      cleanup = () => {
        receivedSubscription.remove();
        responseSubscription.remove();
      };

      if (disposed) {
        cleanup();
      }
    })
    .catch(() => {
      if (!disposed) {
        cleanup = () => {};
      }
    });

  return () => {
    disposed = true;
    cleanup();
  };
}

export async function approvePaymentRequest(token: string, transactionId: string | number) {
  return postAuthenticated<PaymentApprovalResponse>("/transactions/approve", token, {
    transactionId,
  });
}

export async function rejectPaymentRequest(token: string, transactionId: string | number) {
  return postAuthenticated("/transactions/reject", token, {
    transactionId,
  });
}
