import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const produits = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/produits" }),
  schema: z.object({
    nom: z.string(),
    categorie: z.enum(["lego", "jeux-de-societe", "cartes-a-collectionner"]),
    theme: z.string(),
    referenceSet: z.string().optional(),
    prixIndicatif: z.number(),
    prixVerifie: z.boolean().default(false),
    ageRecommande: z.string(),
    image: z.string(),
    pointsForts: z.array(z.string()),
    pointsFaibles: z.array(z.string()),
    source: z.enum(["amazon", "ebay"]).default("amazon"),
    affiliateUrl: z.string().nullable().default(null),
    url: z.string(),
    trackableSlug: z.string().optional(),
  }),
});

export const collections = { produits };
