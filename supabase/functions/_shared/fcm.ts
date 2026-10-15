// Firebase Cloud Messaging (HTTP v1) sender for Android and iOS apps. Uses a Google service account:
// signs a short-lived OAuth token with the account's private key (RS256), then posts messages to FCM.
// Dependencies are injectable so the logic is tested without the network.

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** ok: delivered to FCM. invalid: this token is dead, delete it. retry: try again later. */
export type SendResult = 'ok' | 'invalid' | 'retry';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const b64url = (input: ArrayBuffer | string): string => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [A-Z ]+-----/g, '').replace(/-----END [A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** The signed assertion Google exchanges for an access token */
export async function signServiceAccountJwt(account: ServiceAccount, nowSeconds: number): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: account.client_email,
    scope: SCOPE,
    aud: account.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

/** FCM data values must all be strings */
const stringify = (data: Record<string, unknown> = {}): Record<string, string> =>
  Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));

export function createFcmSender(opts: { serviceAccount: ServiceAccount; fetch?: typeof fetch; now?: () => number }) {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  let cached: { token: string; expires: number } | null = null;

  async function accessToken(force = false): Promise<string> {
    if (!force && cached && cached.expires - 60 > now()) return cached.token;
    const assertion = await signServiceAccountJwt(opts.serviceAccount, now());
    const res = await doFetch(opts.serviceAccount.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    if (!res.ok) throw new Error(`oauth ${res.status}`);
    const json = await res.json();
    cached = { token: json.access_token, expires: now() + Number(json.expires_in ?? 3600) };
    return cached.token;
  }

  async function post(token: string, device: string, msg: PushMessage): Promise<Response> {
    return doFetch(`https://fcm.googleapis.com/v1/projects/${opts.serviceAccount.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: device,
          notification: { title: msg.title, body: msg.body },
          data: stringify(msg.data),
          android: { priority: 'HIGH' },
          apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
        },
      }),
    });
  }

  return async function send(device: string, msg: PushMessage): Promise<SendResult> {
    try {
      let res = await post(await accessToken(), device, msg);
      if (res.status === 401) res = await post(await accessToken(true), device, msg); // token expired early: refresh once
      if (res.ok) return 'ok';
      if (res.status === 404) return 'invalid'; // UNREGISTERED: the app was removed or the token rotated
      if (res.status === 400) {
        // INVALID_ARGUMENT for a malformed token means it is useless; other 400s are our bug and must not delete devices
        const body = await res.json().catch(() => null);
        const text = JSON.stringify(body ?? '');
        return /registration token|UNREGISTERED|INVALID_ARGUMENT/.test(text) && /token/i.test(text) ? 'invalid' : 'retry';
      }
      return 'retry'; // 403 (wrong project), 429, 5xx
    } catch {
      return 'retry';
    }
  };
}
