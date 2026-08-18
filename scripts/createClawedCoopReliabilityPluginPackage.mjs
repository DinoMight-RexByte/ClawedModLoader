import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import JSZip from "jszip";
import {
  currentClawedSteamBuildId,
  generatedSupportedSteamBuilds
} from "./clawedBuildMetadata.mjs";

const packageId = "ClawedCoopReliabilityPlugin";
const pluginName = "ClawedCoopReliability";
const version = "0.1.0-devdrop.20260817";
const steamBuildId = await currentClawedSteamBuildId();
const steamBuildNotes =
  "Developer source handoff generated against current package metadata; requires integration, compile, and host/client validation inside the Clawed source tree.";
const outputRoot = path.resolve(
  process.env.CMM_COOP_RELIABILITY_OUTPUT_DIR ??
    path.join("release", "developer-handoff")
);
const packagePath = path.join(outputRoot, `${packageId}-${version}.zip`);
const summaryPath = path.join(outputRoot, `${packageId}-${version}.summary.json`);
const developerReadmePath = path.join(
  outputRoot,
  `${packageId}-${version}.DEVELOPER_README.md`
);

const files = {
  [`${pluginName}/${pluginName}.uplugin`]: pluginDescriptor(),
  [`${pluginName}/Config/DefaultClawedCoopReliability.ini`]: defaultConfig(),
  [`${pluginName}/Source/${pluginName}/${pluginName}.Build.cs`]: buildCs(),
  [`${pluginName}/Source/${pluginName}/Public/ClawedCoopReliabilityModule.h`]: moduleHeader(),
  [`${pluginName}/Source/${pluginName}/Private/ClawedCoopReliabilityModule.cpp`]: moduleCpp(),
  [`${pluginName}/Source/${pluginName}/Public/ClawedCoopTypes.h`]: typesHeader(),
  [`${pluginName}/Source/${pluginName}/Public/ClawedCoopReliabilitySettings.h`]: settingsHeader(),
  [`${pluginName}/Source/${pluginName}/Private/ClawedCoopReliabilitySettings.cpp`]: settingsCpp(),
  [`${pluginName}/Source/${pluginName}/Public/ClawedCoopNetDriver.h`]: netDriverHeader(),
  [`${pluginName}/Source/${pluginName}/Private/ClawedCoopNetDriver.cpp`]: netDriverCpp(),
  [`${pluginName}/Source/${pluginName}/Public/ClawedCoopSessionSubsystem.h`]: sessionSubsystemHeader(),
  [`${pluginName}/Source/${pluginName}/Private/ClawedCoopSessionSubsystem.cpp`]: sessionSubsystemCpp(),
  [`${pluginName}/Source/${pluginName}/Public/ClawedCoopAuthorityStateComponent.h`]: authorityComponentHeader(),
  [`${pluginName}/Source/${pluginName}/Private/ClawedCoopAuthorityStateComponent.cpp`]: authorityComponentCpp(),
  [`${pluginName}/Source/${pluginName}/Public/ClawedCoopPlayerSyncComponent.h`]: playerSyncComponentHeader(),
  [`${pluginName}/Source/${pluginName}/Private/ClawedCoopPlayerSyncComponent.cpp`]: playerSyncComponentCpp(),
  [`${pluginName}/README.md`]: readme(),
  [`${pluginName}/DEVELOPER_INTEGRATION_README.md`]: devIntegrationReadme(),
  [`${pluginName}/Docs/ARCHITECTURE.md`]: architectureDoc(),
  [`${pluginName}/Docs/CLAWED_BINDINGS.md`]: bindingsDoc(),
  [`${pluginName}/Docs/INTEGRATION_CHECKLIST.md`]: checklistDoc(),
  [`${pluginName}/Docs/VALIDATION_PLAN.md`]: validationDoc()
};

await mkdir(outputRoot, { recursive: true });

const checksums = {
  schemaVersion: 1,
  packageId,
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
zip.file(`${pluginName}/checksums.json`, `${JSON.stringify(checksums, null, 2)}\n`);
await writeFile(packagePath, await zip.generateAsync({ type: "nodebuffer" }));
await writeFile(developerReadmePath, ensureTrailingNewline(devIntegrationReadme()));

const summary = {
  result: "GENERATED",
  packageId,
  pluginName,
  version,
  packagePath,
  developerReadmePath,
  packageSha256: await sha256File(packagePath),
  supportedSteamBuilds: generatedSupportedSteamBuilds(steamBuildId, steamBuildNotes),
  artifactType: "developer-source-handoff",
  installTarget: "Clawed/Plugins/ClawedCoopReliability inside the developer source tree",
  notAClawedMod: true,
  modules: [
    "ClawedCoopSessionSubsystem",
    "ClawedCoopNetDriver",
    "ClawedCoopAuthorityStateComponent",
    "ClawedCoopPlayerSyncComponent",
    "ClawedCoopReliabilitySettings"
  ],
  replacesOrOwns: [
    "session lifecycle state",
    "join/host/find/invite orchestration",
    "travel readiness handshake",
    "player spawn/catch-up authority requests",
    "inventory/save/world-item state-frame contracts",
    "NetDriver connection lifecycle instrumentation and replacement point"
  ],
  adapterBoundaries: [
    "OnlineSubsystem remains a pluggable transport adapter for Steam/EOS session discovery",
    "Clawed UI widgets call the subsystem instead of owning session flow",
    "GameState/PlayerState/PlayerController carry replicated state frames and readiness acks",
    "existing InventorySystemPro components are wrapped by snapshot/delta adapters, not mutated blindly"
  ],
  validationRequired: [
    "compile in the Clawed UE 5.5 source project",
    "bind BP_MenuSystemGameInstance_FDG and multiplayer widgets to the subsystem",
    "register or adapt the NetDriver definition for the project's active transport",
    "run two-account Steam/EOS host/join/invite/travel tests",
    "run inventory, save/load, world-item, disconnect, reconnect, and late-join resync tests"
  ],
  packageEntries: Object.keys(files).concat(`${pluginName}/checksums.json`)
};

await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${packagePath}\n${summaryPath}\n`);

async function sha256File(targetPath) {
  return crypto.createHash("sha256").update(await readFile(targetPath)).digest("hex");
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(ensureTrailingNewline(value), "utf8").digest("hex");
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function pluginDescriptor() {
  return JSON.stringify(
    {
      FileVersion: 3,
      Version: 1,
      VersionName: version,
      FriendlyName: "Clawed Coop Reliability",
      Description:
        "Developer-integrated co-op reliability layer for replacing fragile lobby/session ownership and adding authoritative sync contracts.",
      Category: "Networking",
      CreatedBy: "Clawed Mod Manager",
      CanContainContent: false,
      IsBetaVersion: true,
      Installed: false,
      Modules: [
        {
          Name: pluginName,
          Type: "Runtime",
          LoadingPhase: "Default"
        }
      ],
      Plugins: [
        {
          Name: "OnlineSubsystem",
          Enabled: true
        },
        {
          Name: "OnlineSubsystemUtils",
          Enabled: true
        }
      ]
    },
    null,
    2
  );
}

function defaultConfig() {
  return [
    "[/Script/Engine.Engine]",
    "+NetDriverDefinitions=(DefName=\"GameNetDriver\",DriverClassName=\"/Script/ClawedCoopReliability.ClawedCoopNetDriver\",DriverClassNameFallback=\"/Script/OnlineSubsystemUtils.IpNetDriver\")",
    "",
    "[/Script/ClawedCoopReliability.ClawedCoopReliabilitySettings]",
    "SessionName=GameSession",
    "TravelMap=/Game/Maps/GameplayEntry",
    "JoinTimeoutSeconds=30.000000",
    "TravelReadyTimeoutSeconds=45.000000",
    "ResyncTimeoutSeconds=15.000000",
    "DefaultPublicConnections=4",
    "bUsePresence=true",
    "bUseLobbiesIfAvailable=true",
    "bAdvertiseSessions=true",
    "bAllowInvites=true",
    "bRequireStateFrameAckBeforePlay=true"
  ].join("\n");
}

function buildCs() {
  return String.raw`using UnrealBuildTool;

public class ClawedCoopReliability : ModuleRules
{
    public ClawedCoopReliability(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "CoreUObject",
            "DeveloperSettings",
            "Engine",
            "NetCore",
            "OnlineSubsystem",
            "OnlineSubsystemUtils"
        });
        PrivateDependencyModuleNames.AddRange(new[]
        {
            "Json",
            "JsonUtilities",
            "Networking",
            "Sockets"
        });
    }
}`;
}

function moduleHeader() {
  return String.raw`#pragma once

