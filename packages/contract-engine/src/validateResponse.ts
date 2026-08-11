import { isJsonMediaType, selectMediaType } from "./contentType.ts";
import { MAX_VALIDATED_BODY_BYTES } from "./limits.ts";
import { isAssertedFormat, validateAgainstSchema } from "./jsonSchemaValidate.ts";
import { coerceParameterValue } from "./validateRequest.ts";
import type {
  ContractModel,
  ContractOperation,
  ContractResponse,
  ContractViolation,
  JsonSchema,
} from "./types.ts";

/**
 * Response contract validation (spec §8, §9, §13–§19).
 *
 * The pipeline is: pick the documented response for this status → check the
 * content type → check declared response headers → schema-validate the body.
 * Each stage produces violations independently, so one failure does not mask
 * the others (spec §16).
 */

export interface ContractResponseInput {
  status: number | null;
  /** Header names may be any case; lookups here are case-insensitive. */
  headers: Record<string, string>;
  /** Raw response text, exactly as received. */
  rawBody: string;
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

/**
 * Selects the documented response for an actual status code.
 *
 * OpenAPI allows three forms and they have a defined precedence: an exact
 * code beats a range like `2XX`, which beats `default`. Spec §9 is explicit
 * that an undocumented status must not be waved through, so a miss here is
 * an error rather than a silent skip.
 */
export function selectResponse(operation: ContractOperation, status: number): ContractResponse | undefined {
  const exact = operation.responses.find((response) => response.statusKey === String(status));
  if (exact) return exact;

  const rangeKey = `${Math.floor(status / 100)}XX`;
  const range = operation.responses.find((response) => response.statusKey.toUpperCase() === rangeKey);
  if (range) return range;

  return operation.responses.find((response) => response.statusKey.toLowerCase() === "default");
}

function collectFormatWarnings(schema: JsonSchema | undefined, path: string): ContractViolation[] {
  if (schema === undefined || typeof schema === "boolean") return [];
  const format = schema.format;
  if (typeof format !== "string" || isAssertedFormat(format)) return [];
  return [
    {
      location: "response.header",
      path,
      keyword: "format",
      expected: `format: ${format}`,
      actual: "not checked",
      message: `Format "${format}" is not validated by API Lab's schema validator, so this value was accepted without a format check.`,
      severity: "warning",
    },
  ];
}

/** Response header validation (spec §19). */
function validateHeaders(
  contract: ContractModel,
  response: ContractResponse,
  actual: ContractResponseInput,
): { violations: ContractViolation[]; warnings: ContractViolation[] } {
  const violations: ContractViolation[] = [];
  const warnings: ContractViolation[] = [];

  for (const header of response.headers) {
    const value = findHeader(actual.headers, header.name);

    if (value === undefined) {
      if (header.required) {
        violations.push({
          location: "response.header",
          path: header.name,
          keyword: "required",
          expected: "present (required)",
          actual: "(absent)",
          message: `Missing required response header: ${header.name}`,
          severity: "error",
        });
      }
      continue;
    }

    if (header.schema === undefined) continue;

    const coerced = coerceParameterValue(value, header.schema);
    for (const violation of validateAgainstSchema(header.schema, contract.components, coerced, "response.header")) {
      violations.push({
        ...violation,
        path: violation.path === "$" ? header.name : `${header.name}${violation.path.slice(1)}`,
        message: `Response header "${header.name}": ${violation.message}`,
      });
    }
    warnings.push(...collectFormatWarnings(header.schema, header.name));
  }

  return { violations, warnings };
}

/**
 * Validates an HTTP response against one resolved operation.
 */
export function validateResponseAgainstOperation(
  contract: ContractModel,
  operation: ContractOperation,
  actual: ContractResponseInput,
): { violations: ContractViolation[]; warnings: ContractViolation[] } {
  const violations: ContractViolation[] = [];
  const warnings: ContractViolation[] = [];

  if (actual.status === null) {
    warnings.push({
      location: "response.status",
      path: "$",
      keyword: "status",
      expected: "an HTTP status code",
      actual: "(none)",
      message: "The request did not produce an HTTP response, so no contract validation was performed.",
      severity: "warning",
    });
    return { violations, warnings };
  }

  // ----- Status (spec §9) -------------------------------------------------
  const documented = selectResponse(operation, actual.status);
  if (!documented) {
    const documentedKeys = operation.responses.map((response) => response.statusKey).sort();
    violations.push({
      location: "response.status",
      path: "$",
      keyword: "status",
      expected: documentedKeys.length > 0 ? documentedKeys.join(", ") : "(no responses documented)",
      actual: String(actual.status),
      message: `Contract violation: Response status ${actual.status} is not documented for this operation.${
        documentedKeys.length > 0 ? ` Documented: ${documentedKeys.join(", ")}.` : ""
      }`,
      severity: "error",
    });
    // The body cannot be meaningfully schema-checked against a response
    // definition that does not exist, so validation stops here.
    return { violations, warnings };
  }

  // ----- Headers (spec §19) ----------------------------------------------
  const headerResult = validateHeaders(contract, documented, actual);
  violations.push(...headerResult.violations);
  warnings.push(...headerResult.warnings);

  // ----- Content type (spec §18) -----------------------------------------
  if (documented.content.length === 0) {
    // A response documented without content (a 204, typically) but carrying
    // a body is worth surfacing, without failing a conforming request.
    if (actual.rawBody.trim() !== "") {
      warnings.push({
        location: "response.body",
        path: "$",
        keyword: "content",
        expected: "no documented response content",
        actual: "body present",
        message: `The contract documents no response content for status ${actual.status}, so the body was not validated.`,
        severity: "warning",
      });
    }
    return { violations, warnings };
  }

  const actualContentType = findHeader(actual.headers, "content-type");
  if (actualContentType === undefined) {
    violations.push({
      location: "response.contentType",
      path: "$",
      keyword: "contentType",
      expected: documented.content.map((entry) => entry.contentType).join(", "),
      actual: "(absent)",
      message: "The response has no Content-Type header, so it cannot satisfy the documented response content.",
      severity: "error",
    });
    return { violations, warnings };
  }

  const media = selectMediaType(documented.content, actualContentType);
  if (!media) {
    const expected = documented.content.map((entry) => entry.contentType).join(", ");
    violations.push({
      location: "response.contentType",
      path: "$",
      keyword: "contentType",
      expected,
      actual: actualContentType,
      message: `Response Content-Type "${actualContentType}" is not documented for status ${actual.status}. Documented: ${expected}.`,
      severity: "error",
    });
    return { violations, warnings };
  }

  // ----- Body (spec §10, §13–§17) ----------------------------------------
  if (media.schema === undefined) return { violations, warnings };

  if (!isJsonMediaType(media.contentType)) {
    warnings.push({
      location: "response.body",
      path: "$",
      keyword: "content",
      expected: media.contentType,
      actual: media.contentType,
      message: `Response bodies of type "${media.contentType}" are not schema-validated by API Lab; only JSON media types are.`,
      severity: "warning",
    });
    return { violations, warnings };
  }

  if (actual.rawBody.length > MAX_VALIDATED_BODY_BYTES) {
    warnings.push({
      location: "response.body",
      path: "$",
      keyword: "size",
      expected: `at most ${MAX_VALIDATED_BODY_BYTES} bytes`,
      actual: `${actual.rawBody.length} bytes`,
      message: "The response body is too large to schema-validate interactively, so it was not checked.",
      severity: "warning",
    });
    return { violations, warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(actual.rawBody);
  } catch {
    violations.push({
      location: "response.body",
      path: "$",
      keyword: "syntax",
      expected: "valid JSON",
      actual: "unparseable",
      message: `The response declares Content-Type "${actualContentType}" but its body is not valid JSON.`,
      severity: "error",
    });
    return { violations, warnings };
  }

  violations.push(...validateAgainstSchema(media.schema, contract.components, parsed, "response.body"));
  return { violations, warnings };
}
