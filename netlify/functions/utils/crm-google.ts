import { decryptSecret } from "./crm-crypto.js";

const GOOGLE_OAUTH = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function googleConfig() {
  const clientId = process.env.GOOGLE_CRM_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CRM_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google CRM OAuth is not configured");
  return { clientId, clientSecret };
}

export function googleRedirectUri(req?: Request) {
  if (process.env.GOOGLE_CRM_REDIRECT_URI) return process.env.GOOGLE_CRM_REDIRECT_URI;
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (base) return `${base.replace(/\/$/, "")}/api/crm/google/callback`;
  if (req) return `${new URL(req.url).origin}/api/crm/google/callback`;
  throw new Error("Google CRM redirect URL is not configured");
}

export function googleAuthorizationUrl(state: string, req: Request) {
  const { clientId } = googleConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", googleRedirectUri(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.readonly");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGoogleCode(code: string, req: Request) {
  const { clientId, clientSecret } = googleConfig();
  const response = await fetch(GOOGLE_OAUTH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(req),
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new Error("Google authorization exchange failed");
  return (await response.json()) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
  };
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = googleConfig();
  const response = await fetch(GOOGLE_OAUTH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error("Google mailbox authorization expired");
  const payload = (await response.json()) as { access_token: string; expires_in?: number };
  return payload.access_token;
}

export async function accessTokenForConnection(connection: {
  encryptedRefreshToken: string;
  tokenIv: string;
  tokenTag: string;
}) {
  const refreshToken = decryptSecret({
    encrypted: connection.encryptedRefreshToken,
    iv: connection.tokenIv,
    tag: connection.tokenTag,
  });
  return refreshGoogleAccessToken(refreshToken);
}

export async function gmailRequest<T>(
  accessToken: string,
  path: string,
  params?: URLSearchParams,
): Promise<T> {
  const url = new URL(`${GMAIL_API}${path}`);
  if (params) url.search = params.toString();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const error = Object.assign(new Error(`Gmail request failed with status ${response.status}`), {
      status: response.status,
    });
    throw error;
  }
  return (await response.json()) as T;
}

export async function gmailProfile(accessToken: string) {
  return gmailRequest<{ emailAddress: string; historyId: string }>(accessToken, "/profile");
}
