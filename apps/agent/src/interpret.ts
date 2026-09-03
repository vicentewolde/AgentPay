/**
 * Reading a Spanish-language purchase instruction — deterministically, not by
 * calling a language model.
 *
 * This is not the agent's decision boundary. `checkScope` (T12) is, and it
 * never sees this module's output beyond a `productId` and a `quantity` — the
 * same two fields any caller of `create_purchase_intent` supplies, structured,
 * validated, and checked against the signed scope exactly as before. A
 * misreading here can pick the wrong product or the wrong count; it cannot
 * grant an asset, a venue or an amount the credential does not already permit.
 *
 * Kept deterministic on purpose, not as a shortcut. The demo (T14) has to be
 * recordable and reproducible — the same sentence must produce the same
 * product every time, offline, without an API key or a network call of its
 * own. An LLM in this seat would trade that away for language coverage this
 * phase's mock catalogue, with its twelve fixed products, does not need.
 */
import { AgentPassError } from "@agentpass/core";

import type { Product } from "./catalog/catalog.js";

export interface PurchaseInterpretation {
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
}

const SPANISH_NUMBER_WORDS: Readonly<Record<string, number>> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

/** Words that carry no product identity: politeness, articles, verbs of asking. */
const STOPWORDS: ReadonlySet<string> = new Set([
  "comprame",
  "compra",
  "comprar",
  "quiero",
  "quisiera",
  "dame",
  "necesito",
  "de",
  "del",
  "el",
  "la",
  "los",
  "las",
  "por",
  "favor",
  "porfa",
  "para",
  "unidad",
  "unidades",
  "gracias",
  "y",
  "con",
]);

/** Lowercase, no accents, no punctuation — so "café" and "cafe" agree. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();
}

function tokenize(text: string): readonly string[] {
  const normalized = normalize(text);
  return normalized.length === 0 ? [] : normalized.split(/\s+/);
}

/** The first number word or digit in the instruction; 1 if none is found. */
function extractQuantity(tokens: readonly string[]): number {
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      const parsed = Number(token);
      if (Number.isSafeInteger(parsed) && parsed >= 1) return parsed;
    }
    const word = SPANISH_NUMBER_WORDS[token];
    if (word !== undefined) return word;
  }
  return 1;
}

function isProductWord(token: string): boolean {
  return !STOPWORDS.has(token) && SPANISH_NUMBER_WORDS[token] === undefined && !/^\d+$/.test(token);
}

/**
 * Matches an instruction against a catalogue by counting shared words with
 * each product's name — the highest-scoring product wins, ties break in
 * catalogue order, and a product with zero shared words is never picked.
 *
 * @throws AgentPassError `InstructionNotUnderstood` when nothing matches.
 */
export function interpretPurchase(
  instruction: string,
  catalog: readonly Product[],
): PurchaseInterpretation {
  const allTokens = tokenize(instruction);
  const quantity = extractQuantity(allTokens);
  const wanted = allTokens.filter(isProductWord);

  let best: { readonly product: Product; readonly score: number } | undefined;

  for (const product of catalog) {
    const nameWords = new Set(tokenize(product.name));
    const score = wanted.filter((word) => nameWords.has(word)).length;

    if (score > 0 && (best === undefined || score > best.score)) {
      best = { product, score };
    }
  }

  if (best === undefined) {
    throw new AgentPassError(
      "InstructionNotUnderstood",
      "no product in the catalogue matches this instruction",
      { details: { instruction, catalogueSize: catalog.length } },
    );
  }

  return { productId: best.product.id, productName: best.product.name, quantity };
}
