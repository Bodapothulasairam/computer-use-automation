export const uiStyles = `
:root{color-scheme:light;--ink:#15263f;--muted:#607087;--line:#dce4ef;--paper:#fff;--canvas:#f4f7fb;--brand:#2859d6;--navy:#142943;--success:#146a52;--radius:18px;font-family:Inter,"Segoe UI",system-ui,sans-serif;font-size:15px}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);line-height:1.6}
h1,h2,h3,p{margin-top:0}h1{font-size:clamp(27px,3vw,36px);letter-spacing:-1px;line-height:1.2;margin-bottom:12px}h2{font-size:28px;letter-spacing:-.7px;line-height:1.25;margin-bottom:12px}h3{font-size:16px}p{color:var(--muted)}a{color:var(--brand)}button,input{font:inherit}button,.action{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:11px 22px;border:1px solid transparent;border-radius:10px;background:var(--brand);color:white;text-decoration:none;font-weight:650;cursor:pointer;transition:background .15s,box-shadow .15s}button:hover:not(:disabled),.action:hover{background:#1944ad;box-shadow:0 4px 12px #2859d620}button:disabled{background:#e8edf4;color:#6c7a8e;cursor:not-allowed;border-color:#d8e0ec;box-shadow:none}button.secondary,.action.secondary{background:white;color:var(--ink);border-color:var(--line)}button.danger{background:#fff;color:#a33131;border-color:#edcccc}
[data-active-action]{outline:3px solid #5381ed!important;outline-offset:6px;border-radius:8px;box-shadow:0 0 0 8px #eaf0ff!important}:focus-visible{outline:3px solid #5083fb;outline-offset:4px}input{width:100%;min-width:0;padding:13px 15px;border:1px solid #aab9ce;border-radius:10px;background:#fff;color:var(--ink)}input::placeholder{color:#6c7a8e}small{font-size:13px;color:var(--muted)}
.eyebrow{font-size:11px;font-weight:750;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.brand{display:flex;align-items:center;gap:11px;font-size:21px;font-weight:700;letter-spacing:-.4px}.brand-mark{display:grid;place-items:center;width:35px;height:35px;border-radius:10px;background:#3c6bf0;color:white;font-size:20px}
.shell{display:grid;grid-template-columns:224px minmax(0,1fr);min-height:100vh}.sidebar{background:var(--navy);color:#e8eef8;padding:32px 22px;display:flex;flex-direction:column;gap:40px}.sidebar .eyebrow,.sidebar small{color:#aebed4}.nav-item{display:block;padding:12px 14px;border:1px solid #56719b55;border-radius:10px;background:#ffffff0c;color:white;text-decoration:none;font-size:14px}.sidebar-footer{margin-top:auto;padding-top:30px;border-top:1px solid #ffffff24}.main{padding:0 36px 24px;min-width:0}.topbar{height:83px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);gap:14px;font-size:13px;color:var(--muted)}.avatar{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#e2eafd;color:var(--brand);font-size:11px;font-weight:700}.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.page-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:32px 0 22px}.page-heading p{margin-bottom:0}.chip{display:inline-flex;align-items:center;gap:8px;padding:6px 11px;background:#e8f5ee;border:1px solid #cce6d7;border-radius:99px;color:var(--success);font-size:12px;font-weight:650;white-space:nowrap}.chip.neutral{background:#eef3fd;color:#365d9b;border-color:#dce6fa}.dot{width:7px;height:7px;background:currentColor;border-radius:50%}.workspace-wrap{border:1px solid var(--line);border-radius:var(--radius);background:white;overflow:hidden;box-shadow:0 6px 24px #213b6505}iframe{display:block;width:100%;height:600px;border:0}.run-progress{padding:13px 20px;background:#f8faff;border-bottom:1px solid var(--line);font-size:13px;color:#43617f;display:flex;align-items:center;gap:9px}.footer-note{padding-top:16px;font-size:12px;color:var(--muted)}
.workspace{background:white;padding:30px 34px}.flow{display:flex;gap:0;list-style:none;padding:0;margin:0 0 30px;max-width:670px}.flow li{flex:1;font-size:12px;font-weight:650;display:flex;align-items:center;gap:9px;color:#6c7a8e}.flow li::after{content:"";flex:1;height:1px;background:var(--line);margin:0 15px}.flow li:last-child::after{display:none}.flow .num{display:grid;place-items:center;flex-shrink:0;width:27px;height:27px;border:1px solid var(--line);border-radius:50%;background:white;font-size:12px}.flow [aria-current="step"]{color:var(--brand)}.flow [aria-current="step"] .num{background:var(--brand);color:white;border-color:var(--brand)}.flow .done{color:var(--success)}.flow .done .num{background:#e8f5ee;border-color:#cce6d7}
.content-grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(210px,1fr);gap:32px}.main-panel{min-width:0}.info-panel{background:#f7f9fd;border:1px solid #e2e9f3;border-radius:14px;padding:22px;height:fit-content}.info-panel p{font-size:13px;margin-bottom:12px}.info-panel p:last-child{margin-bottom:0}.info-panel h3{margin-bottom:10px}.hint{margin:10px 0 20px}.form-table{width:100%;border:0;margin-top:24px}.form-table tr,.form-table td{display:block;padding:0;border:0}.form-table td:first-child{font-size:13px;font-weight:650;margin-bottom:8px}.form-table input{max-width:380px}table{width:100%;border-collapse:collapse;margin:24px 0}td{padding:14px 0;border-bottom:1px solid var(--line)}td:first-child{color:var(--muted);width:45%;font-size:13px}td:last-child{font-weight:600}.account-table .balance-row td{padding:20px 0}.account-table .balance-row td:last-child{font-size:30px;letter-spacing:-.8px;color:var(--ink)}.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:22px}.notice{padding:16px 18px;border-radius:12px;background:#fff8e9;border:1px solid #f0dfb1;color:#805e1b;margin:20px 0}.notice p{color:inherit;margin:0}.notice.success{background:#edf8f1;color:#17654a;border-color:#cce5d5}.notice.error{background:#fff3f3;color:#983a3a;border-color:#ecd0d0}.notice-icon{display:grid;place-items:center;width:44px;height:44px;background:#fff3da;color:#916810;border-radius:13px;margin-bottom:20px;font-weight:750;font-size:21px}
.operator-page{max-width:1100px;margin:auto;padding:0 32px 40px}.operator-page .topbar{height:83px}.operator-card{background:white;border:1px solid var(--line);border-radius:var(--radius);padding:30px;box-shadow:0 6px 24px #213b6505}.operator-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(220px,1fr);gap:28px}.session-meta{display:grid;gap:18px}.session-meta dt{font-size:12px;color:var(--muted);margin-bottom:4px}.session-meta dd{margin:0;font-size:14px;font-weight:600;overflow-wrap:anywhere}.step-card{padding:20px 0;border-bottom:1px solid var(--line)}.step-card:last-of-type{border-bottom:0}.step-card h3{margin-bottom:6px}.step-card p{font-size:13px;margin-bottom:14px}.step-heading{display:flex;align-items:center;gap:10px}.step-badge{width:25px;height:25px;border-radius:8px;background:#eef3fd;color:var(--brand);display:grid;place-items:center;font-size:12px;font-weight:750}.operator-actions{display:flex;flex-wrap:wrap;gap:10px}.status-copy{min-height:24px;font-size:14px}.debug{margin-top:24px;border-top:1px solid var(--line);padding-top:18px}.debug summary{font-size:12px;cursor:pointer;color:var(--muted)}pre{background:#f5f7fb;padding:16px;border-radius:10px;font-size:11px;overflow:auto;white-space:pre-wrap;word-break:break-word}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}[hidden]{display:none!important}
@media(max-width:900px){.shell{grid-template-columns:180px minmax(0,1fr)}.main{padding:0 20px 20px}.sidebar{padding:25px 16px}.content-grid{grid-template-columns:1fr}.info-panel{padding:18px}.workspace{padding:24px}.operator-grid{grid-template-columns:1fr}.flow li::after{margin:0 9px}}
@media(max-width:600px){.shell{display:block}.sidebar{padding:15px 20px;display:flex;flex-direction:row;align-items:center;justify-content:space-between}.sidebar nav,.sidebar-footer{display:none}.main{padding:0 14px 20px}.topbar{height:64px}.page-heading{padding:24px 0;flex-direction:column;gap:12px}.page-heading h1{font-size:27px}.workspace{padding:24px 18px}.flow li{font-size:10px;gap:5px}.flow li::after{margin:0 6px}.flow .num{width:23px;height:23px}iframe{height:790px}.operator-page{padding:0 16px 28px}.operator-card{padding:20px}.operator-page .topbar{height:70px}.topbar .crumb{display:none}.actions{align-items:stretch}.account-table .balance-row td:last-child{font-size:25px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`;
export const brand =
  '<div class="brand"><span class="brand-mark" aria-hidden="true">L</span>Ledger<span class="visually-hidden"> workspace</span></div>';
