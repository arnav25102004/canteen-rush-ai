import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Switch, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppFeedbackKind, AppSeverity, newRequestId } from '../../services/feedback';
import { submitAppFeedback } from '../../services/feedbackQueue';
import { collectDiagnostics, Diagnostics } from '../../services/diagnostics';
import { CopyKey, NOTE_MAX, t } from '../../components/feedback/copy';
import { useFeedbackLang } from '../../components/feedback/hooks';
import { success } from '../../components/feedback/haptics';
import PhotoAdder from '../../components/feedback/PhotoAdder';

const KINDS: { kind: AppFeedbackKind; label: CopyKey; icon: string; placeholder: CopyKey }[] = [
  { kind: 'APP_BUG', label: 'kindBug', icon: '🐞', placeholder: 'appPlaceholderBug' },
  { kind: 'APP_IDEA', label: 'kindIdea', icon: '💡', placeholder: 'appPlaceholderIdea' },
  { kind: 'APP_PRAISE', label: 'kindPraise', icon: '😍', placeholder: 'appPlaceholderPraise' },
  { kind: 'APP_OTHER', label: 'kindOther', icon: '💬', placeholder: 'appPlaceholderOther' },
];

const SEVERITIES: { sev: AppSeverity; label: CopyKey }[] = [
  { sev: 'ANNOYING', label: 'sevAnnoying' },
  { sev: 'BLOCKS_ME', label: 'sevBlocks' },
  { sev: 'PAYMENT_ISSUE', label: 'sevPayment' },
];

const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;

