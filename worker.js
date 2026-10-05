/**
 * Free Proxy Airport · Cloudflare Worker Edition
 *
 * 架构：
 *   原项目生成的 Clash/Mihomo YAML
 *              ↓
 *        Cloudflare Worker
 *              ↓
 *           Workers KV
 *              ↓
 *        私密订阅地址
 *
 * 本 Worker 不运行 Python / Mihomo / 节点测速。
 *
 * 订阅保护：
 *   SUB_PATH 是 Cloudflare Secret
 *
 *   SUB_PATH 未设置
 *       ↓
 *   订阅关闭
 *
 *   SUB_PATH 设置成功
 *       ↓
 *   只有 /<SUB_PATH> 可以订阅
 *
 * 管理更新：
 *   ADMIN_TOKEN 是 Cloudflare Secret
 *
 *   POST /api/update
 *   Authorization: Bearer <ADMIN_TOKEN>
 */

const VERSION = "cf-v3";

const SUBSCRIPTION_KEY = "subscription/clash.yaml";
const META_KEY = "subscription/meta.json";

const MIN_BYTES = 256;
const FETCH_TIMEOUT_MS = 15000;

// 原项目当前生成好的 Clash/Mihomo YAML。
// 第一来源失败时尝试第二来源。
const UPSTREAMS = [
  "https://raw.githubusercontent.com/sunmiao4458/free-proxy-airport/main/output/clash.yaml",
  "https://sunmiao4458.github.io/free-proxy-airport/clash.yaml",
];


// ===============================
// 基础响应函数
// ===============================

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}


function text(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}


function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    },
  });
}


// ===============================
// Secret 处理
// ===============================

function normalizeSecret(value) {
  return String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}


function getSubPath(env) {
  return normalizeSecret(env.SUB_PATH);
}


/**
 * SUB_PATH 就是订阅总开关。
 *
 * 没有 SUB_PATH
 *    => 关闭
 *
 * SUB_PATH 不符合格式
 *    => 关闭
 *
 * 合法 SUB_PATH
 *    => 开启
 */
function subscriptionEnabled(env) {
  const token = getSubPath(env);

  return (
    Boolean(token) &&
    /^[A-Za-z0-9_-]{12,128}$/.test(token)
  );
}


// ===============================
// 订阅地址验证
// ===============================

function subscriptionAuthorized(url, env) {
  const token = getSubPath(env);

  if (!subscriptionEnabled(env)) {
    return false;
  }

  const path =
    url.pathname.replace(/\/+$/, "") || "/";

  return (
    path === `/${token}` ||
    path === `/${token}/clash.yaml` ||
    path === `/${token}/subscription`
  );
}


// ===============================
// 管理员 Token 验证
// ===============================

function adminAuthorized(request, env) {
  const expected =
    String(env.ADMIN_TOKEN || "").trim();

  if (!expected) {
    return false;
  }

  const authorization =
    request.headers.get("Authorization") || "";

  return authorization === `Bearer ${expected}`;
}


// ===============================
// Clash YAML 验证
// ===============================

function isValidClashYaml(value) {
  if (typeof value !== "string") {
    return false;
  }

  const bytes =
    new TextEncoder().encode(value).byteLength;

  if (bytes < MIN_BYTES) {
    return false;
  }

  // 防止 GitHub / Pages 临时返回 HTML 错误页面
  if (/^\s*(<!doctype|<html[\s>])/i.test(value)) {
    return false;
  }

  const hasProxies =
    /^proxies\s*:/m.test(value);

  const hasGroups =
    /^proxy-groups\s*:/m.test(value);

  const hasRules =
    /^rules\s*:/m.test(value);

  return hasProxies && (hasGroups || hasRules);
}


// ===============================
// 带超时的上游请求
// ===============================

async function fetchWithTimeout(
  url,
  timeoutMs = FETCH_TIMEOUT_MS
) {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort("timeout"),
    timeoutMs
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,

      headers: {
        "User-Agent":
          `free-proxy-airport-${VERSION}`,

        "Accept":
          "text/yaml, application/yaml, text/plain, */*",
      },
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    return response;

  } finally {
    clearTimeout(timer);
  }
}