#include "Modules/ModuleManager.h"

class FClawedCoopReliabilityModule final : public IModuleInterface
{
public:
    virtual void StartupModule() override;
    virtual void ShutdownModule() override;
};`;
}

function moduleCpp() {
  return String.raw`#include "ClawedCoopReliabilityModule.h"

#include "Modules/ModuleManager.h"

IMPLEMENT_MODULE(FClawedCoopReliabilityModule, ClawedCoopReliability)

DEFINE_LOG_CATEGORY_STATIC(LogClawedCoopReliability, Log, All);

void FClawedCoopReliabilityModule::StartupModule()
{
    UE_LOG(LogClawedCoopReliability, Display, TEXT("ClawedCoopReliability startup"));
}

void FClawedCoopReliabilityModule::ShutdownModule()
{
    UE_LOG(LogClawedCoopReliability, Display, TEXT("ClawedCoopReliability shutdown"));
}`;
}

function typesHeader() {
  return String.raw`#pragma once

#include "CoreMinimal.h"
#include "ClawedCoopTypes.generated.h"

UENUM(BlueprintType)
enum class EClawedCoopSessionPhase : uint8
{
    Idle,
    Hosting,
    Finding,
    Joining,
    Traveling,
    AwaitingReady,
    Synchronizing,
    InSession,
    Recovering,
    Leaving,
    Failed
};

UENUM(BlueprintType)
enum class EClawedCoopFailureCode : uint8
{
    None,
    Busy,
    MissingOnlineSubsystem,
    MissingSessionInterface,
    HostFailed,
    FindFailed,
    JoinFailed,
    ResolveConnectStringFailed,
    TravelFailed,
    ReadyTimeout,
    ResyncTimeout,
    InvalidRequest,
    AuthorityRejected,
    SaveFrameMismatch
};

UENUM(BlueprintType)
enum class EClawedCoopStateDomain : uint8
{
    Session,
    Player,
    Spawn,
    Inventory,
    Equipment,
    WorldItem,
    SaveGame
};

USTRUCT(BlueprintType)
struct FClawedCoopHostRequest
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 PublicConnections = 4;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    bool bFriendsOnly = true;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    bool bUseLan = false;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString TravelMap;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FString SessionDisplayName;
};

USTRUCT(BlueprintType)
struct FClawedCoopSearchResultView
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    int32 Index = INDEX_NONE;

    UPROPERTY(BlueprintReadOnly)
    FString HostName;

    UPROPERTY(BlueprintReadOnly)
    int32 OpenPublicConnections = 0;

    UPROPERTY(BlueprintReadOnly)
    int32 MaxPublicConnections = 0;

    UPROPERTY(BlueprintReadOnly)
    bool bIsLan = false;

    UPROPERTY(BlueprintReadOnly)
    int32 PingMs = 0;
};

USTRUCT(BlueprintType)
struct FClawedCoopSessionView
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    EClawedCoopSessionPhase Phase = EClawedCoopSessionPhase::Idle;

    UPROPERTY(BlueprintReadOnly)
    EClawedCoopFailureCode LastFailure = EClawedCoopFailureCode::None;

    UPROPERTY(BlueprintReadOnly)
    FGuid FlowId;

    UPROPERTY(BlueprintReadOnly)
    FString Detail;

    UPROPERTY(BlueprintReadOnly)
    TArray<FClawedCoopSearchResultView> SearchResults;
};

USTRUCT(BlueprintType)
struct FClawedCoopInventoryEntry
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FName ItemId = NAME_None;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 Quantity = 0;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 Revision = 0;
};

USTRUCT(BlueprintType)
struct FClawedCoopPlayerFrame
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FGuid PlayerId;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 Epoch = 0;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FTransform LastAuthoritativeSpawn;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TArray<FClawedCoopInventoryEntry> Inventory;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TArray<FName> EquippedItemIds;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    bool bReadyForPlay = false;
};

USTRUCT(BlueprintType)
struct FClawedCoopWorldItemFrame
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FGuid ItemInstanceId;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FName ItemId = NAME_None;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FTransform Transform;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 Revision = 0;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    bool bConsumed = false;
};

USTRUCT(BlueprintType)
struct FClawedCoopStateFrame
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FGuid FlowId;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 Epoch = 0;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TArray<FClawedCoopPlayerFrame> Players;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TArray<FClawedCoopWorldItemFrame> WorldItems;
};`;
}

function settingsHeader() {
  return String.raw`#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "ClawedCoopReliabilitySettings.generated.h"

UCLASS(Config=Game, DefaultConfig, meta=(DisplayName="Clawed Coop Reliability"))
class CLAWEDCOOPRELIABILITY_API UClawedCoopReliabilitySettings : public UDeveloperSettings
{
    GENERATED_BODY()

public:
    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Session")
    FName SessionName = NAME_GameSession;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Session")
    FString TravelMap = TEXT("/Game/Maps/GameplayEntry");

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Session")
    int32 DefaultPublicConnections = 4;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Session")
    bool bUsePresence = true;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Session")
    bool bUseLobbiesIfAvailable = true;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Session")
    bool bAdvertiseSessions = true;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Session")
    bool bAllowInvites = true;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Timeouts")
    float JoinTimeoutSeconds = 30.0f;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Timeouts")
    float TravelReadyTimeoutSeconds = 45.0f;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Timeouts")
    float ResyncTimeoutSeconds = 15.0f;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="State")
    bool bRequireStateFrameAckBeforePlay = true;
};`;
}

function settingsCpp() {
  return String.raw`#include "ClawedCoopReliabilitySettings.h"`;
}

function netDriverHeader() {
  return String.raw`#pragma once

#include "CoreMinimal.h"
#include "IpNetDriver.h"
#include "ClawedCoopNetDriver.generated.h"

UCLASS(Transient, Config=Engine)
class CLAWEDCOOPRELIABILITY_API UClawedCoopNetDriver : public UIpNetDriver
{
    GENERATED_BODY()

public:
    virtual bool InitListen(FNetworkNotify* InNotify, FURL& LocalURL, bool bReuseAddressAndPort, FString& Error) override;
    virtual bool InitConnect(FNetworkNotify* InNotify, FURL& ConnectURL, FString& Error) override;
    virtual void TickDispatch(float DeltaTime) override;
    virtual void Shutdown() override;

private:
    double LastDispatchLogSeconds = 0.0;
};`;
}

