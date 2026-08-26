import process from "node:process";

const cert = process.env.WIN_CSC_LINK || process.env.CSC_LINK;
const password =
  process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD;

const missing = [
  cert ? null : "WIN_CSC_LINK or CSC_LINK",
  password ? null : "WIN_CSC_KEY_PASSWORD or CSC_KEY_PASSWORD"
].filter(Boolean);

if (missing.length > 0) {
  process.stderr.write(
    `Windows code signing credentials are required for release publishing: ${missing.join(", ")}.`
  );
  process.stderr.write("\n");
  process.exit(1);
}

process.stdout.write("Windows code signing credentials are configured.\n");
