/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, type Page, test } from "@playwright/test";

const responsiveViewports = [
  { name: "minimum", width: 960, height: 640 },
  { name: "default", width: 1280, height: 750 },
  { name: "large", width: 1440, height: 900 }
] as const;

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const scrollWidth = Math.max(
      document.body.scrollWidth,
      document.documentElement.scrollWidth
    );

    return {
      scrollWidth,
      viewportWidth: window.innerWidth
    };
  });

  expect(
    metrics.scrollWidth,
    `document width ${metrics.scrollWidth}px exceeded viewport ${metrics.viewportWidth}px`
  ).toBeLessThanOrEqual(metrics.viewportWidth + 2);
}

async function expectModelViewportRendered(page: Page): Promise<void> {
  const viewport = page.getByTestId("creator-model-viewport");
  await expect(viewport).toBeVisible();
  await expect(page.getByText("Model preview available")).toBeVisible();
  expect((await viewport.screenshot()).length).toBeGreaterThan(1000);
  const canvas = page.getByLabel("Model preview");
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () =>
      canvas.evaluate((node) => {
        const canvasElement = node as HTMLCanvasElement;
        const gl =
          canvasElement.getContext("webgl2") ??
          canvasElement.getContext("webgl");
        if (!gl || canvasElement.width === 0 || canvasElement.height === 0) {
          return 0;
        }

        const pixels = new Uint8Array(
          canvasElement.width * canvasElement.height * 4
        );
        gl.readPixels(
          0,
          0,
          canvasElement.width,
          canvasElement.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels
        );

        let nonZero = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (
            pixels[index] !== 0 ||
            pixels[index + 1] !== 0 ||
            pixels[index + 2] !== 0 ||
            pixels[index + 3] !== 0
          ) {
            nonZero += 1;
          }
        }
        return nonZero;
      })
    )
    .toBeGreaterThan(0);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();

    const now = "2026-08-11T12:00:00.000Z";
    const problem = {
      severity: "warning",
      code: "UNVALIDATED_RUNTIME_ORDER",
      message: "Effective Clawed runtime loading order is unvalidated.",
      technicalDetail: "Fake E2E detail."
    };
    const discovery = {
      appId: "3394840",
      steamPath: "C:\\Steam",
      steamLibrary: "C:\\SteamLibrary",
      steamLibraries: [
        {
          path: "C:\\SteamLibrary",
          appManifestPath:
            "C:\\SteamLibrary\\steamapps\\appmanifest_3394840.acf"
        }
      ],
      appManifestPath: "C:\\SteamLibrary\\steamapps\\appmanifest_3394840.acf",
      gameInstallPath: "C:\\SteamLibrary\\steamapps\\common\\Clawed",
      gameExecutable:
        "C:\\SteamLibrary\\steamapps\\common\\Clawed\\Clawed\\Binaries\\Win64\\Clawed-Win64-Shipping.exe",
      discoveryStatus: "READY",
      source: "steam",
      manualOverride: null,
      diagnosticErrors: [],
      discoveredAt: now
    };
    let runtime: any = {
      ue4ss: null,
      status: "missing",
      problems: []
    };
    const bundledRuntime = {
      ue4ss: {
        version: "ue4ss-experimental-latest-1c1a1497",
        installPath:
          "C:\\CMM\\runtime\\ue4ss\\ue4ss-experimental-latest-1c1a1497",
        importedAt: now,
        sourceSha256: "1".repeat(64),
        source: "bundled",
        releaseValidation: "VALIDATED"
      },
      status: "configured",
      problems: []
    };
    const profileDefault = {
      id: "profile-default",
      name: "Default",
      modCount: 2,
      enabledCount: 1,
      preferredLaunchMode: "MODDED",
      isActive: true,
      updatedAt: now
    };
    const profileRaid = {
      id: "profile-raid",
      name: "Raid Night",
      modCount: 2,
      enabledCount: 2,
      preferredLaunchMode: "MODDED",
      isActive: false,
      updatedAt: now
    };
    const manifest = {
      schemaVersion: 1,
      id: "core-framework",
      name: "Core Framework",
      version: "1.0.0",
      author: "CMM Fixtures",
      description: "Fake fixture package.",
      game: "clawed",
      loader: "ue4ss",
      dependencies: [],
      conflicts: [],
      loadAfter: [],
      loadBefore: []
    };
    const creatorModelPreview = {
      id: "female-a-skeletal-preview",
      payloadPath: "payload/previews/female-a-preview.obj",
      kind: "model",
      assetClass: "SkeletalMesh",
      objectPath: "/Game/UtahRaptor/Textures/T_Utah_Claws_D.T_Utah_Claws_D",
      source: "userOwned",
      format: "obj",
      modelRole: "skeletalMesh",
      skeleton: "/Game/UtahRaptor/Meshes/SKEL_Utah.SKEL_Utah",
      physicsAsset: "/Game/UtahRaptor/Meshes/PHYS_Utah.PHYS_Utah",
      materialSlots: [
        {
          name: "Body",
          materialPath: "/Game/UtahRaptor/Materials/M_Utah_Body.M_Utah_Body"
        },
        {
          name: "Claws",
          materialPath: "/Game/UtahRaptor/Materials/M_Utah_Claws.M_Utah_Claws"
        }
      ],
      lods: [
        {
          index: 0,
          screenSize: 1,
          triangleCount: 1200,
          vertexCount: 700
        }
      ],
      dependencyPaths: [
        "/Game/UtahRaptor/Materials/M_Utah_Body.M_Utah_Body",
        "/Game/UtahRaptor/Materials/M_Utah_Claws.M_Utah_Claws"
      ]
    };
    const creatorModelDataUrl = `data:text/plain;base64,${btoa(
      [
        "o PreviewTriangle",
        "v 0 0.8 0",
        "v -0.8 -0.8 0",
        "v 0.8 -0.8 0",
        "f 1 2 3"
      ].join("\n")
    )}`;
    const femaleManifest = {
      schemaVersion: 1,
      id: "female-a",
      name: "Female Character A",
      version: "1.0.0",
      author: "CMM Fixtures",
      description: "Fake character fixture.",
      game: "clawed",
      loader: "pak",
      dependencies: [],
      conflicts: [],
      loadAfter: [],
      loadBefore: [],
      creatorAssets: {
        schemaVersion: 1,
        affectedAssets: [
          {
            id: "target",
            assetClass: "Texture2D",
            packagePath: "/Game/UtahRaptor/Textures/T_Utah_Claws_D",
            objectPath:
              "/Game/UtahRaptor/Textures/T_Utah_Claws_D.T_Utah_Claws_D",
            virtualPath: "/Clawed/Base/UtahRaptor/Textures/T_Utah_Claws_D",
            source: "baseGame",
            role: "target",
            tags: ["texture_material_visuals"]
          },
          {
            id: "replacement",
            assetClass: "Texture2D",
            virtualPath: "/Packages/female-a/1.0.0/Content/Paks/FemaleA_P.pak",
            payloadPath: "payload/Content/Paks/FemaleA_P.pak",
            source: "generated",
            role: "replacement",
            tags: ["texture_material_visuals"]
          }
        ],
        replacements: [
          {
            targetAssetId: "target",
            replacementAssetId: "replacement",
            targetObjectPath:
              "/Game/UtahRaptor/Textures/T_Utah_Claws_D.T_Utah_Claws_D",
            targetVirtualPath: "/Clawed/Base/UtahRaptor/Textures/T_Utah_Claws_D",
            replacementVirtualPath:
              "/Packages/female-a/1.0.0/Content/Paks/FemaleA_P.pak",
            payloadPaths: ["payload/Content/Paks/FemaleA_P.pak"],
            deploymentRoute: "pak-iostore-existing-path",
            validationState: "validated"
          }
        ],
        cookTarget: {
          unrealVersion: "5.5.4",
          platform: "Windows",
          containerFormat: "pak+iostore",
          requiresAssetRegistry: false
        },
        supportedSteamBuilds: [
          {
            buildId: "24742251",
            status: "validated",
            evidence: "E2E fixture"
          }
        ],
        previewAssets: [creatorModelPreview],
        importProvenance: [
          {
            sourceKind: "generated",
            sourceName: "E2E fixture",
            sourceSha256: "b".repeat(64),
            sourceHashes: [
              {
                algorithm: "sha256",
                scope: "source",
                path: "FemaleA_P.pak",
                sha256: "b".repeat(64)
              }
            ],
            rights: "generated"
          }
        ],
        assetDependencies: [
          {
            fromAssetId: "replacement",
            toAssetId: "target",
            fromVirtualPath: "/Packages/female-a/1.0.0/Content/Paks/FemaleA_P.pak",
            toObjectPath:
              "/Game/UtahRaptor/Textures/T_Utah_Claws_D.T_Utah_Claws_D",
            toPackagePath: "/Game/UtahRaptor/Textures/T_Utah_Claws_D",
            toVirtualPath: "/Clawed/Base/UtahRaptor/Textures/T_Utah_Claws_D",
            relation: "replaces",
            required: true,
            source: "baseGame"
          }
        ],
        exportEligibility: {
          state: "exportable",
          allowedOutputs: ["clawedmod", "assetIndex", "conflictReport"],
          containsBaseGameContent: false,
          requiresUserOwnedSource: false
        }
      }
    };
    const coreMod = {
      id: "core-framework",
      version: "1.0.0",
      name: "Core Framework",
      author: "CMM Fixtures",
      description: "Shared fake framework.",
      loader: "ue4ss",
      sha256: "a".repeat(64),
      enabled: true,
      installPath: "C:\\CMM\\library\\core",
      packagePath: "C:\\fixtures\\core.clawedmod",
      iconDataUrl: null,
      hasReadme: true,
      status: "ready",
      problems: [],
      installedAt: now
    };
    const femaleMod = {
      id: "female-a",
      version: "1.0.0",
      name: "Female Character A",
      author: "CMM Fixtures",
      description: "Fake character fixture.",
      loader: "pak",
      sha256: "b".repeat(64),
      enabled: false,
      installPath: "C:\\CMM\\library\\female-a",
      packagePath: "C:\\fixtures\\female-a.clawedmod",
      iconDataUrl: null,
      hasReadme: false,
      status: "warning",
      problems: [problem],
      installedAt: now
    };
    const importedMod = {
      id: "character-framework",
      version: "1.0.0",
      name: "Character Framework",
      author: "CMM Fixtures",
      description: "Imported fake framework.",
      loader: "ue4ss",
      sha256: "c".repeat(64),
      enabled: true,
      installPath: "C:\\CMM\\library\\character-framework",
      packagePath: "C:\\fixtures\\character-framework.clawedmod",
      iconDataUrl: null,
      hasReadme: true,
      status: "ready",
      problems: [],
      installedAt: now
    };
    const creatorBaseEntry = {
      id: "base-utah-claws",
      label: "/Game/UtahRaptor/Textures/T_Utah_Claws_D.T_Utah_Claws_D",
      source: "baseGameMap",
      ownerLabel: "Clawed base index",
      packageId: null,
      packageVersion: null,
      packageName: null,
      containerName: "Clawed-Windows",
      loader: null,
      activeProfileEnabled: false,
      activeProfileOrder: null,
      assetClass: "Texture2D",
      packagePath: "/Game/UtahRaptor/Textures/T_Utah_Claws_D",
      objectPath: "/Game/UtahRaptor/Textures/T_Utah_Claws_D.T_Utah_Claws_D",
      virtualPath: "/Clawed/Base/UtahRaptor/Textures/T_Utah_Claws_D",
      payloadPath: null,
      relativePath: "Clawed/Content/UtahRaptor/Textures/T_Utah_Claws_D.uasset",
      extension: ".uasset",
      tags: ["texture_material_visuals"],
      modUses: "Texture replacement target",
      sizeBytes: 2048,
      sha256: "d".repeat(64),
      validationState: null,
      deploymentRoute: null,
      exportState: "indexOnly",
      conflictState: "overridden"
    };
    const creatorBaseMeshEntry = {
      ...creatorBaseEntry,
      id: "base-utah-skeletal-mesh",
      label: "/Game/UtahRaptor/Meshes/SK_Utah.SK_Utah",
      assetClass: "SkeletalMesh",
      packagePath: "/Game/UtahRaptor/Meshes/SK_Utah",
      objectPath: "/Game/UtahRaptor/Meshes/SK_Utah.SK_Utah",
      virtualPath: "/Clawed/Base/UtahRaptor/Meshes/SK_Utah",
      relativePath: "Clawed/Content/UtahRaptor/Meshes/SK_Utah.uasset",
      tags: ["model_visuals", "character_model_animation"],
      modUses: "Base skeletal mesh inspection target",
      exportState: "exportable",
      conflictState: "none"
    };
    const creatorWinnerEntry = {
      id: "asset:female-a@1.0.0:target",
      label: "/Game/UtahRaptor/Textures/T_Utah_Claws_D.T_Utah_Claws_D",
      source: "installedPackage",
      ownerLabel: "Female Character A",
      packageId: "female-a",
      packageVersion: "1.0.0",
      packageName: "Female Character A",
      containerName: "FemaleA_P.pak",
      loader: "pak",
      activeProfileEnabled: true,
      activeProfileOrder: 2,
      assetClass: "Texture2D",
      packagePath: "/Game/UtahRaptor/Textures/T_Utah_Claws_D",
      objectPath: "/Game/UtahRaptor/Textures/T_Utah_Claws_D.T_Utah_Claws_D",
      virtualPath: "/Packages/female-a/1.0.0/Content/Paks/FemaleA_P.pak",
      payloadPath: "payload/Content/Paks/FemaleA_P.pak",
      relativePath: null,
      extension: ".pak",
      tags: ["texture_material_visuals"],
      modUses: "replacement",
      sizeBytes: null,
      sha256: "b".repeat(64),
      validationState: "validated",
      deploymentRoute: "pak-iostore-existing-path",
      exportState: "exportable",
      conflictState: "winner"
    };
    const creatorPayloadEntry = {
      ...creatorWinnerEntry,
      id: "payload:female-a@1.0.0:female-a-pak",
      label: "payload/Content/Paks/FemaleA_P.pak",
      source: "packagePayload",
      objectPath: null,
      packagePath: null,
      virtualPath: "/Packages/female-a/1.0.0/Content/Paks/FemaleA_P.pak",
      relativePath: "payload/Content/Paks/FemaleA_P.pak",
      conflictState: "none"
    };
    const fullProfile = (summary: any) => ({
      schemaVersion: 1,
      id: summary.id,
      name: summary.name,
      createdAt: now,
      updatedAt: now,
      selectedMods: {
        "core-framework": {
          modId: "core-framework",
          version: "1.0.0",
          enabled: true,
          config: {}
        },
        "female-a": {
          modId: "female-a",
          version: "1.0.0",
          enabled: false,
          config: {}
        }
      },
      orderedModIds: ["core-framework", "female-a"],
      preferredLaunchMode: summary.preferredLaunchMode
    });

    type FakeMod = typeof coreMod | typeof femaleMod | typeof importedMod;
    type FakeProfileSummary = typeof profileDefault;
    type FakeHistoryEntry = {
      id: string;
      kind: string;
      status: string;
      fileName: string;
      profileId?: string | null;
      profileName: string;
      packageCount: number;
      trackedPackages: Array<{ id: string; version: string }>;
      missingPackages: Array<{ id: string; version: string }>;
      acceptedMissingAt?: string | null;
      occurredAt: string;
    };

    const state: {
      activeProfileId: string;
      profiles: FakeProfileSummary[];
      mods: FakeMod[];
      order: FakeMod[];
      history: FakeHistoryEntry[];
    } = {
      activeProfileId: "profile-default",
      profiles: [profileDefault, profileRaid],
      mods: [coreMod, femaleMod],
      order: [coreMod, femaleMod],
      history: []
    };

    const activeSummary = () =>
      state.profiles.find((profile) => profile.id === state.activeProfileId) ??
      state.profiles[0];
    const profileSnapshot = () => ({
      activeProfileId: state.activeProfileId,
      profiles: state.profiles.map((profile) => ({
        ...profile,
        isActive: profile.id === state.activeProfileId
      }))
    });
    const loadOrderSnapshot = () => ({
      activeProfile: fullProfile(activeSummary()),
      entries: state.order.map((mod, index) => ({
        position: index + 1,
        mod,
        selectedVersion: mod.version,
        enabled: mod.enabled,
        problems: mod.problems.map((modProblem) => ({
          severity: modProblem.severity === "error" ? "ERROR" : "WARNING",
          code: modProblem.code,
          message: modProblem.message,
          modId: mod.id,
          technicalDetail: modProblem.technicalDetail
        }))
      })),
      validation: {
        profileId: state.activeProfileId,
        profileName: activeSummary().name,
        orderedModIds: state.order.map((mod) => mod.id),
        problems: [
          {
            severity: "WARNING",
            code: "UNVALIDATED_RUNTIME_ORDER",
            message: "Effective Clawed runtime loading order is unvalidated.",
            technicalDetail: "Fake E2E detail."
          }
        ],
        validity: "valid"
      }
    });
    const creatorEntries = () => [
      creatorWinnerEntry,
      creatorPayloadEntry,
      creatorBaseEntry,
      creatorBaseMeshEntry
    ];
    const creatorActiveProfile = () => ({
      id: activeSummary().id,
      name: activeSummary().name,
      orderedModIds: state.order.map((mod) => mod.id),
      enabledModIds: state.mods.filter((mod) => mod.enabled).map((mod) => mod.id)
    });
    const creatorConflict = () => ({
      targetKey:
        "object:/game/utahraptor/textures/t_utah_claws_d.t_utah_claws_d",
      targetPackagePath: "/Game/UtahRaptor/Textures/T_Utah_Claws_D",
      targetObjectPath: "/Game/UtahRaptor/Textures/T_Utah_Claws_D.T_Utah_Claws_D",
      targetVirtualPath: "/Clawed/Base/UtahRaptor/Textures/T_Utah_Claws_D",
      baseGamePresent: true,
      winnerPackageId: "female-a",
      winnerPackageVersion: "1.0.0",
      loadOrderEffects: [],
      entries: [
        {
          packageId: "female-a",
          packageVersion: "1.0.0",
          packageName: "Female Character A",
          loader: "pak",
          enabled: true,
          profileOrder: 2,
          validationState: "validated",
          deploymentRoute: "pak-iostore-existing-path",
          payloadPaths: ["payload/Content/Paks/FemaleA_P.pak"],
          targetAssetIds: ["target"],
          contributesReplacement: true,
          dependencies: [{ id: "core-framework" }],
          explicitConflicts: ["male-character"],
          loadBefore: [],
          loadAfter: ["core-framework"],
          loadOrderEffects: [],
          isWinner: true
        }
      ]
    });
    const creatorSnapshot = () => ({
      generatedAt: now,
      map: {
        status: "ready",
        artifactRoot: ".codex\\clawed-game-file-map\\20260814-current",
        generatedAtUtc: now,
        steamBuildId: "24719259",
        physicalFileCount: 161,
        shippingManifestEntryCount: 63632,
        containerEntryCount: 40619,
        namedContainerEntryCount: 34549,
        artifacts: [
          {
            name: "clawed-all-files-and-container-entries.csv",
            exists: true,
            sizeBytes: 32739025
          }
        ]
      },
      activeProfile: creatorActiveProfile(),
      totals: {
        baseGameEntries: 40619,
        installedPackages: state.mods.length,
        packagePayloadEntries: 1,
        creatorMetadataPackages: 1,
        affectedAssets: 2,
        replacements: 1,
        checksumRecords: 2,
        activeConflictTargets: 1,
        activeWinners: 1,
        loadOrderEffectProblems: 0,
        staleProfileReferences: 0,
        deploymentFiles: 0
      },
      topTags: [{ tag: "texture_material_visuals", count: 17106 }],
      recentEntries: creatorEntries(),
      problems: []
    });
    const creatorGraph = () => ({
      generatedAt: now,
      activeProfile: creatorActiveProfile(),
      conflicts: [creatorConflict()],
      totals: {
        targets: 1,
        activeTargets: 1,
        winners: 1
      },
      problems: []
    });
    const creatorTreePath = (entry: any) => {
      const sourcePath =
        entry.objectPath ??
        entry.packagePath ??
        entry.payloadPath ??
        entry.relativePath ??
        entry.virtualPath ??
        entry.label;
      const normalizedPath = String(sourcePath)
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+/g, "/");
      if (entry.source === "installedPackage" || entry.source === "packagePayload") {
        return `${entry.packageName} ${entry.packageVersion}/${normalizedPath}`;
      }
      return normalizedPath;
    };
    const creatorTreeRootId = (source: string) => `root|${source}`;
    const creatorTreeFolderId = (source: string, path: string) =>
      `folder|${source}|${encodeURIComponent(path)}`;
    const creatorTreeAssetId = (assetId: string) =>
      `asset|${encodeURIComponent(assetId)}`;
    const creatorTreeNode = (entry: any, path: string) => ({
      id: creatorTreeAssetId(entry.id),
      label: path.split("/").filter(Boolean).at(-1) ?? entry.label,
      kind: "asset",
      source: entry.source,
      path,
      assetId: entry.id,
      hasChildren: false,
      childCount: 0,
      assetClass: entry.assetClass,
      packageName: entry.packageName,
      validationState: entry.validationState,
      conflictState: entry.conflictState,
      exportState: entry.exportState
    });
    const parseCreatorTreeNodeId = (id: string | null) => {
      if (!id) {
        return null;
      }
      const [kind, source, encodedPath] = id.split("|");
      return {
        kind,
        source,
        path: encodedPath ? decodeURIComponent(encodedPath) : ""
      };
    };
    const creatorTree = ({
      parentId = null,
      source = "all",
      query = "",
      activeOnly = false,
      limit = 300
    }: {
      parentId?: string | null;
      source?: string;
      query?: string;
      activeOnly?: boolean;
      limit?: number;
    } = {}) => {
      const allowedSources = [
        "baseGameMap",
        "installedPackage",
        "packagePayload",
        "deployment"
      ];
      const matchingEntries = creatorEntries().filter(
        (entry) =>
          (source === "all" || entry.source === source) &&
          (!activeOnly || entry.activeProfileEnabled)
      );
      if (!parentId && !query.trim()) {
        const nodes = [
          {
            id: creatorTreeRootId("baseGameMap"),
            label: "Clawed Base Game",
            kind: "root",
            source: "baseGameMap",
            path: "",
            assetId: null,
            hasChildren: true,
            childCount: 1
          },
          {
            id: creatorTreeRootId("installedPackage"),
            label: "Installed Package Assets",
            kind: "root",
            source: "installedPackage",
            path: "",
            assetId: null,
            hasChildren: true,
            childCount: 1
          },
          {
            id: creatorTreeRootId("packagePayload"),
            label: "Package Payloads",
            kind: "root",
            source: "packagePayload",
            path: "",
            assetId: null,
            hasChildren: true,
            childCount: 1
          },
          {
            id: creatorTreeRootId("deployment"),
            label: "Active Deployment",
            kind: "root",
            source: "deployment",
            path: "",
            assetId: null,
            hasChildren: false,
            childCount: 0
          }
        ].filter((node) => source === "all" || node.source === source);
        return {
          generatedAt: now,
          parentId: null,
          nodes,
          totalChildren: nodes.length,
          truncated: false,
          problems: []
        };
      }

      if (query.trim()) {
        const normalizedQuery = query.toLowerCase();
        const nodes = matchingEntries
          .map((entry) => [entry, creatorTreePath(entry)] as const)
          .filter(([entry, path]) =>
            [
              entry.label,
              entry.ownerLabel,
              entry.packageId,
              entry.packageName,
              entry.containerName,
              entry.assetClass,
              entry.objectPath,
              entry.packagePath,
              entry.virtualPath,
              entry.payloadPath,
              entry.relativePath,
              path
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery)
          )
          .map(([entry, path]) => creatorTreeNode(entry, path))
          .slice(0, limit);
        return {
          generatedAt: now,
          parentId,
          nodes,
          totalChildren: nodes.length,
          truncated: nodes.length >= limit,
          problems: []
        };
      }

      const parsed = parseCreatorTreeNodeId(parentId);
      const parentSource =
        parsed?.kind === "root" || parsed?.kind === "folder"
          ? parsed.source
          : source === "all"
            ? null
            : source;
      if (!parentSource || !allowedSources.includes(parentSource)) {
        return {
          generatedAt: now,
          parentId,
          nodes: [],
          totalChildren: 0,
          truncated: false,
          problems: []
        };
      }

      const prefix = parsed?.kind === "folder" ? parsed.path : "";
      const folders = new Map<string, any>();
      const assets = new Map<string, any>();
      for (const entry of matchingEntries.filter(
        (candidate) => candidate.source === parentSource
      )) {
        const path = creatorTreePath(entry);
        const parts = path.split("/").filter(Boolean);
        const prefixParts = prefix ? prefix.split("/").filter(Boolean) : [];
        if (
          prefixParts.some((part, index) => parts[index]?.toLowerCase() !== part.toLowerCase())
        ) {
          continue;
        }
        const next = parts[prefixParts.length];
        if (!next) {
          continue;
        }
        if (prefixParts.length === parts.length - 1) {
          assets.set(entry.id, creatorTreeNode(entry, path));
          continue;
        }
        const folderPath = [...prefixParts, next].join("/");
        const count = matchingEntries.filter(
          (candidate) =>
            candidate.source === parentSource &&
            creatorTreePath(candidate).startsWith(`${folderPath}/`)
        ).length;
        folders.set(folderPath, {
          id: creatorTreeFolderId(parentSource, folderPath),
          label: next,
          kind: "folder",
          source: parentSource,
          path: folderPath,
          assetId: null,
          hasChildren: true,
          childCount: count
        });
      }
      const nodes = [...folders.values(), ...assets.values()]
        .sort((left, right) =>
          left.kind === right.kind
            ? left.label.localeCompare(right.label)
            : left.kind === "folder"
              ? -1
              : 1
        )
        .slice(0, limit);
      return {
        generatedAt: now,
        parentId,
        nodes,
        totalChildren: nodes.length,
        truncated: nodes.length >= limit,
        problems: []
      };
    };
    const creatorDetail = (assetId: string) => {
      const asset =
        creatorEntries().find((entry) => entry.id === assetId) ??
        creatorWinnerEntry;
      return {
        status: "ok",
        asset,
        relatedAssets: creatorEntries().filter((entry) => entry.id !== asset.id),
        conflicts:
          asset.objectPath === creatorWinnerEntry.objectPath ||
          asset.id === creatorWinnerEntry.id
            ? [creatorConflict()]
            : [],
        activeWinner:
          asset.objectPath === creatorWinnerEntry.objectPath ||
          asset.id === creatorWinnerEntry.id
            ? creatorConflict().entries[0]
            : null,
        previews: asset.id === creatorWinnerEntry.id ? [creatorModelPreview] : [],
        checksums:
          asset.packageId === "female-a"
            ? [
                {
                  packageId: "female-a",
                  packageVersion: "1.0.0",
                  scope: "payload",
                  path: "payload/Content/Paks/FemaleA_P.pak",
                  sha256: "b".repeat(64)
                }
              ]
            : [],
        dependencies: [
          {
            fromAssetId: "target",
            toAssetId: "base-utah-claws",
            fromVirtualPath:
              "/Packages/female-a/1.0.0/Content/Paks/FemaleA_P.pak",
            toObjectPath:
              "/Game/UtahRaptor/Textures/T_Utah_Claws_D.T_Utah_Claws_D",
            toPackagePath: "/Game/UtahRaptor/Textures/T_Utah_Claws_D",
            toVirtualPath: "/Clawed/Base/UtahRaptor/Textures/T_Utah_Claws_D",
            relation: "replaces",
            required: true,
            source: "baseGame"
          }
        ],
        problems: []
      };
    };
    const commandResult = (
      kind: string,
      title: string,
      message: string,
      extra: Record<string, unknown> = {}
    ) => ({
      kind,
      launchMode: kind === "launchVanilla" ? "VANILLA" : "MODDED",
      lifecycleState: "RUNNING",
      status: "completed",
      title,
      message,
      occurredAt: now,
      ...extra
    });
    const diagnosticSummary = () => ({
      generatedAt: now,
      storage: {
        root: "C:\\CMM",
        directories: {
          libraryMods: "C:\\CMM\\library\\mods",
          profiles: "C:\\CMM\\profiles",
          staging: "C:\\CMM\\staging",
          runtime: "C:\\CMM\\runtime",
          backups: "C:\\CMM\\backups",
          logs: "C:\\CMM\\logs"
        }
      },
      discovery,
      process: {
        lifecycleState: "STOPPED",
        processId: null,
        processName: null,
        startedAt: null,
        updatedAt: now
      },
      gameFingerprint: {
        status: "UNKNOWN_BUILD",
        generatedAt: now,
        gameInstallPath: discovery.gameInstallPath,
        executablePath: discovery.gameExecutable,
        executableSha256: "d".repeat(64),
        steamBuildId: "fake-build",
        appManifestPath: discovery.appManifestPath,
        appManifestSha256: "e".repeat(64),
        contentFiles: [],
        fingerprintSha256: "f".repeat(64),
        releaseValidation: "UNVALIDATED",
        problems: []
      },
      runtime,
      activeProfile: {
        id: activeSummary().id,
        name: activeSummary().name
      },
      profileValidity: "valid",
      enabledModCount: state.mods.filter((mod) => mod.enabled).length,
      dependencyProblems: [],
      conflictProblems: [],
      deployment: {
        state: "deploymentRequired",
        activeManifest: null,
        runtime,
        problems: [problem]
      },
      managerOwnedFiles: [],
      lastLaunchMode: "MODDED",
      lastGameExit: null,
      lastDeploymentProblem: problem,
      logs: {
        logDirectory: "C:\\CMM\\logs",
        crashDumpsDirectory: "C:\\CMM\\logs\\crash-dumps",
        crashDumpCount: 0,
        latestErrors: ["DEPLOYMENT fake warning"]
      },
      modLibrary: {
        mods: state.mods,
        totals: {
          installed: state.mods.length,
          enabled: state.mods.filter((mod) => mod.enabled).length,
          disabled: state.mods.filter((mod) => !mod.enabled).length,
          problems: state.mods.reduce(
            (total, mod) => total + mod.problems.length,
            0
          )
        }
      },
      creatorAssets: {
        packagesWithMetadata: 1,
        packagesMissingMetadata: state.mods.length - 1,
        affectedAssets: 2,
        replacements: 1,
        packagePayloadEntries: 1,
        checksumRecords: 2,
        activeConflictTargets: 1,
        activeWinners: 1,
        loadOrderEffectProblems: 0,
        staleProfileReferences: 0
      },
      services: [
        {
          id: "gameLocator",
          label: "Game Locator",
          status: "ready",
          detail: "Fake discovery is ready."
        }
      ],
      releaseValidation: {
        state: "UNVALIDATED",
        detail: "Fake E2E data."
      }
    });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).__copiedText = text;
        }
      }
    });

    (window as any).cmmFileDrops = {
      getPathForFile: (file: File) => file.name
    };
    const cmm: Record<string, any> = {
      getPlaySnapshot: async () => ({
        activeProfile: {
          id: activeSummary().id,
          name: activeSummary().name
        },
        gameState: "STOPPED",
        launchMode: "MODDED",
        enabledMods: state.mods.filter((mod) => mod.enabled).length,
        profileValidity: "valid",
        deploymentState: "deploymentRequired",
        conflicts: { count: 1, severity: "warning" },
        discovery,
        process: {
          lifecycleState: "STOPPED",
          processId: null,
          processName: null,
          startedAt: null,
          updatedAt: now
        },
        lastCommand: null
      }),
      runLaunchCommand: async ({
        kind,
        forceCloseConfirmed
      }: {
        kind: string;
        forceCloseConfirmed?: boolean;
      }) => {
        if (kind === "restartGame" && !forceCloseConfirmed) {
          return commandResult(
            kind,
            "Clawed isn't responding",
            "Clawed isn't responding. Forcing it closed may interrupt a save operation.",
            {
              status: "needsConfirmation",
              requiresForceCloseConfirmation: true
            }
          );
        }
        if (kind === "launchVanilla") {
          return commandResult(kind, "Launching Vanilla", "Vanilla launch accepted.");
        }
        if (kind === "launchModded") {
          return commandResult(kind, "Launching Modded", "Modded launch accepted.");
        }
        return commandResult(kind, "Restarting", "Restart accepted.");
      },
      getGameDiscovery: async () => discovery,
      rescanGameDiscovery: async () => discovery,
      chooseManualGameDirectory: async () => discovery,
      clearManualGameDirectory: async () => discovery,
      setManualGameDirectory: async () => discovery,
      getAppSettings: async () => ({
        manualGameDirectory: null,
        autoUpdatePackagedRuntime: true
      }),
      setAutoUpdatePackagedRuntime: async ({ enabled }: { enabled: boolean }) => ({
        manualGameDirectory: null,
        autoUpdatePackagedRuntime: enabled
      }),
      getLifecycleSnapshot: async () => ({
        lifecycleState: "STOPPED",
        processId: null,
        processName: null,
        startedAt: null,
        updatedAt: now
      }),
      listInstalledMods: async () => ({
        mods: state.mods,
        totals: {
          installed: state.mods.length,
          enabled: state.mods.filter((mod) => mod.enabled).length,
          disabled: state.mods.filter((mod) => !mod.enabled).length,
          problems: state.mods.reduce(
            (total, mod) => total + mod.problems.length,
            0
          )
        }
      }),
      importModPackage: async () => ({
        status: "installed",
        mod: importedMod,
        problems: []
      }),
      chooseAndImportModPackage: async () => {
        if (!state.mods.some((mod) => mod.id === importedMod.id)) {
          state.mods = [...state.mods, importedMod];
          state.order = [...state.order, importedMod];
        }
        return { status: "installed", mod: importedMod, problems: [] };
      },
      uninstallMod: async () => ({ status: "ok", mod: null, problems: [] }),
      setModEnabled: async ({
        id,
        enabled
      }: {
        id: string;
        enabled: boolean;
      }) => {
        state.mods = state.mods.map((mod) =>
          mod.id === id ? { ...mod, enabled } : mod
        );
        state.order = state.order.map((mod) =>
          mod.id === id ? { ...mod, enabled } : mod
        );
        return {
          status: "ok",
          mod: state.mods.find((mod) => mod.id === id) ?? null,
          problems: []
        };
      },
      inspectModManifest: async ({ id }: { id: string }) => {
        const selectedManifest = id === "female-a" ? femaleManifest : manifest;
        const creatorAssets = (selectedManifest as any).creatorAssets;
        return {
          manifest: selectedManifest,
          creatorMetadataState: creatorAssets
            ? "present"
            : "missing",
          creatorMetadataProblems: [],
          problems: []
        };
      },
      readModReadme: async () => ({
        content: "Fake README for E2E.",
        problems: []
      }),
      openModFolder: async () => ({ status: "ok", mod: null, problems: [] }),
      getActiveProfile: async () => fullProfile(activeSummary()),
      listProfiles: async () => profileSnapshot(),
      getMissingProfileMods: async () => ({
        profiles: [],
        totalMissing: 0,
        generatedAt: now
      }),
      acceptMissingProfileMods: async () => ({
        status: "ok",
        profilesUpdated: 0,
        removedModCount: 0,
        snapshot: {
          profiles: [],
          totalMissing: 0,
          generatedAt: now
        },
        problems: []
      }),
      createProfile: async ({ name }: { name: string }) => {
        const profile = {
          id: `profile-${name.toLowerCase().replaceAll(" ", "-")}`,
          name,
          modCount: 0,
          enabledCount: 0,
          preferredLaunchMode: "VANILLA",
          isActive: false,
          updatedAt: now
        };
        state.profiles = [...state.profiles, profile];
        state.activeProfileId = profile.id;
        return {
          status: "ok",
          activeProfile: fullProfile(profile),
          profiles: profileSnapshot().profiles,
          problems: []
        };
      },
      duplicateProfile: async () => ({
        status: "ok",
        activeProfile: fullProfile(activeSummary()),
        profiles: profileSnapshot().profiles,
        problems: []
      }),
      renameProfile: async () => ({
        status: "ok",
        activeProfile: fullProfile(activeSummary()),
        profiles: profileSnapshot().profiles,
        problems: []
      }),
      deleteProfile: async () => ({
        status: "ok",
        activeProfile: fullProfile(activeSummary()),
        profiles: profileSnapshot().profiles,
        problems: []
      }),
      switchProfile: async ({ id }: { id: string }) => {
        state.activeProfileId = id;
        return {
          status: "ok",
          activeProfile: fullProfile(activeSummary()),
          profiles: profileSnapshot().profiles,
          problems: []
        };
      },
      getLoadOrderSnapshot: async () => loadOrderSnapshot(),
      validateActiveLoadOrder: async () => loadOrderSnapshot().validation,
      moveModInActiveOrder: async ({
        modId,
        direction
      }: {
        modId: string;
        direction: string;
      }) => {
        const index = state.order.findIndex((mod) => mod.id === modId);
        if (index >= 0 && direction === "down" && index < state.order.length - 1) {
          const item = state.order[index];
          state.order.splice(index, 1);
          state.order.splice(index + 1, 0, item);
        }
        if (index > 0 && direction === "up") {
          const item = state.order[index];
          state.order.splice(index, 1);
          state.order.splice(index - 1, 0, item);
        }
        return {
          status: "ok",
          snapshot: loadOrderSnapshot(),
          problems: []
        };
      },
      setModActiveOrderPosition: async () => ({
        status: "ok",
        snapshot: loadOrderSnapshot(),
        problems: []
      }),
      placeModInActiveOrder: async () => ({
        status: "ok",
        snapshot: loadOrderSnapshot(),
        problems: []
      }),
      exportCurrentProfileModpack: async () => ({
        status: "exported",
        modpackPath: "C:\\fixtures\\share.clawedpack",
        packageCount: state.mods.length,
        validation: loadOrderSnapshot().validation,
        problems: []
      }),
      chooseAndExportCurrentProfileModpack: async () => {
        state.history.unshift({
          id: "history-export",
          kind: "export",
          status: "exported",
          fileName: "share.clawedpack",
          profileName: activeSummary().name,
          packageCount: state.mods.length,
          trackedPackages: state.mods.map((mod) => ({
            id: mod.id,
            version: mod.version
          })),
          missingPackages: [],
          occurredAt: now
        });
        return {
          status: "exported",
          modpackPath: "C:\\fixtures\\share.clawedpack",
          packageCount: state.mods.length,
          validation: loadOrderSnapshot().validation,
          problems: []
        };
      },
      inspectModpack: async () => ({
        status: "ok",
        modpackPath: "C:\\fixtures\\friend.clawedpack",
        pack: null,
        loadOrder: null,
        summary: {
          profileName: "Friend Pack",
          packageCount: 2,
          enabledCount: 2,
          disabledCount: 0,
          orderedModIds: ["core-framework", "female-a"]
        },
        packages: [
          {
            id: "core-framework",
            version: "1.0.0",
            sha256: "a".repeat(64),
            file: "packages/core.clawedmod",
            name: "Core Framework",
            loader: "ue4ss",
            status: "installed",
            problems: []
          }
        ],
        problems: []
      }),
      chooseAndInspectModpack: async () =>
        cmm.inspectModpack({ modpackPath: "" }),
      importModpack: async () => {
        const profile = {
          id: "profile-friend-pack",
          name: "Friend Pack",
          modCount: 2,
          enabledCount: 2,
          preferredLaunchMode: "MODDED",
          isActive: true,
          updatedAt: now
        };
        if (!state.profiles.some((existing) => existing.id === profile.id)) {
          state.profiles = [...state.profiles, profile];
        }
        state.activeProfileId = profile.id;
        state.history.unshift({
          id: "history-import",
          kind: "import",
          status: "imported",
          fileName: "friend.clawedpack",
          profileId: profile.id,
          profileName: profile.name,
          packageCount: 2,
          trackedPackages: [
            { id: "core-framework", version: "1.0.0" },
            { id: "female-a", version: "1.0.0" }
          ],
          missingPackages: [],
          occurredAt: now
        });
        return {
          status: "imported",
          inspect: await cmm.inspectModpack({ modpackPath: "" }),
          profile: fullProfile(profile),
          validation: loadOrderSnapshot().validation,
          installedPackageCount: 0,
          reusedPackageCount: 2,
          problems: []
        };
      },
      compareCurrentProfileToModpack: async () => ({
        status: "DIFFERENT",
        modpackPath: "C:\\fixtures\\friend.clawedpack",
        profileName: activeSummary().name,
        orderStatus: "ORDER MISMATCH",
        items: [],
        copyableReport: "CMM comparison: different",
        problems: []
      }),
      listRecentModpacks: async () => ({ entries: state.history }),
      acceptMissingModpackMods: async () => ({
        status: "ok",
        entriesUpdated: 0,
        removedPackageCount: 0,
        history: { entries: state.history },
        problems: []
      }),
      getDeploymentSnapshot: async () => diagnosticSummary().deployment,
      prepareVanillaDeployment: async () => ({
        status: "ok",
        state: "vanillaReady",
        manifest: null,
        problems: []
      }),
      getRuntimeSnapshot: async () => runtime,
      installBundledUe4ssRuntime: async () => {
        runtime = bundledRuntime;
        return {
          status: "imported",
          runtime: bundledRuntime.ue4ss,
          problems: bundledRuntime.problems
        };
      },
      importUe4ssRuntime: async () => ({
        status: "failed",
        runtime: null,
        problems: [problem]
      }),
      chooseAndImportUe4ssRuntime: async () => ({
        status: "failed",
        runtime: null,
        problems: [problem]
      }),
      getCreatorAssetRegistrySnapshot: async () => creatorSnapshot(),
      getCreatorAssetTree: async (request: any) => creatorTree(request),
      searchCreatorAssets: async ({
        query = "",
        source = "all",
        physicalPath = "",
        objectPath = "",
        tags = [],
        assetClass,
        modUse = "",
        packageId,
        conflictState = "any",
        validationState,
        exportState = "any",
        sortBy = "relevance",
        sortDirection = "asc",
        activeOnly = false,
        limit = 80
      }: {
        query?: string;
        source?: string;
        physicalPath?: string;
        objectPath?: string;
        tags?: string[];
        assetClass?: string;
        modUse?: string;
        packageId?: string;
        conflictState?: string;
        validationState?: string;
        exportState?: string;
        sortBy?: string;
        sortDirection?: string;
        activeOnly?: boolean;
        limit?: number;
      }) => {
        const normalizedQuery = query.toLowerCase();
        const includes = (needle: string, values: unknown[]) =>
          !needle ||
          values
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(needle.toLowerCase());
        const sortValue = (entry: any) => {
          if (sortBy === "physicalPath") {
            return entry.relativePath ?? entry.payloadPath ?? entry.virtualPath;
          }
          if (sortBy === "objectPath") {
            return entry.objectPath ?? entry.packagePath ?? entry.virtualPath;
          }
          if (sortBy === "assetClass") {
            return entry.assetClass;
          }
          if (sortBy === "modUse") {
            return entry.modUses;
          }
          if (sortBy === "package") {
            return entry.packageName ?? entry.packageId ?? entry.ownerLabel;
          }
          if (sortBy === "validationState") {
            return entry.validationState;
          }
          if (sortBy === "conflictState") {
            return entry.conflictState;
          }
          if (sortBy === "exportState") {
            return entry.exportState;
          }
          if (sortBy === "activeProfileOrder") {
            return entry.activeProfileOrder;
          }
          if (sortBy === "source") {
            return entry.source;
          }
          return entry.label;
        };
        const entries = creatorEntries().filter((entry) => {
          const matchesQuery =
            !normalizedQuery ||
            [
              entry.label,
              entry.ownerLabel,
              entry.packageId,
              entry.packageName,
              entry.containerName,
              entry.assetClass,
              entry.objectPath,
              entry.packagePath,
              entry.virtualPath,
              entry.payloadPath,
              entry.relativePath,
              entry.tags.join(" "),
              entry.modUses,
              entry.exportState,
              entry.validationState,
              entry.conflictState
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery);
          const matchesSource = source === "all" || entry.source === source;
          const matchesConflict =
            conflictState === "any" || entry.conflictState === conflictState;
          const matchesActive = !activeOnly || entry.activeProfileEnabled;
          const matchesPhysicalPath = includes(physicalPath, [
            entry.relativePath,
            entry.payloadPath,
            entry.virtualPath,
            entry.containerName
          ]);
          const matchesObjectPath = includes(objectPath, [
            entry.objectPath,
            entry.packagePath,
            entry.virtualPath
          ]);
          const matchesClass = includes(assetClass ?? "", [entry.assetClass]);
          const matchesModUse = includes(modUse, [entry.modUses]);
          const matchesPackage = !packageId || entry.packageId === packageId;
          const matchesValidation =
            !validationState || entry.validationState === validationState;
          const matchesExport =
            exportState === "any" || entry.exportState === exportState;
          const matchesTags = tags.every((tag) => entry.tags.includes(tag));
          return (
            matchesQuery &&
            matchesSource &&
            matchesConflict &&
            matchesActive &&
            matchesPhysicalPath &&
            matchesObjectPath &&
            matchesClass &&
            matchesModUse &&
            matchesPackage &&
            matchesValidation &&
            matchesExport &&
            matchesTags
          );
        }).sort((left, right) => {
          const leftValue = sortValue(left);
          const rightValue = sortValue(right);
          if (leftValue === rightValue) {
            return left.label.localeCompare(right.label);
          }
          if (leftValue === null || leftValue === undefined) {
            return 1;
          }
          if (rightValue === null || rightValue === undefined) {
            return -1;
          }
          if (typeof leftValue === "number" && typeof rightValue === "number") {
            return leftValue - rightValue;
          }
          return String(leftValue).localeCompare(String(rightValue));
        });
        if (sortDirection === "desc") {
          entries.reverse();
        }

        return {
          generatedAt: now,
          totalMatches: entries.length,
          truncated: entries.length > limit,
          entries: entries.slice(0, limit),
          problems: []
        };
      },
      getCreatorAssetDetail: async ({ assetId }: { assetId: string }) =>
        creatorDetail(assetId),
      getCreatorConflictGraph: async () => creatorGraph(),
      getCreatorPreview: async () => ({
        status: "notFound",
        previews: [],
        problems: []
      }),
      getCreatorModelPreview: async ({ assetId }: { assetId: string }) => {
        const asset =
          creatorEntries().find((entry) => entry.id === assetId) ??
          creatorWinnerEntry;
        if (asset.source === "baseGameMap") {
          const available = asset.id === creatorBaseMeshEntry.id;
          return {
            status: available ? "available" : "empty",
            asset,
            preview: null,
            activeWinner: null,
            model: available
              ? {
                  dataUrl: creatorModelDataUrl,
                  format: "obj",
                  source: "decodedBaseGame",
                  fileName: "sk-utah-decoded-preview.obj",
                  sizeBytes: 82
                }
              : null,
            metadata: {
              skeleton: available
                ? "/Game/UtahRaptor/Meshes/SKEL_Utah.SKEL_Utah"
                : null,
              physicsAsset: null,
              materialSlots: available
                ? [
                    {
                      name: "Body",
                      materialPath:
                        "/Game/UtahRaptor/Materials/M_Utah_Body.M_Utah_Body"
                    }
                  ]
                : [],
              lods: available
                ? [
                    {
                      index: 0,
                      screenSize: 1,
                      triangleCount: 1200,
                      vertexCount: 700
                    }
                  ]
                : [],
              dependencyPaths: available
                ? ["/Game/UtahRaptor/Materials/M_Utah_Body.M_Utah_Body"]
                : [],
              targetObjectPath: asset.objectPath,
              packagePath: asset.packagePath,
              packageSource: asset.ownerLabel,
              sourceContainer: asset.containerName,
              previewSource: available
                ? "Direct decoded base-game asset"
                : "Direct base-game decode unavailable",
              lodCount: available ? 1 : null,
              vertexCount: available ? 700 : null,
              triangleCount: available ? 1200 : null,
              materialSlotCount: available ? 1 : null,
              validationState: asset.validationState,
              conflictWinner: null,
              exportState: asset.exportState
            },
            problems: available
              ? []
              : [
                  {
                    severity: "info",
                    code: "BASE_GAME_MESH_DECODER_UNAVAILABLE",
                    message:
                      "No base-game mesh decoder is configured for cooked Unreal mesh conversion."
                  }
                ]
          };
        }

        return {
          status: asset.id === creatorWinnerEntry.id ? "available" : "empty",
          asset,
          preview:
            asset.id === creatorWinnerEntry.id ? creatorModelPreview : null,
          activeWinner:
            asset.id === creatorWinnerEntry.id
              ? creatorConflict().entries[0]
              : null,
          model:
            asset.id === creatorWinnerEntry.id
              ? {
                  dataUrl: creatorModelDataUrl,
                  format: "obj",
                  source: "userOwned",
                  fileName: "female-a-preview.obj",
                  sizeBytes: 82
                }
              : null,
          metadata: {
            skeleton:
              asset.id === creatorWinnerEntry.id
                ? creatorModelPreview.skeleton
                : null,
            physicsAsset:
              asset.id === creatorWinnerEntry.id
                ? creatorModelPreview.physicsAsset
                : null,
            materialSlots:
              asset.id === creatorWinnerEntry.id
                ? creatorModelPreview.materialSlots
                : [],
            lods:
              asset.id === creatorWinnerEntry.id
                ? creatorModelPreview.lods
                : [],
            dependencyPaths:
              asset.id === creatorWinnerEntry.id
                ? creatorModelPreview.dependencyPaths
                : [],
            targetObjectPath: asset.objectPath,
            packagePath: asset.packagePath,
            packageSource: asset.packageName ?? asset.ownerLabel,
            sourceContainer: asset.containerName,
            previewSource:
              asset.id === creatorWinnerEntry.id
                ? "User-owned package preview"
                : null,
            lodCount:
              asset.id === creatorWinnerEntry.id
                ? creatorModelPreview.lods.length
                : null,
            vertexCount:
              asset.id === creatorWinnerEntry.id
                ? creatorModelPreview.lods[0]?.vertexCount ?? null
                : null,
            triangleCount:
              asset.id === creatorWinnerEntry.id
                ? creatorModelPreview.lods[0]?.triangleCount ?? null
                : null,
            materialSlotCount:
              asset.id === creatorWinnerEntry.id
                ? creatorModelPreview.materialSlots.length
                : null,
            validationState: asset.validationState,
            conflictWinner:
              asset.id === creatorWinnerEntry.id
                ? "Female Character A 1.0.0"
                : null,
            exportState: asset.exportState
          },
          problems: []
        };
      },
      getCreatorExportPlan: async ({
        assetIds,
        output
      }: {
        assetIds: string[];
        output: string;
      }) => ({
        status: output === "clawedmod" ? "blocked" : "ready",
        output,
        items: assetIds.map((assetId) => {
          const asset =
            creatorEntries().find((entry) => entry.id === assetId) ??
            creatorWinnerEntry;
          return {
            asset,
            eligibility:
              asset.source === "baseGameMap"
                ? {
                    state: "indexOnly",
                    allowedOutputs: [
                      "assetIndex",
                      "targetTemplate",
                      "dependencyGraph",
                      "conflictReport",
                      "validationReport"
                    ],
                    containsBaseGameContent: true,
                    requiresUserOwnedSource: false,
                    reason: "Index-only asset."
                  }
                : {
                    state: "exportable",
                    allowedOutputs: [
                      "clawedmod",
                      "assetIndex",
                      "dependencyGraph",
                      "conflictReport",
                      "validationReport"
                    ],
                    containsBaseGameContent: false,
                    requiresUserOwnedSource: false
                  },
            status: output === "clawedmod" && asset.source === "baseGameMap"
              ? "blocked"
              : "allowed",
            reason:
              output === "clawedmod" && asset.source === "baseGameMap"
                ? "Base-game content is index-only."
                : null
          };
        }),
        problems: []
      }),
      chooseAndExportCreatorMesh: async ({
        assetId,
        format
      }: {
        assetId: string;
        format: "obj" | "gltf" | "glb";
      }) => {
        const asset =
          creatorEntries().find((entry) => entry.id === assetId) ??
          creatorWinnerEntry;
        return {
          status: "exported",
          asset,
          format,
          destinationPath: `C:\\Exports\\${asset.id}.${format}`,
          bytesWritten: 82,
          metadata: {
            meshType:
              asset.assetClass === "SkeletalMesh" ? "skeletalMesh" : "staticMesh",
            skeleton: null,
            physicsAsset: null,
            materialSlots: [],
            lods: [],
            dependencyPaths: [],
            targetObjectPath: asset.objectPath,
            packagePath: asset.packagePath,
            packageSource: asset.ownerLabel,
            sourceContainer: asset.containerName,
            previewSource: "Direct decoded base-game export",
            lodCount: null,
            vertexCount: null,
            triangleCount: null,
            materialSlotCount: null,
            validationState: asset.validationState,
            conflictWinner: null,
            exportState: asset.exportState
          },
          problems: []
        };
      },
      getCreatorAssetReport: async ({
        assetIds,
        output
      }: {
        assetIds: string[];
        output: string;
      }) => {
        const details = assetIds.map((assetId) => creatorDetail(assetId));
        const text =
          output === "assetIndex" || output === "dependencyGraph"
            ? JSON.stringify(
                {
                  generatedAt: now,
                  output,
                  assets: details.map((detail) => detail.asset),
                  dependencies: details.flatMap(
                    (detail) => detail.dependencies
                  )
                },
                null,
                2
              )
            : [
                `Creator ${output}`,
                `Generated: ${now}`,
                `Active profile: ${activeSummary().name}`,
                ...details.map(
                  (detail) =>
                    `${detail.asset.label} ${detail.asset.conflictState}`
                )
              ].join("\n");

        return {
          status: "ready",
          output,
          generatedAt: now,
          fileName: `creator-${output}.txt`,
          mimeType:
            output === "assetIndex" || output === "dependencyGraph"
              ? "application/json"
              : "text/plain",
          text,
          problems: []
        };
      },
      restoreCmmChanges: async () => ({
        status: "ok",
        restoredFiles: [],
        removedFiles: [],
        problems: []
      }),
      getStorageLayout: async () => diagnosticSummary().storage,
      getDiagnosticsSummary: async () => diagnosticSummary(),
      getDiagnosticReport: async () => ({
        generatedAt: now,
        text: "CMM Diagnostic Report\\nSteam detected: yes"
      }),
      getLatestErrorsReport: async () => ({
        generatedAt: now,
        text: "Latest errors\\nDEPLOYMENT fake warning"
      }),
      recordRendererError: async () => ({
        status: "logged"
      }),
      openLogs: async () => ({
        status: "ok",
        path: "C:\\CMM\\logs",
        problems: []
      })
    };

    (window as any).cmm = cmm;
  });
});

