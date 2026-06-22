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

export async function registerPushToken(_token: string) {
  return null;
}

export const registerDeviceForPushNotifications = registerPushToken;

export const shouldUseInAppPaymentPolling = () => false;

export async function getPaymentRequestNotifications(_token: string) {
  return [] as PaymentRequestNotification[];
}

export function observePaymentRequests(
  _onPaymentRequest: (
    paymentRequest: PaymentRequestNotification,
    source: NotificationInteractionSource,
  ) => void,
) {
  return () => {};
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
