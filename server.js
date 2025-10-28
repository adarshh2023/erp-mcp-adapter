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
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-ERP-Base-Url"
  );
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 4000;
const ENV_ERP_BASE = (process.env.ERP_BASE || "").replace(/\/$/, "");
const ENV_ERP_TOKEN = process.env.ERP_TOKEN || "";

/**
 * Resolve ERP base URL and headers from the current request.
 * Allows Agent SDK to pass Authorization & X-ERP-Base-Url dynamically.
 */
function resolveErpContext(req) {
  const headerBase = (req.get("X-ERP-Base-Url") || "").replace(/\/$/, "");
  const base = headerBase || ENV_ERP_BASE;
  const authHeader =
    req.get("Authorization") ||
    (ENV_ERP_TOKEN ? `Bearer ${ENV_ERP_TOKEN}` : "");
  return { base, authHeader };
}

async function erp(req, path, method = "GET", body) {
  const { base, authHeader } = resolveErpContext(req);
  if (!base) {
    throw new Error(
      "ERP_BASE is not configured (missing X-ERP-Base-Url header or ENV ERP_BASE)."
    );
  }
  const url = `${base}${path}`;
  const headers = {
    "Content-Type": "application/json",
  };
  if (authHeader) headers["Authorization"] = authHeader;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = {
      status: res.status,
      data,
    };
    console.error("ERP error:", JSON.stringify(err, null, 2));
    throw err;
  }
  return data;
}

// ---------- tool catalog
function toolCatalog() {
  const tools = [
    // NEW: Project node search tool (GET)
    {
      name: "searchProjectNode",
      description:
        "GET /api/v1/projects/nodes/search/searchNodesArray?keywords=<term>&page=0&size=50&sort=insertDate,ASC&includePaths=true&includeStakeholders=true → returns normalized rows plus raw",
      inputSchema: {
        type: "object",
        properties: {
          keywords: {
            type: "string",
            description: "Search term for node name (e.g., LC4)",
          },
          page: { type: "integer", minimum: 0, default: 0 },
          size: { type: "integer", minimum: 1, default: 50 },
          sort: { type: "string", default: "insertDate,ASC" },
          includePaths: { type: "boolean", default: true },
          includeStakeholders: { type: "boolean", default: true },
        },
        required: ["keywords"],
        additionalProperties: false,
      },
    },
    // Existing tools
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
  return tools;
}

// ---------- helpers for searchProjectNode normalization
function safeParseTreePath(treePath) {
  if (!treePath || typeof treePath !== "string") return [];
  try {
    const arr = JSON.parse(treePath);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function nodeToRow(node) {
  const nodeId = node?.recCode || node?.id || node?.nodeId || "";
  const nodeName = node?.nodeName || "(unnamed node)";
  const status = node?.status || "";
  const pathArr = safeParseTreePath(node?.treePath);
  const breadcrumb = pathArr
    .map((p) => p?.nodeName)
    .filter(Boolean)
    .join(" / ");
  return { rowId: nodeId, nodeId, nodeName, breadcrumb, status };
}

// ---------- MCP JSON-RPC handlers

// health
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "erp-mcp-adapter",
    mcp: {
      version: "1.0.0",
      name: "ERP MCP Adapter",
      description: "MCP server for ERP indent & media management",
    },
  });
});

// root JSON-RPC multiplexer - HANDLES OPENAI'S SPECIFIC FORMAT
app.post("/", async (req, res) => {
  const { id, method, params } = req.body || {};

  try {
    if (method === "initialize") {
      const clientInfo = params?.clientInfo || {};
      const protocolVersion = params?.protocolVersion || "2025-06-18";

      console.log(
        `Initialize request from: ${clientInfo.name}, protocol: ${protocolVersion}`
      );

      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: protocolVersion,
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "erp-mcp-adapter", version: "1.0.0" },
        },
      });
    }

    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: { tools: toolCatalog() },
      });
    }

    if (method === "tools/call") {
      const { name, arguments: args = {} } = params || {};
      console.log(`Tool call: ${name}`, args);

      const result = await handleToolCall(req, name, args);

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

    console.log(`Unknown method: ${method}`);
    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err) {
    console.error("Error handling request:", err);
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

// Explicit endpoints for other clients
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
  res.json({
    jsonrpc: "2.0",
    id,
    result: { tools: toolCatalog() },
  });
});

