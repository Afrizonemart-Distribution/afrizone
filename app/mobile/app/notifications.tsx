/**
 * The worker's notification inbox.
 *
 * This is the DURABLE side of notifications. Push is best-effort and fails
 * silently for anyone who declined the permission or whose token expired, so
 * this screen - not the push - is what a worker can actually rely on to find
 * out that their application was decided, their credential rejected or their
 * payment released. See app/server/src/services/push.ts.
 *
 * Restyled to match afrizone-mobile-prototype (1).html's Notifications list.
 * All real logic below (optimistic mark-read with rollback, mark-all, deep
 * link routing via SCREEN_ROUTES) is unchanged from the previous version.
 *
 * Rows are bespoke rather than plain AppListRow: unread notifications need a
 * bold title + dot treatment AppListRow's fixed title style doesn't support,
 * so this keeps AppListCard as the shared container/divider chrome and rolls
 * a custom row inside it, at the same icon-wrap size and divider convention
 * every other AppListRow uses.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollView, RefreshControl } from 'react-native';
import { AppBackHeader, AppListCard, AppEmptyState, AppErrorState, AppLoadingCards } from '../src/appui/AppUI';
import { Icon } from '../src/components/Icon';
import { obColors } from '../src/onboarding/onboardingTheme';
import { api, ApiError } from '../src/api/client';
import { useAsync } from '../src/lib/useAsync';
import { formatDate } from '../src/lib/format';
import type { Notification } from '../src/api/types';

/**
 * Where a notification's deep link goes. The server sends a bare screen name
 * (`{ screen: 'wallet' }`), so the mapping to an actual route lives here.
 * Anything unrecognised simply isn't tappable, rather than navigating nowhere.
 */
const SCREEN_ROUTES: Record<string, string> = {
  tasks: '/(tabs)/tasks',
  wallet: '/(tabs)/wallet',
  kyc: '/(auth)/kyc',
  disputes: '/disputes',
  crew: '/crew',
};

/** Icon per destination, so the list is scannable without reading every line. */
const SCREEN_ICONS: Record<string, 'list' | 'wallet' | 'id' | 'alert' | 'briefcase'> = {
  tasks: 'list',
  crew: 'briefcase',
  wallet: 'wallet',
  kyc: 'id',
  disputes: 'alert',
};

function NotificationRow({ item, onPress, last }: { item: Notification; onPress: (item: Notification) => void; last: boolean }) {
  const screen = item.data?.screen;
  const icon = (screen && SCREEN_ICONS[screen]) || 'bell';
  const target = screen ? SCREEN_ROUTES[screen] : undefined;

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.body}${item.read ? '' : '. Unread'}`}
      style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.pressed]}
    >
      <View style={[styles.iconWrap, !item.read && styles.iconWrapUnread]}>
        <Icon name={icon as any} size={16} color={item.read ? obColors.textMut : obColors.goldDeep} />
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, !item.read && styles.titleUnread]} numberOfLines={2}>
            {item.title}
          </Text>
          {!item.read ? <View style={styles.dot} /> : null}
        </View>
        <Text style={styles.message} numberOfLines={3}>
          {item.body}
        </Text>
        <Text style={styles.when}>{formatDate(item.createdAt)}</Text>
      </View>

      {target ? <Icon name="chevron-right" size={16} color={obColors.textMut} /> : null}
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, loading, error, reload } = useAsync((signal) => api.notifications(signal));
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Optimistic local copy: marking read must not make the list flash through a
  // loading state, and the row the worker just tapped is usually the one they
  // are navigating away from.
  const [readOverrides, setReadOverrides] = useState<Record<string, true>>({});

  const items = (data?.items ?? []).map((n) =>
    readOverrides[n.id] ? { ...n, read: true } : n
  );
  const unreadCount = items.filter((n) => !n.read).length;

  const open = useCallback(
    async (item: Notification) => {
      setActionError(null);
      if (!item.read) {
        setReadOverrides((prev) => ({ ...prev, [item.id]: true }));
        // Best-effort: a failed mark-read must not block the navigation the
        // worker actually asked for. The next load corrects the state.
        api.markNotificationRead(item.id).catch(() => {
          setReadOverrides((prev) => {
            const next = { ...prev };
            delete next[item.id];
            return next;
          });
        });
      }
      const screen = item.data?.screen;
      const target = screen ? SCREEN_ROUTES[screen] : undefined;
      if (target) router.push(target as any);
    },
    [router]
  );

  async function markAll() {
    setBusy(true);
    setActionError(null);
    try {
      await api.markAllNotificationsRead();
      reload();
    } catch (e) {
      setActionError(
        e instanceof ApiError || e instanceof Error ? e.message : 'Could not update your inbox.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={obColors.navy} />}
      >
        <AppBackHeader
          title="Notifications"
          onBack={() => router.back()}
          right={
            unreadCount > 0 ? (
              <Pressable onPress={markAll} disabled={busy} accessibilityRole="button" accessibilityLabel="Mark all as read" hitSlop={8}>
                <Text style={[styles.markAll, busy && styles.markAllBusy]}>Mark all read</Text>
              </Pressable>
            ) : undefined
          }
        />
        <Text style={styles.subtitle}>{unreadCount > 0 ? `${unreadCount} unread` : 'You are all caught up'}</Text>

        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

        {loading && !data ? (
          <AppLoadingCards count={3} />
        ) : error ? (
          <AppErrorState message={error} onRetry={reload} />
        ) : items.length === 0 ? (
          <AppEmptyState
            icon="bell"
            title="Nothing yet"
            message="Decisions about your applications, documents and payments will appear here."
          />
        ) : (
          <AppListCard>
            {items.map((n, i) => (
              <NotificationRow key={n.id} item={n} onPress={open} last={i === items.length - 1} />
            ))}
          </AppListCard>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  subtitle: { fontSize: 13, color: obColors.textMut, marginTop: -8, marginBottom: 16 },
  pressed: { opacity: 0.7 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: obColors.line },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: obColors.sand,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconWrapUnread: { backgroundColor: obColors.orangeInkBg },
  body: { flex: 1, gap: 2, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: obColors.text, fontSize: 14, fontWeight: '700' },
  titleUnread: { fontFamily: 'Raleway_800ExtraBold' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: obColors.goldDeep },
  message: { color: obColors.textMut, fontSize: 12.5, lineHeight: 18 },
  when: { color: obColors.textMut, fontSize: 11, marginTop: 2 },
  markAll: { color: obColors.goldDeep, fontSize: 13, fontWeight: '700' },
  markAllBusy: { opacity: 0.5 },
  actionError: {
    color: obColors.dangerInk,
    fontSize: 13,
    marginBottom: 10,
  },
});
