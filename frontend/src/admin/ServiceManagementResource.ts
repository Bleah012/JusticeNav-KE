import { CatalogManagementResource } from "./CatalogManagementResource";
import type { ServiceCommand, ServiceList } from "./serviceManagementApi";
export type ServiceManagementState =
  import("./CatalogManagementResource").CatalogManagementState<ServiceList>;
// Preserve the service controller API while sharing its lifecycle with pathway editing.
export class ServiceManagementResource extends CatalogManagementResource<
  ServiceList,
  ServiceCommand
> {}
