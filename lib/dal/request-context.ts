import "server-only";

import { cache } from "react";
import { requireActor } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/dal/admin-client";

export const requireRequestContext = cache(async () => ({
  actor: await requireActor(),
  db: createAdminClient(),
}));
