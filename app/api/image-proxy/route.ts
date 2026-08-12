import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/image-proxy?url=...
 *
 * 图片代理：服务端获取跨域图片（TOS 公共 URL），
 * 解决 html-to-image 截图时 canvas 被 cross-origin 图片 tainted 的 CORS 问题。
 *
 * 安全限制：仅允许 volces.com 域名的 TOS 图片
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "缺少 url 参数" }, { status: 400 });
  }

  // 安全校验：仅允许 TOS 域名
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "无效的 URL" }, { status: 400 });
  }

  if (!parsedUrl.hostname.includes("volces.com")) {
    return NextResponse.json({ error: "仅允许 TOS 图片" }, { status: 403 });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return NextResponse.json({ error: `图片获取失败: ${response.status}` }, { status: response.status });
    }

    const blob = await response.blob();
    return new NextResponse(blob, {
      headers: {
        "Content-Type": blob.type || "image/png",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "图片获取失败", detail: e instanceof Error ? e.message : "unknown" },
      { status: 502 }
    );
  }
}
