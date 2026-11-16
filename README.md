# Incorta + Claude

Dashboards and analysis built with Claude on live Incorta data through the Incorta MCP connector.

## Contents

| Path | Description |
|---|---|
| [`dashboards/gifts-donations`](dashboards/gifts-donations) | Gifts & Donations spend dashboard on the `BSGiftsDonations` business view |

## How these dashboards work

Each dashboard is a Claude Data artifact made of:

- **Datasets:** live calls to an Incorta MCP tool (`query_business_view` or `run_sql`), stored in `dashboard.json`. They run in the viewer's browser with the viewer's own Incorta access.
- **Page:** `index.html`, whose scripts turn the query results into figures, charts and tables.

## Incorta MCP tools

| Tool | Use |
|---|---|
| `list_schemas` | List physical and business schemas |
| `get_schema` | List the tables or views in a schema |
| `get_table` | List a table's or view's columns |
| `query_business_view` | Query one business view (aggregate, filter, sort) |
| `run_sql` | Spark SQL against physical or business schemas (needs `INCORTA_USERNAME`) |
