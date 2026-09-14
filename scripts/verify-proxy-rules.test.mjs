import { describe, expect, it } from "vitest";

import { findNextImageProxyViolations } from "./verify-proxy-rules.mjs";

const safeCaddyfile = `
desk.example.test {
  encode zstd gzip
  request_body {
    max_size 32MB
  }
  header {
    X-Content-Type-Options nosniff
  }
  @next_image path /_next/image
  respond @next_image 404
  reverse_proxy app:3000
}
`;

const safeNginxConfig = `
server {
  listen 80;
  location / { return 301 https://desk.example.test$request_uri; }
}
server {
  listen 443 ssl;
  server_name desk.example.test;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  location = /_next/image {
    return 404;
  }
  location / {
    proxy_pass http://127.0.0.1:3100;
  }
}
`;

function verify({ caddyfile = safeCaddyfile, nginxConfig = safeNginxConfig } = {}) {
  return findNextImageProxyViolations({ caddyfile, nginxConfig });
}

describe("production proxy security rules", () => {
  it("accepts the current shape where default order runs respond before reverse_proxy", () => {
    expect(verify()).toEqual([]);
  });

  it("does not confuse an earlier unrelated Caddy matcher with the image matcher", () => {
    const caddyfile = safeCaddyfile.replace(
      "  @next_image",
      "  @health path /health\n  respond @health 200\n  @next_image",
    );

    expect(verify({ caddyfile })).toEqual([]);
  });

  it("does not accept an image rule from an unrelated Caddy site", () => {
    const caddyfile = `
target.example.test {
  reverse_proxy app:3000
}
unrelated.example.test {
  @next_image path /_next/image
  respond @next_image 404
  reverse_proxy unrelated:3000
}
`;

    expect(verify({ caddyfile })).toContain(
      "Caddyfile 未对精确路径 /_next/image（含查询串）返回 404",
    );
  });

  it("fails explicitly when no Caddy production site targets app:3000", () => {
    const caddyfile = `
unrelated.example.test {
  @next_image path /_next/image
  respond @next_image 404
  reverse_proxy unrelated:3000
}
`;

    expect(verify({ caddyfile })).toContain(
      "Caddyfile 未找到反向代理 app:3000 的生产站点块",
    );
  });

  it("fails explicitly when multiple Caddy production sites target app:3000", () => {
    const caddyfile = `${safeCaddyfile}
second.example.test {
  reverse_proxy app:3000
}
`;

    expect(verify({ caddyfile })).toContain(
      "Caddyfile 存在多个反向代理 app:3000 的生产站点块",
    );
  });

  it("rejects wildcard Caddy image matchers because the block must be exact", () => {
    const caddyfile = safeCaddyfile.replace("/_next/image", "/_next/image*");

    expect(verify({ caddyfile })).toContain(
      "Caddyfile 未对精确路径 /_next/image（含查询串）返回 404",
    );
  });

  it("rejects broad Caddy interception regardless of response status", () => {
    const caddyfile = safeCaddyfile.replace(
      "  reverse_proxy",
      "  @unsafe_next path /_next/*\n  respond @unsafe_next 403\n  reverse_proxy",
    );

    expect(verify({ caddyfile })).toContain(
      "Caddyfile 的 /_next/static/* 不再落入应用反向代理",
    );
  });

  it("rejects broad Caddy interception case-insensitively", () => {
    const caddyfile = safeCaddyfile.replace(
      "  reverse_proxy",
      "  @unsafe_next path /_NEXT/*\n  respond @unsafe_next 403\n  reverse_proxy",
    );

    expect(verify({ caddyfile })).toContain(
      "Caddyfile 的 /_next/static/* 不再落入应用反向代理",
    );
  });

  it("rejects any global Caddy order override", () => {
    const caddyfile = `
{
  order reverse_proxy before respond
}
${safeCaddyfile}
`;

    expect(verify({ caddyfile })).toContain(
      "Caddyfile 使用了未建模的全局 order 指令",
    );
  });

  it("rejects unmodeled Caddy routing directives in the production site", () => {
    const caddyfile = safeCaddyfile.replace(
      "  @next_image",
      "  redir /_next/image /login\n  @next_image",
    );

    expect(verify({ caddyfile })).toContain(
      "Caddyfile 生产站点块含未建模的路由指令: redir",
    );
  });

  it("fails closed for every unmodeled Caddy routing directive", () => {
    const directives = [
      ["route", "route {}"],
      ["handle", "handle {}"],
      ["handle_path", "handle_path /_next/* {}"],
      ["rewrite", "rewrite * /login"],
      ["abort", "abort"],
      ["error", "error 403"],
      ["invoke", "invoke named_routes"],
    ];

    for (const [name, line] of directives) {
      const caddyfile = safeCaddyfile.replace(
        "  @next_image",
        `  ${line}\n  @next_image`,
      );
      expect(verify({ caddyfile })).toContain(
        `Caddyfile 生产站点块含未建模的路由指令: ${name}`,
      );
    }
  });

  it("rejects broad Nginx interception regardless of response status", () => {
    const nginxConfig = safeNginxConfig.replace(
      `    return 404;
  }
  location / {`,
      `    return 404;
  }
  location ^~ /_next/ {
    return 403;
  }
  location / {`,
    );

    expect(verify({ nginxConfig })).toContain(
      "Nginx 的 /_next/static/* 不再落入应用反向代理",
    );
  });

  it("rejects conditional Nginx image returns that can continue to proxy", () => {
    const nginxConfig = safeNginxConfig.replace(
      `location = /_next/image {
    return 404;
  }`,
      `location = /_next/image {
    if ($arg_url = "") {
      return 404;
    }
    proxy_pass http://127.0.0.1:3100;
  }`,
    );

    expect(verify({ nginxConfig })).toContain(
      "Nginx 未对精确路径 /_next/image（含查询串）返回 404",
    );
  });

  it("rejects server-level Nginx return directives", () => {
    const nginxConfig = safeNginxConfig.replace(
      "  location = /_next/image",
      "  return 302 /login;\n  location = /_next/image",
    );

    expect(verify({ nginxConfig })).toContain(
      "Nginx 目标 server 含未建模的路由指令: return",
    );
  });

  it("rejects trailing tokens after an Nginx closing brace", () => {
    const nginxConfig = safeNginxConfig.replace(
      "  }\n}\n",
      "  }\n} return 302 /login;\n",
    );

    expect(verify({ nginxConfig })).toContain(
      "Nginx 目标 server 不符合逐行规范",
    );
  });

  it("rejects additional Nginx include directives", () => {
    const nginxConfig = safeNginxConfig.replace(
      "  location = /_next/image",
      "  include /etc/nginx/conf.d/routing.conf;\n  location = /_next/image",
    );

    expect(verify({ nginxConfig })).toContain(
      "Nginx 目标 server 只允许 Certbot include: /etc/letsencrypt/options-ssl-nginx.conf",
    );
  });

  it("rejects additional PCRE Nginx locations", () => {
    const nginxConfig = safeNginxConfig.replace(
      `    return 404;
  }
  location / {`,
      `    return 404;
  }
  location ~ \\A/_next/static {
    return 403;
  }
  location / {`,
    );

    expect(verify({ nginxConfig })).toContain(
      "Nginx 目标 server 必须仅包含 location = /_next/image 与 location /",
    );
  });

  it("rejects server-level routing hidden after an allowed same-line directive", () => {
    const nginxConfig = safeNginxConfig.replace(
      "  location = /_next/image",
      "  add_header X-Test safe; return 302 /login;\n  location = /_next/image",
    );

    expect(verify({ nginxConfig })).toContain(
      "Nginx 目标 server 含未建模的路由指令: multiple_directives",
    );
  });

  it("rejects server-level Nginx rewrite directives", () => {
    const nginxConfig = safeNginxConfig.replace(
      "  location = /_next/image",
      "  rewrite ^/_next/image$ /not-image last;\n  location = /_next/image",
    );

    expect(verify({ nginxConfig })).toContain(
      "Nginx 目标 server 含未建模的路由指令: rewrite",
    );
  });

  it("rejects server-level Nginx error_page directives", () => {
    const nginxConfig = safeNginxConfig.replace(
      "  location = /_next/image",
      "  error_page 500 /50x.html;\n  location = /_next/image",
    );

    expect(verify({ nginxConfig })).toContain(
      "Nginx 目标 server 含未建模的路由指令: error_page",
    );
  });

  it("rejects nested locations inside the Nginx root proxy", () => {
    const nginxConfig = safeNginxConfig.replace(
      `location / {
    proxy_pass http://127.0.0.1:3100;
  }`,
      `location / {
    proxy_pass http://127.0.0.1:3100;
    location /_next/static/ {
      return 403;
    }
  }`,
    );

    expect(verify({ nginxConfig })).toContain(
      "Nginx 根代理 location 含未建模的路由指令: location",
    );
  });

  it("rejects nested routing hidden after an allowed same-line root directive", () => {
    const nginxConfig = safeNginxConfig.replace(
      `location / {
    proxy_pass http://127.0.0.1:3100;
  }`,
      `location / {
    proxy_set_header X-Test safe; location /_next/static/ { return 403; }
    proxy_pass http://127.0.0.1:3100;
  }`,
    );

    expect(verify({ nginxConfig })).toContain(
      "Nginx 根代理 location 含未建模的路由指令: multiple_directives",
    );
  });

  it("rejects an empty nested location hidden after a same-line root directive", () => {
    const nginxConfig = safeNginxConfig.replace(
      `location / {
    proxy_pass http://127.0.0.1:3100;
  }`,
      `location / {
    proxy_set_header X-Test safe; location /_next/static/ {}
    proxy_pass http://127.0.0.1:3100;
  }`,
    );

    expect(verify({ nginxConfig })).toContain(
      "Nginx 根代理 location 含未建模的路由指令: multiple_directives",
    );
  });

  it("fails closed for terminal directives in the Nginx root proxy", () => {
    const directives = [
      ["return", "return 403;"],
      ["rewrite", "rewrite ^ /other last;"],
      ["try_files", "try_files $uri /index.html;"],
      ["error_page", "error_page 500 /50x.html;"],
      ["proxy_intercept_errors", "proxy_intercept_errors on;"],
    ];

    for (const [name, line] of directives) {
      const nginxConfig = safeNginxConfig.replace(
        `location / {
    proxy_pass http://127.0.0.1:3100;
  }`,
        `location / {
    ${line}
    proxy_pass http://127.0.0.1:3100;
  }`,
      );
      expect(verify({ nginxConfig })).toContain(
        `Nginx 根代理 location 含未建模的路由指令: ${name}`,
      );
    }
  });

  it("ignores commented rules", () => {
    const caddyfile = safeCaddyfile.replace(
      "  reverse_proxy",
      "  # @unsafe_next path /_next/*\n  # respond @unsafe_next 403\n  reverse_proxy",
    );
    const nginxConfig = safeNginxConfig.replace(
      "  location / {",
      "  # location ^~ /_next/ { return 403; }\n  location / {",
    );

    expect(verify({ caddyfile, nginxConfig })).toEqual([]);
  });

  it("does not accept commented image rules as active containment", () => {
    const caddyfile = safeCaddyfile
      .replace("  @next_image", "  # @next_image")
      .replace("  respond @next_image", "  # respond @next_image");
    const nginxConfig = safeNginxConfig.replace(
      `  location = /_next/image {
    return 404;
  }`,
      `  # location = /_next/image {
  #   return 404;
  # }`,
    );
    const violations = verify({ caddyfile, nginxConfig });

    expect(violations).toContain(
      "Caddyfile 未对精确路径 /_next/image（含查询串）返回 404",
    );
    expect(violations).toContain(
      "Nginx 未对精确路径 /_next/image（含查询串）返回 404",
    );
  });

  it("does not accept an image rule from an unrelated Nginx server", () => {
    const unrelatedServer = `
server {
  listen 443 ssl;
  server_name unrelated.example.test;
  location = /_next/image {
    return 404;
  }
  location / {
    proxy_pass http://127.0.0.1:9999;
  }
}
`;
    const targetWithoutImageRule = safeNginxConfig.replace(
      `  location = /_next/image {
    return 404;
  }
`,
      "",
    );

    expect(
      verify({ nginxConfig: unrelatedServer + targetWithoutImageRule }),
    ).toContain("Nginx 未对精确路径 /_next/image（含查询串）返回 404");
  });
});
