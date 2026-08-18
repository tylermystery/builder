import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { crmMailboxConnections } from "../../db/schema.js";
import { crmErrorResponse, requireCrmAccess } from "./utils/crm-auth.js";
import { timingSafeEqual } from "./utils/crm-crypto.js";
import { syncConnection } from "./utils/crm-ingest.js";

export default async (req: Request) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const payload = (await req.json()) as { connectionId?: number; maxPages?: number };
    const connectionId = Number(payload.connectionId);
    if (!Number.isInteger(connectionId) || connectionId < 1) {
      return Response.json({ error: "connectionId is required" }, { status: 400 });
    }
    const internalSecret = req.headers.get("x-crm-internal-secret") || "";
    const isInternal = Boolean(
      process.env.CRM_INTERNAL_SECRET &&
        internalSecret &&
        timingSafeEqual(internalSecret, process.env.CRM_INTERNAL_SECRET),
    );
    if (!isInternal) {
      const [connection] = await db
        .select()
        .from(crmMailboxConnections)
        .where(eq(crmMailboxConnections.id, connectionId));
      if (!connection) return Response.json({ error: "Mailbox not found" }, { status: 404 });
      await requireCrmAccess(req, {
        storeId: connection.storeId,
        capability: "connect_mailbox",
      });
    }
    await syncConnection(connectionId, Math.min(Math.max(Number(payload.maxPages) || 4, 1), 10));
    return Response.json({ success: true });
  } catch (error) {
    return crmErrorResponse(error);
  }
};

export const config = {
  path: "/api/crm/sync",
  background: true,
};
