import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type RouteContext = { params: Promise<{ path: string[] }> };

const PUBLIC_ROUTES = new Set([
  "POST api/auth/login",
  "GET api/auth/google/start",
  // Bước 2 của MFA Google: tự kiểm tra code + state + pendingToken, chưa có
  // token phiên nên phải để public như login.
  "POST api/auth/google/verify",
  "GET health",
  "GET api/health",
  "GET node/health",
  "GET python/health",
]);

const UPSTREAM_TIMEOUT_MS = (maxDuration - 10) * 1000;
const DEV_DEFAULT_URL = "http://127.0.0.1:5000";

function fail(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { success: false, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function resolveBaseUrl(): URL | string {
  const raw = process.env.BE_XNK_API_URL?.trim()
    || (process.env.NODE_ENV !== "production" ? DEV_DEFAULT_URL : "");
  if (!raw) return "Thiếu BE_XNK_API_URL trên server";

  try {
    const url = new URL(raw.endsWith("/") ? raw : `${raw}/`);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid protocol");
    return url;
  } catch {
    return "BE_XNK_API_URL không hợp lệ";
  }
}

async function forward(request: NextRequest, { params }: RouteContext) {
  const baseUrl = resolveBaseUrl();
  if (typeof baseUrl === "string") return fail(500, baseUrl);

  const { path } = await params;
  if (!path?.length || path.some((segment) => segment === "." || segment === ".." || segment.includes("/"))) {
    return fail(400, "Đường dẫn API không hợp lệ");
  }

  const joinedPath = path.join("/");
  const backendUrl = new URL(baseUrl);
  backendUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/${path.map(encodeURIComponent).join("/")}`;
  backendUrl.search = request.nextUrl.search;

  const isPublic = PUBLIC_ROUTES.has(`${request.method} ${joinedPath}`);
  const headerToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const cookieToken = request.cookies.get("xnk_auth_token")?.value?.trim();
  const sessionToken = headerToken || cookieToken;
  const hasFrontendSession = request.method === "GET"
    ? Boolean(cookieToken)
    : Boolean(headerToken && cookieToken && headerToken === cookieToken);

  if (!isPublic && !hasFrontendSession) return fail(401, "Chưa đăng nhập");

  const headers = new Headers({
    Accept: request.headers.get("accept") || "application/json",
  });
  if (sessionToken && !isPublic) headers.set("Authorization", `Bearer ${sessionToken}`);

  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);

  const apiKey = process.env.BE_XNK_API_KEY?.trim();
  if (apiKey) headers.set("X-Api-Key", apiKey);

  const cfId = process.env.CF_ACCESS_CLIENT_ID?.trim();
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET?.trim();
  if (cfId && cfSecret) {
    headers.set("CF-Access-Client-Id", cfId);
    headers.set("CF-Access-Client-Secret", cfSecret);
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const buffer = await request.arrayBuffer();
    body = buffer.byteLength ? buffer : undefined;
  }

  let response: Response;
  try {
    response = await fetch(backendUrl, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return fail(504, "Backend XNK phản hồi quá lâu");
    }
    console.error("[BE_XNK proxy]", backendUrl.origin, error);
    return fail(502, "Không thể kết nối backend XNK");
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") || "";
    console.error("[BE_XNK proxy] redirect", response.status, backendUrl.href, "->", location);
    const hint = location.startsWith("https://") && backendUrl.protocol === "http:"
      ? "Đổi BE_XNK_API_URL sang https://"
      : /cloudflareaccess\.com|\/cdn-cgi\/access/.test(location)
        ? "Domain BE đang bật Cloudflare Access, cần cấu hình CF_ACCESS_CLIENT_ID/SECRET hoặc bypass /api/*"
        : "Kiểm tra Redirect Rules / domain của BE_XNK_API_URL";
    return fail(502, `Backend XNK bị chuyển hướng (HTTP ${response.status}). ${hint}`, {
      upstreamStatus: response.status,
    });
  }

  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  for (const name of ["content-type", "content-disposition"]) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
