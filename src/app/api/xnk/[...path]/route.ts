import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 180;

type RouteContext = { params: Promise<{ path: string[] }> };

async function forward(request: NextRequest, { params }: RouteContext) {
  const baseUrl = process.env.BE_XNK_API_URL?.trim();
  // const gatewayToken = process.env.BE_XNK_API_BEARER_TOKEN?.trim();
  if (!baseUrl ) {
    return NextResponse.json({ success: false, message: "Thiếu BE_XNK_API_URL hoặc BE_XNK_API_BEARER_TOKEN trên server" }, { status: 500 });
  }

  let backendUrl: URL;
  try {
    backendUrl = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    if (!["http:", "https:"].includes(backendUrl.protocol)) throw new Error("Invalid protocol");
  } catch {
    return NextResponse.json({ success: false, message: "BE_XNK_API_URL không hợp lệ" }, { status: 500 });
  }

  const { path } = await params;
  if (!path.length || path.some((segment) => segment === "." || segment === ".." || segment.includes("/"))) {
    return NextResponse.json({ success: false, message: "Đường dẫn API không hợp lệ" }, { status: 400 });
  }
  backendUrl.pathname = `${backendUrl.pathname.replace(/\/$/, "")}/${path.map(encodeURIComponent).join("/")}`;
  backendUrl.search = request.nextUrl.search;

  const isLogin = path.join("/") === "api/auth/login" && request.method === "POST";
  const isHealth = request.method === "GET" && (path.join("/") === "health" || path.join("/") === "api/health");
  const headerToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const cookieToken = request.cookies.get("xnk_auth_token")?.value?.trim();
  const hasFrontendSession = request.method === "GET"
    ? Boolean(cookieToken)
    : Boolean(headerToken && cookieToken && headerToken === cookieToken);
  if (!isLogin && !isHealth && !hasFrontendSession) {
    return NextResponse.json({ success: false, message: "Chưa đăng nhập" }, { status: 401 });
  }

  const headers = new Headers({
    Accept: request.headers.get("accept") || "application/json",
    // Authorization: `Bearer ${gatewayToken}`,
  });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);

  try {
    const response = await fetch(backendUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
    });
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    const responseType = response.headers.get("content-type");
    if (responseType) responseHeaders.set("Content-Type", responseType);
    return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ success: false, message: "Không thể kết nối backend XNK" }, { status: 502 });
  }
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
