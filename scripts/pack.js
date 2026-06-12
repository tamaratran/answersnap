/**
 * Packages the extension into a ZIP file ready for Chrome Web Store upload.
 *
 * Usage: node scripts/pack.js
 * Output: dist/cheatly-<version>.zip
 */

import { execSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const version = manifest.version;

const distDir = resolve(root, "dist");
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

const outFile = resolve(distDir, `cheatly-${version}.zip`);

const includeFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "content.css",
  "popup.html",
  "popup.js",
  "popup.css",
  "privacy-policy.html",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

const fileList = includeFiles.join(" ");

execSync(`cd "${root}" && zip "${outFile}" ${fileList}`, { stdio: "inherit" });

console.log(`\nPackaged: dist/cheatly-${version}.zip`);
