import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { useAuth } from "../auth/useAuth";
import {
  createDemoReferralApi,
  demoStatusLabels,
  validDemoId,
} from "../referrals/demoReferralApi";
import type {
  DemoRecord,
  DemoRole,
  ProviderChoice,
} from "../referrals/demoReferralApi";
import { referralTime } from "../referrals/referralApi";
import { ReferralResource } from "../referrals/ReferralResource";
import { ReferralFeedback } from "./ReferralFeedback";
import { Button } from "./ui/Button";
import { DashboardChart } from "../dashboard/DashboardChart";
import { dashboardPalette } from "../dashboard/dashboardChartData";
import "../pages/SeekerPages.css";
import "../pages/DemoReferralWorkflow.css";

const messages = {
  success: "Demonstration progress saved.",
  invalid: "Check the demonstration referral and provider fields.",
  denied:
    "Access to this demonstration referral is unavailable. Check the account role and service membership, then reload.",
  conflict: "The saved progress changed. Refresh the page before trying again.",
  unconfirmed:
    "The update could not be confirmed. Refresh to check the saved state before trying again.",
};

function apiFor(uid: string) {
  return createDemoReferralApi({
    baseUrl: backendUrl,
    uid,
    currentUser: () => firebaseAuth().currentUser,
  });
}

function useResource<T>(resource: ReferralResource<T>) {
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => resource.start(), [resource]);
  return state;
}

function History({ record }: { record: DemoRecord }) {
  return (
    <ol className="referral-tracking__timeline">
      {record.history.map((event) => (
        <li key={event.status}>
          <strong>{demoStatusLabels[event.status]}</strong>{" "}
          <time dateTime={event.at}>{referralTime(event.at)}</time>
        </li>
      ))}
    </ol>
  );
}

export function DemoReferralProgress({
  uid,
  referralId,
  onChange,
}: {
  uid: string;
  referralId: string;
  onChange?: () => void;
}) {
  const [api] = useState(() => apiFor(uid));
  const [resource] = useState(
    () => new ReferralResource((signal) => api.mine(referralId, signal)),
  );
  const state = useResource(resource);
  const [consent, setConsent] = useState(false);
  const reload = () => void resource.reload();
  const ready = state.status === "ready";
  const record = ready ? state.value : null;
  const busy = ready && (state.saving || state.needsReload);

  return (
    <section
      className="seeker-page__panel demo-referral__progress"
      aria-labelledby="demo-progress-title"
    >
      <div className="admin-pages__panel-head">
        <h2 id="demo-progress-title">Demonstration progress</h2>
        <Button
          variant="secondary"
          disabled={state.status === "loading" || (ready && state.saving)}
          onClick={reload}
        >
          Refresh progress
        </Button>
      </div>
      <p>
        Updates record activity within the school demonstration. Institutional
        delivery status is shown in the referral details.
      </p>
      <ReferralFeedback state={state} reload={reload} />
      {ready && record && <History record={record} />}
      {ready && record && record.status !== "withdrawn" && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void resource
              .mutate(
                async (current, signal) =>
                  current ? api.withdraw(referralId, current, signal) : null,
                { ...messages, success: "Sharing withdrawn." },
              )
              .then((result) => {
                if (result) onChange?.();
              })
          }
        >
          Withdraw sharing
        </Button>
      )}
      {ready && !record && (
        <form
          className="demo-referral__consent"
          onSubmit={(event) => {
            event.preventDefault();
            if (consent)
              void resource
                .mutate((_, signal) => api.share(referralId, signal), {
                  ...messages,
                  success: "Shared for demonstration assignment.",
                })
                .then((result) => {
                  if (result) onChange?.();
                });
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I agree to share a demonstration reference, public service and
              pathway names, and progress dates with the project administrator
              and assigned test provider. My saved description and contact
              details stay private.
            </span>
          </label>
          <Button type="submit" disabled={busy || !consent}>
            {state.saving ? "Sharing…" : "Share for demonstration"}
          </Button>
        </form>
      )}
    </section>
  );
}