function netDriverCpp() {
  return String.raw`#include "ClawedCoopNetDriver.h"

#include "Engine/Engine.h"

DEFINE_LOG_CATEGORY_STATIC(LogClawedCoopNetDriver, Log, All);

bool UClawedCoopNetDriver::InitListen(FNetworkNotify* InNotify, FURL& LocalURL, bool bReuseAddressAndPort, FString& Error)
{
    UE_LOG(LogClawedCoopNetDriver, Display, TEXT("InitListen url=%s reuse=%s"), *LocalURL.ToString(), bReuseAddressAndPort ? TEXT("true") : TEXT("false"));
    const bool bResult = Super::InitListen(InNotify, LocalURL, bReuseAddressAndPort, Error);
    UE_LOG(LogClawedCoopNetDriver, Display, TEXT("InitListen result=%s error=%s"), bResult ? TEXT("true") : TEXT("false"), *Error);
    return bResult;
}

bool UClawedCoopNetDriver::InitConnect(FNetworkNotify* InNotify, FURL& ConnectURL, FString& Error)
{
    UE_LOG(LogClawedCoopNetDriver, Display, TEXT("InitConnect url=%s"), *ConnectURL.ToString());
    const bool bResult = Super::InitConnect(InNotify, ConnectURL, Error);
    UE_LOG(LogClawedCoopNetDriver, Display, TEXT("InitConnect result=%s error=%s"), bResult ? TEXT("true") : TEXT("false"), *Error);
    return bResult;
}

void UClawedCoopNetDriver::TickDispatch(float DeltaTime)
{
    Super::TickDispatch(DeltaTime);
    const double Now = FPlatformTime::Seconds();
    if (Now - LastDispatchLogSeconds >= 10.0)
    {
        LastDispatchLogSeconds = Now;
        UE_LOG(LogClawedCoopNetDriver, VeryVerbose, TEXT("TickDispatch connections=%d client=%s server=%s"), ClientConnections.Num(), ServerConnection ? TEXT("true") : TEXT("false"), GetWorld() && GetWorld()->GetNetMode() != NM_Client ? TEXT("true") : TEXT("false"));
    }
}

void UClawedCoopNetDriver::Shutdown()
{
    UE_LOG(LogClawedCoopNetDriver, Display, TEXT("Shutdown connections=%d"), ClientConnections.Num());
    Super::Shutdown();
}`;
}

function sessionSubsystemHeader() {
  return String.raw`#pragma once

#include "CoreMinimal.h"
#include "Interfaces/OnlineSessionInterface.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "ClawedCoopTypes.h"
#include "ClawedCoopSessionSubsystem.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FClawedCoopSessionViewChanged, const FClawedCoopSessionView&, View);

UCLASS()
class CLAWEDCOOPRELIABILITY_API UClawedCoopSessionSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    bool HostSession(const FClawedCoopHostRequest& Request);

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    bool FindSessions();

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    bool JoinSearchResult(int32 SearchResultIndex);

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    bool LeaveSession();

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    void RecoverToIdle(FString Reason);

    UFUNCTION(BlueprintPure, Category="Clawed Coop")
    FClawedCoopSessionView GetSessionView() const;

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    void MarkLocalPlayerTravelReady(APlayerController* PlayerController, int32 ClientEpoch);

    UPROPERTY(BlueprintAssignable, Category="Clawed Coop")
    FClawedCoopSessionViewChanged OnSessionViewChanged;

private:
    IOnlineSessionPtr GetSessionInterface() const;
    void Transition(EClawedCoopSessionPhase Phase, EClawedCoopFailureCode Failure, const FString& Detail);
    void StartTimeout(float Seconds, EClawedCoopFailureCode FailureCode, const FString& Detail);
    void ClearTimeout();
    void HandleTimeout(EClawedCoopFailureCode FailureCode, FString Detail);
    void HandleCreateSessionComplete(FName CompletedSessionName, bool bWasSuccessful);
    void HandleFindSessionsComplete(bool bWasSuccessful);
    void HandleJoinSessionComplete(FName CompletedSessionName, EOnJoinSessionCompleteResult::Type Result);
    void HandleDestroySessionComplete(FName CompletedSessionName, bool bWasSuccessful);
    void TravelHostAfterCreate();
    bool ClientTravelToResolvedSession();
    void CacheSearchResults();

    FClawedCoopSessionView View;
    FClawedCoopHostRequest PendingHostRequest;
    TSharedPtr<FOnlineSessionSearch> ActiveSearch;
    TArray<FOnlineSessionSearchResult> NativeSearchResults;
    FDelegateHandle CreateSessionHandle;
    FDelegateHandle FindSessionsHandle;
    FDelegateHandle JoinSessionHandle;
    FDelegateHandle DestroySessionHandle;
    FTimerHandle TimeoutHandle;
};`;
}

