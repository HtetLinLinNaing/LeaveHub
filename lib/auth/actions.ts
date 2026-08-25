"use server";

import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { parseLoginFormData } from "@/lib/auth/login-input";
import {
  authenticatePassword,
  loginFailureState,
} from "@/lib/auth/password";
import { createAdminClient } from "@/lib/dal/admin-client";
import { createAuthClient } from "@/lib/supabase/server";

export type LoginState = { error?: string };

export async function login(
  _previous: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = parseLoginFormData(formData);
  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  let result: LoginState;
  try {
    const auth = await createAuthClient();
    result = await authenticatePassword(parsed.data, {
      signInWithPassword: async (credentials) => {
        const { data, error } = await auth.auth.signInWithPassword(credentials);
        return { user: data.user, error };
      },
      resolveActor: (authUserId, email) =>
        resolveActor(authUserId, email, createAdminClient()),
      signOut: async () => {
        const { error } = await auth.auth.signOut();
        if (error) throw error;
      },
    });
  } catch (error) {
    return loginFailureState(error);
  }

  if (result.error) return result;
  redirect("/");
}

export async function logout(): Promise<void> {
  try {
    const auth = await createAuthClient();
    const { error } = await auth.auth.signOut();
    if (error) console.error("Sign out failed", error);
  } catch (error) {
    console.error("Sign out failed", error);
  }

  redirect("/login");
}
