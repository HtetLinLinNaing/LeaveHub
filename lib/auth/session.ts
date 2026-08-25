import "server-only";

import {
  AuthInvalidJwtError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/dal/admin-client";
import { createAuthClient } from "@/lib/supabase/server";

export type { Actor };

const verifyActorUncached = async (): Promise<Actor | null> => {
  const auth = await createAuthClient();
  const { data, error } = await auth.auth.getClaims();

  if (error) {
    if (
      isAuthSessionMissingError(error) ||
      error instanceof AuthInvalidJwtError
    ) {
      return null;
    }
    throw error;
  }
  if (!data?.claims?.sub) return null;

  const email =
    typeof data.claims.email === "string" ? data.claims.email : "";
  return resolveActor(data.claims.sub, email, createAdminClient());
};

export const verifyActor = cache(verifyActorUncached);

export async function requireActor(): Promise<Actor> {
  const actor = await verifyActor();
  if (!actor) redirect("/login");
  return actor;
}
