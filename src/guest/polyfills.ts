/**
 * Guests open the room over plain http on the local network. Browsers treat that
 * as an insecure context and leave out `crypto.randomUUID` there (the app calls it
 * when Explore starts), so provide it from `getRandomValues`, which they keep.
 */
export function uuidFromRandomBytes(bytes: Uint8Array): string {
  const b = Uint8Array.from(bytes);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}

export function installGuestPolyfills() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: () => uuidFromRandomBytes(crypto.getRandomValues(new Uint8Array(16))) as `${string}-${string}-${string}-${string}-${string}`,
    });
  }
}
