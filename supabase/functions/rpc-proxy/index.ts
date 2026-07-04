import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { fn, args } = await req.json();

    if (!fn || !ALLOWED_FUNCTIONS.has(fn)) {
      return new Response(
        JSON.stringify({ data: null, error: { message: "Function not allowed" } }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data, error } = await supabase.rpc(fn, args || {});

    return new Response(JSON.stringify({ data, error }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ data: null, error: { message: "Internal server error" } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
