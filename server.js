// server.js — Minimal MCP-style server for Jet Realty search + node updates (no file upload handled here)
// Usage
//   PORT=3010 BASE_URL=https://jetrealty.gorealla.ai API_TOKEN=<<optional if needed>> node server.js
//
// Endpoints exposed to Agent Builder as an MCP server:
//   POST /tools  → describes available tools
//   POST /call   → executes a tool by name with args { toolName, arguments }
//
// This server DOES NOT accept or proxy image binaries. Upload files directly from the frontend to
//   POST  /api/v1/gallery/upload
// and then pass resulting fields (e.g., nodeId, parentNodeId if provided) back to the agent to continue.

import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3010;
const BASE_URL = process.env.BASE_URL || "https://gorealla.heptanesia.com"; // no trailing slash
const API_TOKEN = process.env.API_TOKEN || ""; // if your API requires Bearer; else leave blank

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: API_TOKEN
    ? {
        Authorization: `Bearer eyJhbGciOiJIUzUxMiJ9.eyJyb2xlIjoiQWRtaW4iLCJjdXN0b21lcklkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAxIiwidXNlcklkIjoiMDM0YzdjZmQtNGU0Ny00ZTAzLWE2NGYtODc0ZjEyMjk1NmIwIiwiY3VzdG9tZXJOYW1lIjoiSmV0IFJlYWx0eSBMaW1pdGVkIiwic3ViIjoiOTgyMDE4OTcxOSIsImlzcyI6ImdvcmVhbGxhLWRldmVsb3BlciIsImlhdCI6MTc2MTcyNzQzOCwiZXhwIjoxNzYxODEzODM4fQ.kqg71O63XDb2JUIUZN9LoMKpcL4ZVlk6HtIaKFh12vAAcD0g_zB0VBeDyQUm-nbM37ow1YI8IBAXjyMjjGkFRQ`,
      }
    : {},
});

// -------------------------------
// Utility helpers
// -------------------------------
const ok = (data) => ({ ok: true, data });
const fail = (message, status = 424, meta = {}) => ({
  ok: false,
  error: { message, status, ...meta },
});

const VALID_STATUSES = [
  "Not Started",
  "In Progress",
  "Blocked",
  "Completed",
  "On Hold",
];

// -------------------------------
// Tool implementations
// -------------------------------
async function searchNodesArray(args) {
  const {
    keywords,
    page = 0,
    size = 50,
    sort = "insertDate,ASC",
    includePaths = true,
    includeStakeholders = true,
  } = args || {};

  if (!keywords || String(keywords).trim().length === 0) {
    return fail("'keywords' is required.");
  }

  try {
    const res = await http.get(
      "/api/v1/projects/nodes/search/searchNodesArray",
      {
        params: {
          keywords,
          page,
          size,
          sort,
          includePaths,
          includeStakeholders,
        },
      }
    );

    const raw = res?.data || {};
    const content = raw?.data?.content ?? [];

    // map minimal selection list for UI + include full items
    const options = content.map((n) => ({
      nodeId: n.recCode,
      nodeName: n.nodeName,
      nodeTypeName: n.nodeTypeName,
      treeLevel: n.treeLevel,
      // Convert treePath JSON string to array for convenience when present
      treePath: safeParseJSON(n.treePath, []),
      status: n.status,
      parentNodeId: n.parentNodeId || null,
      rootNodeId: n.rootNodeId || null,
    }));

    return ok({
      total: raw?.data?.totalElements ?? options.length,
      page: raw?.data?.pageable?.pageNumber ?? 0,
      size: raw?.data?.pageable?.pageSize ?? options.length,
      options,
      raw,
    });
  } catch (err) {
    return axiosToFail(err, "System search error");
  }
}

async function updateNodeStatus(args) {
  const { nodeId, status } = args || {};
  if (!nodeId) return fail("'nodeId' is required.");
  if (!status) return fail("'status' is required.");
  if (!VALID_STATUSES.includes(status)) {
    return fail(`Invalid status. Allowed: ${VALID_STATUSES.join(", ")}`);
  }
  try {
    const res = await http.put(`/api/v1/projects/nodes/${nodeId}/status`, {
      status,
    });
    return ok({ updated: true, raw: res?.data });
  } catch (err) {
    return axiosToFail(err, "Failed to update node status");
  }
}

