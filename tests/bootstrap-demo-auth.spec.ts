import { expect, test } from "@playwright/test";
import {
  bootstrapDemoAuth,
  readBootstrapConfig,
} from "../scripts/bootstrap-demo-auth.mjs";
import {
  indexAuthUsers,
  normalizeEmail,
  planDemoAuthChanges,
  summarizeDemoAuthPlan,
} from "../scripts/bootstrap-demo-auth-core.mjs";

type PublicUserRow = {
  id: string;
  email: string;
  auth_user_id: string | null;
};

type AuthUserRow = {
  id: string;
  email: string | null;
  aud: string;
  role: string;
  created_at: string;
  app_metadata: Record<string, never>;
  user_metadata: Record<string, never>;
  identities: [];
};

type UsersQueryResult = {
  data: Array<PublicUserRow | { id: string }>;
  error: Error | null;
};

function authUser(id: string, email: string | null): AuthUserRow {
  return {
    id,
    email,
    aud: "authenticated",
    role: "authenticated",
    created_at: "2026-08-24T00:00:00.000Z",
    app_metadata: {},
    user_metadata: {},
    identities: [],
  };
}

function createBootstrapSupabaseFake({
  publicUsers,
  authUsers,
  publicPageCap = 1000,
  confirmationCounts = [],
  authListError = null,
  createError = null,
  linkFailures = 0,
  changeEmailAfterAuthList = null,
  reassignAfterAuthList = null,
  reassignAfterPasswordUpdate = null,
}: {
  publicUsers: PublicUserRow[];
  authUsers: AuthUserRow[];
  publicPageCap?: number;
  confirmationCounts?: number[];
  authListError?: Error | null;
  createError?: Error | null;
  linkFailures?: number;
  changeEmailAfterAuthList?: {
    publicUserId: string;
    email: string;
  } | null;
  reassignAfterAuthList?: {
    publicUserId: string;
    authUserId: string;
  } | null;
  reassignAfterPasswordUpdate?: {
    publicUserId: string;
    authUserId: string;
  } | null;
}) {
  const state = {
    publicUsers: publicUsers.map((row) => ({ ...row })),
    authUsers: authUsers.map((row) => ({ ...row })),
    passwordUpdates: [] as string[],
    createdEmails: [] as string[],
    logs: [] as string[],
    publicPageCursors: [] as Array<string | null>,
    authPagesRequested: [] as number[],
    confirmations: [] as Array<{
      publicUserId: string | undefined;
      authUserId: string | undefined;
    }>,
    confirmationCounts: [...confirmationCounts],
    remainingLinkFailures: linkFailures,
    changedEmailAfterAuthList: false,
    reassignedAfterAuthList: false,
  };

  class UsersQuery {
    private selectedColumns = "";
    private updateValues: { auth_user_id: string } | null = null;
    private equals = new Map<string, string>();
    private nullColumns = new Set<string>();
    private orderedBy: string | null = null;
    private greaterThanId: string | null = null;
    private requestedLimit = 1000;
    private requestedRange: { from: number; to: number } | null = null;

    select(columns: string) {
      this.selectedColumns = columns;
      return this;
    }

    update(values: { auth_user_id: string }) {
      this.updateValues = values;
      return this;
    }

    eq(column: string, value: string) {
      this.equals.set(column, value);
      return this;
    }

    is(column: string, value: null) {
      if (value === null) this.nullColumns.add(column);
      return this;
    }

    order(column: string) {
      this.orderedBy = column;
      return this;
    }

    limit(limit: number) {
      this.requestedLimit = limit;
      return this;
    }

    gt(column: string, value: string) {
      if (column === "id") this.greaterThanId = value;
      return this;
    }

    range(from: number, to: number) {
      this.requestedRange = { from, to };
      return this;
    }

    private execute(): UsersQueryResult {
      if (this.updateValues) {
        if (state.remainingLinkFailures > 0) {
          state.remainingLinkFailures -= 1;
          return {
            data: [],
            error: new Error("provider-link-error-with-secret"),
          };
        }
        const matching = state.publicUsers.filter(
          (row) =>
            [...this.equals].every(([column, value]) =>
              column === "id" ? row.id === value : row.auth_user_id === value
            ) &&
            [...this.nullColumns].every(
              (column) => column !== "auth_user_id" || row.auth_user_id === null
            )
        );
        for (const row of matching) {
          row.auth_user_id = this.updateValues.auth_user_id;
        }
        return {
          data: matching.map(({ id }) => ({ id })),
          error: null,
        };
      }

      let matching = state.publicUsers.filter((row) =>
        [...this.equals].every(([column, value]) => {
          if (column === "id") return row.id === value;
          if (column === "auth_user_id") return row.auth_user_id === value;
          if (column === "email") return row.email === value;
          return false;
        })
      );
      if (this.equals.has("id") && this.equals.has("auth_user_id")) {
        state.confirmations.push({
          publicUserId: this.equals.get("id"),
          authUserId: this.equals.get("auth_user_id"),
        });
        const forcedCount = state.confirmationCounts.shift();
        if (forcedCount !== undefined) {
          if (forcedCount === 0) matching = [];
          if (forcedCount > 1 && matching[0]) {
            matching = Array.from({ length: forcedCount }, () => matching[0]);
          }
        }
      }
      if (this.orderedBy === "id") {
        matching = matching.toSorted((left, right) =>
          left.id.localeCompare(right.id)
        );
      }
      if (this.greaterThanId) {
        matching = matching.filter((row) => row.id > this.greaterThanId!);
      }
      if (this.orderedBy) {
        state.publicPageCursors.push(this.greaterThanId);
      }
      if (this.requestedRange) {
        matching = matching.slice(
          this.requestedRange.from,
          Math.min(
            this.requestedRange.to + 1,
            this.requestedRange.from + publicPageCap
          )
        );
      } else if (this.orderedBy) {
        matching = matching.slice(
          0,
          Math.min(this.requestedLimit, publicPageCap)
        );
      }

      return {
        data: matching.map((row) =>
          this.selectedColumns === "id" ? { id: row.id } : { ...row }
        ),
        error: null,
      };
    }

    then: Promise<UsersQueryResult>["then"] = (onFulfilled, onRejected) =>
      Promise.resolve(this.execute()).then(onFulfilled, onRejected);
  }

  const supabase = {
    from: (table: string) => {
      if (table !== "users") throw new Error(`Unexpected table: ${table}`);
      return new UsersQuery();
    },
    auth: {
      admin: {
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
          state.authPagesRequested.push(page);
          if (authListError) {
            return {
              data: { users: [] },
              error: authListError,
            };
          }
          const from = (page - 1) * perPage;
          const users = state.authUsers.slice(from, from + perPage);
          if (changeEmailAfterAuthList && !state.changedEmailAfterAuthList) {
            const row = state.publicUsers.find(
              ({ id }) => id === changeEmailAfterAuthList.publicUserId
            );
            if (row) row.email = changeEmailAfterAuthList.email;
            state.changedEmailAfterAuthList = true;
          }
          if (reassignAfterAuthList && !state.reassignedAfterAuthList) {
            const row = state.publicUsers.find(
              ({ id }) => id === reassignAfterAuthList.publicUserId
            );
            if (row) row.auth_user_id = reassignAfterAuthList.authUserId;
            state.reassignedAfterAuthList = true;
          }
          return {
            data: {
              users,
              aud: "authenticated",
              nextPage: users.length === perPage ? page + 1 : null,
              lastPage: Math.ceil(state.authUsers.length / perPage),
              total: state.authUsers.length,
            },
            error: null,
          };
        },
        createUser: async ({ email }: { email: string }) => {
          if (createError) {
            return { data: { user: null }, error: createError };
          }
          const user = authUser(`created-${state.authUsers.length + 1}`, email);
          state.authUsers.push(user);
          state.createdEmails.push(email);
          return { data: { user }, error: null };
        },
        updateUserById: async (id: string) => {
          const user = state.authUsers.find((candidate) => candidate.id === id);
          state.passwordUpdates.push(id);
          if (reassignAfterPasswordUpdate) {
            const row = state.publicUsers.find(
              ({ id: publicUserId }) =>
                publicUserId === reassignAfterPasswordUpdate.publicUserId
            );
            if (row) row.auth_user_id = reassignAfterPasswordUpdate.authUserId;
          }
          return user
            ? { data: { user }, error: null }
            : { data: { user: null }, error: new Error("unknown user") };
        },
      },
    },
  };

  return { supabase, state };
}

