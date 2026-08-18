import path from "node:path";

import { CLAWED_STEAM_APP_ID } from "../../../shared/contracts/app";

export type VdfValue = string | VdfObject;
export interface VdfObject {
  [key: string]: VdfValue;
}

type Token = "{" | "}" | string;

function tokenizeVdf(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const current = input[index];

    if (/\s/.test(current)) {
      index += 1;
      continue;
    }

    if (current === "/" && input[index + 1] === "/") {
      while (index < input.length && input[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (current === "{" || current === "}") {
      tokens.push(current);
      index += 1;
      continue;
    }

    if (current === "\"") {
      index += 1;
      let value = "";

      while (index < input.length) {
        const next = input[index];

        if (next === "\\") {
          const escaped = input[index + 1];
          if (escaped === undefined) {
            throw new Error("Invalid VDF escape sequence.");
          }
          value += escaped;
          index += 2;
          continue;
        }

        if (next === "\"") {
          index += 1;
          break;
        }

        value += next;
        index += 1;
      }

      tokens.push(value);
      continue;
    }

    let value = "";
    while (
      index < input.length &&
      !/\s/.test(input[index]) &&
      input[index] !== "{" &&
      input[index] !== "}"
    ) {
      value += input[index];
      index += 1;
    }
    tokens.push(value);
  }

  return tokens;
}

export function parseVdf(input: string): VdfObject {
  const tokens = tokenizeVdf(input);
  let index = 0;

  function parseObject(): VdfObject {
    const object: VdfObject = {};

    while (index < tokens.length) {
      const key = tokens[index];

      if (key === "}") {
        index += 1;
        return object;
      }

      if (key === "{") {
        throw new Error("Unexpected VDF object start.");
      }

      index += 1;
      const value = tokens[index];

      if (value === "{") {
        index += 1;
        object[key] = parseObject();
      } else if (value === "}") {
        throw new Error("Unexpected VDF object end.");
      } else if (value === undefined) {
        throw new Error(`Missing VDF value for "${key}".`);
      } else {
        object[key] = value;
        index += 1;
      }
    }

    return object;
  }

  return parseObject();
}

function asObject(value: VdfValue | undefined): VdfObject | null {
  return value !== undefined && typeof value !== "string" ? value : null;
}

function asString(value: VdfValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export interface ParsedSteamLibrary {
  path: string;
  hasTargetApp: boolean;
}

export function parseSteamLibraryFolders(
  content: string,
  fallbackSteamPath?: string
): ParsedSteamLibrary[] {
  const parsed = parseVdf(content);
  const root = asObject(parsed.libraryfolders) ?? parsed;
  const libraries: ParsedSteamLibrary[] = [];

  for (const [key, value] of Object.entries(root)) {
    if (!/^\d+$/.test(key)) {
      continue;
    }

    if (typeof value === "string") {
      libraries.push({
        path: value,
        hasTargetApp: false
      });
      continue;
    }

    const libraryPath = asString(value.path);
    if (!libraryPath) {
      continue;
    }

    const apps = asObject(value.apps);
    libraries.push({
      path: libraryPath,
      hasTargetApp: asString(apps?.[CLAWED_STEAM_APP_ID]) !== null
    });
  }

  if (
    fallbackSteamPath &&
    !libraries.some(
      (library) =>
        path.normalize(library.path).toLowerCase() ===
        path.normalize(fallbackSteamPath).toLowerCase()
    )
  ) {
    libraries.unshift({
      path: fallbackSteamPath,
      hasTargetApp: false
    });
  }

  return libraries;
}

export interface ParsedAppManifest {
  appId: string | null;
  installDir: string | null;
  name: string | null;
  buildId: string | null;
  lastUpdated: string | null;
}

export function parseAppManifest(content: string): ParsedAppManifest {
  const parsed = parseVdf(content);
  const appState = asObject(parsed.AppState) ?? asObject(parsed.appstate);

  if (!appState) {
    throw new Error("Steam app manifest is missing AppState.");
  }

  return {
    appId: asString(appState.appid),
    installDir: asString(appState.installdir),
    name: asString(appState.name),
    buildId: asString(appState.buildid),
    lastUpdated: asString(appState.LastUpdated) ?? asString(appState.lastupdated)
  };
}
