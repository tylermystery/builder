import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "../../../db/index.js";
import {
  crmContactPlanLinks,
  crmContactSources,
  crmContacts,
  crmEmailMessages,
  crmEmailThreads,
  crmInteractions,
  crmMailboxConnections,
  crmMailboxSyncState,
  crmSyncJobs,
} from "../../../db/schema.js";
import { enrichCrmInteraction } from "./crm-ai.js";
import { findPlansForClient } from "./crm-airtable.js";
import { hashValue } from "./crm-crypto.js";
import {
  accessTokenForConnection,
  gmailProfile,
  gmailRequest,
} from "./crm-google.js";

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart & { headers?: GmailHeader[] };
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function header(headers: GmailHeader[], name: string) {
  return headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function addresses(value: string) {
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return Array.from(new Set(matches.map(normalizeEmail)));
}

function decodeBase64Url(value: string) {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function bodyFromPart(part?: GmailPart): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  const plain = part.parts?.find((child) => child.mimeType === "text/plain");
  if (plain) return bodyFromPart(plain);
  const nested = part.parts?.map(bodyFromPart).find(Boolean);
  if (nested) return nested;
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64Url(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }
  return part.body?.data ? decodeBase64Url(part.body.data) : "";
}

function cleanExcerpt(value: string) {
  return value
    .replace(/\r/g, "")
    .split(/\nOn .+ wrote:\n|\nFrom:.+\nSent:.+\nTo:.+\nSubject:/i)[0]
    .split(/\n--\s*\n/)[0]
    .replace(/^>.*$/gm, "")
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
}

function isAutomated(headers: GmailHeader[], fromEmail: string) {
  const autoSubmitted = header(headers, "Auto-Submitted").toLowerCase();
  const precedence = header(headers, "Precedence").toLowerCase();
  return (
    !fromEmail ||
    fromEmail.includes("no-reply") ||
    fromEmail.includes("noreply") ||
    autoSubmitted === "auto-generated" ||
    autoSubmitted === "auto-replied" ||
    precedence === "bulk" ||
    precedence === "list" ||
    Boolean(header(headers, "List-Id"))
  );
}

function interactionSummary(direction: string, subject: string, excerpt: string) {
  const label = direction === "incoming" ? "Email received" : "Email sent";
  const detail = excerpt ? ` — ${excerpt.slice(0, 320)}` : "";
  return `${label}: ${subject || "(no subject)"}${detail}`;
}

async function findOrCreateThread(
  connection: typeof crmMailboxConnections.$inferSelect,
  message: GmailMessage,
  subject: string,
  participants: string[],
  sentAt: Date,
) {
  const [thread] = await db
    .insert(crmEmailThreads)
    .values({
      storeId: connection.storeId,
      connectionId: connection.id,
      providerThreadId: message.threadId,
      subject,
      participants,
      firstMessageAt: sentAt,
      lastMessageAt: sentAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [crmEmailThreads.connectionId, crmEmailThreads.providerThreadId],
      set: {
        subject,
        participants,
        lastMessageAt: sentAt,
        updatedAt: new Date(),
      },
    })
    .returning();
  return thread;
}

async function qualifyThread(
  connection: typeof crmMailboxConnections.$inferSelect,
  thread: typeof crmEmailThreads.$inferSelect,
  latestMessage: typeof crmEmailMessages.$inferSelect,
) {
  const messages = await db
    .select()
    .from(crmEmailMessages)
    .where(eq(crmEmailMessages.threadId, thread.id))
    .orderBy(asc(crmEmailMessages.sentAt));
  if (!messages.some((message) => message.direction === "incoming")) return;
  if (!messages.some((message) => message.direction === "outgoing")) return;

  const mailboxEmail = normalizeEmail(connection.mailboxEmail);
  const externalEmails = new Set<string>();
  for (const message of messages) {
    if (message.direction === "incoming" && message.senderEmail) {
      externalEmails.add(normalizeEmail(message.senderEmail));
    }
    if (message.direction === "outgoing" && Array.isArray(message.recipientEmails)) {
      for (const email of message.recipientEmails as string[]) externalEmails.add(normalizeEmail(email));
    }
  }
  externalEmails.delete(mailboxEmail);

  for (const email of externalEmails) {
    if (!email || email.includes("no-reply") || email.includes("noreply")) continue;
    const enrichment = await enrichCrmInteraction({
      email,
      subject: latestMessage.subject || thread.subject || "",
      excerpt: latestMessage.redactedExcerpt || "",
      direction: latestMessage.direction,
    });
    const [contact] = await db
      .insert(crmContacts)
      .values({
        storeId: connection.storeId,
        normalizedEmail: email,
        displayName: enrichment?.displayName || null,
        company: enrichment?.company || null,
        relationshipSummary:
          enrichment?.relationshipSummary || "Two-way email communication detected.",
        relationshipState: "candidate",
        marketingPermission: "unconfirmed_relationship",
        lastInteractionAt: latestMessage.sentAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [crmContacts.storeId, crmContacts.normalizedEmail],
        set: {
          displayName: enrichment?.displayName || undefined,
          company: enrichment?.company || undefined,
          relationshipSummary:
            enrichment?.relationshipSummary || "Two-way email communication detected.",
          lastInteractionAt: latestMessage.sentAt,
          updatedAt: new Date(),
        },
      })
      .returning();

    const [existingSource] = await db
      .select()
      .from(crmContactSources)
      .where(
        and(
          eq(crmContactSources.contactId, contact.id),
          eq(crmContactSources.threadId, thread.id),
        ),
      );
    if (!existingSource) {
      await db.insert(crmContactSources).values({
        storeId: connection.storeId,
        contactId: contact.id,
        threadId: thread.id,
        qualificationReason: "At least one non-automated email in each direction.",
        confidence: 100,
        extractedFields: enrichment || null,
      });
    }

    const plans = await findPlansForClient(connection.storeId, email);
    let planId: string | null = null;
    if (plans.length === 1) {
      planId = plans[0].id;
      await db
        .insert(crmContactPlanLinks)
        .values({
          storeId: connection.storeId,
          contactId: contact.id,
          planId,
          threadId: thread.id,
          confidence: 100,
          status: "auto_confirmed",
          confirmedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [crmContactPlanLinks.contactId, crmContactPlanLinks.planId],
          set: { threadId: thread.id, confidence: 100, status: "auto_confirmed" },
        });
    }

    const summary =
      enrichment?.relationshipSummary ||
      interactionSummary(
        latestMessage.direction,
        latestMessage.subject || "",
        latestMessage.redactedExcerpt || "",
      );
    await db
      .insert(crmInteractions)
      .values({
        storeId: connection.storeId,
        contactId: contact.id,
        planId,
        interactionType:
          latestMessage.direction === "incoming" ? "email_received" : "email_sent",
        sourceId: latestMessage.providerMessageId,
        summary,
        actionItems: enrichment?.actionItems || [],
        visibility: "store_private",
        occurredAt: latestMessage.sentAt || new Date(),
      })
      .onConflictDoNothing({
        target: [
          crmInteractions.storeId,
          crmInteractions.interactionType,
          crmInteractions.sourceId,
        ],
      });
  }

  await db
    .update(crmEmailThreads)
    .set({ relationshipState: "substantiated_relationship", extractionStatus: "complete" })
    .where(eq(crmEmailThreads.id, thread.id));
}

async function processMessage(
  connection: typeof crmMailboxConnections.$inferSelect,
  accessToken: string,
  messageId: string,
) {
  const message = await gmailRequest<GmailMessage>(accessToken, `/messages/${messageId}`, new URLSearchParams({
    format: "full",
  }));
  const headers = message.payload?.headers || [];
  const from = addresses(header(headers, "From"));
  const to = addresses(header(headers, "To"));
  const cc = addresses(header(headers, "Cc"));
  const senderEmail = from[0] || "";
  if (isAutomated(headers, senderEmail)) return { skipped: true };

  const mailboxEmail = normalizeEmail(connection.mailboxEmail);
  const direction = senderEmail === mailboxEmail ? "outgoing" : "incoming";
  const subject = header(headers, "Subject").trim();
  const excerpt = cleanExcerpt(bodyFromPart(message.payload));
  const sentAt = new Date(
    Number(message.internalDate || 0) || Date.parse(header(headers, "Date")) || Date.now(),
  );
  const participants = Array.from(new Set([...from, ...to, ...cc]));
  const thread = await findOrCreateThread(connection, message, subject, participants, sentAt);
  const [inserted] = await db
    .insert(crmEmailMessages)
    .values({
      storeId: connection.storeId,
      threadId: thread.id,
      providerMessageId: message.id,
      direction,
      senderEmail,
      recipientEmails: to,
      ccEmails: cc,
      sentAt,
      subject,
      redactedExcerpt: excerpt || null,
      excerptExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      payloadHash: hashValue(`${subject}\n${excerpt}`),
      processingStatus: "complete",
    })
    .onConflictDoNothing({
      target: [crmEmailMessages.storeId, crmEmailMessages.providerMessageId],
    })
    .returning();
  if (!inserted) return { duplicate: true };
  await qualifyThread(connection, thread, inserted);
  return { inserted: true };
}

async function runBackfillPage(
  connection: typeof crmMailboxConnections.$inferSelect,
  state: typeof crmMailboxSyncState.$inferSelect,
  accessToken: string,
) {
  const after = state.backfillAfter || new Date(Date.now() - 24 * 30 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    maxResults: "50",
    q: `after:${Math.floor(after.getTime() / 1000)} {in:inbox in:sent}`,
  });
  if (state.backfillPageToken) params.set("pageToken", state.backfillPageToken);
  const page = await gmailRequest<{
    messages?: Array<{ id: string }>;
    nextPageToken?: string;
  }>(accessToken, "/messages", params);
  for (const message of page.messages || []) await processMessage(connection, accessToken, message.id);

  if (page.nextPageToken) {
    await db
      .update(crmMailboxSyncState)
      .set({ backfillPageToken: page.nextPageToken, updatedAt: new Date() })
      .where(eq(crmMailboxSyncState.id, state.id));
    return false;
  }

  const profile = await gmailProfile(accessToken);
  await db
    .update(crmMailboxSyncState)
    .set({
      backfillComplete: true,
      backfillPageToken: null,
      historyId: profile.historyId,
      lastSuccessfulSyncAt: new Date(),
      nextSyncAt: new Date(Date.now() + 10 * 60 * 1000),
      failureCount: 0,
      recoveryState: null,
      updatedAt: new Date(),
    })
    .where(eq(crmMailboxSyncState.id, state.id));
  return true;
}

