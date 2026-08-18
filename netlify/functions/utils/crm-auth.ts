import { getUser } from "@netlify/identity";
import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db/index.js";
import {
  crmStoreAccess,
  crmStoreEnrollments,
} from "../../../db/schema.js";
import {
  findAirtableUserByEmail,
  getAirtableStore,
  getAirtableUser,
} from "./crm-airtable.js";

export type CrmCapability =
  | "view"
  | "connect_mailbox"
  | "review_contacts"
  | "manage_consent"
  | "draft_campaign"
  | "send_campaign";

export type CrmActor = {
  userId: string | null;
  airtableUserId: string;
  email: string;
  name: string | null;
  storeId: string;
  storeName: string;
  role: "owner" | "publisher";
};

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

async function requestIdentity(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ") && process.env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET) as {
        userId?: string;
        email?: string;
        name?: string;
      };
      if (decoded.userId || decoded.email) {
        return {
          userId: decoded.userId || null,
          email: normalizeEmail(decoded.email),
          name: decoded.name || null,
        };
      }
    } catch {
      return null;
    }
  }

  const identityUser = await getUser();
  if (!identityUser?.email) return null;
  return {
    userId: identityUser.id || null,
    email: normalizeEmail(identityUser.email),
    name: identityUser.userMetadata?.fullName || identityUser.userMetadata?.name || null,
  };
}

const ownerCapabilities = new Set<CrmCapability>([
  "view",
  "connect_mailbox",
  "review_contacts",
  "manage_consent",
  "draft_campaign",
  "send_campaign",
]);

const publisherCapabilities = new Set<CrmCapability>([
  "view",
  "review_contacts",
  "manage_consent",
  "draft_campaign",
  "send_campaign",
]);

export async function requireCrmAccess(
  req: Request,
  options: { storeId?: string | null; capability?: CrmCapability } = {},
): Promise<CrmActor> {
  const identity = await requestIdentity(req);
  if (!identity) throw Object.assign(new Error("Unauthorized"), { status: 401 });

  let airtableUser = identity.userId ? await getAirtableUser(identity.userId) : null;
  if (!airtableUser && identity.email) {
    airtableUser = await findAirtableUserByEmail(identity.email);
  }
  if (!airtableUser) throw Object.assign(new Error("User profile not found"), { status: 403 });

  const userEmail = normalizeEmail(airtableUser.fields?.Email || identity.email);
  const linkedStores = Array.isArray(airtableUser.fields?.Stores)
    ? (airtableUser.fields.Stores as string[])
    : [];
  const pilotOwnerEmail = normalizeEmail(
    process.env.CRM_PILOT_OWNER_EMAIL || "tyler@tylersmysterytours.com",
  );
  const configuredPilotStore = process.env.CRM_PILOT_STORE_ID || null;
  const requestedStore = options.storeId || configuredPilotStore || linkedStores[0] || null;
  if (!requestedStore || !linkedStores.includes(requestedStore)) {
    throw Object.assign(new Error("Store access not found"), { status: 403 });
  }

  const store = await getAirtableStore(requestedStore);
  const publishers = Array.isArray(store.fields?.PublishPermission)
    ? (store.fields.PublishPermission as string[])
    : [];
  const isPilotOwner = userEmail === pilotOwnerEmail;
  const isPublisher = publishers.includes(airtableUser.id);

  const [existingEnrollment] = await db
    .select()
    .from(crmStoreEnrollments)
    .where(eq(crmStoreEnrollments.storeId, requestedStore));

  if (!existingEnrollment && !isPilotOwner) {
    throw Object.assign(new Error("CRM is not enabled for this store"), { status: 403 });
  }

  const allowPublishers =
    existingEnrollment?.status === "active" || process.env.CRM_ALLOW_PUBLISHERS === "true";
  const role: "owner" | "publisher" = isPilotOwner ? "owner" : "publisher";
  if (!isPilotOwner && !(isPublisher && allowPublishers)) {
    throw Object.assign(new Error("CRM permission required"), { status: 403 });
  }

  const capabilities = role === "owner" ? ownerCapabilities : publisherCapabilities;
  if (options.capability && !capabilities.has(options.capability)) {
    throw Object.assign(new Error("CRM capability required"), { status: 403 });
  }

  if (isPilotOwner && !existingEnrollment) {
    await db.insert(crmStoreEnrollments).values({ storeId: requestedStore }).onConflictDoNothing();
  }

  await db
    .insert(crmStoreAccess)
    .values({
      storeId: requestedStore,
      userId: airtableUser.id,
      userEmail,
      role,
      capabilities: Array.from(capabilities),
      permissionSource: role === "owner" ? "pilot_owner" : "publish_permission",
      status: "active",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [crmStoreAccess.storeId, crmStoreAccess.userEmail],
      set: {
        userId: airtableUser.id,
        role,
        capabilities: Array.from(capabilities),
        permissionSource: role === "owner" ? "pilot_owner" : "publish_permission",
        status: "active",
        updatedAt: new Date(),
      },
    });

  return {
    userId: identity.userId,
    airtableUserId: airtableUser.id,
    email: userEmail,
    name: String(airtableUser.fields?.Name || identity.name || "") || null,
    storeId: requestedStore,
    storeName: String(store.fields?.Name || "Store"),
    role,
  };
}

export function crmErrorResponse(error: unknown) {
  const status =
    typeof error === "object" && error && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500;
  const message = status >= 500 ? "Internal server error" : (error as Error).message;
  if (status >= 500) console.error("[crm]", error);
  return Response.json({ error: message }, { status });
}

export async function recordCrmAudit(
  actor: CrmActor,
  action: string,
  targetType?: string,
  targetId?: string | number | null,
  metadata?: Record<string, unknown>,
) {
  const { crmAuditLog } = await import("../../../db/schema.js");
  await db.insert(crmAuditLog).values({
    storeId: actor.storeId,
    actorUserId: actor.airtableUserId,
    actorEmail: actor.email,
    action,
    targetType: targetType || null,
    targetId: targetId == null ? null : String(targetId),
    metadata: metadata || null,
  });
}

export async function hasStoredAccess(storeId: string, email: string) {
  const [row] = await db
    .select()
    .from(crmStoreAccess)
    .where(
      and(
        eq(crmStoreAccess.storeId, storeId),
        eq(crmStoreAccess.userEmail, normalizeEmail(email)),
      ),
    );
  return row?.status === "active";
}
