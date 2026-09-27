// GET /api/me/list — 내 공유 목록(암호문)을 돌려준다. 서버는 못 연다(목록 열쇠가 서버로 안 온다)
// PUT /api/me/list — 목록 암호문을 바꾼다. x-if-match 로 «내가 읽은 판»일 때만 덮는다(CLI·관리 페이지가 동시에 고쳐도 안 잃게)
import { MAX_INDEX_BYTES, json, touch, uploaderOf } from "../../../lib/shared.js";

const keyOf = (who) => `u/${who.hash}/index`;

export async function onRequestGet({ request, env }) {
  const who = await uploaderOf(request, env);
  if (!who) return json({ error: "올리기 열쇠가 없거나 등록되지 않았습니다" }, 401);
  await touch(env, who);
  const obj = await env.BUCKET.get(keyOf(who));
  if (!obj) return json({ error: "아직 목록이 없습니다", empty: true }, 404, { "x-name": encodeURIComponent(who.name) });
  return new Response(obj.body, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      etag: obj.httpEtag,
      "x-name": encodeURIComponent(who.name),
    },
  });
}

export async function onRequestPut({ request, env }) {
  const who = await uploaderOf(request, env);
  if (!who) return json({ error: "올리기 열쇠가 없거나 등록되지 않았습니다" }, 401);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_INDEX_BYTES) return json({ error: "목록이 너무 큽니다" }, 413);
  if (body.byteLength < 29) return json({ error: "암호문이 아닙니다" }, 400);

  const ifMatch = request.headers.get("x-if-match");
  const opts = { httpMetadata: { contentType: "application/octet-stream" } };
  if (ifMatch) opts.onlyIf = { etagMatches: ifMatch.replace(/"/g, "") };
  const put = await env.BUCKET.put(keyOf(who), body, opts);
  if (!put) return json({ error: "그사이 목록이 바뀌었습니다 — 다시 읽고 시도하세요" }, 412);
  return json({ etag: put.httpEtag });
}
