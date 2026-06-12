import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

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
  password_hash?: string;
  phone?: string;
  phone_verified?: boolean;
  phone_verified_at?: string;
  payment_method?: string;
  bank_account?: string;
  shipping_address?: string;
  created_at: string;
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
  created_at: string;
  seller?: Profile;
  winner?: Profile | null;
};

export type Bid = {
  id: string;
  product_id: string;
  bidder_id: string;
  amount: number;
  created_at: string;
  bidder?: Profile;
};

export const PREDEFINED_USERS: Profile[] = [
  { id: '00000000-0000-0000-0000-000000000001', name: '賣家小明', role: 'seller', is_buyer: true, is_seller: true, email: 'seller1@test.com', created_at: '' },
  { id: '00000000-0000-0000-0000-000000000002', name: '買家小華', role: 'buyer', is_buyer: true, is_seller: false, email: 'buyer1@test.com', created_at: '' },
  { id: '00000000-0000-0000-0000-000000000003', name: '買家小美', role: 'buyer', is_buyer: true, is_seller: false, email: 'buyer2@test.com', created_at: '' },
];

export async function uploadProductImage(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith('data:')) return dataUrl;

  const commaIdx = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, commaIdx);
  const base64Data = dataUrl.slice(commaIdx + 1);
  const mimeMatch = header.match(/data:([^;]+)/);
  const mime = mimeMatch?.[1] ?? 'image/jpeg';
  const ext = mime === 'image/png' ? 'png' : 'jpg';

  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const path = `product-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from('product-images')
    .upload(path, bytes, { contentType: mime, upsert: true });

  if (error) throw error;

  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
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
