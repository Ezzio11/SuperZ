import express, { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "../../config/load.js";
import { CompressionEngine } from "../../engine/compress.js";
import { getMetrics } from "../../util/metrics.js";
import { tagged } from "../../util/logger.js";
import { createServer, registerTools } from "../tools.js";

const log = tagged("mcp-http");

export interface HttpServerOptions {
  host?: string;
  port?: number;
  cors?: boolean;
  apiToken?: string;
}

export async function runHttp(opts: HttpServerOptions = {}): Promise<void> {
  const config = loadConfig();
  const engine = new CompressionEngine(config);

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  if (opts.cors ?? config.http.cors) {
    app.use((_req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      if (_req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  const requiredToken = opts.apiToken ?? config.http.apiToken;
  const auth = (req: Request, res: Response, next: NextFunction): void => {
    if (!requiredToken) {
      next();
      return;
    }
    const header = req.header("authorization");
    if (!header || !header.startsWith("Bearer ") || header.slice(7) !== requiredToken) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ status: "ok", version: "2.0.0" });
  });

  app.get("/v1/stats", auth, (_req: Request, res: Response) => {
    res.json(getMetrics().snapshotRead());
  });

  app.post("/v1/compress", auth, async (req: Request, res: Response) => {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : null;
    const force = Boolean(req.body?.force);
    if (!prompt) {
      res.status(400).json({ error: "prompt (string) is required" });
      return;
    }
    try {
      const result = await engine.compress(prompt, { force });
      res.json(result);
    } catch (err) {
      log.error("Compression failed", err);
      // Avoid reflecting internal error details back to clients.
      res.status(500).json({ error: "compression failed" });
    }
  });

  // MCP streamable HTTP transport. Sessions keyed by Mcp-Session-Id.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.all("/mcp", auth, async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id");
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, created);
          log.debug("MCP session opened", id);
        },
      });
      created.onclose = () => {
        const sid = created.sessionId;
        if (sid) {
          transports.delete(sid);
          log.debug("MCP session closed", sid);
        }
      };
      const server = createServer();
      registerTools(server, engine);
      await server.connect(created);
      transport = created;
    }

    await transport.handleRequest(req, res, req.body);
  });

  const host = opts.host ?? config.http.host;
  const port = opts.port ?? config.http.port;
  await new Promise<void>((resolveServer) => {
    app.listen(port, host, () => {
      log.info(`HTTP server listening on http://${host}:${port}`);
      log.info(`  REST:    POST http://${host}:${port}/v1/compress`);
      log.info(`  MCP:     http://${host}:${port}/mcp`);
      log.info(`  Health:  http://${host}:${port}/healthz`);
      resolveServer();
    });
  });
}
