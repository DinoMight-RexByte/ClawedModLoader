import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import { useEffect, useRef } from "react";

const focusableSelector = [
  "button:not([disabled])",
  "select:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function ModalDialog({
  title,
  description,
  children,
  labelledById,
  describedById
}: {
  title: string;
  description?: string;
  children: ReactNode;
  labelledById: string;
  describedById?: string;
}): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusable = dialog.querySelector<HTMLElement>(focusableSelector);
    (focusable ?? dialog).focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Tab") {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(focusableSelector)
    );

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app-backdrop/60 p-4">
      <div
        aria-describedby={describedById}
        aria-labelledby={labelledById}
        aria-modal="true"
        className="max-h-[min(680px,calc(100vh-32px))] w-full max-w-4xl overflow-auto rounded-lg border border-app-border bg-app-surface p-5 shadow-panel focus:outline-none"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <h2 className="text-2xl font-semibold" id={labelledById}>
            {title}
          </h2>
          {description ? (
            <p className="mt-2 text-sm text-app-muted" id={describedById}>
              {description}
            </p>
          ) : null}
        </header>
        {children}
      </div>
    </div>
  );
}
