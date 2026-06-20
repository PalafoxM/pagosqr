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

const getApiBaseUrl = () => {
  if (!API_BASE_URL) {
    throw new Error("No esta configurado EXPO_PUBLIC_API_BASE_URL.");
  }

  return API_BASE_URL.replace(/\/$/, "");
};

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (isExpoGoAndroid) {
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

async function savePushToken(token: string, expoPushToken: string) {
  const payload = {
    push_token: expoPushToken,
    platform: Platform.OS,
    app_version: Constants.expoConfig?.version || "",
  };

  try {
    return await postAuthenticated("/auth/register-token", token, payload);
  } catch {
    return postAuthenticated("/notifications/register-token", token, payload);
  }
}

export async function registerPushToken(token: string) {
  const Notifications = await loadNotifications();

  if (!Notifications) {
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Pagos FIC",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#8f1d2c",
    });
  }

  const currentPermissions = await Notifications.getPermissionsAsync();
  let finalStatus = currentPermissions.status;

  if (finalStatus !== "granted") {
    const requestedPermissions = await Notifications.requestPermissionsAsync();
    finalStatus = requestedPermissions.status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const expoPushToken = projectId
    ? (await Notifications.getExpoPushTokenAsync({ projectId })).data
    : (await Notifications.getExpoPushTokenAsync()).data;

  await savePushToken(token, expoPushToken);

  return expoPushToken;
}

export const registerDeviceForPushNotifications = registerPushToken;

export function observePaymentRequests(
  onPaymentRequest: (paymentRequest: PaymentRequestNotification) => void,
) {
  let cleanup = () => {};
  let disposed = false;

  const showPaymentRequest = (notification: NotificationPayload) => {
    const data = notification.request.content.data;

    if (isPaymentRequestNotification(data)) {
      onPaymentRequest(data);
    }
  };

  loadNotifications()
    .then((Notifications) => {
      if (!Notifications || disposed) {
        return;
      }

      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response?.notification) {
          showPaymentRequest(response.notification);
        }
      });

      const receivedSubscription = Notifications.addNotificationReceivedListener(
        (notification) => {
          showPaymentRequest(notification);
        },
      );
      const responseSubscription = Notifications.addNotificationResponseReceivedListener(
        (response) => {
          showPaymentRequest(response.notification);
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
  return postAuthenticated("/transactions/approve", token, {
    transactionId,
  });
}

export async function rejectPaymentRequest(token: string, transactionId: string | number) {
  return postAuthenticated("/transactions/reject", token, {
    transactionId,
  });
}
