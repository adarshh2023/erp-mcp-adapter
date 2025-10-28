// mcp-server.js
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Ajv from "ajv";
import addFormats from "ajv-formats";

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------- basic logger (redacts auth) ----------
app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    // Avoid printing large payloads or secrets
    const clone = JSON.parse(JSON.stringify(req.body));
    if (clone?.params?.headers?.Authorization) {
      clone.params.headers.Authorization = "REDACTED";
    }
    console.log("Body:", JSON.stringify(clone, null, 2));
  }
  next();
});

// ---------- CORS (adjust origin in prod) ----------
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // tighten in production
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------- config ----------
const PORT = process.env.PORT || 4000;
const ERP_BASE = (process.env.ERP_BASE || "").replace(/\/$/, "");
const ERP_API_KEY = process.env.ERP_API_KEY;
if (!ERP_BASE) {
  console.error("Missing ERP_BASE");
  process.exit(1);
}
if (!ERP_API_KEY) {
  console.error("Missing ERP_API_KEY");
  process.exit(1);
}

// ---------- helpers: fetch with timeout + retry ----------
const DEFAULT_TIMEOUT_MS = 15000;
const RETRY_STATUS = new Set([429, 502, 503, 504]);

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function erp(
  path,
  {
    method = "GET",
    body,
    query = {},
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = 2,
  } = {}
) {
  const url = new URL(`${ERP_BASE}${path}`);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v))
      v.forEach((vv) => url.searchParams.append(k, `${vv}`));
    else url.searchParams.set(k, `${v}`);
  });

  let attempt = 0;
  let lastErr;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${ERP_API_KEY}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        // Rate limit/backoff
        if (RETRY_STATUS.has(res.status) && attempt < maxRetries) {
          const retryAfter =
            Number(res.headers.get("retry-after")) ||
            (500 * Math.pow(2, attempt)) / 1; // ms
          await sleep(retryAfter);
          attempt++;
          continue;
        }
        const err = new Error(
          `ERP ${method} ${url.pathname} failed: ${res.status}`
        );
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data ?? {};
    } catch (e) {
      clearTimeout(timeout);
      lastErr =
        e.name === "AbortError"
          ? new Error(`ERP request timed out after ${timeoutMs}ms`)
          : e;
      if (attempt < maxRetries) {
        const backoff = 300 * Math.pow(2, attempt);
        await sleep(backoff);
        attempt++;
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr || new Error("Unknown ERP error");
}

// ---------- utility: parse breadcrumb from treePath JSON ----------
function parseBreadcrumb(treePath) {
  try {
    const arr = JSON.parse(treePath || "[]");
    const names = Array.isArray(arr)
      ? arr.map((n) => n.nodeName).filter(Boolean)
      : [];
    return { array: names, text: names.join(" › ") };
  } catch {
    return { array: [], text: "" };
  }
}

// ---------- Ajv validation setup ----------
const ajv = new Ajv({
  allErrors: true,
  removeAdditional: "failing",
  coerceTypes: true,
});
addFormats(ajv);

function compile(schema) {
  const v = ajv.compile(schema);
  return (data) => {
    const ok = v(data);
    if (!ok) {
      const err = new Error("Validation failed");
      err.validation = v.errors;
      throw err;
    }
    return data;
  };
}

// ---------- tool schemas ----------
const STATUS_ENUM = [
  "Not Started",
  "In Progress",
  "Blocked",
  "Completed",
  "On Hold",
];

const schemaSearchProjectNodes = {
  type: "object",
  properties: {
    keywords: {
      anyOf: [
        { type: "string", minLength: 1 },
        { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
      ],
    },
    page: { type: "integer", minimum: 0, default: 0 },
    size: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    sort: { type: "string", default: "insertDate,ASC" },
    includePaths: { type: "boolean", default: true },
    includeStakeholders: { type: "boolean", default: true },
  },
  required: ["keywords"],
  additionalProperties: false,
};

const schemaUpdateNodeStatus = {
  type: "object",
  properties: {
    nodeId: { type: "string", minLength: 1 },
    status: { type: "string", enum: STATUS_ENUM },
  },
  required: ["nodeId", "status"],
  additionalProperties: false,
};

const schemaUpdateNode = {
  type: "object",
  properties: {
    nodeId: { type: "string", minLength: 1 },
    status: { type: "string", enum: STATUS_ENUM },
    nodeDescription: { type: "string" },
    parentNodeId: { type: "string" },
  },
  required: ["nodeId"],
  additionalProperties: false,
};

const validateSearchProjectNodes = compile(schemaSearchProjectNodes);
const validateUpdateNodeStatus = compile(schemaUpdateNodeStatus);
const validateUpdateNode = compile(schemaUpdateNode);

// ---------- tool catalog ----------
function toolCatalog() {
  return [
    // ---- NEW TOOLS FOR YOUR NEW AGENT ----
    {
      name: "searchProjectNodes",
      description:
        "GET /api/v1/projects/nodes/search/searchNodesArray → find project nodes by keywords; returns normalized items with breadcrumb.",
      inputSchema: schemaSearchProjectNodes,
    },
    {
      name: "updateNodeStatus",
      description:
        "PUT /api/v1/projects/nodes/{nodeId}/status → update only the status.",
      inputSchema: schemaUpdateNodeStatus,
    },
    {
      name: "updateNode",
      description:
        "PUT /api/v1/projects/nodes/{nodeId} → update status and/or nodeDescription (and parentNodeId only if explicitly requested).",
      inputSchema: schemaUpdateNode,
    },

    // ---- (OPTIONAL) keep your existing indent tools so the server can serve multiple agents ----
    {
      name: "generateIndentNumber",
      description:
        "GET /api/v1/indents/generate-number → returns indent number in data",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "fetchProjects",
      description: "GET /api/v1/projects → projects in data.content",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "listLocations",
      description: "GET /api/v1/locations → locations in data.content",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "listItems",
      description: "GET /api/v1/items → items in data.content",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "listUnits",
      description: "GET /api/v1/units → units in data.content",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "createIndent",
      description:
        "POST /api/v1/indents → creates an indent with the ERP JSON body",
      inputSchema: {
        type: "object",
        properties: {
          indentNumber: { type: "string" },
          indentTitle: { type: "string" },
          indentDescription: { type: "string" },
          indentType: { type: "string" },
          priority: { type: "string" },
          projectNodeId: { type: "string" },
          locationId: { type: "string" },
          requestedById: { type: "string" },
          requestorDepartment: { type: "string" },
          requestedDate: { type: "string" },
          requiredByDate: { type: "string" },
          purposeOfIndent: { type: "string" },
          workDescription: { type: "string" },
          justification: { type: "string" },
          estimatedBudget: { type: "number" },
          budgetCode: { type: "string" },
          requiresApproval: { type: "boolean" },
          isUrgent: { type: "boolean" },
          deliveryInstructions: { type: "string" },
          qualityRequirements: { type: "string" },
          indentNotes: { type: "string" },
          indentItems: {
            type: "array",
            items: {
              type: "object",
              properties: {
                itemMasterId: { type: "string" },
                requiredQuantity: { type: "number" },
                unit: { type: "string" },
                estimatedRate: { type: "number" },
                estimatedAmount: { type: "number" },
                requiredByDate: { type: "string" },
                isTestingRequired: { type: "boolean" },
                purposeOfItem: { type: "string" },
                itemNotes: { type: "string" },
              },
              required: [
                "itemMasterId",
                "requiredQuantity",
                "unit",
                "requiredByDate",
              ],
            },
          },
          deviceId: { type: "string" },
          ipAddress: { type: "string" },
        },
        required: [
          "indentNumber",
          "projectNodeId",
          "locationId",
          "requestedById",
          "requestedDate",
          "requiredByDate",
          "indentItems",
        ],
        additionalProperties: true,
      },
    },
  ];
}

// ---------- core tool execution ----------
async function handleToolCall(name, args) {
  // Validation per tool
  switch (name) {
    case "searchProjectNodes": {
      const a = validateSearchProjectNodes(args);
      const keywords =
        typeof a.keywords === "string" ? a.keywords : a.keywords.join(" ");
      const query = {
        keywords,
        page: a.page ?? 0,
        size: a.size ?? 50,
        sort: a.sort ?? "insertDate,ASC",
        includePaths: a.includePaths ?? true,
        includeStakeholders: a.includeStakeholders ?? true,
      };
      const raw = await erp(
        "/api/v1/projects/nodes/search/searchNodesArray?keywords=lc4&page=0&size=50&sort=insertDate,ASC&includePaths=true&includeStakeholders=true",
        {
          method: "GET",
        }
      );
      const content = raw?.data?.content ?? [];
      const items = content.map((n) => {
        const bc = parseBreadcrumb(n.treePath);
        return {
          nodeId: n.recCode,
          nodeName: n.nodeName,
          status: n.status || null,
          parentNodeId: n.parentNodeId || null,
          breadcrumb: bc.array,
          breadcrumbText: bc.text,
          raw: n, // keep raw for the agent if needed
        };
      });
      const pageInfo = {
        page: raw?.data?.pageable?.pageNumber ?? 0,
        size: raw?.data?.pageable?.pageSize ?? items.length,
        total: raw?.data?.totalElements ?? items.length,
        totalPages: raw?.data?.totalPages ?? 1,
      };
      return { items, pageInfo };
    }

    case "updateNodeStatus": {
      const a = validateUpdateNodeStatus(args);
      const body = { status: a.status };
      const raw = await erp(
        `/api/v1/projects/nodes/${encodeURIComponent(a.nodeId)}/status`,
        {
          method: "PUT",
          body,
        }
      );
      return {
        ok: true,
        nodeId: a.nodeId,
        status: a.status,
        raw,
      };
    }

    case "updateNode": {
      const a = validateUpdateNode(args);
      const body = {};
      if (a.status !== undefined) body.status = a.status;
      if (a.nodeDescription !== undefined)
        body.nodeDescription = a.nodeDescription;
      if (a.parentNodeId !== undefined) body.parentNodeId = a.parentNodeId; // only if explicitly provided
      if (Object.keys(body).length === 0) {
        const err = new Error(
          "Nothing to update: provide at least one of status, nodeDescription, parentNodeId"
        );
        err.code = "NO_FIELDS";
        throw err;
      }
      const raw = await erp(
        `/api/v1/projects/nodes/${encodeURIComponent(a.nodeId)}`,
        {
          method: "PUT",
          body,
        }
      );
      return {
        ok: true,
        nodeId: a.nodeId,
        ...body,
        raw,
      };
    }

    // ---- existing indent tools passthroughs ----
    case "generateIndentNumber":
      return await erp("/api/v1/indents/generate-number", { method: "GET" });

    case "fetchProjects":
      return await erp("/api/v1/projects", { method: "GET" });

    case "listLocations":
      return await erp("/api/v1/locations", { method: "GET" });

    case "listItems":
      return await erp("/api/v1/items", { method: "GET" });

    case "listUnits":
      return await erp("/api/v1/units", { method: "GET" });

    case "createIndent":
      // no schema re-validation here; ERP will enforce
      return await erp("/api/v1/indents", { method: "POST", body: args });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------- MCP JSON-RPC handlers ----------
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "erp-mcp-adapter",
    mcp: {
      version: "1.0.0",
      name: "ERP MCP Adapter",
      description: "MCP server for ERP node search & updates + indent tools",
    },
  });
});

