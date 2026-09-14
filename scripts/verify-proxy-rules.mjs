function stripComments(source) {
  return source.replace(/#.*$/gm, "");
}

function caddyPathMatches(pattern, pathname) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*")}$`, "i").test(pathname);
}

function braceDelta(line) {
  let delta = 0;

  for (let cursor = 0; cursor < line.length; cursor += 1) {
    if (line[cursor] === "{" && line[cursor + 1] === "$") {
      const placeholderEnd = line.indexOf("}", cursor + 2);
      if (placeholderEnd === -1) break;
      cursor = placeholderEnd;
      continue;
    }
    if (line[cursor] === "{") delta += 1;
    if (line[cursor] === "}") delta -= 1;
  }

  return delta;
}

function openingBraceCount(line) {
  let count = 0;

  for (let cursor = 0; cursor < line.length; cursor += 1) {
    if (line[cursor] === "{" && line[cursor + 1] === "$") {
      const placeholderEnd = line.indexOf("}", cursor + 2);
      if (placeholderEnd === -1) break;
      cursor = placeholderEnd;
      continue;
    }
    if (line[cursor] === "{") count += 1;
  }

  return count;
}

function topLevelDirectives(body) {
  const directives = [];
  let depth = 0;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (depth === 0 && line !== "" && !line.startsWith("}")) {
      const statementCount = (line.match(/;/g) ?? []).length;
      const hasAdditionalBlock =
        openingBraceCount(line) > 1 || /;[^{}]*\{/.test(line);
      directives.push({
        name:
          statementCount > 1 || hasAdditionalBlock
            ? "multiple_directives"
            : line.split(/\s+/, 1)[0],
        line,
      });
    }
    depth += braceDelta(rawLine);
  }

  return directives;
}

function isModeledCaddyDirective({ name, line }) {
  if (name.startsWith("@")) {
    return /^@[A-Za-z0-9_-]+\s+path\s+\S+(?:\s+\S+)*$/.test(line);
  }

  if (name === "encode") return true;
  if (name === "request_body") return /^request_body\s*\{$/.test(line);
  if (name === "header") return /^header\s*\{$/.test(line);
  if (name === "respond") {
    return /^respond\s+@[A-Za-z0-9_-]+\s+\S+(?:\s+.*)?$/.test(line);
  }
  if (name === "reverse_proxy") return line === "reverse_proxy app:3000";
  return false;
}

function extractCaddyTopLevelBlocks(source) {
  const blocks = [];
  let depth = 0;
  let bodyStart = -1;
  let header = "";

  for (let cursor = 0; cursor < source.length; cursor += 1) {
    if (source[cursor] === "{" && source[cursor + 1] === "$") {
      const placeholderEnd = source.indexOf("}", cursor + 2);
      if (placeholderEnd === -1) break;
      cursor = placeholderEnd;
      continue;
    }

    if (source[cursor] === "{") {
      if (depth === 0) {
        const lineStart = source.lastIndexOf("\n", cursor - 1) + 1;
        header = source.slice(lineStart, cursor).trim();
        bodyStart = cursor + 1;
      }
      depth += 1;
      continue;
    }

    if (source[cursor] === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        blocks.push({ header, body: source.slice(bodyStart, cursor) });
      }
    }
  }

  return blocks;
}

function extractBlocks(source, directive) {
  const blocks = [];
  const startPattern = new RegExp(`\\b${directive}\\b([^{}]*)\\{`, "g");
  let match;

  while ((match = startPattern.exec(source)) !== null) {
    const openBrace = startPattern.lastIndex - 1;
    let depth = 1;
    let cursor = openBrace + 1;

    while (cursor < source.length && depth > 0) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }

    if (depth === 0) {
      const lineStart = source.lastIndexOf("\n", match.index - 1) + 1;
      const lineEndCandidate = source.indexOf("\n", cursor);
      const lineEnd =
        lineEndCandidate === -1 ? source.length : lineEndCandidate;
      blocks.push({
        header: match[1].trim(),
        body: source.slice(openBrace + 1, cursor - 1),
        raw: source.slice(lineStart, lineEnd),
      });
      startPattern.lastIndex = cursor;
    }
  }

  return blocks;
}