function sessionSubsystemCpp() {
  return String.raw`#include "ClawedCoopSessionSubsystem.h"

#include "ClawedCoopReliabilitySettings.h"
#include "Engine/Engine.h"
#include "Engine/LocalPlayer.h"
#include "GameFramework/PlayerController.h"
#include "Online/OnlineSessionNames.h"
#include "OnlineSubsystem.h"
#include "TimerManager.h"

DEFINE_LOG_CATEGORY_STATIC(LogClawedCoopSessionSubsystem, Log, All);

void UClawedCoopSessionSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);
    View.Phase = EClawedCoopSessionPhase::Idle;
    View.FlowId = FGuid::NewGuid();
    View.Detail = TEXT("initialized");
}

void UClawedCoopSessionSubsystem::Deinitialize()
{
    ClearTimeout();
    if (const IOnlineSessionPtr Sessions = GetSessionInterface())
    {
        if (CreateSessionHandle.IsValid()) Sessions->ClearOnCreateSessionCompleteDelegate_Handle(CreateSessionHandle);
        if (FindSessionsHandle.IsValid()) Sessions->ClearOnFindSessionsCompleteDelegate_Handle(FindSessionsHandle);
        if (JoinSessionHandle.IsValid()) Sessions->ClearOnJoinSessionCompleteDelegate_Handle(JoinSessionHandle);
        if (DestroySessionHandle.IsValid()) Sessions->ClearOnDestroySessionCompleteDelegate_Handle(DestroySessionHandle);
    }
    Super::Deinitialize();
}

bool UClawedCoopSessionSubsystem::HostSession(const FClawedCoopHostRequest& Request)
{
    if (View.Phase != EClawedCoopSessionPhase::Idle && View.Phase != EClawedCoopSessionPhase::Failed)
    {
        Transition(View.Phase, EClawedCoopFailureCode::Busy, TEXT("host denied while another flow is active"));
        return false;
    }
    const IOnlineSessionPtr Sessions = GetSessionInterface();
    if (!Sessions)
    {
        Transition(EClawedCoopSessionPhase::Failed, EClawedCoopFailureCode::MissingSessionInterface, TEXT("session interface missing"));
        return false;
    }
    const UClawedCoopReliabilitySettings* Settings = GetDefault<UClawedCoopReliabilitySettings>();
    PendingHostRequest = Request;
    if (PendingHostRequest.TravelMap.IsEmpty())
    {
        PendingHostRequest.TravelMap = Settings->TravelMap;
    }
    FOnlineSessionSettings SessionSettings;
    SessionSettings.NumPublicConnections = FMath::Max(1, Request.PublicConnections > 0 ? Request.PublicConnections : Settings->DefaultPublicConnections);
    SessionSettings.bIsLANMatch = Request.bUseLan;
    SessionSettings.bShouldAdvertise = Settings->bAdvertiseSessions;
    SessionSettings.bAllowInvites = Settings->bAllowInvites;
    SessionSettings.bAllowJoinInProgress = true;
    SessionSettings.bAllowJoinViaPresence = Settings->bUsePresence;
    SessionSettings.bUsesPresence = Settings->bUsePresence;
    SessionSettings.bUseLobbiesIfAvailable = Settings->bUseLobbiesIfAvailable;
    SessionSettings.Set(SETTING_MAPNAME, PendingHostRequest.TravelMap, EOnlineDataAdvertisementType::ViaOnlineService);
    if (!Request.SessionDisplayName.IsEmpty())
    {
        SessionSettings.Set(FName(TEXT("CLAWED_SESSION_NAME")), Request.SessionDisplayName, EOnlineDataAdvertisementType::ViaOnlineService);
    }
    CreateSessionHandle = Sessions->AddOnCreateSessionCompleteDelegate_Handle(FOnCreateSessionCompleteDelegate::CreateUObject(this, &ThisClass::HandleCreateSessionComplete));
    Transition(EClawedCoopSessionPhase::Hosting, EClawedCoopFailureCode::None, TEXT("creating session"));
    StartTimeout(Settings->JoinTimeoutSeconds, EClawedCoopFailureCode::HostFailed, TEXT("create session timeout"));
    if (!Sessions->CreateSession(0, Settings->SessionName, SessionSettings))
    {
        Sessions->ClearOnCreateSessionCompleteDelegate_Handle(CreateSessionHandle);
        Transition(EClawedCoopSessionPhase::Failed, EClawedCoopFailureCode::HostFailed, TEXT("CreateSession returned false"));
        return false;
    }
    return true;
}

bool UClawedCoopSessionSubsystem::FindSessions()
{
    if (View.Phase != EClawedCoopSessionPhase::Idle && View.Phase != EClawedCoopSessionPhase::Failed)
    {
        Transition(View.Phase, EClawedCoopFailureCode::Busy, TEXT("find denied while another flow is active"));
        return false;
    }
    const IOnlineSessionPtr Sessions = GetSessionInterface();
    if (!Sessions)
    {
        Transition(EClawedCoopSessionPhase::Failed, EClawedCoopFailureCode::MissingSessionInterface, TEXT("session interface missing"));
        return false;
    }
    const UClawedCoopReliabilitySettings* Settings = GetDefault<UClawedCoopReliabilitySettings>();
    ActiveSearch = MakeShared<FOnlineSessionSearch>();
    ActiveSearch->bIsLanQuery = false;
    ActiveSearch->MaxSearchResults = 64;
    ActiveSearch->QuerySettings.Set(SEARCH_PRESENCE, Settings->bUsePresence, EOnlineComparisonOp::Equals);
    FindSessionsHandle = Sessions->AddOnFindSessionsCompleteDelegate_Handle(FOnFindSessionsCompleteDelegate::CreateUObject(this, &ThisClass::HandleFindSessionsComplete));
    Transition(EClawedCoopSessionPhase::Finding, EClawedCoopFailureCode::None, TEXT("finding sessions"));
    StartTimeout(Settings->JoinTimeoutSeconds, EClawedCoopFailureCode::FindFailed, TEXT("find sessions timeout"));
    if (!Sessions->FindSessions(0, ActiveSearch.ToSharedRef()))
    {
        Sessions->ClearOnFindSessionsCompleteDelegate_Handle(FindSessionsHandle);
        Transition(EClawedCoopSessionPhase::Failed, EClawedCoopFailureCode::FindFailed, TEXT("FindSessions returned false"));
        return false;
    }
    return true;
}

bool UClawedCoopSessionSubsystem::JoinSearchResult(int32 SearchResultIndex)
{
    const IOnlineSessionPtr Sessions = GetSessionInterface();
    if (!Sessions)
    {
        Transition(EClawedCoopSessionPhase::Failed, EClawedCoopFailureCode::MissingSessionInterface, TEXT("session interface missing"));
        return false;
    }
    if (!NativeSearchResults.IsValidIndex(SearchResultIndex))
    {
        Transition(EClawedCoopSessionPhase::Failed, EClawedCoopFailureCode::InvalidRequest, FString::Printf(TEXT("invalid search index %d"), SearchResultIndex));
        return false;
    }
    const UClawedCoopReliabilitySettings* Settings = GetDefault<UClawedCoopReliabilitySettings>();
    JoinSessionHandle = Sessions->AddOnJoinSessionCompleteDelegate_Handle(FOnJoinSessionCompleteDelegate::CreateUObject(this, &ThisClass::HandleJoinSessionComplete));
    Transition(EClawedCoopSessionPhase::Joining, EClawedCoopFailureCode::None, FString::Printf(TEXT("joining search index %d"), SearchResultIndex));
    StartTimeout(Settings->JoinTimeoutSeconds, EClawedCoopFailureCode::JoinFailed, TEXT("join timeout"));
    if (!Sessions->JoinSession(0, Settings->SessionName, NativeSearchResults[SearchResultIndex]))
    {
        Sessions->ClearOnJoinSessionCompleteDelegate_Handle(JoinSessionHandle);
        Transition(EClawedCoopSessionPhase::Failed, EClawedCoopFailureCode::JoinFailed, TEXT("JoinSession returned false"));
        return false;
    }
    return true;
}

bool UClawedCoopSessionSubsystem::LeaveSession()
{
    const IOnlineSessionPtr Sessions = GetSessionInterface();
    if (!Sessions)
    {
        RecoverToIdle(TEXT("leave with no session interface"));
        return false;
    }
    DestroySessionHandle = Sessions->AddOnDestroySessionCompleteDelegate_Handle(FOnDestroySessionCompleteDelegate::CreateUObject(this, &ThisClass::HandleDestroySessionComplete));
    Transition(EClawedCoopSessionPhase::Leaving, EClawedCoopFailureCode::None, TEXT("destroying session"));
    return Sessions->DestroySession(GetDefault<UClawedCoopReliabilitySettings>()->SessionName);
}

void UClawedCoopSessionSubsystem::RecoverToIdle(FString Reason)
{
    ClearTimeout();
    NativeSearchResults.Reset();
    View.SearchResults.Reset();
    Transition(EClawedCoopSessionPhase::Idle, EClawedCoopFailureCode::None, Reason);
}

FClawedCoopSessionView UClawedCoopSessionSubsystem::GetSessionView() const
{
    return View;
}

void UClawedCoopSessionSubsystem::MarkLocalPlayerTravelReady(APlayerController* PlayerController, int32 ClientEpoch)
{
    const FString ControllerName = PlayerController ? PlayerController->GetName() : TEXT("none");
    UE_LOG(LogClawedCoopSessionSubsystem, Display, TEXT("travel ready pc=%s epoch=%d flow=%s"), *ControllerName, ClientEpoch, *View.FlowId.ToString());
    if (View.Phase == EClawedCoopSessionPhase::Traveling || View.Phase == EClawedCoopSessionPhase::AwaitingReady)
    {
        Transition(EClawedCoopSessionPhase::Synchronizing, EClawedCoopFailureCode::None, TEXT("travel ready acknowledged"));
    }
}

IOnlineSessionPtr UClawedCoopSessionSubsystem::GetSessionInterface() const
{
    const IOnlineSubsystem* OnlineSubsystem = IOnlineSubsystem::Get();
    return OnlineSubsystem ? OnlineSubsystem->GetSessionInterface() : nullptr;
}

void UClawedCoopSessionSubsystem::Transition(EClawedCoopSessionPhase Phase, EClawedCoopFailureCode Failure, const FString& Detail)
{
    View.Phase = Phase;
    View.LastFailure = Failure;
    View.Detail = Detail;
    if (Phase == EClawedCoopSessionPhase::Hosting || Phase == EClawedCoopSessionPhase::Finding || Phase == EClawedCoopSessionPhase::Joining)
    {
        View.FlowId = FGuid::NewGuid();
    }
    UE_LOG(LogClawedCoopSessionSubsystem, Display, TEXT("phase=%d failure=%d flow=%s detail=%s"), static_cast<int32>(Phase), static_cast<int32>(Failure), *View.FlowId.ToString(), *Detail);
    OnSessionViewChanged.Broadcast(View);
}

void UClawedCoopSessionSubsystem::StartTimeout(float Seconds, EClawedCoopFailureCode FailureCode, const FString& Detail)
{
    ClearTimeout();
    if (UWorld* World = GetWorld())
    {
        World->GetTimerManager().SetTimer(TimeoutHandle, FTimerDelegate::CreateUObject(this, &ThisClass::HandleTimeout, FailureCode, Detail), FMath::Max(1.0f, Seconds), false);
    }
}

void UClawedCoopSessionSubsystem::ClearTimeout()
{
    if (UWorld* World = GetWorld())
    {
        World->GetTimerManager().ClearTimer(TimeoutHandle);
    }
}

void UClawedCoopSessionSubsystem::HandleTimeout(EClawedCoopFailureCode FailureCode, FString Detail)
{
    Transition(EClawedCoopSessionPhase::Failed, FailureCode, Detail);
}

void UClawedCoopSessionSubsystem::HandleCreateSessionComplete(FName CompletedSessionName, bool bWasSuccessful)
{
    ClearTimeout();
    if (const IOnlineSessionPtr Sessions = GetSessionInterface())
    {
        Sessions->ClearOnCreateSessionCompleteDelegate_Handle(CreateSessionHandle);
    }
    if (!bWasSuccessful)
    {
        Transition(EClawedCoopSessionPhase::Failed, EClawedCoopFailureCode::HostFailed, TEXT("create session failed"));
        return;
    }
    TravelHostAfterCreate();
}

void UClawedCoopSessionSubsystem::HandleFindSessionsComplete(bool bWasSuccessful)
{
    ClearTimeout();
    if (const IOnlineSessionPtr Sessions = GetSessionInterface())
    {
        Sessions->ClearOnFindSessionsCompleteDelegate_Handle(FindSessionsHandle);
    }
    if (!bWasSuccessful || !ActiveSearch.IsValid())
    {
        Transition(EClawedCoopSessionPhase::Failed, EClawedCoopFailureCode::FindFailed, TEXT("find sessions failed"));
        return;
    }
    CacheSearchResults();
    Transition(EClawedCoopSessionPhase::Idle, EClawedCoopFailureCode::None, FString::Printf(TEXT("found %d sessions"), NativeSearchResults.Num()));
}

void UClawedCoopSessionSubsystem::HandleJoinSessionComplete(FName CompletedSessionName, EOnJoinSessionCompleteResult::Type Result)
{
    ClearTimeout();
    if (const IOnlineSessionPtr Sessions = GetSessionInterface())
    {
        Sessions->ClearOnJoinSessionCompleteDelegate_Handle(JoinSessionHandle);
    }
    if (Result != EOnJoinSessionCompleteResult::Success)
    {
        Transition(EClawedCoopSessionPhase::Failed, EClawedCoopFailureCode::JoinFailed, FString::Printf(TEXT("join failed result=%d"), static_cast<int32>(Result)));
        return;
    }
    if (!ClientTravelToResolvedSession())
    {
        Transition(EClawedCoopSessionPhase::Failed, EClawedCoopFailureCode::ResolveConnectStringFailed, TEXT("connect string missing"));
        return;
    }
    Transition(EClawedCoopSessionPhase::Traveling, EClawedCoopFailureCode::None, TEXT("client travel dispatched"));
    StartTimeout(GetDefault<UClawedCoopReliabilitySettings>()->TravelReadyTimeoutSeconds, EClawedCoopFailureCode::ReadyTimeout, TEXT("travel ready timeout"));
}

void UClawedCoopSessionSubsystem::HandleDestroySessionComplete(FName CompletedSessionName, bool bWasSuccessful)
{
    if (const IOnlineSessionPtr Sessions = GetSessionInterface())
    {
        Sessions->ClearOnDestroySessionCompleteDelegate_Handle(DestroySessionHandle);
    }
    RecoverToIdle(bWasSuccessful ? TEXT("destroy session complete") : TEXT("destroy session failed"));
}

void UClawedCoopSessionSubsystem::TravelHostAfterCreate()
{
    UWorld* World = GetWorld();
    if (!World || PendingHostRequest.TravelMap.IsEmpty())
    {
        Transition(EClawedCoopSessionPhase::Failed, EClawedCoopFailureCode::TravelFailed, TEXT("host travel map missing"));
        return;
    }
    const FString Url = PendingHostRequest.TravelMap.Contains(TEXT("?")) ? PendingHostRequest.TravelMap : PendingHostRequest.TravelMap + TEXT("?listen");
    Transition(EClawedCoopSessionPhase::Traveling, EClawedCoopFailureCode::None, FString::Printf(TEXT("server travel %s"), *Url));
    World->ServerTravel(Url, false);
    StartTimeout(GetDefault<UClawedCoopReliabilitySettings>()->TravelReadyTimeoutSeconds, EClawedCoopFailureCode::ReadyTimeout, TEXT("host travel ready timeout"));
}

bool UClawedCoopSessionSubsystem::ClientTravelToResolvedSession()
{
    const IOnlineSessionPtr Sessions = GetSessionInterface();
    if (!Sessions)
    {
        return false;
    }
    FString ConnectString;
    if (!Sessions->GetResolvedConnectString(GetDefault<UClawedCoopReliabilitySettings>()->SessionName, ConnectString) || ConnectString.IsEmpty())
    {
        return false;
    }
    UWorld* World = GetWorld();
    APlayerController* PlayerController = World ? World->GetFirstPlayerController() : nullptr;
    if (!PlayerController)
    {
        return false;
    }
    PlayerController->ClientTravel(ConnectString, TRAVEL_Absolute);
    return true;
}

void UClawedCoopSessionSubsystem::CacheSearchResults()
{
    NativeSearchResults.Reset();
    View.SearchResults.Reset();
    if (!ActiveSearch.IsValid())
    {
        return;
    }
    NativeSearchResults = ActiveSearch->SearchResults;
    for (int32 Index = 0; Index < NativeSearchResults.Num(); ++Index)
    {
        const FOnlineSessionSearchResult& Result = NativeSearchResults[Index];
        FClawedCoopSearchResultView ResultView;
        ResultView.Index = Index;
        ResultView.PingMs = Result.PingInMs;
        ResultView.OpenPublicConnections = Result.Session.NumOpenPublicConnections;
        ResultView.MaxPublicConnections = Result.Session.SessionSettings.NumPublicConnections;
        ResultView.bIsLan = Result.Session.SessionSettings.bIsLANMatch;
        Result.Session.SessionSettings.Get(FName(TEXT("CLAWED_SESSION_NAME")), ResultView.HostName);
        if (ResultView.HostName.IsEmpty() && Result.Session.OwningUserName.Len() > 0)
        {
            ResultView.HostName = Result.Session.OwningUserName;
        }
        View.SearchResults.Add(ResultView);
    }
}`;
}

