import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const source = path.resolve("docs", "MANUAL_QA_VALIDATION.md");
const releaseRoot = path.resolve("release");
const targets = [path.join(releaseRoot, "QA-README.md")];
const unpackedRoot = path.join(releaseRoot, "win-unpacked");

if (await exists(unpackedRoot)) {
  targets.push(path.join(unpackedRoot, "QA-README.md"));
}

for (const target of targets) {
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function exists(targetPath) {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}
