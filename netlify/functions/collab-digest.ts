// netlify/functions/collab-digest.ts
//
// Collab updates by email, following each person's existing notification setting:
//   Digest    — a daily summary per store they collab in: newly recommended ideas,
//               what's scheduled, what was delivered, and the top ideas with their
//               feedback totals.
//   Real-Time — the same summary, but only on days something new happened (new
//               recommended, scheduled or delivered ideas). Authors also get an
//               instant email when their own idea changes stage (public-catalog.ts).
//   None      — nothing.
// Each idea carries one-tap reaction links (signed, no sign-in needed) that record a
// community reaction under the recipient's account.

import jwt from "jsonwebtoken";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { publicItems, reactions, comments, storeMembers } from "../../db/schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const QUICK_EMOJIS = ["🔥", "❤️", "🤔"];

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

async function airtable(path: string) {
  const res = await fetch(`https://api.airtable.com/v0/${process.env.BASE_ID}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` },
  });
  return res.ok ? res.json() : null;
}

async function usersById(ids: string[]) {
  const out = new Map<string, { email?: string; name?: string; frequency?: string }>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const formula = encodeURIComponent(`OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`);
    const data = await airtable(`Users?filterByFormula=${formula}&fields[]=Email&fields[]=Name&fields[]=NotificationFrequency`);
    for (const r of data?.records || []) {
      out.set(r.id, { email: r.fields.Email, name: r.fields.Name, frequency: r.fields.NotificationFrequency });
    }
  }
  return out;
}

