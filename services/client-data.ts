import { AuthSession } from "@/services/auth";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiListResponse = {
  error?: boolean;
  respuesta?: string;
  data?: unknown[] | unknown;
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

export type ActivateQrPayload = {
  ine_frontal: string;
  ine_trasera: string;
  firma: string;
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

const logSaldo = (message: string, details?: Record<string, unknown>) => {
  console.log(`[cliente:saldo] ${message}`, details || {});
};

const normalizeRow = (payload: unknown) =>
  payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};

const readApiError = async (response: Response, fallback: string) => {
  const text = await response.text();

  try {
    const result = JSON.parse(text) as ApiListResponse;
    return result.respuesta || fallback;
  } catch {
    return text || fallback;
  }
};

async function fetchRows(
  table: string,
  where: Record<string, unknown>,
  token: string,
): Promise<Record<string, unknown>[]> {
  logSaldo("getTabla inicio", { table, where });

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
    const message = await readApiError(response, `HTTP ${response.status}`);
    logSaldo("getTabla error http", { table, status: response.status, message });
    throw new Error(message);
  }

  const result = (await response.json()) as ApiListResponse;

  if (result.error) {
    const message = result.respuesta || "La API devolvio un error.";
    logSaldo("getTabla error api", { table, message });
    throw new Error(message);
  }

  const rows = (Array.isArray(result.data) ? result.data : []).map(normalizeRow);
  logSaldo("getTabla ok", {
    table,
    rows: rows.length,
    monto_deposito: rows[0]?.monto_deposito,
  });

  return rows;
}

async function fetchAuthenticated<T>(path: string, token: string): Promise<T> {
  logSaldo("GET inicio", { path });

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "X-API-Token": token,
    },
  });

  if (!response.ok) {
    const message = await readApiError(response, `HTTP ${response.status}`);
    logSaldo("GET error http", { path, status: response.status, message });
    throw new Error(message);
  }

  const result = (await response.json()) as ApiListResponse;

  if (result.error) {
    const message = result.respuesta || "La API devolvio un error.";
    logSaldo("GET error api", { path, message });
    throw new Error(message);
  }

  const data = (Array.isArray(result.data) ? result.data?.[0] : result.data) as T;
  const row = normalizeRow(data);
  logSaldo("GET ok", {
    path,
    monto_deposito: row.monto_deposito,
    id_usuario: row.id_usuario,
  });

  return data;
}

export const getFallbackClienteProfile = (
  session: AuthSession,
): ClienteProfile => ({
  nombre_completo: session.user.nombre,
  nip: session.user.nip,
  monto_deposito: session.user.monto_deposito,
  qr: session.user.qr,
});

export async function getClienteProfile(
  session: AuthSession,
): Promise<ClienteProfile> {
  let row: Record<string, unknown> = {};

  logSaldo("perfil inicio", {
    id_usuario: session.user.id_usuario,
    monto_sesion: session.user.monto_deposito,
  });

  try {
    row = normalizeRow(await fetchAuthenticated<unknown>("/cliente/profile", session.token));

    const responseUserId = getNumber(row.id_usuario);
    if (responseUserId !== session.user.id_usuario) {
      throw new Error(
        `Respuesta de /cliente/profile sin id_usuario valido. Recibido: ${responseUserId || "vacio"}`,
      );
    }

    logSaldo("perfil via endpoint", {
      id_usuario: row.id_usuario,
      monto_deposito: row.monto_deposito,
    });
  } catch (endpointError) {
    logSaldo("perfil endpoint fallo, usando fallback", {
      error:
        endpointError instanceof Error
          ? endpointError.message
          : String(endpointError),
    });

    const userRows = await fetchRows(
      "usuario",
      { id_usuario: session.user.id_usuario, visible: 1 },
      session.token,
    );
    const profileRows = await fetchRows(
      "vw_usuario",
      { id_usuario: session.user.id_usuario, id_perfil: 3 },
      session.token,
    );

    row = {
      ...(profileRows[0] || {}),
      ...(userRows[0] || {}),
    };

    logSaldo("perfil fallback combinado", {
      monto_vw: profileRows[0]?.monto_deposito,
      monto_usuario: userRows[0]?.monto_deposito,
      monto_final: row.monto_deposito,
    });
  }

  const profile = {
    nombre_completo:
      getString(row.nombre_completo) ||
      getString(row.nombre) ||
      session.user.nombre,
    nip: getString(row.nip) || session.user.nip,
    monto_deposito:
      getString(row.monto_deposito) ||
      getString(row.monto) ||
      session.user.monto_deposito,
    qr: getString(row.qr) || getString(row.codigo_qr) || session.user.qr,
  };

  logSaldo("perfil final", {
    id_usuario: session.user.id_usuario,
    monto_deposito: profile.monto_deposito,
  });

  return profile;
}

export async function getEstablecimientosFic(
  token: string,
): Promise<EstablecimientoFic[]> {
  const rows = await fetchRows(
    "establecimiento",
    { id_tipo: 1, visible: 1 },
    token,
  );

  return rows.map((row) => ({
    id_establecimiento: getNumber(row.id_establecimiento ?? row.id),
    dsc_establecimiento: getString(row.dsc_establecimiento),
    ubicacion: getString(row.ubicacion),
    direccion: getString(row.direccion),
  }));
}

export async function getClienteQrAccess(
  token: string,
): Promise<ClienteQrAccess> {
  return fetchAuthenticated<ClienteQrAccess>("/cliente/qr-url", token);
}

export async function activateClienteQr(
  token: string,
  payload: ActivateQrPayload,
) {
  const response = await fetch(`${getApiBaseUrl()}/cliente/activar-qr`, {
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
    throw new Error(await readApiError(response, `HTTP ${response.status}`));
  }

  const result = (await response.json()) as ApiListResponse;

  if (result.error) {
    throw new Error(result.respuesta || "No se pudo guardar la activacion QR.");
  }

  return result.data;
}
