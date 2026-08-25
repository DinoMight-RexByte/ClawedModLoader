import { afterEach, describe, expect, it } from "vitest";

import {
  CreatorAssetIndexEntrySchema,
  CreatorModelPreviewResultSchema,
  type CreatorAssetIndexEntry
} from "../../src/shared/contracts/app";
import {
  creatorViewportSessionFromState,
  useCreatorAssetStore,
  viewportBundleItemFromAsset
} from "../../src/renderer/stores/creatorAssetStore";

describe("creator asset viewport store", () => {
  afterEach(() => {
    useCreatorAssetStore.setState(useCreatorAssetStore.getInitialState(), true);
  });

  it("adds and selects active viewport bundle items without dropping prior items", () => {
    const first = creatorAsset("base-sk", "SkeletalMesh");
    const second = creatorAsset("base-sm", "StaticMesh");
    const store = useCreatorAssetStore.getState();

    store.upsertViewportItem(viewportBundleItemFromAsset(first));
    store.upsertViewportItem(viewportBundleItemFromAsset(second));

    const state = useCreatorAssetStore.getState();
    expect(state.viewportBundle.map((item) => item.assetId)).toEqual([
      first.id,
      second.id
    ]);
    expect(state.selectedViewportAssetId).toBe(second.id);
    expect(state.viewportBundle[0].selected).toBe(false);
    expect(state.viewportBundle[1].selected).toBe(true);
  });

  it("updates viewport item preview, selection, and clear state", () => {
    const asset = creatorAsset("base-sk", "SkeletalMesh");
    const store = useCreatorAssetStore.getState();

    store.upsertViewportItem({
      ...viewportBundleItemFromAsset(asset),
      busy: true
    });
    store.setViewportItemPreview(asset.id, creatorPreview(asset));
    store.setSelectedViewportAssetId(asset.id);

    const item = useCreatorAssetStore.getState().viewportBundle[0];
    expect(item.busy).toBe(false);
    expect(item.previewId).toBe("preview");
    expect(item.visible).toBe(true);
    expect(item.selected).toBe(true);

    store.clearViewportBundle();

    expect(useCreatorAssetStore.getState().viewportBundle).toEqual([]);
    expect(useCreatorAssetStore.getState().selectedViewportAssetId).toBeNull();
  });

  it("toggles viewport item visibility and removes with selected fallback", () => {
    const first = creatorAsset("base-sk", "SkeletalMesh");
    const second = creatorAsset("base-sm", "StaticMesh");
    const store = useCreatorAssetStore.getState();

    store.upsertViewportItem(viewportBundleItemFromAsset(first));
    store.upsertViewportItem(viewportBundleItemFromAsset(second));
    store.setSelectedViewportAssetId(first.id);
    store.setViewportItemVisibility(first.id, false);

    let state = useCreatorAssetStore.getState();
    expect(state.viewportBundle[0].visible).toBe(false);
    expect(state.selectedViewportAssetId).toBe(second.id);
    expect(state.viewportBundle[1].selected).toBe(true);

    store.setViewportItemVisibility(first.id, true);
    store.removeViewportItem(second.id);

    state = useCreatorAssetStore.getState();
    expect(state.viewportBundle.map((item) => item.assetId)).toEqual([first.id]);
    expect(state.selectedViewportAssetId).toBe(first.id);
    expect(state.viewportBundle[0].visible).toBe(true);
    expect(state.viewportBundle[0].selected).toBe(true);

    store.removeViewportItem(first.id);

    expect(useCreatorAssetStore.getState().viewportBundle).toEqual([]);
    expect(useCreatorAssetStore.getState().selectedViewportAssetId).toBeNull();
  });

  it("stores skeleton overlay visibility separately from viewport bundle items", () => {
    const store = useCreatorAssetStore.getState();

    expect(store.showSkeletons).toBe(true);
    expect(store.stopRotation).toBe(false);
    store.setShowSkeletons(false);
    store.setStopRotation(true);

    expect(useCreatorAssetStore.getState().showSkeletons).toBe(false);
    expect(useCreatorAssetStore.getState().stopRotation).toBe(true);
  });

  it("updates viewport light settings without replacing unrelated light choices", () => {
    const store = useCreatorAssetStore.getState();

    expect(store.viewportLightSettings).toMatchObject({
      even: true,
      topLeft: true,
      topRight: false
    });

    store.setViewportLightSettings({ bottomRight: true, even: false });

    expect(useCreatorAssetStore.getState().viewportLightSettings).toMatchObject({
      bottomRight: true,
      even: false,
      topLeft: true,
      topRight: false
    });
  });

  it("applies and serializes viewport pop-out session state", () => {
    const first = creatorAsset("base-sk", "SkeletalMesh");
    const second = creatorAsset("base-sm", "StaticMesh");
    const store = useCreatorAssetStore.getState();

    store.upsertViewportItem(viewportBundleItemFromAsset(first));
    store.setViewportItemPreview(first.id, creatorPreview(first));
    store.applyViewportSession({
      cameraState: {
        distance: 4,
        position: [1, 2, 3],
        target: [0, 0, 0]
      },
      items: [
        {
          assetClass: first.assetClass,
          assetId: first.id,
          label: first.label,
          previewId: "preview",
          selected: false,
          source: first.source,
          visible: false
        },
        {
          assetClass: second.assetClass,
          assetId: second.id,
          label: second.label,
          previewId: null,
          selected: true,
          source: second.source,
          visible: true
        }
      ],
      lightSettings: {
        bottomLeft: true,
        bottomRight: false,
        even: false,
        topLeft: true,
        topRight: true
      },
      selectedAssetId: second.id,
      showSkeletons: false,
      stopRotation: true,
      textureSelections: [{ candidateId: "texture-candidate" }],
      windowMode: "poppedOut"
    });

    const state = useCreatorAssetStore.getState();
    expect(state.viewportBundle[0].preview).toBeTruthy();
    expect(state.viewportBundle[0].visible).toBe(false);
    expect(state.viewportBundle[1].busy).toBe(true);
    expect(state.selectedViewportAssetId).toBe(second.id);
    expect(state.showSkeletons).toBe(false);
    expect(state.stopRotation).toBe(true);
    expect(state.viewportCameraState?.distance).toBe(4);
    expect(state.viewportLightSettings).toMatchObject({
      bottomLeft: true,
      even: false,
      topRight: true
    });

    expect(creatorViewportSessionFromState(state)).toMatchObject({
      selectedAssetId: second.id,
      showSkeletons: false,
      stopRotation: true,
      textureSelections: [{ candidateId: "texture-candidate" }],
      windowMode: "poppedOut"
    });
  });
});

