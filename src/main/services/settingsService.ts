import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AppSettingsSchema,
  type AppSettings
} from "../../shared/contracts/app";
import type {
  SettingsServiceContract,
  StorageServiceContract
} from "../../shared/contracts/services";

const defaultSettings: AppSettings = {
  manualGameDirectory: null,
  autoUpdatePackagedRuntime: true,
  autoValidatePackagedRuntime: false,
  suppressAppUpdatePrompt: false
};

export class JsonSettingsService implements SettingsServiceContract {
  constructor(private readonly storageService: StorageServiceContract) {}

  async getSettings(): Promise<AppSettings> {
    const settingsPath = await this.getSettingsPath();

    try {
      const raw = await readFile(settingsPath, "utf8");
      return AppSettingsSchema.parse({
        ...defaultSettings,
        ...JSON.parse(raw)
      });
    } catch {
      return defaultSettings;
    }
  }

  async setManualGameDirectory(
    gameDirectory: string | null
  ): Promise<AppSettings> {
    const trimmedDirectory = gameDirectory?.trim() || null;
    const nextSettings = AppSettingsSchema.parse({
      ...(await this.getSettings()),
      manualGameDirectory: trimmedDirectory
    });

    await this.writeSettings(nextSettings);
    return nextSettings;
  }

  async setAutoUpdatePackagedRuntime(
    enabled: boolean
  ): Promise<AppSettings> {
    const nextSettings = AppSettingsSchema.parse({
      ...(await this.getSettings()),
      autoUpdatePackagedRuntime: enabled
    });

    await this.writeSettings(nextSettings);
    return nextSettings;
  }

  async setAutoValidatePackagedRuntime(
    enabled: boolean
  ): Promise<AppSettings> {
    const nextSettings = AppSettingsSchema.parse({
      ...(await this.getSettings()),
      autoValidatePackagedRuntime: enabled
    });

    await this.writeSettings(nextSettings);
    return nextSettings;
  }

  async setSuppressAppUpdatePrompt(enabled: boolean): Promise<AppSettings> {
    const nextSettings = AppSettingsSchema.parse({
      ...(await this.getSettings()),
      suppressAppUpdatePrompt: enabled
    });

    await this.writeSettings(nextSettings);
    return nextSettings;
  }

  private async getSettingsPath(): Promise<string> {
    const layout = await this.storageService.getLayout();
    return path.join(layout.root, "settings.json");
  }

  private async writeSettings(settings: AppSettings): Promise<void> {
    const settingsPath = await this.getSettingsPath();
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  }
}
