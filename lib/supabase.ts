import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export async function callRpc<T = any>(
  fn: string,
  args?: Record<string, any>
): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/rpc-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ fn, args: args || {} }),
    });
    if (!res.ok) {
      // Never surface the raw response body: it can carry backend detail.
      const body = await res.json().catch(() => null);
      const message = body?.error?.message;
      return {
        data: null,
        error: { message: typeof message === 'string' ? message : '操作失敗，請稍後再試' },
      };
    }
    return await res.json();
  } catch {
    return { data: null, error: { message: '網路連線失敗，請稍後再試' } };
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

export type Profile = {
  id: string;
  name: string;
  email?: string;
  role?: 'seller' | 'buyer';
  is_buyer?: boolean;
  is_seller?: boolean;
  is_admin?: boolean;
  is_blocked?: boolean;
  blocked_reason?: string;
  blocked_at?: string;
  warning_count?: number;
  phone?: string;
  phone_verified?: boolean;
  phone_verified_at?: string;
  payment_method?: string;
  bank_account?: string;
  shipping_address?: string;
  created_at: string;
  membership_tier?: 'free' | 'vip';
  vip_upgrade_paid?: boolean;
  vip_deposit_paid?: boolean;
  vip_upgrade_at?: string;
  vip_deposit_at?: string;
  membership_number?: number;
  is_lifetime?: boolean;
  last_seen_at?: string;
  lock_reason?: string;
  locked_at?: string;
  unlock_requested_at?: string;
  unlock_reason?: string;
  bid_abandon_count?: number;
};

export type Report = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  product_id?: string | null;
  type: 'fake_product' | 'abandon_bid' | 'fraud' | 'spam' | 'other';
  reason: string;
  status: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
  resolved_by?: string | null;
  resolved_at?: string | null;
  admin_note?: string | null;
  created_at: string;
  reporter?: Profile;
  reported_user?: Profile;
  product?: Product;
};

export type AdminAction = {
  id: string;
  admin_id: string;
  target_user_id?: string | null;
  product_id?: string | null;
  action_type: 'warn' | 'block' | 'unblock' | 'remove_product' | 'approve_product' | 'resolve_report' | 'dismiss_report';
  reason: string;
  created_at: string;
  admin?: Profile;
  target_user?: Profile;
};

export type Notification = {
  id: string;
  user_id: string;
  type: 'won' | 'lost' | 'auction_ended' | 'new_bid';
  title: string;
  message: string;
  product_id?: string | null;
  is_read: boolean;
  created_at: string;
};

export type Product = {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  seller_id: string;
  end_time?: string;
  status: 'active' | 'ended';
  winner_id: string | null;
  winning_amount: number | null;
  is_flagged?: boolean;
  flag_reason?: string | null;
  is_approved?: boolean;
  reserve_price?: number;
  is_direct_buy?: boolean;
  direct_price?: number | null;
  stock_quantity?: number;
  shipping_fee?: number;
  created_at: string;
  seller?: Profile;
  winner?: Profile | null;
};

export type PaymentRequest = {
  id: string;
  type: 'vip_upgrade' | 'vip_deposit';
  amount: number;
  payment_method?: string | null;
  proof_image_url: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_note?: string | null;
  created_at: string;
  reviewed_at?: string | null;
};

export type MemberStats = {
  total_users: number;
  online_count: number;
  paid_members: number;
  lifetime_members: number;
};

export async function getMemberStats(): Promise<MemberStats | null> {
  const { data } = await callRpc<MemberStats>('rpc_get_member_stats');
  return data;
}

export async function heartbeat(sessionToken: string): Promise<void> {
  callRpc('rpc_heartbeat', { p_token: sessionToken }).then(() => {}, () => {});
}

export type Bid = {
  id: string;
  product_id: string;
  bidder_id: string;
  amount: number;
  created_at: string;
  bidder?: Profile;
};

