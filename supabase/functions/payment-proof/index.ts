import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BUCKET = "payment-proofs";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
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
): Promise<{ id: string; is_admin: boolean } | null> {
  if (typeof sessionToken !== "string" || sessionToken.length < 16) return null;
  const { data, error } = await client.rpc("rpc_validate_session", { p_token: sessionToken });
  if (error || !data || typeof data !== "object" || !("id" in data)) return null;
  const user = data as Record<string, unknown>;
  if (typeof user.id !== "string") return null;
  return { id: user.id, is_admin: user.is_admin === true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const action = new URL(req.url).searchParams.get("action") || "upload";

  try {
    const body = await req.json().catch(() => ({}));
    const client = serviceClient();
    const user = await resolveUser(client, body?.sessionToken);
    if (!user) return json({ error: "登入已過期，請重新登入" }, 401);

    if (action === "upload") {
      const source = typeof body?.dataUrl === "string" ? body.dataUrl : "";
      const commaIdx = source.indexOf(",");
      if (!source.startsWith("data:") || commaIdx < 0) {
        return json({ error: "圖片格式不正確" }, 400);
      }

      const mime = source.slice(5, commaIdx).split(";")[0].toLowerCase();
      const ext = ALLOWED_MIME[mime];
      if (!ext) return json({ error: "僅接受 JPG、PNG 或 WebP 圖片" }, 400);

      let bytes: Uint8Array;
      try {
        const binary = atob(source.slice(commaIdx + 1));
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } catch {
        return json({ error: "圖片資料無法解析" }, 400);
      }

      if (bytes.byteLength === 0) return json({ error: "圖片資料為空" }, 400);
      if (bytes.byteLength > MAX_BYTES) return json({ error: "圖片大小不可超過 5MB" }, 400);

      const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error } = await client.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: mime, upsert: false });

      if (error) {
        console.error("payment-proof upload failed", error);
        return json({ error: "圖片上傳失敗，請稍後再試" }, 500);
      }

      return json({ path });
    }

    if (action === "view") {
      const path = typeof body?.path === "string" ? body.path : "";
      if (!path || path.includes("..")) return json({ error: "找不到圖片" }, 400);

      // Only the uploader or an admin may see a proof.
      const isOwner = path.startsWith(`${user.id}/`);
      if (!isOwner && !user.is_admin) return json({ error: "無權檢視此圖片" }, 403);

      const { data, error } = await client.storage
        .from(BUCKET)
        .createSignedUrl(path, 300);

      if (error || !data?.signedUrl) {
        console.error("payment-proof sign failed", error);
        return json({ error: "無法取得圖片" }, 500);
      }

      return json({ url: data.signedUrl });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("payment-proof error", err);
    return json({ error: "伺服器錯誤" }, 500);
  }
});
