/**
 * A worker that dies immediately, used by the integration suite to prove
 * the control plane survives a load-generator crash and reports it as a
 * recoverable error rather than hanging the client (spec §28).
 */
throw new Error("simulated load generator crash");
