import crypto from "node:crypto";
import jwt from "jsonwebtoken";

function encryptionKey() {
  const secret = process.env.CRM_TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new Error("CRM token encryption is not configured");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    encrypted: encrypted.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptSecret(payload: {
  encrypted: string;
  iv: string;
  tag: string;
}) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(payload.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function signingSecret() {
  const secret =
    process.env.CRM_SIGNING_SECRET || process.env.JWT_SECRET || process.env.CRM_TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new Error("CRM signing is not configured");
  return secret;
}

export function signCrmToken(
  payload: Record<string, unknown>,
  expiresIn: jwt.SignOptions["expiresIn"] = "15m",
) {
  return jwt.sign(payload, signingSecret(), { expiresIn });
}

export function verifyCrmToken<T extends object>(token: string) {
  return jwt.verify(token, signingSecret()) as T;
}

export function hashValue(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function timingSafeEqual(value: string, expected: string) {
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
