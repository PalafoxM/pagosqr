const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiResponse<T> = {
  error?: boolean;
  respuesta?: string;
  data?: T;
};


export type HotelClientQr = {
  id_usuario: number;
  nombre_completo: string;
};

export type HotelCheckInResult = {
  id_usuario?: number;
  nombre_completo?: string;
  fecha_check_in?: string;
  id_hotel_usuario?: number;
  id_establecimiento?: number;
  tarifa_noche?: number | string;
};

const isQrClientProfile = (profileId?: number) =>
  Number(profileId) > 0 && Number(profileId) !== 2 && Number(profileId) !== 7;

const getApiBaseUrl = () => {
  if (!API_BASE_URL) {
    throw new Error("No esta configurado EXPO_PUBLIC_API_BASE_URL.");
  }

  return API_BASE_URL.replace(/\/$/, "");
};


export const parseHotelClientQrPayload = (value: string): HotelClientQr | null => {
  try {
    const payload = JSON.parse(value) as {
      tipo?: string;
      id_usuario?: number;
      id_perfil?: number;
      nombre_completo?: string;
      nombre?: string;
      primer_apellido?: string;
      segundo_apellido?: string;
      usuario?: string;
    };
    const userId = Number(payload.id_usuario);
    const fullName =
      String(payload.nombre_completo || "").trim() ||
      [payload.nombre, payload.primer_apellido, payload.segundo_apellido]
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join(" ") ||
      String(payload.usuario || "").trim();

    if (
      payload.tipo === "PAGOS_FIC_CLIENTE" &&
      isQrClientProfile(Number(payload.id_perfil)) &&
      userId > 0
    ) {
      return {
        id_usuario: userId,
        nombre_completo: fullName,
      };
    }

    if (
      payload.tipo === "usuario_institucional" &&
      userId > 0
    ) {
      return {
        id_usuario: userId,
        nombre_completo: fullName,
      };
    }
  } catch {}

  return null;
};

export async function createHotelCheckIn(
  token: string,
  payload: { qrCode: string; clientUserId?: number },
): Promise<HotelCheckInResult> {
  const response = await fetch(`${getApiBaseUrl()}/hotel/check-in`, {
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
  let result: ApiResponse<HotelCheckInResult> | null = null;

  try {
    result = responseText ? (JSON.parse(responseText) as ApiResponse<HotelCheckInResult>) : null;
  } catch {}

  if (!response.ok) {
    throw new Error(result?.respuesta || responseText || `HTTP ${response.status}`);
  }

  if (result?.error) {
    throw new Error(result.respuesta || "No se pudo registrar el check-in.");
  }

  return result?.data || {};
}
