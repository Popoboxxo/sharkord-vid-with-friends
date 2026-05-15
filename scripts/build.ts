import { build } from "bun";
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from "fs";
import { join } from "path";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const PLUGIN_NAME = pkg.name;
const OUTDIR = `dist/${PLUGIN_NAME}`;

async function main() {
  // Clean + create dist
  if (existsSync("dist")) {
    await Bun.$`rm -rf dist`;
  }
  mkdirSync(OUTDIR, { recursive: true });

  // Build
  const result = await build({
    entrypoints: ["src/index.ts"],
    outdir: OUTDIR,
    target: "bun",
    minify: true,
    format: "esm",
  });

  if (!result.success) {
    console.error("Build failed:", result.logs);
    process.exit(1);
  }

  // Copy metadata
  writeFileSync(
    join(OUTDIR, "package.json"),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        sharkord: pkg.sharkord,
        type: "module",
      },
      null,
      2
    )
  );

  // Copy logo if present
  if (existsSync("logo.png")) {
    copyFileSync("logo.png", join(OUTDIR, "logo.png"));
  }

  // Create bin/ for external binaries
  mkdirSync(join(OUTDIR, "bin"), { recursive: true });

  console.log(`✓ Build complete: ${OUTDIR}/`);
}

main();
