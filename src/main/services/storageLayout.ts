import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  AppStorageLayoutSchema,
  type AppStorageLayout
} from "../../shared/contracts/app";

export function createStorageLayout(root: string): AppStorageLayout {
  return AppStorageLayoutSchema.parse({
    root,
    directories: {
      libraryMods: path.join(root, "library", "mods"),
      profiles: path.join(root, "profiles"),
      staging: path.join(root, "staging"),
      runtime: path.join(root, "runtime"),
      backups: path.join(root, "backups"),
      logs: path.join(root, "logs")
    }
  });
}

export async function ensureStorageLayout(
  layout: AppStorageLayout
): Promise<AppStorageLayout> {
  await Promise.all(
    Object.values(layout.directories).map((directory) =>
      mkdir(directory, { recursive: true })
    )
  );

  return layout;
}
