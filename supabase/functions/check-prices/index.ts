// Phase 3+4 du plan v2 : vérifie le prix courant de chaque trackable_item
// actif (via zamble-search-api), l'ajoute à price_history, puis pour chaque
// tracked_item concerné évalue si la baisse mérite une alerte et l'envoie
// (email via Resend, Telegram via Bot API), en journalisant dans alert_log.

import { createClient } from "npm:@supabase/supabase-js@2";

interface TrackableItem {
  id: string;
  slug: string;
  source: "amazon" | "ebay";
  external_id: string;
  first_seen_price: number;
}

interface PriceResponse {
  price: number;
  available: boolean;
}

interface TrackedItem {
  id: string;
  user_id: string;
  target_price: number | null;
  alert_threshold_pct: number;
  last_alerted_price: number | null;
}

interface NotificationPreferences {
  email_enabled: boolean;
  telegram_enabled: boolean;
  telegram_chat_id: string | null;
}

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const searchApiUrl = Deno.env.get("SEARCH_API_URL")!;
  const internalToken = Deno.env.get("INTERNAL_API_TOKEN")!;
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN");

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: items, error } = await supabase
    .from("trackable_items")
    .select("id, slug, source, external_id, first_seen_price")
    .eq("is_active", true);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results: { slug: string; status: string; price?: number; alertsSent?: number }[] = [];

  for (const item of (items ?? []) as TrackableItem[]) {
    try {
      const priceUrl = `${searchApiUrl}/price?source=${item.source}&itemId=${encodeURIComponent(item.external_id)}`;
      const res = await fetch(priceUrl, { headers: { "X-Internal-Token": internalToken } });

      if (res.status === 404) {
        await supabase
          .from("trackable_items")
          .update({ is_active: false, last_checked_at: new Date().toISOString() })
          .eq("id", item.id);
        results.push({ slug: item.slug, status: "delisted" });
        continue;
      }

      if (!res.ok) {
        results.push({ slug: item.slug, status: `error_${res.status}` });
        continue;
      }

      const priceData = (await res.json()) as PriceResponse;
      const newPrice = priceData.price;

      await supabase.from("price_history").insert({ trackable_item_id: item.id, price: newPrice });
      await supabase
        .from("trackable_items")
        .update({ last_price: newPrice, last_checked_at: new Date().toISOString() })
        .eq("id", item.id);

      const alertsSent = await dispatchAlerts(supabase, item, newPrice, resendApiKey, telegramBotToken);

      results.push({ slug: item.slug, status: "checked", price: newPrice, alertsSent });
    } catch (err) {
      results.push({ slug: item.slug, status: `error: ${String(err)}` });
    }
  }

  return new Response(JSON.stringify({ checked: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});

/**
 * Évalue et envoie les alertes pour tous les tracked_items d'un
 * trackable_item dont le prix vient d'être mis à jour. Renvoie le nombre
 * d'alertes effectivement envoyées (tous canaux confondus).
 */
async function dispatchAlerts(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  item: TrackableItem,
  newPrice: number,
  resendApiKey: string | undefined,
  telegramBotToken: string | undefined,
): Promise<number> {
  const { data: tracked } = await supabase
    .from("tracked_items")
    .select("id, user_id, target_price, alert_threshold_pct, last_alerted_price")
    .eq("trackable_item_id", item.id)
    .eq("is_active", true);

  let alertsSent = 0;

  for (const t of (tracked ?? []) as TrackedItem[]) {
    const baseline = t.last_alerted_price ?? item.first_seen_price;
    const thresholdPrice = t.target_price ?? baseline * (1 - t.alert_threshold_pct / 100);
    const priceDropped = t.last_alerted_price == null || newPrice < t.last_alerted_price;
    if (newPrice > thresholdPrice || !priceDropped) continue;

    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("email_enabled, telegram_enabled, telegram_chat_id")
      .eq("user_id", t.user_id)
      .single();
    const { data: profile } = await supabase.from("profiles").select("email").eq("id", t.user_id).single();
    if (!prefs || !profile) continue;

    const previousPrice = t.last_alerted_price ?? item.first_seen_price;
    const channelsSent: ("email" | "telegram")[] = [];

    if (prefs.email_enabled && resendApiKey) {
      const ok = await sendEmailAlert(resendApiKey, profile.email, item.slug, newPrice, previousPrice);
      if (ok) channelsSent.push("email");
    }
    if (prefs.telegram_enabled && prefs.telegram_chat_id && telegramBotToken) {
      const ok = await sendTelegramAlert(telegramBotToken, prefs.telegram_chat_id, item.slug, newPrice, previousPrice);
      if (ok) channelsSent.push("telegram");
    }

    if (channelsSent.length === 0) continue;

    for (const channel of channelsSent) {
      await supabase.from("alert_log").insert({
        tracked_item_id: t.id,
        user_id: t.user_id,
        channel,
        previous_price: previousPrice,
        price_at_alert: newPrice,
        first_seen_price: item.first_seen_price,
        status: "sent",
      });
    }
    await supabase.from("tracked_items").update({ last_alerted_price: newPrice }).eq("id", t.id);
    alertsSent += channelsSent.length;
  }

  return alertsSent;
}

async function sendEmailAlert(
  apiKey: string,
  to: string,
  slug: string,
  newPrice: number,
  previousPrice: number,
): Promise<boolean> {
  const name = slug.replace(/-/g, " ");
  const html = `
    <p>Bonne nouvelle : le prix de <strong>${name}</strong> a baissé.</p>
    <p>${previousPrice.toFixed(2)} € → <strong>${newPrice.toFixed(2)} €</strong></p>
    <p><a href="https://zamble.fr/compte/">Voir mes prix suivis</a></p>
  `;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Zamble Comparatifs <alertes@zamble.fr>",
      to: [to],
      subject: `Baisse de prix : ${name}`,
      html,
    }),
  });
  return res.ok;
}

async function sendTelegramAlert(
  botToken: string,
  chatId: string,
  slug: string,
  newPrice: number,
  previousPrice: number,
): Promise<boolean> {
  const name = slug.replace(/-/g, " ");
  const text = `📉 Baisse de prix : ${name}\n${previousPrice.toFixed(2)} € → ${newPrice.toFixed(2)} €\nhttps://zamble.fr/compte/`;
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return res.ok;
}
