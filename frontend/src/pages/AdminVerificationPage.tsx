import { useState } from "react";
import { Info, Search, ShieldCheck } from "lucide-react";
import { AdminOperationsTable } from "../components/AdminOperationsTable";
import type { AdminColumn } from "../components/AdminOperationsTable";
import { AdminRecordDialog } from "../components/AdminRecordDialog";
import { Button } from "../components/ui/Button";
import {
  formatAdminDate,
  isAdminSourceUrl,
  publicationLabels,
  verificationLabels,
} from "../types/adminData";
import type { AdminData } from "../types/adminData";
import { validVerificationQueue } from "../types/adminOperationsData";
import type { VerificationQueueItem } from "../types/adminOperationsData";
import "./AdminOperations.css";

// Review supplied public-source metadata without changing a verification record.
export function AdminVerificationPage({
  data = { status: "unavailable" },
}: {
  data?: AdminData<readonly VerificationQueueItem[]>;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("due");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const records =
    data.status === "ready" && validVerificationQueue(data.value)
      ? data.value
      : null;
  const needle = query.trim().toLocaleLowerCase();
  const filtered = records
    ? records
        .filter(
          (item) =>
            (!needle || item.title.toLocaleLowerCase().includes(needle)) &&
            (kind === "all" || item.kind === kind) &&
            (status === "all" || item.verification === status),
        )
        .sort((a, b) => {
          const first = sort === "due" ? a.reviewDueOn : a.verifiedOn;
          const second = sort === "due" ? b.reviewDueOn : b.verifiedOn;
          if (!first) return second ? 1 : a.title.localeCompare(b.title);
          if (!second) return -1;
          return sort === "due"
            ? first.localeCompare(second)
            : second.localeCompare(first);
        })
    : null;
  const selected =
    records?.find((item) => `${item.kind}:${item.id}` === selectedKey) ?? null;
  const columns: AdminColumn<VerificationQueueItem>[] = [
    { key: "title", label: "Information", render: (item) => item.title },
    {
      key: "kind",
      label: "Type",
      render: (item) => (item.kind === "service" ? "Service" : "Pathway"),
    },
    {
      key: "publication",
      label: "Publication",
      render: (item) => publicationLabels[item.publication],
    },
    {
      key: "verification",
      label: "Verification",
      render: (item) => (
        <span className="seeker-page__badge">
          {verificationLabels[item.verification]}
        </span>
      ),
    },
    {
      key: "checked",
      label: "Last verified",
      render: (item) => formatAdminDate(item.verifiedOn) || "Not verified",
    },
    {
      key: "due",
      label: "Review due",
      render: (item) => formatAdminDate(item.reviewDueOn) || "Not recorded",
    },
    {
      key: "actions",
      label: "Actions",
      render: (item) => (
        <div className="admin-pages__row-actions">
          <Button
            variant="ghost"
            onClick={() => setSelectedKey(`${item.kind}:${item.id}`)}
          >
            Review
          </Button>
          <Button
            variant="ghost"
            disabled
            title="Verification changes are currently unavailable."
          >
            Verify
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <header className="seeker-page__heading admin-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Administration</span>
          <h1>Content verification</h1>
          <p>Review official sources and maintain verification records.</p>
        </div>
      </header>
      <div className="seeker-page__notice">
        <Info size={20} aria-hidden="true" />
        <p>
          Verification changes are currently unavailable. Opening a source link
          does not verify its contents. No information is marked verified by
          this page.
        </p>
      </div>
      <section
        className="admin-operations__summary"
        aria-label="Verification summary"
      >
        {Object.entries(verificationLabels).map(([value, label]) => (
          <article key={value}>
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <h2>{label}</h2>
              <strong>
                {records
                  ? records.filter((item) => item.verification === value).length
                  : "Unavailable"}
              </strong>
            </div>
          </article>
        ))}
      </section>
      <form
        className="admin-pages__toolbar"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <label
          className="admin-pages__search"
          htmlFor="admin-verification-search"
        >
          <Search size={18} aria-hidden="true" />
          <span className="admin-pages__sr-only">Search information</span>
          <input
            id="admin-verification-search"
            type="search"
            maxLength={200}
            autoComplete="off"
            placeholder="Search information…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Type</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="all">All types</option>
            <option value="service">Services</option>
            <option value="pathway">Pathways</option>
          </select>
        </label>
        <label>
          <span>Verification</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All verification states</option>
            {Object.entries(verificationLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Sort by</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="due">Earliest review date</option>
            <option value="checked">Last verified</option>
          </select>
        </label>
      </form>
      <AdminOperationsTable
        key={JSON.stringify([query, kind, status, sort])}
        title="Content verification"
        subject="Verification information"
        records={filtered}
        status={data.status}
        retry={data.status === "error" ? data.retry : undefined}
        columns={columns}
        rowKey={(item) => `${item.kind}:${item.id}`}
        emptyTitle={
          records?.length
            ? "No information matches these filters."
            : "No verification records to display."
        }
      />
      {selected && (
        <AdminRecordDialog
          title="Verification record"
          onClose={() => setSelectedKey(null)}
        >
          <dl className="seeker-page__details">
            <div>
              <dt>Information</dt>
              <dd>{selected.title}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{selected.kind === "service" ? "Service" : "Pathway"}</dd>
            </div>
            <div>
              <dt>Publication</dt>
              <dd>{publicationLabels[selected.publication]}</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>{verificationLabels[selected.verification]}</dd>
            </div>
            <div>
              <dt>Official source URL</dt>
              <dd>
                {isAdminSourceUrl(selected.sourceUrl) ? (
                  <a
                    className="admin-pages__source"
                    href={selected.sourceUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open official source
                  </a>
                ) : (
                  "Source unavailable"
                )}
              </dd>
            </div>
            <div>
              <dt>Last verified</dt>
              <dd>{formatAdminDate(selected.verifiedOn) || "Not verified"}</dd>
            </div>
            <div>
              <dt>Review due</dt>
              <dd>{formatAdminDate(selected.reviewDueOn) || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Internal verification note</dt>
              <dd className="admin-operations__multiline">
                {selected.reviewNote || "No review note is available."}
              </dd>
            </div>
          </dl>
          <p className="admin-operations__note">
            Only mark information verified after checking an official source.
            Saving a review and marking information verified are currently
            unavailable.
          </p>
          <div className="admin-operations__disabled-actions">
            <Button variant="secondary" disabled>
              Save review
            </Button>
            <Button disabled>Mark verified</Button>
          </div>
        </AdminRecordDialog>
      )}
    </>
  );
}
