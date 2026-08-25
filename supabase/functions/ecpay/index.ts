import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ECPay config — secrets only. There is deliberately no fallback: the published
// sandbox HashKey/HashIV would let anyone forge a valid payment notification.
const ECPAY_MERCHANT_ID = Deno.env.get("ECPAY_MERCHANT_ID") || "";
const ECPAY_HASH_KEY = Deno.env.get("ECPAY_HASH_KEY") || "";
const ECPAY_HASH_IV = Deno.env.get("ECPAY_HASH_IV") || "";
const ECPAY_STAGE = Deno.env.get("ECPAY_STAGE") || "test";
const ECPAY_CONFIGURED = ECPAY_MERCHANT_ID !== "" && ECPAY_HASH_KEY !== "" && ECPAY_HASH_IV !== "";

const ECPAY_BASE_URL = ECPAY_STAGE === "prod"
  ? "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5"
  : "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function sha256Hex(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Generate CheckMacValue per ECPay spec (SHA256)
async function genCheckMacValue(params: Record<string, string>): Promise<string> {
  const sortedKeys = Object.keys(params).sort();
  const sortedStr = sortedKeys.map(k => `${k}=${params[k]}`).join("&");
  const raw = `HashKey=${ECPAY_HASH_KEY}&${sortedStr}&HashIV=${ECPAY_HASH_IV}`;
  let encoded = encodeURIComponent(raw);
  encoded = encoded
    .replace(/%2d/gi, "-")
    .replace(/%5f/gi, "_")
    .replace(/%2e/gi, ".")
    .replace(/%21/gi, "!")
    .replace(/%2a/gi, "*")
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")");
  const hash = await sha256Hex(encoded.toLowerCase());
  return hash.toUpperCase();
}

