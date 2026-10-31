// GET /api/crowdfund?fundKey=<item id>
//
// Public read of an item's crowdfund meter: the total raised and the number of
// contributions that still count (submitted ACH + succeeded; failed and refunded
// payments drop out). Contributions are written by the Stripe webhook — see
// utils/crowdfund-contributions.js — so this endpoint is read-only.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { crowdfundContributions } from "../../db/schema.js";

const COUNTED_STATUSES = ["processing", "succeeded"];

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

export default async (req: Request) => {
  if (req.method !== "GET") return json(405, { error: "Method not allowed" });

  const fundKey = new URL(req.url).searchParams.get("fundKey") || "";
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(fundKey)) {
    return json(400, { error: "A valid fundKey is required" });
  }

  try {
    const [row] = await db
      .select({
        raisedCents: sql<number>`coalesce(sum(${crowdfundContributions.amountCents}), 0)::int`,
        contributors: sql<number>`count(*)::int`,
      })
      .from(crowdfundContributions)
      .where(
        and(
          eq(crowdfundContributions.fundKey, fundKey),
          inArray(crowdfundContributions.status, COUNTED_STATUSES),
        ),
      );

    return json(200, {
      fundKey,
      raised: (row?.raisedCents || 0) / 100,
      contributors: row?.contributors || 0,
    });
  } catch (error) {
    console.error("[crowdfund] read failed:", error);
    return json(500, { error: "Could not load crowdfund progress" });
  }
};

export const config = {
  path: "/api/crowdfund",
};
