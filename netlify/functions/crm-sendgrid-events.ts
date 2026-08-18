import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  crmCampaignRecipients,
  crmConsentEvents,
  crmContacts,
  crmEmailEvents,
  crmSuppressions,
} from "../../db/schema.js";
import { hashValue } from "./utils/crm-crypto.js";

type SendGridEvent = {
  email?: string;
  event?: string;
  timestamp?: number;
  sg_event_id?: string;
  sg_message_id?: string;
  crm_store_id?: string;
  crm_campaign_id?: string;
  crm_recipient_id?: string;
  reason?: string;
  response?: string;
};

async function signatureValid(req: Request, payload: string) {
  const publicKey = process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY;
  if (!publicKey) return process.env.CRM_ALLOW_UNSIGNED_WEBHOOKS === "true";
  const signature = req.headers.get("x-twilio-email-event-webhook-signature");
  const timestamp = req.headers.get("x-twilio-email-event-webhook-timestamp");
  if (!signature || !timestamp) return false;
  const imported = await import("@sendgrid/eventwebhook");
  const packageValue = (imported.default || imported) as unknown as {
    EventWebhook: new () => {
      convertPublicKeyToECDSA(value: string): unknown;
      verifySignature(key: unknown, body: string, signature: string, timestamp: string): boolean;
    };
  };
  const verifier = new packageValue.EventWebhook();
  return verifier.verifySignature(
    verifier.convertPublicKeyToECDSA(publicKey),
    payload,
    signature,
    timestamp,
  );
}

export default async (req: Request) => {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const rawBody = await req.text();
  if (!(await signatureValid(req, rawBody))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  let events: SendGridEvent[];
  try {
    events = JSON.parse(rawBody) as SendGridEvent[];
  } catch {
    return Response.json({ error: "Invalid event payload" }, { status: 400 });
  }

  for (const event of events) {
    const storeId = String(event.crm_store_id || "");
    const recipientId = Number(event.crm_recipient_id || 0) || null;
    const campaignId = Number(event.crm_campaign_id || 0) || null;
    const email = String(event.email || "").trim().toLowerCase();
    const eventType = String(event.event || "unknown");
    const providerEventId =
      event.sg_event_id || hashValue(`${event.sg_message_id}:${eventType}:${event.timestamp}:${email}`);
    if (!storeId) continue;
    const [inserted] = await db
      .insert(crmEmailEvents)
      .values({
        storeId,
        campaignId,
        recipientId,
        providerEventId,
        providerMessageId: event.sg_message_id || null,
        normalizedEmail: email || null,
        eventType,
        occurredAt: new Date((event.timestamp || Date.now() / 1000) * 1000),
        metadata: { reason: event.reason, response: event.response },
      })
      .onConflictDoNothing({ target: [crmEmailEvents.providerEventId] })
      .returning();
    if (!inserted) continue;

    const recipientStatus: Record<string, string> = {
      processed: "processed",
      delivered: "delivered",
      deferred: "deferred",
      bounce: "bounced",
      dropped: "dropped",
      spamreport: "complained",
      unsubscribe: "unsubscribed",
      group_unsubscribe: "unsubscribed",
    };
    if (recipientId && recipientStatus[eventType]) {
      await db
        .update(crmCampaignRecipients)
        .set({ status: recipientStatus[eventType], updatedAt: new Date() })
        .where(eq(crmCampaignRecipients.id, recipientId));
    }

    const suppressionType: Record<string, string> = {
      bounce: "hard_bounce",
      dropped: "dropped",
      spamreport: "complaint",
      unsubscribe: "unsubscribe",
      group_unsubscribe: "unsubscribe",
    };
    if (email && suppressionType[eventType]) {
      const [contact] = await db
        .select()
        .from(crmContacts)
        .where(and(eq(crmContacts.storeId, storeId), eq(crmContacts.normalizedEmail, email)));
      await db
        .insert(crmSuppressions)
        .values({
          storeId,
          contactId: contact?.id || null,
          normalizedEmail: email,
          suppressionType: suppressionType[eventType],
          source: "sendgrid_event",
          providerEventId,
        })
        .onConflictDoNothing({ target: [crmSuppressions.providerEventId] });
      if (contact) {
        const permission = eventType === "spamreport" ? "complained" : eventType === "bounce" ? "hard_bounced" : "opted_out";
        await db
          .update(crmContacts)
          .set({ marketingPermission: permission, updatedAt: new Date() })
          .where(eq(crmContacts.id, contact.id));
        await db.insert(crmConsentEvents).values({
          storeId,
          contactId: contact.id,
          state: permission,
          source: "sendgrid_event",
          evidence: `SendGrid reported ${eventType}.`,
        });
      }
    }
  }
  return Response.json({ received: true });
};

export const config = { path: "/api/crm/sendgrid-events" };
