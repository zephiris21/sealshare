// 서버가 아는 것은 «암호문 덩어리»와 «누가 올렸나»뿐이다.
// 평문도, 여는 열쇠도, 올리기 열쇠 원문도 여기에 오지 않는다.
//
// 올리기 열쇠(ss_…)에서 클라이언트가 두 값을 따로 뽑는다:
//   인증값  = base64url(SHA-256("sealshare/auth/v1:"  + 열쇠))  → Bearer 로 서버에 간다. 서버는 이것의 sha256 만 저장한다
//   목록 열쇠 = SHA-256("sealshare/index/v1:" + 열쇠)          → 서버로 안 간다. 내 공유 목록(링크·열쇠 포함)을 봉한다
// 그래서 서버(운영자)는 열쇠 원문을 모르고, 목록 열쇠를 만들 수 없고, 남의 목록을 못 연다.
//
// 명단(올릴 수 있는 사람)은 R2 의 admin/people.json 에 둔다 — {이름: {hash, added}}. 운영자 페이지가 고친다.
// 운영자 인증은 따로다: 운영자 열쇠에서 같은 식으로 뽑은 인증값의 sha256 을 Pages 비밀값 ADMIN_HASH 에 둔다.

export const MAX_BYTES = 25 * 1024 * 1024; // 공유 한 건의 암호문 상한
export const MAX_INDEX_BYTES = 5 * 1024 * 1024; // 목록 암호문 상한
export const ID_RE = /^[A-Za-z0-9_-]{22}$/; // 16바이트 무작위 → base64url 22자
export const HASH_RE = /^[0-9a-f]{64}$/;
export const NAME_RE = /^[^\s/\\]{1,40}$/u;
const PEOPLE = "admin/people.json";

export async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomId(bytes = 16) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bearer(request) {
  const m = (request.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

export async function loadPeople(env) {
  const obj = await env.BUCKET.get(PEOPLE);
  return obj ? await obj.json() : {};
}
export async function savePeople(env, people) {
  await env.BUCKET.put(PEOPLE, JSON.stringify(people), { httpMetadata: { contentType: "application/json" } });
}

/** 인증값 → { name, hash }. 명단에 없으면 null. */
export async function uploaderOf(request, env) {
  const b = bearer(request);
  if (!b) return null;
  const hash = await sha256hex(b);
  const people = await loadPeople(env);
  for (const [name, p] of Object.entries(people)) if (p.hash === hash) return { name, hash };
  return null;
}

/** 운영자인가 — ADMIN_HASH(운영자 인증값의 sha256)와 맞으면 true */
export async function isAdmin(request, env) {
  const b = bearer(request);
  return !!(b && env.ADMIN_HASH && (await sha256hex(b)) === env.ADMIN_HASH);
}

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
