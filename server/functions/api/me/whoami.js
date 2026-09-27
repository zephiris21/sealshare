// GET /api/me/whoami — 이 열쇠가 등록돼 있나, 누구로 등록돼 있나(열쇠 등록 확인용)
import { json, touch, uploaderOf } from "../../../lib/shared.js";

export async function onRequestGet({ request, env }) {
  const who = await uploaderOf(request, env);
  if (!who) return json({ error: "등록되지 않은 열쇠입니다" }, 401);
  await touch(env, who);
  return json({ name: who.name });
}
