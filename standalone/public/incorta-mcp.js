// Browser client for Incorta MCP, through the local server's /api/incorta/call.
// The server adds the Incorta credentials, so none are held here.
(function () {
  async function callTool(tool, args) {
    const res = await fetch('/api/incorta/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args })
    });
    let body;
    try { body = await res.json(); } catch { throw new Error(`Incorta call failed (HTTP ${res.status})`); }
    if (!res.ok || body.error) throw new Error(body.error || `Incorta call failed (HTTP ${res.status})`);
    return body.answer;
  }

  window.IncortaMCP = {
    callTool,
    listSchemas: (args) => callTool('list_schemas', args),
    getSchema: (schema_name) => callTool('get_schema', { schema_name }),
    getTable: (schema_name, table_name) => callTool('get_table', { schema_name, table_name }),
    queryBusinessView: (query) => callTool('query_business_view', { query }),
    runSql: (sql, limit) => callTool('run_sql', { sql, limit })
  };
})();
