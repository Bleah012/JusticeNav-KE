// Supply private account data only after authentication and backend ownership checks.
export type AccountData<T> =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; retry?: () => void }
  | { status: "ready"; value: T };

export type SavedAssessment = {
  id: string;
  title: string;
  status: "draft" | "needs-clarification" | "results-ready";
  updatedAt: string;
};

export const assessmentStatusLabels: Record<SavedAssessment["status"], string> =
  {
    draft: "Draft",
    "needs-clarification": "Needs clarification",
    "results-ready": "Results ready",
  };

export type AccountNotification = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  isRead: boolean;
  kind: "referral" | "checklist" | "assessment" | "information";
  referralId: string | null;
};

export type AccountProfile = {
  fullName: string;
  email: string;
  phone: string | null;
  preferredLanguage: "en" | "sw" | null;
};
