// A small runtime that runs a dashboard from ../dashboards/<name>/ outside Claude.
// It loads the dashboard's dashboard.json (its datasets) and index.html (its page),
// fetches every dataset from Incorta through IncortaMCP, and provides the `dash`
// API the page's scripts use: data, onData, calc, loader, draw, params, setParams.
(function () {
  const datasets = {};   // id -> {status, data, columns, message, truncated, meta}
  const loaders = {};    // id -> {fn}
  const calcs = {};      // id -> {inputs, fn}
  const draws = new Map(); // name -> fn | {mount, update, unmount}
  const mounted = new WeakMap();
  const onDataFns = [];
  let params = {};
  let defaults = {};
  let calcCache = {};
  let renderQueued = false;

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  function dataOf(id) {
    if (datasets[id]) return datasets[id];
    if (calcs[id]) {
      if (calcCache[id]) return calcCache[id];
      const c = calcs[id];
      const inputs = c.inputs.map(dataOf);
      const bad = inputs.find((s) => s.status !== 'ok');
      let out;
      if (bad) {
        out = { status: bad.status, data: null, message: bad.message, truncated: false };
      } else {
        try {
          out = { status: 'ok', data: c.fn(...inputs.map((s) => s.data)), truncated: false };
        } catch (err) {
          console.error(`Calculation ${id} failed`, err);
          out = { status: 'error', data: null, message: String(err.message || err), truncated: false };
        }
      }
      if (out.status === 'ok' && Array.isArray(out.data) && out.data[0] && typeof out.data[0] === 'object') {
        out.columns = Object.keys(out.data[0]);
      }
      calcCache[id] = out;
      return out;
    }
    return { status: 'missing', data: [], message: `No dataset or calculation named ${id}` };
  }

  function runDraw(name, el) {
    const d = draws.get(name);
    if (!d) return;
    try {
      if (typeof d === 'function') {
        d(el);
      } else {
        let made = mounted.get(el);
        if (!made) {
          el.replaceChildren();
          made = { value: d.mount ? d.mount(el) : undefined };
          mounted.set(el, made);
        }
        if (d.update) d.update(el, made.value);
      }
    } catch (err) {
      console.error(`Drawing ${name} failed`, err);
    }
  }

  function render() {
    calcCache = {};
    for (const fn of onDataFns) {
      try { fn(); } catch (err) { console.error('onData failed', err); }
    }
    document.querySelectorAll('#dash-root [data-draw]').forEach((el) => {
      if (el.closest('[hidden]')) return;
      if (el.parentElement && el.parentElement.closest('[data-draw]')) return;
      runDraw(el.getAttribute('data-draw'), el);
    });
    document.querySelectorAll('#dash-root [data-source]').forEach((el) => {
      const ids = el.getAttribute('data-source').split(/\s+/).filter(Boolean);
      const states = ids.map((id) => dataOf(id).status);
      const state = states.includes('error') ? 'error' : states.includes('loading') ? 'loading' : '';
      if (state) el.setAttribute('data-dash-source-state', state); else el.removeAttribute('data-dash-source-state');
    });
  }

  async function loadDataset(id, def) {
    datasets[id] = { status: 'loading', data: [], columns: [], truncated: false };
    queueRender();
    const src = def.source || {};
    try {
      if (src.kind !== 'call') throw new Error(`Only live Incorta calls are supported here (dataset ${id} is "${src.kind}")`);
      const args = fillParams(src.args || {});
      const answer = await window.IncortaMCP.callTool(src.tool, args);
      let out;
      if (loaders[id]) {
        out = await loaders[id].fn({ answer, items: [answer], args, call: window.IncortaMCP.callTool, read: {} });
      } else {
        out = answer;
      }
      const rows = Array.isArray(out) ? out : Array.isArray(out && out.data) ? out.data : Array.isArray(out && out.rows) ? out.rows : [];
      const columns = (out && out.columns) || (rows[0] ? Object.keys(rows[0]) : []);
      datasets[id] = { status: 'ok', data: rows, columns, truncated: !!(out && out.truncated), meta: out && out.meta, loadedAt: new Date() };
    } catch (err) {
      console.error(`Dataset ${id} failed to load`, err);
      datasets[id] = { status: 'error', data: [], columns: [], message: String(err.message || err), truncated: false };
    }
    queueRender();
  }

  // Fills {{name}} blanks in a call's args from the current params.
  function fillParams(value) {
    if (typeof value === 'string') {
      const whole = value.match(/^\{\{(\w+)\}\}$/);
      if (whole) return params[whole[1]] ?? '';
      return value.replace(/\{\{(\w+)\}\}/g, (_, k) => (params[k] ?? '').toString());
    }
    if (Array.isArray(value)) return value.map(fillParams);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillParams(v)]));
    return value;
  }

  let config = { datasets: {} };
  function usesParam(def, names) {
    const text = JSON.stringify((def.source || {}).args || {});
    return names.some((n) => text.includes(`{{${n}}}`));
  }

  window.dash = {
    colors: ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'],
    data: (id) => dataOf(id),
    onData: (fn) => { onDataFns.push(fn); try { fn(); } catch (err) { console.error(err); } },
    calc: (id, spec) => { calcs[id] = spec; },
    loader: (id, spec) => { loaders[id] = spec; },
    draw: (name, fn) => {
      if (fn === undefined) {
        document.querySelectorAll(`#dash-root [data-draw="${CSS.escape(name)}"]`).forEach((el) => runDraw(name, el));
        return;
      }
      draws.set(name, fn);
    },
    params: () => ({ ...params }),
    setParams: (next) => {
      const changed = Object.keys(next).filter((k) => params[k] !== next[k]);
      params = { ...params, ...next };
      for (const [id, def] of Object.entries(config.datasets)) if (usesParam(def, changed)) loadDataset(id, def);
      queueRender();
    },
    resetParams: () => window.dash.setParams({ ...defaults }),
    refresh: (id) => { if (config.datasets[id]) loadDataset(id, config.datasets[id]); },
    setLink: (name) => { if (name) history.replaceState(null, '', `${location.search}#${name}`); }
  };

  // Mounts the page's HTML, then runs its scripts in order, each in its own scope.
  function mountPage(root, html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const scripts = Array.from(tpl.content.querySelectorAll('script'));
    scripts.forEach((s) => s.remove());
    root.replaceChildren(tpl.content);
    for (const s of scripts) {
      const el = document.createElement('script');
      el.textContent = s.textContent;
      document.body.appendChild(el);
      el.remove();
    }
  }

  async function start() {
    const root = document.getElementById('dash-root');
    const name = new URLSearchParams(location.search).get('dashboard') || 'gifts-donations';
    if (!/^[\w-]+$/.test(name)) throw new Error('Bad dashboard name');
    const base = `/dashboards/${name}/`;
    const [cfgRes, pageRes] = await Promise.all([fetch(base + 'dashboard.json'), fetch(base + 'index.html')]);
    if (!cfgRes.ok || !pageRes.ok) {
      root.textContent = `Dashboard "${name}" not found.`;
      return;
    }
    config = await cfgRes.json();
    if (config.meta && config.meta.title) document.title = config.meta.title;
    defaults = { ...(config.params || {}) };
    params = { ...defaults };
    mountPage(root, await pageRes.text());
    for (const [id, def] of Object.entries(config.datasets || {})) loadDataset(id, def);
    let w = root.clientWidth;
    new ResizeObserver(() => { if (root.clientWidth !== w) { w = root.clientWidth; queueRender(); } }).observe(root);
    render();
  }

  window.addEventListener('DOMContentLoaded', () => {
    start().catch((err) => {
      console.error(err);
      document.getElementById('dash-root').textContent = `Couldn't start the dashboard: ${err.message}`;
    });
  });
})();
