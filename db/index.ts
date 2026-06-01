// db/index.ts
// Drizzle client backed by the Netlify Database (managed Postgres).
// The connection is configured automatically by the Netlify platform —
// no connection string is required.
import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema.js";

export const db = drizzle({ schema });
