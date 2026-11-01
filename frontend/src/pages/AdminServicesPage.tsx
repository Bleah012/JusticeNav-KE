import { AdminCatalog } from "../components/AdminCatalog";
import type { AdminData, AdminServiceRecord } from "../types/adminData";

// Use the shared management table for authorized service records only.
export function AdminServicesPage({
  data,
}: {
  data?: AdminData<readonly AdminServiceRecord[]>;
}) {
  return <AdminCatalog kind="service" data={data} />;
}