test("smoke-tests first run and primary desktop flows", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("dialog", { name: "First-Run Setup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Find Clawed" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use Packaged Runtime" }).click();
  await expect(page.getByText("Packaged runtime configured.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Import or Create Profile")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Open Play" }).click();

  await expect(page.getByRole("heading", { name: "Launch Clawed" })).toBeVisible();
  await expect(page.getByText("Deployment Required")).toBeVisible();

  await page
    .getByRole("combobox", { name: "Switch active profile" })
    .selectOption("profile-raid");
  await expect(
    page.getByRole("combobox", { name: "Switch active profile" })
  ).toHaveValue("profile-raid");

  await page.getByRole("button", { name: "Mods" }).click();
  await expect(page.getByRole("heading", { name: "Local Mods" })).toBeVisible();
  await page.getByPlaceholder("Search mods").fill("female");
  await expect(page.getByText("Female Character A")).toBeVisible();
  await page.getByRole("button", { name: "Inspect" }).click();
  await expect(page.getByText("Creator Metadata")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Affected Assets" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Source Hashes" })
  ).toBeVisible();
  await page.getByPlaceholder("Search mods").fill("");
  await page.getByRole("button", { name: "Import Mod" }).first().click();
  await expect(
    page.getByText("Mod package imported: Character Framework.")
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Character Framework" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Creator" }).click();
  await expect(
    page.getByRole("heading", { name: "Creator Asset Workspace" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Asset Tree" })).toBeVisible();
  await page.getByPlaceholder("Search paths, objects, packages").fill("Utah");
  await expect(
    page.getByRole("button", { name: /T_Utah_Claws_D/ }).first()
  ).toBeVisible();
  await page.getByPlaceholder("Search paths, objects, packages").fill("");
  await page
    .getByRole("button", { name: /Clawed Base Game/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^Game\b/ }).first().click();
  await page.getByRole("button", { name: /^UtahRaptor\b/ }).first().click();
  await page.getByRole("button", { name: /^Meshes\b/ }).first().click();
  await page
    .getByRole("button", { name: /SK_Utah/ })
    .first()
    .click();
  await expect(
    page.getByText("Direct decoded base-game asset", { exact: true })
  ).toBeVisible();
  await expectModelViewportRendered(page);
  await page
    .getByRole("button", { name: /Clawed Base Game/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Package Payloads/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Female Character A 1\.0\.0/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^payload\b/ }).first().click();
  await page.getByRole("button", { name: /^Content\b/ }).first().click();
  await page.getByRole("button", { name: /^Paks\b/ }).first().click();
  await expect(
    page.getByRole("button", { name: /FemaleA_P\.pak/ }).first()
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Package Payloads/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Installed Package Assets/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Female Character A 1\.0\.0/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^Game\b/ }).first().click();
  await page.getByRole("button", { name: /^UtahRaptor\b/ }).first().click();
  await page.getByRole("button", { name: /^Textures\b/ }).first().click();
  await page
    .getByRole("button", { name: /T_Utah_Claws_D/ })
    .first()
    .click();
  await expect(page.getByText("Winner").first()).toBeVisible();
  await expect(page.getByText("Source Location")).toBeVisible();
  await expect(page.getByText("Package Container")).toBeVisible();
  await expect(page.getByText("Skeleton")).toBeVisible();
  await expect(page.getByText("Material Slots")).toBeVisible();
  await expect(
    page
      .getByTestId("creator-model-viewport")
      .getByText("Female Character A 1.0.0")
  ).toBeVisible();
  await expectModelViewportRendered(page);
  await expect(page.getByText("Dependency Hints")).toBeVisible();
  await expect(page.getByText("Base: present")).toBeVisible();
  await expect(page.getByText("Explicit conflicts: male-character")).toBeVisible();
  await expect(page.getByText("Load after: core-framework")).toBeVisible();
  await page.getByRole("button", { name: "Plan Index Export" }).click();
  await expect(page.getByText("Export plan: ready")).toBeVisible();
  await page.getByRole("button", { name: "Copy Metadata" }).click();
  await expect(page.getByText("Report: ready")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__copiedText as string))
    .toContain("assetIndex");
  await page.getByRole("button", { name: "Copy Dependencies" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__copiedText as string))
    .toContain("dependencyGraph");
  await page.getByRole("button", { name: "Copy Conflict Report" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__copiedText as string))
    .toContain("conflictReport");

  await page.getByRole("button", { exact: true, name: "Profiles" }).click();
  await page.getByLabel("New profile name").fill("Keyboard Profile");
  await page.getByLabel("New profile name").press("Enter");
  await expect(page.getByText("Keyboard Profile").first()).toBeVisible();

  await page.getByRole("button", { name: "Load Order" }).click();
  await expect(page.getByRole("heading", { name: "Logical Order" })).toBeVisible();
  await page.getByRole("button", { name: /Move Core Framework down/ }).click();
  await expect(page.getByText("Load order updated.")).toBeVisible();

  await page.getByRole("button", { name: "Modpacks" }).click();
  await expect(page.getByRole("heading", { name: "Friend Modpacks" })).toBeVisible();
  await page.getByRole("button", { name: "Share Current Profile" }).click();
  await expect(page.getByText(/Exported/)).toBeVisible();
  await page.getByRole("button", { name: "Import Friend's Modpack" }).click();
  await expect(page.getByText("Friend Pack")).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Imported Friend Pack.")).toBeVisible();

  await page.getByRole("button", { name: "Play" }).click();
  await page.getByRole("button", { name: "Launch Vanilla" }).click();
  await expect(page.getByText("Vanilla launch accepted.")).toBeVisible();
  await page.getByRole("button", { name: "Launch Modded" }).click();
  await expect(page.getByText("Modded launch accepted.")).toBeVisible();
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.getByText(/Forcing it closed may interrupt/)).toBeVisible();
  await page.getByRole("button", { name: "Force Close & Restart" }).click();
  await expect(page.getByText("Restart accepted.")).toBeVisible();

  await page.getByRole("button", { name: "Diagnostics" }).click();
  await expect(page.getByRole("heading", { name: "Support Snapshot" })).toBeVisible();
  await expect(page.getByText("Asset conflict targets")).toBeVisible();
  await expect(page.getByText("Load-order effects")).toBeVisible();
  await page.getByRole("button", { name: "Copy Report" }).click();
  await expect(page.getByText("Diagnostic report copied.")).toBeVisible();
  await page.getByRole("button", { name: "Open Logs" }).click();
  await expect(page.getByText("Logs folder opened.")).toBeVisible();
});

