import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const versionPattern = /^\d+\.\d+\.\d+$/;
const usage = [
  "Usage: npm run release -- -v <x.y.z>",
  "       npm run release -- --version <x.y.z>",
  "       npm run release -- <x.y.z>"
].join("\n");

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

const version = parseVersion(process.argv.slice(2));

if (!version || !versionPattern.test(version)) {
  fail(usage);
}

if (read("git", ["branch", "--show-current"]) !== "main") {
  fail("Release flow must run from main.");
}

run("git", ["fetch", "origin", "main", "--tags"]);

const status = read("git", ["status", "--porcelain"]);
if (status) {
  fail("Release flow requires a clean worktree. Commit or stash changes first.");
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

const currentVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
if (compareVersions(version, currentVersion) <= 0) {
  fail(`Release version ${version} must be newer than ${currentVersion}.`);
}

const tag = `v${version}`;
if (hasTag(tag)) {
  fail(`${tag} already exists.`);
}

run("npm", ["version", version, "--no-git-tag-version"]);
run("npm", ["run", "verify"]);
run("git", ["add", "package.json", "package-lock.json"]);
run("git", ["commit", "-m", `Release ${version}`]);
run("git", ["tag", tag]);
run("git", ["push", "origin", "main"]);
run("git", ["push", "origin", tag]);

process.stdout.write(`Release ${tag} pushed. GitHub Actions will publish the app artifacts.\n`);
