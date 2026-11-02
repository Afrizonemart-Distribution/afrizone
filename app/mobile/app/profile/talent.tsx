/**
 * The worker's Hiring profile: the CV they build here, and can share.
 *
 * Three kinds of fact, and the screen never lets one pass for another:
 *   - "Verified by AfriZone": identity, paid work and rating. Computed on the
 *     server from released payments. Nothing on this screen can edit it.
 *   - Checked documents: certificates and licences, reviewed by a person
 *     (Your documents screen).
 *   - Everything else, the worker's own word: headline, history, education,
 *     portfolio.
 *
 * Every write returns the whole updated profile, so the screen just replaces
 * what it holds - no partial merges to get wrong.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Modal,
  ScrollView,
  RefreshControl,
  Switch,
  Share,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import {
  AppBackHeader,
  AppPrimaryButton,
  AppSectionTitle,
  AppListRow,
  AppErrorState,
  AppLoadingCards,
} from '../../src/appui/AppUI';
import { Icon } from '../../src/components/Icon';
import { obColors, obRadii } from '../../src/onboarding/onboardingTheme';
import { api } from '../../src/api/client';
import { PROFILE_SHARE_BASE } from '../../src/api/config';
import { useAsync } from '../../src/lib/useAsync';
import type {
  TalentProfile,
  OpenTo,
  ProfileSection,
  WorkExperience,
  EducationEntry,
  PortfolioEntry,
} from '../../src/api/types';

const OPEN_TO_LABEL: Record<OpenTo, string> = {
  TASKS: 'One-off tasks',
  HOURLY: 'Hourly work',
  CONTRACT: 'Contract roles',
  FULL_TIME: 'Full-time jobs',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthYear(iso: string | null): string {
  if (!iso) return 'Now';
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "2022-03" / "03/2022" / "2022" → ISO first-of-month, or null if unreadable. */
function parseMonth(raw: string): string | null {
  const t = raw.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return iso(+m[1], +m[2]);
  m = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return iso(+m[2], +m[1]);
  m = t.match(/^(\d{4})$/);
  if (m) return iso(+m[1], 1);
  return null;
}
function iso(y: number, mo: number): string | null {
  if (mo < 1 || mo > 12 || y < 1950 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, '0')}-01`;
}
function toMonthInput(isoDate: string | null): string {
  return isoDate ? isoDate.slice(0, 7) : '';
}

type Editing =
  | { kind: 'basics' }
  | { kind: 'experience'; entry: WorkExperience | null }
  | { kind: 'education'; entry: EducationEntry | null }
  | { kind: 'portfolio'; entry: PortfolioEntry | null };

export default function TalentProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const loaded = useAsync((signal) => api.myProfile(signal));
  const [profile, setProfile] = useState<TalentProfile | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [cvBusy, setCvBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loaded.data) setProfile(loaded.data);
  }, [loaded.data]);

  async function run(fn: () => Promise<TalentProfile>) {
    setError(null);
    try {
      setProfile(await fn());
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
      return false;
    }
  }

  async function uploadCv() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled) return;
    const a = picked.assets[0];
    setCvBusy(true);
    await run(async () => {
      const doc = await api.uploadKycDocument({
        docType: 'CV',
        uri: a.uri,
        mimeType: a.mimeType ?? 'application/pdf',
        filename: a.name ?? 'cv.pdf',
      });
      return api.updateProfile({ cvDocumentId: doc.id });
    });
    setCvBusy(false);
  }

  async function setSharing(on: boolean) {
    setShareBusy(true);
    await run(() => api.updateProfile({ visibility: on ? 'LINK' : 'PRIVATE' }));
    setShareBusy(false);
  }

  const shareUrl = profile?.slug ? `${PROFILE_SHARE_BASE}/${profile.slug}` : null;
  const sharing = profile?.visibility === 'LINK';

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loaded.loading && !!profile} onRefresh={loaded.reload} tintColor={obColors.navy} />
        }
      >
        <AppBackHeader title="Hiring profile" onBack={() => router.back()} />
        <Text style={styles.subtitle}>Your CV on AfriZone. Employers see it when you apply.</Text>

        {!profile && loaded.loading ? (
          <AppLoadingCards count={3} />
        ) : !profile && loaded.error ? (
          <AppErrorState message={loaded.error} onRetry={loaded.reload} />
        ) : profile ? (
          <View style={{ gap: 18 }}>
            {error ? (
              <View style={styles.errorBox}>
                <Icon name="alert" size={15} color={obColors.dangerInk} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* ── About ── */}
            <Pressable style={styles.card} onPress={() => setEditing({ kind: 'basics' })} accessibilityRole="button">
              <View style={styles.rowBetween}>
                <Text style={styles.name}>{profile.name}</Text>
                <Icon name="edit" size={16} color={obColors.goldDeep} />
              </View>
              <Text style={profile.headline ? styles.headline : styles.placeholder}>
                {profile.headline ?? 'Add a headline, e.g. "Product photographer"'}
              </Text>
              {profile.location ? <Text style={styles.meta}>{profile.location}</Text> : null}
              {profile.bio ? <Text style={styles.body}>{profile.bio}</Text> : null}
              <View style={styles.chips}>
                {profile.openTo.length ? (
                  profile.openTo.map((o) => (
                    <View key={o} style={styles.chip}>
                      <Text style={styles.chipText}>{OPEN_TO_LABEL[o]}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.placeholder}>Say what work you are open to</Text>
                )}
              </View>
            </Pressable>

            {/* ── Proven ── */}
            <View style={[styles.card, styles.provenCard]}>
              <View style={styles.rowStart}>
                <Icon name="shield" size={16} color={obColors.forest} />
                <Text style={styles.provenTitle}>Verified by AfriZone</Text>
              </View>
              <Text style={styles.meta}>
                {profile.identityVerified ? 'Identity checked' : 'Identity not checked yet'}
                {' · '}
                {profile.workRecord.paidTasks} paid {profile.workRecord.paidTasks === 1 ? 'task' : 'tasks'}
                {profile.workRecord.rating !== null
                  ? ` · ${profile.workRecord.rating}★ from ${profile.workRecord.ratingsCount}`
                  : ''}
              </Text>
              {profile.workRecord.byCategory.slice(0, 4).map((c) => (
                <Text key={c.category} style={styles.body}>
                  {c.count} × {c.category}
                </Text>
              ))}
              <Text style={styles.hint}>Built from work you finish and get paid for. Nobody can type it in.</Text>
            </View>

            {/* ── CV ── */}
            <View>
              <AppSectionTitle title="CV" />
              <View style={styles.card}>
                <Text style={profile.cv ? styles.body : styles.placeholder}>
                  {profile.cv ? profile.cv.name : 'No CV yet. A PDF works best.'}
                </Text>
                <AppPrimaryButton
                  label={profile.cv ? 'Replace CV' : 'Upload CV'}
                  icon="arrow-up"
                  variant="outline"
                  onPress={uploadCv}
                  loading={cvBusy}
                  disabled={cvBusy}
                />
              </View>
            </View>

            {/* ── Sections ── */}
            <SectionList
              title="Work history"
              empty="Jobs you have held"
              items={profile.experience.map((e) => ({
                id: e.id,
                title: `${e.title} · ${e.company}`,
                sub: `${monthYear(e.startDate)} – ${monthYear(e.endDate)}${e.location ? ` · ${e.location}` : ''}`,
                onPress: () => setEditing({ kind: 'experience', entry: e }),
              }))}
              onAdd={() => setEditing({ kind: 'experience', entry: null })}
            />
            <SectionList
              title="Education"
              empty="Schools, degrees, diplomas"
              items={profile.education.map((e) => ({
                id: e.id,
                title: `${e.qualification}${e.field ? `, ${e.field}` : ''}`,
                sub: `${e.institution}${e.endYear ? ` · ${e.endYear}` : ''}`,
                onPress: () => setEditing({ kind: 'education', entry: e }),
              }))}
              onAdd={() => setEditing({ kind: 'education', entry: null })}
            />
            <SectionList
              title="Portfolio"
              empty="Links or files that show your work"
              items={profile.portfolio.map((p) => ({
                id: p.id,
                title: p.title,
                sub: p.url ?? p.file?.name ?? '',
                onPress: () => setEditing({ kind: 'portfolio', entry: p }),
              }))}
              onAdd={() => setEditing({ kind: 'portfolio', entry: null })}
            />

            {/* ── Checked elsewhere ── */}
            <View>
              <AppSectionTitle title="Certificates & skills" />
              <View style={styles.listCard}>
                <AppListRow
                  icon="id"
                  title="Certificates and licences"
                  subtitle={`${profile.credentials.filter((c) => c.verified).length} checked by us`}
                  onPress={() => router.push('/profile/credentials')}
                />
                <AppListRow
                  icon="star"
                  title="Skills"
                  subtitle={profile.skills.length ? profile.skills.map((s) => s.name).slice(0, 3).join(', ') : 'Add your skills'}
                  onPress={() => router.push('/profile/skills')}
                  last
                />
              </View>
            </View>

            {/* ── Share ── */}
            <View>
              <AppSectionTitle title="Share" />
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.cardTitle}>Share my profile by link</Text>
                    <Text style={styles.hint}>
                      Anyone with the link sees your profile. Never your phone, email or files.
                    </Text>
                  </View>
                  <Switch value={sharing} onValueChange={setSharing} disabled={shareBusy} />
                </View>
                {sharing && shareUrl ? (
                  <>
                    <Text style={styles.link} selectable>
                      {shareUrl}
                    </Text>
                    <AppPrimaryButton
                      label="Share link"
                      icon="globe"
                      onPress={() =>
                        Share.share({ message: `My AfriZone Part-Time profile: ${shareUrl}`, url: shareUrl })
                      }
                    />
                  </>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {profile && editing ? (
        <EditSheet
          editing={editing}
          profile={profile}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setProfile(p);
            setEditing(null);
          }}
        />
      ) : null}
    </View>
  );
}

function SectionList({
  title,
  empty,
  items,
  onAdd,
}: {
  title: string;
  empty: string;
  items: { id: string; title: string; sub: string; onPress: () => void }[];
  onAdd: () => void;
}) {
  return (
    <View>
      <AppSectionTitle title={title} />
      <View style={styles.card}>
        {items.length === 0 ? <Text style={styles.placeholder}>{empty}</Text> : null}
        {items.map((i) => (
          <Pressable key={i.id} style={styles.entry} onPress={i.onPress} accessibilityRole="button">
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{i.title}</Text>
              {i.sub ? <Text style={styles.meta}>{i.sub}</Text> : null}
            </View>
            <Icon name="chevron-right" size={16} color={obColors.textMut} />
          </Pressable>
        ))}
        <Pressable onPress={onAdd} style={styles.addRow} accessibilityRole="button">
          <Text style={styles.addText}>+ Add</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ─────────────────────────── edit sheet ─────────────────────────── */

function EditSheet({
  editing,
  profile,
  onClose,
  onSaved,
}: {
  editing: Editing;
  profile: TalentProfile;
  onClose: () => void;
  onSaved: (p: TalentProfile) => void;
}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState<Record<string, string>>(() => initialValues(editing, profile));
  const [openTo, setOpenTo] = useState<OpenTo[]>(profile.openTo);
  const [current, setCurrent] = useState(editing.kind === 'experience' && editing.entry ? !editing.entry.endDate : true);
  const [fileId, setFileId] = useState<string | null>(editing.kind === 'portfolio' ? editing.entry?.file?.id ?? null : null);
  const [fileName, setFileName] = useState<string | null>(editing.kind === 'portfolio' ? editing.entry?.file?.name ?? null : null);

  const set = (k: string) => (t: string) => setV((p) => ({ ...p, [k]: t }));
  const entryId = editing.kind === 'basics' ? null : editing.entry?.id ?? null;

  async function attach() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled) return;
    const a = picked.assets[0];
    setBusy(true);
    setError(null);
    try {
      const doc = await api.uploadKycDocument({
        docType: 'PORTFOLIO',
        uri: a.uri,
        mimeType: a.mimeType ?? 'application/pdf',
        filename: a.name ?? 'file.pdf',
      });
      setFileId(doc.id);
      setFileName(a.name ?? 'File');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let p: TalentProfile;
      if (editing.kind === 'basics') {
        p = await api.updateProfile({
          headline: v.headline || null,
          bio: v.bio || null,
          location: v.location || null,
          openTo,
        });
      } else {
        const body = bodyFor(editing.kind, v, current, fileId);
        p = entryId
          ? await api.updateProfileEntry(editing.kind, entryId, body)
          : await api.addProfileEntry(editing.kind, body);
      }
      onSaved(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (editing.kind === 'basics' || !entryId) return;
    const section: ProfileSection = editing.kind;
    Alert.alert('Remove this entry?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            onSaved(await api.removeProfileEntry(section, entryId));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not remove.');
            setBusy(false);
          }
        },
      },
    ]);
  }

  const title = {
    basics: 'About you',
    experience: entryId ? 'Edit job' : 'Add a job',
    education: entryId ? 'Edit education' : 'Add education',
    portfolio: entryId ? 'Edit portfolio item' : 'Add to portfolio',
  }[editing.kind];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle}>{title}</Text>
        <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
          {editing.kind === 'basics' ? (
            <>
              <Field label="Headline" value={v.headline} onChange={set('headline')} placeholder="e.g. Product photographer" max={120} />
              <Field label="Location" value={v.location} onChange={set('location')} placeholder="e.g. Ikeja, Lagos" max={120} />
              <Field label="About you" value={v.bio} onChange={set('bio')} placeholder="A few lines about your work" max={2000} multiline />
              <Text style={styles.label}>Open to</Text>
              <View style={styles.chips}>
                {(Object.keys(OPEN_TO_LABEL) as OpenTo[]).map((o) => {
                  const on = openTo.includes(o);
                  return (
                    <Pressable
                      key={o}
                      onPress={() => setOpenTo((p) => (on ? p.filter((x) => x !== o) : [...p, o]))}
                      style={[styles.chip, on && styles.chipOn]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{OPEN_TO_LABEL[o]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : editing.kind === 'experience' ? (
            <>
              <Field label="Job title" value={v.title} onChange={set('title')} max={120} />
              <Field label="Company" value={v.company} onChange={set('company')} max={120} />
              <Field label="Location" value={v.location} onChange={set('location')} max={120} />
              <Field label="Started (YYYY-MM)" value={v.start} onChange={set('start')} placeholder="2022-03" keyboard="numbers-and-punctuation" />
              <View style={[styles.rowBetween, { marginTop: 14 }]}>
                <Text style={styles.body}>I still work here</Text>
                <Switch value={current} onValueChange={setCurrent} />
              </View>
              {!current ? (
                <Field label="Ended (YYYY-MM)" value={v.end} onChange={set('end')} placeholder="2024-06" keyboard="numbers-and-punctuation" />
              ) : null}
              <Field label="What you did" value={v.description} onChange={set('description')} max={2000} multiline />
            </>
          ) : editing.kind === 'education' ? (
            <>
              <Field label="School or institution" value={v.institution} onChange={set('institution')} max={160} />
              <Field label="Qualification" value={v.qualification} onChange={set('qualification')} placeholder="e.g. BSc, OND, WAEC" max={120} />
              <Field label="Field of study" value={v.field} onChange={set('field')} max={120} />
              <Field label="Start year" value={v.startYear} onChange={set('startYear')} keyboard="number-pad" />
              <Field label="End year" value={v.endYear} onChange={set('endYear')} keyboard="number-pad" />
              <Text style={styles.hint}>
                Want a certificate checked so it unlocks work? Add it under Certificates and licences.
              </Text>
            </>
          ) : (
            <>
              <Field label="Title" value={v.title} onChange={set('title')} max={120} />
              <Field label="Link" value={v.url} onChange={set('url')} placeholder="https://" keyboard="url" />
              <Field label="Description" value={v.description} onChange={set('description')} max={1000} multiline />
              <Text style={styles.label}>Or a file</Text>
              {fileName ? <Text style={styles.body}>{fileName}</Text> : null}
              <AppPrimaryButton label={fileName ? 'Replace file' : 'Attach a file'} icon="arrow-up" variant="outline" onPress={attach} disabled={busy} />
            </>
          )}
          {error ? <Text style={[styles.errorText, { marginTop: 12 }]}>{error}</Text> : null}
        </ScrollView>
        <View style={{ gap: 10, marginTop: 14 }}>
          <AppPrimaryButton label="Save" onPress={save} loading={busy} disabled={busy} />
          {entryId ? (
            <Pressable onPress={remove} style={{ alignSelf: 'center', padding: 6 }} accessibilityRole="button">
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function initialValues(editing: Editing, profile: TalentProfile): Record<string, string> {
  switch (editing.kind) {
    case 'basics':
      return { headline: profile.headline ?? '', bio: profile.bio ?? '', location: profile.location ?? '' };
    case 'experience': {
      const e = editing.entry;
      return {
        title: e?.title ?? '',
        company: e?.company ?? '',
        location: e?.location ?? '',
        start: toMonthInput(e?.startDate ?? null),
        end: toMonthInput(e?.endDate ?? null),
        description: e?.description ?? '',
      };
    }
    case 'education': {
      const e = editing.entry;
      return {
        institution: e?.institution ?? '',
        qualification: e?.qualification ?? '',
        field: e?.field ?? '',
        startYear: e?.startYear ? String(e.startYear) : '',
        endYear: e?.endYear ? String(e.endYear) : '',
      };
    }
    case 'portfolio': {
      const e = editing.entry;
      return { title: e?.title ?? '', url: e?.url ?? '', description: e?.description ?? '' };
    }
  }
}

/** Form values → request body. Empty optional fields are sent as null to clear them. */
function bodyFor(kind: ProfileSection, v: Record<string, string>, current: boolean, fileId: string | null) {
  const opt = (s: string | undefined) => (s && s.trim() ? s.trim() : null);
  if (kind === 'experience') {
    const startDate = parseMonth(v.start ?? '');
    if (!startDate) throw new Error('Enter when you started as YYYY-MM, e.g. 2022-03.');
    const endDate = current ? null : parseMonth(v.end ?? '');
    if (!current && !endDate) throw new Error('Enter when it ended as YYYY-MM, or switch on "I still work here".');
    return {
      title: v.title,
      company: v.company,
      location: opt(v.location),
      startDate,
      endDate,
      description: opt(v.description),
    };
  }
  if (kind === 'education') {
    return {
      institution: v.institution,
      qualification: v.qualification,
      field: opt(v.field),
      startYear: opt(v.startYear),
      endYear: opt(v.endYear),
    };
  }
  return { title: v.title, url: opt(v.url), description: opt(v.description), documentId: fileId };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  max,
  multiline,
  keyboard,
}: {
  label: string;
  value: string;
  onChange: (t: string) => void;
  placeholder?: string;
  max?: number;
  multiline?: boolean;
  keyboard?: 'default' | 'number-pad' | 'url' | 'numbers-and-punctuation';
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { minHeight: 90, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={obColors.textMut}
        maxLength={max}
        multiline={multiline}
        keyboardType={keyboard ?? 'default'}
        autoCapitalize={keyboard === 'url' ? 'none' : 'sentences'}
        autoCorrect={keyboard !== 'url'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  subtitle: { fontSize: 13, color: obColors.textMut, marginTop: -8, marginBottom: 16 },
  card: {
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.card,
    borderTopRightRadius: obRadii.cardCut,
    padding: 14,
    gap: 8,
  },
  listCard: {
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.card,
    overflow: 'hidden',
  },
  provenCard: { backgroundColor: obColors.mgreenBg, borderColor: obColors.mgreenBg },
  provenTitle: { color: obColors.forest, fontSize: 14, fontFamily: 'Raleway_800ExtraBold' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowStart: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: obColors.navy, fontSize: 18, fontFamily: 'Raleway_800ExtraBold' },
  headline: { color: obColors.text, fontSize: 14, fontWeight: '700' },
  cardTitle: { color: obColors.text, fontSize: 14, fontFamily: 'Raleway_800ExtraBold' },
  meta: { color: obColors.textMut, fontSize: 12.5 },
  body: { color: obColors.text, fontSize: 13.5, lineHeight: 19 },
  hint: { color: obColors.textMut, fontSize: 11.5, lineHeight: 16 },
  placeholder: { color: obColors.textMut, fontSize: 13, fontStyle: 'italic' },
  link: { color: obColors.navy, fontSize: 13, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: obColors.white,
  },
  chipOn: { backgroundColor: obColors.navy, borderColor: obColors.navy },
  chipText: { color: obColors.text, fontSize: 12, fontWeight: '700' },
  chipTextOn: { color: obColors.white },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: obColors.line,
  },
  addRow: { paddingVertical: 6 },
  addText: { color: obColors.goldDeep, fontSize: 13.5, fontWeight: '800' },
  errorBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: obColors.dangerBg,
    borderRadius: obRadii.field,
    padding: 10,
  },
  errorText: { flex: 1, color: obColors.dangerInk, fontSize: 12.5, lineHeight: 18 },
  removeText: { color: obColors.dangerInk, fontSize: 13, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: obColors.scrim },
  sheet: {
    backgroundColor: obColors.bg,
    borderTopLeftRadius: obRadii.hero,
    borderTopRightRadius: obRadii.hero,
    padding: 20,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 4, backgroundColor: obColors.line, marginBottom: 8 },
  sheetTitle: { color: obColors.navy, fontSize: 18, fontFamily: 'Raleway_800ExtraBold', marginBottom: 4 },
  label: { color: obColors.textMut, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.field,
    paddingHorizontal: 13,
    paddingVertical: 13,
    color: obColors.text,
    backgroundColor: obColors.white,
    fontSize: 15,
  },
});
