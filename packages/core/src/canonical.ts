/**
 * Deterministic JSON: keys sorted recursively, so the same document always
 * serialises to the same bytes no matter what order its fields happened to be
 * built in.
 *
 * This lived inside `wallet-sign.ts` until T79, private to the mandate. It is
 * shared now because a second document started needing the same guarantee —
 * SignalDesk's delivery receipt, whose hash is signed by the merchant and
 * verified by someone who reconstructed the receipt from its parts. Two copies
 * of this function would be two definitions of "the same bytes", and they
 * would agree right up until one of them was changed.
 *
 * It is not a general-purpose canonicaliser and does not claim to be JCS: no
 * number normalisation, no string escaping rules of its own. What it
 * guarantees is key order, which is the only thing that varies between two
 * constructions of the same document in this codebase.
 */

/** Recursively sorts object keys, leaving arrays in their given order. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** The canonical serialisation of a document: `JSON.stringify` over deeply sorted keys. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}
