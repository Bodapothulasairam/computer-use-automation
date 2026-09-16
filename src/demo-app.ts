import http from "node:http";
import type { AddressInfo } from "node:net";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const css = `body{font:16px system-ui;background:#f4f6f8;color:#14283d;margin:0;padding:28px}h1{font-size:24px}h2{font-size:21px}table{border-collapse:collapse;background:white;width:100%;max-width:680px}td{padding:14px;border-bottom:1px solid #dce3ea}button,a.action{background:#125c6e;color:white;border:0;border-radius:5px;padding:11px 20px;cursor:pointer;display:inline-block;text-decoration:none}input{padding:10px;font:inherit;border:1px solid #8293a2}a{color:#125c6e}aside{background:#e1e9ee;padding:12px}iframe{width:100%;height:620px;border:1px solid #c4d1db;background:white}small{color:#50677b}.badge{font-size:12px;letter-spacing:2px;color:#42727d}`;
const page = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Legacy Ledger | Synthetic banking sandbox</title><style>${css}</style></head><body>${body}</body></html>`;
const alerts: Record<string, string> = {
  validation: "Validation error",
  permission: "Permission denied",
  session: "Session expired",
  app_error: "Application error",
  unknown_dialog: "Unexpected confirmation",
  transient: "Temporarily unavailable",
  notice: "Service notice",
};
export async function startDemo(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const cookie = req.headers.cookie || "";
    const scenario = decodeURIComponent(
      /(?:^|; )scenario=([^;]+)/.exec(cookie)?.[1] || "normal",
    );
    const recovered = cookie.includes("recovered=1");
    const member = url.searchParams.get("member") || "";
    const path = url.pathname;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'unsafe-inline'; script-src 'none'; frame-ancestors 'self'; form-action 'self'",
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (path === "/app") {
      res.end(
        page(
          '<div class="badge">DEMONSTRATION / SYNTHETIC DATA ONLY</div><h1>Legacy Ledger</h1><p>Member servicing workstation · Vendor release 1</p><iframe name="workspace" title="Member workspace" src="/legacy/search"></iframe>',
        ),
      );
      return;
    }
    if (path === "/legacy/search") {
      res.end(
        page(
          '<h2>Member search</h2><p>Locate a member to view their savings summary.</p><form method="get" action="/legacy/member"><table><tr><td>Member number</td><td><input name="member" autocomplete="off"></td></tr></table><p><button>Search</button></p></form><small>Sandbox members: 12345 and 67890.</small>',
        ),
      );
      return;
    }
    if (path === "/legacy/recover") {
      res.setHeader(
        "Set-Cookie",
        "recovered=1; Path=/; SameSite=Strict; HttpOnly",
      );
      res.statusCode = 302;
      res.setHeader(
        "Location",
        "/legacy/member?member=" + encodeURIComponent(member),
      );
      res.end();
      return;
    }
    if (path === "/legacy/member" || path === "/legacy/summary") {
      if (scenario === "slow" && !recovered) {
        res.setHeader(
          "Set-Cookie",
          "recovered=1; Path=/; SameSite=Strict; HttpOnly",
        );
        setTimeout(() => {
          res.end(
            page(
              '<h2>Loading</h2><a href="/legacy/member?member=' +
                esc(member) +
                '">Retry</a>',
            ),
          );
        }, 700);
        return;
      }
      if (alerts[scenario] && !recovered) {
        const label =
          scenario === "notice"
            ? "Continue"
            : scenario === "transient"
              ? "Retry"
              : "Restore session";
        const recovery = [
          "notice",
          "transient",
          "session",
          "unknown_dialog",
        ].includes(scenario)
          ? '<p><a class="action" href="/legacy/recover?member=' +
            esc(member) +
            '">' +
            label +
            "</a></p>"
          : "";
        res.end(
          page(
            "<h2>" +
              alerts[scenario] +
              "</h2><aside>Automation must handle this condition explicitly.</aside>" +
              recovery,
          ),
        );
        return;
      }
      if (!/^\d{5}$/.test(member)) {
        res.end(page("<h2>Validation error</h2>"));
        return;
      }
      if (!["12345", "67890"].includes(member)) {
        res.end(page("<h2>Member not found</h2>"));
        return;
      }
      if (path === "/legacy/member") {
        const duplicate =
          scenario === "ambiguous"
            ? '<a href="/legacy/summary?member=' +
              esc(member) +
              '">Balance summary</a>'
            : "";
        res.end(
          page(
            "<h2>Member details</h2><table><tr><td>Member number</td><td>" +
              esc(member) +
              '</td></tr><tr><td>Name</td><td>Demo Member</td></tr></table><p><a class="action" href="/legacy/summary?member=' +
              esc(member) +
              '">Balance summary</a></p>' +
              duplicate +
              "<p><button>Transfer funds</button></p>",
          ),
        );
        return;
      }
      res.end(
        page(
          "<h2>Balance summary</h2><table><tr><td>Member number</td><td>" +
            esc(scenario === "wrong_member" ? "99999" : member) +
            "</td></tr><tr><td>Savings balance</td><td>" +
            (scenario === "bad_output"
              ? "unavailable"
              : member === "12345"
                ? "1250.75"
                : "9820.50") +
            "</td></tr><tr><td>Currency</td><td>USD</td></tr></table><p>Read-only summary complete.</p>",
        ),
      );
      return;
    }
    res.statusCode = 404;
    res.end(page("<h2>Application error</h2>"));
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  return {
    origin: "http://127.0.0.1:" + (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