test.describe("demo Auth bootstrap reconciliation", () => {
  test("normalizes email with trim and lowercase", () => {
    expect(normalizeEmail("  Demo.User@Example.COM  ")).toBe(
      "demo.user@example.com"
    );
  });

  test("links an existing matching Auth user instead of recreating it", () => {
    const plan = planDemoAuthChanges(
      [{ id: "public-1", email: " Demo@Example.com ", auth_user_id: null }],
      [{ id: "auth-1", email: "demo@example.com" }]
    );

    expect(plan).toEqual({
      create: [],
      updatePassword: [
        { authUserId: "auth-1", email: "demo@example.com" },
      ],
      link: [
        {
          publicUserId: "public-1",
          authUserId: "auth-1",
          email: "demo@example.com",
        },
      ],
    });
  });

  test("updates the password without relinking an already linked user", () => {
    const plan = planDemoAuthChanges(
      [
        {
          id: "public-1",
          email: "demo@example.com",
          auth_user_id: "auth-1",
        },
      ],
      [{ id: "auth-1", email: "DEMO@example.com" }]
    );

    expect(plan).toEqual({
      create: [],
      updatePassword: [
        { authUserId: "auth-1", email: "demo@example.com" },
      ],
      link: [],
    });
  });

  test("plans creation without inventing an Auth ID or link", () => {
    const plan = planDemoAuthChanges(
      [{ id: "public-1", email: "new@example.com", auth_user_id: null }],
      []
    );

    expect(plan).toEqual({
      create: [{ publicUserId: "public-1", email: "new@example.com" }],
      updatePassword: [],
      link: [],
    });
  });

  test("rejects duplicate normalized Auth emails", () => {
    expect(() =>
      indexAuthUsers([
        { id: "auth-1", email: "demo@example.com" },
        { id: "auth-2", email: " DEMO@example.com " },
      ])
    ).toThrow(/duplicate auth email.*demo@example\.com/i);
  });

  test("ignores an unrelated Auth identity without an email", () => {
    const plan = planDemoAuthChanges(
      [{ id: "public-1", email: "demo@example.com", auth_user_id: null }],
      [{ id: "phone-auth", email: null }]
    );

    expect(plan).toEqual({
      create: [{ publicUserId: "public-1", email: "demo@example.com" }],
      updatePassword: [],
      link: [],
    });
  });

  test("rejects a public link to an Auth identity without an email", () => {
    expect(() =>
      planDemoAuthChanges(
        [
          {
            id: "public-1",
            email: "demo@example.com",
            auth_user_id: "phone-auth",
          },
        ],
        [{ id: "phone-auth", email: null }]
      )
    ).toThrow(/email mismatch.*public-1.*phone-auth/i);
  });

  test("rejects a public link whose Auth identity has another email", () => {
    expect(() =>
      planDemoAuthChanges(
        [
          {
            id: "public-1",
            email: "demo@example.com",
            auth_user_id: "auth-1",
          },
        ],
        [{ id: "auth-1", email: "other@example.com" }]
      )
    ).toThrow(/email mismatch.*public-1.*auth-1/i);
  });

  test("rejects a public link to an Auth identity that does not exist", () => {
    expect(() =>
      planDemoAuthChanges(
        [
          {
            id: "public-1",
            email: "demo@example.com",
            auth_user_id: "missing-auth",
          },
        ],
        []
      )
    ).toThrow(/conflicting auth link.*public-1.*missing-auth/i);
  });

  test("rejects two public users targeting one Auth ID", () => {
    expect(() =>
      planDemoAuthChanges(
        [
          {
            id: "public-1",
            email: "demo@example.com",
            auth_user_id: "auth-1",
          },
          {
            id: "public-2",
            email: "other@example.com",
            auth_user_id: "auth-1",
          },
        ],
        [{ id: "auth-1", email: "demo@example.com" }]
      )
    ).toThrow(/auth identity auth-1.*multiple public users/i);
  });

  test("rejects duplicate normalized public emails before creation", () => {
    expect(() =>
      planDemoAuthChanges(
        [
          { id: "public-1", email: "demo@example.com", auth_user_id: null },
          { id: "public-2", email: " DEMO@example.com ", auth_user_id: null },
        ],
        []
      )
    ).toThrow(/duplicate public email.*demo@example\.com/i);
  });

  test("omits password and service-key values from plans and summaries", () => {
    const password = "demo-password-that-must-not-leak";
    const serviceKey = "service-key-that-must-not-leak";
    const plan = planDemoAuthChanges(
      [
        {
          id: "public-1",
          email: "demo@example.com",
          auth_user_id: null,
          password,
        },
      ],
      [{ id: "auth-1", email: "demo@example.com", serviceKey }]
    );
    const summary = summarizeDemoAuthPlan(plan);

    expect(summary).toEqual({
      create: { count: 0, emails: [] },
      updatePassword: { count: 1, emails: ["demo@example.com"] },
      link: { count: 1, emails: ["demo@example.com"] },
    });
    expect(JSON.stringify({ plan, summary })).not.toContain(password);
    expect(JSON.stringify({ plan, summary })).not.toContain(serviceKey);
  });
});

