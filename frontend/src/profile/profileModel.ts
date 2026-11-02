export type SavedProfile = {
  uid: string;
  fullName: string;
  phone: string | null;
  preferredLanguage: "en" | "sw";
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type ProfileFields = Pick<
  SavedProfile,
  "fullName" | "phone" | "preferredLanguage"
>;
export type ProfileRequest = (
  uid: string,
  method: "GET" | "PUT",
  body: unknown,
  signal: AbortSignal,
) => Promise<unknown>;
export type ProfileApi = {
  load: (signal: AbortSignal) => Promise<SavedProfile | null>;
  save: (
    fields: ProfileFields,
    expectedRevision: number,
    signal: AbortSignal,
  ) => Promise<SavedProfile>;
};
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
// Do not render profile data until both its owner and schema have been checked.
export function parseProfile(value: unknown, uid: string): SavedProfile {
  const item = value as Partial<SavedProfile> | null;
  if (
    !item ||
    item.uid !== uid ||
    typeof item.fullName !== "string" ||
    !item.fullName.trim() ||
    item.fullName.length > 120 ||
    /\p{Cc}/u.test(item.fullName) ||
    (item.phone !== null &&
      (typeof item.phone !== "string" ||
        !/^\+[1-9][0-9]{7,14}$/.test(item.phone))) ||
    !["en", "sw"].includes(item.preferredLanguage ?? "") ||
    !Number.isSafeInteger(item.revision) ||
    Number(item.revision) < 1 ||
    !validDate(item.createdAt) ||
    !validDate(item.updatedAt) ||
    Date.parse(item.updatedAt) < Date.parse(item.createdAt)
  ) {
    throw new Error("Invalid profile response");
  }
  return {
    uid,
    fullName: item.fullName,
    phone: item.phone,
    preferredLanguage: item.preferredLanguage as "en" | "sw",
    revision: item.revision as number,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
export function createProfileApi(
  uid: string,
  request: ProfileRequest,
): ProfileApi {
  return {
    async load(signal) {
      const result = (await request(uid, "GET", undefined, signal)) as {
        profile?: unknown;
      } | null;
      if (!result || !("profile" in result))
        throw new Error("Invalid profile response");
      return result.profile === null ? null : parseProfile(result.profile, uid);
    },
    async save(fields, expectedRevision, signal) {
      // Use a whitelist; caller-supplied identity or role properties are never serialized.
      const body = {
        fullName: fields.fullName.trim(),
        phone: fields.phone?.trim() || null,
        preferredLanguage: fields.preferredLanguage,
        expectedRevision,
      };
      const result = (await request(uid, "PUT", body, signal)) as {
        profile?: unknown;
      } | null;
      const saved = parseProfile(result?.profile, uid);
      if (saved.revision !== expectedRevision + 1)
        throw new Error("Unexpected saved revision");
      return saved;
    },
  };
}
