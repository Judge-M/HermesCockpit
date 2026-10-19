import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cliSource = path.resolve(process.argv[2] || path.join(root, '..', '..', 'hermes-cli-inventory.json'));
const apiSource = path.resolve(process.argv[3] || path.join(root, '..', '..', 'hermes-openapi.json'));
const outputJson = path.join(root, 'CAPABILITY-INVENTORY.json');
const outputMarkdown = path.join(root, 'CAPABILITY-INVENTORY.md');

const cliSnapshot = JSON.parse(readFileSync(cliSource, 'utf8'));
const openapi = JSON.parse(readFileSync(apiSource, 'utf8'));
const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

const coverageLabels = {
  direct: 'Direct API equivalent',
  partial: 'Partial API equivalent',
  generic: 'Generic config/env API equivalent',
  gateway: 'Gateway/WebSocket, not REST',
  none: 'CLI-only',
};

// This is intentionally explicit. New top-level CLI families cause the build to fail
// until their browser contract is reviewed rather than being silently guessed.
const familyMap = {
  chat: { coverage: 'gateway', patterns: ['^/api/chat/'], note: 'Conversation execution is the PTY/gateway WebSocket contract; REST only supplies ancillary chat data.' },
  model: { coverage: 'direct', patterns: ['^/api/model/', '^/api/providers/custom-endpoints'], note: 'Model discovery, assignment, and custom endpoints have native REST controls.' },
  moa: { coverage: 'direct', patterns: ['^/api/model/moa$'], note: 'GET and PUT cover reading and replacing MoA slots, including clearing a preset.' },
  fallback: { coverage: 'generic', patterns: ['^/api/config(?:/raw)?$'], note: 'The fallback chain is part of the profile configuration and is readable/writable through the config API.' },
  worktree: { coverage: 'partial', patterns: ['^/api/git/worktrees$', '^/api/git/worktree/'], note: 'REST can list, add, and remove worktrees; the attended audit/prune policy remains CLI-only.' },
  browser: { coverage: 'none', patterns: [], note: 'Closing a real-profile browser process has no REST operation.' },
  secrets: { coverage: 'generic', patterns: ['^/api/env$', '^/api/env/', '^/api/config(?:/raw)?$'], note: 'Environment and config values are manageable, but Bitwarden/1Password install, validation, and sync flows are CLI-only.' },
  egress: { coverage: 'partial', patterns: ['^/api/egress/', '^/api/config(?:/raw)?$'], note: 'REST exposes status and configuration; install and service lifecycle actions are not exposed.' },
  migrate: { coverage: 'partial', patterns: ['^/api/ops/config-migrate$'], note: 'The general config migration is exposed; named xAI and relay migrations are not separate REST actions.' },
  'codex-runtime': { coverage: 'none', patterns: [], note: 'Codex MCP projection/migration is CLI-only.' },
  gateway: { coverage: 'partial', patterns: ['^/api/gateway/', '^/api/status$'], note: 'Start, stop, restart, drain, and migration are native REST actions; install, uninstall, enrollment, and foreground execution remain CLI-only.' },
  proxy: { coverage: 'none', patterns: [], note: 'The local OpenAI-compatible proxy lifecycle has no REST operation.' },
  lsp: { coverage: 'none', patterns: [], note: 'LSP inventory, install, restart, and binary lookup are CLI-only.' },
  setup: { coverage: 'partial', patterns: ['^/api/config', '^/api/model/', '^/api/messaging/', '^/api/tools/'], note: 'The wizard itself is CLI-only, but its main persisted settings have native REST controls.' },
  whatsapp: { coverage: 'direct', patterns: ['^/api/messaging/whatsapp/'], note: 'The complete browser onboarding lifecycle is exposed.' },
  'whatsapp-cloud': { coverage: 'direct', patterns: ['^/api/messaging/platforms'], note: 'Platform configuration and testing are exposed through messaging platform controls.' },
  slack: { coverage: 'partial', patterns: ['^/api/messaging/platforms'], note: 'Platform settings and testing are exposed; manifest generation is CLI-only.' },
  send: { coverage: 'none', patterns: [], note: 'The no-agent outbound message command has no REST operation.' },
  login: { coverage: 'partial', patterns: ['^/api/providers/oauth', '^/api/auth/providers$'], note: 'Browser provider OAuth is exposed; CLI-specific login modes and flags are not all mirrored.' },
  logout: { coverage: 'direct', patterns: ['^/api/providers/oauth/\{provider_id\}$'], note: 'Provider disconnect is a native REST action.' },
  auth: { coverage: 'partial', patterns: ['^/api/credentials/pool', '^/api/providers/oauth'], note: 'Pool list/add/remove and provider OAuth are exposed; priority, cooldown reset, refresh, and upgrade are not all represented.' },
  status: { coverage: 'direct', patterns: ['^/api/status$', '^/api/health', '^/api/system/stats$', '^/api/host/identity$'], note: 'Runtime, health, system, and host status have direct read APIs.' },
  pause: { coverage: 'none', patterns: [], note: 'The global emergency stop does not have an equivalent REST action.' },
  resume: { coverage: 'none', patterns: [], note: 'Lifting the global emergency stop does not have an equivalent REST action.' },
  cron: { coverage: 'partial', patterns: ['^/api/cron/'], note: 'Job CRUD, pause/resume, trigger, runs, delivery targets, and blueprints are exposed; incidents, notepad, doctor, and tick are CLI-only.' },
  webhook: { coverage: 'direct', patterns: ['^/api/webhooks', '^/api/cron/fire$'], note: 'Subscription CRUD, enablement, and firing/testing are exposed.' },
  peer: { coverage: 'gateway', patterns: [], note: 'Peer turns use the gateway protocol and are not in OpenAPI.' },
  portal: { coverage: 'partial', patterns: ['^/api/portal$', '^/api/providers/oauth'], note: 'Portal status and OAuth are exposed; opening the subscription page and tool routing inventory remain CLI-only.' },
  kanban: { coverage: 'partial', patterns: ['^/api/plugins/kanban/'], note: 'The API exposes broad board, task, run, orchestration, attachment, link, comment, and worker controls; low-level repair/maintenance commands remain CLI-only.' },
  project: { coverage: 'partial', patterns: ['^/api/profiles/projects/tree$', '^/api/plugins/kanban/projects$'], note: 'Projects are readable through REST, but the CLI project mutation surface is not exposed.' },
  hooks: { coverage: 'partial', patterns: ['^/api/ops/hooks$'], note: 'List, create, and delete are exposed; test, revoke semantics, and doctor are not separate REST actions.' },
  doctor: { coverage: 'direct', patterns: ['^/api/ops/doctor$'], note: 'The diagnostic run has a direct REST action.' },
  verify: { coverage: 'none', patterns: [], note: 'Project recipe detection and smoke testing are CLI-only.' },
  security: { coverage: 'direct', patterns: ['^/api/ops/security-audit$'], note: 'The supply-chain audit has a direct REST action.' },
  approvals: { coverage: 'none', patterns: [], note: 'Approval history mining and verdict testing are CLI-only.' },
  dump: { coverage: 'direct', patterns: ['^/api/ops/dump$'], note: 'The support dump has a direct REST action.' },
  debug: { coverage: 'direct', patterns: ['^/api/ops/debug-share$'], note: 'Debug report upload has a direct REST action.' },
  backup: { coverage: 'direct', patterns: ['^/api/ops/backup'], note: 'Backup creation and download have direct REST operations.' },
  checkpoints: { coverage: 'partial', patterns: ['^/api/ops/checkpoints'], note: 'Listing and pruning are exposed; clearing the entire or legacy stores remains CLI-only.' },
  import: { coverage: 'direct', patterns: ['^/api/ops/import'], note: 'Server-side and upload restore paths have direct REST actions.' },
  'import-agent': { coverage: 'none', patterns: [], note: 'Claude Code/Codex setup import is CLI-only.' },
  config: { coverage: 'direct', patterns: ['^/api/config(?:/|$)'], note: 'Resolved, raw, defaults, schema, and update operations cover config read/write behavior.' },
  skin: { coverage: 'generic', patterns: ['^/api/config(?:/raw)?$', '^/api/dashboard/themes?$', '^/api/dashboard/font$'], note: 'Appearance values are writable through config, while dashboard theme/font have dedicated operations; terminal skin file management is not fully mirrored.' },
  console: { coverage: 'none', patterns: [], note: 'The curated command REPL has no REST operation and must not be replaced with an arbitrary shell.' },
  pairing: { coverage: 'direct', patterns: ['^/api/pairing'], note: 'List, approve, revoke, and clear-pending are all exposed.' },
  skills: { coverage: 'partial', patterns: ['^/api/skills'], note: 'REST covers list, create/edit, toggle, registry search/preview/install/update/uninstall; trust, snapshots, taps, publishing, and several maintenance actions remain CLI-only.' },
  bundles: { coverage: 'none', patterns: [], note: 'Skill bundle CRUD and reload are CLI-only.' },
  plugins: { coverage: 'partial', patterns: ['^/api/dashboard/agent-plugins', '^/api/dashboard/plugins'], note: 'Install/update/remove/enable/disable and catalog discovery are exposed; validation, packs, capabilities, and provenance maintenance are CLI-only.' },
  curator: { coverage: 'partial', patterns: ['^/api/curator'], note: 'Status, run, pause, and resume are exposed; pinning, archive/restore, backup/rollback, ledger, prune, and purge remain CLI-only.' },
  pets: { coverage: 'generic', patterns: ['^/api/config(?:/raw)?$'], note: 'Active pet display settings are writable through config; gallery, install, animation, removal, and doctor are CLI-only.' },
  journey: { coverage: 'direct', patterns: ['^/api/learning/'], note: 'Graph listing plus node read, update, and delete mirror the CLI journey controls.' },
  memory: { coverage: 'direct', patterns: ['^/api/memory'], note: 'Status, provider selection/config/setup/OAuth, disablement, and reset are exposed.' },
  tools: { coverage: 'direct', patterns: ['^/api/tools/toolsets'], note: 'Toolset list/toggle/config/provider/model/env/post-setup controls are exposed.' },
  'computer-use': { coverage: 'partial', patterns: ['^/api/tools/computer-use'], note: 'Status and permission grant are exposed; install, doctor, and headless-screen lifecycle are CLI-only.' },
  mcp: { coverage: 'partial', patterns: ['^/api/mcp/'], note: 'Server/catalog CRUD, enablement, testing, and OAuth are exposed; MCP serving and interactive picker/configuration modes are not direct REST actions.' },
  connectors: { coverage: 'none', patterns: [], note: 'Hosted connector account lifecycle has no OpenAPI operation in this build.' },
  sessions: { coverage: 'partial', patterns: ['^/api/sessions', '^/api/profiles/sessions'], note: 'REST covers browse/search/detail/messages/timeline/export/import/rename/delete/prune/stats and ownership repair; advanced database maintenance, pinning, and several repair tools remain CLI-only.' },
  insights: { coverage: 'direct', patterns: ['^/api/analytics/'], note: 'Usage and model analytics have direct read APIs.' },
  usage: { coverage: 'none', patterns: [], note: 'Provider account rate-limit windows are not the same as historical analytics and have no REST equivalent.' },
  monitoring: { coverage: 'generic', patterns: ['^/api/config(?:/raw)?$', '^/api/status$'], note: 'Monitoring configuration and runtime status are readable through generic config/status APIs; the dedicated redaction-posture report is CLI-only.' },
  claw: { coverage: 'none', patterns: [], note: 'OpenClaw migration and cleanup are CLI-only.' },
  vault: { coverage: 'none', patterns: [], note: 'Encrypted browser-vault item management has no dashboard REST contract.' },
  update: { coverage: 'direct', patterns: ['^/api/hermes/update'], note: 'Check, run, and receipt operations are exposed.' },
  uninstall: { coverage: 'none', patterns: [], note: 'Host uninstall is CLI-only.' },
  acp: { coverage: 'none', patterns: [], note: 'Starting the ACP server is CLI-only.' },
  profile: { coverage: 'partial', patterns: ['^/api/profiles'], note: 'REST covers core list/create/delete/rename/select/export/import/model/description/SOUL operations; aliases, identity repair, and distribution install/update/info remain CLI-only.' },
  completion: { coverage: 'none', patterns: [], note: 'Shell completion generation is CLI-only and has no browser behavior.' },
  dashboard: { coverage: 'none', patterns: [], note: 'Starting/registering the dashboard is host lifecycle work; /api/dashboard/* configures dashboard features rather than executing this CLI command.' },
  serve: { coverage: 'none', patterns: [], note: 'Starting the headless backend is host lifecycle work and cannot be performed by that backend itself.' },
  desktop: { coverage: 'none', patterns: [], note: 'Building and launching Electron is CLI-only and not required for Cockpit operation.' },
  logs: { coverage: 'direct', patterns: ['^/api/logs$'], note: 'Log selection, filtering, and tail data have a direct REST read operation.' },
  'prompt-size': { coverage: 'direct', patterns: ['^/api/ops/prompt-size$'], note: 'Prompt budget analysis has a direct REST action.' },
};

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return String(value).split(/\s+/).filter(Boolean);
}

