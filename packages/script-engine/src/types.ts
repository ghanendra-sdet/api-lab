export interface ScriptLog {
  type: "log" | "warn" | "error";
  message: string;
  timestamp: number;
}

export interface ScriptResult {
  status: "success" | "error" | "timeout";
  duration: number;
  logs: ScriptLog[];
  error?: string;
  variables?: Record<string, string>;
}

export interface ScriptContext {
  variables: Record<string, string>;
  request?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  };
  response?: {
    status: number | null;
    statusText: string;
    headers: Record<string, string>;
    body?: any;
    rawBody: string;
    duration: number;
    size: number;
  };
}
