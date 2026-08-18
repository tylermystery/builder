import sgMail from "@sendgrid/mail";
import { and, count, eq, inArray, lte } from "drizzle-orm";
import { db } from "../../../db/index.js";
import {
  crmCampaignRecipients,
  crmCampaigns,
  crmContacts,
  crmSuppressions,
} from "../../../db/schema.js";
import { signCrmToken } from "./crm-crypto.js";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unsubscribeUrl(storeId: string, contactId: number | null, email: string) {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) throw new Error("Site URL is not configured");
  const token = signCrmToken(
    { purpose: "crm_unsubscribe", storeId, contactId, email },
    "365d",
  );
  return `${base.replace(/\/$/, "")}/api/crm/unsubscribe?token=${encodeURIComponent(token)}`;
}

function previewUnsubscribeUrl(storeId: string, email: string) {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) throw new Error("Site URL is not configured");
  const token = signCrmToken(
    { purpose: "crm_unsubscribe_preview", storeId, contactId: null, email },
    "1d",
  );
  return `${base.replace(/\/$/, "")}/api/crm/unsubscribe?token=${encodeURIComponent(token)}`;
}

function messageBodies(campaign: typeof crmCampaigns.$inferSelect, unsubscribe: string) {
  const address = process.env.CRM_BUSINESS_ADDRESS;
  if (!address) throw new Error("CRM business mailing address is not configured");
  const reason =
    process.env.CRM_RELATIONSHIP_DISCLOSURE ||
    "You are receiving this because you previously communicated with Tyler's Mystery Tours.";
  const footer = `<hr style="border:0;border-top:1px solid #ddd;margin:28px 0 16px"><p style="font-size:12px;line-height:1.5;color:#666">${escapeHtml(reason)}<br>${escapeHtml(address)}<br><a href="${unsubscribe}">Unsubscribe from marketing email</a></p>`;
  const textFooter = `\n\n${reason}\n${address}\nUnsubscribe: ${unsubscribe}`;
  return {
    html: `${campaign.htmlBody}${footer}`,
    text: `${campaign.textBody || campaign.htmlBody.replace(/<[^>]+>/g, " ")}${textFooter}`,
  };
}

