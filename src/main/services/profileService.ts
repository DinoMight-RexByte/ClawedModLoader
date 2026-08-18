import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  AcceptMissingProfileModsResultSchema,
  LoadOrderActionResultSchema,
  LoadOrderSnapshotSchema,
  ModOperationResultSchema,
  ProfileActionResultSchema,
  ProfileListSnapshotSchema,
  ProfileMissingModsSnapshotSchema,
  ProfileSchema,
  type AcceptMissingProfileModsResult,
  type CreateProfileRequest,
  type CreateProfileFromStateRequest,
  type DuplicateProfileRequest,
  type InstalledModManifestRecord,
  type InstalledModVersion,
  type LoadOrderActionResult,
  type LoadOrderProblem,
  type LoadOrderSnapshot,
  type ModOperationResult,
  type ModProblem,
  type MoveModInOrderRequest,
  type PlaceModInOrderRequest,
  type Profile,
  type ProfileActionResult,
  type ProfileIdRequest,
  type ProfileListSnapshot,
  type ProfileMissingModsSnapshot,
  type ProfileModSelection,
  type ProfileSummary,
  type RenameProfileRequest,
  type ServiceStatus,
  type SetModEnabledRequest,
  type SetModOrderPositionRequest
} from "../../shared/contracts/app";
import type {
  ModLibraryServiceContract,
  ProfileServiceContract,
  StorageServiceContract
} from "../../shared/contracts/services";
import { validateLogicalLoadOrder } from "./loadOrderRules";
import { modProblem } from "./packageProblems";
import {
  moveModId,
  normalizeOrderedModIds,
  placeModRelative,
  setModPosition
} from "./profileOrder";

const PROFILE_STORE_FILENAME = "profiles.json";
const DEFAULT_PROFILE_ID = "default";

const ProfileStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    activeProfileId: z.string().min(1),
    profiles: z.array(ProfileSchema).min(1)
  })
  .strict();

type ProfileStore = z.infer<typeof ProfileStoreSchema>;

export class LocalProfileService implements ProfileServiceContract {
  constructor(
    private readonly storageService: StorageServiceContract,
    private readonly modLibraryService: ModLibraryServiceContract
  ) {}

  getStatus(): ServiceStatus {
    return {
      id: "profileService",
      label: "Profile Service",
      status: "ready",
      detail:
        "Stores deterministic profiles with selected package versions and logical order."
    };
  }

  async getActiveProfile(): Promise<Profile> {
    return this.getActiveProfileFromStore(await this.readStore());
  }

  async getActiveProfileName(): Promise<string> {
    return (await this.getActiveProfile()).name;
  }

  async countEnabledMods(): Promise<number> {
    return Object.values((await this.getActiveProfile()).selectedMods).filter(
      (selection) => selection.enabled
    ).length;
  }

  async listProfiles(): Promise<ProfileListSnapshot> {
    const store = await this.readStore();
    return ProfileListSnapshotSchema.parse({
      activeProfileId: store.activeProfileId,
      profiles: this.toProfileSummaries(store)
    });
  }

  async createProfile(
    request: CreateProfileRequest
  ): Promise<ProfileActionResult> {
    const store = await this.readStore();
    const now = new Date().toISOString();
    const profile = this.createEmptyProfile(request.name.trim(), now);
    const nextStore = {
      ...store,
      activeProfileId: profile.id,
      profiles: [...store.profiles, profile]
    };

    await this.writeStore(nextStore);
    return this.toActionResult(nextStore, "ok", []);
  }

