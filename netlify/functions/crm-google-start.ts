import { recordCrmAudit, requireCrmAccess, crmErrorResponse } from "./utils/crm-auth.js";
import { signCrmToken } from "./utils/crm-crypto.js";
import { googleAuthorizationUrl } from "./utils/crm-google.js";

export default async (req: Request) => {
  try {
    if (req.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const storeId = new URL(req.url).searchParams.get("storeId");
    const actor = await requireCrmAccess(req, { storeId, capability: "connect_mailbox" });
    const state = signCrmToken(
      {
        purpose: "google_crm_oauth",
        storeId: actor.storeId,
        actorUserId: actor.airtableUserId,
        actorEmail: actor.email,
        storeName: actor.storeName,
      },
      "15m",
    );
    await recordCrmAudit(actor, "mailbox.oauth_started", "store", actor.storeId);
    return Response.json({ authorizationUrl: googleAuthorizationUrl(state, req) });
  } catch (error) {
    return crmErrorResponse(error);
  }
};

export const config = { path: "/api/crm/google/start" };
