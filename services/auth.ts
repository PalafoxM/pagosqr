import * as SecureStore from "expo-secure-store";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
const SESSION_TOKEN_KEY = "pagosfic.session.token";
const SESSION_USER_KEY = "pagosfic.session.user";
const ALLOWED_PROFILE_IDS = new Set([2, 3]);

export type AuthUser = {
  id_usuario: number;
  id_perfil: number;
  usuario: string;
  nombre: string;
  id_establecimiento: number;
  no_proveedor: number;
  nip: string;
  monto_deposito: string;
  qr: string;
  api_token: string;
  raw?: Record<string, unknown>;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

type ApiLoginResponse = {
  error?: boolean;
  respuesta?: string;
  data?: unknown[];
};

type StoredAuthUser = Omit<AuthUser, "api_token" | "raw">;

const getString = (value: unknown) => (typeof value === "string" ? value : "");

const getNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeUser = (payload: unknown): AuthUser => {
  const row =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const id_usuario = getNumber(row.id_usuario ?? row.id);
  const id_perfil = getNumber(row.id_perfil);
  const nombre =
    getString(row.nombre_completo) ||
    getString(row.nombre) ||
    getString(row.usuario);
  const monto_deposito =
    getString(row.monto_deposito) || getString(row.monto) || getString(row.deposito);
  const qr =
    getString(row.qr) ||
    getString(row.codigo_qr) ||
    getString(row.qr_codigo_qr);
  const api_token = getString(row.api_token);

  return {
    id_usuario,
    id_perfil,
    usuario: getString(row.usuario),
    nombre,
    id_establecimiento: getNumber(row.id_establecimiento),
    no_proveedor: getNumber(row.no_proveedor),
    nip: getString(row.nip),
    monto_deposito,
    qr,
    api_token,
    raw: row,
  };
};

const getLoginUrl = () => {
  if (!API_BASE_URL) {
    throw new Error("No esta configurado EXPO_PUBLIC_API_BASE_URL.");
  }

  return `${API_BASE_URL.replace(/\/$/, "")}/login`;
};

export async function login(
  usuario: string,
  contrasenia: string,
): Promise<AuthSession> {
  const response = await fetch(getLoginUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: {
        where: {
          usuario: usuario.trim(),
          contrasenia,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`No se pudo conectar con la API. HTTP ${response.status}`);
  }

  const result = (await response.json()) as ApiLoginResponse;

  if (result.error) {
    throw new Error(result.respuesta || "Usuario o contrasenia incorrectos.");
  }

  const user = normalizeUser(result.data?.[0]);

  if (!user.api_token) {
    throw new Error("La API no devolvio token de sesion.");
  }

  if (!ALLOWED_PROFILE_IDS.has(user.id_perfil)) {
    throw new Error("Este usuario no tiene permiso para entrar a la app.");
  }

  const session = { token: user.api_token, user };
  await saveSession(session);
  return session;
}

export async function saveSession(session: AuthSession) {
  const user: StoredAuthUser = {
    id_usuario: session.user.id_usuario,
    id_perfil: session.user.id_perfil,
    usuario: session.user.usuario,
    nombre: session.user.nombre,
    id_establecimiento: session.user.id_establecimiento,
    no_proveedor: session.user.no_proveedor,
    nip: session.user.nip,
    monto_deposito: session.user.monto_deposito,
    qr: session.user.qr,
  };

  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, session.token);
  await SecureStore.setItemAsync(SESSION_USER_KEY, JSON.stringify(user));
}

export async function getStoredSession(): Promise<AuthSession | null> {
  const [token, userJson] = await Promise.all([
    SecureStore.getItemAsync(SESSION_TOKEN_KEY),
    SecureStore.getItemAsync(SESSION_USER_KEY),
  ]);

  if (!token || !userJson) {
    return null;
  }

  try {
    const user = JSON.parse(userJson) as StoredAuthUser;
    if (!isAllowedProfile(user.id_perfil)) {
      await clearSession();
      return null;
    }

    return { token, user: { ...user, api_token: token } };
  } catch {
    await clearSession();
    return null;
  }
}

export async function clearSession() {
  await Promise.all([
    SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
    SecureStore.deleteItemAsync(SESSION_USER_KEY),
  ]);
}

export function getHomePathForProfile(profileId: number) {
  if (profileId === 2) {
    return "/proveedor";
  }

  if (profileId === 3) {
    return "/cliente";
  }

  return null;
}

export function isAllowedProfile(profileId: number) {
  return ALLOWED_PROFILE_IDS.has(profileId);
}
