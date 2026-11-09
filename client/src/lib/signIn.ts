/**
 * The server's admin sign-in page, which comes back to `next`. Signing in
 * there replaces a viewer session, so there's no need to sign out first.
 * Link to it with a plain <a>: /login is a server page, not a client route.
 */
export function adminSignInHref(next: string): string {
  return `/login?admin=1&next=${encodeURIComponent(next)}`;
}

/** Admin sign-in that comes back to the Controls tab. */
export const ADMIN_SIGN_IN_HREF = adminSignInHref("/controls");
