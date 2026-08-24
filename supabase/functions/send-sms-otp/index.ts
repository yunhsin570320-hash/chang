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

// ── Rate limiting: 5 OTP requests per 10 minutes per IP ──
const RATE_WINDOW_MS = 600_000; // 10 minutes
const RATE_MAX = 5;
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

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of ipBuckets) {
    if (now > bucket.resetAt) ipBuckets.delete(ip);
  }
}, 120_000);

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || undefined;
  const hdrs = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: hdrs });
  }

  // Rate limit check (stricter for OTP — 5 per 10 min)
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ error: "請求過於頻繁，請10分鐘後再試" }),
      { status: 429, headers: { ...hdrs, "Content-Type": "application/json", "Retry-After": "600" } }
    );
  }

  // Origin check
  if (APP_ORIGIN !== "*" && origin && origin !== APP_ORIGIN) {
    return new Response(
      JSON.stringify({ error: "Forbidden origin" }),
      { status: 403, headers: { ...hdrs, "Content-Type": "application/json" } }
    );
  }

  try {
    const { phone } = await req.json();
    if (!phone || typeof phone !== "string") {
      return new Response(
        JSON.stringify({ error: "手機號碼為必填" }),
        { status: 400, headers: { ...hdrs, "Content-Type": "application/json" } }
      );
    }

    const cleaned = phone.replace(/[\s\-()]/g, "");
    if (!/^09\d{8}$/.test(cleaned)) {
      return new Response(
        JSON.stringify({ error: "手機號碼格式不正確" }),
        { status: 400, headers: { ...hdrs, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: rpcData, error: rpcError } = await supabase.rpc("rpc_send_otp", {
      p_phone: cleaned,
    });

    if (rpcError || !rpcData || rpcData.error) {
      // Never surface the database error text; only the app's own message, if any.
      if (rpcError) console.error("rpc_send_otp failed", rpcError);
      return new Response(
        JSON.stringify({ error: rpcData?.error || "無法產生驗證碼，請稍後再試" }),
        { status: 400, headers: { ...hdrs, "Content-Type": "application/json" } }
      );
    }

    const code = rpcData.code as string;

    // Send SMS via configured provider
    const smsProvider = Deno.env.get("SMS_PROVIDER") || "mitake";
    let smsResult: { ok: boolean; message: string };

    if (smsProvider === "mitake") {
      smsResult = await sendViaMitake(cleaned, code);
    } else if (smsProvider === "twilio") {
      smsResult = await sendViaTwilio(cleaned, code);
    } else if (smsProvider === "every8d") {
      smsResult = await sendViaEvery8D(cleaned, code);
    } else {
      smsResult = { ok: true, message: "SMS provider not configured (dev mode)" };
    }

    if (!smsResult.ok) {
      // The provider's raw response is internal detail.
      console.error("sms send failed", smsResult.message);
      return new Response(
        JSON.stringify({ error: "簡訊發送失敗，請稍後再試" }),
        { status: 500, headers: { ...hdrs, "Content-Type": "application/json" } }
      );
    }

    // The verification code is never returned to the caller in production.
    // In dev mode (no SMS credentials configured OR ALLOW_DEV_OTP=true), the
    // code is returned so testers can see it on screen.
    const allowDevCode = Deno.env.get("ALLOW_DEV_OTP") === "true" || smsResult.message.includes("dev mode");
    const responseBody: Record<string, unknown> = { success: true };
    if (allowDevCode) {
      responseBody.devCode = code;
    }

    return new Response(
      JSON.stringify(responseBody),
      { headers: { ...hdrs, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "伺服器錯誤" }),
      { status: 500, headers: { ...hdrs, "Content-Type": "application/json" } }
    );
  }
});

async function sendViaMitake(phone: string, code: string): Promise<{ ok: boolean; message: string }> {
  const username = Deno.env.get("MITAKE_USERNAME");
  const password = Deno.env.get("MITAKE_PASSWORD");
  if (!username || !password) {
    return { ok: true, message: "Mitake credentials not set (dev mode)" };
  }

  const message = `您的暗標競標會驗證碼為：${code}，有效期10分鐘。請勿告知他人。`;

  try {
    const url = new URL("https://smsapi.mitake.com.tw/api/SmSend");
    url.searchParams.set("CharsetURL", "UTF8");
    url.searchParams.set("username", username);
    url.searchParams.set("password", password);
    url.searchParams.set("dst", phone);
    url.searchParams.set("smbody", message);
    url.searchParams.set("response", "json");

    const res = await fetch(url.toString(), { method: "GET" });
    const text = await res.text();

    if (text.includes("ACK=")) {
      return { ok: true, message: "OK" };
    }
    return { ok: false, message: text.substring(0, 200) };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

async function sendViaTwilio(phone: string, code: string): Promise<{ ok: boolean; message: string }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!accountSid || !authToken || !fromNumber) {
    return { ok: true, message: "Twilio credentials not set (dev mode)" };
  }

  const intlPhone = "+886" + phone.slice(1);
  const message = `您的暗標競標會驗證碼為：${code}，有效期10分鐘。請勿告知他人。`;

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: fromNumber,
          To: intlPhone,
          Body: message,
        }),
      }
    );
    if (res.ok) {
      return { ok: true, message: "OK" };
    }
    const data = await res.json();
    return { ok: false, message: data.message || res.statusText };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

async function sendViaEvery8D(phone: string, code: string): Promise<{ ok: boolean; message: string }> {
  const username = Deno.env.get("EVERY8D_USERNAME");
  const password = Deno.env.get("EVERY8D_PASSWORD");
  if (!username || !password) {
    return { ok: true, message: "Every8D credentials not set (dev mode)" };
  }

  const message = `您的暗標競標會驗證碼為：${code}，有效期10分鐘。請勿告知他人。`;

  try {
    const res = await fetch("https://api.every8d.com/API21/HTTP/sendSMS.ashx", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        UID: username,
        PWD: password,
        DEST: phone,
        MSG: message,
      }),
    });
    const text = await res.text();
    if (text.startsWith("-")) {
      return { ok: false, message: text };
    }
    return { ok: true, message: "OK" };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}
