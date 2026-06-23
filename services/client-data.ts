import { AuthSession } from "@/services/auth";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiListResponse = {
  error?: boolean;
  respuesta?: string;
  data?: unknown[];
};

export type ClienteProfile = {
  nombre_completo: string;
  nip: string;
  monto_deposito: string;
  qr: string;
};

export type EstablecimientoFic = {
  id_establecimiento: number;
  dsc_establecimiento: string;
  ubicacion: string;
  direccion: string;
};

export type ClienteQrAccess = {
  qr_url: string;
  expires_in_seconds: number;
  expires_at: string | null;
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
  payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};

async function fetchRows(
  table: string,
  where: Record<string, unknown>,
  token: string,
): Promise<Record<string, unknown>[]> {
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
        tabla: table,
        where,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const result = (await response.json()) as ApiListResponse;

  if (result.error) {
    throw new Error(result.respuesta || "La API devolvio un error.");
  }

  return (result.data || []).map(normalizeRow);
}

async function fetchAuthenticated<T>(path: string, token: string): Promise<T> {
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

  const result = (await response.json()) as ApiListResponse;

  if (result.error) {
    throw new Error(result.respuesta || "La API devolvio un error.");
  }

  return result.data?.[0] as T;
}

export const getFallbackClienteProfile = (session: AuthSession): ClienteProfile => ({
  nombre_completo: session.user.nombre,
  nip: session.user.nip,
  monto_deposito: session.user.monto_deposito,
  qr: session.user.qr,
});

export async function getClienteProfile(session: AuthSession): Promise<ClienteProfile> {
  const rows = await fetchRows(
    "vw_usuario",
    { id_usuario: session.user.id_usuario, id_perfil: 3 },
    session.token,
  );
  const row = rows[0] || {};

  return {
    nombre_completo:
      getString(row.nombre_completo) || getString(row.nombre) || session.user.nombre,
    nip: getString(row.nip) || session.user.nip,
    monto_deposito:
      getString(row.monto_deposito) ||
      getString(row.monto) ||
      session.user.monto_deposito,
    qr: getString(row.qr) || getString(row.codigo_qr) || session.user.qr,
  };
}

export async function getEstablecimientosFic(token: string): Promise<EstablecimientoFic[]> {
  const rows = await fetchRows("establecimiento", { id_tipo: 1, visible: 1 }, token);

  return rows.map((row) => ({
    id_establecimiento: getNumber(row.id_establecimiento ?? row.id),
    dsc_establecimiento: getString(row.dsc_establecimiento),
    ubicacion: getString(row.ubicacion),
    direccion: getString(row.direccion),
  }));
}

export async function getClienteQrAccess(token: string): Promise<ClienteQrAccess> {
  return fetchAuthenticated<ClienteQrAccess>("/cliente/qr-url", token);
}