function normalizeArgument(argument) {
  return {
    flags: asArray(argument.flags),
    name: argument.name || argument.dest || null,
    required: Boolean(argument.required),
    nargs: argument.nargs ?? null,
    choices: argument.choices ?? null,
    default: argument.default ?? null,
    type: argument.type ?? null,
    metavar: argument.metavar ?? null,
    help: argument.help || '',
  };
}

function flattenCli(node, output = []) {
  const pathParts = Array.isArray(node.path) ? node.path.map(String) : String(node.path || '').split(/\s+/).filter(Boolean);
  if (pathParts.length) {
    const commandPath = pathParts.join(' ');
    output.push({
      path: commandPath,
      name: node.name || pathParts.at(-1),
      root: pathParts[0],
      aliases: asArray(node.aliases),
      help: node.help || '',
      description: node.description || '',
      options: asArray(node.options).map(normalizeArgument),
      positionals: asArray(node.positionals).map(normalizeArgument),
      hasSubcommands: asArray(node.subcommands).length > 0,
    });
  }
  for (const child of asArray(node.subcommands)) flattenCli(child, output);
  return output;
}

function flattenApi(spec) {
  const operations = [];
  for (const [apiPath, pathItem] of Object.entries(spec.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;
      const parameters = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])];
      operations.push({
        method: method.toUpperCase(),
        path: apiPath,
        operationId: operation.operationId || '',
        summary: operation.summary || '',
        description: operation.description || '',
        parameters: parameters.map(parameter => ({
          name: parameter.name || '',
          in: parameter.in || '',
          required: Boolean(parameter.required),
          schema: parameter.schema || null,
        })),
        requestBody: operation.requestBody ? {
          required: Boolean(operation.requestBody.required),
          contentTypes: Object.keys(operation.requestBody.content || {}),
        } : null,
        scope: apiPath.startsWith('/api') ? 'control' : 'access-or-shell',
      });
    }
  }
  return operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

