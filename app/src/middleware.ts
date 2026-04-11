import { defineMiddleware } from "astro:middleware";
import { runMigrations } from "@/lib/db/migrate";

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.pathname.startsWith("/api/extensions")) {
    await runMigrations();
  }
  return next();
});
