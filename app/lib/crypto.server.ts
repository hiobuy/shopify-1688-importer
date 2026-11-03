import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function key(): Buffer {
  const encoded = process.env.ENCRYPTION_KEY || "";
  const value = Buffer.from(encoded, "base64");
  if (value.length !== 32 || value.toString("base64") !== encoded)
    throw new Error(
      "ENCRYPTION_KEY must contain exactly 32 random bytes encoded as base64.",
    );
  return value;
}
export function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}
export function decrypt(value: string): string {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext)
    throw new Error(
      "Invalid encrypted credential. Reconfigure this credential.",
    );
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
