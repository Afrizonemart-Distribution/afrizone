/**
 * The other side of a handover signs on the Tasker's phone
 * (server: services/evidence.ts, POST /me/evidence/signature).
 *
 * A FULL-SCREEN SHEET, NOT A BOX IN THE PAGE. The Tasker hands the phone over,
 * and a pad inside a scrolling screen fights the scroll for every downward
 * stroke - the signer drags and the page moves instead of the pen.
 *
 * NAME FIRST, THEN THE SCRAWL. A signature on its own does not say who signed;
 * the typed name is what a reviewer reads, and the drawing is what makes it a
 * signature rather than a note.
 *
 * Strokes become SVG path data, rounded to a tenth of a point: what the server
 * stores and the admin console draws, a few kilobytes for a whole signature.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  PanResponder,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { obColors, obRadii } from '../onboarding/onboardingTheme';

const r = (n: number) => Math.round(n * 10) / 10;

export interface DrawnSignature {
  signerName: string;
  path: string;
  width: number;
  height: number;
}

export default function SignaturePad({
  visible,
  signer,
  busy,
  error,
  onCancel,
  onDone,
}: {
  visible: boolean;
  /** Who is being asked to sign, in words: "The customer". */
  signer: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onDone: (s: DrawnSignature) => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [strokes, setStrokes] = useState<string[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // The stroke being drawn lives in a ref and is mirrored to state, so a fast
  // finger does not lose points between renders.
  const current = useRef('');

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          current.current = `M${r(locationX)} ${r(locationY)}`;
          setStrokes((s) => [...s, current.current]);
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          current.current += ` L${r(locationX)} ${r(locationY)}`;
          const stroke = current.current;
          setStrokes((s) => [...s.slice(0, -1), stroke]);
        },
        onPanResponderRelease: () => {
          current.current = '';
        },
      }),
    []
  );

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width: r(width), height: r(height) });
  }

  function clear() {
    current.current = '';
    setStrokes([]);
  }

  function close() {
    clear();
    setName('');
    onCancel();
  }

  // A tap leaves a lone "M x y", which is not a signature.
  const drawn = strokes.some((s) => s.includes('L'));
  const ready = name.trim().length > 0 && drawn && size.width > 0 && !busy;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={[styles.sheet, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.title}>{signer}, please sign</Text>
        <Text style={styles.hint}>To confirm this handover. Your name and signature are kept with the job.</Text>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name of the person signing"
          placeholderTextColor={obColors.textMut}
          style={styles.input}
          autoCapitalize="words"
          maxLength={120}
        />

        <View style={styles.padWrap} onLayout={onLayout} {...responder.panHandlers}>
          <Svg width="100%" height="100%">
            {strokes.map((d, i) => (
              <Path key={i} d={d} stroke={obColors.navy} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </Svg>
          {!drawn ? (
            <Text style={styles.padHint} pointerEvents="none">
              Sign here
            </Text>
          ) : null}
          <View style={styles.baseline} pointerEvents="none" />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.row}>
          <Pressable onPress={clear} disabled={busy} style={styles.secondary}>
            <Text style={styles.secondaryText}>Clear</Text>
          </Pressable>
          <Pressable
            onPress={() => onDone({ signerName: name.trim(), path: strokes.join(' '), width: size.width, height: size.height })}
            disabled={!ready}
            style={[styles.primary, !ready && { opacity: 0.45 }]}
          >
            <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Done'}</Text>
          </Pressable>
        </View>
        <Pressable onPress={close} disabled={busy} style={styles.cancel}>
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: obColors.bg, paddingHorizontal: 16, gap: 12 },
  title: { fontFamily: 'Raleway_800ExtraBold', fontSize: 20, color: obColors.navy },
  hint: { fontSize: 13, color: obColors.textMut, lineHeight: 18 },
  input: {
    minHeight: 48,
    borderRadius: obRadii.field,
    borderWidth: 1,
    borderColor: obColors.line,
    backgroundColor: obColors.white,
    paddingHorizontal: 14,
    fontSize: 15,
    color: obColors.text,
  },
  padWrap: {
    flex: 1,
    maxHeight: 320,
    borderRadius: obRadii.field,
    borderWidth: 1,
    borderColor: obColors.line,
    backgroundColor: obColors.white,
    overflow: 'hidden',
  },
  padHint: { position: 'absolute', left: 16, top: 12, fontSize: 13, color: obColors.textMut },
  baseline: { position: 'absolute', left: 24, right: 24, bottom: 48, height: 1, backgroundColor: obColors.line },
  error: { fontSize: 12.5, color: obColors.dangerInk },
  row: { flexDirection: 'row', gap: 10 },
  primary: {
    flex: 2,
    minHeight: 48,
    borderRadius: obRadii.pill,
    backgroundColor: obColors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: 'Raleway_800ExtraBold', fontSize: 15, color: obColors.white },
  secondary: {
    flex: 1,
    minHeight: 48,
    borderRadius: obRadii.pill,
    borderWidth: 1,
    borderColor: obColors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: 13.5, fontWeight: '800', color: obColors.textMut },
  cancel: { alignItems: 'center', paddingVertical: 8 },
});