function hasCanonicalNginxLineGrammar(source) {
  return source.split(/\r?\n/).every((rawLine) => {
    const line = rawLine.trim();
    if (line === "") return true;
    if (line === "}") return true;
    if (/^[^{};]+\{$/.test(line)) return true;
    return /^[^{};]+;$/.test(line);
  });
}

export function findNextImageProxyViolations({ caddyfile, nginxConfig }) {
  const imagePath = new URL(
    "/_next/image?url=%2Fuploads%2Fprivate.png&w=640&q=75",
    "https://desk.example.test",
  ).pathname;
  const staticPath = new URL(
    "/_next/static/chunks/app.js?v=1",
    "https://desk.example.test",
  ).pathname;
  const violations = [];

  const activeCaddyfile = stripComments(caddyfile);
  const caddyBlocks = extractCaddyTopLevelBlocks(activeCaddyfile);
  // Caddy 默认先执行 respond、再执行 reverse_proxy；任何全局 order 都会让这个证明失效。
  const caddyHasGlobalOrder = caddyBlocks
    .filter((block) => block.header === "")
    .some((block) =>
      topLevelDirectives(block.body).some(
        (directive) => directive.name === "order",
      ),
    );
  if (caddyHasGlobalOrder) {
    violations.push("Caddyfile 使用了未建模的全局 order 指令");
  }

  const caddyTargets = caddyBlocks.filter(
    (block) =>
      /^\s*reverse_proxy\s+app:3000(?:\s|$)/m.test(block.body),
  );
  const caddyTarget = caddyTargets.length === 1 ? caddyTargets[0].body : null;

  if (caddyTargets.length === 0) {
    violations.push("Caddyfile 未找到反向代理 app:3000 的生产站点块");
  } else if (caddyTargets.length > 1) {
    violations.push("Caddyfile 存在多个反向代理 app:3000 的生产站点块");
  }

  const unmodeledCaddyDirectives = topLevelDirectives(caddyTarget ?? "")
    .filter((directive) => !isModeledCaddyDirective(directive));
  for (const directive of unmodeledCaddyDirectives) {
    violations.push(
      `Caddyfile 生产站点块含未建模的路由指令: ${directive.name}`,
    );
  }

  const caddyMatchers = [
    ...(caddyTarget ?? "").matchAll(
      /^\s*@([A-Za-z0-9_-]+)\s+path\s+([^\r\n]+)$/gm,
    ),
  ].map((matcher) => ({
    name: matcher[1],
    paths: matcher[2].trim().split(/\s+/),
  }));
  const caddyResponders = [
    ...(caddyTarget ?? "").matchAll(
      /^\s*respond\s+@([A-Za-z0-9_-]+)\s+([^\r\n]+)$/gm,
    ),
  ].map((responder) => ({
    name: responder[1],
    response: responder[2].trim(),
  }));
  const caddyRespondedPaths = caddyResponders.flatMap((responder) => {
    const matcher = caddyMatchers.find((candidate) => candidate.name === responder.name);
    return matcher?.paths ?? [];
  });
  const caddyRejectedPaths = caddyResponders.flatMap((responder) => {
    if (!/^404(?:\s|$)/.test(responder.response)) return [];
    const matcher = caddyMatchers.find((candidate) => candidate.name === responder.name);
    return matcher?.paths ?? [];
  });
  const caddyRejectsImage = caddyRejectedPaths.includes(imagePath);
  const caddyInterceptsStatic =
    /^\s*respond\s+(?!@)/m.test(caddyTarget ?? "") ||
    caddyRespondedPaths.some((pattern) => caddyPathMatches(pattern, staticPath));
  const caddyKeepsStatic =
    caddyTarget !== null &&
    !caddyInterceptsStatic &&
    /^\s*reverse_proxy\s+app:3000(?:\s|$)/m.test(caddyTarget);

  if (caddyTarget !== null && !caddyRejectsImage) {
    violations.push("Caddyfile 未对精确路径 /_next/image（含查询串）返回 404");
  }
  if (caddyTarget !== null && !caddyKeepsStatic) {
    violations.push("Caddyfile 的 /_next/static/* 不再落入应用反向代理");
  }

  const activeNginxConfig = stripComments(nginxConfig);
  const nginxServers = extractBlocks(activeNginxConfig, "server");
  const nginxTarget = nginxServers
    .filter((server) => /\blisten\s+(?:\[::\]:)?443\b/.test(server.body))
    .map((server) => ({
      server,
      locations: extractBlocks(server.body, "location"),
    }))
    .find(({ locations }) =>
      locations.some(
        (location) =>
          location.header === "/" &&
          /proxy_pass\s+http:\/\/127\.0\.0\.1:3100\s*;/.test(location.body),
      ),
    );
  const nginxLocations = nginxTarget?.locations ?? [];
  const nginxServerDirectives = topLevelDirectives(
    nginxTarget?.server.body ?? "",
  );
  if (
    nginxTarget &&
    !hasCanonicalNginxLineGrammar(nginxTarget.server.raw)
  ) {
    violations.push("Nginx 目标 server 不符合逐行规范");
  }

  const allowedNginxServerDirectives = new Set([
    "listen",
    "server_name",
    "ssl_certificate",
    "ssl_certificate_key",
    "include",
    "ssl_dhparam",
    "client_max_body_size",
    "add_header",
    "location",
  ]);
  const unmodeledNginxServerDirectives = nginxServerDirectives.filter(
    (directive) => !allowedNginxServerDirectives.has(directive.name),
  );
  for (const directive of unmodeledNginxServerDirectives) {
    violations.push(
      `Nginx 目标 server 含未建模的路由指令: ${directive.name}`,
    );
  }

  const nginxIncludes = nginxServerDirectives.filter(
    (directive) => directive.name === "include",
  );
  if (
    nginxTarget &&
    (nginxIncludes.length !== 1 ||
      nginxIncludes[0].line !==
        "include /etc/letsencrypt/options-ssl-nginx.conf;")
  ) {
    violations.push(
      "Nginx 目标 server 只允许 Certbot include: /etc/letsencrypt/options-ssl-nginx.conf",
    );
  }

  const nginxHasExactLocationSet =
    nginxLocations.length === 2 &&
    nginxLocations.filter((location) => location.header === "= /_next/image")
      .length === 1 &&
    nginxLocations.filter((location) => location.header === "/").length === 1;
  if (nginxTarget && !nginxHasExactLocationSet) {
    violations.push(
      "Nginx 目标 server 必须仅包含 location = /_next/image 与 location /",
    );
  }

  const nginxRootLocation = nginxLocations.find(
    (location) => location.header === "/",
  );
  const nginxRootDirectives = topLevelDirectives(nginxRootLocation?.body ?? "");
  const allowedNginxRootDirectives = new Set([
    "proxy_pass",
    "proxy_http_version",
    "proxy_set_header",
    "proxy_read_timeout",
    "proxy_send_timeout",
  ]);
  const unmodeledNginxRootDirectives = nginxRootDirectives.filter(
    (directive) => !allowedNginxRootDirectives.has(directive.name),
  );
  for (const directive of unmodeledNginxRootDirectives) {
    violations.push(
      `Nginx 根代理 location 含未建模的路由指令: ${directive.name}`,
    );
  }
  const nginxRootProxyPasses = nginxRootDirectives.filter(
    (directive) => directive.name === "proxy_pass",
  );
  const nginxRootHasUniqueProxy =
    nginxRootProxyPasses.length === 1 &&
    nginxRootProxyPasses[0].line ===
      "proxy_pass http://127.0.0.1:3100;";
  if (nginxRootLocation && !nginxRootHasUniqueProxy) {
    violations.push(
      "Nginx 根代理 location 必须只有一个无条件 proxy_pass http://127.0.0.1:3100",
    );
  }

  const nginxImageLocation = nginxLocations.find(
    (location) => location.header === "= /_next/image",
  );
  const nginxImageBody = (nginxImageLocation?.body ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const nginxRejectsImage =
    nginxHasExactLocationSet &&
    nginxImageBody === "return 404;";
  const nginxKeepsStatic =
    nginxHasExactLocationSet &&
    unmodeledNginxRootDirectives.length === 0 &&
    nginxRootHasUniqueProxy;

  if (!nginxRejectsImage) {
    violations.push("Nginx 未对精确路径 /_next/image（含查询串）返回 404");
  }
  if (!nginxKeepsStatic) {
    violations.push("Nginx 的 /_next/static/* 不再落入应用反向代理");
  }

  return violations;
}