function authorityComponentHeader() {
  return String.raw`#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "ClawedCoopTypes.h"
#include "ClawedCoopAuthorityStateComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FClawedCoopStateFrameChanged, const FClawedCoopStateFrame&, Frame);

UCLASS(ClassGroup=(Clawed), meta=(BlueprintSpawnableComponent))
class CLAWEDCOOPRELIABILITY_API UClawedCoopAuthorityStateComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    UClawedCoopAuthorityStateComponent();
    virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    void CommitPlayerFrame(const FClawedCoopPlayerFrame& PlayerFrame);

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    void CommitWorldItemFrame(const FClawedCoopWorldItemFrame& WorldItemFrame);

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    void ApplyLoadedStateFrame(const FClawedCoopStateFrame& LoadedFrame);

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    FClawedCoopStateFrame BuildCurrentStateFrame() const;

    UPROPERTY(BlueprintAssignable, Category="Clawed Coop")
    FClawedCoopStateFrameChanged OnReplicatedStateFrameChanged;

private:
    UFUNCTION()
    void OnRep_StateFrame();

    UPROPERTY(ReplicatedUsing=OnRep_StateFrame)
    FClawedCoopStateFrame StateFrame;
};`;
}

function authorityComponentCpp() {
  return String.raw`#include "ClawedCoopAuthorityStateComponent.h"

#include "Net/UnrealNetwork.h"

UClawedCoopAuthorityStateComponent::UClawedCoopAuthorityStateComponent()
{
    SetIsReplicatedByDefault(true);
}

void UClawedCoopAuthorityStateComponent::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);
    DOREPLIFETIME(UClawedCoopAuthorityStateComponent, StateFrame);
}

void UClawedCoopAuthorityStateComponent::CommitPlayerFrame(const FClawedCoopPlayerFrame& PlayerFrame)
{
    if (!GetOwner() || !GetOwner()->HasAuthority())
    {
        return;
    }
    const int32 ExistingIndex = StateFrame.Players.IndexOfByPredicate([&](const FClawedCoopPlayerFrame& Existing)
    {
        return Existing.PlayerId == PlayerFrame.PlayerId;
    });
    if (ExistingIndex == INDEX_NONE)
    {
        StateFrame.Players.Add(PlayerFrame);
    }
    else if (PlayerFrame.Epoch >= StateFrame.Players[ExistingIndex].Epoch)
    {
        StateFrame.Players[ExistingIndex] = PlayerFrame;
    }
    StateFrame.Epoch++;
    OnRep_StateFrame();
}

void UClawedCoopAuthorityStateComponent::CommitWorldItemFrame(const FClawedCoopWorldItemFrame& WorldItemFrame)
{
    if (!GetOwner() || !GetOwner()->HasAuthority())
    {
        return;
    }
    const int32 ExistingIndex = StateFrame.WorldItems.IndexOfByPredicate([&](const FClawedCoopWorldItemFrame& Existing)
    {
        return Existing.ItemInstanceId == WorldItemFrame.ItemInstanceId;
    });
    if (ExistingIndex == INDEX_NONE)
    {
        StateFrame.WorldItems.Add(WorldItemFrame);
    }
    else if (WorldItemFrame.Revision >= StateFrame.WorldItems[ExistingIndex].Revision)
    {
        StateFrame.WorldItems[ExistingIndex] = WorldItemFrame;
    }
    StateFrame.Epoch++;
    OnRep_StateFrame();
}

void UClawedCoopAuthorityStateComponent::ApplyLoadedStateFrame(const FClawedCoopStateFrame& LoadedFrame)
{
    if (!GetOwner() || !GetOwner()->HasAuthority())
    {
        return;
    }
    StateFrame = LoadedFrame;
    StateFrame.Epoch++;
    OnRep_StateFrame();
}

FClawedCoopStateFrame UClawedCoopAuthorityStateComponent::BuildCurrentStateFrame() const
{
    return StateFrame;
}

void UClawedCoopAuthorityStateComponent::OnRep_StateFrame()
{
    OnReplicatedStateFrameChanged.Broadcast(StateFrame);
}`;
}