for (const viewport of responsiveViewports) {
  test(`renders primary pages at ${viewport.name} viewport`, async ({ page }) => {
    await page.setViewportSize({
      height: viewport.height,
      width: viewport.width
    });
    await page.goto("/");

    await expect(
      page.getByRole("dialog", { name: "First-Run Setup" })
    ).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
    await page.getByRole("button", { name: "Finish Later" }).click();

    const pages = [
      { nav: "Play", heading: "Launch Clawed" },
      { nav: "Mods", heading: "Local Mods" },
      { nav: "Creator", heading: "Creator Asset Workspace" },
      { nav: "Profiles", heading: "Mod Profiles" },
      { nav: "Load Order", heading: "Logical Order" },
      { nav: "Modpacks", heading: "Friend Modpacks" },
      { nav: "Diagnostics", heading: "Support Snapshot" },
      { nav: "Settings", heading: "Preferences" }
    ];

    for (const target of pages) {
      await page.getByRole("button", { exact: true, name: target.nav }).click();
      await expect(
        page.getByRole("heading", { name: target.heading })
      ).toBeVisible();
      if (target.nav === "Creator") {
        await expect(
          page.getByRole("heading", { name: "Asset Tree" })
        ).toBeVisible();
        await page
          .getByPlaceholder("Search paths, objects, packages")
          .fill("Utah");
        await expect(
          page.getByRole("button", { name: /T_Utah_Claws_D/ }).first()
        ).toBeVisible();
        await page
          .getByPlaceholder("Search paths, objects, packages")
          .fill("");
        await page
          .getByRole("button", { name: /Installed Package Assets/ })
          .first()
          .click();
        await page
          .getByRole("button", { name: /Female Character A 1\.0\.0/ })
          .first()
          .click();
        await page.getByRole("button", { name: /^Game\b/ }).first().click();
        await page
          .getByRole("button", { name: /^UtahRaptor\b/ })
          .first()
          .click();
        await page
          .getByRole("button", { name: /^Textures\b/ })
          .first()
          .click();
        await page
          .getByRole("button", { name: /T_Utah_Claws_D/ })
          .first()
          .click();
        await expect(page.getByText("Skeleton")).toBeVisible();
        await expectModelViewportRendered(page);
        await expect(page.getByText("Dependency Hints")).toBeVisible();
        await expect(page.getByText("Base: present")).toBeVisible();
        await page.getByRole("button", { name: "Copy Validation" }).click();
        await expect(page.getByText("Report: ready")).toBeVisible();
      }
      await expectNoDocumentHorizontalOverflow(page);
    }
  });
}
