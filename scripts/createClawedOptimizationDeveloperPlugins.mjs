import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import JSZip from "jszip";
import {
  currentClawedSteamBuildId,
  generatedSupportedSteamBuilds
} from "./clawedBuildMetadata.mjs";

const collectionId = "ClawedOptimizationDeveloperPlugins";
const version = "0.1.0-devdrop.20260818";
const outputRoot = path.resolve(
  process.env.CMM_OPTIMIZATION_DEV_PLUGIN_OUTPUT_DIR ??
    path.join("release", "developer-handoff")
);
const steamBuildId = await currentClawedSteamBuildId();
const steamBuildNotes =
  "Developer source handoff generated against current local package metadata; requires Clawed source integration, compile, profiling, and gameplay validation.";

const gameCodeFindings = [
  "Current local manifest lists ShaderArchive-Clawed and ShaderArchive-Global bytecode for SM5 and SM6, but no explicit PSO or pipeline-cache file was identified.",
  "Current local manifest lists large Prehistoria_Park generated map families, including _Generated_ and _GENERATED/Live4 assets.",
  "Current local manifest lists AI master, AI controller, behavior tree, state tree, navigation, spawner, and creature-specific AI assets.",
  "Current local manifest lists ReplicationGraph, AdvancedSessions, AdvancedSteamSessions, Steamworks, and EOS runtime targets.",
  "Steam/EOS DLLs are research boundaries only. This package does not patch, replace, bypass, disable, or tamper with runtime DLLs or anti-cheat."
];

const plugins = [
  psoPlugin(),
  worldPlugin(),
  aiReplicationPlugin(),
  runtimeIntegrityPlugin()
];

await mkdir(outputRoot, { recursive: true });

const artifacts = [];
for (const plugin of plugins) {
  artifacts.push(await writePluginPackage(plugin));
}

const indexPath = path.join(outputRoot, `${collectionId}-${version}.index.json`);
const readmePath = path.join(outputRoot, `${collectionId}-${version}.DEVELOPER_README.md`);
await writeFile(
  indexPath,
  `${JSON.stringify(
    {
      result: "GENERATED",
      collectionId,
      version,
      generatedAt: new Date().toISOString(),
      artifactType: "developer-source-plugin-index",
      notAClawedMod: true,
      supportedSteamBuilds: generatedSupportedSteamBuilds(steamBuildId, steamBuildNotes),
      gameCodeFindings,
      plugins: artifacts.map((artifact) => ({
        name: artifact.pluginName,
        packagePath: artifact.packagePath,
        summaryPath: artifact.summaryPath,
        readmePath: artifact.readmePath,
        packageSha256: artifact.packageSha256
      }))
    },
    null,
    2
  )}\n`
);
await writeFile(readmePath, ensureTrailingNewline(rootReadme()));

process.stdout.write(
  artifacts
    .flatMap((artifact) => [
      artifact.packagePath,
      artifact.summaryPath,
      artifact.readmePath
    ])
    .concat(indexPath, readmePath)
    .join("\n") + "\n"
);

