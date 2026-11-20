import { apiOrigin } from "../auth/session";
import { validServiceId } from "../catalog/catalogApi";
import { validDate } from "../referrals/referralApi";
import { AdminApiError } from "./adminApi";

export type Account = {
  id: string;
  name: string | null;
  email: string | null;
  role: "seeker" | "provider" | "admin" | "unsupported";
  disabled: boolean;
  serviceId: string | null;
  createdAt: string;
  lastSignInAt: string | null;
};
export type AccountPage = { users: Account[]; nextCursor: string | null };
export type AccountInput = {
  name: string;
  email: string;
  password: string;
  role: "provider" | "admin";
  serviceId: string | null;
  confirmed: boolean;
};
type User = { uid: string; getIdToken: () => Promise<string> };
const requestId = (value: string) => /^[a-f0-9]{32}$/.test(value);
const controls = (value: string) =>
  [...value].some((char) => {
    const code = char.codePointAt(0)!;
    return code < 32 || (code >= 127 && code <= 159);
  });
const cursor = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 4096 &&
  !controls(value);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AdminApiError(502);
  return value as Record<string, unknown>;
}
export function validateAccount(value: AccountInput): string {
  if (!value.name.trim() || value.name.length > 120 || controls(value.name))
    return "Enter a name of up to 120 characters.";
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ||
    value.email.length > 254
  )
    return "Enter a valid email address.";
  if (
    value.password.length < 12 ||
    value.password.length > 128 ||
    controls(value.password)
  )
    return "Use an initial password of 12 to 128 characters.";
  if (
    !["provider", "admin"].includes(value.role) ||
    (value.role === "provider"
      ? !validServiceId(value.serviceId)
      : value.serviceId !== null)
  )
    return "Choose a role and a published service for a provider.";
  if (value.confirmed !== true)
    return "Confirm the role and access before creating the account.";
  return "";
}
export function parseAccount(value: unknown): Account {
  const row = object(value);
  if (
    typeof row.id !== "string" ||
    !row.id.trim() ||
    row.id.length > 128 ||
    (row.name !== null &&
      (typeof row.name !== "string" || row.name.length > 120)) ||
    (row.email !== null &&
      (typeof row.email !== "string" || row.email.length > 254)) ||
    typeof row.role !== "string" ||
    !["seeker", "provider", "admin", "unsupported"].includes(row.role) ||
    typeof row.disabled !== "boolean" ||
    (row.serviceId !== null && !validServiceId(row.serviceId)) ||
    (row.role !== "provider" && row.serviceId !== null) ||
    !validDate(row.createdAt) ||
    (row.lastSignInAt !== null && !validDate(row.lastSignInAt))
  )
    throw new AdminApiError(502);
  return {
    id: row.id,
    name: row.name as string | null,
    email: row.email as string | null,
    role: row.role as Account["role"],
    disabled: row.disabled,
    serviceId: row.serviceId as string | null,
    createdAt: row.createdAt,
    lastSignInAt: row.lastSignInAt as string | null,
  };
}
export function createAdminUsersApi({
  baseUrl,
  uid,
  currentUser,
  request = fetch,
}: {
  baseUrl: string;
  uid: string;
  currentUser: () => User | null;
  request?: typeof fetch;
}) {
  async function send(path: string, signal: AbortSignal, body?: unknown) {
    const user = currentUser();
    const active = () =>
      !signal.aborted && user?.uid === uid && currentUser() === user;
    if (!user || !active()) throw new AdminApiError(401);
    const token = await user.getIdToken();
    if (!active()) throw new AdminApiError(401);
    const response = await request(
      `${apiOrigin(baseUrl)}/api/v1/admin/users${path}`,
      {
        method: body ? "PUT" : "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      },
    );
    if (!active()) throw new AdminApiError(401);
    if (!response.ok) throw new AdminApiError(response.status);
    const result = object(await response.json());
    if (!active() || result.uid !== uid) throw new AdminApiError(401);
    return result;
  }
  return {
    async list(
      after: string | undefined,
      signal: AbortSignal,
    ): Promise<AccountPage> {
      if (after !== undefined && !cursor(after)) throw new AdminApiError(422);
      const result = await send(
        after ? `?${new URLSearchParams({ after })}` : "",
        signal,
      );
      if (
        !Array.isArray(result.users) ||
        result.users.length > 50 ||
        (result.nextCursor !== null && !cursor(result.nextCursor))
      )
        throw new AdminApiError(502);
      const users = result.users.map(parseAccount);
      if (new Set(users.map((row) => row.id)).size !== users.length)
        throw new AdminApiError(502);
      return { users, nextCursor: result.nextCursor as string | null };
    },
    async lookup(id: string, signal: AbortSignal): Promise<Account | null> {
      if (!requestId(id)) throw new AdminApiError(422);
      try {
        const account = parseAccount(
          (await send(`/created/${id}`, signal)).account,
        );
        if (account.id !== `jn-${id}`) throw new AdminApiError(502);
        return account;
      } catch (error) {
        if (error instanceof AdminApiError && error.status === 404) return null;
        throw error;
      }
    },
    async create(
      id: string,
      input: AccountInput,
      signal: AbortSignal,
    ): Promise<Account> {
      const clean: AccountInput = {
        name: input.name.trim(),
        email: input.email.trim(),
        password: input.password,
        role: input.role,
        serviceId: input.serviceId,
        confirmed: input.confirmed,
      };
      if (!requestId(id) || validateAccount(clean))
        throw new AdminApiError(422);
      const account = parseAccount(
        (await send(`/${id}`, signal, clean)).account,
      );
      if (
        account.id !== `jn-${id}` ||
        account.name !== clean.name ||
        account.email?.toLowerCase() !== clean.email.toLowerCase() ||
        account.role !== clean.role ||
        account.serviceId !== clean.serviceId ||
        account.disabled
      )
        throw new AdminApiError(502);
      return account;
    },
  };
}
