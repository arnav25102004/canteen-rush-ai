import axios from 'axios';
import api from './api';

export type ChipAction =
  | { type: 'reorder_last' | 'earliest_slot' | 'add_drink' | 'popular_now' }
  | { type: 'navigate'; target: 'menu' };

export interface Chip {
  label: string;
  action: ChipAction;
}

export interface OrderProposalCard {
  type: 'order_proposal';
  proposalId: string;
  canteen: { id: string; name: string };
  slot: { id: string; date: string; startTime: string; endTime: string } | null;
  items: Array<{ menuItemId: string; name: string; quantity: number; unitPrice: number; lineTotal: number; isVeg: boolean }>;
  subtotal: number;
  expiresAt: string;
  warnings: string[];
}

export interface ItemsCard {
  type: 'items';
  title: string;
  items: Array<{
    menuItemId: string;
    name: string;
    price: number;
    isVeg: boolean;
    prepTimeMinutes: number;
    canteenId: string;
    canteenName: string;
  }>;
}

export type AssistantCard = OrderProposalCard | ItemsCard;

export interface AssistantReply {
  id: string;
  text: string;
  cards: AssistantCard[];
  chips: Chip[];
}

export interface TurnResponse {
  conversationId: string;
  reply: AssistantReply;
  degraded?: boolean;
  usage?: { turnsLeftToday: number };
}

export interface StoredMessage {
  id: string;
  role: 'USER' | 'ASSISTANT';
  text: string;
  cards: AssistantCard[];
  chips: Chip[];
  clientTurnId: string | null;
  createdAt: string;
}

export interface CurrentConversation {
  conversationId: string | null;
  busy: boolean;
  messages: StoredMessage[];
}

export interface Capabilities {
  enabled: boolean;
  available: boolean;
  reason?: string;
  turnsLeftToday: number;
}

export interface HandOff {
  canteenId: string;
  canteenName: string;
  items: Array<{ menuItemId: string; name: string; price: number; isVeg: boolean; quantity: number }>;
  slot: { id: string; date: string; startTime: string; endTime: string } | null;
  changes: string[];
}

export type ReportReason = 'OFFENSIVE' | 'WRONG_INFO' | 'OFF_TOPIC' | 'OTHER';

const TURN_TIMEOUT_MS = 45000;
const RECOVER_DELAY_MS = 3000;

/** RFC 4122 v4 id. Hermes has no crypto.randomUUID, so this uses Math.random. */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function getCapabilities(): Promise<Capabilities> {
  const { data } = await api.get('/assistant/capabilities');
  return data;
}

export async function getCurrentConversation(): Promise<CurrentConversation> {
  const { data } = await api.get('/assistant/conversations/current');
  return data;
}

export async function newConversation(): Promise<string> {
  const { data } = await api.post('/assistant/conversations');
  return data.conversationId;
}

export async function deleteAllChats(): Promise<void> {
  await api.delete('/assistant/conversations');
}

export async function handOff(proposalId: string): Promise<HandOff> {
  const { data } = await api.post(`/assistant/proposals/${proposalId}/checkout`);
  return data;
}

export async function reportMessage(messageId: string, reason: ReportReason, note?: string): Promise<void> {
  await api.post(`/assistant/messages/${messageId}/report`, { reason, ...(note ? { note } : {}) });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isTimeoutOrNetwork(err: unknown): boolean {
  return axios.isAxiosError(err) && (!err.response || err.code === 'ECONNABORTED');
}

/**
 * Sends one turn. A POST is never retried automatically (the shared api client retries only
 * GET/HEAD). After a timeout or network error the reply may still have been saved by the
 * server, so the current conversation is polled twice (3s apart) for the same clientTurnId.
 */
export async function sendTurn(body: {
  conversationId?: string | null;
  clientTurnId: string;
  message?: string;
  action?: ChipAction;
}): Promise<TurnResponse> {
  try {
    const { data } = await api.post(
      '/assistant/turn',
      { ...body, conversationId: body.conversationId ?? undefined },
      { timeout: TURN_TIMEOUT_MS },
    );
    return data;
  } catch (err) {
    if (!isTimeoutOrNetwork(err)) throw err;
    for (let i = 0; i < 2; i++) {
      await sleep(RECOVER_DELAY_MS);
      try {
        const cur = await getCurrentConversation();
        const reply = cur.messages.find((m) => m.role === 'ASSISTANT' && m.clientTurnId === body.clientTurnId);
        if (reply && cur.conversationId) {
          return { conversationId: cur.conversationId, reply: { id: reply.id, text: reply.text, cards: reply.cards, chips: reply.chips } };
        }
      } catch {
        // keep trying
      }
    }
    throw err;
  }
}
