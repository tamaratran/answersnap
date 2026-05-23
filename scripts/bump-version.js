/**
 * Bumps the version in both manifest.json and package.json.
 *
 * Usage:
 *   node scripts/bump-version.js patch   (1.0.0 → 1.0.1)
 *   node scripts/bump-version.js minor   (1.0.0 → 1.1.0)
 *   node scripts/bump-version.js major   (1.0.0 → 2.0.0)
 *   node scripts/bump-version.js 1.2.3   (set explicit version)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const arg = process.argv[2] || "patch";

function bumpVersion(current, type) {
  const parts = current.split(".").map(Number);
  if (type === "major") return `${parts[0] + 1}.0.0`;
  if (type === "minor") return `${parts[0]}.${parts[1] + 1}.0`;
  if (type === "patch") return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  return type; // explicit version string
}

function updateJsonFile(filePath, newVersion) {
  const raw = readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);
  const oldVersion = json.version;
  json.version = newVersion;
  writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
  return oldVersion;
}

const manifestPath = resolve(root, "manifest.json");
const packagePath = resolve(root, "package.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const newVersion = bumpVersion(manifest.version, arg);

updateJsonFile(manifestPath, newVersion);
updateJsonFile(packagePath, newVersion);

console.log(`Version bumped: ${manifest.version} → ${newVersion}`);
