/**
 * Fill in the Hiring profile from the uploaded CV.
 *
 * The AI reads the CV (POST /api/me/profile/cv/read) and this screen shows
 * what it found. Nothing is saved until the worker has looked: they untick
 * what's wrong, fix a headline or a date, and only then send it
 * (POST /api/me/profile/cv/import). A misread CV never reaches HR unseen.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBackHeader, AppPrimaryButton, AppSectionTitle } from '../../src/appui/AppUI';
import { Banner } from '../../src/components/Feedback';
import { Icon } from '../../src/components/Icon';
import { obColors, obRadii } from '../../src/onboarding/onboardingTheme';
import { api } from '../../src/api/client';
import type { CvDraft, CvImportResult } from '../../src/api/types';

type Exp = CvDraft['experience'][number] & { keep: boolean };
type Edu = CvDraft['education'][number] & { keep: boolean };

export default function CvReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [reading, setReading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [useHeadline, setUseHeadline] = useState(true);
  const [useBio, setUseBio] = useState(true);
  const [experience, setExperience] = useState<Exp[]>([]);
  const [education, setEducation] = useState<Edu[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CvImportResult | null>(null);

  useEffect(() => {
    let live = true;
    api
      .readCv()
      .then(({ draft }) => {
        if (!live) return;
        setHeadline(draft.headline);
        setBio(draft.bio);
        setUseHeadline(!!draft.headline);
        setUseBio(!!draft.bio);
        setExperience(draft.experience.map((e) => ({ ...e, keep: true })));
        setEducation(draft.education.map((e) => ({ ...e, keep: true })));
        setSkills(draft.skills);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not read your CV.'))
      .finally(() => live && setReading(false));
    return () => {
      live = false;
    };
  }, []);

  const keptCount =
    (useHeadline && headline.trim() ? 1 : 0) +
    (useBio && bio.trim() ? 1 : 0) +
    experience.filter((e) => e.keep).length +
    education.filter((e) => e.keep).length;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await api.importCv({
        headline: useHeadline && headline.trim() ? headline.trim() : undefined,
        bio: useBio && bio.trim() ? bio.trim() : undefined,
        experience: experience.filter((e) => e.keep).map(({ keep: _k, ...e }) => e),
        education: education.filter((e) => e.keep).map(({ keep: _k, ...e }) => e),
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const empty = !reading && !error && !headline && !bio && experience.length === 0 && education.length === 0;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: insets.bottom + 40, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <AppBackHeader title="Fill in from my CV" onBack={() => router.back()} />

        {reading ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Reading your CV…</Text>
            <Text style={styles.hint}>This takes up to a minute. Nothing is saved until you check it.</Text>
          </View>
        ) : null}

        {error && !result ? <Banner tone="danger" title="Couldn't do that" message={error} /> : null}

        {empty ? (
          <Banner tone="amber" title="Nothing found" message="We couldn't find work history or education in that file. Fill in your profile by hand." />
        ) : null}

        {result ? (
          <View style={{ gap: 12 }}>
            <Banner
              tone="money"
              icon="check-circle"
              title="Added to your Hiring profile"
              message={`${result.added.experience} job${result.added.experience === 1 ? '' : 's'} and ${result.added.education} school${result.added.education === 1 ? '' : 's'} added.`}
            />
            {result.skipped.length ? (
              <Banner
                tone="amber"
                title={`${result.skipped.length} not added`}
                message={result.skipped
                  .map((s) => `${s.section === 'experience' ? 'Job' : 'School'} ${s.index + 1}: ${s.error}`)
                  .join('\n')}
              />
            ) : null}
            <AppPrimaryButton label="Back to my profile" onPress={() => router.back()} />
          </View>
        ) : null}

        {!reading && !result && !empty && !error ? (
          <>
            <Text style={styles.hint}>
              Read by AI from your CV. Check each part: untick anything wrong, and fix it here before you add it.
            </Text>

            {headline ? (
              <View style={styles.card}>
                <KeepRow label="Headline" keep={useHeadline} onToggle={() => setUseHeadline((v) => !v)} />
                <TextInput value={headline} onChangeText={setHeadline} maxLength={120} style={styles.input} />
              </View>
            ) : null}

            {bio ? (
              <View style={styles.card}>
                <KeepRow label="About me" keep={useBio} onToggle={() => setUseBio((v) => !v)} />
                <TextInput
                  value={bio}
                  onChangeText={setBio}
                  maxLength={2000}
                  multiline
                  textAlignVertical="top"
                  style={[styles.input, { minHeight: 90 }]}
                />
              </View>
            ) : null}

            {experience.length ? <AppSectionTitle title="Work history" /> : null}
            {experience.map((e, i) => (
              <View key={`e${i}`} style={[styles.card, !e.keep && styles.off]}>
                <KeepRow
                  label={`${e.title} · ${e.company}`}
                  keep={e.keep}
                  onToggle={() => setExperience((xs) => xs.map((x, j) => (j === i ? { ...x, keep: !x.keep } : x)))}
                />
                <View style={styles.dates}>
                  <DateBox
                    label="Started (YYYY-MM)"
                    value={e.startDate}
                    onChange={(v) => setExperience((xs) => xs.map((x, j) => (j === i ? { ...x, startDate: v } : x)))}
                  />
                  <DateBox
                    label="Ended (blank = now)"
                    value={e.endDate}
                    onChange={(v) => setExperience((xs) => xs.map((x, j) => (j === i ? { ...x, endDate: v } : x)))}
                  />
                </View>
                {e.keep && !e.startDate ? <Text style={styles.warn}>Add the month you started, or this job is skipped.</Text> : null}
                {e.description ? <Text style={styles.body}>{e.description}</Text> : null}
              </View>
            ))}

            {education.length ? <AppSectionTitle title="Education" /> : null}
            {education.map((e, i) => (
              <View key={`d${i}`} style={[styles.card, !e.keep && styles.off]}>
                <KeepRow
                  label={`${e.qualification}${e.field ? ` in ${e.field}` : ''} · ${e.institution}`}
                  keep={e.keep}
                  onToggle={() => setEducation((xs) => xs.map((x, j) => (j === i ? { ...x, keep: !x.keep } : x)))}
                />
                {e.startYear || e.endYear ? (
                  <Text style={styles.hint}>
                    {e.startYear ?? '?'} – {e.endYear ?? '?'}
                  </Text>
                ) : null}
              </View>
            ))}

            {skills.length ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Skills in your CV</Text>
                <Text style={styles.body}>{skills.join(', ')}</Text>
                <Pressable onPress={() => router.push('/profile/skills')} hitSlop={8}>
                  <Text style={styles.link}>Add them under Skills</Text>
                </Pressable>
              </View>
            ) : null}

            <AppPrimaryButton
              label={`Add ${keptCount} item${keptCount === 1 ? '' : 's'} to my profile`}
              onPress={save}
              loading={saving}
              disabled={saving || keptCount === 0}
            />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function KeepRow({ label, keep, onToggle }: { label: string; keep: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: keep }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
    >
      <Icon name={keep ? 'check-circle' : 'close'} size={18} color={keep ? obColors.forest : obColors.textMut} />
      <Text style={[styles.cardTitle, { flex: 1 }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function DateBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={styles.hint}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="2021-03"
        placeholderTextColor={obColors.textMut}
        maxLength={7}
        keyboardType="numbers-and-punctuation"
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  card: {
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.card,
    borderTopRightRadius: obRadii.cardCut,
    padding: 14,
    gap: 8,
  },
  off: { opacity: 0.5 },
  cardTitle: { color: obColors.text, fontSize: 14, fontFamily: 'Raleway_800ExtraBold' },
  body: { color: obColors.text, fontSize: 13.5, lineHeight: 19 },
  hint: { color: obColors.textMut, fontSize: 12, lineHeight: 17 },
  warn: { color: obColors.dangerInk, fontSize: 12 },
  link: { color: obColors.navy, fontSize: 13, fontWeight: '700' },
  dates: { flexDirection: 'row', gap: 10 },
  input: {
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: obColors.text,
    fontSize: 13.5,
  },
});
