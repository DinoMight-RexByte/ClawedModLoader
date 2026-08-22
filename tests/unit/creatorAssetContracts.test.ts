import { describe, expect, it } from "vitest";

import {
  ClawedModManifestV1Schema,
  CreatorAssetConflictGraphRequestSchema,
  CreatorAssetConflictSchema,
  CreatorAssetIndexEntrySchema,
  CreatorAssetMetadataV1Schema,
  CreatorAssetTreeRequestSchema,
  CreatorAssetTreeResultSchema,
  CreatorAssetReportResultSchema,
  CreatorAssetSearchRequestSchema,
  CreatorExportPlanResultSchema,
  CreatorMeshExportResultSchema,
  CreatorMeshPackageExportResultSchema,
  CreatorModelPreviewResultSchema,
  type CreatorAssetIndexEntry
} from "../../src/shared/contracts/app";
import {
  filterCreatorAssetIndexEntries,
  sortCreatorAssetIndexEntries
} from "../../src/main/services/assetRegistryService";
import { createFixtureManifest } from "../helpers/clawedModFixture";

const creatorAssets = CreatorAssetMetadataV1Schema.parse({
  schemaVersion: 1,
  affectedAssets: [
    {
      id: "target",
      assetClass: "Texture2D",
      packagePath: "/Game/UtahRaptor/Textures/T_Target",
      objectPath: "/Game/UtahRaptor/Textures/T_Target.T_Target",
      virtualPath: "/Clawed/Base/UtahRaptor/Textures/T_Target",
      source: "baseGame",
      role: "target",
      tags: ["texture_material_visuals"]
    },
    {
      id: "replacement",
      assetClass: "Texture2D",
      virtualPath: "/Packages/texture-target/1.0.0/Content/Paks/Target_P.pak",
      payloadPath: "payload/Content/Paks/Target_P.pak",
      source: "generated",
      role: "replacement",
      tags: ["texture_material_visuals"]
    }
  ],
  replacements: [
    {
      targetAssetId: "target",
      replacementAssetId: "replacement",
      targetObjectPath: "/Game/UtahRaptor/Textures/T_Target.T_Target",
      targetVirtualPath: "/Clawed/Base/UtahRaptor/Textures/T_Target",
      replacementVirtualPath:
        "/Packages/texture-target/1.0.0/Content/Paks/Target_P.pak",
      payloadPaths: ["payload/Content/Paks/Target_P.pak"],
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
      buildId: "24719259",
      status: "validated",
      evidence: "release validation fixture"
    }
  ],
  previewAssets: [
    {
      id: "thumb",
      payloadPath: "payload/previews/target.png",
      kind: "thumbnail",
      source: "generated"
    }
  ],
  importProvenance: [
    {
      sourceKind: "generated",
      sourceName: "unit fixture",
      sourceSha256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      sourceHashes: [
        {
          algorithm: "sha256",
          scope: "source",
          path: "unit fixture",
          sha256:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }
      ],
      rights: "generated"
    }
  ],
  assetDependencies: [
    {
      fromAssetId: "replacement",
      toAssetId: "target",
      fromVirtualPath:
        "/Packages/texture-target/1.0.0/Content/Paks/Target_P.pak",
      toObjectPath: "/Game/UtahRaptor/Textures/T_Target.T_Target",
      toPackagePath: "/Game/UtahRaptor/Textures/T_Target",
      toVirtualPath: "/Clawed/Base/UtahRaptor/Textures/T_Target",
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
});

describe("creator asset contracts", () => {
  it("keeps metadata-free manifest V1 packages valid", () => {
    const manifest = ClawedModManifestV1Schema.parse(createFixtureManifest());

    expect(manifest.creatorAssets).toBeUndefined();
  });

  it("accepts creatorAssets as an optional .clawedmod manifest extension", () => {
    const manifest = ClawedModManifestV1Schema.parse(
      createFixtureManifest({
        id: "texture-target",
        loader: "pak",
        creatorAssets
      })
    );

    expect(manifest.creatorAssets?.affectedAssets).toHaveLength(2);
    expect(manifest.creatorAssets?.replacements[0].deploymentRoute).toBe(
      "pak-iostore-existing-path"
    );
    expect(
      manifest.creatorAssets?.importProvenance[0].sourceHashes[0]?.sha256
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts model preview metadata for creator-owned package assets", () => {
    const manifest = ClawedModManifestV1Schema.parse(
      createFixtureManifest({
        id: "mesh-preview",
        loader: "pak",
        creatorAssets: {
          ...creatorAssets,
          previewAssets: [
            {
              id: "mesh-preview",
              payloadPath: "payload/previews/utah-preview.obj",
              kind: "model",
              assetClass: "SkeletalMesh",
              objectPath: "/Game/UtahRaptor/Meshes/SK_Utah.SK_Utah",
              source: "userOwned",
              format: "obj",
              modelRole: "skeletalMesh",
              skeleton: "/Game/UtahRaptor/Meshes/SKEL_Utah.SKEL_Utah",
              physicsAsset: "/Game/UtahRaptor/Meshes/PHYS_Utah.PHYS_Utah",
              materialSlots: [
                {
                  name: "Body",
                  materialPath:
                    "/Game/UtahRaptor/Materials/M_Utah_Body.M_Utah_Body"
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
                "/Game/UtahRaptor/Materials/M_Utah_Body.M_Utah_Body"
              ]
            }
          ]
        }
      })
    );
    const preview = manifest.creatorAssets?.previewAssets[0];

    expect(preview?.format).toBe("obj");
    expect(preview?.modelRole).toBe("skeletalMesh");
    expect(preview?.materialSlots[0].name).toBe("Body");
    expect(preview?.lods[0].screenSize).toBe(1);
  });

  it("defaults legacy preview asset model metadata", () => {
    const preview = creatorAssets.previewAssets[0];

    expect(preview.format).toBe("unknown");
    expect(preview.modelRole).toBe("unknown");
    expect(preview.materialSlots).toEqual([]);
    expect(preview.lods).toEqual([]);
  });

  it("rejects creator payload paths outside payload/", () => {
    expect(() =>
      CreatorAssetMetadataV1Schema.parse({
        ...creatorAssets,
        previewAssets: [
          {
            id: "bad",
            payloadPath: "../decoded-base.png",
            kind: "thumbnail",
            source: "generated"
          }
        ]
      })
    ).toThrow();
  });

  it("rejects cooked loose creator replacements when deployability requires pak", () => {
    expect(() =>
      ClawedModManifestV1Schema.parse(
        createFixtureManifest({
          loader: "loose",
          creatorAssets: {
            ...creatorAssets,
            cookTarget: undefined,
            replacements: [
              {
                targetAssetId: "target",
                replacementAssetId: "replacement",
                payloadPaths: ["payload/Content/Loose/T_Target.uasset"],
                deploymentRoute: "loose-non-cooked",
                validationState: "untested"
              }
            ]
          }
        })
      )
    ).toThrow();
  });

  it("rejects new Texture2D routes without AssetRegistry cook metadata", () => {
    expect(() =>
      ClawedModManifestV1Schema.parse(
        createFixtureManifest({
          loader: "pak",
          creatorAssets: {
            ...creatorAssets,
            cookTarget: {
              unrealVersion: "5.5.4",
              platform: "Windows",
              containerFormat: "pak+iostore",
              requiresAssetRegistry: false
            },
            replacements: [
              {
                targetAssetId: "target",
                replacementAssetId: "replacement",
                payloadPaths: ["payload/Content/Paks/Target_P.pak"],
                deploymentRoute: "pak-iostore-new-texture2d-asset-registry",
                validationState: "untested"
              }
            ]
          }
        })
      )
    ).toThrow();
  });

  it("normalizes creator asset search defaults", () => {
    const parsed = CreatorAssetSearchRequestSchema.parse({});

    expect(parsed.source).toBe("all");
    expect(parsed.conflictState).toBe("any");
    expect(parsed.physicalPath).toBe("");
    expect(parsed.objectPath).toBe("");
    expect(parsed.modUse).toBe("");
    expect(parsed.exportState).toBe("any");
    expect(parsed.sortBy).toBe("relevance");
    expect(parsed.sortDirection).toBe("asc");
    expect(parsed.limit).toBe(80);
  });

  it("filters and sorts creator asset browser entries by indexed metadata", () => {
    const entries = creatorBrowserEntries();
    const filtered = filterCreatorAssetIndexEntries(
      entries,
      CreatorAssetSearchRequestSchema.parse({
        query: "FemaleA",
        source: "installedPackage",
        objectPath: "/Game/UtahRaptor",
        tags: ["texture_material_visuals"],
        assetClass: "texture",
        modUse: "replacement",
        packageId: "female-a",
        conflictState: "winner",
        validationState: "validated",
        exportState: "exportable",
        activeOnly: true
      })
    );
    const physicalPathMatches = filterCreatorAssetIndexEntries(
      entries,
      CreatorAssetSearchRequestSchema.parse({
        source: "packagePayload",
        physicalPath: "payload/Content/Paks"
      })
    );
    const sorted = sortCreatorAssetIndexEntries(
      entries,
      CreatorAssetSearchRequestSchema.parse({
        sortBy: "physicalPath",
        sortDirection: "desc"
      })
    );

    expect(filtered.map((entry) => entry.id)).toEqual([
      "asset:female-a@1.0.0:target"
    ]);
    expect(physicalPathMatches.map((entry) => entry.id)).toEqual([
      "payload:female-a@1.0.0:female-a-pak"
    ]);
    expect(sorted[0].id).toBe("payload:female-a@1.0.0:female-a-pak");
  });

  it("defaults virtual paths in creator index entries for older callers", () => {
    const entry = CreatorAssetIndexEntrySchema.parse({
      id: "asset:test",
      label: "Test",
      source: "installedPackage",
      ownerLabel: "Package",
      packageId: "package",
      packageVersion: "1.0.0",
      packageName: "Package",
      loader: "pak",
      activeProfileEnabled: false,
      activeProfileOrder: null,
      assetClass: "Texture2D",
      packagePath: "/Game/Test/T_Test",
      objectPath: "/Game/Test/T_Test.T_Test",
      payloadPath: null,
      relativePath: null,
      extension: null,
      tags: [],
      modUses: null,
      sizeBytes: null,
      sha256: null,
      validationState: null,
      deploymentRoute: null,
      exportState: null,
      conflictState: "none"
    });

    expect(entry.virtualPath).toBeNull();
  });

  it("validates export plan responses", () => {
    const parsed = CreatorExportPlanResultSchema.parse({
      status: "blocked",
      output: "clawedmod",
      items: [],
      problems: []
    });

    expect(parsed.output).toBe("clawedmod");
  });

  it("validates creator asset tree responses", () => {
    const request = CreatorAssetTreeRequestSchema.parse({
      parentId: null,
      source: "baseGameMap",
      activeOnly: false
    });
    const result = CreatorAssetTreeResultSchema.parse({
      generatedAt: "2026-08-15T12:00:00.000Z",
      parentId: null,
      nodes: [
        {
          id: "root|baseGameMap",
          label: "Clawed Base Game",
          kind: "root",
          source: "baseGameMap",
          path: "",
          assetId: null,
          hasChildren: true,
          childCount: 1
        },
        {
          id: "asset|asset%3Afemale-a%401.0.0%3Atarget",
          label: "T_Utah_Claws_D.T_Utah_Claws_D",
          kind: "asset",
          source: "installedPackage",
          path: "Female Character A 1.0.0/Game/UtahRaptor/Textures/T_Utah_Claws_D.T_Utah_Claws_D",
          assetId: "asset:female-a@1.0.0:target",
          hasChildren: false,
          childCount: 0,
          assetClass: "Texture2D",
          packageName: "Female Character A",
          validationState: "validated",
          conflictState: "winner",
          exportState: "exportable",
          viewportState: "viewable"
        }
      ],
      totalChildren: 2,
      truncated: false,
      problems: []
    });

    expect(request.limit).toBe(200);
    expect(result.nodes[0].kind).toBe("root");
    expect(result.nodes[1].assetClass).toBe("Texture2D");
    expect(result.nodes[1].viewportState).toBe("viewable");
  });

  it("defaults expanded conflict graph resolver metadata", () => {
    const request = CreatorAssetConflictGraphRequestSchema.parse({
      objectPath: "/Game/UtahRaptor/Textures/T_Target.T_Target"
    });
    const conflict = CreatorAssetConflictSchema.parse({
      targetKey: "object:/game/utahraptor/textures/t_target.t_target",
      targetPackagePath: "/Game/UtahRaptor/Textures/T_Target",
      targetObjectPath: "/Game/UtahRaptor/Textures/T_Target.T_Target",
      baseGamePresent: true,
      winnerPackageId: null,
      winnerPackageVersion: null,
      entries: [
        {
          packageId: "texture-target",
          packageVersion: "1.0.0",
          packageName: "Texture Target",
          loader: "pak",
          enabled: true,
          profileOrder: 1,
          validationState: "validated",
          deploymentRoute: "pak-iostore-existing-path",
          payloadPaths: ["payload/Content/Paks/Target_P.pak"],
          targetAssetIds: ["target"],
          isWinner: true
        }
      ]
    });

    expect(request.includeInactive).toBe(false);
    expect(conflict.targetVirtualPath).toBeNull();
    expect(conflict.loadOrderEffects).toEqual([]);
    expect(conflict.entries[0].contributesReplacement).toBe(true);
    expect(conflict.entries[0].dependencies).toEqual([]);
  });

  it("validates creator asset report responses", () => {
    const parsed = CreatorAssetReportResultSchema.parse({
      status: "ready",
      output: "assetIndex",
      generatedAt: "2026-08-15T12:00:00.000Z",
      fileName: "creator-assetIndex.json",
      mimeType: "application/json",
      text: "{}",
      problems: []
    });

    expect(parsed.output).toBe("assetIndex");
  });

  it("validates creator model preview responses", () => {
    const asset = creatorBrowserEntries()[1];
    const parsed = CreatorModelPreviewResultSchema.parse({
      status: "available",
      asset,
      preview: {
        id: "mesh-preview",
        payloadPath: "payload/previews/utah-preview.obj",
        kind: "model",
        source: "userOwned",
        format: "obj",
        modelRole: "skeletalMesh",
        skeleton: "/Game/UtahRaptor/Meshes/SKEL_Utah.SKEL_Utah",
        physicsAsset: null,
        materialSlots: [{ name: "Body", materialPath: null }],
        lods: [
          {
            index: 0,
            screenSize: 1,
            triangleCount: 1200,
            vertexCount: 700
          }
        ],
        dependencyPaths: ["/Game/UtahRaptor/Materials/M_Utah_Body"]
      },
      activeWinner: null,
      model: {
        dataUrl: "data:text/plain;base64,diAwIDAgMA==",
        format: "obj",
        source: "userOwned",
        fileName: "utah-preview.obj",
        sizeBytes: 8
      },
      metadata: {
        skeleton: "/Game/UtahRaptor/Meshes/SKEL_Utah.SKEL_Utah",
        physicsAsset: null,
        materialSlots: [{ name: "Body", materialPath: null }],
        lods: [
          {
            index: 0,
            screenSize: 1,
            triangleCount: 1200,
            vertexCount: 700
          }
        ],
        dependencyPaths: ["/Game/UtahRaptor/Materials/M_Utah_Body"],
        targetObjectPath: "/Game/UtahRaptor/Meshes/SK_Utah.SK_Utah",
        packageSource: "Female Character A",
        validationState: "validated",
        conflictWinner: "Female Character A 1.0.0",
        exportState: "exportable"
      },
      problems: []
    });

    expect(parsed.model?.format).toBe("obj");
    expect(parsed.metadata.exportState).toBe("exportable");
    expect(
      CreatorModelPreviewResultSchema.parse({
        ...parsed,
        preview: null,
        model: {
          dataUrl: "data:model/gltf-binary;base64,AAAA",
          format: "glb",
          source: "decodedBaseGame",
          fileName: "sk-utah.glb",
          sizeBytes: 4
        }
      }).model?.source
    ).toBe("decodedBaseGame");
    expect(
      CreatorModelPreviewResultSchema.parse({
        ...parsed,
        metadata: {
          ...parsed.metadata,
          meshType: "skeleton"
        },
        model: {
          dataUrl: "data:text/plain;base64,diAwIDAgMA==",
          format: "obj",
          source: "packagePayload",
          fileName: "direct.obj",
          sizeBytes: 8
        }
      }).model?.source
    ).toBe("packagePayload");
  });

  it("validates creator mesh export responses", () => {
    const asset = creatorBrowserEntries()[0];
    const parsed = CreatorMeshExportResultSchema.parse({
      status: "exported",
      asset,
      format: "obj",
      destinationPath: "C:\\Exports\\mesh.obj",
      bytesWritten: 128,
      metadata: {
        skeleton: null,
        physicsAsset: null,
        materialSlots: [],
        lods: [],
        dependencyPaths: [],
        targetObjectPath: asset.objectPath,
        packageSource: "Clawed base game",
        validationState: null,
        conflictWinner: null,
        exportState: "exportable"
      },
      problems: []
    });

    expect(parsed.format).toBe("obj");
    expect(parsed.metadata.previewSource).toBeNull();
  });

  it("validates creator mesh package export responses", () => {
    const asset = creatorBrowserEntries()[0];
    const parsed = CreatorMeshPackageExportResultSchema.parse({
      status: "exported",
      destinationPath: "C:\\Exports\\visible.clawedmod",
      bytesWritten: 512,
      itemCount: 1,
      exportedCount: 1,
      items: [
        {
          asset,
          status: "exported",
          format: "obj",
          payloadPath: "payload/creator-exports/01-visible.obj",
          bytesWritten: 128,
          metadata: {
            meshType: "skeleton",
            skeleton: asset.objectPath,
            physicsAsset: null,
            materialSlots: [],
            lods: [],
            dependencyPaths: [],
            targetObjectPath: asset.objectPath,
            packageSource: "Clawed base game",
            validationState: null,
            conflictWinner: null,
            exportState: "exportable"
          },
          problems: []
        }
      ],
      problems: []
    });

    expect(parsed.items[0]?.metadata.meshType).toBe("skeleton");
  });
});

function creatorBrowserEntries(): CreatorAssetIndexEntry[] {
  return [
    CreatorAssetIndexEntrySchema.parse({
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
    }),
    CreatorAssetIndexEntrySchema.parse({
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
    }),
    CreatorAssetIndexEntrySchema.parse({
      id: "payload:female-a@1.0.0:female-a-pak",
      label: "payload/Content/Paks/FemaleA_P.pak",
      source: "packagePayload",
      ownerLabel: "Female Character A",
      packageId: "female-a",
      packageVersion: "1.0.0",
      packageName: "Female Character A",
      containerName: "FemaleA_P.pak",
      loader: "pak",
      activeProfileEnabled: true,
      activeProfileOrder: 2,
      assetClass: "PakIoStoreContainer",
      packagePath: null,
      objectPath: null,
      virtualPath: "/Packages/female-a/1.0.0/Content/Paks/FemaleA_P.pak",
      payloadPath: "payload/Content/Paks/FemaleA_P.pak",
      relativePath: "payload/Content/Paks/FemaleA_P.pak",
      extension: ".pak",
      tags: ["texture_material_visuals"],
      modUses: "replacement",
      sizeBytes: 1024,
      sha256: "b".repeat(64),
      validationState: null,
      deploymentRoute: null,
      exportState: "exportable",
      conflictState: "none"
    })
  ];
}
