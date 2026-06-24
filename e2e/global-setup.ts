import { execSync } from "node:child_process";

/** Build once and prepare the standalone server so both webServers launch without rebuilding. */
export default function globalSetup() {
  execSync("bash scripts/prepare-standalone.sh", { stdio: "inherit" });
}
