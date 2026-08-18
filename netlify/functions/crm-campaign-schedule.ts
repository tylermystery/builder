import { dueCampaigns, processCampaignBatch } from "./utils/crm-campaign.js";

export default async () => {
  const campaigns = await dueCampaigns(3);
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const internalSecret = process.env.CRM_INTERNAL_SECRET;
  if (base && internalSecret) {
    await Promise.all(
      campaigns.map((campaign) =>
        fetch(`${base.replace(/\/$/, "")}/api/crm/campaign-send`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-crm-internal-secret": internalSecret,
          },
          body: JSON.stringify({ campaignId: campaign.id }),
        }),
      ),
    );
  } else if (campaigns[0]) {
    await processCampaignBatch(campaigns[0].id, 10);
  }
  return new Response(null, { status: 204 });
};

export const config = { schedule: "*/5 * * * *" };
