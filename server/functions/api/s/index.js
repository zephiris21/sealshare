// POST /api/s — 암호문 한 건을 받는다. 등록된 올리는 사람(지인)만.
import { MAX_BYTES, json, randomId, sha256hex, touch, uploaderOf } from "../../../lib/shared.js";

export async function onRequestPost({ request, env }) {
  const who = await uploaderOf(request, env);
  if (!who) return json({ error: "올리기 열쇠가 없거나 등록되지 않았습니다" }, 401);

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) return json({ error: `너무 큽니다(상한 ${MAX_BYTES / 1024 / 1024}MB)` }, 413);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return json({ error: `너무 큽니다(상한 ${MAX_BYTES / 1024 / 1024}MB)` }, 413);
  if (body.byteLength < 29) return json({ error: "암호문이 아닙니다" }, 400); // iv 12 + 태그 16 + 최소 1

  const id = randomId(16);
  const deleteToken = randomId(24);
  await env.BUCKET.put(`s/${id}`, body, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { owner: who.name, del: await sha256hex(deleteToken), created: new Date().toISOString() },
  });
  await touch(env, who);
  return json({ id, deleteToken, bytes: body.byteLength }, 201);
}
