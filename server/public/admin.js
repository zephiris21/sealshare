// 운영자 명단 페이지 — 명단 보기·추가·빼기. 친구 열쇠는 «이 브라우저에서» 만들고 서버에는 해시만 보낸다.
(function () {
  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const token = decodeURIComponent(location.hash.slice(1));
  let adminAuth = "";

  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sha = (s) => crypto.subtle.digest("SHA-256", enc.encode(s));
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // 친구 열쇠 → 서버에 두는 해시 (share.mjs·me.js 와 같은 식: sha256(인증값), 인증값 = base64url(sha256("sealshare/auth/v1:"+열쇠)))
  const hashOfKey = async (key) => hex(await sha(b64url(await sha("sealshare/auth/v1:" + key))));
  const fmtBytes = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + "MB" : n ? Math.max(1, Math.round(n / 1024)) + "KB" : "0";
  const fmtDate = (s) => s ? new Date(s).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }) : "";
  const ago = (s) => { if (!s) return "기록 없음"; const m = Math.round((Date.now() - Date.parse(s)) / 60000);
    return m < 1 ? "방금" : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
  // 등록 여부 — 활동 기록이 생기기 전(2026-09-27 이전)에 등록한 사람은 공유 기록으로 짐작한다
  const status = (p) => p.registered ? "등록함" : p.shares ? "등록함(공유 기록으로 확인)" : "아직 등록 안 함";

  function el(tag, props = {}, kids = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) (k === "text" ? (e.textContent = v) : k === "class" ? (e.className = v) : e.setAttribute(k, v));
    for (const k of kids) e.appendChild(k);
    return e;
  }
  const api = (path, opts = {}) => fetch(path, { ...opts, headers: { ...(opts.headers || {}), authorization: "Bearer " + adminAuth } });

  function keyFile(name, key) {
    return [
      `# sealshare 올리기 열쇠 — ${name} 님`,
      "# 이 파일을 «다운로드» 폴더에 둔 채로 클로드 코드에 「sealshare 열쇠 등록해줘」 라고 말하세요.",
      "# 설치가 아직이면: claude plugin marketplace add zephiris21/sealshare  →  claude plugin install sealshare@sealshare",
      "# 등록이 끝나면 이 파일은 지워도 됩니다. 남에게 보내지 마세요 — 이 열쇠가 곧 허가증입니다.",
      `SEALSHARE_KEY=${key}`,
      "",
    ].join("\n");
  }

  async function load() {
    const r = await api("/api/admin/people", { cache: "no-store" });
    if (r.status === 401) throw new Error("운영자 열쇠가 맞지 않습니다.");
    if (!r.ok) throw new Error(`명단을 못 불러왔습니다 (${r.status})`);
    const { people, orphan } = await r.json();
    $("sub").textContent = `${people.length}명 · 공유 ${people.reduce((a, p) => a + p.shares, 0)}건`;
    const box = $("people"); box.textContent = "";
    for (const p of people.sort((a, b) => (a.added || "").localeCompare(b.added || ""))) {
      const off = el("button", { class: "danger", text: "빼기" });
      let armed = null;
      off.onclick = async () => {
        if (!armed) { off.textContent = "정말 뺄까요? 한 번 더"; off.classList.add("armed"); armed = setTimeout(() => { armed = null; off.textContent = "빼기"; off.classList.remove("armed"); }, 3000); return; }
        clearTimeout(armed); off.disabled = true;
        const d = await api(`/api/admin/people/${encodeURIComponent(p.name)}`, { method: "DELETE" });
        if (!d.ok) { off.disabled = false; return err(`빼지 못했습니다 (${d.status})`); }
        load();
      };
      box.appendChild(el("div", { class: "card" }, [
        el("div", { class: "who" }, [el("div", { class: "name", text: p.name }), el("div", { class: "meta", text: `${status(p)} · 마지막 사용 ${ago(p.lastSeen)}` }), el("div", { class: "meta", text: `공유 ${p.shares}건(최근 7일 ${p.recent7}건) · ${fmtBytes(p.bytes)} · ${fmtDate(p.added)} 추가` })]),
        off,
      ]));
    }
    if (!people.length) box.appendChild(el("p", { class: "meta", text: "아직 아무도 없습니다." }));
    const ob = $("orphan"); ob.textContent = "";
    for (const o of orphan || []) ob.appendChild(el("div", { class: "card gone" }, [el("div", { class: "who" }, [el("div", { class: "name", text: `${o.name} (명단에서 뺌)` }), el("div", { class: "meta", text: `남아 있는 링크 ${o.shares}건 · ${fmtBytes(o.bytes)} — 계속 열립니다` })])]));
  }

  function err(m, box = "issued") { const p = el("p", { class: "err", text: m }); $(box).prepend(p); setTimeout(() => p.remove(), 6000); }

  // ── 초대장 ── 비밀값(si_…)은 이 브라우저에서 만든다. 서버에는 그 인증값의 sha256 만 간다(서버는 링크를 모른다).
  //   친구가 링크를 열어 「열쇠 파일 받기」를 누르면 친구 브라우저가 올리기 열쇠를 만들고, 초대장은 그 순간 잠긴다(한 번만).
  const invState = (v) => v.state === "claimed" ? `받음 · ${fmtWhen(v.claimed)}` : v.state === "expired" ? "기한 지남 — 안 받았음" : `기다리는 중 · ${fmtDate(v.expires)}까지`;
  const fmtWhen = (s) => new Date(s).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

  async function loadInvites() {
    const r = await api("/api/admin/invites", { cache: "no-store" });
    if (!r.ok) return;
    const { invites } = await r.json();
    const box = $("invites"); box.textContent = "";
    for (const v of invites) {
      const off = el("button", { class: "danger", text: v.state === "open" ? "취소" : "기록 지우기" });
      let armed = null;
      off.onclick = async () => {
        if (!armed) { off.textContent = "한 번 더"; off.classList.add("armed"); armed = setTimeout(() => { armed = null; off.textContent = v.state === "open" ? "취소" : "기록 지우기"; off.classList.remove("armed"); }, 3000); return; }
        clearTimeout(armed); off.disabled = true;
        const d = await api(`/api/admin/invites/${v.hash}`, { method: "DELETE" });
        if (!d.ok) { off.disabled = false; return err(`지우지 못했습니다 (${d.status})`, "invOut"); }
        loadInvites();
      };
      box.appendChild(el("div", { class: "card" + (v.state === "open" ? "" : " gone") }, [
        el("div", { class: "who" }, [el("div", { class: "name", text: `✉️ ${v.name}` }), el("div", { class: "meta", text: invState(v) + (v.replace ? " · 받으면 예전 열쇠는 꺼짐" : "") })]),
        off,
      ]));
    }
  }

  async function invite(replace = false) {
    const name = $("invName").value.trim();
    if (!name) return;
    $("invBtn").disabled = true;
    try {
      const secret = "si_" + b64url(crypto.getRandomValues(new Uint8Array(32)));
      const hash = hex(await sha(b64url(await sha("sealshare/invite/v1:" + secret))));
      const r = await api("/api/admin/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, hash, replace }) });
      const out = await r.json().catch(() => ({}));
      const box = $("invOut"); box.textContent = "";
      if (r.status === 409 && out.exists) {
        const go = el("button", { class: "primary", text: "그래도 만들기" });
        go.onclick = () => invite(true);
        box.appendChild(el("div", { class: "issued" }, [
          el("b", { text: `${name} 님은 이미 명단에 있어요.` }),
          el("div", { text: "초대장으로 열쇠를 받는 순간 예전 열쇠는 더는 못 써요(이미 만든 링크는 계속 열립니다)." }),
          el("div", { class: "row" }, [go]),
        ]));
        return;
      }
      if (!r.ok) return err(out.error || `만들지 못했습니다 (${r.status})`, "invOut");
      $("invName").value = "";
      const link = `${location.origin}/invite#${secret}`;
      const msg = `sealshare 초대장이에요. 클로드 코드를 쓰는 컴퓨터에서 열어 주세요 (${fmtDate(out.expires)}까지, 한 번만 받을 수 있어요)\n${link}`;
      const copyBtn = (label, text) => { const b = el("button", { text: label }); b.onclick = async () => { try { await navigator.clipboard.writeText(text); b.textContent = "복사했어요 ✓"; } catch { b.textContent = "복사 실패"; } }; return b; };
      const view = el("button", { text: "초대장 미리 보기" });
      view.onclick = () => window.open(link, "_blank", "noopener");
      box.appendChild(el("div", { class: "issued" }, [
        el("b", { text: `${name} 님 초대장을 만들었어요.` }),
        el("div", { text: "이 링크를 그 친구에게만 보내세요. 친구가 열어 「열쇠 파일 받기」를 누르면 끝이에요 — 한 번 받으면 링크는 잠깁니다." }),
        el("span", { class: "link", text: link }),
        el("div", { class: "row" }, [copyBtn("안내 문구와 함께 복사", msg), copyBtn("링크만 복사", link), view]),
      ]));
      loadInvites();
    } finally { $("invBtn").disabled = false; }
  }

  async function add() {
    const name = $("newName").value.trim();
    if (!name) return;
    $("addBtn").disabled = true;
    try {
      const key = "ss_" + b64url(crypto.getRandomValues(new Uint8Array(32)));
      const r = await api("/api/admin/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, hash: await hashOfKey(key) }) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) return err(out.error || `추가하지 못했습니다 (${r.status})`);
      $("newName").value = "";
      const file = keyFile(name, key);
      const dl = el("button", { class: "primary", text: "열쇠 파일 내려받기" });
      dl.onclick = () => {
        const a = el("a", { href: URL.createObjectURL(new Blob([file], { type: "text/plain;charset=utf-8" })), download: `sealshare-key-${name}.env` });
        document.body.appendChild(a); a.click(); a.remove();
        dl.textContent = "내려받았어요 ✓";
      };
      const cp = el("button", { text: "열쇠만 복사" });
      cp.onclick = async () => { try { await navigator.clipboard.writeText(key); cp.textContent = "복사했어요 ✓"; } catch { cp.textContent = "복사 실패"; } };
      const box = $("issued"); box.textContent = "";
      box.appendChild(el("div", { class: "issued" }, [
        el("b", { text: `${name} 님을 추가했습니다.` }),
        el("div", { text: "이 열쇠는 지금만 보입니다 — 파일로 내려받아 그 친구에게만 보내세요(파일에 설치·등록 안내가 들어 있습니다)." }),
        el("code", { text: key }),
        el("div", { class: "row" }, [dl, cp]),
      ]));
      load();
    } finally { $("addBtn").disabled = false; }
  }

  async function start() {
    if (!/^sa_[A-Za-z0-9_-]{20,}$/.test(token)) {
      $("sub").textContent = "운영자 열쇠가 필요합니다";
      $("login").hidden = false;
      $("go").onclick = () => { const t = $("tok").value.trim(); if (t) { location.hash = t; location.reload(); } };
      return;
    }
    adminAuth = b64url(await sha("sealshare/admin/v1:" + token));
    try {
      await load(); await loadInvites(); $("app").hidden = false;
      $("addBtn").onclick = add; $("newName").onkeydown = (e) => { if (e.key === "Enter") add(); };
      $("invBtn").onclick = () => invite(); $("invName").onkeydown = (e) => { if (e.key === "Enter") invite(); };
    }
    catch (e) { $("sub").textContent = ""; $("sub").appendChild(el("span", { class: "err", text: e.message })); }
  }
  start();
})();
