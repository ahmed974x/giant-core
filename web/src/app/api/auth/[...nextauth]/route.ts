// NextAuth endpoints (ADR-075): /api/auth/signin, /callback/<provider>, /signout, /session. Off until configured.
import NextAuth from "next-auth";
import { authEnabled } from "@/lib/accounts";
import { authOptions } from "@/lib/auth";

const off = () => Response.json({ error: "accounts are off on this server" }, { status: 404 });
const handler = (req: Request, ctx: unknown) => (authEnabled() ? (NextAuth(authOptions()) as (r: Request, c: unknown) => Promise<Response>)(req, ctx) : off());

export { handler as GET, handler as POST };
export const dynamic = "force-dynamic";
