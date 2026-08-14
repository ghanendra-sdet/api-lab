import { BrowserFetchExecutor, type BuiltRequest } from "@api-lab/request-engine";
import type { SecurityExecutor, SecurityRequestInput } from "@api-lab/security-engine";
import { toSecurityResponse } from "./securityAdapt";

/**
 * The transport adapter for security runs.
 *
 * A second `BrowserFetchExecutor` instance rather than a shared one: the
 * executor is stateless, so this creates no second source of truth. What
 * matters for correctness is that the *resolution* pipeline is shared — and it
 * is, through `prepareRequest` (see securityAdapt.ts). The transport is the
 * one layer where a separate instance costs nothing.
 *
 * Note the deliberate absence of anything clever here: no retries, no
 * concurrency, no connection reuse tricks. The engine drives this strictly
 * sequentially with a pause between requests (spec §36), and an adapter that
 * quietly parallelised would undo that architectural boundary from below.
 */
const executor = new BrowserFetchExecutor();

function toBuiltRequest(request: SecurityRequestInput): BuiltRequest {
  const headers: Record<string, string> = {};
  for (const header of request.headers) headers[header.name] = header.value;

  return {
    url: request.url,
    method: request.method,
    headers,
    body: request.body,
  };
}

export const browserSecurityExecutor: SecurityExecutor = {
  async send(request, signal) {
    const response = await executor.execute(toBuiltRequest(request), { signal });
    return toSecurityResponse(response);
  },
};
