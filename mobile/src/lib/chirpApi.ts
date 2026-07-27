import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export const isApiConfigured = Boolean(apiUrl);

export class ApiError extends Error {
  constructor(
    message: string,
    public code = 'REQUEST_FAILED',
    public status = 0,
  ) {
    super(message);
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiUrl) throw new ApiError('请先配置 EXPO_PUBLIC_API_URL。', 'API_NOT_CONFIGURED');

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('登录已失效，请重新登录。', 'AUTH_REQUIRED', 401);

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      error?.message || payload?.message || '请求失败，请稍后重试。',
      error?.code || 'REQUEST_FAILED',
      response.status,
    );
  }
  return payload as T;
}

export type CoupleSpace = {
  planetId: string;
  conversationId: string;
  title: string;
};

export type CoupleInvite = {
  code: string;
  expiresAt?: string;
  status?: string;
  reused?: boolean;
};

export type ChatMessage = {
  id: string;
  senderType: 'user' | 'agent' | 'bird' | 'memo';
  senderId?: string;
  agentId?: string;
  text: string;
  createdAt: number;
};

function toChatMessage(row: Record<string, unknown>): ChatMessage {
  const senderType = String(row.sender_type || row.type || 'user') as ChatMessage['senderType'];
  return {
    id: String(row.id),
    senderType,
    senderId: row.sender_id ? String(row.sender_id) : undefined,
    agentId: senderType === 'agent' && row.sender_id ? String(row.sender_id) : undefined,
    text: String(row.text || ''),
    createdAt: row.created_at
      ? new Date(String(row.created_at)).getTime()
      : Number(row.createdAt || Date.now()),
  };
}

export async function createCoupleInvite() {
  return apiRequest<CoupleInvite>('/api/chirp/couple/invite', { method: 'POST', body: '{}' });
}

export async function redeemCoupleInvite(code: string) {
  return apiRequest<{ planetId: string; conversationId: string; alreadyRedeemed: boolean }>(
    `/api/chirp/couple/invite/${encodeURIComponent(code.trim().toUpperCase())}/redeem`,
    { method: 'POST', body: '{}' },
  );
}

export async function loadConversationMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chirp_messages')
    .select('id, sender_type, sender_id, text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) throw error;
  return (data || []).map((row) => toChatMessage(row)).reverse();
}

export async function sendCoupleMessage(conversationId: string, text: string) {
  const result = await apiRequest<{ success: boolean; messages: Record<string, unknown>[] }>(
    '/api/chirp/turn',
    {
      method: 'POST',
      body: JSON.stringify({
        conversation: { id: conversationId, type: 'group' },
        texts: [text],
        agents: [],
        members: [],
        messages: [],
        tzOffset: -new Date().getTimezoneOffset(),
      }),
    },
  );
  return (result.messages || []).map(toChatMessage);
}

export function subscribeToConversation(
  conversationId: string,
  onMessage: (message: ChatMessage) => void,
) {
  const channel = supabase
    .channel(`chirp-mobile:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chirp_messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onMessage(toChatMessage(payload.new as Record<string, unknown>)),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Read-only client queries remain protected by membership RLS. All sensitive
// writes (invite creation/redeem, later mediation) stay behind the Node API.
export async function loadCoupleSpace(userId: string): Promise<CoupleSpace | null> {
  if (!isSupabaseConfigured || !userId) return null;

  const { data: memberships, error: membershipError } = await supabase
    .from('chirp_conversation_members')
    .select('conversation_id')
    .eq('member_type', 'user')
    .eq('member_id', userId);
  if (membershipError) throw membershipError;

  const conversationIds = (memberships || []).map((row) => row.conversation_id).filter(Boolean);
  if (!conversationIds.length) return null;

  const { data: conversations, error: conversationError } = await supabase
    .from('chirp_conversations')
    .select('id, planet_id, title')
    .in('id', conversationIds)
    .eq('type', 'group');
  if (conversationError) throw conversationError;

  const planetIds = (conversations || []).map((row) => row.planet_id).filter(Boolean);
  if (!planetIds.length) return null;

  const { data: planets, error: planetError } = await supabase
    .from('chirp_planets')
    .select('id, name')
    .in('id', planetIds)
    .eq('type', 'couple')
    .limit(1);
  if (planetError) throw planetError;

  const planet = planets?.[0];
  if (!planet) return null;
  const conversation = conversations?.find((row) => row.planet_id === planet.id);
  if (!conversation) return null;

  return {
    planetId: planet.id,
    conversationId: conversation.id,
    title: conversation.title || planet.name || '我们的空间',
  };
}
