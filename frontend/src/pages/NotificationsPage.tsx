import { useState } from "react";
import { ClipboardCheck, FileText, Info, Mail, Trash2 } from "lucide-react";
import { AccountDataState } from "../components/AccountDataState";
import { Button } from "../components/ui/Button";
import { Link } from "react-router";
import type { AccountData, AccountNotification } from "../types/accountData";
import { referralDate as formatAccountDate } from "../types/referralData";
import "./SeekerPages.css";
import "./AccountPages.css";

const notificationIcons = {
  referral: Mail,
  checklist: ClipboardCheck,
  assessment: FileText,
  information: Info,
};

// Validate saved metadata before presenting account updates or unread indicators.
function validNotifications(items: readonly AccountNotification[]): boolean {
  return (
    new Set(items.map((item) => item.id)).size === items.length &&
    items.every(
      (item) =>
        item.id.trim() &&
        item.title.trim() &&
        item.description.trim() &&
        formatAccountDate(item.createdAt) &&
        typeof item.isRead === "boolean" &&
        Object.hasOwn(notificationIcons, item.kind) &&
        (item.referralId === null ||
          (item.kind === "referral" && Boolean(item.referralId.trim()))),
    )
  );
}

// Filtering is local; read/delete/preferences stay disabled until persistence exists.
export function NotificationsPage({
  data = { status: "unavailable" },
}: {
  data?: AccountData<readonly AccountNotification[]>;
}) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const items =
    data.status === "ready" && validNotifications(data.value)
      ? data.value
      : null;
  const visible = items?.filter((item) => !unreadOnly || !item.isRead) ?? [];

  return (
    <>
      <header className="seeker-page__heading account-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Updates</span>
          <h1>Notifications</h1>
          <p>Referral updates, reminders and important next actions.</p>
        </div>
        <Button
          variant="secondary"
          disabled
          title="Notification preferences are currently unavailable."
        >
          Notification preferences
        </Button>
      </header>
      <div className="seeker-page__notice">
        <Info size={20} aria-hidden="true" />
        <p>
          School-project updates only. A project notification does not confirm
          institutional delivery. Notification delivery, read-status changes and
          deletion are currently unavailable.
        </p>
      </div>
      <section
        className="account-pages__notifications"
        aria-labelledby="all-notifications-title"
      >
        <div className="account-pages__notification-header">
          <h2 id="all-notifications-title">All notifications</h2>
          <Button
            variant="ghost"
            disabled
            title="Saving notification read status is currently unavailable."
          >
            Mark all as read
          </Button>
        </div>
        <label className="account-pages__unread-filter">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => setUnreadOnly(event.target.checked)}
          />
          Show unread only
        </label>
        {items ? (
          visible.length ? (
            <ul
              className="account-pages__notification-list"
              aria-label="Account notifications"
            >
              {visible.map((item) => {
                const Icon = notificationIcons[item.kind];
                return (
                  <li
                    key={item.id}
                    className={
                      !item.isRead
                        ? "account-pages__notification--unread"
                        : undefined
                    }
                  >
                    <Icon size={22} aria-hidden="true" />
                    <div>
                      <h3>{item.title}</h3>
                      {!item.isRead && (
                        <span className="seeker-page__badge">Unread</span>
                      )}
                      <p>{item.description}</p>
                      <time dateTime={item.createdAt}>
                        {formatAccountDate(item.createdAt)}
                      </time>
                      {item.kind === "referral" && item.referralId && (
                        <Link
                          className="account-pages__record-link"
                          to={`/app/referrals/${encodeURIComponent(item.referralId)}`}
                        >
                          View referral
                        </Link>
                      )}
                    </div>
                    <button
                      type="button"
                      className="account-pages__delete"
                      disabled
                      aria-label={`Delete notification: ${item.title}`}
                      title="Notification deletion is currently unavailable."
                    >
                      <Trash2 size={18} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <section className="seeker-page__state">
              <Mail size={30} aria-hidden="true" />
              <h3>
                {unreadOnly
                  ? "No unread notifications to display."
                  : "No notifications to display."}
              </h3>
              <p>
                {unreadOnly
                  ? "Choose all notifications to see any other saved updates."
                  : "No notification records were returned for this account."}
              </p>
            </section>
          )
        ) : (
          <AccountDataState
            subject="Notification information"
            status={data.status === "ready" ? "error" : data.status}
            retry={data.status === "error" ? data.retry : undefined}
          />
        )}
      </section>
    </>
  );
}
