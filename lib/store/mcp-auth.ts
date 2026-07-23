import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const dataDir = () => resolve(process.env.MORGANA_DATA_DIR ?? (process.env.NODE_ENV === "production" ? "/data" : "./data"));
const tokenFile = () => join(dataDir(), "mcp-token.json");

interface TokenFile { token: string; }

async function readTokenFile(): Promise<TokenFile | null> {
  try {
    return JSON.parse(await readFile(tokenFile(), "utf8")) as TokenFile;
  } catch {
    return null;
  }
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

async function writeToken(token: string): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(tokenFile(), JSON.stringify({ token }, null, 2) + "\n", "utf8");
}

export async function getOrCreateToken(): Promise<string> {
  const existing = await readTokenFile();
  if (existing?.token) return existing.token;
  const token = newToken();
  await writeToken(token);
  return token;
}

export async function regenerateToken(): Promise<string> {
  const token = newToken();
  await writeToken(token);
  return token;
}

export async function verifyToken(candidate: string | null): Promise<boolean> {
  if (!candidate) return false;
  return candidate === (await getOrCreateToken());
}
