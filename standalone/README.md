# Standalone runner: dashboards on the Incorta MCP

Runs the dashboards in [`../dashboards`](../dashboards) outside Claude, calling the **Incorta MCP server** directly.

```
browser ──► standalone/server.js ──► Incorta MCP server ──► Incorta
            (adds your credentials)   (MCP Streamable HTTP, JSON-RPC)
```

- **`server.js`** serves the dashboards and exposes `POST /api/incorta/call`. It opens an MCP session with the Incorta MCP server (`initialize`), then forwards each `tools/call`, adding your Incorta headers. Your token stays on the server; the browser never sees it.
- **`public/incorta-mcp.js`** is the browser client: `IncortaMCP.callTool(tool, args)`, plus `listSchemas`, `getSchema`, `getTable`, `queryBusinessView` and `runSql`.
- **`public/dash-runtime.js`** loads a dashboard's `dashboard.json` and `index.html`, runs each dataset's Incorta MCP call, and gives the page the same `dash` API it uses inside Claude. The dashboard page itself is unchanged: the same `index.html` runs in both places.

Only read-only tools pass through: `list_schemas`, `get_schema`, `get_table`, `query_business_view`, `run_sql`.

## Run it

Needs Node 20.6 or later. Nothing to install.

```bash
cd standalone
cp .env.example .env      # then fill in .env
node --env-file=.env server.js
```

Open http://127.0.0.1:8787/?dashboard=gifts-donations

### `.env`

| Variable | What it is |
|---|---|
| `INCORTA_MCP_URL` | The Incorta MCP server endpoint |
| `INCORTA_ENV_URL` | Your Incorta environment URL (sent as the `Authorization` header) |
| `INCORTA_TENANT` | Your tenant (`X-Tenant`) |
| `INCORTA_TOKEN` | Your Incorta access token (`X-Token`) |
| `INCORTA_ACCOUNT_ID` | Only for `run_sql` (`X-Account-Id`) |
| `PORT`, `HOST` | Where the server listens (default `127.0.0.1:8787`) |

`.env` is git-ignored. Never commit it.

## Security

- The server listens on `127.0.0.1` by default. Every viewer of a dashboard served this way sees data with **your** token's access. If you set `HOST=0.0.0.0` to share it, put it behind your own sign-in.
- The tool allowlist in `server.js` keeps it read-only.

## Adding a dashboard

Create `dashboards/<name>/` with an `index.html` page and a `dashboard.json` whose datasets are Incorta MCP calls:

```json
{
  "meta": { "title": "My dashboard" },
  "params": {},
  "datasets": {
    "my_rows": {
      "source": {
        "kind": "call",
        "tool": "query_business_view",
        "args": { "query": { "measures": ["SCHEMA.VIEW.COLUMN"], "page_size": 100 } }
      }
    }
  }
}
```

Then open `/?dashboard=<name>`. A `{{name}}` in a dataset's `args` is filled from the page's filters (`dash.setParams`), and that dataset is re-queried when the filter changes.
