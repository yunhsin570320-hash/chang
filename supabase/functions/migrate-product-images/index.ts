import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // This is a privileged maintenance operation that rewrites every product row,
    // so it requires an administrator session and never runs for anonymous callers.
    const body = await req.json().catch(() => ({}));
    const sessionToken = typeof body?.sessionToken === "string" ? body.sessionToken : "";
    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: sessionUser, error: sessionError } = await supabase.rpc(
      "rpc_validate_session",
      { p_token: sessionToken },
    );

    if (
      sessionError || !sessionUser ||
      (sessionUser as Record<string, unknown>).is_admin !== true
    ) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch all products that still have base64 image_url
    const { data: products, error: fetchError } = await supabase
      .from("products")
      .select("id, image_url")
      .like("image_url", "data:%");

    if (fetchError) throw fetchError;

    const total = products?.length ?? 0;
    let migrated = 0;
    let failed = 0;

    for (const product of products ?? []) {
      try {
        const commaIdx = product.image_url.indexOf(",");
        if (commaIdx === -1) continue;

        const header = product.image_url.slice(0, commaIdx);
        const base64Data = product.image_url.slice(commaIdx + 1);
        const mimeMatch = header.match(/data:([^;]+)/);
        const mime = mimeMatch?.[1] ?? "image/jpeg";
        const ext = mime === "image/png" ? "png" : "jpg";

        // Decode base64 → binary
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const path = `product-${product.id}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(path, bytes, { contentType: mime, upsert: true });

        if (uploadError) {
          console.error("upload failed", product.id, uploadError);
          failed++;
          continue;
        }

        const { data: urlData } = supabase.storage
          .from("product-images")
          .getPublicUrl(path);

        const { error: updateError } = await supabase
          .from("products")
          .update({ image_url: urlData.publicUrl })
          .eq("id", product.id);

        if (updateError) {
          console.error("update failed", product.id, updateError);
          failed++;
        } else {
          migrated++;
        }
      } catch (err) {
        console.error("migration error", product.id, err);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ total, migrated, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("migrate-product-images failed", err);
    return new Response(
      JSON.stringify({ error: "Migration failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
