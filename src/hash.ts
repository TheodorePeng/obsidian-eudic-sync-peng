function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);

  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
    return bytesToHex(new Uint8Array(digest));
  }

  const crypto = await import("node:crypto");
  return crypto.createHash("sha256").update(content).digest("hex");
}
