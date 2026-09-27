#!/usr/bin/env node
// 운영자 전용 — 올릴 수 있는 사람(지인)을 더하고 뺀다.
//   node admin.mjs add <이름>     → 올리기 열쇠를 한 번 보여 준다(그 사람에게 전달)
//   node admin.mjs remove <이름>  → 그 사람의 열쇠를 끈다(그 사람이 이미 올린 링크는 그대로)
//   node admin.mjs list
//
// 서버에는 열쇠에서 뽑은 인증값의 sha256 만 간다(Pages 비밀값 UPLOADERS) — 열쇠 원문도, 목록 열쇠도 서버가 모른다. 열쇠 원문은 어디에도 저장하지 않는다 —
// 잃어버리면 remove 후 다시 add 한다. 목록 사본은 .uploaders.json(깃에 안 올린다).
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const LIST = join(here, ".uploaders.json");
const PROJECT = "sealshare";

const load = () => (existsSync(LIST) ? JSON.parse(readFileSync(LIST, "utf8")) : {});
const save = (v) => writeFileSync(LIST, JSON.stringify(v, null, 2), "utf8");
// 서버에 두는 것 = 인증값의 sha256. 인증값 = base64url(SHA-256("sealshare/auth/v1:" + 열쇠)) — 클라이언트(share.mjs·me.js)와 같은 식
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const authOf = (t) => b64url(createHash("sha256").update("sealshare/auth/v1:" + t, "utf8").digest());
const sha = (t) => createHash("sha256").update(authOf(t), "utf8").digest("hex");

function push(people) {
  const table = Object.fromEntries(Object.entries(people).map(([name, p]) => [p.hash, name]));
  const r = spawnSync("npx", ["wrangler", "pages", "secret", "put", "UPLOADERS", "--project-name", PROJECT],
    { cwd: here, input: JSON.stringify(table), encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
  // Pages 는 비밀값을 «다음 배포부터» 읽는다 — 잊으면 새 열쇠가 안 먹으니 여기서 바로 배포한다
  const d = spawnSync("npx", ["wrangler", "pages", "deploy", "--branch", "main", "--commit-dirty=true"],
    { cwd: here, encoding: "utf8", shell: process.platform === "win32" });
  if (d.status !== 0) { console.error(d.stdout, d.stderr); process.exit(1); }
  console.log("서버에 반영하고 다시 배포했습니다(UPLOADERS).");
}

// 배포는 몇 초~수십 초 뒤에 퍼진다 — 새 열쇠가 서버에서 «실제로 통할 때까지» 기다린다(바로 건네면 받은 사람이 「등록 안 된 열쇠」를 본다)
async function waitLive(token, wantOk = true) {
  const auth = authOf(token);
  for (let i = 0; i < 30; i++) {
    const r = await fetch("https://sealshare.pages.dev/api/me/whoami", { headers: { authorization: `Bearer ${auth}` } }).catch(() => null);
    if (r && (r.status === 200) === wantOk) return true;
    await new Promise((res) => setTimeout(res, 3000));
  }
  return false;
}

const [cmd, name] = process.argv.slice(2);
const people = load();
if (cmd === "add") {
  if (!name) throw new Error("이름을 주세요");
  const token = "ss_" + randomBytes(32).toString("base64url");
  people[name] = { hash: sha(token), added: new Date().toISOString() };
  save(people); push(people);
  process.stdout.write("새 열쇠가 서버에서 통하는지 확인하는 중…");
  console.log((await waitLive(token)) ? " 확인됐습니다." : " ⚠ 아직 안 통합니다 — 1~2분 뒤 받은 사람이 등록하게 하세요.");
  console.log(`\n${name} 의 올리기 열쇠 (지금 한 번만 보입니다):\n\n  ${token}\n\n그 사람은 클로드 코드에서 「sealshare 열쇠 등록해줘: ${token}」 라고 하면 됩니다.`);
} else if (cmd === "remove") {
  if (!people[name]) throw new Error(`없는 이름: ${name}`);
  delete people[name]; save(people); push(people);
  console.log(`${name} 의 열쇠를 껐습니다.`);
} else if (cmd === "list") {
  for (const [n, p] of Object.entries(people)) console.log(`${n}  (${p.added.slice(0, 10)})`);
} else {
  console.log("쓰는 법: node admin.mjs add <이름> | remove <이름> | list");
}
