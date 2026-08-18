import type { ModProblem } from "../../shared/contracts/app";

export function modProblem(
  severity: ModProblem["severity"],
  code: string,
  message: string,
  technicalDetail?: string
): ModProblem {
  return {
    severity,
    code,
    message,
    ...(technicalDetail ? { technicalDetail } : {})
  };
}
