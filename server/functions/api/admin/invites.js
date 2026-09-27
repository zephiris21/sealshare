// 운영자 전용 — 초대장.
// 초대장 비밀값(si_…)은 운영자 브라우저(또는 admin.mjs)가 만들고, 서버에는 그 인증값의 sha256 만 온다 — 서버는 초대장 링크를 모른다.
// 친구가 초대장을 열어 「열쇠 받기」를 누르면 «친구 브라우저»가 올리기 열쇠를 만들고 해시만 보낸다(/api/invite/claim). 한 번만 받는다.
// GET  /api/admin/invites → { invites: [{ hash, name, created, expires, claimed, replace, state }] }
// POST /api/admin/invites  { name, hash, replace? } → 만든다. 같은 이름의 «아직 안 받은» 초대장은 지운다(이름마다 열린 초대장 하나)
import { HASH_RE, INVITE_DAYS, NAME_RE, inviteKey, isAdmin, json, listInvites, loadPeople } from "../../../lib/shared.js";

export async function onRequestGet({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "운영자만 볼 수 있습니다" }, 401);
  const invites = (await listInvites(env)).sort((a, b) => b.created.localeCompare(a.created));
  return json({ invites });
}

export async function onRequestPost({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "운영자만 할 수 있습니다" }, 401);
  const { name, hash, replace } = await request.json().catch(() => ({}));
  if (!NAME_RE.test(name || "")) return json({ error: "이름은 공백·/ 없이 1~40자" }, 400);
  if (!HASH_RE.test(hash || "")) return json({ error: "잘못된 해시" }, 400);
  const people = await loadPeople(env);
  if (people[name] && !replace) return json({ error: "이미 명단에 있는 이름입니다", exists: true }, 409);
  for (const inv of await listInvites(env)) if (inv.name === name && inv.state !== "claimed") await env.BUCKET.delete(inviteKey(inv.hash));
  const now = new Date();
  const expires = new Date(now.getTime() + INVITE_DAYS * 86400000).toISOString();
  await env.BUCKET.put(inviteKey(hash), JSON.stringify({ name, created: now.toISOString(), expires, claimed: null, replace: !!replace }),
    { httpMetadata: { contentType: "application/json" } });
  return json({ ok: true, expires }, 201);
}
