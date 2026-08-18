import { app } from "electron";
import path from "node:path";

import type { AppStorageLayout } from "../../shared/contracts/app";
import type { StorageServiceContract } from "../../shared/contracts/services";
import { createStorageLayout, ensureStorageLayout } from "./storageLayout";

export class ElectronStorageService implements StorageServiceContract {
  async getLayout(): Promise<AppStorageLayout> {
    const layout = createStorageLayout(resolveElectronUserDataRoot());
    return ensureStorageLayout(layout);
  }
}

export function resolveElectronUserDataRoot(): string {
  const override = getAllowedUserDataOverride();

  return override ?? app.getPath("userData");
}

export function getAllowedUserDataOverride(): string | null {
  const override =
    process.env.CMM_ALLOW_USER_DATA_OVERRIDE === "1"
      ? process.env.CMM_USER_DATA_DIR?.trim()
      : "";

  return override ? path.resolve(override) : null;
}
