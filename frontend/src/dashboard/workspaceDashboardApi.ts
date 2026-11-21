import { apiOrigin } from "../auth/session";
import { validServiceId } from "../catalog/catalogApi";
import { validDate } from "../referrals/referralApi";
import { AdminApiError, parseAdmin } from "../admin/adminApi";
import type { AdminOverview } from "../admin/adminApi";

export type DemoCounts = {
  shared: number;
  assigned: number;
  underReview: number;
  completed: number;
  withdrawn: number;
};
export type AccountCounts = {
  total: number;
  active: number;
  disabled: number;
  seeker: number;
  provider: number;
  admin: number;
  unsupported: number;
};
export type AdminDashboard = {
  catalog: AdminOverview;
  accounts: AccountCounts;
  demonstrations: DemoCounts | null;
  refreshedAt: string;
};
export type ProviderDashboard = {
  serviceId: string;
  counts: DemoCounts;
  refreshedAt: string;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AdminApiError(502);
  return value as Record<string, unknown>;
}
function counts<T>(value: unknown, keys: readonly string[], max: number): T {
  const row = object(value),
    result: Record<string, number> = {};
  for (const key of keys) {
    if (
      !Number.isSafeInteger(row[key]) ||
      (row[key] as number) < 0 ||
      (row[key] as number) > max
    )
      throw new AdminApiError(502);
    result[key] = row[key] as number;
  }
  return result as T;
}
export function demoTotal(value: DemoCounts) {
  return (
    value.shared +
    value.assigned +
    value.underReview +
    value.completed +
    value.withdrawn
  );
}
export function parseDemoCounts(value: unknown): DemoCounts {
  const result = counts<DemoCounts>(
    value,
    ["shared", "assigned", "underReview", "completed", "withdrawn"],
    1000,
  );
  if (demoTotal(result) > 1000) throw new AdminApiError(502);
  return result;
}
export function parseAdminDashboard(
  value: unknown,
  uid: string,
): AdminDashboard {
  const row = object(value),
    catalog = parseAdmin(row, uid, "overview") as AdminOverview;
  const accounts = counts<AccountCounts>(
    row.accounts,
    [
      "total",
      "active",
      "disabled",
      "seeker",
      "provider",
      "admin",
      "unsupported",
    ],
    5000,
  );
  if (
    accounts.active + accounts.disabled !== accounts.total ||
    accounts.seeker +
      accounts.provider +
      accounts.admin +
      accounts.unsupported !==
      accounts.total ||
    !validDate(row.refreshedAt)
  )
    throw new AdminApiError(502);
  return {
    catalog,
    accounts,
    demonstrations:
      row.demonstrations === null ? null : parseDemoCounts(row.demonstrations),
    refreshedAt: row.refreshedAt,
  };
}
export function parseProviderDashboard(
  value: unknown,
  uid: string,
): ProviderDashboard {
  const row = object(value),
    result = parseDemoCounts(row.counts);
  if (
    row.uid !== uid ||
    !validServiceId(row.serviceId) ||
    !validDate(row.refreshedAt) ||
    result.shared !== 0 ||
    result.withdrawn !== 0
  )
    throw new AdminApiError(502);
  return {
    serviceId: row.serviceId,
    counts: result,
    refreshedAt: row.refreshedAt,
  };
}
export function createAdminDashboardApi({
  baseUrl,
  uid,
  currentUser,
  request = fetch,
}: {
  baseUrl: string;
  uid: string;
  currentUser: () => { uid: string; getIdToken: () => Promise<string> } | null;
  request?: typeof fetch;
}) {
  return async (signal: AbortSignal) => {
    const user = currentUser(),
      active = () =>
        !signal.aborted && user?.uid === uid && currentUser() === user;
    if (!user || !active()) throw new AdminApiError(401);
    const token = await user.getIdToken();
    if (!active()) throw new AdminApiError(401);
    const response = await request(
      `${apiOrigin(baseUrl)}/api/v1/admin/dashboard`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      },
    );
    if (!active()) throw new AdminApiError(401);
    if (!response.ok) throw new AdminApiError(response.status);
    const value = await response.json();
    if (!active()) throw new AdminApiError(401);
    return parseAdminDashboard(value, uid);
  };
}