function playerSyncComponentHeader() {
  return String.raw`#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "ClawedCoopTypes.h"
#include "ClawedCoopPlayerSyncComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FClawedCoopPlayerReadyAck, FGuid, FlowId, int32, ClientEpoch);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FClawedCoopPlayerStateFrameReceived, FGuid, FlowId, int32, Epoch);

UCLASS(ClassGroup=(Clawed), meta=(BlueprintSpawnableComponent))
class CLAWEDCOOPRELIABILITY_API UClawedCoopPlayerSyncComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    UClawedCoopPlayerSyncComponent();

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    void AcknowledgeTravelReady(FGuid FlowId, int32 ClientEpoch);

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    void RequestFullResync(FGuid FlowId);

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    void RequestCatchupToPlayer(FGuid TargetPlayerId);

    UFUNCTION(BlueprintCallable, Category="Clawed Coop")
    void PushAuthoritativeFrameToClient(const FClawedCoopStateFrame& Frame);

    UPROPERTY(BlueprintAssignable, Category="Clawed Coop")
    FClawedCoopPlayerReadyAck OnServerReadyAck;

    UPROPERTY(BlueprintAssignable, Category="Clawed Coop")
    FClawedCoopPlayerStateFrameReceived OnClientStateFrameReceived;

protected:
    UFUNCTION(Server, Reliable)
    void ServerAcknowledgeTravelReady(FGuid FlowId, int32 ClientEpoch);

    UFUNCTION(Server, Reliable)
    void ServerRequestFullResync(FGuid FlowId);

    UFUNCTION(Server, Reliable)
    void ServerRequestCatchupToPlayer(FGuid TargetPlayerId);

    UFUNCTION(Client, Reliable)
    void ClientReceiveStateFrame(const FClawedCoopStateFrame& Frame);
};`;
}

function playerSyncComponentCpp() {
  return String.raw`#include "ClawedCoopPlayerSyncComponent.h"

DEFINE_LOG_CATEGORY_STATIC(LogClawedCoopPlayerSync, Log, All);

UClawedCoopPlayerSyncComponent::UClawedCoopPlayerSyncComponent()
{
    SetIsReplicatedByDefault(true);
}

void UClawedCoopPlayerSyncComponent::AcknowledgeTravelReady(FGuid FlowId, int32 ClientEpoch)
{
    if (GetOwner() && GetOwner()->HasAuthority())
    {
        ServerAcknowledgeTravelReady_Implementation(FlowId, ClientEpoch);
        return;
    }
    ServerAcknowledgeTravelReady(FlowId, ClientEpoch);
}

void UClawedCoopPlayerSyncComponent::RequestFullResync(FGuid FlowId)
{
    ServerRequestFullResync(FlowId);
}

void UClawedCoopPlayerSyncComponent::RequestCatchupToPlayer(FGuid TargetPlayerId)
{
    ServerRequestCatchupToPlayer(TargetPlayerId);
}

void UClawedCoopPlayerSyncComponent::PushAuthoritativeFrameToClient(const FClawedCoopStateFrame& Frame)
{
    if (!GetOwner() || !GetOwner()->HasAuthority())
    {
        return;
    }
    ClientReceiveStateFrame(Frame);
}

void UClawedCoopPlayerSyncComponent::ServerAcknowledgeTravelReady_Implementation(FGuid FlowId, int32 ClientEpoch)
{
    UE_LOG(LogClawedCoopPlayerSync, Display, TEXT("ready ack owner=%s flow=%s epoch=%d"), GetOwner() ? *GetOwner()->GetName() : TEXT("none"), *FlowId.ToString(), ClientEpoch);
    OnServerReadyAck.Broadcast(FlowId, ClientEpoch);
}

void UClawedCoopPlayerSyncComponent::ServerRequestFullResync_Implementation(FGuid FlowId)
{
    UE_LOG(LogClawedCoopPlayerSync, Display, TEXT("resync request owner=%s flow=%s"), GetOwner() ? *GetOwner()->GetName() : TEXT("none"), *FlowId.ToString());
}

void UClawedCoopPlayerSyncComponent::ServerRequestCatchupToPlayer_Implementation(FGuid TargetPlayerId)
{
    UE_LOG(LogClawedCoopPlayerSync, Display, TEXT("catchup request owner=%s target=%s"), GetOwner() ? *GetOwner()->GetName() : TEXT("none"), *TargetPlayerId.ToString());
}

void UClawedCoopPlayerSyncComponent::ClientReceiveStateFrame_Implementation(const FClawedCoopStateFrame& Frame)
{
    UE_LOG(LogClawedCoopPlayerSync, Display, TEXT("state frame received flow=%s epoch=%d players=%d items=%d"), *Frame.FlowId.ToString(), Frame.Epoch, Frame.Players.Num(), Frame.WorldItems.Num());
    OnClientStateFrameReceived.Broadcast(Frame.FlowId, Frame.Epoch);
}`;
}

function readme() {
  return [
    "# Clawed Coop Reliability",
    "",
    "Developer source handoff for replacing Clawed's fragile co-op session ownership with a single authoritative reliability layer.",
    "",
    "This is not a CMM .clawedmod and not a runtime injection package. Copy this folder into the Clawed source tree under `Clawed/Plugins/ClawedCoopReliability`, regenerate project files, compile, then bind the existing multiplayer UI to `UClawedCoopSessionSubsystem`.",
    "",
    "Primary goals:",
    "",
    "- own host/find/join/invite/travel state in `UClawedCoopSessionSubsystem`",
    "- replace the current menu-driven session state with a deterministic state machine",
    "- provide a NetDriver replacement point through `UClawedCoopNetDriver`",
    "- move readiness, catch-up, inventory, save/load, and world item sync into explicit replicated contracts",
    "- keep Steam/EOS as replaceable transport adapters instead of letting UI widgets own session flow",
    "",
    "Ship path for developers:",
    "",
    "1. Add the plugin to the Clawed source project.",
    "2. Merge `Config/DefaultClawedCoopReliability.ini` into project config after confirming the active NetDriver transport.",
    "3. Bind `BP_MenuSystemGameInstance_FDG` and multiplayer widgets to the subsystem methods.",
    "4. Add `UClawedCoopAuthorityStateComponent` to `BP_Gamestate_FRG`.",
    "5. Add `UClawedCoopPlayerSyncComponent` to the owning PlayerController or equivalent player runtime actor.",
    "6. Wrap InventorySystemPro save/load and world item mutations with state-frame commits.",
    "7. Run the validation plan in `Docs/VALIDATION_PLAN.md`.",
    "",
    "The included C++ is a source-ready scaffold with real OnlineSubsystem session calls and replicated component contracts. The exact Clawed map name, active Steam/EOS transport, and inventory component field mappings must be adjusted by the developers inside their project."
  ].join("\n");
}

