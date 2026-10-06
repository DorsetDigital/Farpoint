import { readFile, writeFile } from "node:fs/promises";

const basePath = new URL("../wrangler.jsonc", import.meta.url);
const localPath = new URL("../.farpoint.local.json", import.meta.url);
const outputPath = new URL("../.wrangler.generated.jsonc", import.meta.url);

let base;
let local;

try {
  base = JSON.parse(await readFile(basePath, "utf8"));
} catch (error) {
  console.error("Unable to read wrangler.jsonc:", error.message);
  process.exit(1);
}

try {
  local = JSON.parse(await readFile(localPath, "utf8"));
} catch (error) {
  console.error(
    "Unable to read .farpoint.local.json. Copy .farpoint.local.example.json " +
      "to .farpoint.local.json and add the production D1 database ID.",
  );
  process.exit(1);
}

if (
  typeof local.database_id !== "string" ||
  !local.database_id.trim()
) {
  console.error(".farpoint.local.json must contain a non-empty database_id.");
  process.exit(1);
}

if (!Array.isArray(base.d1_databases) || base.d1_databases.length !== 1) {
  console.error(
    "wrangler.jsonc must contain exactly one D1 binding for Farpoint.",
  );
  process.exit(1);
}

base.d1_databases[0].database_id = local.database_id.trim();

await writeFile(
  outputPath,
  JSON.stringify(base, null, 2) + "\n",
  "utf8",
);

console.log("Generated .wrangler.generated.jsonc");