async function runIncremental(
  connection: typeof crmMailboxConnections.$inferSelect,
  state: typeof crmMailboxSyncState.$inferSelect,
  accessToken: string,
) {
  if (!state.historyId) {
    const profile = await gmailProfile(accessToken);
    await db
      .update(crmMailboxSyncState)
      .set({ historyId: profile.historyId, updatedAt: new Date() })
      .where(eq(crmMailboxSyncState.id, state.id));
    return;
  }
  try {
    let pageToken: string | undefined;
    let latestHistoryId = state.historyId;
    do {
      const params = new URLSearchParams({
        startHistoryId: state.historyId,
        historyTypes: "messageAdded",
        maxResults: "100",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await gmailRequest<{
        history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>;
        historyId?: string;
        nextPageToken?: string;
      }>(accessToken, "/history", params);
      const ids = Array.from(
        new Set(
          (page.history || []).flatMap((item) =>
            (item.messagesAdded || []).map((added) => added.message.id),
          ),
        ),
      );
      for (const id of ids) await processMessage(connection, accessToken, id);
      if (page.historyId) latestHistoryId = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken);

    await db
      .update(crmMailboxSyncState)
      .set({
        historyId: latestHistoryId,
        lastSuccessfulSyncAt: new Date(),
        nextSyncAt: new Date(Date.now() + 10 * 60 * 1000),
        failureCount: 0,
        recoveryState: null,
        updatedAt: new Date(),
      })
      .where(eq(crmMailboxSyncState.id, state.id));
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
    await db
      .update(crmMailboxSyncState)
      .set({
        backfillAfter: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        backfillPageToken: null,
        backfillComplete: false,
        recoveryState: "history_cursor_expired",
        updatedAt: new Date(),
      })
      .where(eq(crmMailboxSyncState.id, state.id));
  }
}

export async function syncConnection(connectionId: number, maxPages = 1) {
  const [connection] = await db
    .select()
    .from(crmMailboxConnections)
    .where(eq(crmMailboxConnections.id, connectionId));
  if (!connection || connection.status !== "active") return { skipped: true };

  const [state] = await db
    .select()
    .from(crmMailboxSyncState)
    .where(eq(crmMailboxSyncState.connectionId, connection.id));
  if (!state) throw new Error("Mailbox sync state is missing");

  const jobKey = `${connection.id}:${state.backfillComplete ? "incremental" : "backfill"}:${Date.now()}`;
  const [job] = await db
    .insert(crmSyncJobs)
    .values({
      storeId: connection.storeId,
      connectionId: connection.id,
      jobType: state.backfillComplete ? "incremental" : "backfill",
      idempotencyKey: jobKey,
      status: "running",
      attempts: 1,
      startedAt: new Date(),
    })
    .returning();

  try {
    const accessToken = await accessTokenForConnection(connection);
    if (state.backfillComplete) {
      await runIncremental(connection, state, accessToken);
    } else {
      for (let page = 0; page < maxPages; page += 1) {
        const [current] = await db
          .select()
          .from(crmMailboxSyncState)
          .where(eq(crmMailboxSyncState.id, state.id));
        if (current.backfillComplete) break;
        const complete = await runBackfillPage(connection, current, accessToken);
        if (complete) break;
      }
    }
    await db
      .update(crmSyncJobs)
      .set({ status: "complete", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(crmSyncJobs.id, job.id));
    await db
      .update(crmMailboxConnections)
      .set({ lastError: null, lastErrorAt: null, updatedAt: new Date() })
      .where(eq(crmMailboxConnections.id, connection.id));
    return { success: true };
  } catch (error) {
    const message = (error as Error).message.slice(0, 500);
    await db
      .update(crmSyncJobs)
      .set({
        status: "failed",
        errorCategory: "sync_error",
        errorMessage: message,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(crmSyncJobs.id, job.id));
    await db
      .update(crmMailboxConnections)
      .set({ lastError: message, lastErrorAt: new Date(), updatedAt: new Date() })
      .where(eq(crmMailboxConnections.id, connection.id));
    await db
      .update(crmMailboxSyncState)
      .set({
        failureCount: state.failureCount + 1,
        nextSyncAt: new Date(Date.now() + Math.min(60, 2 ** state.failureCount) * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(crmMailboxSyncState.id, state.id));
    throw error;
  }
}

export async function dueConnections(limit = 3) {
  const states = await db
    .select({ connectionId: crmMailboxSyncState.connectionId })
    .from(crmMailboxSyncState)
    .where(
      and(
        lte(crmMailboxSyncState.nextSyncAt, new Date()),
        or(isNull(crmMailboxSyncState.recoveryState), eq(crmMailboxSyncState.recoveryState, "history_cursor_expired")),
      ),
    )
    .limit(limit);
  return states.map((state) => state.connectionId);
}

export async function purgeExpiredExcerpts() {
  await db
    .update(crmEmailMessages)
    .set({ redactedExcerpt: null })
    .where(lte(crmEmailMessages.excerptExpiresAt, new Date()));
}
