#!/usr/bin/env node
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const platform = os.platform();
const arch = os.arch();

// Wrap spawnSync in a safe function
function run(cmd, cwd, env = process.env) {
  console.log(`> ${cmd}`);
  const result = spawnSync(cmd, { shell: true, stdio: "inherit", cwd, env });
  if (result.error) {
    console.error("Command failed:", result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`Command exited with code ${result.status}`);
    process.exit(result.status);
  }
}

// Get package version from ts-test-runner/package.json
function getPackageVersion(pkgName) {
  const pkgJsonPath = path.join(__dirname, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    throw new Error("package.json not found in ts-test-runner folder");
  }
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  const version = pkgJson.dependencies?.[pkgName] || pkgJson.devDependencies?.[pkgName];
  if (!version) throw new Error(`Package ${pkgName} not found in ts-test-runner/package.json`);
  return version.replace(/^[^0-9]*/, ""); // remove ^ or ~
}

// ---------- ESBUILD ----------
function installEsbuild() {
  const cwd = __dirname;
  const version = getPackageVersion("esbuild");
  let pkg = "";

  switch (platform) {
    case "win32":
      pkg = `@esbuild/win32-x64@${version}`;
      break;
    case "linux":
      pkg = arch === "x64" ? `@esbuild/linux-x64@${version}` : `@esbuild/linux-arm64@${version}`;
      break;
    case "darwin":
      pkg = arch === "arm64" ? `@esbuild/darwin-arm64@${version}` : `@esbuild/darwin-x64@${version}`;
      break;
    default:
      console.warn("Unsupported platform for esbuild");
      return;
  }

  run(`npm install ${pkg} --no-save`, cwd);
}

// ---------- ROLLUP ----------
function installRollup() {
  const cwd = __dirname;
  let pkg = "";
  switch (platform) {
    case "win32":
      pkg = "@rollup/rollup-win32-x64-msvc";
      break;
    case "linux":
      pkg = arch === "x64" ? "@rollup/rollup-linux-x64-gnu" : "@rollup/rollup-linux-arm64-gnu";
      break;
    case "darwin":
      pkg = arch === "arm64" ? "@rollup/rollup-darwin-arm64" : "@rollup/rollup-darwin-x64";
      break;
    default:
      console.warn("Unsupported platform for rollup");
      return;
  }
  run(`npm install ${pkg} --no-save`, cwd);
}

// ---------- PLAYWRIGHT ----------
function installPlaywright() {
  const cwd = __dirname;

  // Install core packages
  run("npm install playwright-core --no-save", cwd);
  run("npm install playwright --no-save", cwd);
}

// ---------- RUN INSTALLERS ----------
installEsbuild();
installRollup();
installPlaywright();
