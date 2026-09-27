// 서버가 아는 것은 «암호문 덩어리»와 «누가 올렸나»뿐이다.
// 평문도, 여는 열쇠도, 올리기 열쇠 원문도 여기에 오지 않는다.
//
// 올리기 열쇠(ss_…)에서 클라이언트가 두 값을 따로 뽑는다:
//   인증값  = base64url(SHA-256("sealshare/auth/v1:"  + 열쇠))  → Bearer 로 서버에 간다. 서버는 이것의 sha256 만 저장한다
//   목록 열쇠 = SHA-256("sealshare/index/v1:" + 열쇠)          → 서버로 안 간다. 내 공유 목록(링크·열쇠 포함)을 봉한다
// 그래서 서버(운영자)는 열쇠 원문을 모르고, 목록 열쇠를 만들 수 없고, 남의 목록을 못 연다.

export const MAX_BYTES = 25 * 1024 * 1024; // 공유 한 건의 암호문 상한
export const MAX_INDEX_BYTES = 5 * 1024 * 1024; // 목록 암호문 상한
export const ID_RE = /^[A-Za-z0-9_-]{22}$/; // 16바이트 무작위 → base64url 22자

export async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomId(bytes = 16) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 인증값 → { name, hash }. UPLOADERS 비밀값은 {"<인증값의 sha256>": "이름"} 이다. 등록 안 됐으면 null. */
export async function uploaderOf(request, env) {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  let table = {};
  try {
    table = JSON.parse(env.UPLOADERS || "{}");
  } catch {
    return null;
  }
  const hash = await sha256hex(m[1]);
  return table[hash] ? { name: table[hash], hash } : null;
}

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
