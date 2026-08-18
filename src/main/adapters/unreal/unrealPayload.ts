import path from "node:path";

const cookedUnrealAssetExtensions = new Set([
  ".uasset",
  ".uexp",
  ".ubulk",
  ".umap"
]);

export function isUnrealAssetPayload(relativePath: string): boolean {
  return [".pak", ".utoc", ".ucas"].includes(
    path.extname(relativePath).toLowerCase()
  );
}

export function isLooseCookedUnrealAssetPayload(relativePath: string): boolean {
  return cookedUnrealAssetExtensions.has(path.extname(relativePath).toLowerCase());
}

export function resolveUnrealPakTarget(
  payloadRelativePath: string,
  pakTargetRelativePath?: string | null
): string | null {
  const segments = payloadRelativePath.replaceAll("\\", "/").split("/");

  for (let index = 0; index < segments.length - 1; index += 1) {
    if (
      segments[index].toLowerCase() === "content" &&
      segments[index + 1].toLowerCase() === "paks"
    ) {
      if (pakTargetRelativePath) {
        return path.join(
          pakTargetRelativePath,
          ...segments.slice(index + 2)
        );
      }
      return path.join(...segments.slice(index));
    }
  }

  const paksIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "paks"
  );
  if (paksIndex < 0) {
    return null;
  }

  return pakTargetRelativePath
    ? path.join(pakTargetRelativePath, ...segments.slice(paksIndex + 1))
    : path.join(...segments.slice(paksIndex));
}
