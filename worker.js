// 支持 Cloudflare 环境变量与 URL 参数自定义的订阅透传 Worker

// 默认配置（当 Cloudflare 后台未设置环境变量时自动生效）
const DEFAULT_CONFIG = {
  SUB_TOKEN: 'kjgx',                                                      // 默认自定义后缀
  CLASH_URL: 'https://sunmiao4458.github.io/free-proxy-airport/clash.yaml',// 默认 Clash YAML 源
  BASE64_URL: 'https://sunmiao4458.github.io/free-proxy-airport/sub/sub_merge.txt' // 默认 Base64 源
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();

    // 1. 优先读取 Cloudflare Dashboard 的环境变量，未设置则使用默认配置
    const subToken = (env.SUB_TOKEN || DEFAULT_CONFIG.SUB_TOKEN).trim().toLowerCase();
    
    // 2. 支持通过 URL 参数指定自定义源：例如 ?url=https://example.com/sub.yaml
    const customSourceUrl = url.searchParams.get('url');

    // 校验 Token 访问权限
    const isAuthorized = !subToken || path.includes(subToken) || url.searchParams.get('token') === subToken;

    if (!isAuthorized) {
      return new Response('404 Not Found', { status: 404 });
    }

    const prefix = subToken ? `/${subToken}` : '';

    // 首页 / 说明页面
    if (path === '/' || path === '' || path === prefix.toLowerCase() || path === `${prefix.toLowerCase()}/`) {
      return new Response(
        `Cloudflare 节点订阅服务运行成功！\n\n` +
        `当前生效后缀 Token: ${subToken || '未设置 (公开)'}\n\n` +
        `专属订阅链接：\n` +
        `1. Clash / Clash Verge 专用: ${url.origin}${prefix}/clash\n` +
        `2. 通用 Base64 (v2rayN / 小火箭): ${url.origin}${prefix}/sub\n\n` +
        `高级功能：支持 URL 动态参数转发\n` +
        `例如: ${url.origin}${prefix}/clash?url=你的任意第三方订阅链接\n`,
        { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }

    try {
      // 请求 Clash YAML 订阅
      if (path.includes('clash')) {
        const targetUrls = customSourceUrl
          ? [customSourceUrl]
          : buildSourceList(env.CLASH_URL || DEFAULT_CONFIG.CLASH_URL);

        const content = await fetchFirstAvailable(targetUrls);
        if (content) {
          return new Response(content, {
            status: 200,
            headers: {
              'Content-Type': 'text/yaml; charset=utf-8',
              'Cache-Control': 'max-age=1800, public',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      }

      // 请求通用 Base64 订阅
      if (path.includes('sub')) {
        const targetUrls = customSourceUrl
          ? [customSourceUrl]
          : buildSourceList(env.BASE64_URL || DEFAULT_CONFIG.BASE64_URL);

        const content = await fetchFirstAvailable(targetUrls);
        if (content) {
          return new Response(content, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'max-age=1800, public',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      }

      return new Response('404 Not Found', { status: 404 });

    } catch (err) {
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  }
};

// 自动构建 CDN 镜像备用源列表
function buildSourceList(primaryUrl) {
  if (primaryUrl.includes('github.io')) {
    const path = primaryUrl.split('github.io/')[1];
    const parts = path.split('/');
    const repo = parts[0];
    const filePath = parts.slice(1).join('/');
    return [
      primaryUrl,
      `https://fastly.jsdelivr.net/gh/${repo}@main/${filePath}`,
      `https://raw.githubusercontent.com/${repo}/main/${filePath}`
    ];
  }
  return [primaryUrl];
}

async function fetchFirstAvailable(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        cf: { cacheTtl: 1800 }
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 100) return text;
      }
    } catch (e) {}
  }
  return null;
}
