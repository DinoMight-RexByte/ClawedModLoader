import { rm } from "node:fs/promises";

type RemoveOptions = NonNullable<Parameters<typeof rm>[1]>;

export async function rmWithRetry(
  targetPath: string,
  options: RemoveOptions,
  attempts = 10
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(targetPath, options);
      return;
    } catch (error) {
      if (attempt === attempts || !isRetryableFsError(error)) {
        throw error;
      }
      await delay(250 * attempt);
    }
  }
}

function isRetryableFsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ["EBUSY", "EPERM", "ENOTEMPTY"].includes(
      String((error as NodeJS.ErrnoException).code)
    )
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