const cliCommands = flattenCli(cliSnapshot.parser);
const cliGlobalOptions = asArray(cliSnapshot.parser.options).map(normalizeArgument);
const cliGlobalPositionals = asArray(cliSnapshot.parser.positionals).map(normalizeArgument);
const apiOperations = flattenApi(openapi);
const topLevel = cliCommands.filter(command => !command.path.includes(' '));
const actualRoots = new Set(topLevel.map(command => command.root));
const mappedRoots = new Set(Object.keys(familyMap));
const missingRoots = [...actualRoots].filter(name => !mappedRoots.has(name));
const staleRoots = [...mappedRoots].filter(name => !actualRoots.has(name));
if (missingRoots.length || staleRoots.length) {
  throw new Error(`CLI family map mismatch. Missing: ${missingRoots.join(', ') || 'none'}; stale: ${staleRoots.join(', ') || 'none'}`);
}

const operationKey = operation => `${operation.method} ${operation.path}`;
const controlOperations = apiOperations.filter(operation => operation.scope === 'control');
const familyRows = topLevel.map(command => {
  const rule = familyMap[command.root];
  const regexes = rule.patterns.map(pattern => new RegExp(pattern));
  const matches = controlOperations.filter(operation => regexes.some(regex => regex.test(operation.path)));
  const nodes = cliCommands.filter(candidate => candidate.root === command.root);
  return {
    command: command.root,
    aliases: command.aliases,
    coverage: rule.coverage,
    coverageLabel: coverageLabels[rule.coverage],
    commandNodes: nodes.length,
    leafCommands: nodes.filter(node => !node.hasSubcommands).length,
    options: nodes.reduce((sum, node) => sum + node.options.length, 0),
    positionals: nodes.reduce((sum, node) => sum + node.positionals.length, 0),
    apiOperationCount: matches.length,
    apiOperations: matches.map(operationKey),
    note: rule.note,
  };
});

