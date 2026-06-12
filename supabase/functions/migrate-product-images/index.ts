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

    // Fetch all products that still have base64 image_url
    const { data: products, error: fetchError } = await supabase
      .from("products")
      .select("id, image_url")
      .like("image_url", "data:%");

    if (fetchError) throw fetchError;

    const total = products?.length ?? 0;
    let migrated = 0;
    const errors: string[] = [];

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
          errors.push(`${product.id}: ${uploadError.message}`);
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
          errors.push(`${product.id}: update failed - ${updateError.message}`);
        } else {
          migrated++;
        }
      } catch (err: any) {
        errors.push(`${product.id}: ${err?.message ?? "unknown error"}`);
      }
    }

    return new Response(
      JSON.stringify({ total, migrated, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
