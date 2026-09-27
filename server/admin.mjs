#!/usr/bin/env node
// 운영자 전용 — 명단(올릴 수 있는 사람)을 관리한다. 웹 명단 페이지(/admin)와 같은 API 를 쓴다.
//   node admin.mjs setup          처음 한 번: 운영자 열쇠를 만들고 서버에 등록(ADMIN_HASH)
//   node admin.mjs page           명단 페이지 주소를 클립보드에 복사(운영자 열쇠가 들어 있다 — 화면에 안 찍는다)
//   node admin.mjs add <이름>      친구 추가 → 열쇠 파일을 «다운로드» 폴더에 만든다(열쇠는 화면에 안 찍는다)
//   node admin.mjs remove <이름>   명단에서 빼기(그 사람이 이미 만든 링크는 그대로 열린다)
//   node admin.mjs list
//
// 운영자 열쇠는 ~/.sealshare/admin.json 에만 있다. 서버에는 거기서 뽑은 인증값의 sha256 만 간다.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = "https://sealshare.pages.dev";
const PROJECT = "sealshare";
const ADMIN = join(homedir(), ".sealshare", "admin.json");
const LEGACY = join(here, ".uploaders.json");

const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha = (s) => createHash("sha256").update(s, "utf8").digest();
const keyHash = (key) => sha(b64url(sha("sealshare/auth/v1:" + key))).toString("hex"); // 친구 열쇠 → 서버에 두는 해시
const adminAuthOf = (t) => b64url(sha("sealshare/admin/v1:" + t));

