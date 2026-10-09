import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

// Locale routing for pages only; the /relay proxy and static files pass straight through.
export const config = { matcher: ["/((?!relay|_next|_vercel|.*\..*).*)"] };
