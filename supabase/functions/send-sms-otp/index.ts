import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { phone } = await req.json();
    if (!phone || typeof phone !== "string") {
      return new Response(
        JSON.stringify({ error: "手機號碼為必填" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize phone
    const cleaned = phone.replace(/[\s\-()]/g, "");
    if (!/^09\d{8}$/.test(cleaned)) {
      return new Response(
        JSON.stringify({ error: "手機號碼格式不正確" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Call the RPC to generate and store the OTP
    const { data: rpcData, error: rpcError } = await supabase.rpc("rpc_send_otp", {
      p_phone: cleaned,
    });

    if (rpcError || !rpcData || rpcData.error) {
      return new Response(
        JSON.stringify({ error: rpcData?.error || rpcError?.message || "無法產生驗證碼" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      // No SMS provider configured — return code in dev mode
      smsResult = {
        ok: true,
        message: "SMS provider not configured (dev mode — code returned to client)",
      };
    }

    if (!smsResult.ok) {
      return new Response(
        JSON.stringify({ error: "簡訊發送失敗：" + smsResult.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // In dev mode (no provider configured), return the code for testing
    const isDev = smsProvider === "mitake" && !Deno.env.get("MITAKE_USERNAME");
    const responseBody: Record<string, unknown> = { success: true };
    if (isDev) {
      responseBody.devCode = code;
      responseBody.message = "開發模式：簡訊服務未設定，驗證碼已回傳。上線前請設定 SMS 環境變數。";
    }

    return new Response(
      JSON.stringify(responseBody),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "伺服器錯誤" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── 三竹簡訊 (Mitake) ──
async function sendViaMitake(phone: string, code: string): Promise<{ ok: boolean; message: string }> {
  const username = Deno.env.get("MITAKE_USERNAME");
  const password = Deno.env.get("MITAKE_PASSWORD");
  if (!username || !password) {
    return { ok: true, message: "Mitake credentials not set (dev mode)" };
  }

  // Convert 09xx to +8869xx for international format if needed
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

// ── Twilio ──
async function sendViaTwilio(phone: string, code: string): Promise<{ ok: boolean; message: string }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!accountSid || !authToken || !fromNumber) {
    return { ok: true, message: "Twilio credentials not set (dev mode)" };
  }

  // Convert 09xx to +8869xx
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

// ── Every8D ──
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
