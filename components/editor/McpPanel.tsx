"use client";
import { useEffect, useState } from "react";

async function fetchToken(): Promise<string> {
  const res = await fetch("/api/mcp-token");
  if (!res.ok) throw new Error(`Failed to fetch token: ${res.status}`);
  return (await res.json()).token as string;
}

async function regenerateToken(): Promise<string> {
  const res = await fetch("/api/mcp-token", { method: "POST" });
  if (!res.ok) throw new Error(`Failed to regenerate token: ${res.status}`);
  return (await res.json()).token as string;
}

export function McpPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchToken()
      .then((t) => { setToken(t); setError(null); })
      .catch(() => setError("Couldn't load token"));
  }, []);

  const url = typeof window !== "undefined" ? `${window.location.origin}/api/mcp` : "/api/mcp";

  const onRegenerate = async () => {
    try {
      const t = await regenerateToken();
      setToken(t);
      setRevealed(true);
      setError(null);
    } catch {
      setError("Couldn't regenerate token");
    }
  };

  const onCopy = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopyLabel("Copied");
    setTimeout(() => setCopyLabel("Copy"), 1500);
  };

  return (
    <div className="ed__inspector" data-testid="mcp-panel">
      <div style={{ fontFamily: "var(--ed-disp)", fontSize: 14, marginBottom: 11 }}>Connect Claude</div>
      <p style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
        Add this as an MCP connector in claude.ai or Claude Desktop to let Claude read and edit this deck,
        using your own Claude account. Morgana never sees or stores your Anthropic credentials.
      </p>
      <label style={{ fontSize: 12, opacity: 0.75 }}>Server URL</label>
      <input readOnly value={url} data-testid="mcp-url" style={{ width: "100%", fontFamily: "var(--ed-mono)", fontSize: 12, marginBottom: 8 }} />
      <label style={{ fontSize: 12, opacity: 0.75 }}>Token</label>
      <input
        readOnly
        type={revealed ? "text" : "password"}
        value={token ?? ""}
        data-testid="mcp-token"
        style={{ width: "100%", fontFamily: "var(--ed-mono)", fontSize: 12, marginBottom: 8 }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ed__pill ed__pill--ghost" data-testid="mcp-reveal" onClick={() => setRevealed((r) => !r)}>{revealed ? "Hide" : "Reveal"}</button>
        <button className="ed__pill ed__pill--ghost" data-testid="mcp-copy" onClick={onCopy}>{copyLabel}</button>
        <button className="ed__pill ed__pill--ghost" data-testid="mcp-regenerate" onClick={onRegenerate}>Regenerate</button>
      </div>
      {error && (
        <p style={{ fontSize: 12, color: "#d33", marginTop: 8 }} data-testid="mcp-error">
          {error}
        </p>
      )}
    </div>
  );
}
