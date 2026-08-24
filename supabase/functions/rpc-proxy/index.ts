import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ── CORS: restrict to configured app origin ──
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "*";

function corsHeaders(origin?: string): Record<string, string> {
  const allowed = APP_ORIGIN === "*" ? "*" : (origin === APP_ORIGIN ? origin : APP_ORIGIN);
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    "Vary": "Origin",
  };
}

// ── Rate limiting: simple in-memory token bucket per IP ──
// 60 requests per 10 seconds per IP (burst), refills continuously
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 60;
const ipBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = ipBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    ipBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_MAX;
}

// Clean up expired buckets periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of ipBuckets) {
    if (now > bucket.resetAt) ipBuckets.delete(ip);
  }
}, 60_000);

// ── Stricter bucket for credential endpoints ──
// Signup, login and password reset answer differently for an existing account,
// so they are an enumeration oracle unless the attempt rate is bounded.
const AUTH_WINDOW_MS = 60_000;
const AUTH_MAX = 10;
const AUTH_FUNCTIONS = new Set(["rpc_login", "rpc_register", "rpc_request_password_reset", "rpc_reset_password_v2", "rpc_verify_otp"]);
const authBuckets = new Map<string, { count: number; resetAt: number }>();

function checkAuthRateLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = authBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + AUTH_WINDOW_MS };
    authBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= AUTH_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of authBuckets) {
    if (now > bucket.resetAt) authBuckets.delete(ip);
  }
}, 60_000);

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
}

const ALLOWED_FUNCTIONS = new Set([
  "rpc_login",
  "rpc_register",
  "rpc_validate_session",
  "rpc_logout",
  "rpc_update_profile",
  "rpc_mark_notifications_read",
  "rpc_seller_create_product",
  "rpc_seller_end_auction",
  "rpc_seller_relist_product",
  "rpc_seller_delete_product",
  "rpc_seller_archive_products",
  "rpc_seller_create_delivery",
  "rpc_seller_update_delivery",
  "rpc_admin_action",
  "rpc_file_report",
  "rpc_direct_buy",
  "rpc_place_bid",
  "rpc_verify_otp",
  "rpc_buyer_mark_paid",
  "rpc_seller_confirm_payment",
  "rpc_seller_create_product_v2",
  "rpc_place_bid_v2",
  "rpc_admin_lock_user",
  "rpc_admin_unlock_user",
  "rpc_file_complaint",
  "rpc_admin_resolve_complaint",
  "rpc_admin_delete_product",
  "rpc_admin_delete_ended_products",
  "rpc_request_password_reset",
  "rpc_reset_password_v2",
  "rpc_create_ecpay_order",
  "rpc_heartbeat",
  "rpc_get_member_stats",
  "rpc_admin_get_members",
  "rpc_admin_get_dashboard",
  "rpc_admin_get_reports",
  "rpc_admin_get_complaints",
  "rpc_admin_get_payment_requests",
  "rpc_admin_get_action_log",
  "rpc_submit_payment_request",
  "rpc_get_my_payment_requests",
  "rpc_admin_review_payment_request",
  "rpc_get_site_settings",
  "rpc_admin_update_site_setting",
]);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || undefined;
  const hdrs = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: hdrs });
  }

  // Rate limit check
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ data: null, error: { message: "請求過於頻繁，請稍後再試" } }),
      { status: 429, headers: { ...hdrs, "Content-Type": "application/json", "Retry-After": "10" } }
    );
  }

  // Origin check when APP_ORIGIN is configured
  if (APP_ORIGIN !== "*" && origin && origin !== APP_ORIGIN) {
    return new Response(
      JSON.stringify({ data: null, error: { message: "Forbidden origin" } }),
      { status: 403, headers: { ...hdrs, "Content-Type": "application/json" } }
    );
  }

  try {
    const { fn, args } = await req.json();

    if (!fn || !ALLOWED_FUNCTIONS.has(fn)) {
      return new Response(
        JSON.stringify({ data: null, error: { message: "Function not allowed" } }),
        { status: 403, headers: { ...hdrs, "Content-Type": "application/json" } }
      );
    }

    if (AUTH_FUNCTIONS.has(fn) && !checkAuthRateLimit(ip)) {
      return new Response(
        JSON.stringify({ data: null, error: { message: "嘗試次數過多，請稍後再試" } }),
        { status: 429, headers: { ...hdrs, "Content-Type": "application/json", "Retry-After": "60" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data, error } = await supabase.rpc(fn, args || {});

    if (error) {
      console.error("rpc failed", fn, error);
      // Only messages the application raised on purpose (RAISE EXCEPTION -> P0001)
      // are user-facing. Every other Postgres error (constraint names, missing
      // columns, permission denials) leaks internal detail, so it is replaced.
      const isAppMessage = error.code === "P0001" && !!error.message;
      const safeMsg = isAppMessage ? error.message : "操作失敗，請稍後再試";
      return new Response(
        JSON.stringify({ data: null, error: { message: safeMsg } }),
        { status: 200, headers: { ...hdrs, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ data, error: null }), {
      headers: { ...hdrs, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ data: null, error: { message: "Internal server error" } }),
      { status: 500, headers: { ...hdrs, "Content-Type": "application/json" } }
    );
  }
});
