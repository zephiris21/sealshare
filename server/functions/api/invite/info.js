// 초대장 보기 — GET /api/invite/info  (Bearer: 초대장 인증값) → { name, state, expires, claimed }
// 링크를 가진 사람에게만 «누구를 초대했나»와 상태를 알려 준다. 여기서는 아무것도 바꾸지 않는다
import { bearerHash, inviteKey, inviteState, json } from "../../../lib/shared.js";

export async function onRequestGet({ request, env }) {
  const h = await bearerHash(request);
  if (!h) return json({ error: "초대장 주소가 올바르지 않습니다" }, 400);
  const inv = await env.BUCKET.get(inviteKey(h)).then((o) => (o ? o.json() : null));
  if (!inv) return json({ error: "없거나 취소된 초대장입니다" }, 404);
  return json({ name: inv.name, state: inviteState(inv), expires: inv.expires, claimed: inv.claimed });
}
