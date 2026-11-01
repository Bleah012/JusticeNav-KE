// Accept private summaries only from an authenticated, owner-scoped backend.
export type SavedChecklistSummary = {
  id: string;
  pathwayTitle: string;
  completedItems: number;
  totalItems: number;
  updatedAt: string;
};
