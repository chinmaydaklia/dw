/* Passphrase encryption for sync files: AES-GCM 256 with a key from PBKDF2-SHA256 (WebCrypto, on this device). */
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const cryptoAvailable = () => !!(globalThis.crypto && crypto.subtle);
async function keyFor(pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptText(text, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 210000;
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(pass, salt, iter), enc.encode(text)));
  return JSON.stringify({ dwbenc: 1, alg: 'AES-GCM-256 / PBKDF2-SHA256', iter, salt: b64(salt), iv: b64(iv), data: b64(ct) });
}
export const isEncrypted = o => !!o && o.dwbenc === 1;
export async function decryptText(env, pass) {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, await keyFor(pass, unb64(env.salt), env.iter || 210000), unb64(env.data));
    return dec.decode(pt);
  } catch { throw new Error('Wrong passphrase (or the file is damaged).'); }
}
