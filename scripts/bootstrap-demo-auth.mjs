import {
  normalizeEmail,
  planDemoAuthChanges,
  summarizeDemoAuthPlan,
} from "./bootstrap-demo-auth-core.mjs";
import { basename } from "node:path";

const PAGE_SIZE = 1000;

class BootstrapError extends Error {}

export function readBootstrapConfig(env) {
  if (env.ALLOW_DEMO_AUTH_BOOTSTRAP !== "true") {
    throw new BootstrapError(
      "Demo Auth bootstrap is disabled. Set ALLOW_DEMO_AUTH_BOOTSTRAP=true explicitly to run it."
    );
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new BootstrapError("NEXT_PUBLIC_SUPABASE_URL is required.");
  }
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new BootstrapError("NEXT_PUBLIC_SUPABASE_URL must be a valid URL.");
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new BootstrapError("SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  const password = env.DEMO_AUTH_PASSWORD;
  if (!password) {
    throw new BootstrapError("DEMO_AUTH_PASSWORD is required.");
  }
  if (password.length < 12) {
    throw new BootstrapError(
      "DEMO_AUTH_PASSWORD must be at least 12 characters."
    );
  }

  return { url, serviceRoleKey, password };
}

async function loadPublicUsers(supabase) {
  const users = [];
  let lastId = null;

  for (;;) {
    let result;
    try {
      let query = supabase
        .from("users")
        .select("id,email,auth_user_id");
      if (lastId) query = query.gt("id", lastId);
      result = await query
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
    } catch {
      throw new BootstrapError("Failed to load public users.");
    }

    if (result.error || !Array.isArray(result.data)) {
      throw new BootstrapError("Failed to load public users.");
    }

    users.push(...result.data);
    if (result.data.length === 0) return users;

    const nextLastId = result.data.at(-1)?.id;
    if (typeof nextLastId !== "string" || !nextLastId || nextLastId === lastId) {
      throw new BootstrapError("Failed to page through public users safely.");
    }
    lastId = nextLastId;
  }
}

async function loadAuthUsers(supabase) {
  const users = [];

  for (let page = 1; ; page += 1) {
    let result;
    try {
      result = await supabase.auth.admin.listUsers({
        page,
        perPage: PAGE_SIZE,
      });
    } catch {
      throw new BootstrapError("Failed to load Auth users.");
    }

    if (result.error || !Array.isArray(result.data?.users)) {
      throw new BootstrapError("Failed to load Auth users.");
    }

    users.push(...result.data.users);
    if (result.data.users.length < PAGE_SIZE) return users;
  }
}

async function createAuthUser(supabase, operation, password) {
  let result;
  try {
    result = await supabase.auth.admin.createUser({
      email: operation.email,
      password,
      email_confirm: true,
    });
  } catch {
    throw new BootstrapError(
      `Failed to create Auth identity for ${operation.email}.`
    );
  }

  if (result.error || !result.data?.user?.id) {
    throw new BootstrapError(
      `Failed to create Auth identity for ${operation.email}.`
    );
  }

  return {
    publicUserId: operation.publicUserId,
    authUserId: result.data.user.id,
    email: operation.email,
  };
}

async function updateAuthPassword(supabase, operation, password) {
  let result;
  try {
    result = await supabase.auth.admin.updateUserById(operation.authUserId, {
      password,
    });
  } catch {
    throw new BootstrapError(
      `Failed to update the Auth password for ${operation.email}.`
    );
  }

  if (result.error || result.data?.user?.id !== operation.authUserId) {
    throw new BootstrapError(
      `Failed to update the Auth password for ${operation.email}.`
    );
  }
}

async function linkPublicUser(supabase, operation) {
  let result;
  try {
    result = await supabase
      .from("users")
      .update({ auth_user_id: operation.authUserId })
      .eq("id", operation.publicUserId)
      .is("auth_user_id", null)
      .select("id");
  } catch {
    throw new BootstrapError(
      `Failed to link the public user for ${operation.email}.`
    );
  }

  if (
    result.error ||
    !Array.isArray(result.data) ||
    result.data.length !== 1 ||
    result.data[0]?.id !== operation.publicUserId
  ) {
    throw new BootstrapError(
      `Failed to link exactly one public user for ${operation.email}.`
    );
  }
}

async function confirmPublicLink(supabase, operation) {
  let result;
  try {
    result = await supabase
      .from("users")
      .select("id,email,auth_user_id")
      .eq("id", operation.publicUserId)
      .eq("auth_user_id", operation.authUserId);
  } catch {
    throw new BootstrapError(
      `Failed to confirm exactly one public link for ${operation.email}.`
    );
  }

  let confirmedEmail;
  try {
    confirmedEmail = normalizeEmail(result.data?.[0]?.email);
  } catch {
    confirmedEmail = null;
  }

  if (
    result.error ||
    !Array.isArray(result.data) ||
    result.data.length !== 1 ||
    result.data[0]?.id !== operation.publicUserId ||
    result.data[0]?.auth_user_id !== operation.authUserId ||
    confirmedEmail !== operation.email
  ) {
    throw new BootstrapError(
      `Failed to confirm exactly one public link for ${operation.email}.`
    );
  }
}

export async function bootstrapDemoAuth({
  supabase,
  password,
  log = console.log,
}) {
  const publicUsers = await loadPublicUsers(supabase);
  if (publicUsers.length === 0) {
    throw new BootstrapError(
      "No public users were found; refusing to bootstrap demo Auth identities."
    );
  }
  const authUsers = await loadAuthUsers(supabase);

  let plan;
  try {
    plan = planDemoAuthChanges(publicUsers, authUsers);
  } catch {
    throw new BootstrapError(
      "Demo Auth reconciliation found a conflicting user mapping; no writes were attempted."
    );
  }

  const existingLinks = publicUsers
    .filter(({ auth_user_id: authUserId }) => authUserId !== null)
    .map(({ id, email, auth_user_id: authUserId }) => ({
      publicUserId: id,
      authUserId,
      email: normalizeEmail(email),
    }));

  log(
    "Demo Auth bootstrap plan:",
    JSON.stringify(summarizeDemoAuthPlan(plan))
  );

  for (const operation of existingLinks) {
    await confirmPublicLink(supabase, operation);
  }

  const createdLinks = [];
  for (const operation of plan.create) {
    createdLinks.push(await createAuthUser(supabase, operation, password));
  }
  for (const operation of plan.updatePassword) {
    await updateAuthPassword(supabase, operation, password);
  }
  for (const operation of [...plan.link, ...createdLinks]) {
    await linkPublicUser(supabase, operation);
  }

  const confirmedLinks = [...existingLinks, ...plan.link, ...createdLinks];
  for (const operation of confirmedLinks) {
    await confirmPublicLink(supabase, operation);
  }

  log(
    "Demo Auth bootstrap complete:",
    JSON.stringify({
      created: { count: createdLinks.length, emails: createdLinks.map(({ email }) => email) },
      passwordsUpdated: {
        count: plan.updatePassword.length,
        emails: plan.updatePassword.map(({ email }) => email),
      },
      linked: {
        count: plan.link.length + createdLinks.length,
        emails: [...plan.link, ...createdLinks].map(({ email }) => email),
      },
    })
  );
}

async function run() {
  const config = readBootstrapConfig(process.env);
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  await bootstrapDemoAuth({
    supabase,
    password: config.password,
  });
}

function reportFailure(error) {
  if (error instanceof BootstrapError) {
    console.error(error.message);
  } else {
    console.error("Demo Auth bootstrap failed unexpectedly.");
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  basename(process.argv[1]) === "bootstrap-demo-auth.mjs"
) {
  run().catch(reportFailure);
}