test("enabled orchestration updates and links an existing Auth identity", async () => {
  const password = "test-password-at-least-12";
  const { supabase, state } = createBootstrapSupabaseFake({
    publicUsers: [
      { id: "public-1", email: "Demo@Example.com", auth_user_id: null },
    ],
    authUsers: [authUser("auth-1", "demo@example.com")],
  });

  await bootstrapDemoAuth({
    supabase,
    password,
    log: (...values: unknown[]) => state.logs.push(values.join(" ")),
  });

  expect(state.createdEmails).toEqual([]);
  expect(state.passwordUpdates).toEqual(["auth-1"]);
  expect(state.publicUsers).toEqual([
    {
      id: "public-1",
      email: "Demo@Example.com",
      auth_user_id: "auth-1",
    },
  ]);
  expect(state.logs.at(-1)).toContain("Demo Auth bootstrap complete:");
  expect(state.logs.join("\n")).not.toContain(password);
  expect(state.confirmations).toEqual([
    { publicUserId: "public-1", authUserId: "auth-1" },
  ]);
});

test("server-capped public pages cannot hide a later mapping conflict", async () => {
  const { supabase, state } = createBootstrapSupabaseFake({
    publicUsers: [
      { id: "0001", email: "duplicate@example.com", auth_user_id: null },
      { id: "0002", email: " DUPLICATE@example.com ", auth_user_id: null },
    ],
    authUsers: [],
    publicPageCap: 1,
  });

  await expect(
    bootstrapDemoAuth({
      supabase,
      password: "test-password-at-least-12",
      log: (...values: unknown[]) => state.logs.push(values.join(" ")),
    })
  ).rejects.toThrow(/conflicting user mapping/i);

  expect(state.publicPageCursors).toEqual([null, "0001", "0002"]);
  expect(state.createdEmails).toEqual([]);
  expect(state.passwordUpdates).toEqual([]);
});