export async function uploadProductImage(source: string): Promise<string> {
  if (!source) return '';
  // Pass through remote URLs unchanged
  if (!source.startsWith('data:') && !source.startsWith('file://') && !source.startsWith('content://')) {
    return source;
  }

  const path = `product-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  if (source.startsWith('data:')) {
    // Decode base64 data URL — works on all browsers and React Native (atob is universal)
    const commaIdx = source.indexOf(',');
    const header = source.slice(0, commaIdx);
    const base64Data = source.slice(commaIdx + 1);
    const mime = header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg';
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    const filename = `${path}.${ext}`;

    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const { error } = await supabase.storage
      .from('product-images')
      .upload(filename, bytes.buffer as ArrayBuffer, { contentType: mime, upsert: false });

    if (error) throw new Error(`Storage upload failed: ${error.message}`);

    const { data } = supabase.storage.from('product-images').getPublicUrl(filename);
    return data.publicUrl;
  }

  // file:// or content:// URI (Expo native) — use FormData with direct REST upload
  const uriExt = source.split('?')[0].split('.').pop()?.toLowerCase() ?? 'jpg';
  const mime = uriExt === 'png' ? 'image/png' : 'image/jpeg';
  const filename = `${path}.${uriExt === 'png' ? 'png' : 'jpg'}`;

  const formData = new FormData();
  formData.append('file', { uri: source, type: mime, name: filename } as any);

  const res = await fetch(
    `${supabaseUrl}/storage/v1/object/product-images/${filename}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseAnonKey}`,
        apikey: supabaseAnonKey,
      },
      body: formData,
    }
  );
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status.toString());
    throw new Error(`Storage upload failed: ${msg}`);
  }
  return `${supabaseUrl}/storage/v1/object/public/product-images/${filename}`;
}

export async function uploadPaymentProof(
  source: string,
  sessionToken: string
): Promise<string> {
  if (!source) return '';
  if (!source.startsWith('data:')) {
    throw new Error('unsupported-source');
  }

  // Proofs are private: the server validates the session, checks the file type and
  // size, stores the object in a private bucket and returns its path only.
  const res = await fetch(`${supabaseUrl}/functions/v1/payment-proof?action=upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({ sessionToken, dataUrl: source }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.path) {
    throw new Error(body?.error || 'upload-failed');
  }
  return body.path as string;
}

export async function getPaymentProofUrl(
  path: string,
  sessionToken: string
): Promise<string | null> {
  if (!path) return null;
  // Legacy rows stored a full URL rather than a bucket path.
  if (path.startsWith('http')) return path;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/payment-proof?action=view`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ sessionToken, path }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.url) return null;
    return body.url as string;
  } catch {
    return null;
  }
}

export type EcPayOrder = {
  id: string;
  delivery_id: string;
  merchant_trade_no: string;
  total_amount: number;
  item_name: string;
  trade_status: 'pending' | 'paid' | 'failed' | 'expired';
  payment_type?: string | null;
  ecpay_trade_no?: string | null;
  paid_at?: string | null;
  created_at: string;
};

export async function sendPhoneOtp(
  phone: string
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-sms-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ phone }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      return { ok: false, error: body?.error || '驗證碼發送失敗，請稍後再試' };
    }
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: '驗證碼發送失敗，請檢查網路連線' };
  }
}

export async function initiateECPayCheckout(
  merchantTradeNo: string,
  sessionToken: string
): Promise<{ checkoutUrl: string | null; error: string | null }> {
  try {
    // The amount, item name and callback URLs are decided by the server from the
    // stored order. Nothing about the payment is taken from this request body.
    const res = await fetch(`${supabaseUrl}/functions/v1/ecpay?action=checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ merchantTradeNo, sessionToken }),
    });

    if (!res.ok) {
      return { checkoutUrl: null, error: '付款請求失敗，請稍後再試' };
    }

    // The edge function returns HTML that auto-submits to ECPay
    // We open it in a new window
    const html = await res.text();
    const blob = new Blob([html], { type: 'text/html' });
    const checkoutUrl = URL.createObjectURL(blob);

    return { checkoutUrl, error: null };
  } catch {
    return { checkoutUrl: null, error: '付款請求失敗，請檢查網路連線' };
  }
}

export async function sendAuctionNotifications(
  productId: string,
  productName: string,
  winnerId: string | null,
  winningAmount: number | null,
  allBidderIds: string[]
) {
  const notifications = allBidderIds.map(bidderId => {
    const isWinner = bidderId === winnerId;
    return {
      user_id: bidderId,
      product_id: productId,
      type: (isWinner ? 'won' : 'lost') as 'won' | 'lost',
      title: isWinner ? '恭喜您得標！' : '競標結果通知',
      message: isWinner
        ? `您以 NT$ ${(winningAmount || 0).toLocaleString()} 成功得標「${productName}」，請等候賣家聯繫交付事宜。`
        : `很遺憾，您未能得標「${productName}」，感謝您的參與。`,
      is_read: false,
    };
  });

  if (notifications.length > 0) {
    await supabase.from('notifications').insert(notifications);
  }
}
