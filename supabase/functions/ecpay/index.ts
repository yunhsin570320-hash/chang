import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ECPay config — from environment secrets
const ECPAY_MERCHANT_ID = Deno.env.get("ECPAY_MERCHANT_ID") || "3002607";
const ECPAY_HASH_KEY = Deno.env.get("ECPAY_HASH_KEY") || "pwFHCqoQZGmho4w6";
const ECPAY_HASH_IV = Deno.env.get("ECPAY_HASH_IV") || "EkRm7iFT261dpevs";
const ECPAY_STAGE = Deno.env.get("ECPAY_STAGE") || "test";

// ECPay AIO URLs
const ECPAY_BASE_URL = ECPAY_STAGE === "prod"
  ? "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5"
  : "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Generate CheckMacValue per ECPay spec (SHA256)
async function genCheckMacValue(params: Record<string, string>): Promise<string> {
  // 1. Sort parameters by key alphabetically
  const sortedKeys = Object.keys(params).sort();
  // 2. Join as key=value&key=value
  const sortedStr = sortedKeys.map(k => `${k}=${params[k]}`).join("&");
  // 3. Prepend HashKey, append HashIV
  const raw = `HashKey=${ECPAY_HASH_KEY}&${sortedStr}&HashIV=${ECPAY_HASH_IV}`;
  // 4. URL encode (.NET-style: encodeURI then replace specific chars)
  let encoded = encodeURIComponent(raw);
  // ECPay .NET encoding replacements
  encoded = encoded
    .replace(/%2d/g, "-")
    .replace(/%5f/g, "_")
    .replace(/%2e/g, ".")
    .replace(/%21/g, "!")
    .replace(/%2a/g, "*")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")");
  // 5. Convert to lowercase
  const lower = encoded.toLowerCase();
  // 6. SHA256 hash, uppercase
  const hash = await sha256Hex(lower);
  return hash.toUpperCase();
}

async function sha256Hex(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Verify CheckMacValue from ECPay callback
function verifyCheckMacValue(params: Record<string, string>, receivedCMV: string): boolean {
  const { CheckMacValue, ...rest } = params;
  const computed = await genCheckMacValue(rest);
  return computed === receivedCMV;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "checkout";

  try {
    // === CHECKOUT: Generate ECPay AIO form HTML ===
    if (action === "checkout" && req.method === "POST") {
      const body = await req.json();
      const { merchantTradeNo, totalAmount, itemName, returnUrl, orderResultUrl } = body;

      if (!merchantTradeNo || !totalAmount || !itemName) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
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
        MerchantTradeNo: merchantTradeNo,
        MerchantTradeDate: tradeDate,
        PaymentType: "aio",
        TotalAmount: String(totalAmount),
        TradeDesc: encodeURIComponent("競標平台商品付款"),
        ItemName: itemName,
        ReturnURL: returnUrl || `${SUPABASE_URL}/functions/v1/ecpay?action=callback`,
        OrderResultURL: orderResultUrl || `${SUPABASE_URL}/functions/v1/ecpay?action=result`,
        ChoosePayment: "ALL",
        EncryptType: "1",
      };

      const checkMacValue = await genCheckMacValue(params);
      params.CheckMacValue = checkMacValue;

      // Build auto-submitting HTML form
      const formFields = Object.entries(params)
        .map(([k, v]) => `  <input type="hidden" name="${k}" value="${v}" />`)
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
  <form id="ecpay-form" method="POST" action="${ECPAY_BASE_URL}">
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
      const contentType = req.headers.get("content-type") || "";
      let params: Record<string, string> = {};

      if (contentType.includes("application/x-www-form-urlencoded")) {
        const formData = await req.formData();
        for (const [key, value] of formData.entries()) {
          params[key] = String(value);
        }
      } else {
        const formData = await req.formData();
        for (const [key, value] of formData.entries()) {
          params[key] = String(value);
        }
      }

      const receivedCMV = params.CheckMacValue || "";
      const { RtnCode, MerchantTradeNo, TradeNo, PaymentType, TradeDate } = params;

      // Verify the CheckMacValue
      const isValid = verifyCheckMacValue(params, receivedCMV);
      if (!isValid) {
        return new Response("0|CheckMacValue verification failed", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }

      // RtnCode = 1 means payment successful
      if (RtnCode === "1" || RtnCode === 1) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { error } = await supabase.rpc("rpc_confirm_ecpay_payment", {
          p_merchant_trade_no: MerchantTradeNo,
          p_ecpay_trade_no: TradeNo || null,
          p_payment_type: PaymentType || null,
          p_trade_date: TradeDate || null,
          p_check_mac_value: receivedCMV,
        });

        if (error) {
          return new Response("0|DB error", {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "text/plain" },
          });
        }

        // ECPay expects "1|OK" to acknowledge successful receipt
        return new Response("1|OK", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }

      // Payment failed or cancelled
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      await supabase.from("ecpay_orders")
        .update({ trade_status: "failed", updated_at: new Date().toISOString() })
        .eq("merchant_trade_no", MerchantTradeNo);

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

      const rtnCode = params.RtnCode;
      const merchantTradeNo = params.MerchantTradeNo || "";
      const isSuccess = rtnCode === "1" || rtnCode === 1;

      // Redirect back to the app with result
      const appUrl = isSuccess
        ? `/payment/result?status=success&trade_no=${encodeURIComponent(merchantTradeNo)}`
        : `/payment/result?status=failed&trade_no=${encodeURIComponent(merchantTradeNo)}`;

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
    <p>交易編號：${merchantTradeNo}</p>
    <script>
      setTimeout(function() {
        window.location.href = "${appUrl}";
      }, 2000);
    </script>
    <a href="${appUrl}" class="btn">返回拍賣平台</a>
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
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
