/// <reference types="vite/client" />

import type { CmmApi } from "../shared/contracts/ipc";

declare global {
  interface Window {
    cmm: CmmApi;
    cmmFileDrops: {
      getPathForFile(file: File): string | null;
    };
  }
}
