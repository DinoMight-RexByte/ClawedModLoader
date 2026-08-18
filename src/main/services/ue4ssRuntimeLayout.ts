import path from "node:path";

export interface Ue4ssRuntimeEntryLike {
  relativeName: string;
  dir?: boolean;
}

export interface Ue4ssRuntimeLayout {
  variant: "modern-root" | "modern-subdirectory" | "legacy-xinput";
  settingsRelativePath: string;
  proxyRelativePath: string;
  ue4ssDllRelativePath: string | null;
  modsRelativePath: string;
  modsTxtRelativePath: string;
  profileConfigRelativePath: string;
}

export function detectUe4ssRuntimeLayout(
  entries: Ue4ssRuntimeEntryLike[]
): Ue4ssRuntimeLayout | null {
  const fileNames = entries
    .filter((entry) => !entry.dir)
    .map((entry) => entry.relativeName.replaceAll("\\", "/"));
  const findFile = (target: string) =>
    fileNames.find((fileName) => normalizeRelativePath(fileName) === target) ??
    null;

  const rootSettings = findFile("ue4ss-settings.ini");
  const rootDwmapi = findFile("dwmapi.dll");
  const rootUe4ssDll = findFile("ue4ss.dll");
  if (rootSettings && rootDwmapi && rootUe4ssDll) {
    return layoutFor("modern-root", rootSettings, rootDwmapi, rootUe4ssDll, "Mods");
  }

  const rootXinput = findFile("xinput1_3.dll");
  if (rootSettings && rootXinput) {
    return layoutFor("legacy-xinput", rootSettings, rootXinput, null, "Mods");
  }

  const nestedSettings = findFile("ue4ss/ue4ss-settings.ini");
  const nestedUe4ssDll = findFile("ue4ss/ue4ss.dll");
  if (rootDwmapi && nestedSettings && nestedUe4ssDll) {
    const runtimeRoot = path.posix.dirname(nestedSettings);
    return layoutFor(
      "modern-subdirectory",
      nestedSettings,
      rootDwmapi,
      nestedUe4ssDll,
      path.posix.join(runtimeRoot, "Mods")
    );
  }

  return null;
}

export function isUe4ssRuntimeStructureValid(
  entries: Ue4ssRuntimeEntryLike[]
): boolean {
  return detectUe4ssRuntimeLayout(entries) !== null;
}

function layoutFor(
  variant: Ue4ssRuntimeLayout["variant"],
  settingsRelativePath: string,
  proxyRelativePath: string,
  ue4ssDllRelativePath: string | null,
  modsRelativePath: string
): Ue4ssRuntimeLayout {
  return {
    variant,
    settingsRelativePath,
    proxyRelativePath,
    ue4ssDllRelativePath,
    modsRelativePath,
    modsTxtRelativePath: path.posix.join(modsRelativePath, "mods.txt"),
    profileConfigRelativePath: path.posix.join(modsRelativePath, "cmm-profile.json")
  };
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").toLowerCase();
}
