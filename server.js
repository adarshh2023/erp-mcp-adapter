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
const ERP_BASE = (process.env.ERP_BASE || "").replace(/\/$/, "");
const ERP_TOKEN = process.env.ERP_TOKEN;

async function erp(path, method = "GET", body) {
  const url = `${ERP_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: ERP_TOKEN,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw { status: res.status, data };
  return data;
}

// ---------- tool catalog (include camelCase + snake_case for max compatibility)
function toolCatalog() {
  const tools = [
    {
      name: "generateIndentNumber",
      title: "Generate Indent Number",
      description:
        "GET /api/v1/indents/generate-number → returns indent number in data",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "listLocations",
      title: "List Locations",
      description: "GET /api/v1/locations → locations in data.content",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "listItems",
      title: "List Items",
      description: "GET /api/v1/items → items in data.content",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "listUnits",
      title: "List Units",
      description: "GET /api/v1/units → units in data.content",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "createIndent",
      title: "Create Indent",
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
      input_schema: {
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

// ---------- MCP JSON-RPC handlers

// health - Enhanced with MCP info
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "erp-mcp-adapter",
    mcp: {
      version: "1.0.0",
      name: "ERP MCP Adapter",
      description: "MCP server for ERP indent management",
    },
  });
});
app.options("/", (_req, res) => res.sendStatus(204));

// root JSON-RPC multiplexer - ENHANCED with initialize
app.post("/", async (req, res) => {
  const { id, method, params } = req.body || {};

  try {
    // IMPORTANT: Handle initialize method
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "1.0.0",
          capabilities: {
            tools: {},
            resources: null,
            prompts: null,
          },
          serverInfo: {
            name: "erp-mcp-adapter",
            version: "1.0.0",
          },
        },
      });
    }

    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: { tools: toolCatalog(), nextCursor: null },
      });
    }

    if (method === "tools/call") {
      const { name, arguments: args = {} } = params || {};
      const result = await handleToolCall(name, args);
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false,
        },
      });
    }

    return res.status(400).json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown method: ${method}` },
    });
  } catch (err) {
    console.error("Error handling request:", err);
    return res.status(err?.status || 500).json({
      jsonrpc: "2.0",
      id,
      error: {
        code: err?.status || -32603,
        message: err?.message || "Internal error",
        data: err?.data || err,
      },
    });
  }
});

// explicit initialize endpoint
app.post("/initialize", (req, res) => {
  const id = req.body?.id ?? null;
  res.json({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: "1.0.0",
      capabilities: {
        tools: {},
        resources: null,
        prompts: null,
      },
      serverInfo: {
        name: "erp-mcp-adapter",
        version: "1.0.0",
      },
    },
  });
});

// explicit endpoints (some clients use these)
app.post("/tools/list", (req, res) => {
  const id = req.body?.id ?? null;
  res.json({
    jsonrpc: "2.0",
    id,
    result: { tools: toolCatalog(), nextCursor: null },
  });
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
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
      },
    });
  } catch (err) {
    console.error("Tool call error:", err);
    res.status(err?.status || 500).json({
      jsonrpc: "2.0",
      id,
      error: {
        code: err?.status || -32603,
        message: err?.message || "Tool execution failed",
        data: err?.data || err,
      },
    });
  }
});

// /mcp endpoint with full handling
app.post("/mcp", async (req, res) => {
  const { id, method, params } = req.body || {};

  try {
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "1.0.0",
          capabilities: {
            tools: {},
            resources: null,
            prompts: null,
          },
          serverInfo: {
            name: "erp-mcp-adapter",
            version: "1.0.0",
          },
        },
      });
    }

    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: { tools: toolCatalog(), nextCursor: null },
      });
    }

    if (method === "tools/call") {
      const { name, arguments: args = {} } = params || {};
      const result = await handleToolCall(name, args);
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false,
        },
      });
    }

    return res.status(400).json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown method: ${method}` },
    });
  } catch (err) {
    console.error("MCP endpoint error:", err);
    return res.status(err?.status || 500).json({
      jsonrpc: "2.0",
      id,
      error: {
        code: err?.status || -32603,
        message: err?.message || "Internal error",
        data: err?.data || err,
      },
    });
  }
});

app.options("/initialize", (_req, res) => res.sendStatus(204));
app.options("/tools/list", (_req, res) => res.sendStatus(204));
app.options("/tools/call", (_req, res) => res.sendStatus(204));
app.options("/mcp", (_req, res) => res.sendStatus(204));

// GET endpoint for tools (for debugging)
app.get("/tools", (_req, res) => {
  res.json({ tools: toolCatalog() });
});

// ---- actual tool execution
async function handleToolCall(name, args) {
  console.log(`Executing tool: ${name} with args:`, args);

  switch (name) {
    case "generateIndentNumber":
      return await erp("/api/v1/indents/generate-number", "GET");
    case "listLocations":
      return await erp("/api/v1/locations", "GET");
    case "listItems":
      return await erp("/api/v1/items", "GET");
    case "listUnits":
      return await erp("/api/v1/units", "GET");
    case "createIndent":
      return await erp("/api/v1/indents", "POST", args);
    default:
      throw {
        status: 404,
        message: `Unknown tool: ${name}`,
        data: { error: `Unknown tool: ${name}` },
      };
  }
}

app.listen(PORT, () => {
  console.log(`MCP adapter listening on :${PORT}`);
  console.log(`ERP_BASE=${ERP_BASE}`);
  console.log(`Endpoints available:`);
  console.log(`  - GET  / (health check)`);
  console.log(`  - POST / (JSON-RPC multiplexer)`);
  console.log(`  - POST /initialize`);
  console.log(`  - POST /tools/list`);
  console.log(`  - POST /tools/call`);
  console.log(`  - POST /mcp`);
  console.log(`  - GET  /tools (debug)`);
});
