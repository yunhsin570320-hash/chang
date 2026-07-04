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
      const text = await res.text();
      return { data: null, error: { message: text } };
    }
    return await res.json();
  } catch (e: any) {
    return { data: null, error: { message: e.message || 'Network error' } };
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

export type ErpRole = 'admin' | 'manager' | 'operator' | 'viewer';

export type Profile = {
  id: string;
  name: string;
  email?: string;
  erp_role?: ErpRole;
  is_admin?: boolean;
  created_at: string;
};

export type RawMaterial = {
  id: string;
  code: string;
  name: string;
  unit: string;
  safety_stock: number;
  current_stock: number;
  supplier?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
};

export type MaterialTransaction = {
  id: string;
  material_id: string;
  type: 'receive' | 'consume' | 'adjust';
  quantity: number;
  reference?: string;
  operator_id?: string;
  notes?: string;
  created_at: string;
  operator?: Pick<Profile, 'id' | 'name'>;
};

export type ErpProduct = {
  id: string;
  code: string;
  name: string;
  unit: string;
  specific_gravity: number;
  drum_capacity_liters: number;
  safety_stock: number;
  current_stock: number;
  notes?: string;
  created_at: string;
  updated_at: string;
};

export type ProductFormula = {
  id: string;
  product_id: string;
  material_id: string;
  quantity_per_100kg: number;
  notes?: string;
  material?: RawMaterial;
};

export type ProductionOrder = {
  id: string;
  order_number: string;
  product_id: string;
  planned_quantity: number;
  actual_quantity?: number;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  operator_id?: string;
  started_at?: string;
  completed_at?: string;
  notes?: string;
  created_at: string;
  created_by?: string;
  product?: ErpProduct;
  operator?: Pick<Profile, 'id' | 'name'>;
};

export type ProductionConsumption = {
  id: string;
  order_id: string;
  material_id: string;
  planned_quantity: number;
  actual_quantity?: number;
  material?: RawMaterial;
};

export type ErpShipment = {
  id: string;
  shipment_number: string;
  product_id: string;
  quantity_kg: number;
  kg_per_drum?: number;
  drums_count?: number;
  customer: string;
  destination?: string;
  operator_id?: string;
  shipped_at: string;
  notes?: string;
  created_at: string;
  product?: ErpProduct;
  operator?: Pick<Profile, 'id' | 'name'>;
};

export type PurchaseAlert = {
  id: string;
  material_id: string;
  triggered_at: string;
  current_stock: number;
  safety_stock: number;
  is_resolved: boolean;
  resolved_at?: string;
  resolved_by?: string;
  material?: RawMaterial;
};