test("confirms an existing public link before password mutation and before success", async () => {
  const { supabase, state } = createBootstrapSupabaseFake({
    publicUsers: [
      {
        id: "public-1",
        email: "Demo@Example.com",
        auth_user_id: "auth-1",
      },
    ],
    authUsers: [authUser("auth-1", "demo@example.com")],
  });

  await bootstrapDemoAuth({
    supabase,
    password: "test-password-at-least-12",
    log: (...values: unknown[]) => state.logs.push(values.join(" ")),
  });

  expect(state.confirmations).toEqual([
    { publicUserId: "public-1", authUserId: "auth-1" },
    { publicUserId: "public-1", authUserId: "auth-1" },
  ]);
  expect(state.passwordUpdates).toEqual(["auth-1"]);
  expect(state.logs.at(-1)).toContain("Demo Auth bootstrap complete:");
});

test("refuses a concurrent reassignment before mutating the old Auth identity", async () => {
  const { supabase, state } = createBootstrapSupabaseFake({
    publicUsers: [
      {
        id: "public-1",
        email: "demo@example.com",
        auth_user_id: "auth-1",
      },
    ],
    authUsers: [
      authUser("auth-1", "demo@example.com"),
      authUser("auth-2", "other@example.com"),
    ],
    reassignAfterAuthList: {
      publicUserId: "public-1",
      authUserId: "auth-2",
    },
  });

  await expect(
    bootstrapDemoAuth({
      supabase,
      password: "test-password-at-least-12",
      log: (...values: unknown[]) => state.logs.push(values.join(" ")),
    })
  ).rejects.toThrow(/confirm exactly one public link.*demo@example\.com/i);

  expect(state.passwordUpdates).toEqual([]);
  expect(state.logs.some((entry) => entry.includes("complete"))).toBe(false);
});

