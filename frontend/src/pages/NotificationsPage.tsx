import { ClipboardCheck, FileText, Info, Mail } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/ui/Button";
import { referralTime } from "../referrals/referralApi";
import { notificationLink, notificationTitles, validNotificationId } from "../notifications/notificationApi";
import type { NotificationQuery } from "../notifications/notificationApi";
import type { NotificationState } from "../notifications/NotificationResource";
import { useNotifications } from "../notifications/useNotifications";
import "./SeekerPages.css";
import "./AccountPages.css";

const icons = { assessment: FileText, checklist: ClipboardCheck, referral: Mail };
function pageLink(unread: boolean, after?: string) { const params = new URLSearchParams(); if (unread) params.set("unread", "true"); if (after) params.set("after", after); return `/app/notifications${params.size ? `?${params}` : ""}`; }
export function NotificationView({ state, query, refresh, markRead, filter }: { state: NotificationState; query: NotificationQuery; refresh: () => void; markRead: (ids: readonly string[]) => void; filter: (value: boolean) => void }) {
  const page = state.status === "ready" ? state.value : null;
  const saving = state.status === "ready" && state.saving;
  const unreadIds = page?.notifications.filter(row => !row.isRead).map(row => row.id) ?? [];
  return <>
    <header className="seeker-page__heading account-pages__heading"><div><span className="seeker-page__eyebrow">Updates</span><h1>Notifications</h1><p>Saved-record updates in your account.</p></div><Button variant="secondary" disabled={saving || state.status === "loading"} onClick={refresh}>{state.status === "loading" ? "Loading..." : "Refresh notifications"}</Button></header>
    <div className="seeker-page__notice"><Info size={20} aria-hidden="true"/><p>In-app project activity only. Updates appear after saves made with this feature. They do not confirm institutional delivery or review, and no email or SMS is sent. Viewing this page does not mark updates as read.</p></div>
    <section className="account-pages__notifications" aria-labelledby="all-notifications-title" aria-busy={saving || state.status === "loading"}>
      <div className="account-pages__notification-header"><h2 id="all-notifications-title">{query.unread ? "Unread notifications" : "All notifications"}</h2><Button variant="ghost" disabled={saving || !unreadIds.length} onClick={() => markRead(unreadIds)}>{saving ? "Saving read status..." : "Mark displayed as read"}</Button></div>
      <label className="account-pages__unread-filter"><input type="checkbox" checked={query.unread} disabled={saving} onChange={event => filter(event.target.checked)}/>Show unread only</label>
      <p className="notification-persistence__help">Newest saves first. The bulk button applies only to unread updates displayed on this page. Links open current saved records.</p>
      {state.status === "loading" ? <p className="notification-persistence__status" role="status">Loading notifications...</p> : state.status === "error" ? <section className="seeker-page__state" role="alert"><h3>Notification information could not be opened</h3><p>{state.message}</p><Button variant="secondary" onClick={refresh}>Reload notifications</Button></section> : <>
        {state.notice && <p className="notification-persistence__status" role="status">{state.notice}</p>}
        {page && page.notifications.length ? <ul className="account-pages__notification-list" aria-label="Account notifications">{page.notifications.map(item => { const Icon = icons[item.kind]; const title = notificationTitles[item.kind]; return <li key={item.id} className={!item.isRead ? "account-pages__notification--unread" : undefined}><Icon size={22} aria-hidden="true"/><div><h3>{title}</h3><span className="seeker-page__badge">{item.isRead ? "Read" : "Unread"}</span><p>{item.kind === "referral" ? "Your project request was saved in JusticeNav KE. It was not sent to an institution." : item.kind === "checklist" ? "Your preparation progress was saved in JusticeNav KE." : "Your assessment was saved in JusticeNav KE."}</p><time dateTime={item.createdAt}>{referralTime(item.createdAt)}</time><Link className="account-pages__record-link" to={notificationLink(item)}>View {item.kind === "referral" ? "referral" : item.kind}</Link></div>{!item.isRead && <Button variant="secondary" disabled={saving} aria-label={`Mark ${title.toLowerCase()} for ${item.recordId.slice(0,8)} from ${referralTime(item.createdAt)} as read`} onClick={() => markRead([item.id])}>Mark as read</Button>}</li>; })}</ul> : <section className="seeker-page__state"><Mail size={30} aria-hidden="true"/><h3>{query.unread ? "No unread notifications to display." : "No notifications to display."}</h3><p>{query.unread ? "Clear Show unread only to review read updates." : "New saves to assessments, checklists and project referrals create account-only updates."}</p></section>}
      </>}
    </section>
    <nav className="notification-persistence__pages" aria-label="Notification pages">{query.after && <Link className="btn btn-secondary" to={pageLink(query.unread)}>First page</Link>}{page?.nextCursor && !saving && <Link className="btn btn-secondary" to={pageLink(query.unread,page.nextCursor)}>Next page</Link>}</nav>
  </>;
}
function AccountNotifications({ uid, query }: { uid: string; query: NotificationQuery }) {
  const { state, refresh, markRead } = useNotifications(uid, query);
  const [, setParams] = useSearchParams();
  return <NotificationView state={state} query={query} refresh={refresh} markRead={markRead} filter={unread => setParams(unread ? { unread: "true" } : {})}/>;
}
export function NotificationsPage() {
  const { session } = useAuth(); const [params] = useSearchParams();
  const unread = params.get("unread"), after = params.get("after");
  if (unread !== null && unread !== "true" || after !== null && !validNotificationId(after)) return <><header className="seeker-page__heading"><h1>Notifications</h1></header><p role="alert">This notification page could not be opened.</p><Link className="btn btn-secondary" to="/app/notifications">First page</Link></>;
  return session.status === "ready" ? <AccountNotifications key={`${session.identity.uid}:${unread ?? "all"}:${after ?? "first"}`} uid={session.identity.uid} query={{ unread: unread === "true", after: after ?? undefined }}/> : <p role="status">Verify your session to view notifications.</p>;
}
