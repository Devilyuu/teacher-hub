import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolve(projectRoot, "app");
const actionRoots = [appRoot, resolve(projectRoot, "lib", "actions")];

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const pathname = resolve(directory, name);
    return statSync(pathname).isDirectory() ? filesUnder(pathname) : [pathname];
  });
}

function isExported(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function firstStatementCallsRequireSession(node) {
  const statement = node.body?.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) return false;
  const expression = statement.expression;
  if (!ts.isAwaitExpression(expression) || !ts.isCallExpression(expression.expression)) return false;
  return ts.isIdentifier(expression.expression.expression)
    && expression.expression.expression.text === "requireSession";
}

/** Route Handler 里的 HTTP 方法。OPTIONS/HEAD 不碰数据，不要求鉴权 */
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * 公开的 Route Handler 白名单。
 *
 * **加进来必须写清替代的鉴权手段**——空着就等于开了一个匿名数据出口。
 * 规格 §5.4：录音上传、分片、转写触发、音频下载、备份 JSON 一律不得进这里。
 */
const PUBLIC_ROUTES = new Map([
  ["app/api/health/route.ts", {
    reason: "健康检查，只回 {ok}，不含业务数据；被 compose healthcheck 调用",
    guard: null,
  }],
  ["app/api/maintenance/cleanup/route.ts", {
    reason: "定时维护入口；只接受独立的 X-Maintenance-Token，不读取登录口令",
    guard: "maintenanceGuard",
  }],
  ["app/api/teaching/import/route.ts", {
    reason: "备课系统回流入口；调用方无会话 cookie，只接受独立的 Authorization: Bearer，与登录口令分离轮换",
    guard: "teachingImportGuard",
  }],
]);

/**
 * 认 `const denied = await sessionGuard(); if (denied) return denied;` 这个开头。
 *
 * 为什么不接受手写的 cookie 校验：那样门禁就得去理解任意形状的鉴权代码，
 * 而三期要加材料 ZIP、结题 Word、音频上传、转写、教案回流一堆接口，
 * 少写一次就是一个公开的数据出口。统一成一句话，门禁才管得住。
 */
function firstStatementsGuardSession(node) {
  const statements = node.body?.statements ?? [];
  const [first, second] = statements;
  if (!first || !second || !ts.isVariableStatement(first)) return false;

  const declaration = first.declarationList.declarations[0];
  const initializer = declaration?.initializer;
  if (!initializer || !ts.isAwaitExpression(initializer)) return false;
  if (!ts.isCallExpression(initializer.expression)) return false;
  if (
    !ts.isIdentifier(initializer.expression.expression) ||
    initializer.expression.expression.text !== "sessionGuard"
  ) {
    return false;
  }

  // 第二句必须真的把 401 返回出去。只调用不返回等于没鉴权
  if (!ts.isIfStatement(second)) return false;
  const branch = second.thenStatement;
  const returned = ts.isBlock(branch) ? branch.statements[0] : branch;
  return returned != null && ts.isReturnStatement(returned);
}

function firstStatementsGuardPublicRoute(node, guardName) {
  const statements = node.body?.statements ?? [];
  const [first, second] = statements;
  if (!first || !second || !ts.isVariableStatement(first)) return false;
  const initializer = first.declarationList.declarations[0]?.initializer;
  if (!initializer || !ts.isCallExpression(initializer)) return false;
  if (!ts.isIdentifier(initializer.expression) || initializer.expression.text !== guardName) return false;
  const branch = ts.isIfStatement(second) ? second.thenStatement : null;
  const returned = branch && (ts.isBlock(branch) ? branch.statements[0] : branch);
  return returned != null && ts.isReturnStatement(returned);
}

const violations = [];

const routeViolations = [];
let checkedActions = 0;
let checkedRoutes = 0;
const unusedWhitelist = new Set(PUBLIC_ROUTES.keys());

for (const pathname of actionRoots.flatMap(filesUnder)) {
  if (extname(pathname) !== ".ts") continue;
  const relativePath = relative(projectRoot, pathname).replaceAll("\\", "/");
  const isAction = pathname.endsWith("actions.ts");
  const isRoute = pathname.endsWith("route.ts");
  if (!isAction && !isRoute) continue;

  const sourceText = readFileSync(pathname, "utf8");
  const source = ts.createSourceFile(pathname, sourceText, ts.ScriptTarget.Latest, true);
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  if (isAction) {
    if (relativePath === "app/login/actions.ts") continue;
    if (!sourceText.startsWith('"use server"')) continue;

    for (const node of source.statements) {
      if (ts.isFunctionDeclaration(node) && isExported(node) && node.name) {
        checkedActions += 1;
        if (!firstStatementCallsRequireSession(node)) {
          violations.push(`${relativePath}:${lineOf(node)} ${node.name.text}`);
        }
      }
    }
    continue;
  }

  // ── Route Handler ──
  const publicRoute = PUBLIC_ROUTES.get(relativePath);
  if (publicRoute) {
    unusedWhitelist.delete(relativePath);
  }

  for (const node of source.statements) {
    if (!ts.isFunctionDeclaration(node) || !isExported(node) || !node.name) continue;
    if (!HTTP_METHODS.has(node.name.text)) continue;

    checkedRoutes += 1;
    if (publicRoute?.guard && !firstStatementsGuardPublicRoute(node, publicRoute.guard)) {
      routeViolations.push(`${relativePath}:${lineOf(node)} ${node.name.text} (missing ${publicRoute.guard})`);
    } else if (!publicRoute && !firstStatementsGuardSession(node)) {
      routeViolations.push(`${relativePath}:${lineOf(node)} ${node.name.text}`);
    }
  }
}

let failed = false;

if (violations.length > 0) {
  failed = true;
  console.error("以下 Server Actions 未在第一步校验会话：");
  for (const violation of violations) console.error(`- ${violation}`);
}

if (routeViolations.length > 0) {
  failed = true;
  console.error(
    "以下 Route Handler 开头不是 `const denied = await sessionGuard(); if (denied) return denied;`：",
  );
  for (const violation of routeViolations) console.error(`- ${violation}`);
  console.error(
    "  接口要公开的话，把它连同替代鉴权手段一起写进脚本里的 PUBLIC_ROUTES。",
  );
}

// 白名单里列了却已经不存在的条目要清掉——否则将来同名新接口会静默继承豁免
if (unusedWhitelist.size > 0) {
  failed = true;
  console.error("PUBLIC_ROUTES 里这些条目已经没有对应文件，请删除：");
  for (const stale of unusedWhitelist) console.error(`- ${stale}`);
}

if (failed) process.exit(1);

console.log(
  `鉴权检查通过：${checkedActions} 个 Server Action、${checkedRoutes} 个 Route Handler 方法，` +
    `另有 ${PUBLIC_ROUTES.size} 个已声明的公开接口`,
);