function devIntegrationReadme() {
  return [
    "# Clawed Coop Reliability - Developer Integration README",
    "",
    "This package is a developer source plugin for the Clawed Unreal project. It is not a `.clawedmod`, not a UE4SS runtime mod, and not an executable patch. The intended install location is:",
    "",
    "`Clawed/Plugins/ClawedCoopReliability`",
    "",
    "The goal is to move co-op ownership out of the current menu/session Blueprint flow and into one deterministic C++ layer that owns session state, travel readiness, player state frames, inventory/save synchronization, world-item revisions, and reconnect recovery.",
    "",
    "## What Plugs Into Where",
    "",
    "| Existing Clawed area | New plugin piece | Integration action |",
    "| --- | --- | --- |",
    "| `BP_MenuSystemGameInstance_FDG` | `UClawedCoopSessionSubsystem` | Stop treating GameInstance Blueprint as the session state owner. Keep it as a UI/game adapter that calls subsystem methods and renders subsystem state. |",
    "| `WBP_HostMultiplayerMenu` | `HostSession` | Build `FClawedCoopHostRequest` from the host menu fields and call `HostSession`. Do not call AdvancedSessions host nodes directly from the widget. |",
    "| `WBP_ServerBrowser` and `WBP_ServerBrowser_Tourist` | `FindSessions`, `OnSessionViewChanged` | Refresh calls `FindSessions`; results come from `FClawedCoopSessionView.SearchResults`. |",
    "| `WBP_ServerSlotBase` / server slot widget | `JoinSearchResult` | Store the subsystem search-result index on each row; join calls `JoinSearchResult(Index)`. |",
    "| Steam/EOS invite accepted callback | `UClawedCoopSessionSubsystem` invite adapter | Convert the platform invite result into a subsystem join request. The callback should not directly travel or mutate session state. |",
    "| `BP_Gamestate_FRG` | `UClawedCoopAuthorityStateComponent` | Add this replicated component to GameState. It becomes the host/server source of truth for player frames, world item frames, save epochs, and resync frames. |",
    "| `BP_MenuSystemPlayerController` or active gameplay PlayerController | `UClawedCoopPlayerSyncComponent` | Add this replicated component to the owning player runtime path. It sends travel-ready acks, full-resync requests, and catch-up requests. |",
    "| `PlayerState_FDG` | `FClawedCoopPlayerFrame.PlayerId` and epoch metadata | Store stable player identity and current replicated frame metadata here or map it through the PlayerController component. |",
    "| InventorySystemPro components | `FClawedCoopInventoryEntry` adapters | Convert inventory/equipment state into versioned entries. Host commits frames; clients display replicated frames rather than restoring stale local inventory. |",
    "| Pickup/world item actors | `FClawedCoopWorldItemFrame` adapters | Give each world item a stable `ItemInstanceId` and revision. Pickup/drop/consume commits through GameState authority. |",
    "| SaveGame flow | `FClawedCoopStateFrame` | Host saves one authoritative state frame and applies it before releasing clients from synchronizing after load. |",
    "| NetDriver config | `UClawedCoopNetDriver` | Use this as the replacement/wrapper point for the active NetDriver. If Clawed uses a Steam/EOS-specific driver, subclass or wrap that driver instead of shipping the default `UIpNetDriver` base unchanged. |",
    "",
    "## Integration Order",
    "",
    "1. Copy the `ClawedCoopReliability` folder into `Clawed/Plugins/ClawedCoopReliability`.",
    "2. Regenerate project files and compile a Development Editor build.",
    "3. Confirm the active transport driver in the current Clawed project. Only merge `Config/DefaultClawedCoopReliability.ini` after confirming whether the game should use `UClawedCoopNetDriver` directly or a Steam/EOS-derived wrapper.",
    "4. Add `UClawedCoopAuthorityStateComponent` to `BP_Gamestate_FRG`.",
    "5. Add `UClawedCoopPlayerSyncComponent` to `BP_MenuSystemPlayerController` or the gameplay PlayerController used after travel.",
    "6. Update `BP_MenuSystemGameInstance_FDG` so host/find/join/leave/invite UI calls route to `UClawedCoopSessionSubsystem`.",
    "7. Update host and server browser widgets so they only render `FClawedCoopSessionView` and never call AdvancedSessions directly.",
    "8. Add InventorySystemPro adapter functions that serialize inventory/equipment into `FClawedCoopPlayerFrame` and apply frames only from host-authoritative data.",
    "9. Add world-item adapter functions that serialize pickup/drop/consume state into `FClawedCoopWorldItemFrame` and reject stale revisions.",
    "10. Update save/load so the host writes and loads `FClawedCoopStateFrame` before clients leave the synchronizing phase.",
    "11. Gate gameplay start after travel on travel-ready acks and state-frame delivery.",
    "12. Run the validation plan in `Docs/VALIDATION_PLAN.md` before shipping.",
    "",
    "## What To Remove From The Old Flow",
    "",
    "- Direct AdvancedSessions create/find/join calls inside multiplayer widgets.",
    "- Widget-owned session flags that can get out of sync with GameInstance.",
    "- Join success paths that call travel before a subsystem state transition.",
    "- Client-side inventory restore on join or reload without a host frame.",
    "- World item pickup/drop logic that does not carry a stable item instance ID and revision.",
    "- Any late-join spawn path that bypasses the server-authoritative state frame.",
    "",
    "## Runtime Contract",
    "",
    "The subsystem owns the session flow:",
    "",
    "`Idle -> Hosting/Finding/Joining -> Traveling -> AwaitingReady -> Synchronizing -> InSession`",
    "",
    "Failures transition to `Failed` with a stable `EClawedCoopFailureCode`. Recovery returns to `Idle` only through `RecoverToIdle` or an explicit leave/destroy path.",
    "",
    "The GameState component owns replicated co-op truth:",
    "",
    "- player identity",
    "- last authoritative spawn",
    "- inventory entries",
    "- equipped item IDs",
    "- world item instance revisions",
    "- save/load epoch",
    "",
    "The PlayerController sync component owns player-to-server and server-to-player acknowledgements:",
    "",
    "- travel ready",
    "- full resync request",
    "- catch-up request",
    "- client state-frame receipt",
    "",
    "## Developer Notes",
    "",
    "- Keep OnlineSubsystem, Steam, and EOS as adapters under the session subsystem. Do not let UI widgets own those callbacks.",
    "- Keep authority on the host/server. Clients request changes; host commits revisions.",
    "- Treat every inventory, equipment, save, spawn, and world-item update as versioned data.",
    "- Reconnect should never trust the reconnecting client's local save. It should request the current host epoch.",
    "- The included NetDriver class is the replacement point. It may need to inherit from the project's actual active Steam/EOS driver rather than `UIpNetDriver`.",
    "",
    "## Minimum Ship Gate",
    "",
    "Do not ship until a two-account session proves:",
    "",
    "- host from the existing menu",
    "- join from server browser",
    "- join from Steam/EOS invite",
    "- failed join recovery",
    "- travel-ready acks",
    "- late join state sync",
    "- catch-up request",
    "- inventory pickup/drop/equip consistency",
    "- world item consumed revision consistency",
    "- host save/load followed by client reconnect"
  ].join("\n");
}

