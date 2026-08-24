// Phase 3 du plan v2 : vérifie le prix courant de chaque trackable_item actif
// (via zamble-search-api) et l'ajoute à price_history. La logique d'alerte
// (évaluation des tracked_items, dispatch email/Telegram) arrive en Phase 4,
// une fois Resend et le bot Telegram branchés — volontairement absente ici
// pour garder cette étape testable isolément.

import { createClient } from "npm:@supabase/supabase-js@2";

interface TrackableItem {
  id: string;
  slug: string;
  source: "amazon" | "ebay";
  external_id: string;
}

interface PriceResponse {
  price: number;
  available: boolean;
}

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const searchApiUrl = Deno.env.get("SEARCH_API_URL")!;
  const internalToken = Deno.env.get("INTERNAL_API_TOKEN")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: items, error } = await supabase
    .from("trackable_items")
    .select("id, slug, source, external_id")
    .eq("is_active", true);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results: { slug: string; status: string; price?: number }[] = [];

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

      await supabase.from("price_history").insert({ trackable_item_id: item.id, price: priceData.price });
      await supabase
        .from("trackable_items")
        .update({ last_price: priceData.price, last_checked_at: new Date().toISOString() })
        .eq("id", item.id);

      results.push({ slug: item.slug, status: "checked", price: priceData.price });
    } catch (err) {
      results.push({ slug: item.slug, status: `error: ${String(err)}` });
    }
  }

  return new Response(JSON.stringify({ checked: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
