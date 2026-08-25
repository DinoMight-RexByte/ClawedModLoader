import { describe, expect, it } from "vitest";

import {
  CreatorViewportWindowService,
  type CreatorViewportWindowHandle,
  type CreatorViewportWindowHost
} from "../../src/main/services/creatorViewportWindowService";
import type {
  CreatorViewportSession,
  CreatorViewportWindowEvent
} from "../../src/shared/contracts/app";

describe("creator viewport window service", () => {
  it("opens one pop-out window and focuses the existing one on repeat open", async () => {
    const host = new FakeViewportWindowHost();
    const service = new CreatorViewportWindowService(host);

    await service.open(viewportSession("first"));
    await service.open(viewportSession("second"));

    expect(host.handles).toHaveLength(1);
    expect(host.handles[0].loadCount).toBe(1);
    expect(host.handles[0].focusCount).toBe(2);
    expect((await service.read()).items[0].assetId).toBe("second");
    expect(host.events.map((event) => event.type)).toEqual([
      "poppedOut",
      "poppedOut"
    ]);
  });

  it("restores embedded mode when the native pop-out window closes", async () => {
    const host = new FakeViewportWindowHost();
    const service = new CreatorViewportWindowService(host);

    await service.open(viewportSession("native-close"));
    host.handles[0].nativeClose();

    const session = await service.read();
    expect(session.windowMode).toBe("embedded");
    expect(host.events.at(-1)).toMatchObject({
      session: { windowMode: "embedded" },
      type: "returned"
    });
  });

  it("returns to main without double-emitting when close triggers synchronously", async () => {
    const host = new FakeViewportWindowHost();
    const service = new CreatorViewportWindowService(host);

    await service.open(viewportSession("returned"));
    await service.returnToMain({
      ...viewportSession("returned"),
      showSkeletons: false,
      windowMode: "embedded"
    });

    expect(host.handles[0].destroyed).toBe(true);
    expect((await service.read()).showSkeletons).toBe(false);
    expect(host.events.filter((event) => event.type === "returned")).toHaveLength(
      1
    );
  });
});

class FakeViewportWindowHost implements CreatorViewportWindowHost {
  readonly events: CreatorViewportWindowEvent[] = [];
  readonly handles: FakeViewportWindowHandle[] = [];

  createWindow(): CreatorViewportWindowHandle {
    const handle = new FakeViewportWindowHandle();
    this.handles.push(handle);
    return handle;
  }

  emitEvent(event: CreatorViewportWindowEvent): void {
    this.events.push(event);
  }
}

class FakeViewportWindowHandle implements CreatorViewportWindowHandle {
  destroyed = false;
  focusCount = 0;
  loadCount = 0;
  private closedCallback: (() => void) | null = null;

  close(): void {
    this.nativeClose();
  }

  focus(): void {
    this.focusCount += 1;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  async load(): Promise<void> {
    this.loadCount += 1;
  }

  nativeClose(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.closedCallback?.();
  }

  onClosed(callback: () => void): void {
    this.closedCallback = callback;
  }
}

function viewportSession(assetId: string): CreatorViewportSession {
  return {
    cameraState: {
      distance: 3,
      position: [1, 2, 3],
      target: [0, 0, 0]
    },
    items: [
      {
        assetClass: "SkeletalMesh",
        assetId,
        label: assetId,
        previewId: "preview",
        selected: true,
        source: "baseGameMap",
        visible: true
      }
    ],
    lightSettings: {
      bottomLeft: false,
      bottomRight: false,
      even: true,
      topLeft: true,
      topRight: false
    },
    selectedAssetId: assetId,
    showSkeletons: true,
    stopRotation: true,
    textureSelections: [],
    windowMode: "poppedOut"
  };
}