async function writePluginPackage(plugin) {
  const packagePath = path.join(outputRoot, `${plugin.name}-${version}.zip`);
  const summaryPath = path.join(outputRoot, `${plugin.name}-${version}.summary.json`);
  const readmePath = path.join(outputRoot, `${plugin.name}-${version}.DEVELOPER_README.md`);
  const files = Object.fromEntries(
    Object.entries(plugin.files).map(([entryPath, content]) => [
      `${plugin.name}/${entryPath}`,
      content
    ])
  );
  const checksums = {
    schemaVersion: 1,
    packageId: plugin.name,
    collectionId,
    version,
    generatedAt: new Date().toISOString(),
    files: Object.entries(files).map(([entryPath, content]) => ({
      path: entryPath,
      sha256: sha256Text(content)
    }))
  };

  const zip = new JSZip();
  for (const [entryPath, content] of Object.entries(files)) {
    zip.file(entryPath, ensureTrailingNewline(content));
  }
  zip.file(`${plugin.name}/checksums.json`, `${JSON.stringify(checksums, null, 2)}\n`);

  await writeFile(packagePath, await zip.generateAsync({ type: "nodebuffer" }));
  await writeFile(readmePath, ensureTrailingNewline(plugin.files["README.md"]));

  const summary = {
    result: "GENERATED",
    packageId: plugin.name,
    pluginName: plugin.name,
    collectionId,
    version,
    packagePath,
    summaryPath,
    readmePath,
    packageSha256: await sha256File(packagePath),
    artifactType: "developer-source-plugin-handoff",
    notAClawedMod: true,
    installTarget: `Copy ${plugin.name} into the Clawed source tree under Clawed/Plugins/${plugin.name}`,
    supportedSteamBuilds: generatedSupportedSteamBuilds(steamBuildId, steamBuildNotes),
    issue: plugin.issue,
    purpose: plugin.purpose,
    safeBoundary: plugin.safeBoundary,
    validationRequired: plugin.validationRequired,
    gameCodeFindings,
    blockedBehaviors: [
      "CMM runtime deployment for this source-level change",
      "original game-file overwrite",
      "loose cooked Unreal asset override",
      "Steam/EOS DLL patching",
      "native binary patching",
      "anti-cheat disablement, evasion, tampering, or bypass"
    ],
    packageEntries: Object.keys(files).concat(`${plugin.name}/checksums.json`)
  };

  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  return {
    pluginName: plugin.name,
    packagePath,
    summaryPath,
    readmePath,
    packageSha256: summary.packageSha256
  };
}

