import {
  AuthInvalidCredentialsError,
  isAuthApiError,
} from "@supabase/supabase-js";
import type { LoginInput } from "@/lib/validations";

export type PasswordAuthenticationResult = { error?: string };

type AuthenticatedUser = {
  id: string;
  email?: string | null;
};

export interface PasswordAuthenticationDependencies {
  signInWithPassword: (credentials: LoginInput) => Promise<{
    user: AuthenticatedUser | null;
    error: unknown | null;
  }>;
  resolveActor: (
    authUserId: string,
    email: string
  ) => Promise<unknown | null>;
  signOut: () => Promise<void>;
}

type LoginErrorLogger = (message: string, error: unknown) => void;

const REJECTED_CREDENTIAL_CODES = new Set([
  "invalid_credentials",
  "email_not_confirmed",
  "user_banned",
]);

function isRejectedCredential(error: unknown) {
  if (error instanceof AuthInvalidCredentialsError) return true;

  return (
    isAuthApiError(error) &&
    error.code !== undefined &&
    REJECTED_CREDENTIAL_CODES.has(error.code)
  );
}

export async function authenticatePassword(
  input: LoginInput,
  dependencies: PasswordAuthenticationDependencies
): Promise<PasswordAuthenticationResult> {
  const { user, error } = await dependencies.signInWithPassword(input);

  if (error) {
    if (!isRejectedCredential(error)) throw error;

    await dependencies.signOut();
    return { error: "Invalid email or password." };
  }

  if (!user) {
    throw new Error("Password sign-in succeeded without an Auth user");
  }

  let actor: unknown | null;
  try {
    actor = await dependencies.resolveActor(user.id, user.email ?? input.email);
  } catch (actorError) {
    await dependencies.signOut();
    throw actorError;
  }

  if (!actor) {
    await dependencies.signOut();
    return { error: "Your account is not enabled for LeaveHub." };
  }

  return {};
}

export function loginFailureState(
  error: unknown,
  logger: LoginErrorLogger = console.error
): PasswordAuthenticationResult {
  logger("Password sign-in failed", error);
  return { error: "Sign in is temporarily unavailable." };
}
