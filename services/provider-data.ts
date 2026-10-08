import { SessionExpiredError } from "@/services/auth";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiResponse<T> = {
  code?: string;
  error?: boolean;
  respuesta?: string;
  data?: T;
};

type ApiListResponse = {
  code?: string;
  error?: boolean;
  respuesta?: string;
  data?: unknown[] | unknown;
};

const createApiError = (
  response: Response,
  result: ApiResponse<unknown> | ApiListResponse | null,
  responseText: string,
  fallback: string,
) => {
  const message = result?.respuesta || responseText || fallback;
  const isAuthenticationError =
    (response.status === 401 || response.status === 403) &&
    (result?.code === "SESSION_EXPIRED" ||
      result?.code === "SESSION_INVALID" ||
      /token\s+(?:inv[aá]lido|expirado|requerido)/i.test(message));

  return isAuthenticationError
    ? new SessionExpiredError()
    : new Error(message);
};

export type PaymentMethod = "app" | "nip";

export type ChargePayload = {
  qrCode: string;
  clientUserId?: number;
  clientId?: number;
  id_usuario?: number;
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
  current_balance?: number | string;
  client_user_id?: number | string;
  requiresNip?: boolean;
  supportsStatusPolling?: boolean;
  push_delivery?: {
    sent?: boolean;
    count?: number;
    rejected?: number;
    reason?: string;
    errors?: string[];
  };
};

export type ProviderEstablecimiento = {
  id_establecimiento: number;
  dsc_establecimiento: string;
  ubicacion: string;
  direccion: string;
};

export type ProviderTodayCharge = {
  id: number | string;
  transaction_id: string;
  cliente: string;
  amount: number;
  tip: number;
  total: number;
  status: string;
  created_at: string;
};

export type ProviderMovement = {
  id_pago: number;
  monto: number;
  fec_reg: string;
};

export type ProviderMovementsPage = {
  movements: ProviderMovement[];
  totalAmount: number;
  totalCount: number;
  hasMore: boolean;
};

type ProviderMovementsResponse = ApiResponse<unknown[]> & {
  summary?: {
    total_monto?: unknown;
    total_registros?: unknown;
  };
  pagination?: {
    has_more?: boolean;
  };
};

const getApiBaseUrl = () => {
  if (!API_BASE_URL) {
    throw new Error("No esta configurado EXPO_PUBLIC_API_BASE_URL.");
  }

  return API_BASE_URL.replace(/\/$/, "");
};

const getString = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);

const getNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeRow = (payload: unknown) =>
  payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};

const getTodayIsoDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const isToday = (value: unknown) => {
  const raw = getString(value);

  if (!raw) {
    return false;
  }

  return raw.slice(0, 10) === getTodayIsoDate();
};

const normalizeTodayCharge = (payload: unknown): ProviderTodayCharge => {
  const row = normalizeRow(payload);
  const amount = getNumber(row.amount ?? row.monto ?? row.subtotal);
  const tip = getNumber(row.tip ?? row.propina);
  const total = getNumber(row.total) || amount + tip;

  return {
    id: getString(row.id ?? row.id_transaction ?? row.id_transaccion) || getString(row.transaction_id),
    transaction_id: getString(row.transaction_id ?? row.folio ?? row.id_transaction ?? row.id_transaccion),
    cliente:
      getString(row.cliente) ||
      getString(row.nombre_cliente) ||
      getString(row.nombre_completo) ||
      getString(row.client_name),
    amount,
    tip,
    total,
    status: getString(row.status ?? row.estatus ?? row.estado) || "approved",
    created_at:
      getString(row.created_at) ||
      getString(row.fecha) ||
      getString(row.fecha_registro) ||
      getString(row.updated_at),
  };
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

  const responseText = await response.text();
  let result: ApiResponse<ChargeResult> | null = null;

  try {
    result = responseText ? (JSON.parse(responseText) as ApiResponse<ChargeResult>) : null;
  } catch {}

  if (!response.ok) {
    throw createApiError(
      response,
      result,
      responseText,
      `HTTP ${response.status}`,
    );
  }

  if (result?.error) {
    throw new Error(result.respuesta || "No se pudo crear el cobro.");
  }

  return result?.data || {};
}

