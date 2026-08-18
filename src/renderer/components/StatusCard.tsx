import type { ReactElement, ReactNode } from "react";

export function StatusCard({
  label,
  value,
  detail,
  tone = "neutral",
  icon
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  icon?: ReactNode;
}): ReactElement {
  const toneClass = {
    neutral: "text-app-muted",
    success: "text-app-success",
    warning: "text-app-warning",
    danger: "text-app-danger"
  }[tone];

  return (
    <section className="rounded-lg border border-app-border bg-app-surface p-4 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium uppercase text-app-muted">
          {label}
        </div>
        {icon ? <div className={toneClass}>{icon}</div> : null}
      </div>
      <div className="mt-3 break-words text-2xl font-semibold leading-tight">
        {value}
      </div>
      {detail ? (
        <div className={`mt-2 break-words text-sm leading-5 ${toneClass}`}>
          {detail}
        </div>
      ) : null}
    </section>
  );
}
