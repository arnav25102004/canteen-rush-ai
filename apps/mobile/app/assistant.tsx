import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal,
  KeyboardAvoidingView, Platform, AccessibilityInfo,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import {
  AssistantCard, Chip, ChipAction, ItemsCard, OrderProposalCard, ReportReason, deleteAllChats, getCapabilities,
  getCurrentConversation, handOff, newConversation, reportMessage, sendTurn, uuid,
} from '../services/assistant';
import { useCartStore } from '../store/cartStore';

const MAX_LEN = 500;
const NOTICE_KEY = 'assistant_notice_seen';
const NOTICE = 'AI can make mistakes. Nothing is ordered until you confirm at checkout.';

interface Msg {
  key: string;
  id?: string; // server message id (assistant messages only), needed to report
  role: 'USER' | 'ASSISTANT';
  text: string;
  cards: AssistantCard[];
  chips: Chip[];
  degraded?: boolean;
}

type Problem = null | 'disabled' | 'daily_limit' | 'offline' | 'unavailable';

const REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'WRONG_INFO', label: 'Wrong information' },
  { value: 'OFF_TOPIC', label: 'Not about canteens' },
  { value: 'OFFENSIVE', label: 'Offensive' },
  { value: 'OTHER', label: 'Something else' },
];

function stageText(seconds: number) {
  if (seconds >= 12) return 'Still working on it. Almost there...';
  if (seconds >= 5) return 'Checking menus and slots...';
  return 'Thinking...';
}

