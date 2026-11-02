import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, AppState } from 'react-native';
import { obColors, obRadii } from '../onboarding/onboardingTheme';
import { Icon } from './Icon';
import { useAuth } from '../auth/AuthContext';
import { dismiss, flush, setOutboxUser, useOutbox, waitingCount, type OutboxItem } from '../lib/outbox';

/**
 * Keeps the queue (src/lib/outbox.ts) pointed at whoever is signed in and
 * sends what is waiting: on start, whenever the app comes back to the front,
 * and every 20 seconds while anything is waiting. A poll rather than a network
 * listener, because a listener is a native module and this app is sideloaded -
 * twenty seconds late is fine for a clock-out made an hour ago.
 */
export function OutboxSync() {
  const { user } = useAuth();
  const id = user?.id ?? null;

  useEffect(() => {
    void setOutboxUser(id).then(() => flush());
    if (!id) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void flush();
    });
    const t = setInterval(() => {
      if (waitingCount() > 0) void flush();
    }, 20_000);
    return () => {
      sub.remove();
      clearInterval(t);
    };
  }, [id]);

  return null;
}

function age(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

/** "No signal - showing what was loaded at 14:02." Nothing when the data is fresh. */
export function OfflineNote({ savedAt }: { savedAt: string | null }) {
  if (!savedAt) return null;
  return (
    <View style={styles.note} accessibilityRole="text">
      <Icon name="globe" size={14} color={obColors.amberInk} />
      <Text style={styles.noteText}>
        No signal. Showing what was loaded at {age(savedAt)}
        {new Date(savedAt).toDateString() !== new Date().toDateString()
          ? ` on ${new Date(savedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}`
          : ''}
        .
      </Text>
    </View>
  );
}

/**
 * What is waiting to be sent and what was refused, for the screens where the
 * work happens. `filter` narrows it to one job or delivery.
 */
export function OutboxBanner({ filter }: { filter?: (item: OutboxItem) => boolean }) {
  const all = useOutbox();
  const shown = filter ? all.filter(filter) : all;
  const waiting = shown.filter((i) => i.state === 'waiting');
  const failed = shown.filter((i) => i.state === 'failed');
  if (!waiting.length && !failed.length) return null;

  return (
    <View style={{ gap: 8, marginBottom: 12 }}>
      {waiting.length ? (
        <Pressable
          onPress={() => void flush()}
          style={[styles.box, { backgroundColor: obColors.indigoBg }]}
          accessibilityRole="button"
          accessibilityLabel="Try sending now"
        >
          <Icon name="clock" size={16} color={obColors.indigo} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: obColors.indigo }]}>
              {waiting.length === 1 ? '1 thing' : `${waiting.length} things`} waiting for signal
            </Text>
            <Text style={styles.body}>
              {waiting.map((i) => i.label).join(' · ')}. Saved on this phone and sent as soon as there is
              signal. Tap to try now.
            </Text>
          </View>
        </Pressable>
      ) : null}
      {failed.map((i) => (
        <View key={i.id} style={[styles.box, { backgroundColor: obColors.orangeInkBg }]}>
          <Icon name="alert" size={16} color={obColors.dangerInk} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: obColors.dangerInk }]}>Not sent: {i.label}</Text>
            <Text style={styles.body}>{i.error}</Text>
          </View>
          <Pressable onPress={() => void dismiss(i.id)} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={10}>
            <Text style={styles.dismiss}>OK</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: obColors.orangeInkBg,
    borderRadius: obRadii.field,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  noteText: { flex: 1, fontSize: 12.5, color: obColors.amberInk, fontWeight: '600' },
  box: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: obRadii.card, padding: 12 },
  title: { fontSize: 13.5, fontWeight: '700' },
  body: { fontSize: 12.5, color: obColors.text, lineHeight: 18, marginTop: 2 },
  dismiss: { fontSize: 13, fontWeight: '800', color: obColors.navy, paddingHorizontal: 4 },
});
