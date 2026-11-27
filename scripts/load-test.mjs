/**
 * Load test for the real-time path: N editors typing into one document at once.
 *
 * Drives the real collab server (auth, read-only rules, persistence) with real
 * Hocuspocus/Yjs clients — the same libraries the editor uses — and checks the
 * three things that matter:
 *
 *   1. Convergence: every client ends with exactly the same document.
 *   2. No lost edits: every edit any client made is in that document.
 *   3. Durability: a fresh client, connecting after everyone has left, loads
 *      all of it back from Postgres.
 *
 * It also measures how long an edit takes to reach another user (a separate
 * read-only observer, so the number includes a full client → server → client
 * hop) and how long clients take to connect and sync.
 *
 * Needs the collab server running and its database reachable. It creates a
 * throwaway user and document and deletes them afterwards (pass --keep to
 * leave them). Never point it at production.
 *
 * Usage:
 *   node scripts/load-test.mjs [--clients 50] [--edits 20] [--interval 250]
 *                              [--url ws://localhost:1234] [--keep] [--json out.json]
 * Env: COLLAB_TOKEN_SECRET (same as the collab server), DATABASE_URL.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { SignJWT } from "jose";
import * as Y from "yjs";

import prismaPkg from "../src/generated/prisma/index.js";

const { PrismaClient } = prismaPkg;

const { values: args } = parseArgs({
  options: {
    clients: { type: "string", default: "50" },
    edits: { type: "string", default: "20" },
    interval: { type: "string", default: "250" },
    url: {
      type: "string",
      default: process.env.NEXT_PUBLIC_COLLAB_WS_URL ?? "ws://localhost:1234",
    },
    keep: { type: "boolean", default: false },
    json: { type: "string" },
  },
});

const CLIENTS = Number(args.clients);
const EDITS = Number(args.edits);
const INTERVAL_MS = Number(args.interval);
const TIMEOUT_MS = 60_000;

const secret = process.env.COLLAB_TOKEN_SECRET;
if (!secret) throw new Error("COLLAB_TOKEN_SECRET is not set");
const key = new TextEncoder().encode(secret);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0;
const TOKEN = /\[lt-(\d+)-(\d+)-(\d+)\]/g;

/** Same claims the app's /api/collab-token issues. */
function collabToken(userId, documentId, role) {
  return new SignJWT({ documentId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

/** Opens a provider and resolves once its first sync completes. */
async function connect(documentId, userId, role) {
  const doc = new Y.Doc();
  const token = await collabToken(userId, documentId, role);
  const started = performance.now();
  let provider;
  const synced = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sync timed out")), TIMEOUT_MS);
    provider = new HocuspocusProvider({
      url: args.url,
      name: documentId,
      document: doc,
      token,
      onSynced: () => {
        clearTimeout(timer);
        resolve();
      },
      onAuthenticationFailed: ({ reason }) => reject(new Error(`auth failed: ${reason}`)),
    });
  });
  await synced;
  return { doc, provider, syncMs: performance.now() - started };
}

/** One edit: a new paragraph, or text added to the start or end of an existing one. */
function edit(doc, random, label) {
  const fragment = doc.getXmlFragment("default");
  const paragraphs = fragment.toArray().filter((node) => node instanceof Y.XmlElement);
  if (paragraphs.length === 0 || random() < 0.5) {
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, label);
    paragraph.insert(0, [text]);
    fragment.insert(Math.floor(random() * (fragment.length + 1)), [paragraph]);
    return;
  }
  // Inserting only at the edges means a concurrent edit can never split a label.
  const target = paragraphs[Math.floor(random() * paragraphs.length)];
  const text = target.get(0);
  if (!(text instanceof Y.XmlText)) return edit(doc, () => 0, label);
  if (random() < 0.5) text.insert(0, `${label} `);
  else text.insert(text.length, ` ${label}`);
}

function rng(seed) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

const labelsIn = (doc) =>
  new Set([...doc.getXmlFragment("default").toString().matchAll(TOKEN)].map((m) => m[0]));

