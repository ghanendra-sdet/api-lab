import type { HttpMethod } from "@api-lab/shared";
import { isJsonMediaType, selectMediaType } from "./contentType.ts";
import { MAX_VALIDATED_BODY_BYTES } from "./limits.ts";
import { isAssertedFormat, validateAgainstSchema } from "./jsonSchemaValidate.ts";
import { extractPathParameters } from "./operationMatch.ts";
import type {
  ContractModel,
  ContractOperation,
  ContractParameter,
  ContractViolation,
  JsonSchema,
  ViolationLocation,
} from "./types.ts";

/**
 * Request contract validation (spec §7, §12, §20).
 *
 * Runs *before* the request is sent, so a request that the contract already
 * forbids never reaches the network. The canonical example from spec §7 —
 * `GET /users/abc` against a contract declaring `id` as a required integer —
 * is caught here, with the parameter named and both the expected and actual
 * types reported.
 */

export interface ContractNameValue {
  name: string;
  value: string;
}

/**
 * A request reduced to what the contract cares about. Built by the caller
 * from an already-resolved request (variables substituted, auth applied) —
 * spec §31 is explicit that `{{userId}}` must be resolved *before* contract
 * validation, because validating the literal string "{{userId}}" against an
 * integer schema would be a guaranteed false failure.
 */
export interface ContractRequestInput {
  method: HttpMethod;
  /** Concrete path with the server base already stripped, e.g. `/users/123`. */
  path: string;
  query: ContractNameValue[];
  headers: ContractNameValue[];
  cookies: ContractNameValue[];
  body: string | undefined;
  contentType: string | undefined;
}

const LOCATION_MAP: Record<ContractParameter["location"], ViolationLocation> = {
  path: "request.path",
  query: "request.query",
  header: "request.header",
  cookie: "request.cookie",
};

const LOCATION_LABEL: Record<ContractParameter["location"], string> = {
  path: "Path parameter",
  query: "Query parameter",
  header: "Header parameter",
  cookie: "Cookie parameter",
};

function schemaTypes(schema: JsonSchema | undefined): string[] {
  if (schema === undefined || typeof schema === "boolean") return [];
  const type = schema.type;
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((entry): entry is string => typeof entry === "string");
  return [];
}

/**
 * Parameters always arrive as strings — that is what a URL and a header are.
 * The contract, however, describes them with JSON types. Coercion converts
 * the string into the type the contract declares *when it plausibly is one*,
 * and deliberately leaves it as a string when it is not, so that the schema
 * validator reports the real mismatch.
 *
 * That distinction is the whole point of spec §7's example: `"123"` must
 * become `123` and pass, while `"abc"` must stay `"abc"` and be reported as
 * `Expected: integer, Actual: string`.
 */
export function coerceParameterValue(raw: string | string[], schema: JsonSchema | undefined): unknown {
  const types = schemaTypes(schema);

  if (Array.isArray(raw)) {
    if (typeof schema === "object" && schema !== null && "items" in schema) {
      return raw.map((entry) => coerceParameterValue(entry, schema.items as JsonSchema));
    }
    return raw;
  }

  if (types.includes("array")) {
    // style: form / simple with explode=false serializes an array as a
    // comma-separated list. Handled here because it is by far the common case.
    const parts = raw === "" ? [] : raw.split(",");
    const items = typeof schema === "object" && schema !== null ? (schema.items as JsonSchema | undefined) : undefined;
    return parts.map((part) => coerceParameterValue(part, items));
  }

  if (types.includes("integer")) {
    if (/^[+-]?\d+$/.test(raw.trim()) && raw.trim() !== "") return Number(raw);
  }
  if (types.includes("number")) {
    const numeric = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(numeric)) return numeric;
  }
  if (types.includes("boolean")) {
    if (raw === "true") return true;
    if (raw === "false") return false;
  }
  if (types.includes("null") && raw === "") return null;

  return raw;
}

/** Collects a parameter's raw value(s) from the request, honouring
 * case-insensitivity where the transport requires it. */
function collectValues(parameter: ContractParameter, request: ContractRequestInput, pathParams: Record<string, string>): string[] {
  switch (parameter.location) {
    case "path": {
      const value = pathParams[parameter.name];
      return value === undefined ? [] : [value];
    }
    case "query":
      return request.query.filter((entry) => entry.name === parameter.name).map((entry) => entry.value);
    case "header":
      // HTTP header names are case-insensitive (RFC 9110).
      return request.headers
        .filter((entry) => entry.name.toLowerCase() === parameter.name.toLowerCase())
        .map((entry) => entry.value);
    case "cookie":
      return request.cookies.filter((entry) => entry.name === parameter.name).map((entry) => entry.value);
  }
}

function collectFormatWarnings(
  schema: JsonSchema | undefined,
  location: ViolationLocation,
  path: string,
): ContractViolation[] {
  if (schema === undefined || typeof schema === "boolean") return [];
  const format = schema.format;
  if (typeof format !== "string" || isAssertedFormat(format)) return [];
  return [
    {
      location,
      path,
      keyword: "format",
      expected: `format: ${format}`,
      actual: "not checked",
      message: `Format "${format}" is not validated by API Lab's schema validator, so this value was accepted without a format check.`,
      severity: "warning",
    },
  ];
}

