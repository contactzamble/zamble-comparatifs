// Reçoit les updates du bot Telegram (@ZambleAlertesBot). Ne traite que
// /start <token> : associe le chat_id au compte correspondant au jeton
// généré par request_telegram_link() côté tableau de bord.
// Déployée avec --no-verify-jwt (Telegram n'envoie pas de JWT Supabase) —
// sécurisée à la place par le secret_token de setWebhook, comparé au header
// X-Telegram-Bot-Api-Secret-Token.

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  const receivedSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!webhookSecret || receivedSecret !== webhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const update = await req.json();
  const message = update.message;
  const text: string | undefined = message?.text;
  const chatId: number | undefined = message?.chat?.id;

  const reply = async (chat: number, body: string) => {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: body }),
    });
  };

  if (!text?.startsWith("/start") || !chatId) {
    return new Response("ok");
  }

  const token = text.replace("/start", "").trim();
  if (!token) {
    await reply(chatId, "Pour lier ton compte, clique sur « Lier Telegram » depuis ton tableau de bord sur zamble.fr.");
    return new Response("ok");
  }

  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select("user_id, telegram_link_token_expires_at")
    .eq("telegram_link_token", token)
    .maybeSingle();

  if (!prefs || new Date(prefs.telegram_link_token_expires_at) < new Date()) {
    await reply(chatId, "Lien invalide ou expiré. Relance la liaison depuis ton compte sur zamble.fr.");
    return new Response("ok");
  }

  await supabase
    .from("notification_preferences")
    .update({
      telegram_chat_id: String(chatId),
      telegram_enabled: true,
      telegram_link_token: null,
      telegram_link_token_expires_at: null,
    })
    .eq("user_id", prefs.user_id);

  await reply(chatId, "✅ Compte Telegram lié ! Tu recevras désormais tes alertes de prix ici.");

  return new Response("ok");
});
