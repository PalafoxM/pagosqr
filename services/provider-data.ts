const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiResponse<T> = {
  error?: boolean;
  respuesta?: string;
  data?: T;
};

export type PaymentMethod = "app" | "nip";

export type ChargePayload = {
  qrCode: string;
  clientUserId?: number;
  amount: number;
  tip: number;
  description: string;
  paymentMethod: PaymentMethod;
  nip?: string;
  idEstablecimiento?: number;
};

export type ChargeResult = {
  id?: number;
  transaction_id?: string;
  status?: "pending" | "approved" | "rejected";
  amount?: number;
  tip?: number;
  total?: number;
  payment_id?: number;
  requiresNip?: boolean;
  supportsStatusPolling?: boolean;
};

export type ProviderEstablecimiento = {
  id_establecimiento: number;
  dsc_establecimiento: string;
  ubicacion: string;
  direccion: string;
};

const getApiBaseUrl = () => {
  if (!API_BASE_URL) {
    throw new Error("No esta configurado EXPO_PUBLIC_API_BASE_URL.");
  }

  return API_BASE_URL.replace(/\/$/, "");
};

export async function createProviderCharge(
  token: string,
  payload: ChargePayload,
): Promise<ChargeResult> {
  const response = await fetch(`${getApiBaseUrl()}/transactions/create`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-API-Token": token,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const result = (await response.json()) as ApiResponse<ChargeResult>;

  if (result.error) {
    throw new Error(result.respuesta || "No se pudo crear el cobro.");
  }

  return result.data || {};
}

export async function getProviderEstablecimientos(
  token: string,
  providerRef: number,
): Promise<ProviderEstablecimiento[]> {
  const response = await fetch(`${getApiBaseUrl()}/getTabla`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-API-Token": token,
    },
    body: JSON.stringify({
      data: {
        tabla: "establecimiento",
        where: {
          visible: 1,
          no_proveedor: providerRef,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const result = (await response.json()) as ApiResponse<ProviderEstablecimiento[]>;

  if (result.error) {
    throw new Error(result.respuesta || "No se pudieron consultar establecimientos.");
  }

  return result.data || [];
}
