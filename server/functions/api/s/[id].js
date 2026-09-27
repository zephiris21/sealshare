// GET /api/s/:id    — 암호문을 내준다(링크를 가진 누구나. 서버는 열 수 없다)
// DELETE /api/s/:id — 링크를 끈다(올릴 때 받은 끄기 열쇠, 또는 올린 사람의 올리기 열쇠)
import { ID_RE, json, sha256hex, uploaderOf } from "../../../lib/shared.js";

export async function onRequestGet({ params, env }) {
  if (!ID_RE.test(params.id)) return json({ error: "없는 링크입니다" }, 404);
  const obj = await env.BUCKET.get(`s/${params.id}`);
  if (!obj) return json({ error: "없거나 꺼진 링크입니다" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": "application/octet-stream",
      // 한 번 올린 스냅샷은 바뀌지 않는다. 다만 끄면 곧 사라져야 하니 길게 두지 않는다
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function onRequestDelete({ params, request, env }) {
  if (!ID_RE.test(params.id)) return json({ error: "없는 링크입니다" }, 404);
  const head = await env.BUCKET.head(`s/${params.id}`);
  if (!head) return json({ ok: true, gone: true });

  const del = request.headers.get("x-delete-token") || "";
  const byToken = del && (await sha256hex(del)) === head.customMetadata?.del;
  const who = await uploaderOf(request, env);
  const byOwner = who && who.name === head.customMetadata?.owner;
  if (!byToken && !byOwner) return json({ error: "끌 권한이 없습니다" }, 403);

  await env.BUCKET.delete(`s/${params.id}`);
  return json({ ok: true });
}
