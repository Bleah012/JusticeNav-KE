import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/Button";

// Keep supplied metadata read-only in a native modal with Escape and focus restoration.
export function AdminRecordDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      // Return keyboard users to the invoking control after React unmounts the modal.
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="admin-pages__drawer"
      aria-labelledby="admin-record-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="admin-pages__drawer-head">
        <h2 id="admin-record-heading">{title}</h2>
        <button
          type="button"
          className="admin-pages__close"
          onClick={onClose}
          aria-label="Close details"
        >
          <X size={22} aria-hidden="true" />
        </button>
      </header>
      <div className="admin-operations__detail">
        {children}
        <div className="seeker-page__actions">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}
