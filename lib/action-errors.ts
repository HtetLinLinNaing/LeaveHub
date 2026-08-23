export class ExpectedActionError extends Error {}

export function actionFailure(error: unknown, fallback: string) {
  if (error instanceof ExpectedActionError) {
    return { ok: false as const, error: error.message };
  }

  console.error(fallback, error);
  return { ok: false as const, error: fallback };
}