  async createProfileFromState(
    request: CreateProfileFromStateRequest
  ): Promise<ProfileActionResult> {
    const store = await this.readStore();
    const now = new Date().toISOString();
    const profile = ProfileSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      name: createUniqueProfileName(
        request.name.trim(),
        store.profiles.map((candidate) => candidate.name)
      ),
      createdAt: now,
      updatedAt: now,
      selectedMods: structuredClone(request.selectedMods),
      orderedModIds: normalizeOrderedModIds(
        Object.keys(request.selectedMods),
        request.orderedModIds
      ),
      preferredLaunchMode: request.preferredLaunchMode
    });
    const nextStore = {
      ...store,
      activeProfileId: profile.id,
      profiles: [...store.profiles, profile]
    };

    await this.writeStore(nextStore);
    return this.toActionResult(nextStore, "ok", []);
  }

  async duplicateProfile(
    request: DuplicateProfileRequest
  ): Promise<ProfileActionResult> {
    const store = await this.readStore();
    const sourceProfile = store.profiles.find(
      (profile) => profile.id === request.id
    );

    if (!sourceProfile) {
      return this.toActionResult(store, "notFound", [
        modProblem(
          "warning",
          "PROFILE_NOT_FOUND",
          "That profile could not be found."
        )
      ]);
    }

    const now = new Date().toISOString();
    const duplicate = ProfileSchema.parse({
      ...sourceProfile,
      id: randomUUID(),
      name: request.name?.trim() || `${sourceProfile.name} Copy`,
      createdAt: now,
      updatedAt: now,
      selectedMods: structuredClone(sourceProfile.selectedMods),
      orderedModIds: [...sourceProfile.orderedModIds]
    });
    const nextStore = {
      ...store,
      activeProfileId: duplicate.id,
      profiles: [...store.profiles, duplicate]
    };

    await this.writeStore(nextStore);
    return this.toActionResult(nextStore, "ok", []);
  }

  async renameProfile(
    request: RenameProfileRequest
  ): Promise<ProfileActionResult> {
    const store = await this.readStore();
    const nextStore = this.updateProfile(store, request.id, (profile) => ({
      ...profile,
      name: request.name.trim(),
      updatedAt: new Date().toISOString()
    }));

    if (!nextStore) {
      return this.toActionResult(store, "notFound", [
        modProblem(
          "warning",
          "PROFILE_NOT_FOUND",
          "That profile could not be found."
        )
      ]);
    }

    await this.writeStore(nextStore);
    return this.toActionResult(nextStore, "ok", []);
  }

  async deleteProfile(
    request: ProfileIdRequest
  ): Promise<ProfileActionResult> {
    const store = await this.readStore();

    if (store.profiles.length === 1) {
      return this.toActionResult(store, "blocked", [
        modProblem(
          "warning",
          "FINAL_PROFILE_DELETE_BLOCKED",
          "CMM must keep at least one profile."
        )
      ]);
    }

    if (!store.profiles.some((profile) => profile.id === request.id)) {
      return this.toActionResult(store, "notFound", [
        modProblem(
          "warning",
          "PROFILE_NOT_FOUND",
          "That profile could not be found."
        )
      ]);
    }

    const profiles = store.profiles.filter(
      (profile) => profile.id !== request.id
    );
    const activeProfileId =
      store.activeProfileId === request.id ? profiles[0].id : store.activeProfileId;
    const nextStore = {
      ...store,
      activeProfileId,
      profiles
    };

    await this.writeStore(nextStore);
    return this.toActionResult(nextStore, "ok", []);
  }

  async switchProfile(
    request: ProfileIdRequest
  ): Promise<ProfileActionResult> {
    const store = await this.readStore();

    if (!store.profiles.some((profile) => profile.id === request.id)) {
      return this.toActionResult(store, "notFound", [
        modProblem(
          "warning",
          "PROFILE_NOT_FOUND",
          "That profile could not be found."
        )
      ]);
    }

    const nextStore = {
      ...store,
      activeProfileId: request.id
    };

    await this.writeStore(nextStore);
    return this.toActionResult(nextStore, "ok", []);
  }

  async getMissingModReferences(): Promise<ProfileMissingModsSnapshot> {
    const [store, records] = await Promise.all([
      this.readStore(),
      this.modLibraryService.listInstalledModManifests()
    ]);

    return this.createMissingModsSnapshot(store, records);
  }

  async acceptMissingModReferences(): Promise<AcceptMissingProfileModsResult> {
    const [store, records] = await Promise.all([
      this.readStore(),
      this.modLibraryService.listInstalledModManifests()
    ]);
    const snapshot = this.createMissingModsSnapshot(store, records);

    if (snapshot.totalMissing === 0) {
      return AcceptMissingProfileModsResultSchema.parse({
        status: "ok",
        profilesUpdated: 0,
        removedModCount: 0,
        snapshot,
        problems: []
      });
    }

    const installedKeys = createInstalledPackageKeySet(records);
    const now = new Date().toISOString();
    let profilesUpdated = 0;
    let removedModCount = 0;
    const profiles = store.profiles.map((profile) => {
      const selectedMods = Object.fromEntries(
        Object.entries(profile.selectedMods).filter(([, selection]) => {
          const keep = installedKeys.has(
            packageKey(selection.modId, selection.version)
          );
          if (!keep) {
            removedModCount += 1;
          }
          return keep;
        })
      ) as Record<string, ProfileModSelection>;

      if (
        Object.keys(selectedMods).length ===
        Object.keys(profile.selectedMods).length
      ) {
        return profile;
      }

      profilesUpdated += 1;
      return ProfileSchema.parse({
        ...profile,
        selectedMods,
        orderedModIds: normalizeOrderedModIds(
          Object.keys(selectedMods),
          profile.orderedModIds
        ),
        updatedAt: now
      });
    });
    const nextStore = ProfileStoreSchema.parse({
      ...store,
      profiles
    });

    await this.writeStore(nextStore);
    return AcceptMissingProfileModsResultSchema.parse({
      status: "ok",
      profilesUpdated,
      removedModCount,
      snapshot: this.createMissingModsSnapshot(nextStore, records),
      problems: []
    });
  }

  async listInstalledModsForActiveProfile() {
    const [profile, records] = await Promise.all([
      this.getActiveProfile(),
      this.modLibraryService.listInstalledModManifests()
    ]);
    const validation = validateLogicalLoadOrder(profile, records);
    const problemMap = mapLoadOrderProblemsByModId(validation.problems);
    const mods = records.map((record) =>
      this.toProfileScopedMod(record, profile, problemMap.get(record.mod.id) ?? [])
    );

    return {
      mods,
      totals: {
        installed: mods.length,
        enabled: mods.filter((mod) => mod.enabled).length,
        disabled: mods.filter((mod) => !mod.enabled).length,
        problems: mods.reduce((sum, mod) => sum + mod.problems.length, 0)
      }
    };
  }

  async setModEnabled(
    request: SetModEnabledRequest
  ): Promise<ModOperationResult> {
    const records = await this.modLibraryService.listInstalledModManifests();
    const record = records.find(
      (installedRecord) =>
        installedRecord.manifest.id === request.id &&
        installedRecord.manifest.version === request.version
    );

    if (!record) {
      return {
        status: "notFound",
        mod: null,
        problems: [
          modProblem(
            "warning",
            "MOD_NOT_FOUND",
            "That installed mod version could not be found."
          )
        ]
      };
    }

    const store = await this.readStore();
    const activeProfile = this.getActiveProfileFromStore(store);
    const existingSelection = activeProfile.selectedMods[request.id];
    const selectedMods = { ...activeProfile.selectedMods };

    if (request.enabled || existingSelection) {
      selectedMods[request.id] = {
        modId: request.id,
        version: request.version,
        enabled: request.enabled,
        config: existingSelection?.config ?? {}
      };
    }

    const selectedModIds = Object.keys(selectedMods);
    const orderedModIds = normalizeOrderedModIds(
      selectedModIds,
      [...activeProfile.orderedModIds, request.id]
    );
    const updatedProfile = ProfileSchema.parse({
      ...activeProfile,
      selectedMods,
      orderedModIds,
      updatedAt: new Date().toISOString()
    });
    const nextStore = replaceProfile(store, updatedProfile);

    await this.writeStore(nextStore);

    const validation = validateLogicalLoadOrder(updatedProfile, records);
    const problemMap = mapLoadOrderProblemsByModId(validation.problems);
    return ModOperationResultSchema.parse({
      status: "ok",
      mod: this.toProfileScopedMod(
        record,
        updatedProfile,
        problemMap.get(record.mod.id) ?? []
      ),
      problems: []
    });
  }

  async moveModInActiveOrder(
    request: MoveModInOrderRequest
  ): Promise<LoadOrderActionResult> {
    return this.updateActiveOrder(request.modId, (order) =>
      moveModId(order, request.modId, request.direction)
    );
  }

  async setModActiveOrderPosition(
    request: SetModOrderPositionRequest
  ): Promise<LoadOrderActionResult> {
    return this.updateActiveOrder(request.modId, (order) =>
      setModPosition(order, request.modId, request.position)
    );
  }

  async placeModInActiveOrder(
    request: PlaceModInOrderRequest
  ): Promise<LoadOrderActionResult> {
    return this.updateActiveOrder(request.modId, (order) =>
      placeModRelative(
        order,
        request.modId,
        request.targetModId,
        request.placement
      )
    );
  }

  async getLoadOrderSnapshot(): Promise<LoadOrderSnapshot> {
    const [profile, records] = await Promise.all([
      this.getActiveProfile(),
      this.modLibraryService.listInstalledModManifests()
    ]);

    return this.createLoadOrderSnapshot(profile, records);
  }

  private async updateActiveOrder(
    modId: string,
    updateOrder: (orderedModIds: string[]) => string[]
  ): Promise<LoadOrderActionResult> {
    const store = await this.readStore();
    const activeProfile = this.getActiveProfileFromStore(store);
    const selectedModIds = Object.keys(activeProfile.selectedMods);

    if (!selectedModIds.includes(modId)) {
      return LoadOrderActionResultSchema.parse({
        status: "notFound",
        snapshot: await this.getLoadOrderSnapshot(),
        problems: [
          modProblem(
            "warning",
            "MOD_NOT_SELECTED",
            "That mod is not selected in the active profile."
          )
        ]
      });
    }

    const orderedModIds = updateOrder(
      normalizeOrderedModIds(selectedModIds, activeProfile.orderedModIds)
    );
    const updatedProfile = ProfileSchema.parse({
      ...activeProfile,
      orderedModIds,
      updatedAt: new Date().toISOString()
    });
    const nextStore = replaceProfile(store, updatedProfile);

    await this.writeStore(nextStore);
    return LoadOrderActionResultSchema.parse({
      status: "ok",
      snapshot: await this.getLoadOrderSnapshot(),
      problems: []
    });
  }

  private createLoadOrderSnapshot(
    profile: Profile,
    records: InstalledModManifestRecord[]
  ): LoadOrderSnapshot {
    const validation = validateLogicalLoadOrder(profile, records);
    const problemMap = mapLoadOrderProblemsByModId(validation.problems);
    const entries = validation.orderedModIds.flatMap((modId, index) => {
      const selection = profile.selectedMods[modId];
      const record = records.find(
        (installedRecord) =>
          installedRecord.manifest.id === modId &&
          installedRecord.manifest.version === selection?.version
      );

      if (!selection || !record) {
        return [];
      }

      const problems = problemMap.get(modId) ?? [];
      return [
        {
          position: index + 1,
          mod: this.toProfileScopedMod(record, profile, problems),
          selectedVersion: selection.version,
          enabled: selection.enabled,
          problems
        }
      ];
    });

    return LoadOrderSnapshotSchema.parse({
      activeProfile: {
        ...profile,
        orderedModIds: validation.orderedModIds
      },
      entries,
      validation
    });
  }

  private toProfileScopedMod(
    record: InstalledModManifestRecord,
    profile: Profile,
    loadOrderProblems: LoadOrderProblem[]
  ): InstalledModVersion {
    const selection = profile.selectedMods[record.manifest.id];
    const enabled =
      selection?.version === record.manifest.version && selection.enabled;
    const mappedProblems = loadOrderProblems.map(toModProblem);
    const problems = [...record.mod.problems, ...mappedProblems];
    const status = problems.some((problem) => problem.severity === "error")
      ? "error"
      : problems.some((problem) => problem.severity === "warning")
        ? "warning"
        : record.mod.status;

    return {
      ...record.mod,
      enabled: Boolean(enabled),
      status,
      problems
    };
  }

  private async readStore(): Promise<ProfileStore> {
    const storePath = await this.getProfileStorePath();

    try {
      const store = ProfileStoreSchema.parse(
        JSON.parse(await readFile(storePath, "utf8"))
      );
      return this.normalizeStore(store);
    } catch {
      const defaultStore = createDefaultStore();
      await this.writeStore(defaultStore);
      return defaultStore;
    }
  }

  private async writeStore(store: ProfileStore): Promise<void> {
    const normalizedStore = this.normalizeStore(ProfileStoreSchema.parse(store));
    await atomicWriteJson(await this.getProfileStorePath(), normalizedStore);
  }

  private normalizeStore(store: ProfileStore): ProfileStore {
    const profiles = store.profiles.map((profile) =>
      ProfileSchema.parse({
        ...profile,
        orderedModIds: normalizeOrderedModIds(
          Object.keys(profile.selectedMods),
          profile.orderedModIds
        )
      })
    );
    const activeProfileId = profiles.some(
      (profile) => profile.id === store.activeProfileId
    )
      ? store.activeProfileId
      : profiles[0].id;

    return ProfileStoreSchema.parse({
      ...store,
      activeProfileId,
      profiles
    });
  }

  private async getProfileStorePath(): Promise<string> {
    const layout = await this.storageService.getLayout();
    return path.join(layout.directories.profiles, PROFILE_STORE_FILENAME);
  }

  private createEmptyProfile(name: string, now: string): Profile {
    return ProfileSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      selectedMods: {},
      orderedModIds: [],
      preferredLaunchMode: "VANILLA"
    });
  }

  private getActiveProfileFromStore(store: ProfileStore): Profile {
    return (
      store.profiles.find((profile) => profile.id === store.activeProfileId) ??
      store.profiles[0]
    );
  }

  private toActionResult(
    store: ProfileStore,
    status: ProfileActionResult["status"],
    problems: ModProblem[]
  ): ProfileActionResult {
    return ProfileActionResultSchema.parse({
      status,
      activeProfile: this.getActiveProfileFromStore(store),
      profiles: this.toProfileSummaries(store),
      problems
    });
  }

  private toProfileSummaries(store: ProfileStore): ProfileSummary[] {
    return store.profiles.map((profile) => {
      const selections = Object.values(profile.selectedMods);
      return {
        id: profile.id,
        name: profile.name,
        modCount: selections.length,
        enabledCount: selections.filter((selection) => selection.enabled).length,
        preferredLaunchMode: profile.preferredLaunchMode,
        isActive: profile.id === store.activeProfileId,
        updatedAt: profile.updatedAt
      };
    });
  }

  private createMissingModsSnapshot(
    store: ProfileStore,
    records: InstalledModManifestRecord[]
  ): ProfileMissingModsSnapshot {
    const installedKeys = createInstalledPackageKeySet(records);
    const profiles = store.profiles.flatMap((profile) => {
      const missingMods = Object.values(profile.selectedMods)
        .filter(
          (selection) =>
            !installedKeys.has(packageKey(selection.modId, selection.version))
        )
        .map((selection) => ({
          id: selection.modId,
          version: selection.version,
          enabled: selection.enabled
        }));

      return missingMods.length
        ? [
            {
              profileId: profile.id,
              profileName: profile.name,
              missingMods
            }
          ]
        : [];
    });

    return ProfileMissingModsSnapshotSchema.parse({
      profiles,
      totalMissing: profiles.reduce(
        (total, profile) => total + profile.missingMods.length,
        0
      ),
      generatedAt: new Date().toISOString()
    });
  }

  private updateProfile(
    store: ProfileStore,
    profileId: string,
    update: (profile: Profile) => Profile
  ): ProfileStore | null {
    if (!store.profiles.some((profile) => profile.id === profileId)) {
      return null;
    }

    return ProfileStoreSchema.parse({
      ...store,
      profiles: store.profiles.map((profile) =>
        profile.id === profileId ? update(profile) : profile
      )
    });
  }
}

