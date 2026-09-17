import { Scenarios } from "./benchmark.js";
import { z } from "zod";
import { Capability } from "./schema.js";
const response = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: { type: "object", additionalProperties: true },
    },
  },
});
const key = {
  type: "object",
  additionalProperties: false,
  required: ["id", "version"],
  properties: {
    id: { type: "string", pattern: "^[a-z][a-z0-9-]{1,79}$" },
    version: { type: "string", pattern: "^\\d{1,6}\\.\\d{1,6}\\.\\d{1,6}$" },
  },
};
const post = (description: string, schema: unknown, async = false) => ({
  description,
  requestBody: { required: true, content: { "application/json": { schema } } },
  responses: {
    [async ? "202" : "200"]: response(
      async ? "Job accepted; poll /api/jobs/{id}" : "Operation completed",
    ),
    "400": response("Invalid request"),
    "401": response("Bearer token required"),
    "403": response("Reviewer role or same origin required"),
    "409": response("State conflict or execution busy"),
    "413": response("Body too large"),
    "415": response("JSON required"),
    "429": response("Rate limited"),
  },
});
export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Local capability verification API",
    version: "1.0.0",
    description:
      "Loopback synthetic sandbox only. Two ephemeral bearer roles: reviewer and runner. Invocation uses only the active approved release. Run files redact outputs; completed replay jobs return typed outputs in memory.",
  },
  security: [{ bearer: [] }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  },
  paths: {
    "/api/session": { get: { responses: { "200": response("Current role") } } },
    "/api/capabilities": {
      get: {
        responses: {
          "200": {
            description: "Active approved capabilities",
            content: {
              "application/json": {
                schema: { type: "array", items: { type: "object" } },
              },
            },
          },
        },
      },
    },
    "/api/releases": {
      get: {
        description:
          "Reviewer only. Immutable releases, active pointers and audit history.",
        responses: { "200": response("Registry snapshot") },
      },
    },
    "/api/releases/import": {
      post: {
        ...post(
          "Reviewer only. Import a version 1 capability; versions cannot be overwritten.",
          z.toJSONSchema(Capability),
        ),
        responses: {
          "201": response("Candidate created"),
          "400": response("Invalid capability"),
          "409": response("Existing version or invalid policy"),
          "401": response("Bearer token required"),
          "403": response("Reviewer role required"),
        },
      },
    },
    "/api/releases/validate": {
      post: post(
        "Reviewer only. Server runs 38 browser scenarios; no client reports accepted.",
        key,
        true,
      ),
    },
    "/api/releases/approve": {
      post: post(
        "Reviewer only. Requires successful digest-bound validation.",
        key,
      ),
    },
    "/api/releases/activate": {
      post: post("Reviewer only. Select an approved release.", key),
    },
    "/api/releases/rollback": {
      post: post(
        "Reviewer only. Restore a previously activated approved release.",
        key,
      ),
    },
    "/api/invoke": {
      post: post(
        "Runner or reviewer. No URL, policy or filesystem options accepted.",
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "memberId"],
          properties: {
            id: key.properties.id,
            memberId: { type: "string", pattern: "^[0-9]{5}$" },
            variant: {
              type: "string",
              enum: ["classic", "cards"],
              default: "classic",
            },
            scenario: {
              type: "string",
              enum: Scenarios.options.filter((s) => s !== "invalid"),
              default: "normal",
            },
          },
        },
        true,
      ),
    },
    "/api/jobs": {
      get: {
        responses: {
          "200": {
            description: "Last 50 jobs in this server process",
            content: {
              "application/json": {
                schema: { type: "array", items: { type: "object" } },
              },
            },
          },
        },
      },
    },
    "/api/jobs/{id}": {
      get: {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": response("Job and completed result"),
          "404": response("Unknown job"),
        },
      },
    },
    "/api/runs/{id}": {
      get: {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": response("Redacted events, metrics and outcome"),
          "404": response("Unknown run"),
        },
      },
    },
  },
};
