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
  monto_deposito_hotel: string;
  tarifa_noche: string;
  tiene_alimentos: number;
  tiene_hospedaje: number;
  activo_qr: number;
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

const decodeDisplayText = (value: unknown) => {
  const entities: Record<string, string> = {
    aacute: "á",
    eacute: "é",
    iacute: "í",
    oacute: "ó",
    uacute: "ú",
    ntilde: "ñ",
    Aacute: "Á",
    Eacute: "É",
    Iacute: "Í",
    Oacute: "Ó",
    Uacute: "Ú",
    Ntilde: "Ñ",
    amp: "&",
  };

  return getString(value)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (match, entity) => entities[entity] || match)
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
};

const getNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getFlag = (value: unknown, fallback: number) =>
  value === null || value === undefined || value === "" ? fallback : getNumber(value);

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
    monto_deposito_hotel: rows[0]?.monto_deposito_hotel,
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
    monto_deposito_hotel: row.monto_deposito_hotel,
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
  monto_deposito_hotel: session.user.monto_deposito_hotel,
  tarifa_noche: session.user.tarifa_noche,
  tiene_alimentos: getFlag(session.user.tiene_alimentos, 1),
  tiene_hospedaje: getFlag(session.user.tiene_hospedaje, 0),
  activo_qr: getFlag(session.user.activo_qr, 0),
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
      monto_deposito_hotel: row.monto_deposito_hotel,
      tarifa_noche: row.tarifa_noche,
      tiene_alimentos: row.tiene_alimentos,
      tiene_hospedaje: row.tiene_hospedaje,
      activo_qr: row.activo_qr,
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
      monto_hotel_usuario: userRows[0]?.monto_deposito_hotel,
      monto_final: row.monto_deposito,
    });
  }

  const tieneAlimentos = getFlag(row.tiene_alimentos, getFlag(session.user.tiene_alimentos, 1));
  const tieneHospedaje = getFlag(row.tiene_hospedaje, getFlag(session.user.tiene_hospedaje, 0));
  const activoQr = getFlag(row.activo_qr, getFlag(session.user.activo_qr, 0));
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
    monto_deposito_hotel:
      getString(row.monto_deposito_hotel) ||
      getString(row.monto_hotel) ||
      session.user.monto_deposito_hotel,
    tarifa_noche:
      getString(row.tarifa_noche) ||
      getString(row.tarifa_hotel) ||
      session.user.tarifa_noche,
    tiene_alimentos: tieneAlimentos,
    tiene_hospedaje: tieneHospedaje,
    activo_qr: activoQr,
    qr: getString(row.qr) || getString(row.codigo_qr) || session.user.qr,
  };

  logSaldo("perfil final", {
    id_usuario: session.user.id_usuario,
    monto_deposito: profile.monto_deposito,
    monto_deposito_hotel: profile.monto_deposito_hotel,
    tarifa_noche: profile.tarifa_noche,
    tiene_alimentos: profile.tiene_alimentos,
    tiene_hospedaje: profile.tiene_hospedaje,
    activo_qr: profile.activo_qr,
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
    dsc_establecimiento: decodeDisplayText(row.dsc_establecimiento),
    ubicacion: decodeDisplayText(row.ubicacion),
    direccion: decodeDisplayText(row.direccion),
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
