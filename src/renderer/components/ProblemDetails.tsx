import type { ReactElement } from "react";

import type { LoadOrderProblem, ModProblem } from "../../shared/contracts/app";

type Problem = ModProblem | LoadOrderProblem;

function getSeverity(problem: Problem): "info" | "warning" | "error" {
  const severity = problem.severity.toLowerCase();
  if (severity === "error") {
    return "error";
  }
  if (severity === "warning") {
    return "warning";
  }

  return "info";
}

function problemClass(problem: Problem): string {
  const severity = getSeverity(problem);
  if (severity === "error") {
    return "border-app-danger/40 bg-app-danger/10";
  }
  if (severity === "warning") {
    return "border-app-warning/40 bg-app-warning/10";
  }

  return "border-app-border bg-app-surfaceRaised";
}

function problemTextClass(problem: Problem): string {
  const severity = getSeverity(problem);
  if (severity === "error") {
    return "text-app-danger";
  }
  if (severity === "warning") {
    return "text-app-warning";
  }

  return "text-app-text";
}

function problemMetaClass(problem: Problem): string {
  return getSeverity(problem) === "error" ? "text-app-danger" : "text-app-muted";
}

export function ProblemDetails({
  problems,
  emptyMessage = "No problems reported."
}: {
  problems: Problem[];
  emptyMessage?: string;
}): ReactElement {
  if (problems.length === 0) {
    return <p className="text-sm text-app-muted">{emptyMessage}</p>;
  }

  return (
    <div className="grid gap-2">
      {problems.map((problem) => (
        <details
          className={`rounded-md border p-3 text-sm ${problemClass(problem)}`}
          key={`${problem.code}-${problem.message}`}
        >
          <summary className="cursor-pointer list-none break-words">
            <span className={`block font-medium ${problemTextClass(problem)}`}>
              {problem.message}
            </span>
            <span className={`mt-1 block text-xs uppercase ${problemMetaClass(problem)}`}>
              {problem.code}
            </span>
          </summary>
          <div className={`mt-2 ${problemMetaClass(problem)}`}>
            Severity: {problem.severity}
          </div>
          {problem.technicalDetail ? (
            <pre className={`mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-app-surface p-2 text-xs ${problemMetaClass(problem)}`}>
              {problem.technicalDetail}
            </pre>
          ) : null}
        </details>
      ))}
    </div>
  );
}
