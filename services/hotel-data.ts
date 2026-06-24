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
};

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
    };

    if (
      payload.tipo === "PAGOS_FIC_CLIENTE" &&
      Number(payload.id_perfil) === 3 &&
      Number(payload.id_usuario) > 0
    ) {
      return {
        id_usuario: Number(payload.id_usuario),
        nombre_completo: String(payload.nombre_completo || ""),
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
