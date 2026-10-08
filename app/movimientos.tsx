import { router, Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  AuthSession,
  clearSession,
  expireSession,
  getStoredSession,
  isFoodProviderType,
  isProviderProfile,
  isSessionExpiredError,
} from "@/services/auth";
import {
  getProviderMovements,
  ProviderMovement,
} from "@/services/provider-data";

const PAGE_SIZE = 50;
const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
});

const formatMovementDate = (value: string) => {
  if (!value) return "Fecha no disponible";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export default function MovimientosScreen() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [movements, setMovements] = useState<ProviderMovement[]>([]);
  const [totalAmount, setTotalAmount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const loadingMoreRef = useRef(false);

  const handleError = useCallback(async (caughtError: unknown) => {
    if (isSessionExpiredError(caughtError)) {
      await expireSession();
      router.replace("/");
      return;
    }

    setError(
      caughtError instanceof Error
        ? caughtError.message
        : "No se pudieron consultar los movimientos.",
    );
  }, []);

  const loadFirstPage = useCallback(
    async (currentSession: AuthSession, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      setError("");
      try {
        const page = await getProviderMovements(
          currentSession.token,
          currentSession.user.id_establecimiento,
          PAGE_SIZE,
          0,
        );
        setMovements(page.movements);
        setTotalAmount(page.totalAmount);
        setTotalCount(page.totalCount);
        setHasMore(page.hasMore);
      } catch (caughtError) {
        await handleError(caughtError);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [handleError],
  );

  useEffect(() => {
    let mounted = true;

    void getStoredSession().then(async (storedSession) => {
      if (!mounted) return;

      if (
        !storedSession ||
        !isProviderProfile(storedSession.user.id_perfil) ||
        !isFoodProviderType(storedSession.user.id_tipo_proveedor)
      ) {
        await clearSession();
        router.replace("/");
        return;
      }

      setSession(storedSession);

      if (!storedSession.user.id_establecimiento) {
        setError("No tienes un establecimiento asignado.");
        setLoading(false);
        return;
      }

      await loadFirstPage(storedSession);
    });

    return () => {
      mounted = false;
    };
  }, [loadFirstPage]);

  const handleLoadMore = useCallback(async () => {
    if (!session || !hasMore || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await getProviderMovements(
        session.token,
        session.user.id_establecimiento,
        PAGE_SIZE,
        movements.length,
      );
      setMovements((current) => [...current, ...page.movements]);
      setTotalAmount(page.totalAmount);
      setTotalCount(page.totalCount);
      setHasMore(page.hasMore);
    } catch (caughtError) {
      await handleError(caughtError);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [handleError, hasMore, movements.length, session]);

  const handleRefresh = useCallback(() => {
    if (session) void loadFirstPage(session, true);
  }, [loadFirstPage, session]);

  const renderMovement = ({ item }: { item: ProviderMovement }) => (
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <Text style={styles.date}>{formatMovementDate(item.fec_reg)}</Text>
      </View>
      <Text style={styles.amount}>{moneyFormatter.format(item.monto)}</Text>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: "Movimientos" }} />
      <FlatList
        contentContainerStyle={styles.content}
        data={movements}
        keyExtractor={(item) => String(item.id_pago)}
        onEndReached={() => void handleLoadMore()}
        onEndReachedThreshold={0.35}
        refreshControl={
          <RefreshControl
            colors={["#CD1125"]}
            onRefresh={handleRefresh}
            refreshing={refreshing}
            tintColor="#CD1125"
          />
        }
        renderItem={renderMovement}
        style={styles.screen}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.eyebrow}>Consumo acumulado</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.total}>
              {moneyFormatter.format(totalAmount)}
            </Text>
            <Text style={styles.count}>
              {totalCount} {totalCount === 1 ? "movimiento" : "movimientos"}
            </Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.state}>
              <ActivityIndicator color="#CD1125" size="large" />
              <Text style={styles.stateText}>Consultando movimientos...</Text>
            </View>
          ) : error ? (
            <View style={styles.state}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => session && void loadFirstPage(session)}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && styles.pressed,
                ]}
              >
                <IconSymbol color="#fff8e8" name="arrow.clockwise" size={20} />
                <Text style={styles.retryText}>Reintentar</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.state}>
              <Text style={styles.stateTitle}>Sin movimientos</Text>
              <Text style={styles.stateText}>
                Los pagos del restaurante aparecerán aquí.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color="#CD1125" style={styles.footerLoader} />
          ) : null
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#f3ead5" },
  content: { flexGrow: 1, gap: 10, padding: 20, paddingBottom: 36 },
  header: {
    backgroundColor: "#24160f",
    borderColor: "#d5a84f",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    padding: 20,
  },
  eyebrow: {
    color: "#d5a84f",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  total: { color: "#fff8e8", fontSize: 34, fontWeight: "900", marginTop: 8 },
  count: { color: "#d8c9ac", fontSize: 14, marginTop: 5 },
  row: {
    alignItems: "center",
    backgroundColor: "#fff8e8",
    borderBottomColor: "#d5a84f",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    minHeight: 70,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowCopy: { flex: 1, gap: 4 },
  date: { color: "#24160f", fontSize: 15, fontWeight: "700" },
  amount: { color: "#CD1125", fontSize: 17, fontWeight: "900" },
  state: { alignItems: "center", gap: 12, justifyContent: "center", padding: 36 },
  stateTitle: { color: "#24160f", fontSize: 19, fontWeight: "900" },
  stateText: { color: "#6f5639", fontSize: 14, textAlign: "center" },
  errorText: { color: "#9d1c2b", fontSize: 14, textAlign: "center" },
  retryButton: {
    alignItems: "center",
    backgroundColor: "#CD1125",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: { color: "#fff8e8", fontSize: 15, fontWeight: "900" },
  pressed: { opacity: 0.72 },
  footerLoader: { paddingVertical: 18 },
});