function creatorAsset(
  id: string,
  assetClass: "SkeletalMesh" | "StaticMesh"
): CreatorAssetIndexEntry {
  return CreatorAssetIndexEntrySchema.parse({
    id,
    label: `/Game/Test/${id}.${id}`,
    source: "baseGameMap",
    ownerLabel: "Clawed base index",
    packageId: null,
    packageVersion: null,
    packageName: null,
    containerName: "Clawed-Windows",
    loader: null,
    activeProfileEnabled: false,
    activeProfileOrder: null,
    assetClass,
    packagePath: `/Game/Test/${id}`,
    objectPath: `/Game/Test/${id}.${id}`,
    virtualPath: `/Clawed/Base/Test/${id}`,
    payloadPath: null,
    relativePath: `Clawed/Content/Test/${id}.uasset`,
    extension: ".uasset",
    tags: ["model_visuals"],
    modUses: "Model inspection target",
    sizeBytes: 128,
    sha256: "a".repeat(64),
    validationState: null,
    deploymentRoute: null,
    exportState: "exportable",
    conflictState: "none"
  });
}

function creatorPreview(asset: CreatorAssetIndexEntry) {
  return CreatorModelPreviewResultSchema.parse({
    status: "available",
    asset,
    preview: {
      id: "preview",
      payloadPath: "payload/previews/test.obj",
      kind: "model",
      source: "generated",
      format: "obj",
      modelRole: "skeletalMesh"
    },
    activeWinner: null,
    model: {
      dataUrl: "data:text/plain;base64,byBUZXN0Cg==",
      format: "obj",
      source: "generated",
      fileName: "test.obj",
      sizeBytes: 7
    },
    metadata: {
      meshType: "skeletalMesh",
      skeleton: null,
      physicsAsset: null,
      materialSlots: [],
      lods: [],
      dependencyPaths: [],
      targetObjectPath: asset.objectPath,
      packagePath: asset.packagePath,
      packageSource: asset.ownerLabel,
      sourceContainer: asset.containerName,
      previewSource: "Generated package preview",
      lodCount: null,
      vertexCount: null,
      triangleCount: null,
      materialSlotCount: null,
      validationState: null,
      conflictWinner: null,
      exportState: asset.exportState
    },
    problems: []
  });
}
