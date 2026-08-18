import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  crmCampaignRecipients,
  crmCampaigns,
  crmConsentEvents,
  crmContactPlanLinks,
  crmContactSources,
  crmContacts,
  crmEmailThreads,
  crmInteractions,
  crmMailboxConnections,
  crmMailboxSyncState,
  crmStoreEnrollments,
  crmSuppressions,
} from "../../db/schema.js";
import {
  crmErrorResponse,
  recordCrmAudit,
  requireCrmAccess,
} from "./utils/crm-auth.js";
import { decryptSecret } from "./utils/crm-crypto.js";
import { airtableRequest } from "./utils/crm-airtable.js";
import { sendCampaignTest } from "./utils/crm-campaign.js";

function routePath(req: Request) {
  return new URL(req.url).pathname.replace(/^\/api\/crm\/?/, "");
}

async function body(req: Request) {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function int(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function fetchAllAirtableRecords(table: string, params = new URLSearchParams()) {
  const records: Array<{ id: string; fields: Record<string, unknown> }> = [];
  let offset: string | null = null;
  do {
    const pageParams = new URLSearchParams(params);
    if (offset) pageParams.set("offset", offset);
    const page = await airtableRequest<{
      records: Array<{ id: string; fields: Record<string, unknown> }>;
      offset?: string;
    }>(table, { params: pageParams });
    records.push(...(page.records || []));
    offset = page.offset || null;
  } while (offset);
  return records;
}

async function legacySessions(storeId: string) {
  const params = new URLSearchParams({
    filterByFormula: `FIND('${storeId.replace(/'/g, "\\'")}',ARRAYJOIN({Stores}))`,
  });
  try {
    return await fetchAllAirtableRecords("Sessions", params);
  } catch {
    const all = await fetchAllAirtableRecords("Sessions");
    return all.filter((record) => {
      const stores = record.fields.Stores;
      return Array.isArray(stores) && stores.includes(storeId);
    });
  }
}

export default async (req: Request) => {
  try {
    const url = new URL(req.url);
    const path = routePath(req);
    const requestedStoreId = url.searchParams.get("storeId");

    if (path === "legacy" && req.method === "GET") {
      const actor = await requireCrmAccess(req, { storeId: requestedStoreId, capability: "view" });
      const table = url.searchParams.get("table");
      const allowed = new Set(["Sessions", "Messages", "tblUA4uuS8IYlhKpD", "Teammates"]);
      if (!table || !allowed.has(table)) {
        return Response.json({ error: "Unsupported legacy table" }, { status: 400 });
      }
      const sessions = await legacySessions(actor.storeId);
      if (table === "Sessions") return Response.json({ records: sessions });
      const sessionIds = new Set(sessions.map((session) => session.id));
      if (table === "Messages") {
        const messages = await fetchAllAirtableRecords("Messages");
        return Response.json({
          records: messages.filter((message) => {
            const linked = message.fields.SessionID;
            return Array.isArray(linked) && linked.some((id) => sessionIds.has(String(id)));
          }),
        });
      }
      if (table === "tblUA4uuS8IYlhKpD") {
        const itemIds = new Set<string>();
        for (const session of sessions) {
          try {
            const data = JSON.parse(String(session.fields["Items with Variations"] || "{}"));
            for (const key of ["lockedInItems", "favoritedItems"]) {
              Object.keys(data[key] || {}).forEach((id) => itemIds.add(id));
            }
          } catch {
            // A malformed legacy plan should not expose unrelated catalog data.
          }
        }
        const catalog = await fetchAllAirtableRecords("tblUA4uuS8IYlhKpD");
        return Response.json({ records: catalog.filter((record) => itemIds.has(record.id)) });
      }
      const teammates = await fetchAllAirtableRecords("Teammates");
      return Response.json({
        records: teammates.filter((record) => {
          const stores = record.fields.Stores;
          return !Array.isArray(stores) || stores.includes(actor.storeId);
        }),
      });
    }

    if (path === "legacy/chat" && req.method === "POST") {
      const actor = await requireCrmAccess(req, { storeId: requestedStoreId, capability: "view" });
      const payload = await body(req);
      const sessionId = String(payload.sessionId || "");
      const content = String(payload.content || "").trim();
      if (!sessionId || !content || content.length > 5000) {
        return Response.json({ error: "A valid sessionId and message are required" }, { status: 400 });
      }
      const sessions = await legacySessions(actor.storeId);
      if (!sessions.some((session) => session.id === sessionId)) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }
      const result = await airtableRequest<{ records: unknown[] }>("Messages", {
        method: "POST",
        body: {
          records: [
            {
              fields: {
                SessionID: [sessionId],
                SenderID: actor.airtableUserId,
                SenderName: actor.name || "Store Owner",
                Content: content,
                Timestamp: new Date().toISOString(),
              },
            },
          ],
        },
      });
      await recordCrmAudit(actor, "legacy_chat.sent", "session", sessionId);
      return Response.json(result, { status: 201 });
    }

    if (path === "bootstrap" && req.method === "GET") {
      const actor = await requireCrmAccess(req, { storeId: requestedStoreId, capability: "view" });
      const [[enrollment], [{ contactCount }], [{ pendingCount }], [{ mailboxCount }]] =
        await Promise.all([
          db
            .select()
            .from(crmStoreEnrollments)
            .where(eq(crmStoreEnrollments.storeId, actor.storeId)),
          db
            .select({ contactCount: count() })
            .from(crmContacts)
            .where(eq(crmContacts.storeId, actor.storeId)),
          db
            .select({ pendingCount: count() })
            .from(crmContactSources)
            .where(
              and(
                eq(crmContactSources.storeId, actor.storeId),
                eq(crmContactSources.reviewStatus, "pending"),
              ),
            ),
          db
            .select({ mailboxCount: count() })
            .from(crmMailboxConnections)
            .where(
              and(
                eq(crmMailboxConnections.storeId, actor.storeId),
                eq(crmMailboxConnections.status, "active"),
              ),
            ),
        ]);
      return Response.json({
        actor: {
          email: actor.email,
          name: actor.name,
          role: actor.role,
        },
        store: { id: actor.storeId, name: actor.storeName },
        enrollment,
        counts: { contacts: contactCount, pendingReview: pendingCount, mailboxes: mailboxCount },
        googleConfigured: Boolean(
          process.env.GOOGLE_CRM_CLIENT_ID &&
            process.env.GOOGLE_CRM_CLIENT_SECRET &&
            process.env.CRM_TOKEN_ENCRYPTION_KEY,
        ),
        marketingConfigured: Boolean(
          process.env.SENDGRID_API_KEY &&
            process.env.CRM_BUSINESS_ADDRESS &&
            process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY,
        ),
        campaignRecipientLimit: Math.max(
          1,
          Number(process.env.CRM_CAMPAIGN_RECIPIENT_LIMIT) || 50,
        ),
      });
    }

    if (path === "contacts" && req.method === "GET") {
      const actor = await requireCrmAccess(req, { storeId: requestedStoreId, capability: "view" });
      const status = url.searchParams.get("status");
      const conditions = [eq(crmContacts.storeId, actor.storeId)];
      if (status) conditions.push(eq(crmContacts.relationshipState, status));
      const contacts = await db
        .select()
        .from(crmContacts)
        .where(and(...conditions))
        .orderBy(desc(crmContacts.lastInteractionAt))
        .limit(Math.min(Number(url.searchParams.get("limit")) || 200, 500));
      return Response.json({ contacts });
    }

    const contactMatch = path.match(/^contacts\/(\d+)$/);
    if (contactMatch && req.method === "PATCH") {
      const actor = await requireCrmAccess(req, {
        storeId: requestedStoreId,
        capability: "review_contacts",
      });
      const contactId = Number(contactMatch[1]);
      const payload = await body(req);
      const [existing] = await db
        .select()
        .from(crmContacts)
        .where(and(eq(crmContacts.id, contactId), eq(crmContacts.storeId, actor.storeId)));
      if (!existing) return Response.json({ error: "Contact not found" }, { status: 404 });

      const allowedRelationship = new Set([
        "candidate",
        "substantiated_relationship",
        "rejected",
      ]);
      const allowedPermission = new Set([
        "unconfirmed_relationship",
        "explicit_opt_in",
        "transactional_only",
        "opted_out",
        "complained",
        "hard_bounced",
      ]);
      const updates: Partial<typeof crmContacts.$inferInsert> = { updatedAt: new Date() };
      if (payload.displayName !== undefined) updates.displayName = String(payload.displayName || "") || null;
      if (payload.company !== undefined) updates.company = String(payload.company || "") || null;
      if (payload.relationshipSummary !== undefined)
        updates.relationshipSummary = String(payload.relationshipSummary || "") || null;
      if (allowedRelationship.has(String(payload.relationshipState)))
        updates.relationshipState = String(payload.relationshipState);
      if (allowedPermission.has(String(payload.marketingPermission)))
        updates.marketingPermission = String(payload.marketingPermission);

      const [contact] = await db
        .update(crmContacts)
        .set(updates)
        .where(eq(crmContacts.id, contactId))
        .returning();
      if (
        updates.marketingPermission &&
        updates.marketingPermission !== existing.marketingPermission
      ) {
        await db.insert(crmConsentEvents).values({
          storeId: actor.storeId,
          contactId,
          state: updates.marketingPermission,
          source: "owner_update",
          evidence: String(payload.consentEvidence || "Owner updated CRM permission state."),
          actorUserId: actor.airtableUserId,
        });
      }
      await recordCrmAudit(actor, "contact.updated", "contact", contactId, {
        relationshipState: updates.relationshipState,
        marketingPermission: updates.marketingPermission,
      });
      return Response.json({ contact });
    }

    if (path === "review" && req.method === "GET") {
      const actor = await requireCrmAccess(req, {
        storeId: requestedStoreId,
        capability: "review_contacts",
      });
      const rows = await db
        .select({
          source: crmContactSources,
          contact: crmContacts,
          thread: crmEmailThreads,
        })
        .from(crmContactSources)
        .innerJoin(crmContacts, eq(crmContactSources.contactId, crmContacts.id))
        .leftJoin(crmEmailThreads, eq(crmContactSources.threadId, crmEmailThreads.id))
        .where(
          and(
            eq(crmContactSources.storeId, actor.storeId),
            eq(crmContactSources.reviewStatus, "pending"),
          ),
        )
        .orderBy(desc(crmEmailThreads.lastMessageAt))
        .limit(200);
      return Response.json({ review: rows });
    }

    if (path === "review" && req.method === "POST") {
      const actor = await requireCrmAccess(req, {
        storeId: requestedStoreId,
        capability: "review_contacts",
      });
      const payload = await body(req);
      const contactId = int(payload.contactId);
      const action = String(payload.action || "");
      if (!contactId || !["approve", "reject"].includes(action)) {
        return Response.json({ error: "contactId and a valid action are required" }, { status: 400 });
      }
      const [contact] = await db
        .select()
        .from(crmContacts)
        .where(and(eq(crmContacts.id, contactId), eq(crmContacts.storeId, actor.storeId)));
      if (!contact) return Response.json({ error: "Contact not found" }, { status: 404 });
      const relationshipState = action === "approve" ? "substantiated_relationship" : "rejected";
      await db
        .update(crmContacts)
        .set({ relationshipState, updatedAt: new Date() })
        .where(eq(crmContacts.id, contactId));
      await db
        .update(crmContactSources)
        .set({
          reviewStatus: action === "approve" ? "approved" : "rejected",
          reviewedByUserId: actor.airtableUserId,
          reviewedAt: new Date(),
        })
        .where(eq(crmContactSources.contactId, contactId));

      const planId = String(payload.planId || "").trim();
      if (action === "approve" && planId) {
        await db
          .insert(crmContactPlanLinks)
          .values({
            storeId: actor.storeId,
            contactId,
            planId,
            confidence: 100,
            status: "confirmed",
            confirmedByUserId: actor.airtableUserId,
            confirmedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [crmContactPlanLinks.contactId, crmContactPlanLinks.planId],
            set: {
              confidence: 100,
              status: "confirmed",
              confirmedByUserId: actor.airtableUserId,
              confirmedAt: new Date(),
            },
          });
        await db
          .update(crmInteractions)
          .set({ planId })
          .where(
            and(
              eq(crmInteractions.contactId, contactId),
              eq(crmInteractions.storeId, actor.storeId),
            ),
          );
      }
      await recordCrmAudit(actor, `contact.${action}`, "contact", contactId, {
        planLinked: Boolean(planId),
      });
      return Response.json({ success: true, relationshipState });
    }

    if (path === "interactions" && req.method === "GET") {
      const actor = await requireCrmAccess(req, { storeId: requestedStoreId, capability: "view" });
      const planId = url.searchParams.get("planId");
      const contactId = int(url.searchParams.get("contactId"));
      if (!planId && !contactId)
        return Response.json({ error: "planId or contactId is required" }, { status: 400 });
      const conditions = [eq(crmInteractions.storeId, actor.storeId)];
      if (planId) conditions.push(eq(crmInteractions.planId, planId));
      if (contactId) conditions.push(eq(crmInteractions.contactId, contactId));
      const interactions = await db
        .select()
        .from(crmInteractions)
        .where(and(...conditions))
        .orderBy(desc(crmInteractions.occurredAt))
        .limit(200);
      return Response.json({ interactions });
    }

    if (path === "mailboxes" && req.method === "GET") {
      const actor = await requireCrmAccess(req, { storeId: requestedStoreId, capability: "view" });
      const rows = await db
        .select({ connection: crmMailboxConnections, sync: crmMailboxSyncState })
        .from(crmMailboxConnections)
        .leftJoin(
          crmMailboxSyncState,
          eq(crmMailboxConnections.id, crmMailboxSyncState.connectionId),
        )
        .where(eq(crmMailboxConnections.storeId, actor.storeId));
      const mailboxes = rows.map(({ connection, sync }) => ({
        id: connection.id,
        provider: connection.provider,
        mailboxEmail: connection.mailboxEmail,
        status: connection.status,
        lastError: connection.lastError,
        lastErrorAt: connection.lastErrorAt,
        sync: sync
          ? {
              backfillComplete: sync.backfillComplete,
              lastSuccessfulSyncAt: sync.lastSuccessfulSyncAt,
              nextSyncAt: sync.nextSyncAt,
              failureCount: sync.failureCount,
              recoveryState: sync.recoveryState,
            }
          : null,
      }));
      return Response.json({ mailboxes });
    }

    const mailboxMatch = path.match(/^mailboxes\/(\d+)$/);
    if (mailboxMatch && req.method === "DELETE") {
      const actor = await requireCrmAccess(req, {
        storeId: requestedStoreId,
        capability: "connect_mailbox",
      });
      const mailboxId = Number(mailboxMatch[1]);
      const [mailbox] = await db
        .select()
        .from(crmMailboxConnections)
        .where(
          and(
            eq(crmMailboxConnections.id, mailboxId),
            eq(crmMailboxConnections.storeId, actor.storeId),
          ),
        );
      if (!mailbox) return Response.json({ error: "Mailbox not found" }, { status: 404 });
      try {
        const token = decryptSecret({
          encrypted: mailbox.encryptedRefreshToken,
          iv: mailbox.tokenIv,
          tag: mailbox.tokenTag,
        });
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
        });
      } catch {
        // Local revocation still prevents further platform access.
      }
      await db
        .update(crmMailboxConnections)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(eq(crmMailboxConnections.id, mailboxId));
      await recordCrmAudit(actor, "mailbox.revoked", "mailbox", mailboxId);
      return Response.json({ success: true });
    }

    if (path === "campaigns" && req.method === "GET") {
      const actor = await requireCrmAccess(req, { storeId: requestedStoreId, capability: "view" });
      const campaigns = await db
        .select()
        .from(crmCampaigns)
        .where(eq(crmCampaigns.storeId, actor.storeId))
        .orderBy(desc(crmCampaigns.createdAt))
        .limit(100);
      return Response.json({ campaigns });
    }

    if (path === "campaigns" && req.method === "POST") {
      const actor = await requireCrmAccess(req, {
        storeId: requestedStoreId,
        capability: "draft_campaign",
      });
      const payload = await body(req);
      const name = String(payload.name || "").trim();
      const subject = String(payload.subject || "").trim();
      const htmlBody = String(payload.htmlBody || "").trim();
      if (!name || !subject || !htmlBody) {
        return Response.json({ error: "name, subject, and htmlBody are required" }, { status: 400 });
      }
      const [campaign] = await db
        .insert(crmCampaigns)
        .values({
          storeId: actor.storeId,
          name,
          subject,
          htmlBody,
          textBody: String(payload.textBody || "") || null,
          fromEmail:
            process.env.CRM_MARKETING_FROM_EMAIL ||
            process.env.SENDGRID_FROM_EMAIL ||
            "info@tylersmysterytours.com",
          fromName: process.env.CRM_MARKETING_FROM_NAME || actor.storeName,
          replyToEmail: process.env.CRM_MARKETING_REPLY_TO || actor.email,
          createdByUserId: actor.airtableUserId,
        })
        .returning();
      await recordCrmAudit(actor, "campaign.created", "campaign", campaign.id);
      return Response.json({ campaign }, { status: 201 });
    }

    const campaignMatch = path.match(/^campaigns\/(\d+)$/);
    if (campaignMatch && req.method === "POST") {
      const actor = await requireCrmAccess(req, {
        storeId: requestedStoreId,
        capability: "send_campaign",
      });
      const campaignId = Number(campaignMatch[1]);
      const payload = await body(req);
      const [campaign] = await db
        .select()
        .from(crmCampaigns)
        .where(
          and(eq(crmCampaigns.id, campaignId), eq(crmCampaigns.storeId, actor.storeId)),
        );
      if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });
      if (payload.action === "test") {
        await sendCampaignTest(campaign, actor.email);
        await recordCrmAudit(actor, "campaign.test_sent", "campaign", campaignId);
        return Response.json({ success: true });
      }
      if (payload.action === "cancel") {
        if (!["approved", "sending"].includes(campaign.status)) {
          return Response.json({ error: "Only approved or sending campaigns can be canceled" }, { status: 409 });
        }
        await db
          .update(crmCampaignRecipients)
          .set({ status: "canceled", updatedAt: new Date() })
          .where(
            and(
              eq(crmCampaignRecipients.campaignId, campaignId),
              eq(crmCampaignRecipients.status, "pending"),
            ),
          );
        await db
          .update(crmCampaigns)
          .set({ status: "canceled", updatedAt: new Date() })
          .where(eq(crmCampaigns.id, campaignId));
        await recordCrmAudit(actor, "campaign.canceled", "campaign", campaignId);
        return Response.json({ success: true });
      }
      if (payload.action !== "approve") {
        return Response.json({ error: "Unsupported campaign action" }, { status: 400 });
      }
      if (campaign.status !== "draft") {
        return Response.json({ error: "Only draft campaigns can be approved" }, { status: 409 });
      }

      const requestedIds = Array.isArray(payload.contactIds)
        ? payload.contactIds.map(int).filter(Boolean) as number[]
        : [];
      const allContacts = await db
        .select()
        .from(crmContacts)
        .where(eq(crmContacts.storeId, actor.storeId));
      const suppressions = await db
        .select()
        .from(crmSuppressions)
        .where(eq(crmSuppressions.storeId, actor.storeId));
      const suppressed = new Set(suppressions.map((item) => item.normalizedEmail));
      const eligibleBeforeCap = allContacts.filter((contact) => {
        if (requestedIds.length && !requestedIds.includes(contact.id)) return false;
        return (
          contact.relationshipState === "substantiated_relationship" &&
          ["unconfirmed_relationship", "explicit_opt_in"].includes(contact.marketingPermission) &&
          !suppressed.has(contact.normalizedEmail)
        );
      });
      const recipientLimit = Math.max(
        1,
        Number(process.env.CRM_CAMPAIGN_RECIPIENT_LIMIT) || 50,
      );
      const eligible = eligibleBeforeCap.slice(0, recipientLimit);
      if (!eligible.length) {
        return Response.json({ error: "No eligible contacts were selected" }, { status: 400 });
      }
      await db.insert(crmCampaignRecipients).values(
        eligible.map((contact) => ({
          storeId: actor.storeId,
          campaignId,
          contactId: contact.id,
          normalizedEmail: contact.normalizedEmail,
          displayName: contact.displayName,
          idempotencyKey: `${campaignId}:${contact.normalizedEmail}`,
        })),
      );
      const [approved] = await db
        .update(crmCampaigns)
        .set({
          status: "approved",
          approvedByUserId: actor.airtableUserId,
          approvedAt: new Date(),
          scheduledAt: payload.scheduledAt ? new Date(String(payload.scheduledAt)) : new Date(),
          audienceCounts: {
            eligible: eligible.length,
            excluded: allContacts.length - eligible.length,
            capped: Math.max(0, eligibleBeforeCap.length - eligible.length),
            recipientLimit,
          },
          updatedAt: new Date(),
        })
        .where(eq(crmCampaigns.id, campaignId))
        .returning();
      await recordCrmAudit(actor, "campaign.approved", "campaign", campaignId, {
        recipients: eligible.length,
      });
      return Response.json({ campaign: approved, recipients: eligible.length });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return crmErrorResponse(error);
  }
};

export const config = {
  path: [
    "/api/crm/bootstrap",
    "/api/crm/legacy",
    "/api/crm/legacy/chat",
    "/api/crm/contacts",
    "/api/crm/contacts/:id",
    "/api/crm/review",
    "/api/crm/interactions",
    "/api/crm/mailboxes",
    "/api/crm/mailboxes/:id",
    "/api/crm/campaigns",
    "/api/crm/campaigns/:id",
  ],
};
