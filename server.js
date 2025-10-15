import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));

// --- CORS (Agent Builder runs in browser at platform.openai.com) ---
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // or "https://platform.openai.com"
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

// ---- Helper to call ERP ----
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
  if (!res.ok) {
    throw { status: res.status, data };
  }
  return data;
}

// ---- Health (some clients probe root) ----
app.get("/", (_req, res) => res.json({ ok: true, service: "erp-mcp-adapter" }));
app.options("/", (_req, res) => res.sendStatus(204));

/**
 * =========================
 *  MCP JSON-RPC ENDPOINTS
 * =========================
 *
 * Spec excerpts (HTTP transport):
 * - Client POSTs JSON-RPC 2.0: { "jsonrpc":"2.0","id":1,"method":"tools/list","params":{} }
 * - Client POSTs JSON-RPC 2.0: { "jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"...","arguments":{...}} }
 */

// Single endpoint that handles both methods (keep it simple)
app.post("/tools/list", (req, res) => {
  const id = req.body?.id ?? null;
  return res.json({
    jsonrpc: "2.0",
    id,
    result: {
      tools: [
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
        },
      ],
      nextCursor: null,
    },
  });
});

// Some clients send a single endpoint JSON-RPC multiplexer; support that too:
app.post("/mcp", async (req, res) => {
  const { id, method, params } = req.body || {};
  try {
    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
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
            },
            {
              name: "listLocations",
              title: "List Locations",
              description: "GET /api/v1/locations → data.content",
              inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
            {
              name: "listItems",
              title: "List Items",
              description: "GET /api/v1/items → data.content",
              inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
            {
              name: "listUnits",
              title: "List Units",
              description: "GET /api/v1/units → data.content",
              inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
            {
              name: "createIndent",
              title: "Create Indent",
              description: "POST /api/v1/indents → creates an indent",
              inputSchema: {
                /* same as above */
              },
            },
          ],
          nextCursor: null,
        },
      });
    } else if (method === "tools/call") {
      const { name, arguments: args = {} } = params || {};
      const result = await handleToolCall(name, args);
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          // MCP "content" is an array; include structured content too
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        },
      });
    } else {
      return res.status(400).json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown method: ${method}` },
      });
    }
  } catch (err) {
    return res.status(err?.status || 500).json({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(err) }],
        isError: true,
      },
    });
  }
});

// Also support explicit endpoints some clients might use:
app.post("/tools/call", async (req, res) => {
  const id = req.body?.id ?? null;
  const { name, arguments: args = {} } = req.body?.params || {};
  try {
    const result = await handleToolCall(name, args);
    return res.json({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false,
      },
    });
  } catch (err) {
    return res.status(err?.status || 500).json({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(err) }],
        isError: true,
      },
    });
  }
});
app.options("/tools/list", (_req, res) => res.sendStatus(204));
app.options("/tools/call", (_req, res) => res.sendStatus(204));
app.options("/mcp", (_req, res) => res.sendStatus(204));

// ---- actual tool implementations ----
async function handleToolCall(name, args) {
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
      throw { status: 400, data: { error: `Unknown tool: ${name}` } };
  }
}

app.listen(PORT, () => {
  console.log(`MCP adapter listening on :${PORT}`);
  console.log(`ERP_BASE=${ERP_BASE}`);
});