async function sha256File(targetPath) {
  return crypto.createHash("sha256").update(await readFile(targetPath)).digest("hex");
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(ensureTrailingNewline(value), "utf8").digest("hex");
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function psoPlugin() {
  const name = "ClawedPsoShaderCache";
  return {
    name,
    issue: "PSO/shader cache generation",
    purpose:
      "Adds a source-side startup subsystem that applies shader-pipeline-cache CVars, emits warmup markers, and gives developers a narrow integration point for PSO capture runs.",
    safeBoundary:
      "Does not generate a shipping cache by itself and does not patch cooked shader archives.",
    validationRequired: [
      "Compile in the Clawed UE 5.5 source project",
      "Run packaged Development and Shipping captures with first load, first outdoor view, first water entry, first combat, and first weather transition",
      "Merge recorded PSO data through the project pipeline and verify the shipped cache is mounted",
      "Compare cold-start and first-encounter hitch metrics before and after"
    ],
    files: {
      [`${name}.uplugin`]: descriptor({
        name,
        friendlyName: "Clawed PSO Shader Cache",
        description:
          "Source-side shader and PSO cache warmup hooks for Clawed performance validation."
      }),
      [`Source/${name}/${name}.Build.cs`]: buildCs(name, []),
      [`Source/${name}/Public/${name}Module.h`]: moduleHeader(name),
      [`Source/${name}/Private/${name}Module.cpp`]: moduleCpp(name),
      [`Source/${name}/Public/ClawedPsoShaderCacheSubsystem.h`]: psoSubsystemHeader(),
      [`Source/${name}/Private/ClawedPsoShaderCacheSubsystem.cpp`]: psoSubsystemCpp(),
      "README.md": pluginReadme({
        title: "Clawed PSO Shader Cache",
        purpose:
          "Use this in source builds to turn shader-cache work into repeatable capture and warmup passes.",
        integration: [
          "Copy `ClawedPsoShaderCache` to `Clawed/Plugins/ClawedPsoShaderCache`.",
          "Regenerate project files and compile Development Editor and packaged Development builds.",
          "Enable the plugin, launch representative scenes, and collect first-run hitch data.",
          "Use the project's normal Unreal PSO collection and merge process before shipping any stable cache."
        ],
        validation: [
          "First outdoor view",
          "First water entry",
          "First combat",
          "First weather transition",
          "Cold restart after deleting local driver shader cache"
        ],
        boundaries: [
          "No cooked shader archive patching",
          "No PSO cache claim until the merged cache is shipped and profiled",
          "No CMM runtime deployment"
        ]
      })
    }
  };
}

function worldPlugin() {
  const name = "ClawedWorldStreamingAudit";
  return {
    name,
    issue: "World Partition/HLOD/streaming layout",
    purpose:
      "Adds a source-side world subsystem that reports streaming-level, actor, component, primitive, collision, and HLOD-like counts during gameplay traversal.",
    safeBoundary:
      "Reports layout pressure only. Developers still need source-side World Partition, HLOD, data-layer, cell-size, and map-content edits.",
    validationRequired: [
      "Compile in the Clawed UE 5.5 source project",
      "Run repeatable traversal routes through Prehistoria_Park, water, foliage, interiors, and transition zones",
      "Compare streaming-level counts, loaded actor counts, collision-enabled primitive counts, and HLOD-like actor counts before and after layout changes",
      "Validate save/load, collision, navigation, and map travel after any streaming or HLOD edit"
    ],
    files: {
      [`${name}.uplugin`]: descriptor({
        name,
        friendlyName: "Clawed World Streaming Audit",
        description:
          "Source-side world traversal audit hooks for World Partition, HLOD, streaming, collision, and component pressure."
      }),
      [`Source/${name}/${name}.Build.cs`]: buildCs(name, []),
      [`Source/${name}/Public/${name}Module.h`]: moduleHeader(name),
      [`Source/${name}/Private/${name}Module.cpp`]: moduleCpp(name),
      [`Source/${name}/Public/ClawedWorldStreamingAuditSubsystem.h`]: worldSubsystemHeader(),
      [`Source/${name}/Private/ClawedWorldStreamingAuditSubsystem.cpp`]: worldSubsystemCpp(),
      "README.md": pluginReadme({
        title: "Clawed World Streaming Audit",
        purpose:
          "Use this to identify overloaded traversal zones before changing World Partition cells, HLODs, streaming ranges, always-loaded actors, collision, or dense repeated content.",
        integration: [
          "Copy `ClawedWorldStreamingAudit` to `Clawed/Plugins/ClawedWorldStreamingAudit`.",
          "Regenerate project files and compile.",
          "Run fixed traversal routes and capture log samples every five seconds.",
          "Make source map/layout changes only after the repeated pressure points are visible in the logs."
        ],
        validation: [
          "Prehistoria_Park generated map traversal",
          "Large interiors",
          "Dense foliage and water views",
          "Cell boundary crossings",
          "Return-to-menu and reload"
        ],
        boundaries: [
          "No cooked map patching",
          "No automatic actor deletion",
          "No CMM runtime deployment"
        ]
      })
    }
  };
}

function aiReplicationPlugin() {
  const name = "ClawedAiReplicationAudit";
  return {
    name,
    issue: "AI/pathing/combat/replication correctness",
    purpose:
      "Adds a source-side gameplay subsystem that reports AI controller load, active path-following, pawn counts, replicated actor counts, and network role distribution.",
    safeBoundary:
      "Does not change combat authority, AI decisions, hit detection, or replication. It is the source-side evidence layer before fixes.",
    validationRequired: [
      "Compile in the Clawed UE 5.5 source project",
      "Run combat scenes with 1, 3, 6, and 10 active dinosaurs",
      "Run host/client sessions before any replication correctness claim",
      "Compare AI pathing state, replicated actor counts, role distribution, and server/client logs before and after fixes"
    ],
    files: {
      [`${name}.uplugin`]: descriptor({
        name,
        friendlyName: "Clawed AI Replication Audit",
        description:
          "Source-side AI, path-following, combat-load, and replication audit hooks for Clawed."
      }),
      [`Source/${name}/${name}.Build.cs`]: buildCs(name, [
        "AIModule",
        "NavigationSystem",
        "NetCore"
      ]),
      [`Source/${name}/Public/${name}Module.h`]: moduleHeader(name),
      [`Source/${name}/Private/${name}Module.cpp`]: moduleCpp(name),
      [`Source/${name}/Public/ClawedAiReplicationAuditSubsystem.h`]: aiSubsystemHeader(),
      [`Source/${name}/Private/ClawedAiReplicationAuditSubsystem.cpp`]: aiSubsystemCpp(),
      "README.md": pluginReadme({
        title: "Clawed AI Replication Audit",
        purpose:
          "Use this to capture AI, pathing, combat, and replication pressure before changing behavior trees, state trees, spawners, hit detection, or replicated authority state.",
        integration: [
          "Copy `ClawedAiReplicationAudit` to `Clawed/Plugins/ClawedAiReplicationAudit`.",
          "Regenerate project files and compile.",
          "Run single-player combat scenarios, then run host/client sessions.",
          "Use matching server and client logs before changing AI or replicated state."
        ],
        validation: [
          "Passive roaming",
          "Aggro acquisition",
          "Melee attack",
          "Lost target",
          "Late join",
          "Disconnect and reconnect"
        ],
        boundaries: [
          "No server-authoritative state mutation in this plugin",
          "No combat damage rewrites",
          "No multiplayer claim without host/client evidence"
        ]
      })
    }
  };
}

function runtimeIntegrityPlugin() {
  const name = "ClawedRuntimeIntegrityGuard";
  return {
    name,
    issue: "DLL/native engine patching or anti-cheat-sensitive behavior",
    purpose:
      "Adds a source-side report-only guard that logs sensitive runtime boundaries and exposes a hard false runtime-patching permission query.",
    safeBoundary:
      "Does not patch DLLs, hook native engine binaries, disable anti-cheat, evade anti-cheat, or alter Steam/EOS files.",
    validationRequired: [
      "Compile in the Clawed UE 5.5 source project",
      "Confirm the guard logs Steam/EOS/runtime boundary files without modifying them",
      "Confirm source-side fixes route through project code, config, OnlineSubsystem adapters, or normal engine extension points",
      "Block any release task that depends on binary patching or anti-cheat evasion"
    ],
    files: {
      [`${name}.uplugin`]: descriptor({
        name,
        friendlyName: "Clawed Runtime Integrity Guard",
        description:
          "Source-side report-only guard for native runtime, DLL, Steam/EOS, and anti-cheat-sensitive boundaries."
      }),
      [`Source/${name}/${name}.Build.cs`]: buildCs(name, []),
      [`Source/${name}/Public/${name}Module.h`]: moduleHeader(name),
      [`Source/${name}/Private/${name}Module.cpp`]: moduleCpp(name),
      [`Source/${name}/Public/ClawedRuntimeIntegrityGuardSubsystem.h`]: integritySubsystemHeader(),
      [`Source/${name}/Private/ClawedRuntimeIntegrityGuardSubsystem.cpp`]: integritySubsystemCpp(),
      "README.md": pluginReadme({
        title: "Clawed Runtime Integrity Guard",
        purpose:
          "Use this as a source-side release blocker for native patching proposals and anti-cheat-sensitive runtime changes.",
        integration: [
          "Copy `ClawedRuntimeIntegrityGuard` to `Clawed/Plugins/ClawedRuntimeIntegrityGuard`.",
          "Regenerate project files and compile.",
          "Keep `IsRuntimePatchingAllowed` returning false.",
          "Route performance and networking changes through source code, config, OnlineSubsystem adapters, or validated engine extension points."
        ],
        validation: [
          "Clean launch",
          "Steam/EOS file boundary log",
          "Packaged Development build",
          "Packaged Shipping build",
          "Multiplayer login/session smoke test"
        ],
        boundaries: [
          "No DLL replacement",
          "No native patching",
          "No anti-cheat disablement, evasion, tampering, or bypass"
        ]
      })
    }
  };
}

function descriptor({ name, friendlyName, description }) {
  return JSON.stringify(
    {
      FileVersion: 3,
      Version: 1,
      VersionName: version,
      FriendlyName: friendlyName,
      Description: description,
      Category: "Optimization",
      CreatedBy: "Clawed Mod Manager",
      CanContainContent: false,
      IsBetaVersion: true,
      Installed: false,
      Modules: [
        {
          Name: name,
          Type: "Runtime",
          LoadingPhase: "Default"
        }
      ]
    },
    null,
    2
  );
}

function buildCs(name, extraDeps) {
  const deps = [
    "Core",
    "CoreUObject",
    "Engine",
    ...extraDeps
  ];
  return `using UnrealBuildTool;

public class ${name} : ModuleRules
{
    public ${name}(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[]
        {
${deps.map((dep) => `            "${dep}"`).join(",\n")}
        });
    }
}`;
}

function moduleHeader(name) {
  return `#pragma once

#include "Modules/ModuleManager.h"

class F${name}Module final : public IModuleInterface
{
public:
    virtual void StartupModule() override;
    virtual void ShutdownModule() override;
};`;
}

function moduleCpp(name) {
  return `#include "${name}Module.h"

#include "Modules/ModuleManager.h"

IMPLEMENT_MODULE(F${name}Module, ${name})

DEFINE_LOG_CATEGORY_STATIC(Log${name}, Log, All);

void F${name}Module::StartupModule()
{
    UE_LOG(Log${name}, Display, TEXT("${name} startup"));
}

void F${name}Module::ShutdownModule()
{
    UE_LOG(Log${name}, Display, TEXT("${name} shutdown"));
}`;
}

function psoSubsystemHeader() {
  return `#pragma once

#include "Subsystems/WorldSubsystem.h"
#include "ClawedPsoShaderCacheSubsystem.generated.h"

UCLASS()
class CLAWEDPSOSHADERCACHE_API UClawedPsoShaderCacheSubsystem : public UWorldSubsystem
{
    GENERATED_BODY()

public:
    virtual void OnWorldBeginPlay(UWorld& InWorld) override;

private:
    void Exec(UWorld& World, const TCHAR* Command) const;
};`;
}

function psoSubsystemCpp() {
  return `#include "ClawedPsoShaderCacheSubsystem.h"

#include "Engine/Engine.h"
#include "Engine/World.h"

DEFINE_LOG_CATEGORY_STATIC(LogClawedPsoShaderCache, Log, All);

void UClawedPsoShaderCacheSubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
    if (!InWorld.IsGameWorld())
    {
        return;
    }

    Exec(InWorld, TEXT("r.ShaderPipelineCache.Enabled 1"));
    Exec(InWorld, TEXT("r.ShaderPipelineCache.StartupMode 3"));
    Exec(InWorld, TEXT("r.ShaderPipelineCache.BatchTime 8"));
    Exec(InWorld, TEXT("r.ShaderPipelineCache.BackgroundBatchTime 2"));
    Exec(InWorld, TEXT("r.ShaderPipelineCache.BatchSize 50"));
    Exec(InWorld, TEXT("stat unit"));
    Exec(InWorld, TEXT("stat shadercompiling"));
    UE_LOG(LogClawedPsoShaderCache, Display, TEXT("warmup_targets=first_load,first_outdoor_view,first_water_entry,first_combat,first_weather_transition"));
}

void UClawedPsoShaderCacheSubsystem::Exec(UWorld& World, const TCHAR* Command) const
{
    const bool bRan = GEngine != nullptr && GEngine->Exec(&World, Command);
    UE_LOG(LogClawedPsoShaderCache, Display, TEXT("command=%s result=%s"), Command, bRan ? TEXT("true") : TEXT("false"));
}`;
}

function worldSubsystemHeader() {
  return `#pragma once

#include "Subsystems/WorldSubsystem.h"
#include "TimerManager.h"
#include "ClawedWorldStreamingAuditSubsystem.generated.h"

UCLASS()
class CLAWEDWORLDSTREAMINGAUDIT_API UClawedWorldStreamingAuditSubsystem : public UWorldSubsystem
{
    GENERATED_BODY()

public:
    virtual void OnWorldBeginPlay(UWorld& InWorld) override;
    virtual void Deinitialize() override;

private:
    FTimerHandle AuditTimer;
    void Audit();
};`;
}

function worldSubsystemCpp() {
  return `#include "ClawedWorldStreamingAuditSubsystem.h"

#include "Components/PrimitiveComponent.h"
#include "Engine/LevelStreaming.h"
#include "Engine/World.h"
#include "EngineUtils.h"

DEFINE_LOG_CATEGORY_STATIC(LogClawedWorldStreamingAudit, Log, All);

void UClawedWorldStreamingAuditSubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
    if (!InWorld.IsGameWorld())
    {
        return;
    }

    InWorld.GetTimerManager().SetTimer(AuditTimer, this, &UClawedWorldStreamingAuditSubsystem::Audit, 5.0f, true, 1.0f);
}

void UClawedWorldStreamingAuditSubsystem::Deinitialize()
{
    if (UWorld* World = GetWorld())
    {
        World->GetTimerManager().ClearTimer(AuditTimer);
    }

    Super::Deinitialize();
}

void UClawedWorldStreamingAuditSubsystem::Audit()
{
    UWorld* World = GetWorld();
    if (!World || !World->IsGameWorld())
    {
        return;
    }

    int32 LoadedStreamingLevels = 0;
    const TArray<ULevelStreaming*>& StreamingLevels = World->GetStreamingLevels();
    for (ULevelStreaming* StreamingLevel : StreamingLevels)
    {
        if (StreamingLevel && StreamingLevel->IsLevelLoaded())
        {
            ++LoadedStreamingLevels;
        }
    }

    int32 Actors = 0;
    int32 HlodLikeActors = 0;
    int32 PrimitiveComponents = 0;
    int32 VisiblePrimitiveComponents = 0;
    int32 CollisionEnabledPrimitiveComponents = 0;

    for (TActorIterator<AActor> It(World); It; ++It)
    {
        AActor* Actor = *It;
        if (!Actor || Actor->IsPendingKillPending())
        {
            continue;
        }

        ++Actors;
        const FString ActorName = Actor->GetName();
        const FString ClassName = Actor->GetClass() ? Actor->GetClass()->GetName() : FString();
        if (ActorName.Contains(TEXT("HLOD")) || ClassName.Contains(TEXT("HLOD")))
        {
            ++HlodLikeActors;
        }

        TArray<UPrimitiveComponent*> Components;
        Actor->GetComponents<UPrimitiveComponent>(Components);
        for (UPrimitiveComponent* Component : Components)
        {
            if (!Component || !Component->IsRegistered())
            {
                continue;
            }

            ++PrimitiveComponents;
            if (Component->IsVisible())
            {
                ++VisiblePrimitiveComponents;
            }
            if (Component->IsCollisionEnabled())
            {
                ++CollisionEnabledPrimitiveComponents;
            }
        }
    }

    UE_LOG(LogClawedWorldStreamingAudit, Display, TEXT("streaming loaded=%d total=%d actors=%d hlod_like=%d primitives=%d visible_primitives=%d collision_primitives=%d map=%s"),
        LoadedStreamingLevels,
        StreamingLevels.Num(),
        Actors,
        HlodLikeActors,
        PrimitiveComponents,
        VisiblePrimitiveComponents,
        CollisionEnabledPrimitiveComponents,
        *World->GetMapName());
}`;
}

function aiSubsystemHeader() {
  return `#pragma once

#include "Subsystems/WorldSubsystem.h"
#include "TimerManager.h"
#include "ClawedAiReplicationAuditSubsystem.generated.h"

UCLASS()
class CLAWEDAIREPLICATIONAUDIT_API UClawedAiReplicationAuditSubsystem : public UWorldSubsystem
{
    GENERATED_BODY()

public:
    virtual void OnWorldBeginPlay(UWorld& InWorld) override;
    virtual void Deinitialize() override;

private:
    FTimerHandle AuditTimer;
    void Audit();
};`;
}

function aiSubsystemCpp() {
  return `#include "ClawedAiReplicationAuditSubsystem.h"

#include "AIController.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "Navigation/PathFollowingComponent.h"
#include "NavigationSystem.h"

DEFINE_LOG_CATEGORY_STATIC(LogClawedAiReplicationAudit, Log, All);

void UClawedAiReplicationAuditSubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
    if (!InWorld.IsGameWorld())
    {
        return;
    }

    InWorld.GetTimerManager().SetTimer(AuditTimer, this, &UClawedAiReplicationAuditSubsystem::Audit, 3.0f, true, 1.0f);
}

void UClawedAiReplicationAuditSubsystem::Deinitialize()
{
    if (UWorld* World = GetWorld())
    {
        World->GetTimerManager().ClearTimer(AuditTimer);
    }

    Super::Deinitialize();
}

void UClawedAiReplicationAuditSubsystem::Audit()
{
    UWorld* World = GetWorld();
    if (!World || !World->IsGameWorld())
    {
        return;
    }

    int32 AiControllers = 0;
    int32 MovingControllers = 0;
    int32 Pawns = 0;
    int32 ReplicatedActors = 0;
    int32 AuthorityActors = 0;
    int32 AutonomousProxyActors = 0;
    int32 SimulatedProxyActors = 0;

    for (TActorIterator<AAIController> It(World); It; ++It)
    {
        AAIController* Controller = *It;
        if (!Controller || Controller->IsPendingKillPending())
        {
            continue;
        }

        ++AiControllers;
        const UPathFollowingComponent* PathFollowing = Controller->GetPathFollowingComponent();
        if (PathFollowing && PathFollowing->GetStatus() != EPathFollowingStatus::Idle)
        {
            ++MovingControllers;
        }
    }

    for (TActorIterator<APawn> It(World); It; ++It)
    {
        APawn* Pawn = *It;
        if (Pawn && !Pawn->IsPendingKillPending())
        {
            ++Pawns;
        }
    }

    for (TActorIterator<AActor> It(World); It; ++It)
    {
        AActor* Actor = *It;
        if (!Actor || Actor->IsPendingKillPending())
        {
            continue;
        }

        if (Actor->GetIsReplicated())
        {
            ++ReplicatedActors;
        }

        switch (Actor->GetLocalRole())
        {
        case ROLE_Authority:
            ++AuthorityActors;
            break;
        case ROLE_AutonomousProxy:
            ++AutonomousProxyActors;
            break;
        case ROLE_SimulatedProxy:
            ++SimulatedProxyActors;
            break;
        default:
            break;
        }
    }

    const UNavigationSystemV1* NavSystem = FNavigationSystem::GetCurrent<UNavigationSystemV1>(World);
    const bool bHasNavData = NavSystem && NavSystem->GetMainNavData() != nullptr;

    UE_LOG(LogClawedAiReplicationAudit, Display, TEXT("ai_controllers=%d moving_ai=%d pawns=%d replicated=%d authority=%d autonomous=%d simulated=%d nav_ready=%s net_mode=%d"),
        AiControllers,
        MovingControllers,
        Pawns,
        ReplicatedActors,
        AuthorityActors,
        AutonomousProxyActors,
        SimulatedProxyActors,
        bHasNavData ? TEXT("true") : TEXT("false"),
        static_cast<int32>(World->GetNetMode()));
}`;
}

function integritySubsystemHeader() {
  return `#pragma once

#include "Subsystems/WorldSubsystem.h"
#include "ClawedRuntimeIntegrityGuardSubsystem.generated.h"

UCLASS()
class CLAWEDRUNTIMEINTEGRITYGUARD_API UClawedRuntimeIntegrityGuardSubsystem : public UWorldSubsystem
{
    GENERATED_BODY()

public:
    virtual void OnWorldBeginPlay(UWorld& InWorld) override;

    UFUNCTION(BlueprintPure, Category="Clawed Runtime Integrity")
    bool IsRuntimePatchingAllowed() const;

private:
    void ScanRuntimeBoundaries() const;
};`;
}

function integritySubsystemCpp() {
  return `#include "ClawedRuntimeIntegrityGuardSubsystem.h"

#include "HAL/FileManager.h"
#include "Misc/Paths.h"

DEFINE_LOG_CATEGORY_STATIC(LogClawedRuntimeIntegrityGuard, Log, All);

void UClawedRuntimeIntegrityGuardSubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
    if (!InWorld.IsGameWorld())
    {
        return;
    }

    UE_LOG(LogClawedRuntimeIntegrityGuard, Display, TEXT("runtime_patching_allowed=false"));
    ScanRuntimeBoundaries();
}

bool UClawedRuntimeIntegrityGuardSubsystem::IsRuntimePatchingAllowed() const
{
    return false;
}

void UClawedRuntimeIntegrityGuardSubsystem::ScanRuntimeBoundaries() const
{
    const FString Root = FPaths::ConvertRelativePathToFull(FPaths::RootDir());
    const TArray<FString> Patterns = {
        TEXT("steam_api64.dll"),
        TEXT("EOSSDK-Win64-Shipping.dll"),
        TEXT("*EasyAntiCheat*"),
        TEXT("*BattlEye*"),
        TEXT("*anti*cheat*")
    };

    for (const FString& Pattern : Patterns)
    {
        TArray<FString> Found;
        IFileManager::Get().FindFilesRecursive(Found, *Root, *Pattern, true, false, true);
        UE_LOG(LogClawedRuntimeIntegrityGuard, Warning, TEXT("runtime_boundary pattern=%s matches=%d action=report_only patching_allowed=false"), *Pattern, Found.Num());
    }
}`;
}

function pluginReadme({ title, purpose, integration, validation, boundaries }) {
  return [
    `# ${title}`,
    "",
    purpose,
    "",
    "This is a developer source plugin for the Clawed Unreal project. It is not a `.clawedmod`, not a UE4SS runtime mod, and not an executable patch.",
    "",
    "## Integration",
    "",
    ...integration.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Validation",
    "",
    ...validation.map((item) => `- ${item}`),
    "",
    "## Boundaries",
    "",
    ...boundaries.map((item) => `- ${item}`)
  ].join("\n");
}

function rootReadme() {
  return [
    "# Clawed Optimization Developer Plugins",
    "",
    "Developer source handoff for the four optimization areas that should not be claimed as normal CMM-resolved mods.",
    "",
    "These plugins are intended for a Clawed source checkout under `Clawed/Plugins/<PluginName>`. They are not `.clawedmod` packages, not UE4SS runtime mods, and not binary patches.",
    "",
    "## Included Plugins",
    "",
    ...plugins.map((plugin) => `- \`${plugin.name}\`: ${plugin.issue}. ${plugin.purpose}`),
    "",
    "## Current Game-Code Findings",
    "",
    ...gameCodeFindings.map((finding) => `- ${finding}`),
    "",
    "## Required Validation",
    "",
    "- Compile each plugin in the Clawed UE 5.5 source project.",
    "- Run packaged Development profiling before and after source changes.",
    "- Run packaged Shipping validation before any release claim.",
    "- Run host/client validation before any AI, combat, pathing, or replication correctness claim.",
    "- Keep binary patching, Steam/EOS DLL replacement, native tampering, and anti-cheat bypass out of scope."
  ].join("\n");
}
