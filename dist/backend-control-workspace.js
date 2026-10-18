(() => {
  'use strict';

  const SPEC_URL = '/hermes/openapi.json';
  const HERMES_BASE = '/hermes';
  const BRIDGE_BASE = '/hermes/api/plugins/judge-m-control-plane';
  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
  const TERMINAL_JOB_STATES = new Set(['completed', 'complete', 'succeeded', 'success', 'failed', 'error', 'cancelled', 'canceled', 'stopped', 'exited', 'timed_out']);
  const SECRET_KEY = /(?:password|passwd|secret|token|credential|authorization|cookie|api.?key|private.?key|client.?secret)/i;
  const SECRET_VALUE = /^(?:Bearer\s+|Basic\s+|sk-|sk_live_|ghp_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9+/_=.-]{8,}$/i;

  const DOMAIN_DEFINITIONS = [
    ['System & Health', 'monitor_heart', 'Status, services, actions, and host readiness.'],
    ['Profiles & Settings', 'manage_accounts', 'Profiles, configuration, environment, and identity.'],
    ['Models & Providers', 'model_training', 'Model catalogs, providers, routing, and local inference.'],
    ['Sessions & Chat', 'forum', 'Saved sessions, live chat services, and terminal sessions.'],
    ['Gateway & Connections', 'hub', 'Channels, messaging, connectors, Slack, and gateway services.'],
    ['Automations', 'schedule', 'Cron, hooks, webhooks, and scheduled activity.'],
    ['Tools & Skills', 'handyman', 'Tools, MCP servers, skills, plugins, and permissions.'],
    ['Memory & Tasks', 'psychology', 'Memory, learning, curator, journeys, and task boards.'],
    ['Voice & Media', 'mic', 'Speech, audio, uploads, files, and media processing.'],
    ['Browser & Computer Use', 'language', 'Browser sessions, screen services, and computer control.'],
    ['Projects & Development', 'code', 'Projects, repositories, worktrees, language servers, and runtimes.'],
    ['Security & Access', 'shield', 'Authentication, credentials, approvals, secrets, and egress.'],
    ['Backup & Recovery', 'restore', 'Backups, checkpoints, migration, repair, and recovery.'],
    ['Diagnostics & Insights', 'query_stats', 'Logs, usage, analytics, diagnostics, and operational reports.'],
    ['Access & App Shell', 'web', 'Login flows, browser entry points, and dashboard resources.'],
    ['Other', 'tune', 'Additional controls published by this Hermes installation.']
  ].map(([name, icon, description], order) => ({name, icon, description, order}));
  const DOMAIN_INDEX = new Map(DOMAIN_DEFINITIONS.map(item => [item.name, item]));

  const PATH_DOMAINS = {
    actions: 'System & Health', health: 'System & Health', status: 'System & Health', system: 'System & Health', host: 'System & Health', dashboard: 'System & Health', hermes: 'System & Health',
    config: 'Profiles & Settings', env: 'Profiles & Settings', profile: 'Profiles & Settings', profiles: 'Profiles & Settings', setup: 'Profiles & Settings', soul: 'Profiles & Settings', description: 'Profiles & Settings',
    model: 'Models & Providers', models: 'Models & Providers', providers: 'Models & Providers', provider: 'Models & Providers', portal: 'Models & Providers', 'local-models': 'Models & Providers', proxy: 'Models & Providers',
    session: 'Sessions & Chat', sessions: 'Sessions & Chat', chat: 'Sessions & Chat', pty: 'Sessions & Chat',
    gateway: 'Gateway & Connections', channel: 'Gateway & Connections', channels: 'Gateway & Connections', messaging: 'Gateway & Connections', whatsapp: 'Gateway & Connections', slack: 'Gateway & Connections', connectors: 'Gateway & Connections', send: 'Gateway & Connections',
    automation: 'Automations', automations: 'Automations', cron: 'Automations', hook: 'Automations', hooks: 'Automations', webhook: 'Automations', webhooks: 'Automations',
    tools: 'Tools & Skills', toolsets: 'Tools & Skills', skills: 'Tools & Skills', mcp: 'Tools & Skills', plugins: 'Tools & Skills', bundles: 'Tools & Skills',
    memory: 'Memory & Tasks', learning: 'Memory & Tasks', journey: 'Memory & Tasks', curator: 'Memory & Tasks', kanban: 'Memory & Tasks', pause: 'Memory & Tasks', resume: 'Memory & Tasks',
    audio: 'Voice & Media', voice: 'Voice & Media', tts: 'Voice & Media', stt: 'Voice & Media', media: 'Voice & Media', file: 'Voice & Media', files: 'Voice & Media', fs: 'Voice & Media',
    browser: 'Browser & Computer Use', computer: 'Browser & Computer Use', 'computer-use': 'Browser & Computer Use',
    project: 'Projects & Development', projects: 'Projects & Development', git: 'Projects & Development', worktree: 'Projects & Development', lsp: 'Projects & Development', runtime: 'Projects & Development', 'codex-runtime': 'Projects & Development', acp: 'Projects & Development', completion: 'Projects & Development', console: 'Projects & Development', desktop: 'Projects & Development', serve: 'Projects & Development',
    auth: 'Security & Access', credentials: 'Security & Access', approvals: 'Security & Access', pairing: 'Security & Access', secrets: 'Security & Access', vault: 'Security & Access', ssh: 'Security & Access', egress: 'Security & Access', verify: 'Security & Access', login: 'Security & Access',
    backup: 'Backup & Recovery', backups: 'Backup & Recovery', checkpoint: 'Backup & Recovery', checkpoints: 'Backup & Recovery', migrate: 'Backup & Recovery', claw: 'Backup & Recovery', 'import-agent': 'Backup & Recovery', uninstall: 'Backup & Recovery',
    analytics: 'Diagnostics & Insights', usage: 'Diagnostics & Insights', insights: 'Diagnostics & Insights', diagnostics: 'Diagnostics & Insights', doctor: 'Diagnostics & Insights', logs: 'Diagnostics & Insights', monitoring: 'Diagnostics & Insights', 'shared-metrics': 'Diagnostics & Insights'
  };

  const state = {
    spec: null,
    apiOperations: [],
    workflowOperations: [],
    operations: [],
    filtered: [],
    selectedId: '',
    domain: '',
    errors: {},
    loading: false,
    pending: null,
    jobTimer: null,
    bridgeCounts: null,
    browseAll: false
  };

  const $ = id => document.getElementById(id);
  const node = (tag, className = '', textValue) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textValue !== undefined) element.textContent = textValue;
    return element;
  };
  const icon = (name, className = '') => node('span', `material-symbols-outlined${className ? ` ${className}` : ''}`, name);
  const asText = (value, fallback = '') => {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  };
  const safeJSON = value => {
    try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
  };
  const prettyLabel = value => String(value || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[{}]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, character => character.toUpperCase())
    .replace(/\bApi\b/g, 'API')
    .replace(/\bMcp\b/g, 'MCP')
    .replace(/\bOauth\b/g, 'OAuth')
    .replace(/\bWs\b/g, 'WS')
    .replace(/\bCss\b/g, 'CSS')
    .replace(/\bSpa\b/g, 'SPA')
    .replace(/\bSsh\b/g, 'SSH')
    .replace(/\bEnv Vars\b/g, 'Environment Variables')
    .replace(/\bConfig Raw\b/g, 'Raw Configuration')
    .replace(/\bTts\b/g, 'TTS')
    .replace(/\bStt\b/g, 'STT')
    .trim();
  const cleanDescription = value => String(value || '')
    .replace(/``([^`]+)``/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s*\(GH(?:SA)?[^)]*\)\.?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const redact = (value, key = '') => {
    if (SECRET_KEY.test(String(key))) return '[redacted]';
    if (typeof File !== 'undefined' && value instanceof File) return `[File: ${value.name}, ${value.size} bytes]`;
    if (Array.isArray(value)) return value.map(item => redact(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
    if (typeof value === 'string' && SECRET_VALUE.test(value.trim())) return '[redacted]';
    return value;
  };
  const redactText = value => String(value || '')
    .replace(/((?:password|passwd|secret|token|credential|authorization|api[_-]?key|private[_-]?key|client[_-]?secret)["'\s:=]+)([^\s,}"']+)/gi, '$1[redacted]')
    .replace(/\b(?:Bearer\s+|Basic\s+|sk-|sk_live_|ghp_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9+/_=.-]{8,}\b/gi, '[redacted]');
  const redactUrl = value => {
    try {
      const url = new URL(value, location.origin);
      [...url.searchParams.keys()].forEach(key => { if (SECRET_KEY.test(key)) url.searchParams.set(key, '[redacted]'); });
      return `${url.pathname}${url.search}`;
    } catch (_) {
      return redactText(value);
    }
  };
  const errorMessage = (payload, response) => {
    if (payload && typeof payload === 'object') {
      const detail = payload.detail || payload.error || payload.message;
      if (Array.isArray(detail)) return detail.map(item => item.msg || asText(item)).join('; ');
      if (detail) return asText(detail);
    }
    return typeof payload === 'string' && payload ? redactText(payload) : `${response.status} ${response.statusText}`;
  };

  function domainDefinition(name) {
    return DOMAIN_INDEX.get(name) || DOMAIN_INDEX.get('Other');
  }

  function domainFromPath(path, tags = []) {
    if (!String(path).startsWith('/api')) return 'Access & App Shell';
    const segments = String(path).replace(/^\/api\/?/, '').split('/').filter(segment => segment && !segment.startsWith('{'));
    for (const segment of segments) {
      const match = PATH_DOMAINS[segment.toLowerCase()];
      if (match) return match;
    }
    for (const tag of tags) {
      const match = PATH_DOMAINS[String(tag).toLowerCase()];
      if (match) return match;
    }
    return 'Other';
  }

  function domainFromFamily(family) {
    return PATH_DOMAINS[String(family || '').toLowerCase()] || 'Other';
  }

  function resolveRef(ref) {
    if (!ref || !ref.startsWith('#/') || !state.spec) return null;
    return ref.slice(2).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((current, key) => current && current[key], state.spec);
  }

  function deref(schema, seen = new Set()) {
    if (!schema || typeof schema !== 'object') return schema || {};
    if (!schema.$ref) return schema;
    if (seen.has(schema.$ref)) return {type: 'object', title: schema.$ref.split('/').pop()};
    const target = resolveRef(schema.$ref);
    if (!target) return schema;
    const own = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref'));
    return {...deref(target, new Set([...seen, schema.$ref])), ...own};
  }

  function normalizeSchema(input) {
    let schema = deref(input || {});
    if (Array.isArray(schema.allOf)) {
      const merged = schema.allOf.map(item => normalizeSchema(item)).reduce((result, item) => ({
        ...result,
        ...item,
        properties: {...(result.properties || {}), ...(item.properties || {})},
        required: [...new Set([...(result.required || []), ...(item.required || [])])]
      }), {});
      const own = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'allOf'));
      schema = {...merged, ...own, properties: {...(merged.properties || {}), ...(own.properties || {})}, required: [...new Set([...(merged.required || []), ...(own.required || [])])]};
    }
    return schema;
  }

  function schemaVariants(schema) {
    const normalized = normalizeSchema(schema);
    const variants = normalized.oneOf || normalized.anyOf;
    if (!Array.isArray(variants)) return [];
    return variants
      .map(item => normalizeSchema(item))
      .filter(item => schemaType(item) !== 'null')
      .map((item, index) => ({schema: item, label: item.title || item.const || `Option ${index + 1}`}));
  }

  function schemaType(schema) {
    const normalized = normalizeSchema(schema);
    if (normalized.type) return Array.isArray(normalized.type) ? normalized.type.find(type => type !== 'null') || 'string' : normalized.type;
    if (normalized.properties || normalized.additionalProperties) return 'object';
    if (normalized.items) return 'array';
    if (normalized.enum && normalized.enum.length) return typeof normalized.enum[0];
    return 'string';
  }

  function schemaDefault(schema) {
    const normalized = normalizeSchema(schema);
    if (normalized.default !== undefined) return normalized.default;
    if (normalized.example !== undefined) return normalized.example;
    if (normalized.const !== undefined) return normalized.const;
    return undefined;
  }

  function friendlyApiLabel(operation) {
    const source = operation.summary || operation.operationId || operation.path.split('/').filter(Boolean).at(-1) || 'Hermes control';
    let cleaned = String(source)
      .replace(/^(get|list|fetch|post|put|patch)[\s_-]+/i, '')
      .replace(/_(get|post|put|patch|delete|head)$/i, '');
    cleaned = cleaned.replace(/^upsert[\s_-]+/i, 'Add or update ');
    if (!/custom[\s_-]+endpoint/i.test(cleaned)) cleaned = cleaned.replace(/[\s_-]+endpoint$/i, '');
    return prettyLabel(cleaned);
  }

  function apiKind(method, path) {
    if (!String(path).startsWith('/api')) return 'access';
    return ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'read' : 'change';
  }

  function operationIcon(operation) {
    if (operation.source === 'workflow') return 'construction';
    if (operation.kind === 'access') return 'open_in_browser';
    if (operation.method === 'DELETE') return 'delete';
    if (operation.kind === 'change') return 'tune';
    return 'visibility';
  }

  function iconTone(operation) {
    if (operation.source === 'workflow') return 'is-workflow';
    if (operation.method === 'DELETE' || operation.risk === 'high') return 'is-danger';
    if (operation.kind === 'change') return 'is-change';
    return '';
  }

  function operationSubtitle(operation) {
    if (!operation.available) return operation.unavailableReason || 'Unavailable on this installation';
    if (operation.source === 'workflow') return operation.longRunning ? 'Managed host workflow · may take a while' : operation.interactive ? 'Interactive host workflow' : 'Managed host workflow';
    if (operation.kind === 'access') return 'Browser access flow';
    if (operation.method === 'DELETE') return 'Removes or clears data';
    if (operation.kind === 'read') return 'View current information';
    return 'Change settings or run an action';
  }

  function collectApiOperations(spec) {
    const operations = [];
    Object.entries(spec.paths || {}).forEach(([path, pathItem]) => {
      if (!pathItem || typeof pathItem !== 'object') return;
      HTTP_METHODS.forEach(methodName => {
        const raw = pathItem[methodName];
        if (!raw || typeof raw !== 'object') return;
        const method = methodName.toUpperCase();
        const parameterMap = new Map();
        [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(raw.parameters) ? raw.parameters : [])]
          .map(parameter => deref(parameter))
          .forEach(parameter => parameterMap.set(`${parameter.in || ''}:${parameter.name || ''}`, parameter));
        const domain = domainFromPath(path, raw.tags || []);
        const description = cleanDescription(raw.description);
        const operation = {
          id: `api:${method}:${path}`,
          source: 'api',
          method,
          path,
          label: friendlyApiLabel({...raw, path}),
          description,
          domain,
          kind: apiKind(method, path),
          risk: method === 'DELETE' ? 'high' : ['POST', 'PUT', 'PATCH'].includes(method) ? 'medium' : 'low',
          available: true,
          operationId: raw.operationId || '',
          tags: raw.tags || [],
          parameters: [...parameterMap.values()],
          requestBody: deref(raw.requestBody),
          responses: raw.responses || {},
          raw
        };
        operation.search = [operation.label, description, path, operation.operationId, domain, ...(raw.tags || [])].join(' ').toLowerCase();
        operations.push(operation);
      });
    });
    return operations;
  }

  function normalizeWorkflow(raw) {
    const domain = domainFromFamily(raw.family);
    const description = cleanDescription(raw.description || raw.title);
    const operation = {
      id: `workflow:${raw.id}`,
      bridgeId: raw.id,
      source: 'workflow',
      label: raw.title && String(raw.title).includes(' ') ? String(raw.title).trim().replace(/\.$/, '') : prettyLabel(raw.title || raw.command || 'Host workflow'),
      description,
      domain,
      kind: 'workflow',
      risk: raw.risk || 'low',
      available: raw.availability !== false,
      unavailableReason: raw.unavailable_reason || '',
      family: raw.family || '',
      command: raw.command || '',
      coverage: raw.coverage || '',
      coverageLabel: raw.coverage_label || '',
      confirmation: raw.confirmation || '',
      interactive: Boolean(raw.interactive),
      longRunning: Boolean(raw.long_running),
      arguments: Array.isArray(raw.arguments) ? raw.arguments : [],
      positionals: Array.isArray(raw.positionals) ? raw.positionals : [],
      technical: raw.technical || {}
    };
    operation.search = [operation.label, description, operation.command, domain, operation.family, operation.coverageLabel].join(' ').toLowerCase();
    return operation;
  }

  function sortOperations(operations) {
    return [...operations].sort((left, right) => {
      const domainDelta = domainDefinition(left.domain).order - domainDefinition(right.domain).order;
      if (domainDelta) return domainDelta;
      if (left.source !== right.source) return left.source === 'api' ? -1 : 1;
      return left.label.localeCompare(right.label);
    });
  }

  function setStatus(mode, message) {
    $('schemaStatus').dataset.state = mode;
    $('schemaStatusText').textContent = message;
  }

  async function readResponse(response) {
    const text = await response.text();
    if (!text) return {payload: null, raw: '', contentType: response.headers.get('content-type') || ''};
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      try { return {payload: JSON.parse(text), raw: text, contentType}; } catch (_) { /* keep text */ }
    }
    try { return {payload: JSON.parse(text), raw: text, contentType}; } catch (_) { return {payload: redactText(text), raw: text, contentType}; }
  }

  async function loadInventories() {
    if (state.loading) return;
    state.loading = true;
    state.errors = {};
    $('reloadButton').disabled = true;
    setStatus('loading', 'Refreshing the live control map…');
    const [apiResult, bridgeResult] = await Promise.allSettled([
      fetch(SPEC_URL, {credentials: 'same-origin', headers: {Accept: 'application/json'}}).then(async response => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const spec = await response.json();
        if (!spec || typeof spec !== 'object' || !spec.paths) throw new Error('Hermes returned an invalid OpenAPI document.');
        return spec;
      }),
      fetch(`${BRIDGE_BASE}/cli-operations`, {credentials: 'same-origin', headers: {Accept: 'application/json'}}).then(async response => {
        const {payload} = await readResponse(response);
        if (!response.ok) throw new Error(errorMessage(payload, response));
        if (!payload || !Array.isArray(payload.operations)) throw new Error('The host workflow inventory is not valid.');
        return payload;
      })
    ]);

    if (apiResult.status === 'fulfilled') {
      state.spec = apiResult.value;
      state.apiOperations = collectApiOperations(apiResult.value);
    } else {
      state.spec = null;
      state.apiOperations = [];
      state.errors.api = apiResult.reason?.message || 'Native controls are unavailable.';
    }
    if (bridgeResult.status === 'fulfilled') {
      state.workflowOperations = bridgeResult.value.operations.map(normalizeWorkflow);
      state.bridgeCounts = bridgeResult.value.counts || null;
    } else {
      state.workflowOperations = [];
      state.bridgeCounts = null;
      state.errors.bridge = bridgeResult.reason?.message || 'Host workflows are unavailable.';
    }

    state.operations = sortOperations([...state.apiOperations, ...state.workflowOperations]);
    if (state.selectedId) {
      const linked = state.operations.find(item => item.id === state.selectedId);
      if (linked) state.domain = linked.domain;
    }
    updateCoverage();
    renderFilters();
    renderDomains();
    applyFilters();
    renderInventoryDiagnostics();
    const errorCount = Object.keys(state.errors).length;
    if (!state.operations.length) setStatus('error', 'Hermes controls are unavailable');
    else if (errorCount) setStatus('partial', `${state.operations.filter(item => item.available).length} capabilities available · one inventory needs attention`);
    else setStatus('ready', `${state.operations.filter(item => item.available).length} capabilities available`);
    if (state.selectedId) {
      const selected = state.operations.find(item => item.id === state.selectedId);
      if (selected) renderOperation(selected);
      else renderEmptyWorkspace();
    }
    state.loading = false;
    $('reloadButton').disabled = false;
  }

  function updateCoverage() {
    const domains = new Set(state.operations.map(item => item.domain));
    $('apiControlCount').textContent = String(state.apiOperations.length || 0);
    $('workflowCount').textContent = String(state.workflowOperations.length || 0);
    $('domainCount').textContent = String(domains.size || 0);
    $('availableCount').textContent = String(state.operations.filter(item => item.available).length || 0);
  }

  function renderInventoryDiagnostics() {
    const body = $('inventoryDiagnosticsBody');
    body.replaceChildren();
    const apiCard = node('div', `bc-diag-card${state.errors.api ? ' is-error' : ''}`);
    apiCard.append(node('strong', '', state.errors.api ? 'Native controls unavailable' : 'Native Hermes API'), node('span', '', state.errors.api || `${state.apiOperations.length} operations from schema ${state.spec?.info?.version || 'version not reported'}`));
    const bridgeCard = node('div', `bc-diag-card${state.errors.bridge ? ' is-error' : ''}`);
    bridgeCard.append(node('strong', '', state.errors.bridge ? 'Host workflows unavailable' : 'Reviewed host workflows'), node('span', '', state.errors.bridge || `${state.workflowOperations.length} registered · ${state.workflowOperations.filter(item => item.available).length} executable`));
    const coverageCard = node('div', 'bc-diag-card');
    coverageCard.append(node('strong', '', 'Coverage policy'), node('span', '', `${state.operations.length} total operations represented. Request paths and process arguments appear only inside each action's diagnostics.`));
    body.append(apiCard, bridgeCard, coverageCard);
  }

  function renderFilters() {
    const select = $('domainFilter');
    const selected = select.value || state.domain;
    const domains = [...new Set(state.operations.map(item => item.domain))].sort((left, right) => domainDefinition(left).order - domainDefinition(right).order);
    select.replaceChildren(new Option('All control areas', ''), ...domains.map(domain => new Option(domain, domain)));
    select.value = domains.includes(selected) ? selected : '';
    state.domain = select.value;
  }

  function renderDomains() {
    const container = $('domainGrid');
    container.replaceChildren();
    const counts = new Map();
    state.operations.forEach(operation => counts.set(operation.domain, (counts.get(operation.domain) || 0) + 1));
    if (!counts.size) {
      const empty = node('div', 'bc-loading-card');
      empty.append(icon('cloud_off'), node('span', '', 'No live Hermes capabilities are available. Open inventory diagnostics for details.'));
      container.append(empty);
      return;
    }
    DOMAIN_DEFINITIONS.filter(definition => counts.has(definition.name)).forEach(definition => {
      const button = node('button', 'bc-domain-card');
      button.type = 'button';
      button.dataset.selected = String(state.domain === definition.name);
      button.append(node('span', 'bc-domain-icon'));
      const iconWrap = button.firstElementChild;
      iconWrap.append(icon(definition.icon));
      button.append(node('strong', '', definition.name), node('p', '', definition.description));
      const footer = node('span', 'bc-domain-footer');
      footer.append(node('span', '', `${counts.get(definition.name)} capabilities`), icon('arrow_forward'));
      button.append(footer);
      button.addEventListener('click', () => {
        state.domain = definition.name;
        state.browseAll = false;
        $('domainFilter').value = definition.name;
        renderDomains();
        applyFilters();
        $('controlBrowser').scrollIntoView({behavior: 'smooth', block: 'start'});
      });
      container.append(button);
    });
  }

  function matchesKind(operation, kind) {
    if (!kind) return true;
    if (kind === 'workflow') return operation.source === 'workflow';
    if (kind === 'access') return operation.kind === 'access';
    return operation.source === 'api' && operation.kind === kind;
  }

  function applyFilters() {
    state.domain = $('domainFilter').value;
    const query = $('searchInput').value.trim().toLowerCase();
    const kind = $('kindFilter').value;
    const shouldBrowse = Boolean(state.domain || query || kind || state.browseAll);
    state.filtered = shouldBrowse ? state.operations.filter(operation => (!state.domain || operation.domain === state.domain) && (!query || operation.search.includes(query)) && matchesKind(operation, kind)) : [];
    renderActionList();
    renderDomains();
  }

  function renderActionList() {
    const container = $('operationList');
    container.replaceChildren();
    $('operationCount').textContent = `${state.filtered.length} / ${state.operations.length}`;
    $('listEyebrow').textContent = state.domain || ($('searchInput').value ? 'Search results' : 'All capabilities');
    $('listTitle').textContent = state.domain ? `Manage ${state.domain}` : 'Choose an action';
    if (!state.filtered.length) {
      const empty = node('div', 'bc-empty');
      if (!state.domain && !$('searchInput').value && !$('kindFilter').value && !state.browseAll) empty.append(icon('category'), node('strong', '', 'Choose a control area'), node('span', '', 'Pick an area above or search for what you want to manage. Use “Show every capability” when you need the complete inventory.'));
      else empty.append(icon('filter_alt_off'), node('strong', '', 'No matching capabilities'), node('span', '', 'Try a different phrase or clear one of the filters.'));
      container.append(empty);
      return;
    }
    const groups = new Map();
    state.filtered.forEach(operation => {
      const group = state.domain ? (operation.source === 'workflow' ? 'Host workflows' : operation.kind === 'access' ? 'Access flows' : operation.kind === 'read' ? 'Information & status' : 'Settings & actions') : operation.domain;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(operation);
    });
    groups.forEach((operations, label) => {
      const section = node('section', 'bc-action-group');
      const heading = node('div', 'bc-action-group-title');
      heading.append(node('span', '', label), node('span', '', String(operations.length)));
      section.append(heading);
      operations.forEach(operation => {
        const button = node('button', 'bc-action-card');
        button.type = 'button';
        button.setAttribute('aria-current', String(state.selectedId === operation.id));
        const iconWrap = node('span', `bc-action-icon ${iconTone(operation)}`.trim());
        iconWrap.append(icon(operationIcon(operation)));
        const copy = node('span', 'bc-action-copy');
        copy.append(node('strong', '', operation.label), node('span', '', operationSubtitle(operation)));
        button.append(iconWrap, copy, icon('chevron_right'));
        button.addEventListener('click', () => selectOperation(operation.id));
        section.append(button);
      });
      container.append(section);
    });
  }

  function selectOperation(id) {
    clearTimeout(state.jobTimer);
    state.selectedId = id;
    renderActionList();
    const operation = state.operations.find(item => item.id === id);
    if (!operation) return renderEmptyWorkspace();
    renderOperation(operation);
    history.replaceState(null, '', `#${encodeURIComponent(id)}`);
    if (matchMedia('(max-width: 1100px)').matches) $('operationWorkspace').scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  function renderEmptyWorkspace() {
    state.selectedId = '';
    const workspace = $('operationWorkspace');
    workspace.replaceChildren();
    const empty = node('div', 'bc-empty bc-empty-large');
    empty.append(icon('touch_app'), node('strong', '', 'Select a capability'), node('span', '', 'Every action here is connected to a real Hermes endpoint or reviewed host workflow.'));
    workspace.append(empty);
  }

  function badge(label, tone = '') {
    return node('span', `bc-badge${tone ? ` ${tone}` : ''}`, label);
  }

  function operationHeader(operation) {
    const header = node('header', 'bc-control-header');
    const iconWrap = node('span', `bc-action-icon ${iconTone(operation)}`.trim());
    iconWrap.append(icon(operationIcon(operation)));
    const title = node('div', 'bc-control-title');
    title.append(node('span', 'bc-eyebrow', operation.domain), node('h2', '', operation.label));
    title.append(node('p', '', operation.description || operationSubtitle(operation)));
    const badges = node('div', 'bc-badges');
    badges.append(badge(operation.source === 'workflow' ? 'Host workflow' : operation.kind === 'access' ? 'Access flow' : operation.kind === 'read' ? 'Live information' : 'Native control', operation.source === 'workflow' ? 'is-purple' : ''));
    badges.append(badge(operation.available ? 'Available' : 'Unavailable', operation.available ? 'is-good' : 'is-danger'));
    if (operation.risk === 'high') badges.append(badge('Confirmation required', 'is-danger'));
    else if (operation.risk === 'medium') badges.append(badge('Changes Hermes', 'is-warning'));
    if (operation.longRunning) badges.append(badge('Long-running'));
    if (operation.interactive) badges.append(badge('Interactive'));
    title.append(badges);
    const close = node('button', 'bc-icon-button');
    close.type = 'button';
    close.title = 'Close action';
    close.append(icon('close'));
    close.addEventListener('click', () => {
      history.replaceState(null, '', location.pathname + location.search);
      renderEmptyWorkspace();
      renderActionList();
    });
    header.append(iconWrap, title, close);
    return header;
  }

  function renderOperation(operation) {
    const workspace = $('operationWorkspace');
    workspace.replaceChildren();
    const form = node('form', 'bc-form');
    form.id = 'controlForm';
    form.noValidate = false;
    form.append(operationHeader(operation));
    if (!operation.available) {
      form.append(callout(operation.unavailableReason || 'This capability is published by Hermes but is not available on this installation.', 'error'));
    }
    if (operation.source === 'workflow') renderWorkflowForm(operation, form);
    else renderApiForm(operation, form);
    workspace.append(form);
  }

  function callout(message, tone = '') {
    const box = node('div', `bc-callout${tone ? ` is-${tone}` : ''}`);
    box.append(icon(tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : 'info'), node('span', '', message));
    return box;
  }

  function sectionHeading(title, note = '') {
    const heading = node('div', 'bc-form-heading');
    heading.append(node('h3', '', title));
    if (note) heading.append(node('span', '', note));
    return heading;
  }

  function fieldId(prefix, path) {
    return `${prefix}-${path.map(value => String(value).replace(/[^a-zA-Z0-9_-]/g, '-')).join('-')}`;
  }

  function labelRow(label, required, type) {
    const row = node('span', 'bc-label-row');
    const title = node('span', '');
    title.append(document.createTextNode(label));
    if (required) title.append(node('span', 'bc-required', ' *'));
    row.append(title, node('span', 'bc-field-type', type));
    return row;
  }

  function attachFieldData(input, context, schema, path) {
    input.dataset.location = context.location;
    input.dataset.fieldPath = JSON.stringify(path);
    input.dataset.schema = JSON.stringify(schema);
    input.dataset.required = String(Boolean(context.required));
    return input;
  }

  function renderPrimitiveField(name, schema, context) {
    schema = normalizeSchema(schema);
    const type = schemaType(schema);
    const path = context.path;
    const required = Boolean(context.required);
    const id = fieldId(context.prefix, path);
    const wrap = node('label', `bc-field${['array', 'object'].includes(type) || schema.format === 'multiline' || (schema.maxLength || 0) > 180 ? ' is-full' : ''}`);
    wrap.append(labelRow(prettyLabel(schema.title || name), required, schema.format || type));
    const defaultValue = schemaDefault(schema);
    const enumChoices = schema.enum;
    const booleanToggle = type === 'boolean' && (!enumChoices || enumChoices.every(value => typeof value === 'boolean')) && (required || defaultValue !== undefined);
    const choices = enumChoices || (type === 'boolean' ? [true, false] : null);
    let input;
    if (booleanToggle) {
      input = node('input');
      input.type = 'checkbox';
      input.checked = defaultValue === true;
      input.id = id;
      input.name = name;
      attachFieldData(input, context, schema, path);
      const check = node('span', 'bc-checkbox');
      check.append(input, node('span', '', schema.title || `Enable ${prettyLabel(name)}`));
      wrap.append(check);
      if (schema.description) wrap.append(node('p', 'bc-field-help', cleanDescription(schema.description)));
      return wrap;
    } else if (choices) {
      input = node('select', 'bc-select');
      if (!required) input.append(new Option('Use Hermes default', ''));
      choices.forEach(choice => input.append(new Option(asText(choice), JSON.stringify(choice))));
      if (defaultValue !== undefined) input.value = JSON.stringify(defaultValue);
    } else if (type === 'integer' || type === 'number') {
      input = node('input', 'bc-input');
      input.type = 'number';
      input.step = type === 'integer' ? '1' : 'any';
      if (schema.minimum !== undefined) input.min = String(schema.minimum);
      if (schema.maximum !== undefined) input.max = String(schema.maximum);
      const value = schemaDefault(schema);
      if (value !== undefined) input.value = String(value);
    } else if (type === 'array') {
      input = node('textarea', 'bc-textarea');
      input.dataset.valueMode = 'lines';
      input.rows = 4;
      input.placeholder = 'One value per line';
      const value = schemaDefault(schema);
      if (Array.isArray(value)) input.value = value.join('\n');
    } else {
      const multiline = schema.format === 'multiline' || schema.format === 'textarea' || (schema.maxLength || 0) > 180;
      input = multiline ? node('textarea', 'bc-textarea') : node('input', 'bc-input');
      if (multiline) input.rows = 5;
      else if (schema.format === 'binary') input.type = 'file';
      else if (schema.format === 'password' || SECRET_KEY.test(name)) input.type = 'password';
      else if (schema.format === 'email') input.type = 'email';
      else if (schema.format === 'uri' || schema.format === 'url') input.type = 'url';
      else if (schema.format === 'date') input.type = 'date';
      else if (schema.format === 'date-time') input.type = 'datetime-local';
      else input.type = 'text';
      const value = schemaDefault(schema);
      if (value !== undefined && input.type !== 'file') input.value = asText(value);
      if (schema.pattern) input.pattern = schema.pattern;
      if (schema.minLength !== undefined) input.minLength = schema.minLength;
      if (schema.maxLength !== undefined) input.maxLength = schema.maxLength;
    }
    input.id = id;
    input.name = name;
    input.required = required;
    input.autocomplete = SECRET_KEY.test(name) ? 'new-password' : 'off';
    attachFieldData(input, context, schema, path);
    wrap.append(input);
    if (schema.description) wrap.append(node('p', 'bc-field-help', cleanDescription(schema.description)));
    return wrap;
  }

  function renderMapField(name, schema, context) {
    const wrap = node('div', 'bc-field is-full');
    wrap.append(labelRow(prettyLabel(schema.title || name), Boolean(context.required), 'key-value list'));
    const map = node('div', 'bc-map');
    map.dataset.mapField = 'true';
    map.dataset.location = context.location;
    map.dataset.fieldPath = JSON.stringify(context.path);
    map.dataset.required = String(Boolean(context.required));
    map.dataset.valueSchema = JSON.stringify(normalizeSchema(schema.additionalProperties === true ? {} : schema.additionalProperties || {}));
    const addRow = (key = '', value = '') => {
      const row = node('div', 'bc-map-row');
      const keyInput = node('input', 'bc-input');
      keyInput.type = 'text';
      keyInput.placeholder = 'Name';
      keyInput.value = key;
      const valueInput = node('input', 'bc-input');
      valueInput.type = SECRET_KEY.test(key) ? 'password' : 'text';
      valueInput.placeholder = 'Value';
      valueInput.value = asText(value);
      keyInput.addEventListener('input', () => { valueInput.type = SECRET_KEY.test(keyInput.value) ? 'password' : 'text'; });
      const remove = node('button', 'bc-icon-button');
      remove.type = 'button';
      remove.title = 'Remove row';
      remove.append(icon('delete'));
      remove.addEventListener('click', () => row.remove());
      row.append(keyInput, valueInput, remove);
      map.append(row);
    };
    const initial = schemaDefault(schema);
    if (initial && typeof initial === 'object' && !Array.isArray(initial)) Object.entries(initial).forEach(([key, value]) => addRow(key, value));
    if (!map.children.length) addRow();
    const add = node('button', 'bc-button bc-button-ghost bc-inline-action');
    add.type = 'button';
    add.append(icon('add'), node('span', '', 'Add value'));
    add.addEventListener('click', () => addRow());
    wrap.append(map, add);
    if (schema.description) wrap.append(node('p', 'bc-field-help', cleanDescription(schema.description)));
    return wrap;
  }

  function reindexCollection(collection, basePath) {
    [...collection.children].forEach((item, index) => {
      item.dataset.itemIndex = String(index);
      item.querySelectorAll('[data-field-path], [data-map-field]').forEach(field => {
        const attribute = field.dataset.fieldPath;
        if (!attribute) return;
        const path = JSON.parse(attribute);
        path[basePath.length] = index;
        field.dataset.fieldPath = JSON.stringify(path);
      });
    });
  }

  function renderObjectArrayField(name, schema, context) {
    const wrap = node('div', 'bc-field is-full');
    wrap.append(labelRow(prettyLabel(schema.title || name), Boolean(context.required), 'list'));
    const collection = node('div', 'bc-collection');
    const itemSchema = normalizeSchema(schema.items || {});
    const basePath = context.path;
    const addItem = initial => {
      const item = node('div', 'bc-collection-item');
      const remove = node('button', 'bc-icon-button');
      remove.type = 'button';
      remove.title = 'Remove item';
      remove.append(icon('delete'));
      remove.addEventListener('click', () => { item.remove(); reindexCollection(collection, basePath); });
      const index = collection.children.length;
      const grid = node('div', 'bc-field-grid');
      grid.append(renderSchemaFields(itemSchema, {...context, path: [...basePath, index], required: true, initial}));
      item.append(remove, grid);
      collection.append(item);
    };
    const defaults = schemaDefault(schema);
    if (Array.isArray(defaults)) defaults.forEach(addItem);
    if (!collection.children.length && context.required) addItem();
    const add = node('button', 'bc-button bc-button-ghost bc-inline-action');
    add.type = 'button';
    add.append(icon('add'), node('span', '', 'Add item'));
    add.addEventListener('click', () => addItem());
    wrap.append(collection, add);
    if (schema.description) wrap.append(node('p', 'bc-field-help', cleanDescription(schema.description)));
    return wrap;
  }

  function renderSchemaFields(schema, context) {
    schema = normalizeSchema(schema);
    const fragment = document.createDocumentFragment();
    const variants = schemaVariants(schema);
    if (variants.length > 1) {
      const tabs = node('div', 'bc-variant-tabs');
      const host = node('div', 'bc-fieldset');
      const renderVariant = index => {
        [...tabs.children].forEach((button, buttonIndex) => button.setAttribute('aria-pressed', String(buttonIndex === index)));
        host.replaceChildren(renderSchemaFields(variants[index].schema, context));
      };
      variants.forEach((variant, index) => {
        const button = node('button', '', prettyLabel(variant.label));
        button.type = 'button';
        button.setAttribute('aria-pressed', String(index === 0));
        button.addEventListener('click', () => renderVariant(index));
        tabs.append(button);
      });
      fragment.append(tabs, host);
      renderVariant(0);
      return fragment;
    }
    if (variants.length === 1) schema = variants[0].schema;
    const type = schemaType(schema);
    if (type === 'object' && schema.properties && Object.keys(schema.properties).length) {
      const requiredFields = new Set(schema.required || []);
      Object.entries(schema.properties).forEach(([name, child]) => {
        const childSchema = normalizeSchema(child);
        if (childSchema.readOnly) return;
        const childContext = {...context, path: [...context.path, name], required: requiredFields.has(name)};
        const childType = schemaType(childSchema);
        if (childType === 'object' && childSchema.properties) {
          const fieldset = node('fieldset', 'bc-fieldset');
          fieldset.append(node('legend', '', prettyLabel(childSchema.title || name)));
          const grid = node('div', 'bc-field-grid');
          grid.append(renderSchemaFields(childSchema, childContext));
          fieldset.append(grid);
          fragment.append(fieldset);
        } else if (childType === 'object' && childSchema.additionalProperties) fragment.append(renderMapField(name, childSchema, childContext));
        else if (childType === 'array' && schemaType(normalizeSchema(childSchema.items || {})) === 'object') fragment.append(renderObjectArrayField(name, childSchema, childContext));
        else fragment.append(renderPrimitiveField(name, childSchema, childContext));
      });
      return fragment;
    }
    if (type === 'object' && schema.additionalProperties) return renderMapField(context.path.at(-1) || 'values', schema, context);
    if (type === 'array' && schemaType(normalizeSchema(schema.items || {})) === 'object') return renderObjectArrayField(context.path.at(-1) || 'items', schema, context);
    fragment.append(renderPrimitiveField(context.path.at(-1) || 'value', schema, context));
    return fragment;
  }

  function renderParameter(parameter, index) {
    const name = parameter.name || `option_${index + 1}`;
    const location = parameter.in || 'query';
    const schema = normalizeSchema(parameter.schema || {});
    const context = {location, prefix: `parameter-${index}`, path: [name], required: Boolean(parameter.required || location === 'path')};
    const field = renderPrimitiveField(name, schema, context);
    const input = field.querySelector('[data-field-path]');
    if (input) {
      input.dataset.parameterName = name;
      input.dataset.parameterStyle = parameter.style || (location === 'path' ? 'simple' : 'form');
      input.dataset.parameterExplode = String(parameter.explode === undefined ? (parameter.style || 'form') === 'form' : Boolean(parameter.explode));
      if (parameter.example !== undefined && !input.value) input.value = typeof parameter.example === 'object' ? safeJSON(parameter.example) : String(parameter.example);
    }
    return field;
  }

  function requestBodyContent(operation) {
    const content = operation.requestBody?.content;
    if (!content || typeof content !== 'object') return null;
    const preferred = ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
    const type = preferred.find(item => content[item]) || Object.keys(content)[0];
    return type ? {type, media: content[type], required: Boolean(operation.requestBody.required)} : null;
  }

  function renderApiForm(operation, form) {
    if (operation.kind === 'access') form.append(callout('This is part of the real browser access flow. Read-only access routes open in a new tab; sign-out and token exchanges run in this authenticated session.'));
    if (operation.method === 'DELETE') form.append(callout('This action permanently removes or clears data. Cockpit will require an explicit confirmation before it runs.', 'warning'));
    const parameters = operation.parameters.filter(parameter => ['path', 'query', 'header', 'cookie'].includes(parameter.in));
    if (parameters.length) {
      const section = node('section', 'bc-form-section');
      section.append(sectionHeading('Options', parameters.some(parameter => parameter.required) ? '* required' : 'optional'));
      const grid = node('div', 'bc-field-grid');
      parameters.forEach((parameter, index) => grid.append(renderParameter(parameter, index)));
      section.append(grid);
      form.append(section);
    }
    const body = requestBodyContent(operation);
    if (body) {
      const schema = normalizeSchema(body.media.schema || {});
      const section = node('section', 'bc-form-section');
      section.dataset.bodyContentType = body.type;
      section.dataset.bodyRequired = String(body.required);
      section.dataset.bodySchemaType = schemaType(schema);
      section.append(sectionHeading('Values', body.required ? 'required' : 'optional'));
      const grid = node('div', 'bc-field-grid');
      grid.append(renderSchemaFields(schema, {location: 'body', prefix: 'body', path: [], required: body.required}));
      section.append(grid);
      form.append(section);
    }
    if (!parameters.length && !body) form.append(callout(operation.kind === 'read' ? 'No choices are needed. Hermes will load the current information.' : 'No additional values are required for this action.'));
    const actions = node('div', 'bc-form-actions');
    const reset = node('button', 'bc-button bc-button-ghost');
    reset.type = 'button';
    reset.append(icon('restart_alt'), node('span', '', 'Reset'));
    reset.addEventListener('click', () => renderOperation(operation));
    const submit = node('button', `bc-button ${operation.method === 'DELETE' ? 'bc-button-danger' : 'bc-button-primary'}`);
    submit.type = 'submit';
    submit.disabled = !operation.available;
    const submitLabel = operation.kind === 'access' && ['GET', 'HEAD'].includes(operation.method) ? 'Open access flow' : operation.kind === 'read' ? 'Load information' : operation.method === 'DELETE' ? 'Review removal' : 'Review & apply';
    submit.append(icon(operation.kind === 'read' ? 'refresh' : operation.kind === 'access' ? 'open_in_new' : operation.method === 'DELETE' ? 'delete' : 'arrow_forward'), node('span', '', submitLabel));
    actions.append(reset, submit);
    form.append(actions, apiTechnicalDetails(operation));
    form.addEventListener('submit', event => {
      event.preventDefault();
      clearInlineMessages(form);
      if (!form.reportValidity()) return;
      let request;
      try { request = buildApiRequest(operation, form); } catch (error) { return showInlineError(form, error.message); }
      if (operation.kind === 'access' && ['GET', 'HEAD'].includes(operation.method)) return openAccessFlow(operation, request, form);
      if (operation.kind === 'read') executeApiRequest(operation, request, form);
      else openConfirmation(operation, request, () => executeApiRequest(operation, request, form));
    });
  }

  function apiTechnicalDetails(operation) {
    const details = node('details', 'bc-technical');
    const summary = node('summary');
    summary.append(icon('code'), node('span', '', 'Request diagnostics'));
    const responses = Object.entries(operation.responses || {}).map(([status, response]) => `${status}: ${deref(response)?.description || 'Response'}`).join('\n');
    details.append(summary, node('pre', 'bc-scroll', [`${operation.method} ${operation.path}`, operation.operationId ? `Operation: ${operation.operationId}` : '', responses ? `Expected responses:\n${responses}` : ''].filter(Boolean).join('\n')));
    return details;
  }

  function parseScalar(raw, schema, label) {
    const type = schemaType(schema);
    if (type === 'integer') {
      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value)) throw new Error(`${label} must be a whole number.`);
      return value;
    }
    if (type === 'number') {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${label} must be a number.`);
      return value;
    }
    if (type === 'boolean') {
      if (raw === 'true' || raw === 'false') return raw === 'true';
      throw new Error(`${label} must be true or false.`);
    }
    return raw;
  }

  function parseField(input) {
    const schema = normalizeSchema(JSON.parse(input.dataset.schema || '{}'));
    const required = input.dataset.required === 'true';
    const label = prettyLabel(input.name || 'This field');
    if (input.type === 'checkbox') return input.checked;
    if (input.type === 'file') {
      const files = [...input.files];
      if (required && !files.length) throw new Error(`${label} is required.`);
      return input.multiple ? files : files[0];
    }
    if (input.multiple && input.tagName === 'SELECT') {
      const values = [...input.selectedOptions].map(option => option.value);
      if (required && !values.length) throw new Error(`${label} is required.`);
      return values.map(value => parseScalar(value, normalizeSchema(schema.items || {}), label));
    }
    const raw = input.value.trim();
    if (!raw) {
      if (required) throw new Error(`${label} is required.`);
      return undefined;
    }
    if (input.dataset.valueMode === 'lines') return raw.split(/\r?\n|,/).map(value => value.trim()).filter(Boolean).map(value => parseScalar(value, normalizeSchema(schema.items || {}), label));
    if (input.tagName === 'SELECT' && schema.enum) {
      try { return JSON.parse(raw); } catch (_) { return raw; }
    }
    return parseScalar(raw, schema, label);
  }

  function parseMap(map) {
    const required = map.dataset.required === 'true';
    const valueSchema = normalizeSchema(JSON.parse(map.dataset.valueSchema || '{}'));
    const value = {};
    map.querySelectorAll('.bc-map-row').forEach(row => {
      const inputs = row.querySelectorAll('input');
      const key = inputs[0].value.trim();
      const raw = inputs[1].value.trim();
      if (!key && !raw) return;
      if (!key) throw new Error('Every custom value needs a name.');
      if (!raw) throw new Error(`${prettyLabel(key)} needs a value.`);
      value[key] = parseScalar(raw, valueSchema, prettyLabel(key));
    });
    if (required && !Object.keys(value).length) throw new Error('Add at least one value.');
    return Object.keys(value).length ? value : undefined;
  }

  function setDeep(target, path, value) {
    if (!path.length) return value;
    let current = target;
    path.forEach((segment, index) => {
      if (index === path.length - 1) current[segment] = value;
      else {
        const nextIsIndex = typeof path[index + 1] === 'number';
        if (current[segment] === undefined || current[segment] === null) current[segment] = nextIsIndex ? [] : {};
        current = current[segment];
      }
    });
    return target;
  }

  function serializeQuery(search, name, value, explode, style = 'form') {
    if (Array.isArray(value)) {
      if (style === 'spaceDelimited') search.append(name, value.join(' '));
      else if (style === 'pipeDelimited') search.append(name, value.join('|'));
      else if (explode) value.forEach(item => search.append(name, String(item)));
      else search.append(name, value.join(','));
    } else if (value && typeof value === 'object') {
      if (style === 'deepObject') Object.entries(value).forEach(([key, item]) => search.append(`${name}[${key}]`, String(item)));
      else if (explode) Object.entries(value).forEach(([key, item]) => search.append(key, String(item)));
      else search.append(name, Object.entries(value).flat().join(','));
    } else search.append(name, String(value));
  }

  function serializePath(name, value, style = 'simple', explode = false) {
    const encode = item => encodeURIComponent(String(item));
    const array = Array.isArray(value) ? value : null;
    const object = !array && value && typeof value === 'object' ? value : null;
    if (style === 'label') {
      if (array) return `.${array.map(encode).join(explode ? '.' : ',')}`;
      if (object) return `.${Object.entries(object).map(([key, item]) => explode ? `${encode(key)}=${encode(item)}` : `${encode(key)},${encode(item)}`).join(explode ? '.' : ',')}`;
      return `.${encode(value)}`;
    }
    if (style === 'matrix') {
      if (array) return explode ? array.map(item => `;${encode(name)}=${encode(item)}`).join('') : `;${encode(name)}=${array.map(encode).join(',')}`;
      if (object) return explode ? Object.entries(object).map(([key, item]) => `;${encode(key)}=${encode(item)}`).join('') : `;${encode(name)}=${Object.entries(object).flatMap(([key, item]) => [encode(key), encode(item)]).join(',')}`;
      return `;${encode(name)}=${encode(value)}`;
    }
    if (array) return array.map(encode).join(',');
    if (object) return Object.entries(object).map(([key, item]) => explode ? `${encode(key)}=${encode(item)}` : `${encode(key)},${encode(item)}`).join(',');
    return encode(value);
  }

  function buildApiRequest(operation, form) {
    let path = operation.path;
    const search = new URLSearchParams();
    const bodySection = form.querySelector('[data-body-content-type]');
    let bodyValue = bodySection?.dataset.bodySchemaType === 'array' ? [] : {};
    let hasBody = false;
    const headers = {Accept: 'application/json, text/plain;q=0.9, */*;q=0.8'};
    const cookies = [];
    form.querySelectorAll('[data-field-path]').forEach(input => {
      if (input.disabled) return;
      const value = parseField(input);
      if (value === undefined) return;
      const location = input.dataset.location;
      const fieldPath = JSON.parse(input.dataset.fieldPath || '[]');
      if (location === 'body') {
        bodyValue = setDeep(bodyValue, fieldPath, value);
        hasBody = true;
        return;
      }
      const name = input.dataset.parameterName || input.name;
      const style = input.dataset.parameterStyle;
      const explode = input.dataset.parameterExplode !== 'false';
      if (location === 'path') path = path.replace(`{${name}}`, serializePath(name, value, style, explode));
      else if (location === 'query') serializeQuery(search, name, value, explode, style);
      else if (location === 'header') headers[name] = Array.isArray(value) ? value.join(',') : String(value);
      else if (location === 'cookie') cookies.push([name, value]);
    });
    form.querySelectorAll('[data-map-field]').forEach(map => {
      const value = parseMap(map);
      if (value === undefined) return;
      const location = map.dataset.location;
      const fieldPath = JSON.parse(map.dataset.fieldPath || '[]');
      if (location === 'body') {
        bodyValue = setDeep(bodyValue, fieldPath, value);
        hasBody = true;
      }
    });
    const unresolved = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
    if (unresolved.length) throw new Error(`Complete the required ${prettyLabel(unresolved[0])} field.`);
    cookies.forEach(([name, value]) => { document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}; Path=/; SameSite=Lax; Secure`; });
    const query = search.toString();
    const url = `${HERMES_BASE}${path}${query ? `?${query}` : ''}`;
    const contentType = bodySection?.dataset.bodyContentType || '';
    let body;
    if (bodySection && (hasBody || bodySection.dataset.bodyRequired === 'true')) {
      if (contentType === 'application/json' || contentType.endsWith('+json')) {
        headers['Content-Type'] = contentType;
        body = JSON.stringify(bodyValue);
      } else if (contentType === 'application/x-www-form-urlencoded') {
        headers['Content-Type'] = contentType;
        const params = new URLSearchParams();
        Object.entries(bodyValue || {}).forEach(([key, value]) => serializeQuery(params, key, value, true));
        body = params.toString();
      } else if (contentType === 'multipart/form-data') {
        const data = new FormData();
        Object.entries(bodyValue || {}).forEach(([key, value]) => {
          if (typeof File !== 'undefined' && value instanceof File) data.append(key, value, value.name);
          else if (Array.isArray(value) && value.every(item => typeof File !== 'undefined' && item instanceof File)) value.forEach(file => data.append(key, file, file.name));
          else data.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        });
        body = data;
      } else {
        headers['Content-Type'] = contentType || 'text/plain';
        body = typeof bodyValue === 'string' ? bodyValue : Object.keys(bodyValue || {}).length === 1 && bodyValue.value !== undefined ? String(bodyValue.value) : JSON.stringify(bodyValue);
      }
    }
    return {method: operation.method, url, headers, body, bodyValue: body === undefined ? undefined : bodyValue, contentType};
  }

  function openAccessFlow(operation, request, form) {
    const opened = window.open('', '_blank');
    if (opened) {
      opened.opener = null;
      opened.location.href = request.url;
    }
    if (!opened) showInlineError(form, 'The browser blocked the new tab. Allow pop-ups for this Cockpit and try again.');
    else renderMessageResult(form, true, 'Access flow opened', 'The requested Hermes page or browser flow opened in a new tab.');
  }

  function clearInlineMessages(form) {
    form.querySelectorAll('.bc-inline-message, .bc-result').forEach(element => element.remove());
  }

  function showInlineError(form, message) {
    form.querySelector('.bc-inline-message')?.remove();
    const error = callout(message, 'error');
    error.classList.add('bc-inline-message');
    const actions = form.querySelector('.bc-form-actions');
    if (actions) actions.before(error); else form.append(error);
    error.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  }

  function setSubmitBusy(form, busy) {
    const submit = form.querySelector('[type="submit"]');
    if (!submit) return;
    if (busy) {
      submit.dataset.label = submit.innerHTML;
      submit.disabled = true;
      submit.replaceChildren(icon('progress_activity'), node('span', '', 'Working…'));
    } else {
      submit.disabled = false;
      if (submit.dataset.label) submit.innerHTML = submit.dataset.label;
    }
  }

  async function executeApiRequest(operation, request, form) {
    clearInlineMessages(form);
    setSubmitBusy(form, true);
    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(request.url, {method: request.method, headers: request.headers, body: request.body, credentials: 'same-origin', signal: controller.signal});
      const result = await readResponse(response);
      const elapsed = Math.round(performance.now() - started);
      if (!response.ok) renderResponse(form, {ok: false, title: 'Hermes could not complete the action', payload: {error: errorMessage(result.payload, response)}, elapsed, technical: {status: response.status, statusText: response.statusText, contentType: result.contentType, response: redact(result.payload)}});
      else {
        const payload = result.contentType.includes('text/html') ? {message: 'Hermes returned the requested page successfully.'} : result.payload ?? {message: 'Hermes completed the action successfully.'};
        renderResponse(form, {ok: true, title: operation.kind === 'read' ? 'Current information loaded' : 'Action completed', payload, elapsed, technical: {status: response.status, statusText: response.statusText, contentType: result.contentType, response: redact(result.payload)}});
      }
    } catch (error) {
      renderResponse(form, {ok: false, title: 'Hermes could not be reached', payload: {error: error.name === 'AbortError' ? 'Hermes did not respond within 45 seconds.' : error.message}, elapsed: Math.round(performance.now() - started), technical: {error: error.message}});
    } finally {
      clearTimeout(timeout);
      setSubmitBusy(form, false);
    }
  }

  function renderWorkflowField(item, bucket) {
    const name = item.name || 'value';
    const wrap = node('label', `bc-field${item.multiple ? ' is-full' : ''}`);
    wrap.append(labelRow(item.label || prettyLabel(name), Boolean(item.required), item.kind || 'text'));
    let input;
    if (item.kind === 'boolean') {
      input = node('input');
      input.type = 'checkbox';
      input.checked = item.default === true;
      const check = node('span', 'bc-checkbox');
      check.append(input, node('span', '', item.label || prettyLabel(name)));
      wrap.append(check);
    } else if (Array.isArray(item.choices) && item.choices.length) {
      input = node('select', 'bc-select');
      if (!item.required) input.append(new Option('Use Hermes default', ''));
      item.choices.forEach(choice => input.append(new Option(asText(choice), asText(choice))));
      if (item.default !== null && item.default !== undefined) input.value = asText(item.default);
      wrap.append(input);
    } else if (item.multiple) {
      input = node('textarea', 'bc-textarea');
      input.rows = 4;
      input.placeholder = 'One value per line';
      input.dataset.valueMode = 'lines';
      if (Array.isArray(item.default)) input.value = item.default.join('\n');
      wrap.append(input);
    } else {
      input = node('input', 'bc-input');
      input.type = item.kind === 'secret' ? 'password' : ['integer', 'number'].includes(item.kind) ? 'number' : 'text';
      if (item.kind === 'integer') input.step = '1';
      if (item.kind === 'number') input.step = 'any';
      if (item.default !== null && item.default !== undefined && item.kind !== 'secret') input.value = asText(item.default);
      input.autocomplete = item.kind === 'secret' ? 'new-password' : 'off';
      wrap.append(input);
    }
    input.name = name;
    input.required = Boolean(item.required);
    input.dataset.workflowBucket = bucket;
    input.dataset.workflowName = name;
    input.dataset.workflowKind = item.kind || 'text';
    input.dataset.workflowMultiple = String(Boolean(item.multiple));
    if (item.help) wrap.append(node('p', 'bc-field-help', cleanDescription(item.help)));
    return wrap;
  }

  function readWorkflowField(input) {
    if (input.type === 'checkbox') return input.checked;
    const raw = input.value.trim();
    if (!raw) return undefined;
    if (input.dataset.workflowMultiple === 'true') return raw.split(/\r?\n|,/).map(value => value.trim()).filter(Boolean);
    if (input.dataset.workflowKind === 'integer') return Number.parseInt(raw, 10);
    if (input.dataset.workflowKind === 'number') return Number(raw);
    return raw;
  }

  function renderWorkflowForm(operation, form) {
    form.append(callout('This reviewed workflow runs through Hermes without a shell. Cockpit validates each supported option and keeps process details inside diagnostics.'));
    if (operation.interactive) form.append(callout('This workflow may ask for input after it starts. A private response field will appear with the live result.', 'warning'));
    const section = node('section', 'bc-form-section');
    section.append(sectionHeading('Workflow options', operation.arguments.length + operation.positionals.length ? '* required where marked' : 'no additional values required'));
    const grid = node('div', 'bc-field-grid');
    const profile = node('label', 'bc-field');
    profile.append(labelRow('Profile', false, 'optional'), node('input', 'bc-input'), node('p', 'bc-field-help', 'Leave blank to use the default profile.'));
    const profileInput = profile.querySelector('input');
    profileInput.name = 'workflow_profile';
    profileInput.autocomplete = 'off';
    grid.append(profile);
    operation.positionals.forEach(item => grid.append(renderWorkflowField(item, 'positionals')));
    operation.arguments.forEach(item => grid.append(renderWorkflowField(item, 'arguments')));
    section.append(grid);
    form.append(section);
    const actions = node('div', 'bc-form-actions');
    const reset = node('button', 'bc-button bc-button-ghost');
    reset.type = 'button';
    reset.append(icon('restart_alt'), node('span', '', 'Reset'));
    reset.addEventListener('click', () => renderOperation(operation));
    const submit = node('button', `bc-button ${operation.risk === 'high' ? 'bc-button-danger' : 'bc-button-primary'}`);
    submit.type = 'submit';
    submit.disabled = !operation.available;
    submit.append(icon('play_arrow'), node('span', '', operation.risk === 'high' ? 'Review workflow' : 'Run workflow'));
    actions.append(reset, submit);
    form.append(actions, workflowTechnicalDetails(operation));
    form.addEventListener('submit', event => {
      event.preventDefault();
      clearInlineMessages(form);
      if (!form.reportValidity()) return;
      const payload = {profile: profileInput.value.trim() || null, arguments: {}, positionals: {}, confirmation: operation.confirmation || null};
      form.querySelectorAll('[data-workflow-bucket]').forEach(input => {
        const value = readWorkflowField(input);
        if (value !== undefined) payload[input.dataset.workflowBucket][input.dataset.workflowName] = value;
      });
      openConfirmation(operation, payload, () => executeWorkflow(operation, payload, form));
    });
  }

  function workflowTechnicalDetails(operation) {
    const details = node('details', 'bc-technical');
    const summary = node('summary');
    summary.append(icon('code'), node('span', '', 'Workflow diagnostics'));
    details.append(summary, node('pre', 'bc-scroll', safeJSON({operation_id: operation.bridgeId, reviewed_command: operation.command, coverage: operation.coverage, risk: operation.risk, interactive: operation.interactive, long_running: operation.longRunning, argv_prefix: operation.technical?.argv_prefix || []})));
    return details;
  }

  async function executeWorkflow(operation, payload, form) {
    clearInlineMessages(form);
    setSubmitBusy(form, true);
    try {
      const response = await fetch(`${BRIDGE_BASE}/cli-operations/${encodeURIComponent(operation.bridgeId)}/run`, {method: 'POST', credentials: 'same-origin', headers: {Accept: 'application/json', 'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
      const {payload: result} = await readResponse(response);
      if (!response.ok) throw new Error(errorMessage(result, response));
      const job = result?.job || result;
      if (!job?.job_id) throw new Error('Hermes started the workflow but did not return a job ID.');
      renderWorkflowJob(operation, form, job);
      scheduleJobPoll(operation, form, job.job_id, 500);
    } catch (error) {
      showInlineError(form, error.message);
    } finally {
      setSubmitBusy(form, false);
    }
  }

  function jobState(job) {
    return String(job?.status || 'unknown').toLowerCase();
  }

  function renderWorkflowJob(operation, form, job, error = '') {
    form.querySelector('.bc-result')?.remove();
    const status = jobState(job);
    const terminal = TERMINAL_JOB_STATES.has(status);
    const ok = !error && !['failed', 'error', 'cancelled', 'canceled', 'timed_out'].includes(status);
    const result = node('section', 'bc-result');
    result.dataset.ok = String(ok);
    const header = node('div', 'bc-result-header');
    const title = node('div', 'bc-result-title');
    title.append(icon(ok ? terminal ? 'check_circle' : 'progress_activity' : 'error'), node('span', '', error ? 'Workflow needs attention' : terminal ? 'Workflow finished' : 'Workflow is running'));
    header.append(title, node('span', 'bc-result-meta', prettyLabel(status)));
    const body = node('div', 'bc-result-body');
    const statusRow = node('div', 'bc-job-status');
    statusRow.append(node('span', 'bc-status-dot'), node('span', '', error || (terminal ? `${operation.label} is ${prettyLabel(status).toLowerCase()}.` : `${operation.label} is ${prettyLabel(status).toLowerCase()}. This view updates automatically.`)));
    body.append(statusRow);
    if (job.output) body.append(node('pre', 'bc-output bc-scroll', redactText(job.output)));
    if (job.error) body.append(callout(redactText(job.error), 'error'));
    if (!terminal && job.accepts_input) {
      const inputRow = node('div', 'bc-job-input');
      const input = node('input', 'bc-input');
      input.type = 'password';
      input.placeholder = 'Private response for the running workflow';
      input.autocomplete = 'new-password';
      const send = node('button', 'bc-button bc-button-primary');
      send.type = 'button';
      send.append(icon('send'), node('span', '', 'Send response'));
      send.addEventListener('click', () => sendJobInput(operation, form, job.job_id, input, send));
      inputRow.append(input, send);
      body.append(inputRow);
    }
    if (!terminal) {
      const stop = node('button', 'bc-button bc-button-ghost bc-inline-action');
      stop.type = 'button';
      stop.append(icon('stop_circle'), node('span', '', 'Stop workflow'));
      stop.addEventListener('click', () => stopJob(operation, form, job.job_id, stop));
      body.append(stop);
    }
    const technical = node('details', 'bc-technical');
    const summary = node('summary');
    summary.append(icon('code'), node('span', '', 'Job diagnostics'));
    technical.append(summary, node('pre', 'bc-scroll', safeJSON(redact(job))));
    body.append(technical);
    result.append(header, body);
    form.append(result);
    result.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  }

  function scheduleJobPoll(operation, form, jobId, delay = 1100) {
    clearTimeout(state.jobTimer);
    state.jobTimer = setTimeout(() => pollJob(operation, form, jobId), delay);
  }

  async function pollJob(operation, form, jobId) {
    if (state.selectedId !== operation.id || !document.body.contains(form)) return;
    try {
      const response = await fetch(`${BRIDGE_BASE}/cli-jobs/${encodeURIComponent(jobId)}`, {credentials: 'same-origin', headers: {Accept: 'application/json'}});
      const {payload} = await readResponse(response);
      if (!response.ok) throw new Error(errorMessage(payload, response));
      const job = payload?.job || payload;
      renderWorkflowJob(operation, form, job);
      if (!TERMINAL_JOB_STATES.has(jobState(job))) scheduleJobPoll(operation, form, jobId);
    } catch (error) {
      renderWorkflowJob(operation, form, {job_id: jobId, status: 'error'}, error.message);
    }
  }

  async function sendJobInput(operation, form, jobId, input, button) {
    const text = input.value;
    if (!text) return;
    button.disabled = true;
    try {
      const response = await fetch(`${BRIDGE_BASE}/cli-jobs/${encodeURIComponent(jobId)}/input`, {method: 'POST', credentials: 'same-origin', headers: {Accept: 'application/json', 'Content-Type': 'application/json'}, body: JSON.stringify({text})});
      const {payload} = await readResponse(response);
      if (!response.ok) throw new Error(errorMessage(payload, response));
      input.value = '';
      input.focus();
      scheduleJobPoll(operation, form, jobId, 250);
    } catch (error) {
      showInlineError(form, error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function stopJob(operation, form, jobId, button) {
    button.disabled = true;
    try {
      const response = await fetch(`${BRIDGE_BASE}/cli-jobs/${encodeURIComponent(jobId)}`, {method: 'DELETE', credentials: 'same-origin', headers: {Accept: 'application/json'}});
      const {payload} = await readResponse(response);
      if (!response.ok) throw new Error(errorMessage(payload, response));
      renderWorkflowJob(operation, form, payload?.job || payload);
    } catch (error) {
      showInlineError(form, error.message);
    } finally {
      button.disabled = false;
    }
  }

  function openConfirmation(operation, request, callback) {
    state.pending = {operation, request, callback};
    const body = $('confirmBody');
    body.replaceChildren();
    $('confirmTitle').textContent = operation.label;
    const review = node('dl', 'bc-review-grid');
    const rows = [
      ['Control area', operation.domain],
      ['Action', operation.source === 'workflow' ? 'Run managed workflow' : operation.method === 'DELETE' ? 'Remove or clear data' : 'Apply changes'],
      ['Impact', operation.risk === 'high' ? 'High — explicit confirmation required' : operation.risk === 'medium' ? 'Changes the connected Hermes installation' : 'Low']
    ];
    rows.forEach(([term, value]) => review.append(node('dt', '', term), node('dd', '', value)));
    body.append(review);
    const submitted = operation.source === 'workflow' ? {profile: request.profile, options: {...request.positionals, ...request.arguments}} : request.bodyValue;
    if (submitted && Object.keys(submitted).length) {
      body.append(node('div', 'bc-label-row', 'Values to apply'));
      const values = node('div', 'bc-review-values');
      values.append(renderResultValue(redact(submitted)));
      body.append(values);
    }
    const technical = node('details', 'bc-technical');
    const technicalSummary = node('summary');
    technicalSummary.append(icon('code'), node('span', '', 'Request diagnostics'));
    technical.append(technicalSummary, node('pre', 'bc-scroll', operation.source === 'workflow' ? safeJSON({operation_id: operation.bridgeId, reviewed_command: operation.command}) : `${request.method} ${redactUrl(request.url)}`));
    body.append(technical);
    const expected = operation.source === 'workflow' && operation.confirmation ? operation.confirmation : operation.method === 'DELETE' ? 'DELETE' : '';
    const execute = $('confirmExecute');
    execute.className = `bc-button ${expected ? 'bc-button-danger' : 'bc-button-primary'}`;
    execute.textContent = operation.source === 'workflow' ? 'Run workflow' : operation.method === 'DELETE' ? 'Delete permanently' : 'Apply changes';
    execute.disabled = Boolean(expected);
    if (expected) {
      body.append(callout(`Type ${expected} exactly to continue.`, 'warning'));
      const field = node('label', 'bc-field');
      field.append(labelRow(`Type ${expected}`, true, 'confirmation'));
      const input = node('input', 'bc-input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.placeholder = expected;
      input.addEventListener('input', () => { execute.disabled = input.value !== expected; });
      field.append(input);
      body.append(field);
      setTimeout(() => input.focus(), 0);
    } else setTimeout(() => execute.focus(), 0);
    $('confirmDialog').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeConfirmation() {
    $('confirmDialog').hidden = true;
    document.body.style.overflow = '';
    state.pending = null;
  }

  function renderMessageResult(form, ok, title, message) {
    renderResponse(form, {ok, title, payload: {message}, elapsed: 0, technical: {}});
  }

  function renderResultValue(value, depth = 0) {
    const safe = redact(value);
    if (safe === null || safe === undefined || typeof safe !== 'object') {
      let display = safe === null ? 'None' : safe === undefined ? 'No data' : String(safe);
      if (display.length > 1500 && /^(?:data:|[A-Za-z0-9+/=]+$)/.test(display.slice(0, 100))) display = `Binary or encoded response (${display.length.toLocaleString()} characters)`;
      return node('div', 'bc-result-value', display);
    }
    if (Array.isArray(safe)) {
      const list = node('div', 'bc-result-grid');
      if (!safe.length) list.append(node('div', 'bc-result-value', 'No items'));
      safe.forEach((item, index) => {
        if (item && typeof item === 'object') {
          const details = node('details', 'bc-result-item');
          if (index < 3 && depth < 2) details.open = true;
          details.append(node('summary', '', `Item ${index + 1}`), renderResultValue(item, depth + 1));
          list.append(details);
        } else {
          const row = node('div', 'bc-result-row');
          row.append(node('div', 'bc-result-key', `Item ${index + 1}`), renderResultValue(item, depth + 1));
          list.append(row);
        }
      });
      return list;
    }
    const grid = node('div', 'bc-result-grid');
    Object.entries(safe).forEach(([key, item]) => {
      const row = node('div', 'bc-result-row');
      row.append(node('div', 'bc-result-key', prettyLabel(key)), renderResultValue(item, depth + 1));
      grid.append(row);
    });
    if (!Object.keys(safe).length) grid.append(node('div', 'bc-result-value', 'No additional information returned.'));
    return grid;
  }

  function renderResponse(form, result) {
    form.querySelector('.bc-result')?.remove();
    const section = node('section', 'bc-result');
    section.dataset.ok = String(result.ok);
    const header = node('div', 'bc-result-header');
    const title = node('div', 'bc-result-title');
    title.append(icon(result.ok ? 'check_circle' : 'error'), node('span', '', result.title));
    header.append(title, node('span', 'bc-result-meta', result.elapsed ? `${result.elapsed} ms` : result.ok ? 'Complete' : 'Needs attention'));
    const body = node('div', 'bc-result-body');
    body.append(renderResultValue(result.payload));
    const technical = node('details', 'bc-technical');
    const summary = node('summary');
    summary.append(icon('code'), node('span', '', 'Response diagnostics'));
    technical.append(summary, node('pre', 'bc-scroll', safeJSON(redact(result.technical))));
    body.append(technical);
    section.append(header, body);
    form.append(section);
    section.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  }

  $('searchInput').addEventListener('input', () => {
    state.browseAll = false;
    if ($('searchInput').value.trim() && state.domain) {
      state.domain = '';
      $('domainFilter').value = '';
    }
    applyFilters();
  });
  $('domainFilter').addEventListener('change', () => { state.domain = $('domainFilter').value; state.browseAll = false; applyFilters(); });
  $('kindFilter').addEventListener('change', applyFilters);
  $('reloadButton').addEventListener('click', loadInventories);
  $('showEverythingButton').addEventListener('click', () => {
    state.domain = '';
    state.browseAll = true;
    $('domainFilter').value = '';
    $('kindFilter').value = '';
    $('searchInput').value = '';
    applyFilters();
    $('controlBrowser').scrollIntoView({behavior: 'smooth', block: 'start'});
  });
  $('confirmCancel').addEventListener('click', closeConfirmation);
  $('confirmClose').addEventListener('click', closeConfirmation);
  $('confirmDialog').addEventListener('click', event => { if (event.target === $('confirmDialog')) closeConfirmation(); });
  $('confirmExecute').addEventListener('click', () => {
    const pending = state.pending;
    if (!pending) return;
    closeConfirmation();
    pending.callback();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('confirmDialog').hidden) closeConfirmation();
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      $('searchInput').focus();
    }
  });

  let hashId = '';
  try { hashId = decodeURIComponent(location.hash.replace(/^#/, '')); } catch (_) { hashId = ''; }
  if (hashId) state.selectedId = hashId;
  loadInventories();
})();
