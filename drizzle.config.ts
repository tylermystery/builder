// drizzle.config.ts
// `out` must point at netlify/database/migrations so Netlify applies migrations
// automatically during deploys.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "netlify/database/migrations",
});
