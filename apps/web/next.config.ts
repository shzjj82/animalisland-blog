import type { NextConfig } from "next";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// rewrites destination 在 `next build` 时固化；Docker 镜像构建须设 INTERNAL_API_URL=http://api:3001
// 本机默认跟 API_PORT 对齐，勿再用笼统的 PORT（会与 Next 的 PORT 冲突）
const apiOrigin = (
  process.env.INTERNAL_API_URL ||
  `http://127.0.0.1:${process.env.API_PORT || 3001}`
).replace(/\/$/, "");

type WebpackRule = {
  test?: RegExp | RegExp[];
  use?: unknown;
  sideEffects?: boolean;
  [key: string]: unknown;
};

function ruleTests(rule: WebpackRule): RegExp[] {
  const test = rule.test;
  if (test instanceof RegExp) {
    return [test];
  }
  if (Array.isArray(test)) {
    return test.filter((item): item is RegExp => item instanceof RegExp);
  }
  return [];
}

function ruleMatches(rule: WebpackRule, file: string) {
  return ruleTests(rule).some((test) => test.test(file));
}

function asUseArray(use: unknown): unknown[] | null {
  if (Array.isArray(use)) {
    return use;
  }
  if (typeof use === "string" || (use && typeof use === "object")) {
    return [use];
  }
  return null;
}

const lessLoader = {
  loader: require.resolve("less-loader"),
  options: {
    lessOptions: { javascriptEnabled: true },
  },
};

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["animal-island-ui", "@icon-park/react", "@myblog/shared"],
  poweredByHeader: false,
  // /api 走 rewrite 直连 Express，避免 App Router 的 [...path] 跟着整站编译（dev 里可卡 10–30s，浏览器会 Failed to fetch）
  // Docker 构建时必须 INTERNAL_API_URL=http://api:3001（见 Dockerfile）
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
      { source: "/uploads/:path*", destination: `${apiOrigin}/uploads/:path*` },
      { source: "/robots.txt", destination: `${apiOrigin}/robots.txt` },
      { source: "/sitemap.xml", destination: `${apiOrigin}/sitemap.xml` },
    ];
  },
  webpack(config, { isServer }) {
    const oneOfRule = config.module.rules.find(
      (rule: unknown): rule is { oneOf: WebpackRule[] } =>
        typeof rule === "object" &&
        rule !== null &&
        "oneOf" in rule &&
        Array.isArray((rule as { oneOf: unknown }).oneOf),
    );
    if (!oneOfRule) {
      return config;
    }

    if (isServer) {
      const ignoreRule = oneOfRule.oneOf.find((rule) => {
        const usePath =
          typeof rule.use === "string"
            ? rule.use
            : rule.use && typeof rule.use === "object" && "loader" in rule.use
              ? String((rule.use as { loader: string }).loader)
              : "";
        return (
          ruleMatches(rule, "file.css") &&
          !ruleMatches(rule, "file.module.css") &&
          usePath.includes("ignore-loader")
        );
      });
      if (ignoreRule) {
        oneOfRule.oneOf.unshift({
          ...ignoreRule,
          test: /\.less$/i,
        });
      }
      return config;
    }

    const cssRules = oneOfRule.oneOf.filter(
      (rule) =>
        ruleMatches(rule, "file.css") &&
        !ruleMatches(rule, "file.module.css") &&
        !ruleMatches(rule, "file.scss") &&
        Array.isArray(rule.use),
    );
    for (const cssRule of [...cssRules].reverse()) {
      const use = asUseArray(cssRule.use);
      if (!use) {
        continue;
      }
      oneOfRule.oneOf.unshift({
        ...cssRule,
        test: /\.less$/i,
        sideEffects: true,
        use: [...use, lessLoader],
      });
    }

    return config;
  },
};

export default nextConfig;
