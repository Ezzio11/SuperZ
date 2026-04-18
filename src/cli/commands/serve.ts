import { runHttp } from "../../mcp/transports/http.js";
import { runStdio } from "../../mcp/transports/stdio.js";

export interface ServeOptions {
  http?: boolean;
  host?: string;
  port?: number;
  cors?: boolean;
  token?: string;
}

export async function runServe(opts: ServeOptions): Promise<void> {
  if (opts.http) {
    await runHttp({
      host: opts.host,
      port: opts.port,
      cors: opts.cors,
      apiToken: opts.token ?? process.env.SUPERZ_HTTP_TOKEN,
    });
    return;
  }
  await runStdio();
}
