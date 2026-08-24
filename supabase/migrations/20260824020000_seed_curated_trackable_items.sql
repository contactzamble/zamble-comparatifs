-- Lie les 5 fiches LEGO Star Wars déjà curées (src/content/produits/) à leur
-- pendant "machine" pour le suivi de prix. slug = nom de fichier markdown.
insert into public.trackable_items (slug, source, external_id, first_seen_price, last_price, is_active)
values
  ('at-at-ucs', 'amazon', 'B09JKZ62H7', 799.99, 799.99, true),
  ('death-star', 'amazon', 'B0FPXFMGVT', 549.99, 549.99, true),
  ('millennium-falcon-standard', 'amazon', 'B07QQ396NH', 272.50, 272.50, true),
  ('millennium-falcon-ucs', 'amazon', 'B075NT1KHB', 899.99, 899.99, true),
  ('x-wing-ucs', 'amazon', 'B0C22H641G', 259.99, 259.99, true)
on conflict (slug) do nothing;
