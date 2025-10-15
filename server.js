import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

// --- CORS middleware ---
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // or restrict to https://platform.openai.com
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

// ---- helper to call ERP ----
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

// ---- health (Builder may probe root) ----
app.get("/", (_req, res) => res.json({ ok: true, service: "erp-mcp-adapter" }));
app.options("/", (_req, res) => res.sendStatus(204));

// ---- MCP: list tools ----
app.get("/tools", (_req, res) => {
  res.json({
    tools: [
      {
        name: "generateIndentNumber",
        description:
          "GET /api/v1/indents/generate-number → returns indent number in result.data.data",
        input_schema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "listLocations",
        description:
          "GET /api/v1/locations → returns paged locations in result.data.data.content",
        input_schema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "listItems",
        description:
          "GET /api/v1/items → returns paged items in result.data.data.content",
        input_schema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "listUnits",
        description:
          "GET /api/v1/units → returns paged units in result.data.data.content",
        input_schema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "createIndent",
        description:
          "POST /api/v1/indents → creates an indent with the exact ERP JSON shape.",
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
    ],
  });
});
app.options("/tools", (_req, res) => res.sendStatus(204));

// ---- MCP: invoke tool ----
app.post("/tools/:name", async (req, res) => {
  const name = req.params.name;
  const args = req.body || {};
  try {
    switch (name) {
      case "generateIndentNumber": {
        const data = await erp("/api/v1/indents/generate-number", "GET");
        return res.json({ ok: true, result: data });
      }
      case "listLocations": {
        const data = await erp("/api/v1/locations", "GET");
        return res.json({ ok: true, result: data });
      }
      case "listItems": {
        const data = await erp("/api/v1/items", "GET");
        return res.json({ ok: true, result: data });
      }
      case "listUnits": {
        const data = await erp("/api/v1/units", "GET");
        return res.json({ ok: true, result: data });
      }
      case "createIndent": {
        const data = await erp("/api/v1/indents", "POST", args);
        return res.json({ ok: true, result: data });
      }
      default:
        return res
          .status(404)
          .json({ ok: false, error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ ok: false, error: err });
  }
});
app.options("/tools/:name", (_req, res) => res.sendStatus(204));

app.listen(PORT, () => {
  console.log(`MCP adapter listening on :${PORT}`);
  console.log(`ERP_BASE=${ERP_BASE}`);
});
