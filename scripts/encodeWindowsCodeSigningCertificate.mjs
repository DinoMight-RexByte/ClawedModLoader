import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const certPath = process.argv[2];

if (!certPath) {
  process.stderr.write(
    "Usage: node scripts/encodeWindowsCodeSigningCertificate.mjs <certificate.pfx|certificate.p12>"
  );
  process.stderr.write("\n");
  process.exit(1);
}

const extension = path.extname(certPath).toLowerCase();
if (![".pfx", ".p12"].includes(extension)) {
  process.stderr.write("Certificate must be a .pfx or .p12 file.\n");
  process.exit(1);
}

process.stdout.write(readFileSync(certPath).toString("base64"));