function architectureDoc() {
  return [
    "# Architecture",
    "",
    "The replacement is organized around one owner for each responsibility.",
    "",
    "## Session Owner",
    "",
    "`UClawedCoopSessionSubsystem` lives on GameInstance and owns every lobby/session phase: idle, hosting, finding, joining, traveling, awaiting ready, synchronizing, in session, recovering, leaving, and failed.",
    "",
    "The existing Clawed multiplayer UI should stop calling AdvancedSessions nodes directly. Widgets should call this subsystem and render `FClawedCoopSessionView`.",
    "",
    "## Transport Boundary",
    "",
    "`UClawedCoopNetDriver` is the project-level replacement point for the active NetDriver. It currently instruments listen/connect/dispatch/shutdown and delegates packet behavior to the base driver. Developers can adapt it to the project's Steam/EOS driver class if Clawed is not using `IpNetDriver` directly.",
    "",
    "The session subsystem uses OnlineSubsystem as an adapter. Steam/EOS discovery remains pluggable, but the state machine no longer lives in UI widgets.",
    "",
    "## Authority State",
    "",
    "`UClawedCoopAuthorityStateComponent` belongs on GameState. It stores versioned player frames and world item frames. Host/server code commits frames after authoritative inventory, equipment, spawn, save/load, and world item changes.",
    "",
    "`UClawedCoopPlayerSyncComponent` belongs on an owning player actor, normally PlayerController. It provides reliable server/client RPCs for readiness, resync, catch-up requests, and state-frame delivery.",
    "",
    "## Save And Load",
    "",
    "The host should save one `FClawedCoopStateFrame` epoch with the normal save game. On load, the host applies that frame to the GameState component before clients are released from awaiting-ready/synchronizing.",
    "",
    "## Desync Control",
    "",
    "Every mutable co-op domain gets an epoch/revision: player, spawn, inventory, equipment, world item, and save game. Clients request resync when they observe a missing or stale revision instead of guessing local state."
  ].join("\n");
}

function bindingsDoc() {
  return [
    "# Clawed Bindings",
    "",
    "Known shipped integration targets from the current asset map:",
    "",
    "- `Clawed/Content/MenuSystemPro/Blueprints/GameFramework/BP_MenuSystemGameInstance_FDG.uasset`",
    "- `Clawed/Content/MenuSystemPro/ExampleContent/Designs/Design_Silence/Menus/Multiplayer/WBP_HostMultiplayerMenu.uasset`",
    "- `Clawed/Content/MenuSystemPro/ExampleContent/Designs/Design_Silence/Menus/Multiplayer/WBP_ServerBrowser.uasset`",
    "- `Clawed/Content/MenuSystemPro/ExampleContent/Designs/Design_Silence/Menus/Multiplayer/WBP_ServerBrowser_Tourist.uasset`",
    "- `Clawed/Content/MenuSystemPro/Blueprints/UI/Widgets/Multiplayer/WBP_ServerSlotBase.uasset`",
    "- `Clawed/Content/GameState/BP_Gamestate_FRG.uasset`",
    "- `Clawed/Content/MenuSystemPro/Blueprints/Player/PlayerState_FDG.uasset`",
    "- `Clawed/Content/InventorySystemPro/Blueprints/Core/BP_InventoryComponent.uasset`",
    "- `Clawed/Content/InventorySystemPro/Blueprints/Player/BP_InventoryCharacterComponent.uasset`",
    "- `Clawed/Content/InventorySystemPro/Blueprints/Player/BP_InventoryControllerComponent.uasset`",
    "- `Clawed/Content/InventorySystemPro/Blueprints/Equipment/BP_CharacterEquipmentComponent.uasset`",
    "- `Engine/Binaries/Win64/EOSSDK-Win64-Shipping.dll`",
    "- `Engine/Binaries/ThirdParty/Steamworks/Steamv157/Win64/steam_api64.dll`",
    "- `Clawed/Plugins/AdvancedSessions/AdvancedSessions.uplugin`",
    "- `Clawed/Plugins/AdvancedSteamSessions/AdvancedSteamSessions.uplugin`",
    "",
    "Replace current Blueprint ownership as follows:",
    "",
    "| Current area | New owner | Binding |",
    "| --- | --- | --- |",
    "| Host button | `UClawedCoopSessionSubsystem` | call `HostSession` |",
    "| Server refresh | `UClawedCoopSessionSubsystem` | call `FindSessions` |",
    "| Server slot join | `UClawedCoopSessionSubsystem` | call `JoinSearchResult` with cached index |",
    "| Steam/EOS invite accepted | native invite adapter | cache result and call subsystem join flow |",
    "| Join failure UI | subsystem view | render `LastFailure` and `Detail` |",
    "| Travel completion | PlayerController sync component | call `AcknowledgeTravelReady` |",
    "| Spawn catch-up | PlayerController sync component | call `RequestCatchupToPlayer` |",
    "| Inventory change | GameState authority component | commit `FClawedCoopPlayerFrame` |",
    "| World item pickup/drop | GameState authority component | commit `FClawedCoopWorldItemFrame` |",
    "| Save/load | GameState authority component | save/apply `FClawedCoopStateFrame` |"
  ].join("\n");
}

function checklistDoc() {
  return [
    "# Integration Checklist",
    "",
    "1. Copy `ClawedCoopReliability` to `Clawed/Plugins/ClawedCoopReliability`.",
    "2. Regenerate Visual Studio project files.",
    "3. Compile Development Editor for UE 5.5.",
    "4. Confirm the active NetDriver class. If Clawed uses Steam/EOS-specific NetDrivers, subclass or wrap that driver instead of `UIpNetDriver`.",
    "5. Merge config only after the active driver class is confirmed.",
    "6. Replace AdvancedSessions calls in `BP_MenuSystemGameInstance_FDG` with subsystem calls.",
    "7. Replace host/browser widget session logic with subsystem view binding.",
    "8. Add the authority state component to `BP_Gamestate_FRG`.",
    "9. Add the player sync component to the owning PlayerController path.",
    "10. Add adapter functions that convert InventorySystemPro component state into `FClawedCoopInventoryEntry` arrays.",
    "11. Add adapter functions that convert spawned pickup/world item actors into `FClawedCoopWorldItemFrame` records.",
    "12. Save and load `FClawedCoopStateFrame` on the host only.",
    "13. Hold clients in awaiting-ready/synchronizing until they ack the current epoch.",
    "14. Run the validation plan.",
    "",
    "Do not release until host and client agree on session phase, map, spawn transform, inventory revision, equipment revision, world item revision, and save epoch after reconnect."
  ].join("\n");
}

function validationDoc() {
  return [
    "# Validation Plan",
    "",
    "## Compile",
    "",
    "- Development Editor build succeeds.",
    "- Shipping build succeeds with the plugin enabled.",
    "- Config resolves the intended NetDriver class.",
    "",
    "## Session",
    "",
    "- Host creates session once and reaches travel.",
    "- Client finds host once and joins by cached search index.",
    "- Steam/EOS invite accepted routes into the subsystem exactly once.",
    "- Failed join returns a stable failure code and leaves the system recoverable.",
    "- Destroy/leave returns to idle without stale session handles.",
    "",
    "## Travel And Spawn",
    "",
    "- Host and client emit matching flow IDs.",
    "- Every client sends travel-ready ack.",
    "- Late joiner receives the latest state frame before normal play.",
    "- Catch-up request is server-authoritative and cooldown-limited.",
    "",
    "## Inventory And Equipment",
    "",
    "- Host inventory mutation increments player epoch.",
    "- Client inventory UI updates from replicated frame, not stale local load.",
    "- Equip/unequip survives travel and reload.",
    "- Duplicate pickup attempts resolve to one consumed world item revision.",
    "",
    "## Save And Load",
    "",
    "- Host save writes one state frame epoch.",
    "- Host load applies the state frame before clients leave synchronizing.",
    "- Rejoining client receives the current epoch and does not restore older inventory.",
    "",
    "## Disconnect And Reconnect",
    "",
    "- Client disconnect does not destroy host authority state.",
    "- Reconnect resolves player identity and current frame.",
    "- Missing/stale revisions request full resync and recover without local guessing."
  ].join("\n");
}