export default function AssistantScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]); // oldest first
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<Problem>(null);
  const [showNotice, setShowNotice] = useState(false);
  const [reportFor, setReportFor] = useState<Msg | null>(null);
  const [now, setNow] = useState(Date.now());
  const [reduceMotion, setReduceMotion] = useState(false);
  const [handingOff, setHandingOff] = useState<string | null>(null);
  const convRef = useRef<string | null>(null);
  convRef.current = conversationId;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    AsyncStorage.getItem(NOTICE_KEY).then((v) => setShowNotice(!v)).catch(() => undefined);
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!sending) { setElapsed(0); return; }
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [sending]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const caps = await getCapabilities();
      if (!caps.enabled) { setProblem('disabled'); return; }
      if (caps.turnsLeftToday <= 0 && caps.available) setProblem('daily_limit');
      else if (!caps.available && caps.reason === 'busy') setProblem('unavailable');
      const cur = await getCurrentConversation();
      setConversationId(cur.conversationId);
      setMessages(cur.messages.map((m) => ({ key: m.id, id: m.id, role: m.role, text: m.text, cards: m.cards ?? [], chips: m.chips ?? [] })));
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) setProblem('disabled');
      else if (axios.isAxiosError(err) && !err.response) setProblem('offline');
      else setProblem('unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function dismissNotice() {
    setShowNotice(false);
    AsyncStorage.setItem(NOTICE_KEY, '1').catch(() => undefined);
  }

  async function send(body: { message?: string; action?: ChipAction }, echo: string) {
    if (sending) return;
    if (showNotice) dismissNotice();
    const clientTurnId = uuid();
    setMessages((m) => [...m, { key: `u-${clientTurnId}`, role: 'USER', text: echo, cards: [], chips: [] }]);
    setSending(true);
    if (problem === 'offline' || problem === 'unavailable') setProblem(null);
    try {
      const res = await sendTurn({ conversationId: convRef.current, clientTurnId, ...body });
      setConversationId(res.conversationId);
      setMessages((m) => [
        ...m,
        { key: res.reply.id, id: res.reply.id, role: 'ASSISTANT', text: res.reply.text, cards: res.reply.cards, chips: res.reply.chips, degraded: res.degraded },
      ]);
      if (res.usage && res.usage.turnsLeftToday <= 0) setProblem('daily_limit');
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const code = axios.isAxiosError(err) ? (err.response?.data as { code?: string } | undefined)?.code : undefined;
      if (status === 404) setProblem('disabled');
      else if (status === 429 && code === 'DAILY_LIMIT') setProblem('daily_limit');
      else if (status === 429) setProblem('unavailable');
      else if (axios.isAxiosError(err) && !err.response) setProblem('offline');
      else setProblem('unavailable');
    } finally {
      setSending(false);
    }
  }

  function submit() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    send({ message: text }, text);
  }

  function onChip(chip: Chip) {
    if (chip.action.type === 'navigate') {
      router.push('/(tabs)/home');
      return;
    }
    send({ action: chip.action }, chip.label);
  }

  async function reviewAndCheckout(card: OrderProposalCard) {
    if (handingOff) return;
    setHandingOff(card.proposalId);
    try {
      const h = await handOff(card.proposalId);
      const go = () => {
        useCartStore.getState().replaceCart(
          h.canteenId,
          h.canteenName,
          h.items.map((i) => ({ menuItemId: i.menuItemId, name: i.name, price: i.price, isVeg: i.isVeg, quantity: i.quantity })),
          h.slot,
        );
        router.push('/checkout');
      };
      if (h.changes.length > 0) {
        Alert.alert('Some things changed', h.changes.join('\n'), [
          { text: 'Back to chat', style: 'cancel' },
          { text: 'Continue', onPress: go },
        ]);
      } else {
        go();
      }
    } catch (err) {
      const msg = axios.isAxiosError(err) ? (err.response?.data as { error?: string } | undefined)?.error : undefined;
      Alert.alert('Could not open checkout', msg ?? 'Please try again, or order from the menu.');
    } finally {
      setHandingOff(null);
    }
  }

  function openMenu() {
    Alert.alert('Khana Assistant', undefined, [
      { text: 'New chat', onPress: startNewChat },
      { text: 'Delete my chats', style: 'destructive', onPress: confirmDelete },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function startNewChat() {
    try {
      const id = await newConversation();
      setConversationId(id);
      setMessages([]);
    } catch {
      Alert.alert('Could not start a new chat', 'Please try again.');
    }
  }

  function confirmDelete() {
    Alert.alert('Delete my chats?', 'All your assistant conversations will be removed. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAllChats();
            setConversationId(null);
            setMessages([]);
          } catch {
            Alert.alert('Could not delete chats', 'Please try again.');
          }
        },
      },
    ]);
  }

  async function submitReport(reason: ReportReason) {
    const target = reportFor;
    setReportFor(null);
    if (!target?.id) return;
    try {
      await reportMessage(target.id, reason);
      Alert.alert('Thanks', 'We received your report.');
    } catch {
      Alert.alert('Could not send the report', 'Please try again.');
    }
  }

  const lastAssistantKey = [...messages].reverse().find((m) => m.role === 'ASSISTANT')?.key;
  const lastKey = messages[messages.length - 1]?.key;
  const data = [...messages].reverse();

  const blocked = problem === 'disabled' || problem === 'daily_limit';

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Khana Assistant',
          headerRight: () => (
            <TouchableOpacity onPress={openMenu} accessibilityRole="button" accessibilityLabel="Assistant menu" style={styles.menuBtn}>
              <Text style={styles.menuText}>⋯</Text>
            </TouchableOpacity>
          ),
        }}
      />
      {showNotice && (
        <TouchableOpacity style={styles.notice} onPress={dismissNotice} accessibilityRole="button" accessibilityLabel={`${NOTICE} Tap to dismiss.`}>
          <Text style={styles.noticeText}>{NOTICE}</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#e94560" /></View>
      ) : problem === 'disabled' ? (
        <ProblemView text="The assistant isn't available right now. You can still order from the menu." onBrowse={() => router.replace('/(tabs)/home')} />
      ) : (
        <FlatList
          inverted
          data={data}
          keyExtractor={(m) => m.key}
          contentContainerStyle={{ padding: 12 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              {sending && (
                <View style={styles.progress} accessibilityLiveRegion="polite">
                  {!reduceMotion && <ActivityIndicator size="small" color="#e94560" />}
                  <Text style={styles.progressText}>{stageText(elapsed)}</Text>
                </View>
              )}
              {problem === 'daily_limit' && (
                <ProblemView text="You've used all of today's assistant turns. You can still order from the menu." onBrowse={() => router.replace('/(tabs)/home')} compact />
              )}
              {problem === 'unavailable' && (
                <ProblemView text="The assistant is busy right now. You can still order from the menu." onBrowse={() => router.replace('/(tabs)/home')} compact />
              )}
              {problem === 'offline' && (
                <ProblemView text="You seem to be offline. Check your connection and try again." compact />
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>What would you like to eat?</Text>
              <Text style={styles.emptyText}>Try "2 veg puffs for 1pm" or "something veg under ₹80".</Text>
            </View>
          }
          renderItem={({ item }) => (
            <MessageView
              msg={item}
              showChips={!sending && item.key === lastAssistantKey && item.key === lastKey}
              now={now}
              handingOff={handingOff}
              onChip={onChip}
              onCheckout={reviewAndCheckout}
              onItem={(canteenId) => router.push(`/canteen/${canteenId}`)}
              onBrowse={() => router.replace('/(tabs)/home')}
              onReport={() => item.id && setReportFor(item)}
            />
          )}
        />
      )}

      {!loading && !blocked && (
        <View style={styles.inputRow}>
          <View style={{ flex: 1 }}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={(t) => setInput(t.slice(0, MAX_LEN))}
              placeholder="Ask about food, slots or points..."
              placeholderTextColor="#999"
              multiline
              maxLength={MAX_LEN}
              accessibilityLabel="Message to the assistant"
              editable={!sending}
            />
            <Text style={styles.counter} accessibilityLabel={`${input.length} of ${MAX_LEN} characters`}>{input.length}/{MAX_LEN}</Text>
          </View>
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.4 }]}
            onPress={submit}
            disabled={!input.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={!!reportFor} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setReportFor(null)}>
        <View style={styles.modalBack}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Report this reply</Text>
            {REASONS.map((r) => (
              <TouchableOpacity key={r.value} style={styles.reasonBtn} onPress={() => submitReport(r.value)} accessibilityRole="button" accessibilityLabel={`Report: ${r.label}`}>
                <Text style={styles.reasonText}>{r.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.reasonBtn} onPress={() => setReportFor(null)} accessibilityRole="button" accessibilityLabel="Cancel report">
              <Text style={[styles.reasonText, { color: '#666' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function ProblemView({ text, onBrowse, compact }: { text: string; onBrowse?: () => void; compact?: boolean }) {
  return (
    <View style={[styles.problem, !compact && { margin: 24 }]}>
      <Text style={styles.problemText}>{text}</Text>
      {onBrowse && (
        <TouchableOpacity style={styles.primaryBtn} onPress={onBrowse} accessibilityRole="button" accessibilityLabel="Browse canteens">
          <Text style={styles.primaryBtnText}>Browse canteens</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

interface MessageProps {
  msg: Msg;
  showChips: boolean;
  now: number;
  handingOff: string | null;
  onChip: (c: Chip) => void;
  onCheckout: (c: OrderProposalCard) => void;
  onItem: (canteenId: string) => void;
  onBrowse: () => void;
  onReport: () => void;
}

function MessageView({ msg, showChips, now, handingOff, onChip, onCheckout, onItem, onBrowse, onReport }: MessageProps) {
  const mine = msg.role === 'USER';
  return (
    <View style={{ marginBottom: 12, alignItems: mine ? 'flex-end' : 'flex-start' }}>
      {!!msg.text && (
        <TouchableOpacity
          activeOpacity={0.8}
          onLongPress={mine ? undefined : onReport}
          disabled={mine}
          accessibilityLabel={`${mine ? 'You' : 'Assistant'}: ${msg.text}`}
          accessibilityHint={mine ? undefined : 'Long press to report this reply'}
          style={[styles.bubble, mine ? styles.mine : styles.theirs]}
        >
          {/* Plain text only: never render markdown or links from the assistant. */}
          <Text style={mine ? styles.mineText : styles.theirsText} selectable={false}>{msg.text}</Text>
        </TouchableOpacity>
      )}
      {msg.cards.map((c, i) =>
        c.type === 'order_proposal' ? (
          <ProposalCardView key={`${msg.key}-${i}`} card={c} now={now} busy={handingOff === c.proposalId} onCheckout={onCheckout} />
        ) : c.type === 'items' ? (
          <ItemsCardView key={`${msg.key}-${i}`} card={c} onItem={onItem} />
        ) : null,
      )}
      {msg.degraded && (
        <TouchableOpacity style={[styles.primaryBtn, { marginTop: 8 }]} onPress={onBrowse} accessibilityRole="button" accessibilityLabel="Browse canteens">
          <Text style={styles.primaryBtnText}>Browse canteens</Text>
        </TouchableOpacity>
      )}
      {showChips && msg.chips.length > 0 && (
        <View style={styles.chipRow}>
          {msg.chips.map((c, i) => (
            <TouchableOpacity key={i} style={styles.chip} onPress={() => onChip(c)} accessibilityRole="button" accessibilityLabel={c.label}>
              <Text style={styles.chipText}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const rupees = (n: number) => `₹${Math.round(n * 100) / 100}`;

function ProposalCardView({ card, now, busy, onCheckout }: { card: OrderProposalCard; now: number; busy: boolean; onCheckout: (c: OrderProposalCard) => void }) {
  const expired = new Date(card.expiresAt).getTime() <= now;
  return (
    <View style={[styles.card, expired && { opacity: 0.6 }]} accessibilityLabel={`Order suggestion from ${card.canteen.name}, total ${rupees(card.subtotal)}`}>
      <Text style={styles.cardTitle}>{card.canteen.name}</Text>
      {card.items.map((it) => (
        <View key={it.menuItemId} style={styles.lineRow}>
          <Text style={styles.lineName} numberOfLines={2}>{it.quantity} x {it.name} ({rupees(it.unitPrice)} each)</Text>
          <Text style={styles.linePrice}>{rupees(it.lineTotal)}</Text>
        </View>
      ))}
      <View style={[styles.lineRow, styles.totalRow]}>
        <Text style={styles.totalLabel}>Subtotal</Text>
        <Text style={styles.totalLabel}>{rupees(card.subtotal)}</Text>
      </View>
      <Text style={styles.slotText}>{card.slot ? `Pickup ${card.slot.startTime} - ${card.slot.endTime}` : 'Pick a time at checkout'}</Text>
      {card.warnings.map((w, i) => <Text key={i} style={styles.warning}>{w}</Text>)}
      {expired && <Text style={styles.warning}>This suggestion has expired. Ask again to get a fresh one.</Text>}
      <TouchableOpacity
        style={[styles.primaryBtn, (expired || busy) && { opacity: 0.4 }]}
        disabled={expired || busy}
        onPress={() => onCheckout(card)}
        accessibilityRole="button"
        accessibilityLabel="Review and checkout"
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Review & checkout</Text>}
      </TouchableOpacity>
    </View>
  );
}

function ItemsCardView({ card, onItem }: { card: ItemsCard; onItem: (canteenId: string) => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{card.title}</Text>
      {card.items.map((it) => (
        <TouchableOpacity
          key={it.menuItemId}
          style={styles.lineRow}
          onPress={() => onItem(it.canteenId)}
          accessibilityRole="button"
          accessibilityLabel={`${it.name}, ${rupees(it.price)}, ${it.canteenName}. Opens the canteen menu.`}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{it.name}</Text>
            <Text style={styles.meta}>{it.canteenName} - {it.prepTimeMinutes} min</Text>
          </View>
          <Text style={styles.linePrice}>{rupees(it.price)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  menuBtn: { paddingHorizontal: 12, paddingVertical: 4 },
  menuText: { fontSize: 24, fontWeight: '700', color: '#1a1a2e' },
  notice: { backgroundColor: '#fff7ed', padding: 10 },
  noticeText: { color: '#9a3412', fontSize: 12, textAlign: 'center' },
  empty: { padding: 24, alignItems: 'center', transform: [{ scaleY: -1 }] },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e' },
  emptyText: { fontSize: 13, color: '#666', marginTop: 6, textAlign: 'center' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  progressText: { color: '#666', fontSize: 13 },
  problem: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginVertical: 8, alignItems: 'center' },
  problemText: { color: '#444', fontSize: 14, textAlign: 'center' },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  mine: { backgroundColor: '#e94560' },
  theirs: { backgroundColor: '#fff', elevation: 1 },
  mineText: { color: '#fff', fontSize: 15 },
  theirsText: { color: '#1a1a2e', fontSize: 15 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginTop: 8, width: '92%', elevation: 2 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, gap: 8 },
  lineName: { flex: 1, fontSize: 14, color: '#1a1a2e' },
  linePrice: { fontSize: 14, fontWeight: '600', color: '#1a1a2e' },
  meta: { fontSize: 12, color: '#666' },
  totalRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ddd', marginTop: 4 },
  totalLabel: { fontSize: 14, fontWeight: '700', color: '#1a1a2e' },
  slotText: { fontSize: 13, color: '#444', marginTop: 6 },
  warning: { fontSize: 12, color: '#b45309', marginTop: 6 },
  primaryBtn: { backgroundColor: '#e94560', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', marginTop: 12 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: '#e94560', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: '#e94560', fontSize: 13, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, gap: 8, backgroundColor: '#fff', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ddd' },
  input: { backgroundColor: '#f1f3f5', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, maxHeight: 110, fontSize: 15, color: '#1a1a2e' },
  counter: { fontSize: 11, color: '#999', textAlign: 'right', marginTop: 2 },
  sendBtn: { backgroundColor: '#e94560', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 18 },
  sendText: { color: '#fff', fontWeight: '700' },
  modalBack: { flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, color: '#1a1a2e' },
  reasonBtn: { paddingVertical: 14 },
  reasonText: { fontSize: 15, color: '#1a1a2e' },
});