export function flow(stage: number) {
  return (
    '<ol class="flow" aria-label="Lookup progress">' +
    ["Find member", "View details", "Balance summary"]
      .map(
        (label, i) =>
          '<li class="' +
          (i < stage ? "done" : "") +
          '"' +
          (i === stage ? ' aria-current="step"' : "") +
          '><span class="num">' +
          (i + 1) +
          "</span>" +
          label +
          "</li>",
      )
      .join("") +
    "</ol>"
  );
}
export function documentHtml(
  body: string,
  className: string,
  title = "Ledger | Member services",
) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
    title +
    "</title><style>" +
    uiStyles +
    '</style></head><body class="' +
    className +
    '">' +
    body +
    "</body></html>"
  );
}
export function workspacePage(body: string, stage = 0) {
  return documentHtml(flow(stage) + "<main>" + body + "</main>", "workspace");
}
export function appShell() {
  return documentHtml(
    '<div class="shell"><aside class="sidebar">' +
      brand +
      '<nav aria-label="Workspace"><div class="eyebrow">Workspace</div><a class="nav-item" href="/app" aria-current="page">Member lookup</a></nav><div class="sidebar-footer"><div class="eyebrow">Demo environment</div><small>Synthetic members.<br>No real financial data.</small></div></aside><div class="main"><header class="topbar"><span class="crumb">Workspace &nbsp;/&nbsp; Member services</span><div class="row"><span class="chip neutral">Sandbox</span><span class="avatar" aria-label="Demo operator">DO</span></div></header><div class="page-heading"><div><div class="eyebrow">Member services</div><h1>A clearer view of every account.</h1><p>Find a member, review their details, and retrieve their savings balance.</p></div><span class="chip"><span class="dot"></span>Workspace ready</span></div><section class="workspace-wrap" aria-label="Member lookup"><div class="run-progress" role="status" aria-live="polite"><span class="dot"></span><span data-run-status>Ready for a member lookup</span></div><iframe name="workspace" title="Member workspace" src="/legacy/search"></iframe></section><div class="footer-note">Ledger demo &nbsp;·&nbsp; Read-only member servicing</div></div></div>',
    "",
  );
}
