/**
 * The server's admin sign-in page, which comes back to the Controls tab.
 * Signing in there replaces a viewer session, so there's no need to sign
 * out first. Link to it with a plain <a>: /login is a server page, not a
 * client route.
 */
export const ADMIN_SIGN_IN_HREF = `/login?admin=1&next=${encodeURIComponent("/controls")}`;
