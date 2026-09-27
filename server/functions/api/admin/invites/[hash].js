// 운영자 전용 — DELETE /api/admin/invites/:hash → 초대장을 취소한다(이미 받은 초대장이면 기록만 지운다 — 받은 열쇠는 명단에서 빼야 끊긴다)
import { HASH_RE, inviteKey, isAdmin, json } from "../../../../lib/shared.js";

export async function onRequestDelete({ request, params, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "운영자만 할 수 있습니다" }, 401);
  if (!HASH_RE.test(params.hash || "")) return json({ error: "잘못된 초대장" }, 400);
  await env.BUCKET.delete(inviteKey(params.hash));
  return json({ ok: true });
}
