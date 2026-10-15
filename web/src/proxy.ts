import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

// Locale routing for pages only; the /relay and /api routes and static files pass straight through.
export const config = { matcher: ["/((?!relay|api|_next|_vercel|.*\\..*).*)"] };
