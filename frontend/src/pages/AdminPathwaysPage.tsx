import { AdminCatalog } from "../components/AdminCatalog";
import type { AdminData, AdminPathwayRecord } from "../types/adminData";

// Keep pathway management separate from public recommendations and eligibility claims.
export function AdminPathwaysPage({
  data,
}: {
  data?: AdminData<readonly AdminPathwayRecord[]>;
}) {
  return <AdminCatalog kind="pathway" data={data} />;
}