export default async () => {
  const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, JWT_SECRET } = process.env;
  if (!AIRTABLE_PAT || !BASE_ID || !SENDGRID_API_KEY || !JWT_SECRET) {
    console.warn("[collab-digest] Missing configuration; skipping.");
    return;
  }
  const base = process.env.URL || "https://whatthefun.wtf";
  const since = new Date(Date.now() - DAY_MS);
  const sg = (await import("@sendgrid/mail")).default;
  sg.setApiKey(SENDGRID_API_KEY);

  const memberships = await db.select().from(storeMembers);
  const storeIds = [...new Set(memberships.map((m) => m.storeId))];
  if (storeIds.length === 0) return;

  const ideas = await db
    .select()
    .from(publicItems)
    .where(and(inArray(publicItems.storeId, storeIds), eq(publicItems.hidden, false), inArray(publicItems.catalogStatus, ["recommended", "published"])));
  const ideaIds = ideas.filter((i) => !i.catalogItemId).map((i) => i.id);
  const [reacts, cmts] = ideaIds.length
    ? await Promise.all([
        db.select().from(reactions).where(inArray(reactions.publicItemId, ideaIds)),
        db.select().from(comments).where(and(inArray(comments.publicItemId, ideaIds), eq(comments.hidden, false))),
      ])
    : [[], []];

  const users = await usersById([...new Set(memberships.map((m) => m.userId))]);
  let sent = 0;

  for (const storeId of storeIds) {
    const storeIdeas = ideas.filter((i) => i.storeId === storeId && !i.catalogItemId);
    if (storeIdeas.length === 0) continue;
    const feedback = (id: number) => ({
      reactions: reacts.filter((r) => r.publicItemId === id && r.commentId == null).length,
      comments: cmts.filter((c) => c.publicItemId === id).length,
    });
    const ranked = storeIdeas
      .filter((i) => !i.deliveredAt)
      .map((i) => ({ i, f: feedback(i.id) }))
      .sort((a, b) => b.f.reactions + b.f.comments * 2 - (a.f.reactions + a.f.comments * 2));
    const recent = (d: Date | null | undefined) => !!d && new Date(d) > since;
    const newlyRecommended = storeIdeas.filter((i) => i.catalogStatus === "recommended" && recent(i.reviewedAt));
    const newlyScheduled = storeIdeas.filter((i) => i.scheduledFor && !i.deliveredAt && recent(i.reviewedAt));
    const newlyDelivered = storeIdeas.filter((i) => recent(i.deliveredAt));
    const somethingNew = newlyRecommended.length + newlyScheduled.length + newlyDelivered.length > 0;
    const store = await airtable(`Stores/${encodeURIComponent(storeId)}?fields[]=Name`);
    const storeName = store?.fields?.Name || "your community";

    for (const m of memberships.filter((x) => x.storeId === storeId)) {
      const u = users.get(m.userId);
      if (!u?.email || !u.frequency || u.frequency === "None") continue;
      if (u.frequency === "Real-Time" && !somethingNew) continue;
      // Digest: whenever something new happened, plus a weekly "top ideas" check-in on Mondays.
      if (u.frequency === "Digest" && !somethingNew && new Date().getUTCDay() !== 1) continue;
      if (u.frequency !== "Digest" && u.frequency !== "Real-Time") continue;

      const ideaBlock = (i: (typeof storeIdeas)[number], note = "") => {
        const f = feedback(i.id);
        const open = `${base}/?shopId=${encodeURIComponent(storeId)}&openItem=public-${i.id}`;
        const taps = QUICK_EMOJIS.map((emoji) => {
          const t = jwt.sign({ u: m.userId, p: i.id, e: emoji }, JWT_SECRET, { expiresIn: "14d" });
          return `<a href="${base}/api/collab/quick-react?t=${encodeURIComponent(t)}" style="display:inline-block;margin-right:6px;padding:6px 10px;border:1px solid #ddd;border-radius:16px;text-decoration:none;font-size:16px">${emoji}</a>`;
        }).join("");
        return `<div style="padding:12px 14px;margin:8px 0;background:#fff;border:1px solid #eee;border-radius:10px">
          <a href="${open}" style="color:#333;font-weight:600;text-decoration:none">${esc(i.name)}</a>
          <div style="color:#888;font-size:12px;margin:2px 0 8px">${note}${f.reactions} reaction${f.reactions === 1 ? "" : "s"} · ${f.comments} comment${f.comments === 1 ? "" : "s"}</div>
          ${taps}<a href="${open}" style="font-size:13px;color:#667eea">Comment →</a></div>`;
      };
      const section = (title: string, list: typeof storeIdeas, note: (i: (typeof storeIdeas)[number]) => string = () => "") =>
        list.length ? `<h3 style="font-size:15px;margin:18px 0 4px">${title}</h3>${list.slice(0, 5).map((i) => ideaBlock(i, note(i))).join("")}` : "";
      const date = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " : "");

      const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f6f6f9">
        <h2 style="margin:0 0 4px">Collab update from ${esc(storeName)}</h2>
        <p style="color:#666;margin:0 0 8px">The community's ideas, and how they're responding. Tap a reaction to weigh in — the top ideas get delivered.</p>
        ${section("✨ Newly recommended", newlyRecommended)}
        ${section("📅 Scheduled", newlyScheduled, (i) => date(i.scheduledFor))}
        ${section("🎉 Delivered — how did it go?", newlyDelivered)}
        ${section("🏆 Top ideas right now", ranked.map((x) => x.i))}
        <p style="color:#999;font-size:12px;margin-top:20px">You get this because your notification preference is ${esc(u.frequency)}. Change it in your account settings.</p></div>`;
      try {
        await sg.send({
          to: u.email,
          from: { name: `${storeName} on WhatTheFun`, email: "info@tylersmysterytours.com" },
          subject: somethingNew ? `New collab ideas at ${storeName}` : `Top collab ideas at ${storeName}`,
          html,
        });
        sent++;
      } catch (e) {
        console.error("[collab-digest] send failed:", (e as Error).message);
      }
    }
  }
  console.log(`[collab-digest] Sent ${sent} collab update email(s).`);
};

export const config = { schedule: "0 16 * * *" };
