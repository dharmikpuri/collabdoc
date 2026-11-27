/**
 * Minimal Chrome DevTools Protocol driver.
 *
 * Used by the verification harness to exercise flows that go through Next.js
 * server actions (sign-up, document creation). Those use an internal wire
 * format that is not a stable API, so the harness drives a real browser instead
 * of hand-crafting the request — the same reason we don't reverse-engineer it.
 *
 * No test-only routes, no auth bypass: this is the real form, really submitted.
 */
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

async function findBrowser() {
  const { existsSync } = await import("node:fs");
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error("No Chrome/Edge binary found for browser-driven steps");
  return found;
}

export async function launchBrowser({ port = 9333, headless = true } = {}) {
  const binary = await findBrowser();
  const profile = join(tmpdir(), `collabdoc-verify-${Date.now()}`);

  const proc = spawn(
    binary,
    [
      `--remote-debugging-port=${port}`,
      ...(headless ? ["--headless=new"] : []),
      // CI runners are throwaway containers where Chrome's sandbox can't start.
      ...(process.env.CI ? ["--no-sandbox"] : []),
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  // Wait for the debugging endpoint to accept connections.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) break;
    } catch {
      // not up yet
    }
    await sleep(250);
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    // On Windows the process we spawned hands off to a relaunched browser that is
    // not its child, so killing our pid (or its tree) leaves Chrome running with
    // the profile locked. Every one of its processes carries this run's unique
    // profile folder in its command line, so stop them by that — repeatedly,
    // since Chrome can start a helper process while the others are being stopped.
    if (process.platform === "win32") {
      const ours = `Get-CimInstance Win32_Process -Filter "Name='${basename(binary)}'" | Where-Object { $_.CommandLine -like '*${basename(profile)}*' }`;
      spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `for ($i = 0; $i -lt 10; $i++) { $p = @(${ours}); if ($p.Count -eq 0) { break }; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 300 }`,
        ],
        { stdio: "ignore" },
      );
    } else {
      proc.kill();
    }
    // Every run gets a fresh profile (~50 MB); remove it so repeated runs don't fill
    // the disk. Files stay locked for a moment after Chrome exits, so retry for a
    // few seconds. This must stay synchronous: callers exit straight after.
    const pause = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + 5_000;
    for (;;) {
      try {
        rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        if (Date.now() > deadline) break; // best effort: at worst this one folder is left
        Atomics.wait(pause, 0, 0, 200);
      }
    }
  };
  // Also when a run crashes or exits early, so Chrome and its profile don't outlive it.
  process.once("exit", close);

  return { proc, port, close };
}

/**
 * Opens a page in its own incognito browser context and returns a small command
 * interface over CDP.
 *
 * Each actor gets an isolated context so cookie jars never bleed between them —
 * otherwise the second sign-up would arrive already authenticated and be
 * redirected away from the form.
 */
export async function newPage(port) {
  // Create an isolated context via the browser-level endpoint.
  const versionRes = await fetch(`http://127.0.0.1:${port}/json/version`);
  const { webSocketDebuggerUrl } = await versionRes.json();

  const browserWs = new WebSocket(webSocketDebuggerUrl);
  const browserPending = new Map();
  let browserId = 0;
  browserWs.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && browserPending.has(message.id)) {
      browserPending.get(message.id)(message);
      browserPending.delete(message.id);
    }
  };
  await new Promise((resolve, reject) => {
    browserWs.onopen = resolve;
    browserWs.onerror = reject;
  });
  const browserSend = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++browserId;
      browserPending.set(id, resolve);
      browserWs.send(JSON.stringify({ id, method, params }));
    });

  const ctx = await browserSend("Target.createBrowserContext", {});
  const browserContextId = ctx.result?.browserContextId;
  const created = await browserSend("Target.createTarget", {
    url: "about:blank",
    browserContextId,
  });
  const targetId = created.result?.targetId;
  browserWs.close();

  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = list.find((t) => t.id === targetId) ?? list.find((t) => t.type === "page");
  if (!target) throw new Error("Could not open a browser page");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  return {
    send,
    async goto(url, settleMs = 2500) {
      await send("Page.navigate", { url });
      await sleep(settleMs);
    },
    async evaluate(expression, { awaitPromise = true } = {}) {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise,
        returnByValue: true,
      });
      const details = result.result?.exceptionDetails;
      if (details) {
        const message =
          details.exception?.description ??
          details.exception?.value ??
          details.text ??
          "evaluate failed";
        throw new Error(String(message).split("\n")[0]);
      }
      return result.result?.result?.value;
    },
    /** Returns all cookies as a `name=value; …` header string. */
    async cookieHeader() {
      const { result } = await send("Network.getCookies", {
        urls: ["http://localhost:3000"],
      });
      return (result?.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
    },
    close: () => ws.close(),
  };
}
