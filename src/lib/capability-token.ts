const CAPABILITY_TOKEN_BYTES = 24;

/**
 * Generate an opaque bearer capability with at least 192 bits of entropy.
 *
 * Capability tokens grant access to private records, so an insecure fallback is
 * deliberately not provided. Callers must stop the operation when Web Crypto is
 * unavailable instead of publishing a guessable token.
 */
export function generateCapabilityToken(prefix?: string): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("Secure random token generation is unavailable in this browser");
  }

  const bytes = new Uint8Array(CAPABILITY_TOKEN_BYTES);
  cryptoApi.getRandomValues(bytes);
  const value = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return prefix ? `${prefix}-${value}` : value;
}