app.post("/tools/call", async (req, res) => {
  const id = req.body?.id ?? null;
  const { name, arguments: args = {} } = req.body?.params || {};

  try {
    const result = await handleToolCall(req, name, args);
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

// OPTIONS for all endpoints
app.options("/initialize", (_req, res) => res.sendStatus(204));
app.options("/tools/list", (_req, res) => res.sendStatus(204));
app.options("/tools/call", (_req, res) => res.sendStatus(204));
app.options("/mcp", (_req, res) => res.sendStatus(204));

// GET endpoint for debugging
app.get("/tools", (_req, res) => {
  res.json({ tools: toolCatalog() });
});

// ---- actual tool execution
async function handleToolCall(req, name, args) {
  console.log(
    `Executing tool: ${name} with args:`,
    JSON.stringify(args, null, 2)
  );

  try {
    switch (name) {
      // NEW: searchProjectNode with defensive parsing & normalization
      case "searchProjectNode": {
        const keywords = String(args?.keywords || "").trim();
        const page = Number.isInteger(args?.page) ? String(args.page) : "0";
        const size = Number.isInteger(args?.size) ? String(args.size) : "50";
        const sort = args?.sort || "insertDate,ASC";
        const includePaths =
          typeof args?.includePaths === "boolean"
            ? String(args.includePaths)
            : "true";
        const includeStakeholders =
          typeof args?.includeStakeholders === "boolean"
            ? String(args.includeStakeholders)
            : "true";

        const qs = new URLSearchParams({
          keywords,
          page,
          size,
          sort,
          includePaths,
          includeStakeholders,
        });

        // Call ERP
        const raw = await erp(
          req,
          `/api/v1/projects/nodes/search/searchNodesArray?${qs.toString()}`,
          "GET"
        );

        const content = raw?.data?.content ?? [];
        console.log(
          "searchNodesArray content length:",
          Array.isArray(content) ? content.length : "not array"
        );

        // Normalize rows for table.select
        let rows = [];
        if (Array.isArray(content)) {
          try {
            rows = content.map(nodeToRow).filter((r) => r.nodeId);
          } catch (e) {
            console.error("row transform error:", e);
            rows = [];
          }
        }

        return {
          ok: true,
          count: rows.length,
          rows,
          pageInfo: {
            page: raw?.data?.pageable?.pageNumber ?? 0,
            size: raw?.data?.pageable?.pageSize ?? Number(size),
            totalElements: raw?.data?.totalElements ?? rows.length,
            totalPages: raw?.data?.totalPages ?? 1,
          },
          // Keep raw if you want to debug on the agent side
          // raw,
        };
      }

      case "generateIndentNumber":
        return await erp(req, "/api/v1/indents/generate-number", "GET");
      case "fetchProjects":
        return await erp(req, "/api/v1/projects", "GET");
      case "listLocations":
        return await erp(req, "/api/v1/locations", "GET");
      case "listItems":
        return await erp(req, "/api/v1/items", "GET");
      case "listUnits":
        return await erp(req, "/api/v1/units", "GET");
      case "createIndent":
        return await erp(req, "/api/v1/indents", "POST", args);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`Tool execution error for ${name}:`, error);
    // normalize thrown error so Agent gets a clean message
    if (error?.data?.message) throw new Error(error.data.message);
    if (typeof error?.data === "string") throw new Error(error.data);
    if (typeof error?.message === "string") throw new Error(error.message);
    throw error;
  }
}

app.listen(PORT, () => {
  console.log(`MCP adapter listening on :${PORT}`);
  console.log(
    `ENV ERP_BASE=${ENV_ERP_BASE || "(not set; using header X-ERP-Base-Url)"}`
  );
  console.log(`Ready for OpenAI MCP connections`);
});