app.post("/", async (req, res) => {
  const { id, method, params } = req.body || {};
  try {
    if (method === "initialize") {
      const clientInfo = params?.clientInfo || {};
      const protocolVersion = params?.protocolVersion || "2025-06-18";
      console.log(
        `Initialize from: ${
          clientInfo.name || "unknown"
        }, protocol: ${protocolVersion}`
      );
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "erp-mcp-adapter", version: "1.0.0" },
        },
      });
    }

    if (method === "tools/list") {
      return res.json({ jsonrpc: "2.0", id, result: { tools: toolCatalog() } });
    }

    if (method === "tools/call") {
      const { name, arguments: args = {} } = params || {};
      const data = await handleToolCall(name, args);
      // IMPORTANT: return structured JSON, not text
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "json", data }],
        },
      });
    }

    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err) {
    console.error("JSON-RPC error:", err);
    return res.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: err?.message || "Internal error",
        data: err?.validation || err?.data || null,
      },
    });
  }
});

// ---------- explicit endpoints (handy for curl/debug) ----------
app.post("/initialize", (req, res) => {
  const { id, params } = req.body || {};
  const protocolVersion = params?.protocolVersion || "2025-06-18";
  res.json({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion,
      capabilities: { tools: {}, resources: {}, prompts: {} },
      serverInfo: { name: "erp-mcp-adapter", version: "1.0.0" },
    },
  });
});

app.post("/tools/list", (req, res) => {
  const id = req.body?.id ?? null;
  res.json({ jsonrpc: "2.0", id, result: { tools: toolCatalog() } });
});

app.post("/tools/call", async (req, res) => {
  const id = req.body?.id ?? null;
  const { name, arguments: args = {} } = req.body?.params || {};
  try {
    const data = await handleToolCall(name, args);
    res.json({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "json", data }] },
    });
  } catch (err) {
    console.error("Tool call error:", err);
    res.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: err?.message || "Tool execution failed",
        data: err?.validation || err?.data || null,
      },
    });
  }
});

// ---------- OPTIONS helpers ----------
app.options("/initialize", (_req, res) => res.sendStatus(204));
app.options("/tools/list", (_req, res) => res.sendStatus(204));
app.options("/tools/call", (_req, res) => res.sendStatus(204));

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`MCP adapter listening on :${PORT}`);
  console.log(`ERP_BASE=${ERP_BASE}`);
  console.log("Ready for OpenAI MCP connections");
});