test("refuses multiple rows returned for an exact public-link confirmation", async () => {
  const { supabase, state } = createBootstrapSupabaseFake({
    publicUsers: [
      {
        id: "public-1",
        email: "demo@example.com",
        auth_user_id: "auth-1",
      },
    ],
    authUsers: [authUser("auth-1", "demo@example.com")],
    confirmationCounts: [2],
  });

  await expect(
    bootstrapDemoAuth({
      supabase,
      password: "test-password-at-least-12",
      log: (...values: unknown[]) => state.logs.push(values.join(" ")),
    })
  ).rejects.toThrow(/confirm exactly one public link.*demo@example\.com/i);

  expect(state.passwordUpdates).toEqual([]);
});

test("refuses a concurrent linked-email change before password mutation", async () => {
  const { supabase, state } = createBootstrapSupabaseFake({
    publicUsers: [
      {
        id: "public-1",
        email: "demo@example.com",
        auth_user_id: "auth-1",
      },
    ],
    authUsers: [authUser("auth-1", "demo@example.com")],
    changeEmailAfterAuthList: {
      publicUserId: "public-1",
      email: "changed@example.com",
    },
  });

  await expect(
    bootstrapDemoAuth({
      supabase,
      password: "test-password-at-least-12",
      log: (...values: unknown[]) => state.logs.push(values.join(" ")),
    })
  ).rejects.toThrow(/confirm exactly one public link.*demo@example\.com/i);

  expect(state.passwordUpdates).toEqual([]);
  expect(state.logs.some((entry) => entry.includes("complete"))).toBe(false);
});

test("reconfirms an existing link before reporting success", async () => {
  const { supabase, state } = createBootstrapSupabaseFake({
    publicUsers: [
      {
        id: "public-1",
        email: "demo@example.com",
        auth_user_id: "auth-1",
      },
    ],
    authUsers: [
      authUser("auth-1", "demo@example.com"),
      authUser("auth-2", "other@example.com"),
    ],
    reassignAfterPasswordUpdate: {
      publicUserId: "public-1",
      authUserId: "auth-2",
    },
  });

  await expect(
    bootstrapDemoAuth({
      supabase,
      password: "test-password-at-least-12",
      log: (...values: unknown[]) => state.logs.push(values.join(" ")),
    })
  ).rejects.toThrow(/confirm exactly one public link.*demo@example\.com/i);

  expect(state.passwordUpdates).toEqual(["auth-1"]);
  expect(state.logs.some((entry) => entry.includes("complete"))).toBe(false);
});

test("loads the Auth page after an exact 1000-user page", async () => {
  const firstPage = Array.from({ length: 1000 }, (_, index) =>
    authUser(`auth-${String(index).padStart(4, "0")}`, `user-${index}@example.com`)
  );
  const matchingUser = authUser("auth-match", "demo@example.com");
  const { supabase, state } = createBootstrapSupabaseFake({
    publicUsers: [
      { id: "public-1", email: "demo@example.com", auth_user_id: null },
    ],
    authUsers: [...firstPage, matchingUser],
  });

  await bootstrapDemoAuth({
    supabase,
    password: "test-password-at-least-12",
    log: (...values: unknown[]) => state.logs.push(values.join(" ")),
  });

  expect(state.authPagesRequested).toEqual([1, 2]);
  expect(state.createdEmails).toEqual([]);
  expect(state.passwordUpdates).toEqual(["auth-match"]);
  expect(state.publicUsers[0].auth_user_id).toBe("auth-match");
});

