import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = new URL("../../", import.meta.url);
const timeoutMs = 20_000;
const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const processes = new Set();
const durationArgument = process.argv.find((argument) => argument.startsWith("--duration-ms="));
const stabilityDurationMs =
  durationArgument === undefined ? 0 : Number(durationArgument.split("=", 2)[1]);
if (!Number.isSafeInteger(stabilityDurationMs) || stabilityDurationMs < 0) {
  throw new Error("--duration-ms must be a non-negative integer");
}

function startProcess(command, args, environment) {
  const output = [];
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  processes.add(child);
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      output.push(chunk.toString());
      if (output.length > 100) {
        output.shift();
      }
    });
  }
  child.once("exit", () => processes.delete(child));
  return { child, output };
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to reserve a TCP port");
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitFor(description, operation) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value !== undefined) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

async function waitForAgent(baseUrl, afterTimestamp, expectedStatus = "ONLINE") {
  return waitFor("Agent registration", async () => {
    const response = await fetch(`${baseUrl}/api/v1/agents`);
    if (!response.ok) {
      return undefined;
    }
    const agents = await response.json();
    const agent = agents.find(
      (candidate) => candidate.id === agentId && candidate.status === expectedStatus,
    );
    if (
      agent === undefined ||
      (afterTimestamp !== undefined && agent.lastSeenAt <= afterTimestamp)
    ) {
      return undefined;
    }
    return agent;
  });
}

const directory = await mkdtemp(join(tmpdir(), "hos-m1-integration-"));
const databasePath = join(directory, "automation.db");
const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const serverEnvironment = {
  AGENT_HEARTBEAT_INTERVAL_MS: "1000",
  DATABASE_PATH: databasePath,
  SERVER_HOST: "127.0.0.1",
  SERVER_PORT: String(port),
};
const agentEnvironment = {
  AGENT_ID: agentId,
  AGENT_NAME: "integration-placeholder-agent",
  CONTROL_SERVER_WS_URL: `ws://127.0.0.1:${port}/ws/agent`,
};

let server;
let agent;
try {
  server = startProcess("node", ["apps/control-server/dist/server.js"], serverEnvironment);
  await waitFor("Control Server startup", async () => {
    const response = await fetch(`${baseUrl}/health`);
    return response.ok ? true : undefined;
  });

  agent = startProcess(
    "dotnet",
    ["run", "--project", "apps/desktop-agent/src/DesktopAgent/DesktopAgent.csproj", "--no-build"],
    agentEnvironment,
  );
  const firstRegistration = await waitForAgent(baseUrl);

  await stopProcess(server.child);
  server = startProcess("node", ["apps/control-server/dist/server.js"], serverEnvironment);
  await waitFor("restarted Control Server", async () => {
    const response = await fetch(`${baseUrl}/health`);
    return response.ok ? true : undefined;
  });
  const secondRegistration = await waitForAgent(baseUrl, firstRegistration.lastSeenAt);

  const emergencyResponse = await fetch(`${baseUrl}/api/v1/system/emergency-stop`, {
    method: "POST",
  });
  if (!emergencyResponse.ok) {
    throw new Error(`Emergency stop failed with HTTP ${String(emergencyResponse.status)}`);
  }
  const emergencyResult = await emergencyResponse.json();
  if (emergencyResult.notifiedAgents !== 1) {
    throw new Error("Emergency stop did not notify the connected Agent");
  }
  const pausedAgent = await waitForAgent(baseUrl, secondRegistration.lastSeenAt, "PAUSED");

  let lastSeenAt = pausedAgent.lastSeenAt;
  const stabilityDeadline = Date.now() + stabilityDurationMs;
  while (Date.now() < stabilityDeadline) {
    const heartbeat = await waitForAgent(baseUrl, lastSeenAt, "PAUSED");
    lastSeenAt = heartbeat.lastSeenAt;
  }

  console.log(
    JSON.stringify({
      agentId,
      firstSeenAt: firstRegistration.lastSeenAt,
      reconnectedAt: secondRegistration.lastSeenAt,
      pausedAt: pausedAgent.lastSeenAt,
      stabilityDurationMs,
      result: "passed",
    }),
  );
} catch (error) {
  const diagnostics = [server, agent]
    .filter((processInfo) => processInfo !== undefined)
    .flatMap((processInfo) => processInfo.output)
    .slice(-30)
    .join("");
  throw new Error(
    `${error instanceof Error ? error.message : "Integration test failed"}\n${diagnostics}`,
    { cause: error },
  );
} finally {
  await Promise.all(
    [...processes].map(async (child) => {
      await stopProcess(child);
    }),
  );
  await rm(directory, { force: true, recursive: true });
}
