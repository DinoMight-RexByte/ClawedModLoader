import { CheckCircle2, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import type {
  ModProblem,
  RuntimeSnapshot,
  ValidatePackagedRuntimeResult
} from "../../shared/contracts/app";
import { ProblemDetails } from "./ProblemDetails";

function canValidatePackagedRuntime(runtime: RuntimeSnapshot | null): boolean {
  return (
    runtime?.ue4ss?.source === "bundled" &&
    (runtime.status === "unvalidated" || runtime.status === "incompatible")
  );
}

function resultMessage(result: ValidatePackagedRuntimeResult): string {
  if (result.status === "validated") {
    return "Runtime validated for this Clawed build.";
  }
  if (result.status === "cancelled") {
    return "Runtime validation cancelled.";
  }
  return result.problems[0]?.message ?? "Runtime validation did not complete.";
}

export function PackagedRuntimeValidationAction({
  disabled,
  onBusyChange,
  onRuntimeChanged,
  runtime
}: {
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onRuntimeChanged: (runtime: RuntimeSnapshot | null) => void;
  runtime: RuntimeSnapshot | null;
}): ReactElement | null {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<ModProblem[]>([]);
  const canValidate = canValidatePackagedRuntime(runtime);

  if (!canValidate && !message && problems.length === 0) {
    return null;
  }

  const validate = async (): Promise<void> => {
    setBusy(true);
    onBusyChange?.(true);
    setMessage(null);
    setProblems([]);
    try {
      const result = await window.cmm.validatePackagedRuntime();
      const nextRuntime = await window.cmm
        .getRuntimeSnapshot()
        .catch((): RuntimeSnapshot | null => null);
      if (nextRuntime) {
        onRuntimeChanged(nextRuntime);
      }
      setMessage(resultMessage(result));
      setProblems(result.problems);
    } catch (error) {
      setMessage(null);
      setProblems([
        {
          severity: "error",
          code: "RUNTIME_VALIDATION_FAILED",
          message: "CMM could not validate the packaged runtime.",
          technicalDetail: error instanceof Error ? error.message : String(error)
        }
      ]);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return (
    <div className="mt-4 grid gap-3 rounded-md border border-app-border bg-app-surface p-3">
      {canValidate ? (
        <button
          className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
          disabled={disabled || busy}
          onClick={() => void validate()}
          type="button"
        >
          {busy ? (
            <RefreshCw
              aria-hidden="true"
              className="motion-safe:animate-spin"
              size={17}
            />
          ) : (
            <CheckCircle2 aria-hidden="true" size={17} />
          )}
          {busy ? "Validating" : "Validate Packaged Runtime"}
        </button>
      ) : null}
      {message ? (
        <div className="text-sm font-medium text-app-text" role="status">
          {message}
        </div>
      ) : null}
      {problems.length ? <ProblemDetails problems={problems} /> : null}
    </div>
  );
}