export async function getProviderChargeStatus(
  token: string,
  transactionId: string | number,
): Promise<ChargeResult> {
  const response = await fetch(
    `${getApiBaseUrl()}/transactions/${encodeURIComponent(String(transactionId))}/status`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "X-API-Token": token,
      },
    },
  );

  const responseText = await response.text();
  let result: ApiResponse<ChargeResult> | null = null;

  try {
    result = responseText ? (JSON.parse(responseText) as ApiResponse<ChargeResult>) : null;
  } catch {}

  if (!response.ok) {
    throw createApiError(
      response,
      result,
      responseText,
      `HTTP ${response.status}`,
    );
  }

  if (result?.error) {
    throw new Error(result.respuesta || "No se pudo consultar el estatus del cobro.");
  }

  return result?.data || {};
}

export async function getProviderMovements(
  token: string,
  idEstablecimiento: number,
  limit = 50,
  offset = 0,
): Promise<ProviderMovementsPage> {
  const params = new URLSearchParams({
    idEstablecimiento: String(idEstablecimiento),
    limit: String(limit),
    offset: String(offset),
  });
  const response = await fetch(
    `${getApiBaseUrl()}/transactions/provider/movements?${params}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "X-API-Token": token,
      },
    },
  );

  const responseText = await response.text();
  let result: ProviderMovementsResponse | null = null;

  try {
    result = responseText
      ? (JSON.parse(responseText) as ProviderMovementsResponse)
      : null;
  } catch {}

  if (!response.ok) {
    throw createApiError(
      response,
      result,
      responseText,
      `HTTP ${response.status}`,
    );
  }

  if (result?.error) {
    throw new Error(result.respuesta || "No se pudieron consultar movimientos.");
  }

  const movements = (Array.isArray(result?.data) ? result.data : []).map(
    (payload): ProviderMovement => {
      const row = normalizeRow(payload);
      return {
        id_pago: getNumber(row.id_pago),
        monto: getNumber(row.monto),
        fec_reg: getString(row.fec_reg),
      };
    },
  );

  return {
    movements,
    totalAmount: getNumber(result?.summary?.total_monto),
    totalCount: getNumber(result?.summary?.total_registros),
    hasMore: Boolean(result?.pagination?.has_more),
  };
}

async function fetchProviderTodayEndpoint(
  token: string,
  providerRef: number,
  idEstablecimiento?: number,
): Promise<ProviderTodayCharge[]> {
  const params = new URLSearchParams({
    date: getTodayIsoDate(),
    providerRef: String(providerRef),
  });

  if (idEstablecimiento) {
    params.set("idEstablecimiento", String(idEstablecimiento));
  }

  const response = await fetch(`${getApiBaseUrl()}/transactions/provider/today?${params}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "X-API-Token": token,
    },
  });

  const responseText = await response.text();
  let result: ApiListResponse | null = null;

  try {
    result = responseText ? (JSON.parse(responseText) as ApiListResponse) : null;
  } catch {}

  if (!response.ok) {
    throw new Error(result?.respuesta || responseText || `HTTP ${response.status}`);
  }

  if (result?.error) {
    throw new Error(result.respuesta || "No se pudieron consultar consumos.");
  }

  return (Array.isArray(result?.data) ? result.data : []).map(normalizeTodayCharge);
}

async function fetchProviderTodayFromTable(
  token: string,
  providerRef: number,
  idEstablecimiento?: number,
): Promise<ProviderTodayCharge[]> {
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
        tabla: "transactions",
        where: {
          ...(idEstablecimiento ? { id_establecimiento: idEstablecimiento } : {}),
          no_proveedor: providerRef,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const result = (await response.json()) as ApiListResponse;

  if (result.error) {
    throw new Error(result.respuesta || "No se pudieron consultar consumos.");
  }

  return (Array.isArray(result.data) ? result.data : [])
    .filter((row) => {
      const normalized = normalizeRow(row);
      return isToday(
        normalized.created_at ||
          normalized.fecha ||
          normalized.fecha_registro ||
          normalized.updated_at,
      );
    })
    .map(normalizeTodayCharge);
}

export async function getProviderTodayCharges(
  token: string,
  providerRef: number,
  idEstablecimiento?: number,
): Promise<ProviderTodayCharge[]> {
  try {
    return await fetchProviderTodayEndpoint(token, providerRef, idEstablecimiento);
  } catch {
    return fetchProviderTodayFromTable(token, providerRef, idEstablecimiento);
  }
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
