import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---- basic request logger (remove after debugging)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("Body:", JSON.stringify(req.body, null, 2));
  }
  next();
});

// ---- CORS (Agent Builder runs at https://platform.openai.com)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 4000;
const ERP_BASE = (
  process.env.ERP_BASE || "https://gorealla.heptanesia.com"
).replace(/\/$/, "");
const ERP_TOKEN = process.env.ERP_TOKEN || ""; // Prefer env; don't hardcode secrets

// Allowed statuses (validated for PUT /status and combined PUT)
const VALID_STATUSES = [
  "Not Started",
  "In Progress",
  "Blocked",
  "Completed",
  "On Hold",
];

// ----------------- Core HTTP helper -----------------
async function erp(path, { method = "GET", body, query } = {}) {
  const url = new URL(`${ERP_BASE}${path}`);
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers = { "Content-Type": "application/json" };
  if (ERP_TOKEN)
    headers[
      "Authorization"
    ] = `Bearer eyJhbGciOiJIUzUxMiJ9.eyJyb2xlIjoiQWRtaW4iLCJjdXN0b21lcklkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAxIiwidXNlcklkIjoiMDM0YzdjZmQtNGU0Ny00ZTAzLWE2NGYtODc0ZjEyMjk1NmIwIiwiY3VzdG9tZXJOYW1lIjoiSmV0IFJlYWx0eSBMaW1pdGVkIiwic3ViIjoiOTgyMDE4OTcxOSIsImlzcyI6ImdvcmVhbGxhLWRldmVsb3BlciIsImlhdCI6MTc2MTgwMjA4NywiZXhwIjoxNzYxODg4NDg3fQ.6wxoa1oWSa4-pD_w9kfPZYwfv7rxcdIQo-6SxdkOZJNMruSg8Iwu4ytTbpXtwdi98uKuDccrEgyiUXfxmRLuKg`;

  const started = Date.now();
  let res, text;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    text = await res.text();
  } catch (networkErr) {
    const ms = Date.now() - started;
    throw {
      status: 0,
      data: {
        message: `Network error after ${ms}ms to ${url.toString()}`,
        detail: String(networkErr?.message || networkErr),
      },
    };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  const backendStatus = (data && (data.status || data.Status)) || undefined;
  const backendSuccess =
    data && (data.success !== undefined ? data.success : undefined);
  const isBackendError =
    backendStatus && String(backendStatus).toUpperCase() !== "SUCCESS";

  if (!res.ok || isBackendError || backendSuccess === false) {
    throw {
      status: res.status || 500,
      data: {
        message: data?.message || "An unexpected error occurred",
        backendStatus,
        backendSuccess,
        payload: data,
        httpStatus: res.status,
        url: url.toString(),
        method,
      },
    };
  }

  return data;
}

// ----------------- Tool Catalog -----------------
function toolCatalog() {
  return [
    {
      name: "searchNodesArray",
      description:
        "GET /api/v1/projects/nodes/search/searchNodesArray → search nodes by keyword; returns results in data.content",
      inputSchema: {
        type: "object",
        properties: {
          keywords: { type: "string" },
          page: { type: "integer" },
          size: { type: "integer" },
          sort: { type: "string" },
          includePaths: { type: "boolean" },
          includeStakeholders: { type: "boolean" },
        },
        required: ["keywords"],
        additionalProperties: false,
      },
    },
    {
      name: "updateNodeStatus",
      description:
        "PUT /api/v1/projects/nodes/{nodeId}/status → update only status. Allowed: Not Started, In Progress, Blocked, Completed, On Hold",
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          status: { type: "string" },
        },
        required: ["nodeId", "status"],
        additionalProperties: false,
      },
    },
    {
      name: "updateNode",
      description:
        "PUT /api/v1/projects/nodes/{nodeId} → update status and/or nodeDescription (and optionally parentNodeId).",
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          status: { type: "string" },
          nodeDescription: { type: "string" },
          parentNodeId: { type: "string" },
        },
        required: ["nodeId"],
        additionalProperties: false,
      },
    },
    {
      name: "finalizeAfterUpload",
      description:
        "Helper: call after your UI uploads the file to /api/v1/gallery/upload and you have nodeId (and maybe parentNodeId). If only status is provided → uses /status; else uses combined PUT.",
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          update: {
            type: "object",
            properties: {
              status: { type: "string" },
              nodeDescription: { type: "string" },
              parentNodeId: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        required: ["nodeId"],
        additionalProperties: false,
      },
    },
  ];
}

// ----------------- JSON-RPC surface -----------------

// health
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "jetrealty-media-mcp",
    mcp: {
      version: "1.0.0",
      name: "JetRealty Media MCP",
      description: "MCP server for node search and post-upload updates",
    },
  });
});

// root JSON-RPC multiplexer
app.post("/", async (req, res) => {
  const { id, method, params } = req.body || {};

  try {
    if (method === "initialize") {
      const protocolVersion = params?.protocolVersion || "2025-06-18";
      const clientInfo = params?.clientInfo || {};
      console.log(
        `Initialize from ${
          clientInfo.name || "client"
        } proto=${protocolVersion}`
      );
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "jetrealty-media-mcp", version: "1.0.0" },
        },
      });
    }

    if (method === "tools/list") {
      return res.json({ jsonrpc: "2.0", id, result: { tools: toolCatalog() } });
    }

    if (method === "tools/call") {
      const { name, arguments: args = {} } = params || {};
      const result = await handleToolCall(name, args);
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text:
                typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2),
            },
          ],
        },
      });
    }

    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err) {
    console.error("RPC error:", err);
    return res.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: "Internal error",
        data: err?.message || err,
      },
    });
  }
});