test("sanitizes a remote Auth-list failure", async () => {
  const providerSecret = "provider-error-containing-service-secret";
  const { supabase } = createBootstrapSupabaseFake({
    publicUsers: [
      { id: "public-1", email: "demo@example.com", auth_user_id: null },
    ],
    authUsers: [],
    authListError: new Error(providerSecret),
  });
  let message = "";

  try {
    await bootstrapDemoAuth({
      supabase,
      password: "test-password-at-least-12",
      log: () => undefined,
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  expect(message).toBe("Failed to load Auth users.");
  expect(message).not.toContain(providerSecret);
});

test("sanitizes a remote Auth-create failure", async () => {
  const providerSecret = "provider-create-error-containing-service-secret";
  const { supabase } = createBootstrapSupabaseFake({
    publicUsers: [
      { id: "public-1", email: "demo@example.com", auth_user_id: null },
    ],
    authUsers: [],
    createError: new Error(providerSecret),
  });
  let message = "";

  try {
    await bootstrapDemoAuth({
      supabase,
      password: "test-password-at-least-12",
      log: () => undefined,
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  expect(message).toBe("Failed to create Auth identity for demo@example.com.");
  expect(message).not.toContain(providerSecret);
});

test("reruns safely after creation succeeds but linking fails", async () => {
  const { supabase, state } = createBootstrapSupabaseFake({
    publicUsers: [
      { id: "public-1", email: "demo@example.com", auth_user_id: null },
    ],
    authUsers: [],
    linkFailures: 1,
  });
  const options = {
    supabase,
    password: "test-password-at-least-12",
    log: (...values: unknown[]) => state.logs.push(values.join(" ")),
  };

  await expect(bootstrapDemoAuth(options)).rejects.toThrow(
    /failed to link.*demo@example\.com/i
  );
  await bootstrapDemoAuth(options);

  expect(state.createdEmails).toEqual(["demo@example.com"]);
  expect(state.passwordUpdates).toEqual(["created-1"]);
  expect(state.publicUsers[0].auth_user_id).toBe("created-1");
  expect(state.logs.at(-1)).toContain("Demo Auth bootstrap complete:");
});

test("the explicit bootstrap rejects a disabled safety flag before client creation", () => {
  const password = "disabled-demo-password";
  const serviceKey = "disabled-service-key";
  let message = "";

  try {
    readBootstrapConfig({
      ALLOW_DEMO_AUTH_BOOTSTRAP: "false",
      NEXT_PUBLIC_SUPABASE_URL: "https://127.0.0.1:9",
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      DEMO_AUTH_PASSWORD: password,
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  expect(message).toContain("ALLOW_DEMO_AUTH_BOOTSTRAP=true");
  expect(message).not.toContain(password);
  expect(message).not.toContain(serviceKey);
});

for (const {
  name,
  env,
  expectedMessage,
} of [
  {
    name: "a Supabase URL",
    env: { NEXT_PUBLIC_SUPABASE_URL: "" },
    expectedMessage: "NEXT_PUBLIC_SUPABASE_URL",
  },
  {
    name: "a service-role key",
    env: { SUPABASE_SERVICE_ROLE_KEY: "" },
    expectedMessage: "SUPABASE_SERVICE_ROLE_KEY",
  },
  {
    name: "a demo password",
    env: { DEMO_AUTH_PASSWORD: "" },
    expectedMessage: "DEMO_AUTH_PASSWORD",
  },
  {
    name: "a demo password of at least 12 characters",
    env: { DEMO_AUTH_PASSWORD: "too-short" },
    expectedMessage: "at least 12 characters",
  },
]) {
  test(`the explicit bootstrap requires ${name} before client creation`, () => {
    expect(() =>
      readBootstrapConfig(
        Object.assign(
          {
            ALLOW_DEMO_AUTH_BOOTSTRAP: "true",
            NEXT_PUBLIC_SUPABASE_URL: "https://127.0.0.1:9",
            SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
            DEMO_AUTH_PASSWORD: "test-password-at-least-12",
          },
          env
        )
      )
    ).toThrow(expectedMessage);
  });
}
