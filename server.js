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
      Authorization:
        "Bearer eyJhbGciOiJIUzUxMiJ9.eyJyb2xlIjoiQWRtaW4iLCJjdXN0b21lcklkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAxIiwidXNlcklkIjoiMDM0YzdjZmQtNGU0Ny00ZTAzLWE2NGYtODc0ZjEyMjk1NmIwIiwiY3VzdG9tZXJOYW1lIjoiSmV0IFJlYWx0eSBMaW1pdGVkIiwic3ViIjoiOTgyMDE4OTcxOSIsImlzcyI6ImdvcmVhbGxhLWRldmVsb3BlciIsImlhdCI6MTc2MDY4MjI5NCwiZXhwIjoxNzYwNzY4Njk0fQ.OpU8dqnwSpkcyUzwZbRkDCh0i_x4x9U3sXQBkO_6Df_T-_gFVMCTkvUq4eNfXIuyEJRVMtAqnFfd_4lNnLCujQ",
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

// ---------- tool catalog
function toolCatalog() {
  const tools = [
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

// ---------- MCP JSON-RPC handlers

// health
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

// root JSON-RPC multiplexer - HANDLES OPENAI'S SPECIFIC FORMAT
app.post("/", async (req, res) => {
  const { id, method, params, jsonrpc } = req.body || {};

  try {
    // Handle initialize with OpenAI's protocol version
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
          protocolVersion: protocolVersion, // Echo back the client's protocol version
          capabilities: {
            tools: {}, // Empty object, not null
            resources: {},
            prompts: {},
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
        result: {
          tools: toolCatalog(),
        },
      });
    }

    if (method === "tools/call") {
      const { name, arguments: args = {} } = params || {};
      console.log(`Tool call: ${name}`, args);

      const result = await handleToolCall(name, args);

      // Return in the format OpenAI expects
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

    // Unknown method
    console.log(`Unknown method: ${method}`);
    return res.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
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
      protocolVersion: protocolVersion,
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      serverInfo: {
        name: "erp-mcp-adapter",
        version: "1.0.0",
      },
    },
  });
});

app.post("/tools/list", (req, res) => {
  const id = req.body?.id ?? null;
  res.json({
    jsonrpc: "2.0",
    id,
    result: {
      tools: toolCatalog(),
    },
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
async function handleToolCall(name, args) {
  console.log(
    `Executing tool: ${name} with args:`,
    JSON.stringify(args, null, 2)
  );

  try {
    switch (name) {
      case "generateIndentNumber":
        return await erp("/api/v1/indents/generate-number", "GET");
      case "fetchProjects":
        return await erp("/api/v1/projects", "GET");
      case "listLocations":
        return await erp("/api/v1/locations", "GET");
      case "listItems":
        return await erp("/api/v1/items", "GET");
      case "listUnits":
        return await erp("/api/v1/units", "GET");
      case "createIndent":
        return await erp("/api/v1/indents", "POST", args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`Tool execution error for ${name}:`, error);
    throw error;
  }
}

app.listen(PORT, () => {
  console.log(`MCP adapter listening on :${PORT}`);
  console.log(`ERP_BASE=${ERP_BASE}`);
  console.log(`Ready for OpenAI MCP connections`);
});
