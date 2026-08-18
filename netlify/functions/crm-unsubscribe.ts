import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  crmConsentEvents,
  crmContacts,
  crmSuppressions,
} from "../../db/schema.js";
import { verifyCrmToken } from "./utils/crm-crypto.js";

type Token = {
  purpose: string;
  storeId: string;
  contactId: number | null;
  email: string;
};

function page(message: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Email preferences</title></head><body style="font-family:system-ui;max-width:560px;margin:60px auto;padding:24px"><h1>Email preferences</h1><p>${message}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export default async (req: Request) => {
  if (!["GET", "POST"].includes(req.method)) return page("Method not allowed.", 405);
  try {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return page("This unsubscribe link is invalid.", 400);
    const payload = verifyCrmToken<Token>(token);
    if (payload.purpose === "crm_unsubscribe_preview") {
      return page("This is a test unsubscribe link. No contact preferences were changed.");
    }
    if (payload.purpose !== "crm_unsubscribe") return page("This unsubscribe link is invalid.", 400);
    const email = payload.email.trim().toLowerCase();
    const [contact] = payload.contactId
      ? await db
          .select()
          .from(crmContacts)
          .where(
            and(
              eq(crmContacts.id, payload.contactId),
              eq(crmContacts.storeId, payload.storeId),
            ),
          )
      : [null];
    if (contact) {
      await db
        .update(crmContacts)
        .set({ marketingPermission: "opted_out", updatedAt: new Date() })
        .where(eq(crmContacts.id, contact.id));
      await db.insert(crmConsentEvents).values({
        storeId: payload.storeId,
        contactId: contact.id,
        state: "opted_out",
        source: "one_click_unsubscribe",
        evidence: "Recipient used the campaign unsubscribe endpoint.",
      });
    }
    await db.insert(crmSuppressions).values({
      storeId: payload.storeId,
      contactId: contact?.id || null,
      normalizedEmail: email,
      suppressionType: "unsubscribe",
      source: "one_click_unsubscribe",
    });
    return page("You have been unsubscribed from marketing email. Service-related messages may still be sent when needed.");
  } catch {
    return page("This unsubscribe link is invalid or expired.", 400);
  }
};

export const config = { path: "/api/crm/unsubscribe" };
