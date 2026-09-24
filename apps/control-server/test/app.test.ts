import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

describe("control server", () => {
  it("returns the contract health response", async () => {
    const app = await buildApp({ version: "1.2.3-test" });
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.json()).toStrictEqual({
      status: "ok",
      version: "1.2.3-test",
    });
  });

  it("reports the package service version by default", async () => {
    const app = await buildApp();
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.json()).toStrictEqual({
      status: "ok",
      version: "0.1.0",
    });
  });

  it("does not expose undeclared routes", async () => {
    const app = await buildApp();
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/not-implemented",
    });

    expect(response.statusCode).toBe(404);
  });

  it("accepts an emergency stop with no connected agents", async () => {
    const app = await buildApp();
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/system/emergency-stop",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toStrictEqual({
      accepted: true,
      notifiedAgents: 0,
    });
  });
});
