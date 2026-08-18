import type {
  RendererErrorReportRequest,
  RendererErrorSource
} from "../../shared/contracts/app";

export function recordRendererError(
  source: RendererErrorSource,
  error: unknown,
  componentStack?: string | null
): void {
  const request = rendererErrorRequest(source, error, componentStack);
  void window.cmm.recordRendererError(request).catch(() => undefined);
}

function rendererErrorRequest(
  source: RendererErrorSource,
  error: unknown,
  componentStack?: string | null
): RendererErrorReportRequest {
  if (error instanceof Error) {
    return {
      source,
      message: limit(error.message || "Unknown renderer error.", 500),
      errorName: limit(error.name, 120),
      stack: optionalLimit(error.stack, 4000),
      componentStack: optionalLimit(componentStack ?? undefined, 4000)
    };
  }

  return {
    source,
    message: limit(String(error || "Unknown renderer error."), 500),
    componentStack: optionalLimit(componentStack ?? undefined, 4000)
  };
}

function optionalLimit(value: string | undefined, max: number): string | undefined {
  return value ? limit(value, max) : undefined;
}

function limit(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