const linkedControlKeys = new Set(familyRows.flatMap(family => family.apiOperations));
const coverageCounts = Object.fromEntries(Object.keys(coverageLabels).map(key => [key, familyRows.filter(row => row.coverage === key).length]));
const aliasCount = cliCommands.reduce((sum, command) => sum + command.aliases.length, 0);
const optionCount = cliGlobalOptions.length + cliCommands.reduce((sum, command) => sum + command.options.length, 0);
const positionalCount = cliGlobalPositionals.length + cliCommands.reduce((sum, command) => sum + command.positionals.length, 0);

const inventory = {
  generatedAt: new Date().toISOString(),
  source: {
    hermesVersion: cliSnapshot.version,
    hermesCommit: cliSnapshot.commit,
    openapiTitle: openapi.info?.title || '',
    openapiVersion: openapi.info?.version || '',
  },
  counts: {
    cliTopLevelCommands: topLevel.length,
    cliCanonicalCommandNodes: cliCommands.length,
    cliLeafCommands: cliCommands.filter(command => !command.hasSubcommands).length,
    cliAliases: aliasCount,
    cliOptions: optionCount,
    cliPositionals: positionalCount,
    apiPaths: Object.keys(openapi.paths || {}).length,
    apiOperations: apiOperations.length,
    apiControlOperations: controlOperations.length,
    apiAccessOrShellOperations: apiOperations.length - controlOperations.length,
    apiControlOperationsLinkedToCliFamilies: linkedControlKeys.size,
    apiControlOperationsWithoutCliFamily: controlOperations.length - linkedControlKeys.size,
    cliFamilyCoverage: coverageCounts,
  },
  coverageDefinitions: coverageLabels,
  cliGlobalOptions,
  cliGlobalPositionals,
  cliFamilies: familyRows,
  cliCommands,
  apiOperations,
};

