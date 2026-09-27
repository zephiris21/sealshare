// 운영자 전용 — 명단 보기·추가.
// GET  /api/admin/people → [{ name, added, shares, bytes }]  (공유 «수·용량»만 — 내용은 암호문이라 운영자도 못 본다)
// POST /api/admin/people  { name, hash }  → 추가. 열쇠는 운영자 브라우저(또는 admin.mjs)가 만들고 «해시만» 보낸다
import { HASH_RE, NAME_RE, isAdmin, json, loadPeople, savePeople } from "../../../lib/shared.js";

export async function onRequestGet({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "운영자만 볼 수 있습니다" }, 401);
  const people = await loadPeople(env);
  const usage = {};
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix: "s/", cursor, include: ["customMetadata"] });
    for (const o of page.objects) {
      const who = o.customMetadata?.owner || "?";
      usage[who] = usage[who] || { shares: 0, bytes: 0 };
      usage[who].shares++;
      usage[who].bytes += o.size;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const list = Object.entries(people).map(([name, p]) => ({ name, added: p.added, shares: usage[name]?.shares || 0, bytes: usage[name]?.bytes || 0 }));
  const orphan = Object.entries(usage).filter(([n]) => !people[n]).map(([name, u]) => ({ name, removed: true, ...u }));
  return json({ people: list, orphan });
}

export async function onRequestPost({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "운영자만 할 수 있습니다" }, 401);
  const { name, hash } = await request.json().catch(() => ({}));
  if (!NAME_RE.test(name || "")) return json({ error: "이름은 공백·/ 없이 1~40자" }, 400);
  if (!HASH_RE.test(hash || "")) return json({ error: "잘못된 해시" }, 400);
  const people = await loadPeople(env);
  if (people[name]) return json({ error: "이미 있는 이름입니다 — 빼고 다시 넣으세요" }, 409);
  people[name] = { hash, added: new Date().toISOString() };
  await savePeople(env, people);
  return json({ ok: true }, 201);
}
