import {
  CreatorViewportSessionSchema,
  type CreatorViewportSession,
  type CreatorViewportWindowEvent
} from "../../shared/contracts/app";
import type { CreatorViewportWindowServiceContract } from "../../shared/contracts/services";

export interface CreatorViewportWindowHandle {
  close(): void;
  focus(): void;
  isDestroyed(): boolean;
  load(): Promise<void>;
  onClosed(callback: () => void): void;
}

export interface CreatorViewportWindowHost {
  createWindow(): CreatorViewportWindowHandle;
  emitEvent(event: CreatorViewportWindowEvent): void;
}

export class CreatorViewportWindowService
  implements CreatorViewportWindowServiceContract
{
  private handle: CreatorViewportWindowHandle | null = null;
  private session = emptyCreatorViewportSession();

  constructor(private readonly host: CreatorViewportWindowHost) {}

  async open(
    session: CreatorViewportSession
  ): Promise<CreatorViewportSession> {
    this.session = parseSession({ ...session, windowMode: "poppedOut" });
    if (this.handle && !this.handle.isDestroyed()) {
      this.handle.focus();
      this.emit("poppedOut");
      return this.session;
    }

    const handle = this.host.createWindow();
    this.handle = handle;
    handle.onClosed(() => {
      if (this.handle !== handle) {
        return;
      }
      this.handle = null;
      this.session = parseSession({ ...this.session, windowMode: "embedded" });
      this.emit("returned");
    });
    await handle.load();
    handle.focus();
    this.emit("poppedOut");
    return this.session;
  }

  async read(): Promise<CreatorViewportSession> {
    return this.session;
  }

  async update(
    session: CreatorViewportSession
  ): Promise<CreatorViewportSession> {
    this.session = parseSession(session);
    return this.session;
  }

  async returnToMain(
    session: CreatorViewportSession
  ): Promise<CreatorViewportSession> {
    this.session = parseSession({ ...session, windowMode: "embedded" });
    const handle = this.handle;
    this.handle = null;
    if (handle && !handle.isDestroyed()) {
      handle.close();
    }
    this.emit("returned");
    return this.session;
  }

  private emit(type: CreatorViewportWindowEvent["type"]): void {
    this.host.emitEvent({ session: this.session, type });
  }
}

function parseSession(session: CreatorViewportSession): CreatorViewportSession {
  return CreatorViewportSessionSchema.parse(session);
}

export function emptyCreatorViewportSession(): CreatorViewportSession {
  return {
    cameraState: null,
    items: [],
    lightSettings: {
      bottomLeft: false,
      bottomRight: false,
      even: true,
      topLeft: true,
      topRight: false
    },
    selectedAssetId: null,
    showSkeletons: true,
    stopRotation: false,
    textureSelections: [],
    windowMode: "embedded"
  };
}