// ===============================
// 获取上游订阅
// ===============================

async function fetchUpstream() {
  const failures = [];

  for (const source of UPSTREAMS) {
    try {
      const response =
        await fetchWithTimeout(source);

      const body =
        await response.text();

      if (!isValidClashYaml(body)) {
        throw new Error(
          "response does not look like Clash/Mihomo YAML"
        );
      }

      const bytes =
        new TextEncoder().encode(body).byteLength;

      return {
        source,
        body,
        bytes,
      };

    } catch (error) {
      failures.push({
        source,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  const detail =
    failures
      .map(
        (item) =>
          `${item.source}: ${item.error}`
      )
      .join(" | ");

  throw new Error(
    `all upstreams failed: ${detail}`
  );
}


// ===============================
// 保存到 KV
// ===============================

async function saveSubscription(env, result) {
  const updatedAt =
    new Date().toISOString();

  await env.SUBSCRIPTIONS.put(
    SUBSCRIPTION_KEY,
    result.body
  );

  await env.SUBSCRIPTIONS.put(
    META_KEY,
    JSON.stringify({
      worker_version: VERSION,
      updated_at: updatedAt,
      source: result.source,
      bytes: result.bytes,
      status: "ok",
    })
  );

  return {
    updated_at: updatedAt,
    bytes: result.bytes,
  };
}


// ===============================
// 刷新订阅
// ===============================

async function refreshSubscription(env) {
  const result =
    await fetchUpstream();

  return saveSubscription(
    env,
    result
  );
}


// ===============================
// 获取 KV 里的订阅
// ===============================

async function getStoredSubscription(env) {
  const value =
    await env.SUBSCRIPTIONS.get(
      SUBSCRIPTION_KEY,
      {
        type: "text",
      }
    );

  if (!value) {
    throw new Error(
      "no subscription is stored in KV yet; run /api/update once with ADMIN_TOKEN"
    );
  }

  return value;
}


// ===============================
// 处理状态信息
// ===============================

function safeMeta(raw) {
  if (!raw) {
    return null;
  }

  try {
    const parsed =
      JSON.parse(raw);

    return {
      worker_version:
        parsed.worker_version ||
        VERSION,

      updated_at:
        parsed.updated_at || null,

      bytes:
        Number.isFinite(parsed.bytes)
          ? parsed.bytes
          : null,

      status:
        parsed.status || null,
    };

  } catch {
    return null;
  }
}


async function getPublicStatus(env) {
  const [
    rawMeta,
    subscription
  ] = await Promise.all([
    env.SUBSCRIPTIONS.get(
      META_KEY,
      { type: "text" }
    ),

    env.SUBSCRIPTIONS.get(
      SUBSCRIPTION_KEY,
      { type: "text" }
    ),
  ]);

  const meta =
    safeMeta(rawMeta);

  return {
    ok: true,

    worker_version:
      VERSION,

    subscription_enabled:
      subscriptionEnabled(env),

    kv_ready:
      Boolean(subscription),

    last_update:
      meta?.updated_at || null,

    bytes:
      meta?.bytes ||
      (
        subscription
          ? new TextEncoder()
              .encode(subscription)
              .byteLength
          : 0
      ),

    status:
      meta?.status ||
      (
        subscription
          ? "ok"
          : "empty"
      ),
  };
}


// ===============================
// 手动更新 API
// ===============================

async function handleUpdate(
  request,
  env
) {
  if (request.method !== "POST") {
    return text(
      "Method Not Allowed",
      405,
      {
        allow: "POST",
      }
    );
  }

  if (!adminAuthorized(request, env)) {
    return json(
      {
        ok: false,
        error: "Unauthorized",
      },
      401
    );
  }

  try {
    const result =
      await refreshSubscription(env);

    return json({
      ok: true,
      ...result,
    });

  } catch (error) {
    console.error(
      "manual refresh failed",
      error
    );

    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      502
    );
  }
}


// ===============================
// 404
// ===============================

function notFound() {
  return text(
    "Not Found",
    404,
    {
      "x-robots-tag":
        "noindex, nofollow, noarchive",
    }
  );
}


// ===============================
// 首页
// ===============================

const LANDING_PAGE = `
<!doctype html>
<html lang="zh-CN">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<meta
  name="robots"
  content="noindex,nofollow,noarchive"
>

<title>
Free Proxy Airport · Cloudflare
</title>

<style>

body{
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  max-width:760px;

  margin:48px auto;

  padding:0 20px;

  line-height:1.7;

  color:#111827;
}

.box{
  background:#f7f7f8;

  border-radius:14px;

  padding:18px;

  margin:16px 0;
}

code{
  background:#eef0f3;

  border-radius:6px;

  padding:2px 6px;

  word-break:break-all;
}

small{
  color:#6b7280;
}

</style>

</head>

<body>

<h1>
Free Proxy Airport · Cloudflare Edition
</h1>

<div class="box">

<strong>
订阅地址已启用私密后缀保护。
</strong>

<p>
公开的 Worker 地址不会直接返回 Clash / Mihomo 订阅。
</p>

</div>

<div class="box">

<p>
管理员可以通过 Cron 自动更新。
</p>

<p>
也可以使用受保护的
<code>POST /api/update</code>
手动更新。
</p>

<p>
<a href="/api/status">
查看非敏感状态
</a>
</p>

</div>

<small>
Cloudflare Worker subscription mirror
</small>

</body>

</html>
`;


// ===============================
// Worker
// ===============================

export default {

  async fetch(
    request,
    env,
    ctx
  ) {

    const url =
      new URL(request.url);


    // 只允许 GET / HEAD / POST
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.method !== "POST"
    ) {

      return text(
        "Method Not Allowed",
        405,
        {
          allow:
            "GET, HEAD, POST",
        }
      );
    }


    // 首页
    if (
      (
        url.pathname === "/" ||
        url.pathname === "/index.html"
      ) &&
      request.method !== "POST"
    ) {

      if (
        request.method === "HEAD"
      ) {

        return new Response(
          null,
          {
            status: 200,
            headers: {
              "cache-control":
                "public, max-age=300",
            },
          }
        );

      }

      return html(
        LANDING_PAGE
      );
    }


    // 状态接口
    if (
      url.pathname === "/api/status" &&
      request.method !== "POST"
    ) {

      try {

        const status =
          await getPublicStatus(env);

        return json(status);

      } catch (error) {

        console.error(
          "status failed",
          error
        );

        return json(
          {
            ok: false,
            error:
              "Status unavailable",
          },
          500
        );
      }
    }


    // 手动更新
    if (
      url.pathname === "/api/update"
    ) {

      return handleUpdate(
        request,
        env
      );
    }


    // 旧公开接口强制关闭
    if (
      url.pathname === "/clash.yaml" ||
      url.pathname === "/subscription"
    ) {

      return notFound();
    }


    // 私密订阅
    if (
      request.method === "GET" ||
      request.method === "HEAD"
    ) {

      if (
        subscriptionAuthorized(
          url,
          env
        )
      ) {

        try {

          const body =
            await getStoredSubscription(
              env
            );

          return new Response(
            request.method === "HEAD"
              ? null
              : body,

            {
              status: 200,

              headers: {

                "content-type":
                  "text/yaml; charset=utf-8",

                "cache-control":
                  "no-store",

                "content-disposition":
                  'inline; filename="clash.yaml"',

                "x-content-type-options":
                  "nosniff",

                "x-robots-tag":
                  "noindex, nofollow, noarchive",

                "referrer-policy":
                  "no-referrer",

                "x-worker-version":
                  VERSION,
              },
            }
          );

        } catch (error) {

          console.error(
            "subscription failed",
            error
          );

          return text(
            "Subscription unavailable",
            503,
            {
              "retry-after":
                "300",
            }
          );
        }
      }
    }


    return notFound();
  },


  // =============================
  // Cron
  // =============================

  async scheduled(
    controller,
    env,
    ctx
  ) {

    ctx.waitUntil(

      refreshSubscription(env)
        .catch((error) => {

          console.error(
            `cron refresh failed (${
              controller.cron || "unknown cron"
            })`,
            error
          );

        })

    );
  },

};
