import type {
  InstalledModManifestRecord,
  LoadOrderProblem,
  LoadOrderValidation,
  Profile
} from "../../shared/contracts/app";
import { LoadOrderValidationSchema } from "../../shared/contracts/app";
import { normalizeOrderedModIds } from "./profileOrder";

type InstalledRecordByVersion = Map<string, InstalledModManifestRecord>;

export function validateLogicalLoadOrder(
  profile: Profile,
  installedRecords: InstalledModManifestRecord[]
): LoadOrderValidation {
  const recordsByModId = groupInstalledRecords(installedRecords);
  const selectedMods = Object.values(profile.selectedMods);
  const orderedModIds = normalizeOrderedModIds(
    selectedMods.map((selection) => selection.modId),
    profile.orderedModIds
  );
  const orderIndex = new Map(
    orderedModIds.map((modId, index) => [modId, index])
  );
  const problems: LoadOrderProblem[] = [];
  const enabledInstalledRecords = new Map<string, InstalledModManifestRecord>();

  for (const selection of selectedMods) {
    const record = recordsByModId.get(selection.modId)?.get(selection.version);
    if (!record) {
      problems.push({
        severity: "ERROR",
        code: "INVALID_SELECTED_VERSION",
        message: `${selection.modId} ${selection.version} is selected, but that installed package version is missing.`,
        modId: selection.modId,
        technicalDetail: `Profile ${profile.name} references ${selection.modId}@${selection.version}.`
      });
      continue;
    }

    if (selection.enabled) {
      enabledInstalledRecords.set(selection.modId, record);
    }
  }

  for (const [modId, record] of enabledInstalledRecords) {
    for (const dependency of record.manifest.dependencies) {
      if (dependency.optional) {
        continue;
      }

      const selectedDependency = profile.selectedMods[dependency.id];
      const dependencyRecord = selectedDependency
        ? recordsByModId.get(dependency.id)?.get(selectedDependency.version)
        : null;

      if (
        !selectedDependency ||
        !selectedDependency.enabled ||
        !dependencyRecord
      ) {
        problems.push({
          severity: "ERROR",
          code: "MISSING_DEPENDENCY",
          message: `${record.manifest.name} requires ${dependency.id}.`,
          modId,
          relatedModId: dependency.id,
          technicalDetail: `${modId} declares a required dependency on ${dependency.id}.`
        });
        continue;
      }

      if (
        dependency.version &&
        selectedDependency.version !== dependency.version
      ) {
        problems.push({
          severity: "ERROR",
          code: "INVALID_DEPENDENCY_VERSION",
          message: `${record.manifest.name} requires ${dependency.id} ${dependency.version}.`,
          modId,
          relatedModId: dependency.id,
          technicalDetail: `Selected version is ${selectedDependency.version}.`
        });
      }
    }

    for (const conflictId of record.manifest.conflicts) {
      if (!enabledInstalledRecords.has(conflictId)) {
        continue;
      }

      const conflictKey = [modId, conflictId].sort().join("::");
      if (
        problems.some(
          (problem) =>
            problem.code === "DECLARED_CONFLICT" &&
            [problem.modId, problem.relatedModId].sort().join("::") ===
              conflictKey
        )
      ) {
        continue;
      }

      problems.push({
        severity: "WARNING",
        code: "DECLARED_CONFLICT",
        message: `${record.manifest.name} declares a conflict with ${conflictId}.`,
        modId,
        relatedModId: conflictId
      });
    }

    for (const beforeThisModId of record.manifest.loadAfter) {
      if (!enabledInstalledRecords.has(beforeThisModId)) {
        continue;
      }

      if (
        (orderIndex.get(modId) ?? Number.MAX_SAFE_INTEGER) <
        (orderIndex.get(beforeThisModId) ?? Number.MAX_SAFE_INTEGER)
      ) {
        problems.push({
          severity: "WARNING",
          code: "LOAD_AFTER_VIOLATION",
          message: `${record.manifest.name} is marked to load after ${beforeThisModId}.`,
          modId,
          relatedModId: beforeThisModId
        });
      }
    }

    for (const afterThisModId of record.manifest.loadBefore) {
      if (!enabledInstalledRecords.has(afterThisModId)) {
        continue;
      }

      if (
        (orderIndex.get(modId) ?? Number.MAX_SAFE_INTEGER) >
        (orderIndex.get(afterThisModId) ?? Number.MAX_SAFE_INTEGER)
      ) {
        problems.push({
          severity: "WARNING",
          code: "LOAD_BEFORE_VIOLATION",
          message: `${record.manifest.name} is marked to load before ${afterThisModId}.`,
          modId,
          relatedModId: afterThisModId
        });
      }
    }
  }

  for (const cycle of findDependencyCycles(enabledInstalledRecords)) {
    problems.push({
      severity: "ERROR",
      code: "DEPENDENCY_CYCLE",
      message: `Dependency cycle detected: ${cycle.join(" -> ")}.`,
      modId: cycle[0],
      technicalDetail: cycle.join(" -> ")
    });
  }

  return LoadOrderValidationSchema.parse({
    profileId: profile.id,
    profileName: profile.name,
    orderedModIds,
    problems,
    validity: problems.some((problem) => problem.severity === "ERROR")
      ? "invalid"
      : "valid"
  });
}

function groupInstalledRecords(
  records: InstalledModManifestRecord[]
): Map<string, InstalledRecordByVersion> {
  const grouped = new Map<string, InstalledRecordByVersion>();

  for (const record of records) {
    const versionRecords = grouped.get(record.manifest.id) ?? new Map();
    versionRecords.set(record.manifest.version, record);
    grouped.set(record.manifest.id, versionRecords);
  }

  return grouped;
}

function findDependencyCycles(
  recordsByModId: Map<string, InstalledModManifestRecord>
): string[][] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (modId: string): void => {
    if (visiting.has(modId)) {
      const cycleStart = stack.indexOf(modId);
      if (cycleStart !== -1) {
        cycles.push([...stack.slice(cycleStart), modId]);
      }
      return;
    }

    if (visited.has(modId)) {
      return;
    }

    visiting.add(modId);
    stack.push(modId);

    const record = recordsByModId.get(modId);
    for (const dependency of record?.manifest.dependencies ?? []) {
      if (!dependency.optional && recordsByModId.has(dependency.id)) {
        visit(dependency.id);
      }
    }

    stack.pop();
    visiting.delete(modId);
    visited.add(modId);
  };

  for (const modId of recordsByModId.keys()) {
    visit(modId);
  }

  return dedupeCycles(cycles);
}

function dedupeCycles(cycles: string[][]): string[][] {
  const seen = new Set<string>();
  const deduped: string[][] = [];

  for (const cycle of cycles) {
    const key = [...new Set(cycle)].sort().join("::");
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(cycle);
    }
  }

  return deduped;
}