const md = [];
const esc = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
md.push('# Hermes capability inventory', '');
md.push(`Authoritative snapshot of installed Hermes **${esc(cliSnapshot.version)}** at commit \`${esc(cliSnapshot.commit)}\`.` , '');
md.push('This file is generated from the installed argparse tree and FastAPI OpenAPI schema. It does not infer commands from documentation, and it keeps aliases separate from canonical command nodes so they are not double-counted.', '');
md.push('## Counts', '');
md.push('| Surface | Count |', '| --- | ---: |');
md.push(`| Top-level canonical CLI commands | ${topLevel.length} |`);
md.push(`| Canonical CLI command/subcommand nodes | ${cliCommands.length} |`);
md.push(`| CLI leaf commands | ${cliCommands.filter(command => !command.hasSubcommands).length} |`);
md.push(`| CLI aliases | ${aliasCount} |`);
md.push(`| CLI option/flag definitions | ${optionCount} |`);
md.push(`| CLI positional definitions | ${positionalCount} |`);
md.push(`| OpenAPI paths | ${Object.keys(openapi.paths || {}).length} |`);
md.push(`| All OpenAPI operations | ${apiOperations.length} |`);
md.push(`| Authenticated Hermes control operations under \`/api\` | ${controlOperations.length} |`);
md.push(`| Access, authentication, asset, and SPA-shell operations outside \`/api\` | ${apiOperations.length - controlOperations.length} |`);
md.push(`| Control operations associated with at least one CLI family | ${linkedControlKeys.size} |`);
md.push(`| Control operations with no CLI-family counterpart | ${controlOperations.length - linkedControlKeys.size} |`, '');
md.push('The complete base schema has 348 operations. Cockpit presents the 337 `/api` operations as controls and keeps the other 11 login/OAuth, asset, plugin-asset, and SPA routes visible as clearly labeled access flows. The deployed control-plane plugin adds 6 authenticated routes that are discovered live rather than folded into this base-schema snapshot.', '');
md.push('## CLI/API overlap by command family', '');
md.push('| CLI family | CLI nodes | Leaf commands | API operations in family | Coverage | Notes |', '| --- | ---: | ---: | ---: | --- | --- |');
for (const row of familyRows) md.push(`| \`${esc(row.command)}\` | ${row.commandNodes} | ${row.leafCommands} | ${row.apiOperationCount} | ${esc(row.coverageLabel)} | ${esc(row.note)} |`);
md.push('', 'Coverage labels are deliberately conservative: **Direct** means the command family’s central behavior has a dedicated API; **Partial** means only some subcommands do; **Generic** means the same persisted state can be changed through config/env APIs without a dedicated endpoint; **Gateway/WebSocket** means it is real browser functionality outside OpenAPI; **CLI-only** means no equivalent browser contract was found.', '');
md.push('## Complete canonical CLI inventory', '');
md.push(`The root invocation also defines **${cliGlobalOptions.length} global launch options**. Their complete signatures are retained in the JSON inventory and are included in the option total above.`, '');
md.push('| Canonical command | Aliases | Flags/options | Positionals | Description |', '| --- | --- | ---: | ---: | --- |');
for (const command of cliCommands) md.push(`| \`${esc(command.path)}\` | ${command.aliases.map(alias => `\`${esc(alias)}\``).join(', ')} | ${command.options.length} | ${command.positionals.length} | ${esc(command.help || command.description)} |`);
md.push('', 'Full flag names, choices, defaults, metavariables, help text, and positional definitions are retained in [`CAPABILITY-INVENTORY.json`](CAPABILITY-INVENTORY.json).', '');
md.push('## Complete OpenAPI operation inventory', '');
md.push('| Method | Path | Operation ID | Scope | Summary |', '| --- | --- | --- | --- | --- |');
for (const operation of apiOperations) md.push(`| ${operation.method} | \`${esc(operation.path)}\` | \`${esc(operation.operationId)}\` | ${operation.scope === 'control' ? 'Hermes control' : 'Access/web shell'} | ${esc(operation.summary)} |`);
md.push('', 'Request parameter signatures and accepted request-body media types are retained in [`CAPABILITY-INVENTORY.json`](CAPABILITY-INVENTORY.json).', '');
md.push('## Rebuild', '', '```sh', 'node scripts/build-capability-inventory.mjs /path/to/hermes-cli-inventory.json /path/to/hermes-openapi.json', '```', '');
md.push('The generator exits with an error if the installed CLI gains or loses a top-level family without a corresponding reviewed classification.', '');

writeFileSync(outputJson, `${JSON.stringify(inventory, null, 2)}\n`);
writeFileSync(outputMarkdown, `${md.join('\n')}\n`);
console.log(`Wrote ${path.basename(outputJson)} and ${path.basename(outputMarkdown)}`);
console.log(JSON.stringify(inventory.counts, null, 2));