// explicit endpoints
app.post("/initialize", (req, res) => {
  const id = req.body?.id ?? null;
  const protocolVersion = req.body?.params?.protocolVersion || "2025-06-18";
  res.json({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion,
      capabilities: { tools: {}, resources: {}, prompts: {} },
      serverInfo: { name: "jetrealty-media-mcp", version: "1.0.0" },
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
    const result = await handleToolCall(name, args);
    res.json({
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text:
              typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2),
          },
        ],
      },
    });
  } catch (err) {
    console.error("Tool call error:", err);
    res.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: "Tool execution failed",
        data: err?.message || err,
      },
    });
  }
});

app.options("/initialize", (_req, res) => res.sendStatus(204));
app.options("/tools/list", (_req, res) => res.sendStatus(204));
app.options("/tools/call", (_req, res) => res.sendStatus(204));
app.options("/mcp", (_req, res) => res.sendStatus(204));

// GET for quick check
app.get("/tools", (_req, res) => res.json({ tools: toolCatalog() }));

// ----------------- Tool executors -----------------
async function handleToolCall(name, args) {
  console.log(
    `Executing tool: ${name} with args:`,
    JSON.stringify(args, null, 2)
  );

  switch (name) {
    case "searchNodesArray":
      return await toolSearchNodesArray(args);
    case "updateNodeStatus":
      return await toolUpdateNodeStatus(args);
    case "updateNode":
      return await toolUpdateNode(args);
    case "finalizeAfterUpload":
      return await toolFinalizeAfterUpload(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// GET /projects/nodes/search/searchNodesArray
async function toolSearchNodesArray(args = {}) {
  const { keywords } = args;
  if (!keywords || String(keywords).trim().length === 0) {
    throw new Error("'keywords' is required");
  }

  // Enforce canonical query params regardless of caller defaults
  const page = 0;
  const size = 50;
  const sort = "insertDate,ASC"; // will be encoded as insertDate%2CASC by URLSearchParams
  const includePaths = true;
  const includeStakeholders = true;

  let data;
  try {
    data = await erp("/api/v1/projects/nodes/search/searchNodesArray", {
      method: "GET",
      query: { keywords, page, size, sort, includePaths, includeStakeholders },
    });
  } catch (e) {
    const msg = e?.data?.message || e?.message || "Search failed";
    const httpStatus = e?.status || e?.data?.httpStatus || 424;
    throw new Error(`Search error (${httpStatus}): ${msg}`);
  }

  const content = data?.data?.content ?? [];
  const options = content.map((n) => ({
    nodeId: n.recCode,
    nodeName: n.nodeName,
    nodeTypeName: n.nodeTypeName,
    treeLevel: n.treeLevel,
    treePath: safeParseJSON(n.treePath, []),
    status: n.status,
    parentNodeId: n.parentNodeId || null,
    rootNodeId: n.rootNodeId || null,
  }));

  return {
    total: data?.data?.totalElements ?? options.length,
    page: data?.data?.pageable?.pageNumber ?? 0,
    size: data?.data?.pageable?.pageSize ?? options.length,
    options,
    raw: data,
  };
}

// PUT /projects/nodes/{nodeId}/status
async function toolUpdateNodeStatus(args = {}) {
  const { nodeId, status } = args;
  if (!nodeId) throw new Error("'nodeId' is required");
  if (!status) throw new Error("'status' is required");
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status. Allowed: ${VALID_STATUSES.join(", ")}`);
  }
  const data = await erp(`/api/v1/projects/nodes/${nodeId}/status`, {
    method: "PUT",
    body: { status },
  });
  return { updated: true, raw: data };
}

// PUT /projects/nodes/{nodeId}
async function toolUpdateNode(args = {}) {
  const { nodeId, status, nodeDescription, parentNodeId } = args;
  if (!nodeId) throw new Error("'nodeId' is required");
  if (status && !VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status. Allowed: ${VALID_STATUSES.join(", ")}`);
  }

  const body = {};
  if (typeof nodeDescription === "string")
    body.nodeDescription = nodeDescription;
  if (typeof status === "string") body.status = status;
  if (typeof parentNodeId === "string") body.parentNodeId = parentNodeId;

  const data = await erp(`/api/v1/projects/nodes/${nodeId}`, {
    method: "PUT",
    body,
  });
  return { updated: true, raw: data };
}

// Helper: upload-first flow finisher
async function toolFinalizeAfterUpload(args = {}) {
  const { nodeId, update = {} } = args;
  if (!nodeId) throw new Error("'nodeId' is required");

  const { status, nodeDescription, parentNodeId } = update;

  // If only status is provided → use status endpoint
  if (status && !nodeDescription && parentNodeId === undefined) {
    return await toolUpdateNodeStatus({ nodeId, status });
  }

  // If any of (status, nodeDescription, parentNodeId) → combined PUT
  if (
    status ||
    typeof nodeDescription === "string" ||
    typeof parentNodeId === "string"
  ) {
    return await toolUpdateNode({
      nodeId,
      status,
      nodeDescription,
      parentNodeId,
    });
  }

  return { message: "Nothing to update after upload." };
}

// ----------------- Utils -----------------
function safeParseJSON(str, fallback) {
  try {
    if (typeof str !== "string") return fallback;
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

app.listen(PORT, () => {
  console.log(`MCP adapter listening on :${PORT}`);
  console.log(`ERP_BASE=${ERP_BASE}`);
  console.log(`Ready for OpenAI MCP connections`);
});
