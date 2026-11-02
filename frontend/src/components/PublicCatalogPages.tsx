import { useParams } from "react-router";
import { backendUrl } from "../auth/firebaseClient";
import { createCatalogApi } from "../catalog/catalogApi";
import { usePublicResource } from "../catalog/usePublicResource";
import { JusticeServicesPage } from "../pages/JusticeServicesPage";
import { ServiceProfilePage } from "../pages/ServiceProfilePage";
import { ResourcesPage } from "../pages/ResourcesPage";

export function PublicServicesPage() {
  const { state, retry } = usePublicResource((signal) =>
    createCatalogApi(backendUrl).services(signal),
  );
  return (
    <JusticeServicesPage
      directory={
        state.status === "ready"
          ? { status: "ready", services: state.value }
          : state.status === "loading"
            ? { status: "loading" }
            : { status: "error", retry }
      }
    />
  );
}
function ServiceRecord({ id }: { id: string }) {
  const { state, retry } = usePublicResource(
    (signal) => createCatalogApi(backendUrl).service(id, signal),
    true,
  );
  return (
    <ServiceProfilePage
      profile={
        state.status === "ready"
          ? { status: "ready", service: state.value }
          : state.status === "not-found"
            ? { status: "not-found" }
            : state.status === "loading"
              ? { status: "loading" }
              : { status: "error", retry }
      }
    />
  );
}
export function PublicServiceProfilePage() {
  const { serviceId } = useParams();
  return <ServiceRecord key={serviceId ?? "missing"} id={serviceId ?? ""} />;
}
export function PublicResourcesPage() {
  const { state, retry } = usePublicResource((signal) =>
    createCatalogApi(backendUrl).resources(signal),
  );
  return (
    <ResourcesPage
      library={
        state.status === "ready"
          ? { status: "ready", resources: state.value }
          : state.status === "loading"
            ? { status: "loading" }
            : { status: "error", retry }
      }
    />
  );
}
