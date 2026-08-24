import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BUCKET = "product-images";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// Resolve the caller from the app's own session token. Returns null when invalid.
async function resolveUser(
  client: ReturnType<typeof serviceClient>,
  sessionToken: unknown,
): Promise<{ id: string } | null> {
  if (typeof sessionToken !== "string" || sessionToken.length < 16) return null;
  const { data, error } = await client.rpc("rpc_validate_session", { p_token: sessionToken });
  if (error || !data || typeof data !== "object" || !("id" in data)) return null;
  const user = data as Record<string, unknown>;
  if (typeof user.id !== "string") return null;
  return { id: user.id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const client = serviceClient();
    const contentType = req.headers.get("content-type") || "";

    let sessionToken: unknown = null;
    let bytes: Uint8Array | null = null;
    let mime = "";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      sessionToken = form.get("sessionToken");
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "圖片格式不正確" }, 400);
      mime = (file.type || "").toLowerCase();
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const body = await req.json().catch(() => ({}));
      sessionToken = body?.sessionToken;
      const source = typeof body?.dataUrl === "string" ? body.dataUrl : "";
      const commaIdx = source.indexOf(",");
      if (!source.startsWith("data:") || commaIdx < 0) {
        return json({ error: "圖片格式不正確" }, 400);
      }
      mime = source.slice(5, commaIdx).split(";")[0].toLowerCase();
      try {
        const binary = atob(source.slice(commaIdx + 1));
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } catch {
        return json({ error: "圖片資料無法解析" }, 400);
      }
    }

    // Uploads require a valid app session: storage is not open to the internet.
    const user = await resolveUser(client, sessionToken);
    if (!user) return json({ error: "登入已過期，請重新登入" }, 401);

    const ext = ALLOWED_MIME[mime];
    if (!ext) return json({ error: "僅接受 JPG、PNG 或 WebP 圖片" }, 400);
    if (!bytes || bytes.byteLength === 0) return json({ error: "圖片資料為空" }, 400);
    if (bytes.byteLength > MAX_BYTES) return json({ error: "圖片大小不可超過 10MB" }, 400);

    const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error } = await client.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mime === "image/jpg" ? "image/jpeg" : mime, upsert: false });

    if (error) {
      console.error("product-image upload failed", error);
      return json({ error: "圖片上傳失敗，請稍後再試" }, 500);
    }

    const { data } = client.storage.from(BUCKET).getPublicUrl(path);
    return json({ path, url: data.publicUrl });
  } catch (err) {
    console.error("product-image error", err);
    return json({ error: "伺服器錯誤" }, 500);
  }
});
