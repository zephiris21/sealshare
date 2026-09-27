// 초대장 — 링크의 # 뒤(초대장 비밀값 si_…)로 «누구 초대장인지» 확인하고, 「열쇠 파일 받기」를 누르면
// 이 브라우저가 올리기 열쇠(ss_…)를 만들어 해시만 서버에 보낸다. 서버는 초대장을 «받음»으로 잠가 한 번만 통과시킨다.
// 열쇠 원문은 화면에 띄우지 않고 파일로만 내준다(클로드 코드 대화에 평문으로 붙여 넣지 않게).
(function () {
  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const secret = location.hash.slice(1);
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sha = (s) => crypto.subtle.digest("SHA-256", enc.encode(s));
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // share.mjs·admin.js 와 같은 식: 서버에 두는 값 = sha256(인증값), 인증값 = base64url(sha256("sealshare/auth/v1:"+열쇠))
  const hashOfKey = async (key) => hex(await sha(b64url(await sha("sealshare/auth/v1:" + key))));
  const fmtDate = (s) => new Date(s).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
  const fmtWhen = (s) => new Date(s).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  let auth = "", name = "", file = null, fileName = "";

  function stop(title, detail) {
    $("app").hidden = true;
    const box = $("stop");
    box.textContent = "";
    const d = document.createElement("div"); d.className = "stop";
    const b = document.createElement("b"); b.textContent = title;
    const s = document.createElement("span"); s.textContent = detail;
    d.append(b, s); box.appendChild(d); box.hidden = false;
  }
  function keyFile(key) {
    return [
      `# sealshare 올리기 열쇠 — ${name} 님 (초대장으로 받음)`,
      "# 이 파일을 «다운로드» 폴더에 둔 채로 클로드 코드에 「sealshare 열쇠 등록해줘」 라고 말하세요.",
      "# 설치가 아직이면: claude plugin marketplace add zephiris21/sealshare  →  claude plugin install sealshare@sealshare",
      "# 등록이 끝나면 이 파일은 지워도 됩니다. 남에게 보내지 마세요 — 이 열쇠가 곧 허가증입니다.",
      `SEALSHARE_KEY=${key}`,
      "",
    ].join("\n");
  }
  function download() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([file], { type: "text/plain;charset=utf-8" }));
    a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  function err(m) { $("err").textContent = m; $("err").hidden = false; }

  let armed = null;
  async function claim() {
    const btn = $("claim");
    if (isMobile && !armed) { // 폰에서 받으면 컴퓨터에 없다 — 한 번만 받을 수 있으니 한 번 더 묻는다
      btn.textContent = "그래도 이 기기에서 받기 — 한 번 더"; btn.classList.add("armed");
      armed = setTimeout(() => { armed = null; btn.textContent = "열쇠 파일 받기"; btn.classList.remove("armed"); }, 4000);
      return;
    }
    clearTimeout(armed);
    btn.disabled = true; btn.textContent = "받는 중…"; $("err").hidden = true;
    try {
      const key = "ss_" + b64url(crypto.getRandomValues(new Uint8Array(32)));
      const r = await fetch("/api/invite/claim", { method: "POST", headers: { authorization: "Bearer " + auth, "content-type": "application/json" },
        body: JSON.stringify({ hash: await hashOfKey(key) }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 410 || r.status === 404) return stop(d.error || "받을 수 없는 초대장입니다", "초대한 사람에게 새 초대장을 받으세요.");
      if (!r.ok) { btn.disabled = false; btn.textContent = "열쇠 파일 받기"; return err(`${d.error || "받지 못했습니다"} (${r.status})`); }
      file = keyFile(key);
      download();
      $("claimBox").hidden = true;
      $("fname").textContent = fileName;
      $("got").hidden = false;
      $("s2").classList.remove("now"); $("s3").classList.add("now");
    } catch (e) {
      btn.disabled = false; btn.textContent = "열쇠 파일 받기"; err("받지 못했습니다 — 잠시 뒤 다시 눌러 주세요.");
    }
  }

  document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($(b.dataset.copy).textContent.trim()); b.textContent = "복사했어요 ✓"; }
    catch { b.textContent = "복사 실패"; }
    setTimeout(() => (b.textContent = "복사"), 1800);
  }));

  async function start() {
    if (!/^si_[A-Za-z0-9_-]{40,}$/.test(secret)) { $("who").textContent = "초대장"; return stop("초대장 주소가 잘렸습니다", "받은 링크를 # 뒤까지 전부 그대로 여세요."); }
    auth = b64url(await sha("sealshare/invite/v1:" + secret));
    const r = await fetch("/api/invite/info", { headers: { authorization: "Bearer " + auth }, cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (r.status === 404) { $("who").textContent = "초대장"; return stop("없거나 취소된 초대장입니다", "초대한 사람에게 새 초대장을 받으세요."); }
    if (!r.ok) { $("who").textContent = "초대장"; return stop("초대장을 읽지 못했습니다", `잠시 뒤 다시 여세요. (${r.status})`); }
    name = d.name;
    fileName = `sealshare-key-${name.replace(/[<>:"|?*]/g, "_")}.env`;
    $("who").textContent = `${name} 님을 초대합니다`;
    document.title = `${name} 님 초대장 · sealshare`;
    if (d.state === "claimed") return stop("이미 받은 초대장입니다", `${fmtWhen(d.claimed)}에 열쇠를 받아 갔습니다. 본인이 받은 게 아니라면 초대한 사람에게 알려 주세요 — 그 열쇠를 끄고 새 초대장을 드립니다.`);
    if (d.state === "expired") return stop("기한이 지난 초대장입니다", "초대한 사람에게 새 초대장을 받으세요.");
    $("until").textContent = `${fmtDate(d.expires)}까지 · 한 번만 받을 수 있어요`;
    if (isMobile) $("mobile").hidden = false;
    $("claim").onclick = claim;
    $("again").onclick = download;
    $("app").hidden = false;
  }
  start().catch(() => stop("초대장을 열지 못했습니다", "최신 크롬·엣지·사파리로 다시 여세요."));
})();
