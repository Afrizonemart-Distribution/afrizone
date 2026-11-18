/**
 * Which state a Partimer lives in (server: services/places.ts). Live countries
 * only; the rest of Africa is shown as coming soon and cannot be picked.
 */
import React, { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { request } from '../api/client';
import { obColors } from '../onboarding/onboardingTheme';

interface Places {
  countries: { code: string; name: string; live: boolean }[];
  states: Record<string, string[]>;
}

type Row = { key: string; label: string; state?: string; disabled?: boolean };

export function StatePicker({ value, onChange }: { value: string | null; onChange: (state: string) => void }) {
  const [open, setOpen] = useState(false);
  const [places, setPlaces] = useState<Places | null>(null);

  useEffect(() => {
    request<Places>('/reference/places')
      .then(setPlaces)
      .catch(() => setPlaces(null));
  }, []);

  const rows: Row[] = [];
  for (const c of places?.countries ?? []) {
    if (c.live) {
      rows.push({ key: `h-${c.code}`, label: c.name, disabled: true });
      for (const s of places?.states[c.code] ?? []) rows.push({ key: `${c.code}-${s}`, label: s, state: s });
    }
  }
  const soon = (places?.countries ?? []).filter((c) => !c.live).map((c) => c.name);
  if (soon.length) rows.push({ key: 'soon', label: `Coming soon: ${soon.join(', ')}`, disabled: true });

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>State you live in</Text>
      <Pressable onPress={() => setOpen(true)} style={styles.field} accessibilityRole="button">
        <Text style={[styles.value, !value && { color: obColors.textMut }]}>{value ?? 'Choose your state…'}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Where do you live?</Text>
            <FlatList
              data={rows}
              keyExtractor={(r) => r.key}
              renderItem={({ item }) =>
                item.state ? (
                  <Pressable
                    style={styles.row}
                    onPress={() => {
                      onChange(item.state!);
                      setOpen(false);
                    }}
                  >
                    <Text style={[styles.rowText, item.state === value && { fontWeight: '700' }]}>{item.label}</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.heading}>{item.label}</Text>
                )
              }
            />
            <Pressable onPress={() => setOpen(false)} style={styles.close}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: obColors.navy },
  field: {
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#fff',
  },
  value: { fontSize: 15, color: obColors.navy },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  title: { fontSize: 17, fontWeight: '700', color: obColors.navy, marginBottom: 8 },
  heading: { fontSize: 12, color: obColors.textMut, marginTop: 12, marginBottom: 4 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: obColors.line },
  rowText: { fontSize: 15, color: obColors.navy },
  close: { alignItems: 'center', paddingTop: 14 },
  closeText: { fontSize: 15, color: obColors.goldDeep, fontWeight: '600' },
});
