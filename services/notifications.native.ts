import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
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

const getApiBaseUrl = () => {
  if (!API_BASE_URL) {
    throw new Error("No esta configurado EXPO_PUBLIC_API_BASE_URL.");
  }

  return API_BASE_URL.replace(/\/$/, "");
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

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

export async function registerDeviceForPushNotifications(token: string) {
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

  await postAuthenticated("/auth/register-token", token, {
    push_token: expoPushToken,
    platform: Platform.OS,
    app_version: Constants.expoConfig?.version || "",
  });

  return expoPushToken;
}

export function observePaymentRequests(
  onPaymentRequest: (paymentRequest: PaymentRequestNotification) => void,
) {
  const showPaymentRequest = (notification: Notifications.Notification) => {
    const data = notification.request.content.data;

    if (isPaymentRequestNotification(data)) {
      onPaymentRequest(data);
    }
  };

  Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response?.notification) {
      showPaymentRequest(response.notification);
    }
  });

  const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
    showPaymentRequest(notification);
  });
  const responseSubscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      showPaymentRequest(response.notification);
    },
  );

  return () => {
    receivedSubscription.remove();
    responseSubscription.remove();
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