export default function AppFeedbackScreen() {
  const router = useRouter();
  const [lang, toggleLang] = useFeedbackLang();
  const params = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<AppFeedbackKind>(KINDS.some((k) => k.kind === params.kind) ? (params.kind as AppFeedbackKind) : 'APP_BUG');
  const [photos, setPhotos] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<AppSeverity>('ANNOYING');
  const [withDiag, setWithDiag] = useState(true);
  const [showDiag, setShowDiag] = useState(false);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | 'sent' | 'queued'>(null);
  const requestId = useRef(newRequestId());

  useEffect(() => { void collectDiagnostics().then(setDiag); }, []);

  const needsLetters = kind === 'APP_BUG' || kind === 'APP_IDEA';
  const enough = needsLetters ? letters(body) >= 10 : letters(body) >= 1;
  const current = KINDS.find((k) => k.kind === kind)!;

  async function submit() {
    if (!enough || submitting) return;
    setSubmitting(true); setError(null);
    const res = await submitAppFeedback({
      clientRequestId: requestId.current,
      kind,
      body: body.trim(),
      severity: kind === 'APP_BUG' ? severity : undefined,
      isAnonymous: anonymous,
      contextJson: kind === 'APP_BUG' && withDiag && diag ? { ...diag } : undefined,
    }, photos);
    setSubmitting(false);
    if (res.state === 'failed') {
      if (res.code === 'APP_FEEDBACK_DAILY_CAP') setError(t('appCapReached', lang));
      else if (res.code === 'ACCOUNT_TOO_NEW') setError(t('appTooNew', lang));
      else setError(t('failedPrefix', lang) + res.message);
      return;
    }
    success();
    setDone(res.state);
  }

  if (done) {
    return (
      <SafeAreaView style={s.root}>
        <View style={s.center}>
          <Text style={s.bigEmoji}>🙏</Text>
          <Text style={s.title}>{t('appSentTitle', lang)}</Text>
          <Text style={s.sub}>{done === 'queued' ? t('thanksQueued', lang) : t('appSentBody', lang)}</Text>
          <TouchableOpacity style={s.primary} onPress={() => router.replace('/feedback/mine')} accessibilityRole="button">
            <Text style={s.primaryText}>{t('viewMine', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }} accessibilityRole="button">
            <Text style={s.link}>{t('done', lang)}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('close', lang)}>
          <Text style={s.link}>{t('close', lang)}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('appTitle', lang)}</Text>
        <TouchableOpacity onPress={toggleLang} accessibilityRole="button">
          <Text style={s.link}>{t('langToggle', lang)}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{t('appPrompt', lang)}</Text>
        <View style={s.tiles}>
          {KINDS.map((k) => (
            <TouchableOpacity
              key={k.kind}
              style={[s.tile, kind === k.kind && s.tileOn]}
              onPress={() => setKind(k.kind)}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === k.kind }}
            >
              <Text style={s.tileIcon}>{k.icon}</Text>
              <Text style={[s.tileText, kind === k.kind && s.tileTextOn]}>{t(k.label, lang)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={s.input}
          multiline
          maxLength={NOTE_MAX}
          value={body}
          onChangeText={setBody}
          placeholder={t(current.placeholder, lang)}
          accessibilityLabel={t(current.label, lang)}
        />
        <Text style={s.counter}>{body.length}/{NOTE_MAX}</Text>
        {!enough && body.length > 0 && needsLetters ? <Text style={s.warn}>{t('appMinLetters', lang)}</Text> : null}
        <Text style={s.hint}>{t('piiHint', lang)}</Text>
        <PhotoAdder uris={photos} onChange={setPhotos} lang={lang} />

        {kind === 'APP_BUG' && (
          <View style={{ marginTop: 16 }}>
            <Text style={s.label}>{t('severityTitle', lang)}</Text>
            <View style={s.sevRow}>
              {SEVERITIES.map((x) => (
                <TouchableOpacity
                  key={x.sev}
                  style={[s.sev, severity === x.sev && s.sevOn]}
                  onPress={() => setSeverity(x.sev)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: severity === x.sev }}
                >
                  <Text style={[s.sevText, severity === x.sev && s.sevTextOn]}>{t(x.label, lang)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {severity === 'PAYMENT_ISSUE' && <Text style={s.payHint}>{t('paymentHint', lang)}</Text>}

            <View style={s.switchRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={s.label}>{t('diagnostics', lang)}</Text>
                <Text style={s.hint}>{t('diagnosticsHint', lang)}</Text>
              </View>
              <Switch value={withDiag} onValueChange={setWithDiag} accessibilityLabel={t('diagnostics', lang)} />
            </View>
            {withDiag && (
              <>
                <TouchableOpacity onPress={() => setShowDiag((v) => !v)} accessibilityRole="button">
                  <Text style={s.link}>{showDiag ? t('diagnosticsHide', lang) : t('diagnosticsShow', lang)}</Text>
                </TouchableOpacity>
                {showDiag && (
                  <View style={s.preview}>
                    <Text style={s.mono} selectable>{diag ? JSON.stringify(diag, null, 2) : '…'}</Text>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        <View style={s.switchRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.label}>{t('anonymous', lang)}</Text>
            <Text style={s.hint}>{t('anonymousAdminNote', lang)}</Text>
          </View>
          <Switch value={anonymous} onValueChange={setAnonymous} accessibilityLabel={t('anonymous', lang)} />
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[s.primary, (!enough || submitting) && { opacity: 0.5 }]}
          disabled={!enough || submitting}
          onPress={submit}
          accessibilityRole="button"
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{t('appSubmit', lang)}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8f9fa' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  bigEmoji: { fontSize: 56, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700', color: '#1a1a2e', marginBottom: 12 },
  sub: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 24 },
  tiles: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tile: { flex: 1, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#eee' },
  tileOn: { borderColor: '#e94560', backgroundColor: '#fff1f3' },
  tileIcon: { fontSize: 24 },
  tileText: { fontSize: 12, color: '#555', marginTop: 4, fontWeight: '600' },
  tileTextOn: { color: '#e94560' },
  input: { backgroundColor: '#fff', borderRadius: 12, minHeight: 110, padding: 12, fontSize: 15, textAlignVertical: 'top', borderWidth: 1, borderColor: '#eee' },
  counter: { alignSelf: 'flex-end', fontSize: 11, color: '#999', marginTop: 4 },
  warn: { color: '#b45309', fontSize: 12, marginTop: 4 },
  hint: { fontSize: 12, color: '#888', marginTop: 2 },
  label: { fontSize: 14, fontWeight: '600', color: '#333' },
  sevRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  sev: { flex: 1, backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#eee' },
  sevOn: { borderColor: '#e94560', backgroundColor: '#fff1f3' },
  sevText: { fontSize: 12, color: '#555', fontWeight: '600', textAlign: 'center' },
  sevTextOn: { color: '#e94560' },
  payHint: { marginTop: 8, fontSize: 12, color: '#b91c1c', backgroundColor: '#fef2f2', padding: 10, borderRadius: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  preview: { backgroundColor: '#1a1a2e', borderRadius: 10, padding: 10, marginTop: 8 },
  mono: { color: '#d1d5db', fontSize: 11, fontFamily: 'monospace' },
  error: { color: '#dc2626', marginTop: 12, fontSize: 13 },
  primary: { backgroundColor: '#e94560', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center', marginTop: 20 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  link: { color: '#e94560', fontWeight: '600', fontSize: 13 },
});
