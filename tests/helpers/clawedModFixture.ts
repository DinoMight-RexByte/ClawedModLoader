import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

import type { ClawedModManifestV1 } from "../../src/shared/contracts/app";

export interface ClawedModFixtureOptions {
  manifest?: Partial<ClawedModManifestV1>;
  includePayload?: boolean;
  includeReadme?: boolean;
  includeIcon?: boolean;
  payloadText?: string;
  payloadEntries?: Array<{
    name: string;
    content: string | Buffer;
  }>;
  unsafeEntries?: Array<{
    name: string;
    content: string;
  }>;
  manifestJsonOverride?: unknown;
  checksumsJsonOverride?: unknown;
}

export function createFixtureManifest(
  overrides?: Partial<ClawedModManifestV1>
): ClawedModManifestV1 {
  const id = overrides?.id ?? "core-framework";
  return {
    schemaVersion: 1,
    id,
    name: "Core Framework",
    version: "1.0.0",
    author: "CMM Fixtures",
    description: "Fixture mod with no real Clawed modifications.",
    game: "clawed",
    loader: "ue4ss",
    dependencies: [],
    conflicts: [],
    loadAfter: [],
    loadBefore: [],
    packageIdentity: {
      schemaVersion: 1,
      id: `cmm:test:${id}`,
      source: "cmmGenerated"
    },
    ...overrides
  };
}

export async function createClawedModFixture(
  outputPath: string,
  options?: ClawedModFixtureOptions
): Promise<{
  packagePath: string;
  manifest: ClawedModManifestV1;
}> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const manifest = createFixtureManifest(options?.manifest);
  const zip = new JSZip();
  zip.file(
    "manifest.json",
    JSON.stringify(options?.manifestJsonOverride ?? manifest, null, 2)
  );

  if (options?.includePayload !== false) {
    if (options?.payloadEntries?.length) {
      for (const entry of options.payloadEntries) {
        zip.file(`payload/${entry.name}`, entry.content);
      }
    } else {
      const defaultPayloadPath =
        manifest.loader === "ue4ss"
          ? `payload/Mods/${manifest.id}/Scripts/main.lua`
          : "payload/fixture.txt";
      zip.file(defaultPayloadPath, options?.payloadText ?? "fixture content only");
    }
  }

  if (options?.includeReadme !== false) {
    zip.file("README.md", `# ${manifest.name}\n\nFixture README.`);
  }

  if (options?.includeIcon) {
    zip.file(
      "icon.png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64"
      )
    );
  }

  if (options?.checksumsJsonOverride) {
    zip.file(
      "checksums.json",
      JSON.stringify(options.checksumsJsonOverride, null, 2)
    );
  }

  for (const entry of options?.unsafeEntries ?? []) {
    zip.file(entry.name, entry.content);
  }

  await writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer" }));

  return {
    packagePath: outputPath,
    manifest
  };
}

export async function createExampleClawedModFixtures(
  outputDirectory: string
): Promise<string[]> {
  const examples: Array<Partial<ClawedModManifestV1>> = [
    {
      id: "core-framework",
      name: "Core Framework",
      loader: "ue4ss"
    },
    {
      id: "character-framework",
      name: "Character Framework",
      loader: "ue4ss",
      dependencies: [{ id: "core-framework" }]
    },
    {
      id: "female-character-a",
      name: "Female Character A",
      loader: "pak",
      dependencies: [{ id: "character-framework" }]
    },
    {
      id: "female-character-b",
      name: "Female Character B",
      loader: "pak",
      dependencies: [{ id: "character-framework" }]
    },
    {
      id: "male-character",
      name: "Male Character",
      loader: "pak",
      dependencies: [{ id: "character-framework" }]
    }
  ];

  const outputPaths: string[] = [];
  for (const example of examples) {
    const outputPath = path.join(outputDirectory, `${example.id}.clawedmod`);
    await createClawedModFixture(outputPath, { manifest: example });
    outputPaths.push(outputPath);
  }

  return outputPaths;
}