async function main() {
  const runStarted = performance.now();
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: { email: `load-test+${stamp}@example.com`, name: "Load test", passwordHash: "!" },
  });
  const document = await prisma.document.create({
    data: { title: `Load test ${new Date(stamp).toISOString()}`, ownerId: user.id },
  });
  console.log(
    `Document ${document.id} · ${CLIENTS} editors × ${EDITS} edits, every ~${INTERVAL_MS} ms`,
  );

  const sent = new Map(); // label → sent-at (ms since epoch)
  const latencies = [];
  let peakConnections = 0;
  const healthUrl = args.url.replace(/^ws/, "http").replace(/\/$/, "") + "/health";
  const poll = setInterval(async () => {
    try {
      const health = await (await fetch(healthUrl)).json();
      peakConnections = Math.max(peakConnections, health.connections ?? 0);
    } catch {
      // health is best-effort
    }
  }, 250);

  let exitCode = 1;
  const providers = [];
  try {
    // A read-only observer measures how long each edit takes to reach someone else.
    const observer = await connect(document.id, user.id, "VIEWER");
    providers.push(observer.provider);
    const seenByObserver = new Set();
    observer.doc.on("update", () => {
      const now = Date.now();
      for (const label of labelsIn(observer.doc)) {
        if (seenByObserver.has(label)) continue;
        seenByObserver.add(label);
        const sentAt = sent.get(label);
        if (sentAt !== undefined) latencies.push(now - sentAt);
      }
    });

    const connectStarted = performance.now();
    const editors = await Promise.all(
      Array.from({ length: CLIENTS }, () => connect(document.id, user.id, "EDITOR")),
    );
    const connectAllMs = performance.now() - connectStarted;
    providers.push(...editors.map((e) => e.provider));
    console.log(`Connected ${CLIENTS} editors in ${Math.round(connectAllMs)} ms`);

    const editStarted = performance.now();
    await Promise.all(
      editors.map(async ({ doc }, client) => {
        const random = rng(stamp + client);
        await sleep(random() * INTERVAL_MS);
        for (let seq = 0; seq < EDITS; seq += 1) {
          const now = Date.now();
          const label = `[lt-${client}-${seq}-${now}]`;
          sent.set(label, now);
          edit(doc, random, label);
          await sleep(INTERVAL_MS * (0.5 + random()));
        }
      }),
    );
    const editingMs = performance.now() - editStarted;
    const expected = new Set(sent.keys());

    // Wait for every client (and the observer) to hold every edit.
    const everyone = [observer, ...editors];
    const convergeStarted = performance.now();
    let converged = false;
    while (performance.now() - convergeStarted < TIMEOUT_MS) {
      if (everyone.every(({ doc }) => labelsIn(doc).size === expected.size)) {
        converged = true;
        break;
      }
      await sleep(50);
    }
    const convergeMs = performance.now() - convergeStarted;
    const snapshots = new Set(everyone.map(({ doc }) => doc.getXmlFragment("default").toString()));

    // Everyone leaves; the server persists and unloads the document. A newcomer
    // then has to load it back from Postgres.
    for (const provider of providers.splice(0)) provider.destroy();
    await sleep(3_000);
    const newcomer = await connect(document.id, user.id, "VIEWER");
    providers.push(newcomer.provider);
    const reloaded = labelsIn(newcomer.doc);
    const lost = [...expected].filter((label) => !reloaded.has(label));

    latencies.sort((a, b) => a - b);
    const syncTimes = editors.map((e) => e.syncMs).sort((a, b) => a - b);
    const result = {
      clients: CLIENTS,
      editsPerClient: EDITS,
      totalEdits: expected.size,
      editsPerSecond: Math.round(expected.size / (editingMs / 1000)),
      peakServerConnections: peakConnections,
      connectAllMs: Math.round(connectAllMs),
      syncMs: {
        p50: Math.round(percentile(syncTimes, 50)),
        p95: Math.round(percentile(syncTimes, 95)),
      },
      editLatencyMs: {
        samples: latencies.length,
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        max: latencies.at(-1) ?? 0,
      },
      convergedAllClients: converged && snapshots.size === 1,
      convergeAfterLastEditMs: Math.round(convergeMs),
      lostEditsAfterReload: lost.length,
      documentBytes: Y.encodeStateAsUpdate(newcomer.doc).byteLength,
      // All simulated clients share this one process; if it is near 100% of a
      // core for the run, the measured latency is the harness's limit, not the server's.
      loadGeneratorCpuSeconds: Math.round(process.cpuUsage().user / 1e5) / 10,
      wallSeconds: Math.round((performance.now() - runStarted) / 100) / 10,
    };

    console.log("\nResult");
    console.table({
      "editors (+1 observer)": result.clients,
      "edits sent": result.totalEdits,
      "edits / second": result.editsPerSecond,
      "peak server connections": result.peakServerConnections,
      "connect + sync, p50 / p95 (ms)": `${result.syncMs.p50} / ${result.syncMs.p95}`,
      "edit → other user, p50 (ms)": result.editLatencyMs.p50,
      "edit → other user, p95 (ms)": result.editLatencyMs.p95,
      "edit → other user, p99 (ms)": result.editLatencyMs.p99,
      "all clients identical": result.convergedAllClients,
      "lost edits after reload from DB": result.lostEditsAfterReload,
    });
    if (args.json) writeFileSync(args.json, `${JSON.stringify(result, null, 2)}\n`);

    exitCode = result.convergedAllClients && result.lostEditsAfterReload === 0 ? 0 : 1;
    console.log(exitCode === 0 ? "\nPASS: converged, nothing lost" : "\nFAIL: see above");
  } finally {
    clearInterval(poll);
    for (const provider of providers) provider.destroy();
    if (!args.keep) await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
