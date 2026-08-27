import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const versionPattern = /^\d+\.\d+\.\d+$/;
const usage = [
  "Usage: npm run release -- -v <x.y.z>",
  "       npm run release -- --version <x.y.z>",
  "       npm run release -- <x.y.z>"
].join("\n");
const releaseVersionFiles = new Set(["package-lock.json", "package.json"]);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    fail(result.error.message);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function read(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    fail(result.error.message);
  }
  if (result.status !== 0) {
    fail(result.stderr.trim() || `${command} ${args.join(" ")} failed.`);
  }
  return result.stdout.trim();
}

function readHeadJson(filePath) {
  return JSON.parse(read("git", ["show", `HEAD:${filePath}`]));
}

function changedPaths(status) {
  return status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim().replaceAll("\\", "/"));
}

function withVersion(value, version) {
  return { ...value, version };
}

function withLockVersion(value, version) {
  return {
    ...value,
    version,
    packages: {
      ...value.packages,
      "": {
        ...value.packages[""],
        version
      }
    }
  };
}

export function createNpmInvocation(args, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const nodePath = options.nodePath ?? process.execPath;
  const npmExecPath = env.npm_execpath;

  if (npmExecPath?.endsWith(".js")) {
    return [nodePath, [npmExecPath, ...args]];
  }

  return [platform === "win32" ? "npm.cmd" : "npm", args];
}

function runNpm(args) {
  const [command, npmArgs] = createNpmInvocation(args);
  run(command, npmArgs);
}

function hasTag(tag) {
  const local = spawnSync("git", [
    "rev-parse",
    "--quiet",
    "--verify",
    `refs/tags/${tag}`
  ]);
  if (local.status === 0) {
    return true;
  }

  const remote = spawnSync("git", [
    "ls-remote",
    "--exit-code",
    "--tags",
    "origin",
    `refs/tags/${tag}`
  ]);
  if (remote.status === 0) {
    return true;
  }
  if (remote.status === 2) {
    return false;
  }
  fail("Could not check remote release tags.");
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

export function isVersionOnlyReleaseBump(
  version,
  workingPackageJson,
  workingPackageLock,
  headPackageJson,
  headPackageLock
) {
  return (
    workingPackageJson.version === version &&
    workingPackageLock.version === version &&
    workingPackageLock.packages?.[""]?.version === version &&
    compareVersions(version, headPackageJson.version) > 0 &&
    JSON.stringify(withVersion(workingPackageJson, headPackageJson.version)) ===
      JSON.stringify(headPackageJson) &&
    JSON.stringify(withLockVersion(workingPackageLock, headPackageLock.version)) ===
      JSON.stringify(headPackageLock)
  );
}

function parseVersion(args) {
  let version = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "-h" || arg === "--help") {
      process.stdout.write(`${usage}\n`);
      process.exit(0);
    }

    if (arg === "-v" || arg === "--version") {
      if (version) {
        fail("Release version was provided more than once.");
      }
      version = args[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--version=")) {
      if (version) {
        fail("Release version was provided more than once.");
      }
      version = arg.slice("--version=".length);
      continue;
    }

    if (!arg.startsWith("-") && !version) {
      version = arg;
      continue;
    }

    fail(`Unknown release argument: ${arg}`);
  }

  return version;
}

export function runReleaseFlow(args) {
  const version = parseVersion(args);

  if (!version || !versionPattern.test(version)) {
    fail(usage);
  }

  if (read("git", ["branch", "--show-current"]) !== "main") {
    fail("Release flow must run from main.");
  }

  run("git", ["fetch", "origin", "main", "--tags"]);

  const status = read("git", ["status", "--porcelain"]);
  const currentPackageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const currentPackageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const headPackageJson = status ? readHeadJson("package.json") : currentPackageJson;
  const headPackageLock = status ? readHeadJson("package-lock.json") : currentPackageLock;
  const resumableVersionBump =
    status &&
    changedPaths(status).every((filePath) => releaseVersionFiles.has(filePath)) &&
    isVersionOnlyReleaseBump(
      version,
      currentPackageJson,
      currentPackageLock,
      headPackageJson,
      headPackageLock
    );

  if (status && !resumableVersionBump) {
    fail(
      "Release flow requires a clean worktree or an interrupted package version bump for the requested release."
    );
  }

  const ancestry = spawnSync("git", [
    "merge-base",
    "--is-ancestor",
    "origin/main",
    "HEAD"
  ]);
  if (ancestry.status !== 0) {
    fail("Local main is behind origin/main. Pull or merge before releasing.");
  }

  const baselineVersion = resumableVersionBump ? headPackageJson.version : currentPackageJson.version;
  if (compareVersions(version, baselineVersion) <= 0) {
    fail(`Release version ${version} must be newer than ${baselineVersion}.`);
  }

  const tag = `v${version}`;
  if (hasTag(tag)) {
    fail(`${tag} already exists.`);
  }

  if (resumableVersionBump) {
    process.stdout.write(`Resuming release ${tag} from existing package version bump.\n`);
  } else {
    runNpm(["version", version, "--no-git-tag-version"]);
  }
  runNpm(["run", "verify"]);
  run("git", ["add", "package.json", "package-lock.json"]);
  run("git", ["commit", "-m", `Release ${version}`]);
  run("git", ["tag", tag]);
  run("git", ["push", "origin", "main"]);
  run("git", ["push", "origin", tag]);

  process.stdout.write(`Release ${tag} pushed. GitHub Actions will publish the app artifacts.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReleaseFlow(process.argv.slice(2));
}
