/** A real HTTP server on an ephemeral port, so tests exercise the app over the wire. */

import { once } from "node:events";
import type { Server } from "node:http";

import type { Express } from "express";

export interface TestServer {
  readonly url: string;
  close(): Promise<void>;
}

export async function startServer(app: Express): Promise<TestServer> {
  const server: Server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the test server did not bind a port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
