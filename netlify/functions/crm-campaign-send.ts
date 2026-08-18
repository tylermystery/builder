import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { crmCampaigns } from "../../db/schema.js";
import { crmErrorResponse, requireCrmAccess } from "./utils/crm-auth.js";
import { processCampaignBatch } from "./utils/crm-campaign.js";
import { timingSafeEqual } from "./utils/crm-crypto.js";

export default async (req: Request) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const payload = (await req.json()) as { campaignId?: number };
    const campaignId = Number(payload.campaignId);
    if (!Number.isInteger(campaignId) || campaignId < 1) {
      return Response.json({ error: "campaignId is required" }, { status: 400 });
    }
    const provided = req.headers.get("x-crm-internal-secret") || "";
    const internal = Boolean(
      process.env.CRM_INTERNAL_SECRET &&
        provided &&
        timingSafeEqual(provided, process.env.CRM_INTERNAL_SECRET),
    );
    if (!internal) {
      const [campaign] = await db
        .select()
        .from(crmCampaigns)
        .where(eq(crmCampaigns.id, campaignId));
      if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });
      await requireCrmAccess(req, { storeId: campaign.storeId, capability: "send_campaign" });
    }
    const result = await processCampaignBatch(campaignId);
    if (!result.complete && process.env.CRM_INTERNAL_SECRET) {
      const base = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(req.url).origin;
      await fetch(`${base.replace(/\/$/, "")}/api/crm/campaign-send`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-crm-internal-secret": process.env.CRM_INTERNAL_SECRET,
        },
        body: JSON.stringify({ campaignId }),
      });
    }
    return Response.json(result);
  } catch (error) {
    return crmErrorResponse(error);
  }
};

export const config = { path: "/api/crm/campaign-send", background: true };
