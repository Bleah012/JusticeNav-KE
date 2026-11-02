import { apiOrigin } from "../auth/session";
type TokenUser = {
  uid: string;
  getIdToken: () => Promise<string>;
};
type Options = {
  baseUrl: string;
  currentUser: () => TokenUser | null;
  request?: typeof fetch;
};
export class ProfileApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Profile request could not be completed");
    this.status = status;
  }
}
// Capture the account once, then check it again before sending its token.
export function createAuthenticatedRequest({
  baseUrl,
  currentUser,
  request = fetch,
}: Options) {
  return async (
    uid: string,
    method: "GET" | "PUT",
    body: unknown,
    signal: AbortSignal,
  ): Promise<unknown> => {
    const user = currentUser();
    if (!user || user.uid !== uid || signal.aborted)
      throw new ProfileApiError(401);
    const token = await user.getIdToken();
    if (signal.aborted || currentUser() !== user)
      throw new ProfileApiError(401);
    const response = await request(`${apiOrigin(baseUrl)}/api/v1/profile/me`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === "PUT" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "PUT" ? { body: JSON.stringify(body) } : {}),
      signal,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (signal.aborted || currentUser() !== user)
      throw new ProfileApiError(401);
    if (!response.ok) throw new ProfileApiError(response.status);
    const result: unknown = await response.json();
    if (signal.aborted || currentUser() !== user)
      throw new ProfileApiError(401);
    return result;
  };
}