// PUT nodes/{nodeId} — supports partial fields (backend should ignore undefined)
async function updateNode(args) {
  const { nodeId, parentNodeId, nodeDescription, status } = args || {};
  if (!nodeId) return fail("'nodeId' is required.");

  // optional validation for status when provided
  if (status && !VALID_STATUSES.includes(status)) {
    return fail(`Invalid status. Allowed: ${VALID_STATUSES.join(", ")}`);
  }

  // Build the body only with present keys
  const body = {};
  if (typeof parentNodeId === "string") body.parentNodeId = parentNodeId;
  if (typeof nodeDescription === "string")
    body.nodeDescription = nodeDescription;
  if (typeof status === "string") body.status = status;

  try {
    const res = await http.put(`/api/v1/projects/nodes/${nodeId}`, body);
    return ok({ updated: true, raw: res?.data });
  } catch (err) {
    return axiosToFail(err, "Failed to update node");
  }
}

// Helper that executes the post-upload sequence depending on user intent.
// This DOES NOT upload files. It expects you already uploaded via /api/v1/gallery/upload
// and you pass the resulting nodeId (and optional parentNodeId if your API requires it).
async function finalizeAfterUpload(args) {
  const { nodeId, update = {} } = args || {};
  if (!nodeId) return fail("'nodeId' (from upload response) is required.");

  const { status, nodeDescription, parentNodeId } = update;

  // If only status, call status API first (your requirement: upload → then status/description)
  if (status && !nodeDescription && parentNodeId === undefined) {
    return updateNodeStatus({ nodeId, status });
  }

  // If both status and description (and/or parentNodeId), call the combined PUT
  if (status || nodeDescription || typeof parentNodeId === "string") {
    return updateNode({ nodeId, status, nodeDescription, parentNodeId });
  }

  return ok({ message: "Nothing to update after upload." });
}

// -------------------------------
// JSON-RPC style surface for MCP
// -------------------------------

const TOOLBOX = {
  searchNodesArray: {
    name: "searchNodesArray",
    description:
      "GET /api/v1/projects/nodes/search/searchNodesArray → search nodes by keyword and return selection options.",
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
  updateNodeStatus: {
    name: "updateNodeStatus",
    description:
      "PUT /api/v1/projects/nodes/{nodeId}/status → update a node's status. Allowed: Not Started, In Progress, Blocked, Completed, On Hold",
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
  updateNode: {
    name: "updateNode",
    description:
      "PUT /api/v1/projects/nodes/{nodeId} → update nodeDescription and/or status (and optionally parentNodeId).",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        parentNodeId: { type: "string" },
        nodeDescription: { type: "string" },
        status: { type: "string" },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  finalizeAfterUpload: {
    name: "finalizeAfterUpload",
    description:
      "Helper: after the frontend uploads the file and obtains nodeId (and maybe parentNodeId), call this to apply status/description updates. This server does not upload files.",
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
};

app.post("/tools", (_req, res) => {
  res.json({ tools: Object.values(TOOLBOX) });
});

app.post("/call", async (req, res) => {
  try {
    const { toolName, arguments: args } = req.body || {};
    if (!toolName || !TOOLBOX[toolName]) {
      return res
        .status(400)
        .json(fail("Unknown or missing 'toolName' in request.", 400));
    }

    let result;
    switch (toolName) {
      case "searchNodesArray":
        result = await searchNodesArray(args);
        break;
      case "updateNodeStatus":
        result = await updateNodeStatus(args);
        break;
      case "updateNode":
        result = await updateNode(args);
        break;
      case "finalizeAfterUpload":
        result = await finalizeAfterUpload(args);
        break;
      default:
        return res
          .status(400)
          .json(fail(`Tool '${toolName}' not implemented.`, 400));
    }

    // Map tool failures to HTTP 424 so Agent Builder can show a helpful toast
    if (!result.ok) {
      const code = result.error?.status || 424;
      return res.status(code).json(result);
    }

    res.json(result);
  } catch (err) {
    const f = axiosToFail(err, "Unhandled tool error");
    const code = f.error?.status || 424;
    res.status(code).json(f);
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", baseUrl: BASE_URL });
});

app.listen(PORT, () => {
  console.log(`MCP server listening on :${PORT}`);
});

// -------------------------------
// Helpers
// -------------------------------
function safeParseJSON(str, fallback) {
  try {
    if (typeof str !== "string") return fallback;
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function axiosToFail(err, prefix = "") {
  const isAxios = !!err?.isAxiosError || !!err?.response || !!err?.request;
  if (!isAxios) return fail(prefix || err?.message || "Unknown error");
  const status = err?.response?.status || 424;
  const data = err?.response?.data;
  const url = err?.config?.url;
  const method = err?.config?.method;
  const params = err?.config?.params;
  const info = { status, url, method, params, data };
  const msg = `${prefix}${prefix ? ": " : ""}${
    data?.message || err?.message || "Request failed"
  }`;
  return fail(msg, status, info);
}
