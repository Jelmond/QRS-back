/**
 * Validates that every Express route defined in the codebase has a matching
 * entry in swagger.ts. Scans server.ts and all files under src/routes/.
 * Run via: npm run docs:validate
 * Also triggered automatically by the Claude Code PostToolUse hook.
 */

import * as fs from 'fs';
import * as path from 'path';
import { swaggerSpec } from '../src/docs/swagger';

const routerMountMap: Record<string, string> = {};

// Extract router mounts from server.ts: app.use('/prefix', someRouter)
const serverSource = fs.readFileSync(path.join(__dirname, '../src/server.ts'), 'utf-8');
const mountRegex = /app\.use\(['"`](\/[^'"`]*?)['"`],\s*(\w+)/g;
let m: RegExpExecArray | null;
while ((m = mountRegex.exec(serverSource)) !== null) {
  const prefix = m[1].replace(/\/$/, '');
  const varName = m[2];
  // match: import adminPosRouter from './routes/adminPos'
  const importMatch = new RegExp(`import ${varName} from ['"\`]([^'"\`]+)['"\`]`).exec(serverSource);
  if (importMatch) {
    const filePath = importMatch[1].replace(/^\.\//, 'src/') + '.ts';
    routerMountMap[filePath] = prefix;
  }
}

// Files to scan: server.ts + all router files
const filesToScan: Array<{ file: string; prefix: string }> = [
  { file: 'src/server.ts', prefix: '' },
  ...Object.entries(routerMountMap).map(([file, prefix]) => ({ file, prefix })),
];

/** Convert Express :param syntax → OpenAPI {param}, strip trailing slash. */
function normalise(p: string): string {
  return p.replace(/:([^/]+)/g, '{$1}').replace(/\/$/, '') || '/';
}

const routeRegex = /(?:app|router)\.(get|post|put|patch|delete)\(['"`](\/[^'"`]*)/gi;
const routesInCode: Array<{ method: string; path: string }> = [];

for (const { file, prefix } of filesToScan) {
  const fullPath = path.join(__dirname, '..', file);
  if (!fs.existsSync(fullPath)) continue;
  const source = fs.readFileSync(fullPath, 'utf-8');
  routeRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = routeRegex.exec(source)) !== null) {
    const method = match[1].toLowerCase();
    const routePath = normalise(prefix + match[2]);
    if (routePath.startsWith('/api-docs')) continue;
    routesInCode.push({ method, path: routePath });
  }
}

const specPaths = swaggerSpec.paths as Record<string, Record<string, unknown>>;
let missing = 0;

for (const { method, path: routePath } of routesInCode) {
  if (!specPaths[routePath]?.[method]) {
    console.warn(`⚠  Missing in swagger.ts: ${method.toUpperCase()} ${routePath}`);
    missing++;
  }
}

if (missing === 0) {
  console.log(`✓  All ${routesInCode.length} routes are documented in swagger.ts`);
} else {
  console.error(`\n${missing} route(s) missing from swagger.ts — please update src/docs/swagger.ts`);
  process.exit(1);
}
