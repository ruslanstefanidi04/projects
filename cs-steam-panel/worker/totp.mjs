import crypto from "crypto";

const CHARS = "23456789BCDFGHJKMNPQRTVWXY";

export function steamGuard(sharedSecret) {
  if (!sharedSecret) return "";
  const secret = Buffer.from(sharedSecret, "base64");
  const time = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(time, 4);
  const hmac = crypto.createHmac("sha1", secret).update(buf).digest();
  const start = hmac[hmac.length - 1] & 0x0f;
  let code = hmac.readUInt32BE(start) & 0x7fffffff;
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += CHARS[code % CHARS.length];
    code = Math.floor(code / CHARS.length);
  }
  return out;
}
