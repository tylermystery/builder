import { dueConnections, purgeExpiredExcerpts, syncConnection } from "./utils/crm-ingest.js";

export default async () => {
  const connectionIds = await dueConnections(3);
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const internalSecret = process.env.CRM_INTERNAL_SECRET;
  if (base && internalSecret) {
    await Promise.all(
      connectionIds.map((connectionId) =>
        fetch(`${base.replace(/\/$/, "")}/api/crm/sync`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-crm-internal-secret": internalSecret,
          },
          body: JSON.stringify({ connectionId, maxPages: 2 }),
        }),
      ),
    );
  } else {
    for (const connectionId of connectionIds.slice(0, 1)) {
      await syncConnection(connectionId, 1);
    }
  }
  await purgeExpiredExcerpts();
  return new Response(null, { status: 204 });
};

export const config = { schedule: "*/10 * * * *" };
