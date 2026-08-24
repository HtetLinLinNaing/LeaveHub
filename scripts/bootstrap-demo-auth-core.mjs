export function normalizeEmail(email) {
  if (typeof email !== "string") {
    throw new Error("Invalid email: expected a string.");
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Invalid email: value is empty.");
  }

  return normalized;
}

function buildAuthIndexes(authUsers) {
  const byEmail = new Map();
  const byId = new Map();

  for (const authUser of authUsers) {
    if (!authUser || typeof authUser.id !== "string" || !authUser.id) {
      throw new Error("Invalid Auth user: missing ID.");
    }

    if (byId.has(authUser.id)) {
      throw new Error(`Duplicate Auth ID: ${authUser.id}.`);
    }

    const email =
      authUser.email === null || authUser.email === undefined
        ? null
        : normalizeEmail(authUser.email);
    if (email && byEmail.has(email)) {
      throw new Error(`Duplicate Auth email: ${email}.`);
    }

    const indexedUser = { id: authUser.id, email };
    if (email) byEmail.set(email, indexedUser);
    byId.set(authUser.id, indexedUser);
  }

  return { byEmail, byId };
}

export function indexAuthUsers(authUsers) {
  return buildAuthIndexes(authUsers).byEmail;
}

export function planDemoAuthChanges(publicUsers, authUsers) {
  const { byEmail: authByEmail, byId: authById } =
    buildAuthIndexes(authUsers);
  const publicEmails = new Map();
  const publicIds = new Set();
  const authTargets = new Map();
  const normalizedPublicUsers = [];

  for (const publicUser of publicUsers) {
    if (!publicUser || typeof publicUser.id !== "string" || !publicUser.id) {
      throw new Error("Invalid public user: missing ID.");
    }
    if (publicIds.has(publicUser.id)) {
      throw new Error(`Duplicate public user ID: ${publicUser.id}.`);
    }
    publicIds.add(publicUser.id);

    const email = normalizeEmail(publicUser.email);
    if (publicEmails.has(email)) {
      throw new Error(`Duplicate public email: ${email}.`);
    }
    publicEmails.set(email, publicUser.id);

    const linkedAuthUserId = publicUser.auth_user_id ?? null;
    if (
      linkedAuthUserId !== null &&
      (typeof linkedAuthUserId !== "string" || !linkedAuthUserId)
    ) {
      throw new Error(`Invalid Auth link for public user ${publicUser.id}.`);
    }

    normalizedPublicUsers.push({
      id: publicUser.id,
      email,
      authUserId: linkedAuthUserId,
    });
  }

  for (const publicUser of normalizedPublicUsers) {
    if (!publicUser.authUserId) continue;

    const existingPublicUserId = authTargets.get(publicUser.authUserId);
    if (existingPublicUserId) {
      throw new Error(
        `Auth identity ${publicUser.authUserId} targets multiple public users: ${existingPublicUserId} and ${publicUser.id}.`
      );
    }
    authTargets.set(publicUser.authUserId, publicUser.id);
  }

  for (const publicUser of normalizedPublicUsers) {
    const linkedAuthUser = publicUser.authUserId
      ? authById.get(publicUser.authUserId)
      : undefined;

    if (publicUser.authUserId && !linkedAuthUser) {
      throw new Error(
        `Conflicting Auth link: public user ${publicUser.id} targets missing Auth identity ${publicUser.authUserId}.`
      );
    }
    if (linkedAuthUser && linkedAuthUser.email !== publicUser.email) {
      throw new Error(
        `Email mismatch: public user ${publicUser.id} and Auth identity ${linkedAuthUser.id}.`
      );
    }

    const targetAuthUser = linkedAuthUser ?? authByEmail.get(publicUser.email);
    if (!targetAuthUser) continue;

    const existingPublicUserId = authTargets.get(targetAuthUser.id);
    if (!publicUser.authUserId && existingPublicUserId) {
      throw new Error(
        `Auth identity ${targetAuthUser.id} targets multiple public users: ${existingPublicUserId} and ${publicUser.id}.`
      );
    }
    if (!publicUser.authUserId) {
      authTargets.set(targetAuthUser.id, publicUser.id);
    }
  }

  const plan = { create: [], updatePassword: [], link: [] };

  for (const publicUser of normalizedPublicUsers) {
    const linkedAuthUser = publicUser.authUserId
      ? authById.get(publicUser.authUserId)
      : undefined;
    const targetAuthUser = linkedAuthUser ?? authByEmail.get(publicUser.email);

    if (!targetAuthUser) {
      plan.create.push({
        publicUserId: publicUser.id,
        email: publicUser.email,
      });
      continue;
    }

    plan.updatePassword.push({
      authUserId: targetAuthUser.id,
      email: publicUser.email,
    });

    if (!publicUser.authUserId) {
      plan.link.push({
        publicUserId: publicUser.id,
        authUserId: targetAuthUser.id,
        email: publicUser.email,
      });
    }
  }

  return plan;
}

export function summarizeDemoAuthPlan(plan) {
  return {
    create: {
      count: plan.create.length,
      emails: plan.create.map(({ email }) => email),
    },
    updatePassword: {
      count: plan.updatePassword.length,
      emails: plan.updatePassword.map(({ email }) => email),
    },
    link: {
      count: plan.link.length,
      emails: plan.link.map(({ email }) => email),
    },
  };
}
