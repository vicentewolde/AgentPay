import { createHash } from "node:crypto";

import { Keypair } from "@stellar/stellar-sdk/base";
import { CompactSign, importJWK } from "jose";
import { describe, expect, it } from "vitest";

import { stellarAddressToDid } from "./did.js";
import { hasErrorCode } from "./errors.js";
import type { JwsDocumentProfile } from "./jws-document.js";
import { jwsDocumentHash, signJwsDocument, verifyJwsDocument } from "./jws-document.js";
import { AGENTPASS_JWS_ALG, stellarKeypairToJWK } from "./jwk.js";
import { stellarDidSchema } from "./did.js";
import { z } from "zod";

/**
 * A minimal document type, invented for this test. Using a real one here would
 * couple the generic machinery's tests to whichever document happened to be
 * handy, and hide the fact that nothing in `jws-document.ts` knows about
 * credentials, intents or mandates.
 */
const noteSchema = z.strictObject({
  author: stellarDidSchema,
  body: z.string().min(1),
});
type Note = z.infer<typeof noteSchema>;

const noteProfile: JwsDocumentProfile<Note> = {
  typ: "note+jwt",
  schema: noteSchema,
  signerField: "author",
  signerDid: (note) => note.author,
  invalidCode: "InvalidCredential",
};

const author = Keypair.random();
const stranger = Keypair.random();
const authorDid = stellarAddressToDid(author.publicKey(), "testnet");

const note: Note = { author: authorDid, body: "a note" };

/** Signs an arbitrary payload with an arbitrary header — for forging tests. */
async function forge(
  payload: unknown,
  keypair: Keypair,
  header: { alg?: string; typ?: string; kid?: string },
): Promise<string> {
  const key = await importJWK(stellarKeypairToJWK(keypair), AGENTPASS_JWS_ALG);
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({
      alg: header.alg ?? AGENTPASS_JWS_ALG,
      typ: header.typ ?? noteProfile.typ,
      ...(header.kid === undefined ? {} : { kid: header.kid }),
    })
    .sign(key);
}

describe("signJwsDocument", () => {
  it("round-trips a document through sign and verify", async () => {
    const signed = await signJwsDocument(noteProfile, note, author);
    const verified = await verifyJwsDocument(noteProfile, signed.jws);

    expect(verified.document).toEqual(note);
    expect(verified.signer).toBe(authorDid);
    expect(verified.hash).toBe(signed.hash);
  });

  it("hashes the JWS it was given, not the payload", async () => {
    const signed = await signJwsDocument(noteProfile, note, author);
    expect(signed.hash).toBe(createHash("sha256").update(signed.jws, "utf8").digest("hex"));
    expect(signed.hash).toBe(jwsDocumentHash(signed.jws));
  });

  it("writes the profile's typ into the header", async () => {
    const signed = await signJwsDocument(noteProfile, note, author);
    const header = JSON.parse(
      Buffer.from(signed.jws.split(".")[0] ?? "", "base64url").toString("utf8"),
    ) as { typ: string; alg: string; kid: string };

    expect(header.typ).toBe("note+jwt");
    expect(header.alg).toBe(AGENTPASS_JWS_ALG);
    expect(header.kid).toBe(authorDid);
  });

  it("refuses to sign with a key that is not the document's signer", async () => {
    await expect(signJwsDocument(noteProfile, note, stranger)).rejects.toSatisfy((error) =>
      hasErrorCode(error, "SignerMismatch"),
    );
  });

  it("rejects a document that is off-schema, with the profile's code", async () => {
    const broken = { author: authorDid, body: "" } as Note;
    await expect(signJwsDocument(noteProfile, broken, author)).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidCredential"),
    );
  });
});

describe("verifyJwsDocument", () => {
  it("rejects a signature made by another key", async () => {
    const forged = await forge(note, stranger, { kid: authorDid });

    await expect(verifyJwsDocument(noteProfile, forged)).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidSignature"),
    );
  });

  it("never lets kid choose the verification key", async () => {
    // A document authored by `author` on paper, signed by `stranger`, with the
    // header pointing at the stranger's key. If `kid` chose the key, this would
    // verify. The key must come from the payload's `author`.
    const strangerDid = stellarAddressToDid(stranger.publicKey(), "testnet");
    const forged = await forge(note, stranger, { kid: strangerDid });

    await expect(verifyJwsDocument(noteProfile, forged)).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidCredential"),
    );
  });

  it("takes the key from the payload even when there is no kid to take it from", async () => {
    // The companion to the test above. With `kid` absent entirely, the only
    // possible source for the verification key is the payload's `author` — so
    // a document authored by `author` and signed by `stranger` must fail on the
    // signature, not on a header disagreement.
    const forged = await forge(note, stranger, {});

    await expect(verifyJwsDocument(noteProfile, forged)).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidSignature"),
    );
  });

  it("accepts a JWS with no kid at all", async () => {
    const noKid = await forge(note, author, {});
    const verified = await verifyJwsDocument(noteProfile, noKid);
    expect(verified.signer).toBe(authorDid);
  });

  it("rejects a foreign typ, so one document type cannot pass as another", async () => {
    const wrongTyp = await forge(note, author, { typ: "mandate+jwt", kid: authorDid });

    await expect(verifyJwsDocument(noteProfile, wrongTyp)).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidCredential"),
    );
  });

  it("rejects a JWS that is not three segments", async () => {
    await expect(verifyJwsDocument(noteProfile, "not.a.jws.at.all")).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidCredential"),
    );
  });

  it("rejects a payload with no usable signer field", async () => {
    const anonymous = await forge({ body: "a note" }, author, { });

    await expect(verifyJwsDocument(noteProfile, anonymous)).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidCredential"),
    );
  });

  it("validates the full schema only after the signature", async () => {
    // Signed correctly, but off-schema: an unsigned forgery must not be able to
    // reach the schema error and use it as an oracle.
    const offSchema = await forge({ author: authorDid, body: "x", extra: 1 }, author, {});
    await expect(verifyJwsDocument(noteProfile, offSchema)).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidCredential"),
    );

    const forgedAndOffSchema = await forge({ author: authorDid, body: "x", extra: 1 }, stranger, {});
    await expect(verifyJwsDocument(noteProfile, forgedAndOffSchema)).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidSignature"),
    );
  });

  it("rejects a profile whose peek field and accessor disagree", async () => {
    // The one way a profile can be wrong without being obviously wrong: the
    // key is found via `signerField` but reported via `signerDid`. If they name
    // different fields, verification would attribute the document to a DID that
    // never signed it.
    const twoFaced: JwsDocumentProfile<{ author: string; realAuthor: string; body: string }> = {
      typ: "note+jwt",
      schema: z.strictObject({
        author: stellarDidSchema,
        realAuthor: stellarDidSchema,
        body: z.string().min(1),
      }),
      signerField: "author",
      signerDid: (doc) => doc.realAuthor as never,
      invalidCode: "InvalidCredential",
    };

    const strangerDid = stellarAddressToDid(stranger.publicKey(), "testnet");
    const payload = { author: authorDid, realAuthor: strangerDid, body: "a note" };
    const signed = await forge(payload, author, {});

    await expect(verifyJwsDocument(twoFaced, signed)).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidCredential"),
    );
  });
});