const die = (m) => { console.error(m); process.exit(1); };
const run = (args, input) => spawnSync("npx", args, { cwd: here, input, encoding: "utf8", shell: process.platform === "win32" });
function adminToken() {
  try { return JSON.parse(readFileSync(ADMIN, "utf8")).token; } catch { return null; }
}
async function api(path, opts = {}) {
  const t = adminToken();
  if (!t) die("운영자 열쇠가 없습니다 — 먼저: node admin.mjs setup");
  const r = await fetch(SERVER + path, { ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${adminAuthOf(t)}` } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) die(`${r.status}: ${body.error || r.statusText}`);
  return body;
}
function copy(text) {
  const [cmd, args] = process.platform === "win32" ? ["clip", []] : process.platform === "darwin" ? ["pbcopy", []] : ["xclip", ["-selection", "clipboard"]];
  return spawnSync(cmd, args, { input: text, shell: process.platform === "win32" }).status === 0;
}
function keyFile(name, key) {
  return "﻿" + [
    `sealshare 올리기 열쇠 — ${name} 님`, "",
    "1) 클로드 코드에 sealshare 를 설치합니다:",
    "     claude plugin marketplace add zephiris21/sealshare",
    "     claude plugin install sealshare@sealshare",
    "2) 이 파일을 «다운로드» 폴더에 둔 채로 클로드 코드에 말합니다:",
    "     sealshare 열쇠 등록해줘", "",
    "등록이 끝나면 이 파일은 지워도 됩니다. 남에게 보내지 마세요 — 이 열쇠가 곧 허가증입니다.", "",
    key, "",
  ].join("\r\n");
}

const [cmd, name] = process.argv.slice(2);

if (cmd === "setup") {
  let t = adminToken();
  if (!t) {
    t = "sa_" + b64url(randomBytes(32));
    mkdirSync(dirname(ADMIN), { recursive: true });
    writeFileSync(ADMIN, JSON.stringify({ token: t }, null, 2), "utf8");
  }
  const s = run(["wrangler", "pages", "secret", "put", "ADMIN_HASH", "--project-name", PROJECT], sha(adminAuthOf(t)).toString("hex"));
  if (s.status !== 0) die(s.stdout + s.stderr);
  const d = run(["wrangler", "pages", "deploy", "--branch", "main", "--commit-dirty=true"]);
  if (d.status !== 0) die(d.stdout + d.stderr);
  process.stdout.write("운영자 열쇠를 서버에 등록했습니다. 통하는지 확인하는 중…");
  for (let i = 0; i < 30; i++) {
    const r = await fetch(SERVER + "/api/admin/people", { headers: { authorization: `Bearer ${adminAuthOf(t)}` } }).catch(() => null);
    if (r?.ok) { console.log(" 확인됐습니다.\n명단 페이지: node admin.mjs page"); process.exit(0); }
    await new Promise((res) => setTimeout(res, 3000));
  }
  die(" 아직 안 통합니다 — 1~2분 뒤 node admin.mjs list 로 확인하세요.");
} else if (cmd === "page") {
  // 기본 브라우저로 바로 연다(주소에 운영자 열쇠가 있어 화면에는 안 찍는다). 클립보드에도 넣어 둔다
  const t = adminToken() || die("운영자 열쇠가 없습니다 — 먼저: node admin.mjs setup");
  const url = `${SERVER}/admin#${t}`;
  const opened = process.platform === "win32" ? spawnSync("cmd", ["/c", "start", "", url]).status === 0
    : spawnSync(process.platform === "darwin" ? "open" : "xdg-open", [url]).status === 0;
  const copied = copy(url);
  console.log(`${opened ? "명단 페이지를 브라우저로 열었습니다." : "브라우저를 못 열었습니다."}${copied ? " 주소는 클립보드에도 있습니다." : ""} (운영자 열쇠가 들어 있으니 남에게 보내지 마세요)`);
} else if (cmd === "add") {
  if (!name) die("이름을 주세요: node admin.mjs add <이름>");
  const key = "ss_" + b64url(randomBytes(32));
  await api("/api/admin/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, hash: keyHash(key) }) });
  const dir = join(homedir(), "Downloads");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `sealshare-key-${name}.txt`);
  writeFileSync(file, keyFile(name, key), "utf8");
  console.log(`${name} 님을 추가했습니다.\n열쇠 파일: ${file}\n→ 이 파일을 ${name} 님에게만 보내세요(설치·등록 안내가 들어 있습니다). 보낸 뒤에는 지워도 됩니다.`);
} else if (cmd === "remove") {
  if (!name) die("이름을 주세요: node admin.mjs remove <이름>");
  await api(`/api/admin/people/${encodeURIComponent(name)}`, { method: "DELETE" });
  console.log(`${name} 님을 명단에서 뺐습니다. 이미 만든 링크는 그대로 열립니다.`);
} else if (cmd === "list") {
  const { people, orphan } = await api("/api/admin/people");
  for (const p of people) console.log(`${p.name}  ${p.added?.slice(0, 10)}  공유 ${p.shares}건  ${(p.bytes / 1e6).toFixed(1)}MB`);
  for (const o of orphan || []) console.log(`(뺌) ${o.name}  남은 링크 ${o.shares}건`);
  if (!people.length) console.log("아직 아무도 없습니다.");
} else if (cmd === "migrate") {
  // 옛 판(명단이 Pages 비밀값 UPLOADERS 에 있던 때)의 로컬 사본을 R2 명단으로 옮긴다 — 한 번만
  if (!existsSync(LEGACY)) die("옮길 옛 명단(.uploaders.json)이 없습니다.");
  const legacy = JSON.parse(readFileSync(LEGACY, "utf8"));
  for (const [n, p] of Object.entries(legacy)) {
    const r = await fetch(SERVER + "/api/admin/people", { method: "POST", headers: { authorization: `Bearer ${adminAuthOf(adminToken())}`, "content-type": "application/json" }, body: JSON.stringify({ name: n, hash: p.hash }) });
    console.log(`${n}: ${r.status === 201 ? "옮겼습니다" : r.status === 409 ? "이미 있습니다" : "실패 " + r.status}`);
  }
} else {
  console.log("쓰는 법: node admin.mjs setup | page | add <이름> | remove <이름> | list");
}
