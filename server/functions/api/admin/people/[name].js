// 운영자 전용 — DELETE /api/admin/people/:name → 명단에서 뺀다(그 사람이 이미 만든 링크는 그대로 열린다)
import { isAdmin, json, loadPeople, savePeople } from "../../../../lib/shared.js";

export async function onRequestDelete({ request, params, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "운영자만 할 수 있습니다" }, 401);
  const name = decodeURIComponent(params.name);
  const people = await loadPeople(env);
  if (!people[name]) return json({ ok: true, gone: true });
  delete people[name];
  await savePeople(env, people);
  return json({ ok: true });
}
