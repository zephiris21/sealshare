// 초대장으로 열쇠 받기 — POST /api/invite/claim  (Bearer: 초대장 인증값)  { hash }
// 올리기 열쇠는 «받는 사람 브라우저»가 만들고 해시만 온다. 초대장은 한 번만 통과한다 —
// 링크가 돌아다녀도 먼저 받은 한 사람만 명단에 오르고, 나머지는 「이미 받은 초대장」을 본다.
import { HASH_RE, bearerHash, inviteKey, inviteState, json, loadPeople, savePeople } from "../../../lib/shared.js";

export async function onRequestPost({ request, env }) {
  const h = await bearerHash(request);
  if (!h) return json({ error: "초대장 주소가 올바르지 않습니다" }, 400);
  const { hash } = await request.json().catch(() => ({}));
  if (!HASH_RE.test(hash || "")) return json({ error: "잘못된 해시" }, 400);
  const obj = await env.BUCKET.get(inviteKey(h));
  if (!obj) return json({ error: "없거나 취소된 초대장입니다" }, 404);
  const inv = await obj.json();
  const state = inviteState(inv);
  if (state === "claimed") return json({ error: "이미 받은 초대장입니다", state }, 410);
  if (state === "expired") return json({ error: "기한이 지난 초대장입니다", state }, 410);
  const people = await loadPeople(env);
  if (people[inv.name] && !inv.replace) return json({ error: "이미 명단에 있는 이름입니다 — 초대한 사람에게 알려 주세요" }, 409);

  // 먼저 초대장을 «받음»으로 잠근다 — 같은 순간 두 번 눌러도(두 사람이 눌러도) 한 번만 통과한다
  const now = new Date().toISOString();
  const locked = await env.BUCKET.put(inviteKey(h), JSON.stringify({ ...inv, claimed: now }),
    { onlyIf: { etagMatches: obj.etag }, httpMetadata: { contentType: "application/json" } });
  if (!locked) return json({ error: "이미 받은 초대장입니다", state: "claimed" }, 410);

  const old = people[inv.name]?.hash;
  people[inv.name] = { hash, added: now, via: "invite" };
  await savePeople(env, people);
  if (old && old !== hash) await env.BUCKET.delete(`admin/seen/${old}`); // 예전 열쇠의 활동 기록은 지운다(그 열쇠는 이제 안 통한다)
  return json({ ok: true, name: inv.name });
}
