import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const requiredMapFiles = [
  "clawed-all-files-and-container-entries.csv",
  "clawed-physical-files.csv",
  "clawed-shipping-manifest-entries.csv",
  "clawed-container-entries-annotated.csv",
  "clawed-map-summary.json"
];
const errors = [];

for (const resource of packageJson.build?.extraResources ?? []) {
  const source = path.resolve(repoRoot, resource.from);
  if (!existsSync(source)) {
    errors.push(`Missing packaged resource: ${resource.from}`);
    continue;
  }

  if (resource.to === "clawed-game-file-map/20260814-current") {
    for (const fileName of requiredMapFiles) {
      const filePath = path.join(source, fileName);
      const fileStat = existsSync(filePath) ? statSync(filePath) : null;
      if (!fileStat?.isFile() || fileStat.size === 0) {
        errors.push(`Missing Clawed asset map file: ${resource.from}/${fileName}`);
      }
    }
  }
}

if (errors.length) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Packaged resources verified.\n");