// Verify the CheckMacValue on an incoming ECPay notification.
async function verifyCheckMacValue(
  params: Record<string, string>,
  receivedCMV: string,
): Promise<boolean> {
  if (!receivedCMV) return false;
  const rest: Record<string, string> = { ...params };
  delete rest.CheckMacValue;
  const computed = await genCheckMacValue(rest);
  return computed === receivedCMV.toUpperCase();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "checkout";

  if (!ECPAY_CONFIGURED) {
    return new Response(
      JSON.stringify({ error: "線上付款尚未設定完成，請聯繫平台管理員" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    // === CHECKOUT: build the ECPay AIO form from the stored order ===
    if (action === "checkout" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const merchantTradeNo = typeof body?.merchantTradeNo === "string" ? body.merchantTradeNo : "";
      const sessionToken = typeof body?.sessionToken === "string" ? body.sessionToken : "";
      const clientOrigin = typeof body?.clientOrigin === "string" ? body.clientOrigin.replace(/\/+$/, "") : "";

      if (!merchantTradeNo || !sessionToken) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // The amount, item name and callback URLs come from the server, never the client.
      const supabase = serviceClient();
      const { data, error } = await supabase.rpc("rpc_get_ecpay_order_for_checkout", {
        p_token: sessionToken,
        p_merchant_trade_no: merchantTradeNo,
      });

      if (error) {
        console.error("ecpay checkout lookup failed", error);
        return new Response(JSON.stringify({ error: "無法建立付款，請稍後再試" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!data || data.error || !data.success) {
        return new Response(JSON.stringify({ error: data?.error || "無法建立付款" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tradeDate = new Date().toLocaleString("zh-TW", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
      }).replace(/\//g, "/");

      const params: Record<string, string> = {
        MerchantID: ECPAY_MERCHANT_ID,
        MerchantTradeNo: String(data.merchant_trade_no),
        MerchantTradeDate: tradeDate,
        PaymentType: "aio",
        TotalAmount: String(data.total_amount),
        TradeDesc: encodeURIComponent("競標平台商品付款"),
        ItemName: String(data.item_name),
        ReturnURL: `${SUPABASE_URL}/functions/v1/ecpay?action=callback`,
        OrderResultURL: `${SUPABASE_URL}/functions/v1/ecpay?action=result`,
        ChoosePayment: "ALL",
        EncryptType: "1",
      };

      params.CheckMacValue = await genCheckMacValue(params);

      const formFields = Object.entries(params)
        .map(([k, v]) => `  <input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`)
        .join("\n");

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>前往綠界付款</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0D0D1A; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .container { text-align: center; }
    .spinner { width: 40px; height: 40px; border: 3px solid rgba(0,212,170,0.2); border-top-color: #00D4AA; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { color: #888; font-size: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <p>正在前往綠界科技付款頁面...</p>
  </div>
  <form id="ecpay-form" method="POST" action="${escapeHtml(ECPAY_BASE_URL)}">
${formFields}
  </form>
  <script>document.getElementById('ecpay-form').submit();</script>
</body>
</html>`;

      return new Response(html, {
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // === CALLBACK: ECPay server-to-server payment notification ===
    if (action === "callback" && req.method === "POST") {
      const params: Record<string, string> = {};
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        params[key] = String(value);
      }

      const receivedCMV = params.CheckMacValue || "";
      const { RtnCode, MerchantTradeNo, TradeNo, PaymentType, TradeDate, TradeAmt } = params;

      const isValid = await verifyCheckMacValue(params, receivedCMV);
      if (!isValid) {
        return new Response("0|CheckMacValue verification failed", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }

      const supabase = serviceClient();

      // RtnCode = 1 means payment successful
      if (RtnCode === "1") {
        const amount = Number.parseInt(String(TradeAmt ?? ""), 10);
        if (!Number.isFinite(amount)) {
          return new Response("0|Invalid amount", {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "text/plain" },
          });
        }

        const { data, error } = await supabase.rpc("rpc_confirm_ecpay_payment", {
          p_merchant_trade_no: MerchantTradeNo,
          p_ecpay_trade_no: TradeNo || null,
          p_payment_type: PaymentType || null,
          p_trade_date: TradeDate || null,
          p_check_mac_value: receivedCMV,
          p_amount: amount,
        });

        if (error || data?.error) {
          console.error("ecpay confirm rejected", error ?? data?.error);
          return new Response("0|Payment not accepted", {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "text/plain" },
          });
        }

        return new Response("1|OK", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }

      // Payment failed or cancelled
      await supabase.from("ecpay_orders")
        .update({ trade_status: "failed", updated_at: new Date().toISOString() })
        .eq("merchant_trade_no", MerchantTradeNo)
        .eq("trade_status", "pending");

      return new Response("1|OK", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain" },
      });
    }

    // === RESULT: ECPay client-side redirect after payment ===
    if (action === "result" && req.method === "POST") {
      const formData = await req.formData();
      const params: Record<string, string> = {};
      for (const [key, value] of formData.entries()) {
        params[key] = String(value);
      }

      // Nothing here is trusted: this page only reports what the browser was sent,
      // and every value is escaped before it reaches the markup.
      const isSuccess = params.RtnCode === "1";
      const merchantTradeNo = String(params.MerchantTradeNo || "").slice(0, 40);
      const returnUrl = clientOrigin
        ? `${clientOrigin}/payment/result?status=${isSuccess ? "success" : "failed"}&trade_no=${encodeURIComponent(merchantTradeNo)}`
        : `/payment/result?status=${isSuccess ? "success" : "failed"}&trade_no=${encodeURIComponent(merchantTradeNo)}`;

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>付款結果</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0D0D1A; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .container { text-align: center; padding: 20px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    p { color: #888; font-size: 16px; margin-bottom: 24px; }
    .btn { display: inline-block; padding: 12px 32px; background: #00D4AA; color: #000; text-decoration: none; border-radius: 8px; font-weight: 700; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${isSuccess ? "✅" : "❌"}</div>
    <h1>${isSuccess ? "付款成功" : "付款失敗"}</h1>
    <p>交易編號：${escapeHtml(merchantTradeNo)}</p>
    <script>
      setTimeout(function() {
        window.location.href = ${JSON.stringify(returnUrl)};
      }, 2000);
    </script>
    <a href="${escapeHtml(returnUrl)}" class="btn">返回拍賣平台</a>
  </div>
</body>
</html>`;

      return new Response(html, {
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ecpay error", err);
    return new Response(JSON.stringify({ error: "伺服器錯誤，請稍後再試" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
