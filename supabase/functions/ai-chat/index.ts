import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FAQ_PROMPT = `你是「暗拍」平台的 AI 客服助手。請用繁體中文回答問題，語氣友善專業。

平台主要功能：
- 競標廳：賣家上架商品，買家競價，最高價者得標
- 直購廳：賣家設定固定價格，買家直接購買
- 會員制度：免費會員可上架直購商品（最多5件）；繳交平台維護費 NT$500 可成為付費會員，可上架競標商品且無數量限制
- 競標保證金：繳納 NT$1000 後可在競價廳競標
- 交付流程：商品售出後，賣家在後台點擊「進行交付」處理出貨
- 通知系統：得標、新訂單、結標等事件會發送站內通知
- 申訴系統：帳號被鎖定時可透過申訴功能向管理員提出異議

常見問題：
Q: 如何成為付費會員？ A: 繳交平台維護費 NT$500，在個人資料頁點擊「繳交平台維護費」，上傳繳費證明後等候管理員審核。
Q: 如何參與競標？ A: 需先繳納競標保證金 NT$1000，審核通過後即可在競價廳出價。
Q: 商品售出後怎麼辦？ A: 賣家會在後台看到「待出貨」按鈕，點擊後進入交付頁面處理。買家會收到通知，請等候賣家聯繫。
Q: 如何上架商品？ A: 在賣家後台選擇上架類型（競價/直購），填寫商品資訊、圖片、價格即可。免費會員僅可上架直購商品。
Q: 帳號被鎖定怎麼辦？ A: 在個人資料頁點擊「提出申訴」，填寫申訴理由送出，管理員會審核處理。

如果問題超出以上範圍，請建議用戶聯繫管理員或提供已知資訊。回答簡潔，不超過200字。`;

interface ChatRequest {
  sessionToken: string;
  threadId: string;
  message: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { sessionToken, threadId, message }: ChatRequest = await req.json();

    if (!sessionToken || !threadId || !message?.trim()) {
      return new Response(
        JSON.stringify({ error: "缺少必要參數" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (message.length > 5000) {
      return new Response(
        JSON.stringify({ error: "訊息過長" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Validate session and get user
    const { data: sessionData, error: sessionErr } = await admin
      .from("app_sessions")
      .select("user_id")
      .eq("token", sessionToken)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (sessionErr || !sessionData) {
      return new Response(
        JSON.stringify({ error: "登入已過期，請重新登入" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = sessionData.user_id;

    // Verify thread ownership
    const { data: thread, error: threadErr } = await admin
      .from("chat_threads")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", userId)
      .maybeSingle();

    if (threadErr || !thread) {
      return new Response(
        JSON.stringify({ error: "無權限" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Save user message
    const { error: saveUserErr } = await admin
      .from("chat_messages")
      .insert({ thread_id: threadId, role: "user", content: message.trim() });

    if (saveUserErr) throw saveUserErr;

    // Fetch recent conversation history (last 10 messages)
    const { data: history } = await admin
      .from("chat_messages")
      .select("role, content")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(10);

    // Build conversation context
    const messages = [
      { role: "system", content: FAQ_PROMPT },
      ...(history || []).map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    let assistantReply = "";

    const aiKey = Deno.env.get("OPENAI_API_KEY");

    if (aiKey) {
      // Call OpenAI-compatible API
      const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          max_tokens: 500,
          temperature: 0.7,
        }),
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        assistantReply = aiData.choices?.[0]?.message?.content?.trim() || "";
      }
    }

    if (!assistantReply) {
      // Smart FAQ fallback — keyword matching
      const lower = message.toLowerCase();
      if (lower.includes("付費會員") || lower.includes("vip") || lower.includes("維護費")) {
        assistantReply = "成為付費會員方式：在個人資料頁點擊「繳交平台維護費 NT$500」，透過銀行轉帳繳費後上傳證明，管理員審核通過後即自動升級。付費會員可上架競標商品且無數量限制。";
      } else if (lower.includes("保證金") || (lower.includes("競標") && lower.includes("繳"))) {
        assistantReply = "參與競標需先繳納競標保證金 NT$1000。在個人資料頁點擊「繳納競標保證金」，繳費後上傳證明，審核通過後即可在競價廳出價。";
      } else if (lower.includes("上架") || lower.includes("賣") || lower.includes("出售")) {
        assistantReply = "上架商品方式：進入賣家後台，選擇上架類型（競價或直購），填寫商品名稱、圖片、描述、價格等資訊。免費會員僅可上架直購商品（最多5件），付費會員可上架競標商品且無限制。";
      } else if (lower.includes("交付") || lower.includes("出貨") || lower.includes("寄送")) {
        assistantReply = "商品售出後，賣家可在賣家後台看到「待出貨」按鈕，點擊進入交付頁面處理出貨流程。買家會收到站內通知，請等候賣家聯繫交付事宜。";
      } else if (lower.includes("鎖定") || lower.includes("封鎖") || lower.includes("申訴") || lower.includes("帳號")) {
        assistantReply = "帳號被鎖定時，可在個人資料頁點擊「提出申訴」，填寫申訴理由送出，管理員會審核並處理。請耐心等候審核結果。";
      } else if (lower.includes("直購")) {
        assistantReply = "直購廳是固定價格直接購買的商品區。買家看到喜歡的商品可直接點擊購買，無需競價。每筆訂單購買1件，庫存耗盡後自動下架。";
      } else if (lower.includes("競標") || lower.includes("競價") || lower.includes("出價") || lower.includes("得標")) {
        assistantReply = "競價廳是競標商品的專區。買家可對商品出價，最高價者得標。同額時以先出價者優先。結標後賣家會收到通知並安排交付。參與競標需先繳納保證金。";
      } else if (lower.includes("通知")) {
        assistantReply = "站內通知會在得標、未得標、新訂單、結標等事件發生時自動發送。您可在個人資料頁的「通知」分頁查看所有通知。";
      } else if (lower.includes("hello") || lower.includes("嗨") || lower.includes("你好") || lower.includes("hi")) {
        assistantReply = "您好！我是平台 AI 客服助手，可以回答關於競標、直購、會員升級、保證金、交付流程、申訴等問題。請問有什麼可以幫您的嗎？";
      } else {
        assistantReply = "感謝您的提問！我是平台 AI 客服助手，目前可以協助解答關於：會員升級、競標保證金、商品上架、交付流程、帳號申訴等問題。如果您的問題比較複雜，建議聯繫管理員進一步處理。";
      }
    }

    // Save assistant message
    const { error: saveAssistantErr } = await admin
      .from("chat_messages")
      .insert({ thread_id: threadId, role: "assistant", content: assistantReply });

    if (saveAssistantErr) throw saveAssistantErr;

    // Update thread timestamp
    await admin
      .from("chat_threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", threadId);

    return new Response(
      JSON.stringify({ success: true, reply: assistantReply }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("ai-chat error:", err);
    return new Response(
      JSON.stringify({ error: "系統錯誤，請稍後再試" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
