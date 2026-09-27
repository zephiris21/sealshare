// GET /s/:id — 보기 화면. 어느 링크든 같은 정적 페이지를 준다(내용은 브라우저가 # 뒤 열쇠로 푼다).
//
// 🔑 이 페이지의 주소창에 열쇠가 있다 — 여기에 남의 스크립트가 끼면 열쇠가 샌다. 그래서 엄격한 CSP 를 건다:
//   우리 스크립트만 돌고, 틀은 frame.<이 주소>만, 서버 통신은 같은 주소만.
//   (공유된 HTML 은 frame.… 에서 돌아 이 정책을 물려받지 않는다. 마크다운 srcdoc 은 물려받지만 스크립트가 없다)
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const frameOrigin = `${url.protocol}//frame.${url.host}`;
  url.pathname = "/viewer";
  const res = await env.ASSETS.fetch(new Request(url.toString(), request));
  const h = new Headers(res.headers);
  h.set("cache-control", "no-cache");
  h.set("x-frame-options", "DENY"); // 보기 화면은 남의 페이지에 끼워 넣지 못하게
  h.set("content-security-policy", [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    `frame-src ${frameOrigin}`,
    "base-uri 'none'",
    "form-action 'none'",
    // ⚠ frame-ancestors 는 넣지 않는다 — 마크다운 srcdoc 틀이 이 정책을 물려받아 «자기 자신이 틀에 못 들어가» 하얗게 빈다(2026-09-27 실측).
    //   남의 페이지에 끼워 넣기는 위의 X-Frame-Options(물려받지 않는다)가 막는다.
  ].join("; "));
  return new Response(res.body, { status: res.status, headers: h });
}
