import path from "node:path";

export function encodeLibraryPathSegment(value: string): string {
  return encodeURIComponent(value).replaceAll(".", "%2E");
}

export function getInstalledModPath(
  libraryModsPath: string,
  modId: string,
  version: string
): string {
  return path.join(
    libraryModsPath,
    encodeLibraryPathSegment(modId),
    encodeLibraryPathSegment(version)
  );
}

export function isPathInside(parentDirectory: string, targetPath: string): boolean {
  const normalizedParent = path.resolve(parentDirectory);
  const normalizedTarget = path.resolve(targetPath);
  const relative = path.relative(normalizedParent, normalizedTarget);

  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
