const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Short, URL-safe, collision-resistant id (never starts with a digit or '=' so Sheets treats it as text). */
export function uid(len = 12) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = 'r';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function nowISO() {
  return new Date().toISOString();
}