export function AssignmentForm({
  record,
  disabled,
  assign,
  loadProviders,
}: {
  record: DemoRecord;
  disabled: boolean;
  assign: (uid: string) => void;
  loadProviders: (signal: AbortSignal) => Promise<ProviderChoice[]>;
}) {
  const [uid, setUid] = useState("");
  const [opened, setOpened] = useState(false);
  const [resource] = useState(() => new ReferralResource(loadProviders));
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => {
    if (opened) return resource.start();
  }, [opened, resource]);
  const providers = state.status === "ready" ? state.value : [];
  const valid = providers.some((provider) => provider.uid === uid);
  if (!opened)
    return (
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={() => setOpened(true)}
      >
        Choose provider
      </Button>
    );
  return (
    <form
      className="demo-referral__assignment"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !disabled) assign(uid);
      }}
    >
      <label>
        <span>Select provider</span>
        <select
          aria-label="Select provider"
          value={valid ? uid : ""}
          disabled={
            disabled || state.status !== "ready" || providers.length === 0
          }
          onChange={(event) => setUid(event.target.value)}
        >
          <option value="">Select a provider…</option>
          {providers.map((provider) => (
            <option key={provider.uid} value={provider.uid}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>
      {state.status === "loading" && (
        <p role="status">Loading eligible providers…</p>
      )}
      {state.status === "error" && (
        <p role="alert">
          Providers could not be loaded. Reload providers to try again.
        </p>
      )}
      {state.status === "ready" && providers.length === 0 && (
        <p role="status">
          No active provider is available for this service. Use a development
          provider registered for this service.
        </p>
      )}
      <Button
        variant="secondary"
        disabled={disabled || state.status === "loading"}
        onClick={() => {
          setUid("");
          void resource.reload();
        }}
      >
        Reload providers
      </Button>
      <Button
        type="submit"
        disabled={disabled || !valid}
        aria-label={`Assign demonstration ${record.id.slice(0, 12)}`}
      >
        Assign provider
      </Button>
    </form>
  );
}

function ProviderStatusSummary({ referrals }: { referrals: DemoRecord[] }) {
  return (
    <section
      className="dashboard-metrics__card dashboard-metrics__card--provider"
      aria-labelledby="provider-status-title"
    >
      <h2 id="provider-status-title">Referral statuses</h2>
      <p>Assigned demonstrations on this page.</p>
      <DashboardChart
        kind="doughnut"
        points={[
          {
            label: "Assigned",
            value: referrals.filter(({ status }) => status === "assigned")
              .length,
            color: dashboardPalette.blue,
          },
          {
            label: "Under review",
            value: referrals.filter(({ status }) => status === "under-review")
              .length,
            color: dashboardPalette.amber,
          },
          {
            label: "Completed",
            value: referrals.filter(({ status }) => status === "completed")
              .length,
            color: dashboardPalette.green,
          },
        ]}
        emptyLabel="No demonstrations on this page."
      />
    </section>
  );
}

function Queue({
  uid,
  role,
  after,
}: {
  uid: string;
  role: DemoRole;
  after?: string;
}) {
  const [api] = useState(() => apiFor(uid));
  const [resource] = useState(
    () => new ReferralResource((signal) => api.list(role, after, signal)),
  );
  const state = useResource(resource);
  const ready = state.status === "ready";
  const busy = ready && (state.saving || state.needsReload);
  const reload = () => void resource.reload();
  const route = role === "admin" ? "/admin/referrals" : "/provider";
  const title = role === "admin" ? "Referral management" : "Provider dashboard";
  const referrals = ready ? state.value.referrals : [];
  const showSummary = role === "provider" && referrals.length > 0;

  function assign(record: DemoRecord, providerUid: string) {
    void resource.mutate(
      async (page, signal) => {
        await api.assign(record, providerUid, signal);
        return {
          ...page,
          referrals: page.referrals.filter((row) => row.id !== record.id),
        };
      },
      { ...messages, success: "Assigned to the development provider." },
    );
  }

  function update(record: DemoRecord, status: "under-review" | "completed") {
    void resource.mutate(async (page, signal) => {
      const confirmed = await api.progress(record, status, signal);
      return {
        ...page,
        referrals: page.referrals.map((row) =>
          row.id === confirmed.id ? confirmed : row,
        ),
      };
    }, messages);
  }

  return (
    <>
      <header className="seeker-page__heading admin-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">School demonstration</span>
          <h1>{title}</h1>
        </div>
        <Button
          variant="secondary"
          disabled={state.status === "loading" || (ready && state.saving)}
          onClick={reload}
        >
          Refresh referrals
        </Button>
      </header>
      <p>
        {role === "admin"
          ? "Assign shared demonstrations to an active development provider for the same service."
          : "Review your assigned demonstrations and record their progress."}
      </p>
      <ReferralFeedback state={state} reload={reload} />
      {showSummary && <ProviderStatusSummary referrals={referrals} />}
      <section
        id="provider-assigned-referrals"
        aria-labelledby="demo-queue-title"
      >
        <h2 id="demo-queue-title">
          {role === "admin" ? "Awaiting assignment" : "Assigned demonstrations"}
        </h2>
        {ready && state.value.referrals.length === 0 && (
          <p>No demonstrations to display on this page.</p>
        )}
        {ready && state.value.referrals.length > 0 && (
          <ul className="workspace-pages__provider-list demo-referral__queue">
            {state.value.referrals.map((record) => (
              <li key={record.id}>
                <div>
                  <h3>{record.serviceName}</h3>
                  <p>{record.pathwayTitle}</p>
                  <p>Demo reference {record.id.slice(0, 12)}</p>
                  <History record={record} />
                  {role === "admin" ? (
                    <AssignmentForm
                      record={record}
                      disabled={busy}
                      assign={(providerUid) => assign(record, providerUid)}
                      loadProviders={(signal) => api.providers(record, signal)}
                    />
                  ) : record.status === "assigned" ? (
                    <Button
                      disabled={busy}
                      onClick={() => update(record, "under-review")}
                    >
                      Start demo review
                    </Button>
                  ) : record.status === "under-review" ? (
                    <Button
                      disabled={busy}
                      onClick={() => update(record, "completed")}
                    >
                      Complete demo review
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <nav
        className="notification-persistence__pages"
        aria-label="Demonstration referral pages"
      >
        {after && (
          <Link className="btn btn-secondary" to={route}>
            First page
          </Link>
        )}
        {ready && !busy && state.value.nextCursor && (
          <Link
            className="btn btn-secondary"
            to={`${route}?after=${state.value.nextCursor}`}
          >
            Next page
          </Link>
        )}
      </nav>
    </>
  );
}

export function DemoReferralQueue({ role }: { role: DemoRole }) {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const after = params.get("after");
  if (session.status !== "ready" || session.identity.role !== role)
    return <p role="alert">Demonstration access unavailable.</p>;
  if (after !== null && !validDemoId(after))
    return (
      <>
        <h1>Demonstration referrals</h1>
        <p role="alert">This page reference is invalid.</p>
        <Link to={role === "admin" ? "/admin/referrals" : "/provider"}>
          First page
        </Link>
      </>
    );
  return (
    <Queue
      key={`${session.identity.uid}:${role}:${after ?? "first"}`}
      uid={session.identity.uid}
      role={role}
      after={after ?? undefined}
    />
  );
}