function validateParameter(
  parameter: ContractParameter,
  request: ContractRequestInput,
  pathParams: Record<string, string>,
  components: Record<string, unknown> | undefined,
): { violations: ContractViolation[]; warnings: ContractViolation[] } {
  const violations: ContractViolation[] = [];
  const warnings: ContractViolation[] = [];
  const location = LOCATION_MAP[parameter.location];
  const label = LOCATION_LABEL[parameter.location];
  const values = collectValues(parameter, request, pathParams);

  if (parameter.unsupportedStyle !== undefined) {
    warnings.push({
      location,
      path: parameter.name,
      keyword: "style",
      expected: `style: ${parameter.unsupportedStyle}`,
      actual: "not checked",
      message: `${label} "${parameter.name}" uses serialization style "${parameter.unsupportedStyle}", which API Lab does not implement; its value was not validated.`,
      severity: "warning",
    });
    return { violations, warnings };
  }

  if (values.length === 0) {
    if (parameter.required) {
      violations.push({
        location,
        path: parameter.name,
        keyword: "required",
        expected: "present (required)",
        actual: "(absent)",
        message: `Missing required ${label.toLowerCase()}: ${parameter.name}`,
        severity: "error",
      });
    }
    return { violations, warnings };
  }

  if (parameter.schema === undefined) return { violations, warnings };

  const explodedArray = values.length > 1;
  const coerced = coerceParameterValue(explodedArray ? values : values[0]!, parameter.schema);

  const schemaViolations = validateAgainstSchema(parameter.schema, components, coerced, location);
  for (const violation of schemaViolations) {
    // Report against the parameter's name rather than `$`, so the message
    // reads "Path parameter "id"" exactly as spec §7 requires.
    violations.push({
      ...violation,
      path: violation.path === "$" ? parameter.name : `${parameter.name}${violation.path.slice(1)}`,
      message: `${label} "${parameter.name}": ${violation.message}`,
    });
  }

  warnings.push(...collectFormatWarnings(parameter.schema, location, parameter.name));

  return { violations, warnings };
}

/**
 * Validates a request against one resolved operation.
 *
 * Returns violations and warnings separately; the caller decides whether a
 * request-side violation should block sending.
 */
export function validateRequestAgainstOperation(
  contract: ContractModel,
  operation: ContractOperation,
  request: ContractRequestInput,
): { violations: ContractViolation[]; warnings: ContractViolation[] } {
  const violations: ContractViolation[] = [];
  const warnings: ContractViolation[] = [];
  const pathParams = extractPathParameters(operation.path, request.path);

  for (const parameter of operation.parameters) {
    const result = validateParameter(parameter, request, pathParams, contract.components);
    violations.push(...result.violations);
    warnings.push(...result.warnings);
  }

  const bodyResult = validateRequestBody(contract, operation, request);
  violations.push(...bodyResult.violations);
  warnings.push(...bodyResult.warnings);

  return { violations, warnings };
}

/** Request body validation (spec §12). */
function validateRequestBody(
  contract: ContractModel,
  operation: ContractOperation,
  request: ContractRequestInput,
): { violations: ContractViolation[]; warnings: ContractViolation[] } {
  const violations: ContractViolation[] = [];
  const warnings: ContractViolation[] = [];
  const requestBody = operation.requestBody;
  const hasBody = request.body !== undefined && request.body !== "";

  if (!requestBody) {
    // An undocumented body is not automatically a violation — many APIs
    // document only what they read. Reported as a warning so it is visible
    // without failing an otherwise conforming request.
    if (hasBody) {
      warnings.push({
        location: "request.body",
        path: "$",
        keyword: "requestBody",
        expected: "no documented request body",
        actual: "body present",
        message: "The contract documents no request body for this operation, so the body was not validated.",
        severity: "warning",
      });
    }
    return { violations, warnings };
  }

  if (!hasBody) {
    if (requestBody.required) {
      violations.push({
        location: "request.body",
        path: "$",
        keyword: "required",
        expected: "a request body",
        actual: "(absent)",
        message: "The contract requires a request body for this operation, but none was provided.",
        severity: "error",
      });
    }
    return { violations, warnings };
  }

  const contentType = request.contentType ?? "application/json";
  const media = selectMediaType(requestBody.content, contentType);

  if (!media) {
    const documented = requestBody.content.map((entry) => entry.contentType).join(", ") || "(none)";
    violations.push({
      location: "request.contentType",
      path: "$",
      keyword: "content",
      expected: documented,
      actual: contentType,
      message: `Request Content-Type "${contentType}" is not documented for this operation. Documented: ${documented}.`,
      severity: "error",
    });
    return { violations, warnings };
  }

  if (media.schema === undefined) return { violations, warnings };

  if (!isJsonMediaType(media.contentType)) {
    warnings.push({
      location: "request.body",
      path: "$",
      keyword: "content",
      expected: media.contentType,
      actual: media.contentType,
      message: `Request bodies of type "${media.contentType}" are not schema-validated by API Lab; only JSON media types are.`,
      severity: "warning",
    });
    return { violations, warnings };
  }

  if (request.body!.length > MAX_VALIDATED_BODY_BYTES) {
    warnings.push({
      location: "request.body",
      path: "$",
      keyword: "size",
      expected: `at most ${MAX_VALIDATED_BODY_BYTES} bytes`,
      actual: `${request.body!.length} bytes`,
      message: "The request body is too large to schema-validate interactively, so it was not checked.",
      severity: "warning",
    });
    return { violations, warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(request.body!);
  } catch {
    violations.push({
      location: "request.body",
      path: "$",
      keyword: "syntax",
      expected: "valid JSON",
      actual: "unparseable",
      message: `The request body is declared as "${media.contentType}" but is not valid JSON.`,
      severity: "error",
    });
    return { violations, warnings };
  }

  violations.push(...validateAgainstSchema(media.schema, contract.components, parsed, "request.body"));
  return { violations, warnings };
}
