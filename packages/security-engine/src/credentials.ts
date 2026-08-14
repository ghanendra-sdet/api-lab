/**
 * The fixed, non-authentic credentials used by authentication mutations
 * (spec §12).
 *
 * ## Why these are constants
 *
 * Every value here is a *deliberately invalid* credential, hardcoded and
 * self-identifying. That is the whole design. Milestone 12 tests whether an
 * API rejects a bad credential; it does not try to find a good one. Spec §48
 * rules out credential brute force and password spraying, and the structural
 * way to guarantee that is to have exactly one candidate value per mutation
 * kind, baked into source, with `api-lab` written inside it.
 *
 * A server operator reading their logs after a security run should be able to
 * tell instantly that these came from a QA tool and not from an attacker.
 * That is why every value carries the product name rather than looking like a
 * plausible real token.
 *
 * ## The expired JWT
 *
 * Precomputed rather than generated, so it is a byte-for-byte constant that
 * can be grepped for in a server log. Its `exp` is 2001-09-09, its signature
 * is the literal base64 of an English sentence, and it is signed with
 * nothing. It cannot become valid, it cannot be replayed anywhere, and it is
 * decodable by anyone who wonders what it is.
 */

/** A syntactically well-formed bearer token that is certainly not authentic. */
export const INVALID_BEARER_TOKEN = "api-lab-invalid-token-do-not-honour";

/**
 * A structurally valid JWT whose `exp` is in the distant past
 * (2001-09-09T01:46:40Z) and whose signature is not a signature.
 *
 * header:  {"alg":"HS256","typ":"JWT"}
 * payload: {"sub":"api-lab-negative-test","iss":"api-lab","exp":1000000000}
 */
export const EXPIRED_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJzdWIiOiJhcGktbGFiLW5lZ2F0aXZlLXRlc3QiLCJpc3MiOiJhcGktbGFiIiwiZXhwIjoxMDAwMDAwMDAwfQ." +
  "QVBJTGFiTmVnYXRpdmVUZXN0U2lnbmF0dXJl";

/**
 * A token that is not a token at all — no dot-separated segments, no base64.
 * Distinguishes "the API validated my credential and rejected it" (401) from
 * "the API crashed trying to parse it" (500), which is the actual robustness
 * question behind spec §12's malformed-token case.
 */
export const MALFORMED_TOKEN = "api-lab.not-a-valid-jwt...!!";

/** A stand-in API key. Fixed, single, and obviously synthetic (spec §48). */
export const WRONG_API_KEY = "api-lab-invalid-api-key-do-not-honour";

/** Basic-auth credentials that are certainly not provisioned anywhere. The
 * base64 of `api-lab-negative-test:api-lab-invalid-password`. */
export const INVALID_BASIC_CREDENTIALS =
  "YXBpLWxhYi1uZWdhdGl2ZS10ZXN0OmFwaS1sYWItaW52YWxpZC1wYXNzd29yZA==";

/** The single out-of-range enum token used by enum mutations (spec §8). One
 * deterministic value, never a generated dictionary. */
export const INVALID_ENUM_VALUE = "invalid_enum";

/** Stand-in values for path-parameter mutations (spec §9). */
export const INVALID_INTEGER_VALUE = "abc";
export const INVALID_UUID_VALUE = "invalid-id";

/** A content type no API in this product's scope negotiates, used by the
 * unexpected-content-type mutation (spec §11). */
export const UNEXPECTED_CONTENT_TYPE = "application/x-api-lab-unexpected";
