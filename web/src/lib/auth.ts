// NextAuth setup (ADR-075). Sign-in only through OAuth providers (Google first, GitHub optional) configured in web/.env.local; sessions are signed
// JWT cookies, so there is no user database and no password. Off until NEXTAUTH_SECRET and a provider are set.
import { getServerSession, type NextAuthOptions } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { authEnabled, configuredProviders, userKey } from "./accounts";

export function authOptions(env = process.env): NextAuthOptions {
  const providers = configuredProviders(env).map(p => p === "google"
    ? Google({ clientId: env.AUTH_GOOGLE_ID!, clientSecret: env.AUTH_GOOGLE_SECRET! })
    : GitHub({ clientId: env.AUTH_GITHUB_ID!, clientSecret: env.AUTH_GITHUB_SECRET! }));
  return {
    providers,
    secret: env.NEXTAUTH_SECRET,
    session: { strategy: "jwt", maxAge: 7 * 24 * 3600 },
    callbacks: {
      // Keep only the hashed folder key in the token; no email, name or picture is carried around.
      async jwt({ token, account }) {
        if (account) return { uid: userKey(account.provider, account.providerAccountId, env.NEXTAUTH_SECRET) };
        return token;
      },
      async session({ session, token }) {
        return { expires: session.expires, user: { uid: typeof token.uid === "string" ? token.uid : null } } as never;
      },
    },
  };
}

/** The signed-in user's folder key, or null. */
export async function currentUserKey(): Promise<string | null> {
  if (!authEnabled()) return null;
  const s = await getServerSession(authOptions()) as { user?: { uid?: string | null } } | null;
  return s?.user?.uid ?? null;
}