async function sendRecipient(
  campaign: typeof crmCampaigns.$inferSelect,
  recipient: typeof crmCampaignRecipients.$inferSelect,
) {
  const [contact] = recipient.contactId
    ? await db.select().from(crmContacts).where(eq(crmContacts.id, recipient.contactId))
    : [null];
  const [suppression] = await db
    .select()
    .from(crmSuppressions)
    .where(
      and(
        eq(crmSuppressions.storeId, campaign.storeId),
        eq(crmSuppressions.normalizedEmail, recipient.normalizedEmail),
      ),
    );
  const eligible =
    contact &&
    contact.storeId === campaign.storeId &&
    contact.relationshipState === "substantiated_relationship" &&
    ["unconfirmed_relationship", "explicit_opt_in"].includes(contact.marketingPermission) &&
    !suppression;
  if (!eligible) {
    await db
      .update(crmCampaignRecipients)
      .set({
        status: "suppressed",
        suppressionReason: suppression?.suppressionType || "contact_not_eligible",
        updatedAt: new Date(),
      })
      .where(eq(crmCampaignRecipients.id, recipient.id));
    return;
  }

  const unsubscribe = unsubscribeUrl(
    campaign.storeId,
    recipient.contactId,
    recipient.normalizedEmail,
  );
  const bodies = messageBodies(campaign, unsubscribe);
  const [response] = await sgMail.send({
    to: {
      email: recipient.normalizedEmail,
      name: recipient.displayName || undefined,
    },
    from: { email: campaign.fromEmail, name: campaign.fromName },
    replyTo: campaign.replyToEmail || undefined,
    subject: campaign.subject,
    html: bodies.html,
    text: bodies.text,
    categories: ["crm-marketing", `store-${campaign.storeId}`],
    customArgs: {
      crm_store_id: campaign.storeId,
      crm_campaign_id: String(campaign.id),
      crm_recipient_id: String(recipient.id),
    },
    headers: {
      "List-Unsubscribe": `<${unsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  const providerMessageId = response.headers?.["x-message-id"]
    ? String(response.headers["x-message-id"])
    : null;
  await db
    .update(crmCampaignRecipients)
    .set({
      status: "sent",
      providerMessageId,
      attempts: recipient.attempts + 1,
      lastAttemptAt: new Date(),
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(crmCampaignRecipients.id, recipient.id));
}

export async function processCampaignBatch(campaignId: number, batchSize = 25) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error("SendGrid is not configured");
  sgMail.setApiKey(apiKey);

  const [campaign] = await db
    .select()
    .from(crmCampaigns)
    .where(eq(crmCampaigns.id, campaignId));
  if (!campaign || !["approved", "sending"].includes(campaign.status)) {
    return { complete: true, processed: 0 };
  }
  if (campaign.scheduledAt && campaign.scheduledAt > new Date()) {
    return { complete: false, processed: 0 };
  }
  await db
    .update(crmCampaigns)
    .set({ status: "sending", updatedAt: new Date() })
    .where(eq(crmCampaigns.id, campaign.id));

  const recipients = await db
    .select()
    .from(crmCampaignRecipients)
    .where(
      and(
        eq(crmCampaignRecipients.campaignId, campaign.id),
        eq(crmCampaignRecipients.status, "pending"),
      ),
    )
    .limit(batchSize);

  for (let index = 0; index < recipients.length; index += 5) {
    const group = recipients.slice(index, index + 5);
    await Promise.all(
      group.map(async (recipient) => {
        try {
          await sendRecipient(campaign, recipient);
        } catch (error) {
          await db
            .update(crmCampaignRecipients)
            .set({
              status: recipient.attempts >= 2 ? "failed" : "pending",
              attempts: recipient.attempts + 1,
              lastAttemptAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(crmCampaignRecipients.id, recipient.id));
          console.error("[crm-campaign] recipient send failed", recipient.id, (error as Error).message);
        }
      }),
    );
  }

  const [{ remaining }] = await db
    .select({ remaining: count() })
    .from(crmCampaignRecipients)
    .where(
      and(
        eq(crmCampaignRecipients.campaignId, campaign.id),
        eq(crmCampaignRecipients.status, "pending"),
      ),
    );
  if (remaining === 0) {
    await db
      .update(crmCampaigns)
      .set({ status: "complete", updatedAt: new Date() })
      .where(eq(crmCampaigns.id, campaign.id));
  }
  return { complete: remaining === 0, processed: recipients.length };
}

export async function sendCampaignTest(
  campaign: typeof crmCampaigns.$inferSelect,
  recipientEmail: string,
) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error("SendGrid is not configured");
  sgMail.setApiKey(apiKey);
  const unsubscribe = previewUnsubscribeUrl(campaign.storeId, recipientEmail);
  const bodies = messageBodies(campaign, unsubscribe);
  await sgMail.send({
    to: recipientEmail,
    from: { email: campaign.fromEmail, name: campaign.fromName },
    replyTo: campaign.replyToEmail || undefined,
    subject: `[TEST] ${campaign.subject}`,
    html: `<p style="padding:10px;background:#fff3cd"><strong>Test message:</strong> no campaign recipient was contacted.</p>${bodies.html}`,
    text: `TEST MESSAGE — no campaign recipient was contacted.\n\n${bodies.text}`,
    categories: ["crm-marketing-test", `store-${campaign.storeId}`],
  });
}

export async function dueCampaigns(limit = 3) {
  return db
    .select({ id: crmCampaigns.id })
    .from(crmCampaigns)
    .where(
      and(
        inArray(crmCampaigns.status, ["approved", "sending"]),
        lte(crmCampaigns.scheduledAt, new Date()),
      ),
    )
    .limit(limit);
}