export class LocalLoadOrderService {
  constructor(private readonly profileService: ProfileServiceContract) {}

  getStatus(): ServiceStatus {
    return {
      id: "loadOrderService",
      label: "Load Order Service",
      status: "ready",
      detail:
        "Validates logical profile ordering without translating to Unreal runtime order."
    };
  }

  async validateActiveOrder() {
    return (await this.profileService.getLoadOrderSnapshot()).validation;
  }

  async getSnapshot() {
    return this.profileService.getLoadOrderSnapshot();
  }
}

export async function atomicWriteJson(
  destinationPath: string,
  value: unknown
): Promise<void> {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}.${randomUUID()}.tmp`
  );
  const handle = await open(temporaryPath, "w");

  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await handle.close();
  }

  await renameFileWithRetry(temporaryPath, destinationPath);
}

async function renameFileWithRetry(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  const maxAttempts = 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rename(sourcePath, targetPath);
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isTransientRenameError(error)) {
        throw error;
      }
      await sleep(attempt * 150);
    }
  }
}

function isTransientRenameError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return ["EPERM", "EACCES", "EBUSY"].includes(
    String((error as { code?: unknown }).code)
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createDefaultStore(): ProfileStore {
  const now = new Date().toISOString();
  return ProfileStoreSchema.parse({
    schemaVersion: 1,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [
      {
        schemaVersion: 1,
        id: DEFAULT_PROFILE_ID,
        name: "Default",
        createdAt: now,
        updatedAt: now,
        selectedMods: {},
        orderedModIds: [],
        preferredLaunchMode: "VANILLA"
      }
    ]
  });
}

function replaceProfile(store: ProfileStore, profile: Profile): ProfileStore {
  return ProfileStoreSchema.parse({
    ...store,
    profiles: store.profiles.map((candidate) =>
      candidate.id === profile.id ? profile : candidate
    )
  });
}

function createUniqueProfileName(
  requestedName: string,
  existingNames: string[]
): string {
  const existing = new Set(existingNames.map((name) => name.toLowerCase()));
  if (!existing.has(requestedName.toLowerCase())) {
    return requestedName;
  }

  const importedName = `${requestedName} (Imported)`;
  if (!existing.has(importedName.toLowerCase())) {
    return importedName;
  }

  let suffix = 2;
  while (existing.has(`${requestedName} (Imported ${suffix})`.toLowerCase())) {
    suffix += 1;
  }

  return `${requestedName} (Imported ${suffix})`;
}

function mapLoadOrderProblemsByModId(
  problems: LoadOrderProblem[]
): Map<string, LoadOrderProblem[]> {
  const map = new Map<string, LoadOrderProblem[]>();

  for (const problem of problems) {
    addProblem(map, problem.modId, problem);
    addProblem(map, problem.relatedModId, problem);
  }

  return map;
}

function addProblem(
  map: Map<string, LoadOrderProblem[]>,
  modId: string | undefined,
  problem: LoadOrderProblem
): void {
  if (!modId) {
    return;
  }

  map.set(modId, [...(map.get(modId) ?? []), problem]);
}

function toModProblem(problem: LoadOrderProblem): ModProblem {
  return {
    severity: problem.severity === "ERROR" ? "error" : "warning",
    code: problem.code,
    message: problem.message,
    technicalDetail: problem.technicalDetail
  };
}

function createInstalledPackageKeySet(
  records: InstalledModManifestRecord[]
): Set<string> {
  return new Set(
    records.map((record) =>
      packageKey(record.manifest.id, record.manifest.version)
    )
  );
}

function packageKey(id: string, version: string): string {
  return `${id}\0${version}`;
}
