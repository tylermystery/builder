import { db } from "../../db/index.js";
import {
  crmAuditLog,
  crmMailboxConnections,
  crmMailboxSyncState,
} from "../../db/schema.js";
import { encryptSecret, verifyCrmToken } from "./utils/crm-crypto.js";
import {
  exchangeGoogleCode,
  gmailProfile,
} from "./utils/crm-google.js";

type OAuthState = {
  purpose: string;
  storeId: string;
  actorUserId: string;
  actorEmail: string;
  storeName: string;
};

function crmRedirect(req: Request, result: string) {
  const base = process.env.URL || new URL(req.url).origin;
  return Response.redirect(`${base.replace(/\/$/, "")}/crm.html?google=${result}`, 302);
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  if (!code || !stateToken) return crmRedirect(req, "missing");
  try {
    const state = verifyCrmToken<OAuthState>(stateToken);
    if (state.purpose !== "google_crm_oauth") return crmRedirect(req, "invalid");
    const tokens = await exchangeGoogleCode(code, req);
    if (!tokens.refresh_token) return crmRedirect(req, "refresh-token-required");
    const profile = await gmailProfile(tokens.access_token);
    const encrypted = encryptSecret(tokens.refresh_token);
    const [connection] = await db
      .insert(crmMailboxConnections)
      .values({
        storeId: state.storeId,
        provider: "google",
        mailboxEmail: profile.emailAddress.toLowerCase(),
        providerAccountId: profile.emailAddress.toLowerCase(),
        encryptedRefreshToken: encrypted.encrypted,
        tokenIv: encrypted.iv,
        tokenTag: encrypted.tag,
        scopes: tokens.scope?.split(" ") || [],
        status: "active",
        connectedByUserId: state.actorUserId,
        connectedByEmail: state.actorEmail,
        tokenExpiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [crmMailboxConnections.storeId, crmMailboxConnections.mailboxEmail],
        set: {
          encryptedRefreshToken: encrypted.encrypted,
          tokenIv: encrypted.iv,
          tokenTag: encrypted.tag,
          scopes: tokens.scope?.split(" ") || [],
          status: "active",
          connectedByUserId: state.actorUserId,
          connectedByEmail: state.actorEmail,
          tokenExpiresAt: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : null,
          lastError: null,
          lastErrorAt: null,
          updatedAt: new Date(),
        },
      })
      .returning();

    const after = new Date();
    after.setUTCMonth(after.getUTCMonth() - 24);
    await db
      .insert(crmMailboxSyncState)
      .values({
        connectionId: connection.id,
        storeId: state.storeId,
        stream: "all_mail",
        backfillAfter: after,
        backfillComplete: false,
        nextSyncAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [crmMailboxSyncState.connectionId, crmMailboxSyncState.stream],
        set: {
          backfillAfter: after,
          backfillPageToken: null,
          backfillComplete: false,
          historyId: null,
          failureCount: 0,
          recoveryState: null,
          nextSyncAt: new Date(),
          updatedAt: new Date(),
        },
      });
    await db.insert(crmAuditLog).values({
      storeId: state.storeId,
      actorUserId: state.actorUserId,
      actorEmail: state.actorEmail,
      action: "mailbox.connected",
      targetType: "mailbox",
      targetId: String(connection.id),
      metadata: { provider: "google", mailboxEmail: profile.emailAddress.toLowerCase() },
    });
    return crmRedirect(req, "connected");
  } catch (error) {
    console.error("[crm-google-callback]", (error as Error).message);
    return crmRedirect(req, "error");
  }
};

export const config = { path: "/api/crm/google/callback" };
