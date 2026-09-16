import http from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { workspacePage as page, appShell } from "./ui.js";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const memberSearchScript = `(() => {
  const form = document.querySelector('form');
  const input = form.elements.namedItem('member');
  const button = form.querySelector('button[type="submit"]');
  const update = () => { button.disabled = !/^[0-9]{5}$/.test(input.value); };
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  window.addEventListener('pageshow', update);
  form.addEventListener('submit', event => { update(); if (button.disabled) event.preventDefault(); });
  update();
})();`;
const searchScriptHash = createHash("sha256")
  .update(memberSearchScript)
  .digest("base64");
const alerts: Record<string, { title: string; message: string }> = {
  validation: {
    title: "Validation error",
    message:
      "We could not validate this lookup. Check the member number and try again.",
  },
  permission: {
    title: "Permission denied",
    message:
      "This session does not have permission to view member records. Contact an authorized operator.",
  },
  session: {
    title: "Session expired",
    message:
      "Your session has expired. An operator can restore access to continue this lookup.",
  },
  app_error: {
    title: "Application error",
    message:
      "The member service is unavailable. This lookup has stopped so an operator can review it.",
  },
  unknown_dialog: {
    title: "Unexpected confirmation",
    message:
      "This lookup requires an operator to review a confirmation before continuing.",
  },
  transient: {
    title: "Temporarily unavailable",
    message:
      "The member service is taking longer than expected. Retry to continue your lookup.",
  },
  notice: {
    title: "Service notice",
    message:
      "Member services are available. Acknowledge this notice to continue your lookup.",
  },
};
const info = (title: string, body: string) =>
  '<aside class="info-panel"><h3>' + title + "</h3>" + body + "</aside>";
const grid = (body: string, aside: string) =>
  '<div class="content-grid"><section class="main-panel">' +
  body +
  "</section>" +
  aside +
  "</div>";
const errorPage = (title: string, message: string, action = "", stage = 1) =>
  page(
    grid(
      '<div class="notice-icon" aria-hidden="true">!</div><div class="eyebrow">Lookup needs attention</div><h2>' +
        title +
        "</h2><p>" +
        message +
        "</p>" +
        action,
      info(
        "Your place is saved",
        "<p>The current member lookup stays in this session while the issue is reviewed.</p><p>Only available actions are shown.</p>",
      ),
    ),
    stage,
  );
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
      "default-src 'self'; style-src 'unsafe-inline'; script-src " +
        (path === "/legacy/search"
          ? "'sha256-" + searchScriptHash + "'"
          : "'none'") +
        "; frame-ancestors 'self'; form-action 'self'",
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (path === "/app") {
      res.end(appShell());
      return;
    }
    if (path === "/legacy/search") {
      res.end(
        page(
          grid(
            '<div class="eyebrow">01 / Find a member</div><h2>Member search</h2><p>Enter a member number to get started.</p><form method="get" action="/legacy/member"><table class="form-table"><tr><td>Member number</td><td><input name="member" type="text" autocomplete="off" aria-label="Member number" aria-describedby="member-hint" placeholder="5 digits (e.g. 12345)" inputmode="numeric" pattern="[0-9]{5}" minlength="5" maxlength="5" required></td></tr></table><p class="hint" id="member-hint"><small>Enter exactly 5 digits to enable Search.</small></p><button type="submit" disabled>Search</button></form>',
            info(
              "Try a sample member",
              "<p>Use <strong>12345</strong> or <strong>67890</strong> to explore a complete lookup.</p><p>All member records in this workspace are synthetic.</p>",
            ),
          ) +
            "<script>" +
            memberSearchScript +
            "</script>",
          0,
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
        setTimeout(
          () =>
            res.end(
              errorPage(
                "Loading",
                "We are retrieving this member's details.",
                '<div class="actions"><a class="action" href="/legacy/member?member=' +
                  esc(member) +
                  '">Retry</a></div>',
              ),
            ),
          700,
        );
        return;
      }
      const alert = alerts[scenario];
      if (alert && !recovered) {
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
          ? '<div class="actions"><a class="action" href="/legacy/recover?member=' +
            esc(member) +
            '">' +
            label +
            "</a></div>"
          : "";
        res.end(errorPage(alert.title, alert.message, recovery));
        return;
      }
      if (!/^\d{5}$/.test(member)) {
        res.end(
          errorPage(
            "Validation error",
            "Enter a member number containing exactly five digits.",
          ),
        );
        return;
      }
      if (!["12345", "67890"].includes(member)) {
        res.end(
          errorPage(
            "Member not found",
            "No member matched this number. Check the number before starting a new lookup.",
          ),
        );
        return;
      }
      if (path === "/legacy/member") {
        const link =
          '<a class="action" href="/legacy/summary?member=' +
          esc(member) +
          '">Balance summary</a>';
        res.end(
          page(
            grid(
              '<div class="eyebrow">02 / Review the record</div><h2>Member details</h2><p>Confirm the member record before viewing their balance.</p><table><tr><td>Member number</td><td>' +
                esc(member) +
                '</td></tr><tr><td>Name</td><td>Demo Member</td></tr><tr><td>Account type</td><td>Savings</td></tr></table><div class="actions">' +
                link +
                (scenario === "ambiguous" ? link : "") +
                "</div>",
              info(
                "Read-only servicing",
                '<p>This workspace provides account information without changing member records.</p><button class="secondary" disabled>Transfer funds</button><p><small>Transactions are unavailable in this demo.</small></p>',
              ),
            ),
            1,
          ),
        );
        return;
      }
      const balance =
        scenario === "bad_output"
          ? "unavailable"
          : member === "12345"
            ? "1250.75"
            : "9820.50";
      res.end(
        page(
          grid(
            '<div class="eyebrow">03 / Account overview</div><h2>Balance summary</h2><p>The requested savings-account information is ready.</p><table class="account-table"><tr><td>Member number</td><td>' +
              esc(scenario === "wrong_member" ? "99999" : member) +
              '</td></tr><tr class="balance-row"><td>Savings balance</td><td>' +
              balance +
              '</td></tr><tr><td>Currency</td><td>USD</td></tr></table><div class="notice success"><p>Lookup complete. No account changes were made.</p></div>',
            info(
              "Verified account context",
              "<p>This balance belongs to the member selected in the current lookup.</p><p>Demo data is shown for evaluation purposes.</p>",
            ),
          ),
          2,
        ),
      );
      return;
    }
    res.statusCode = 404;
    res.end(errorPage("Application error", "This page is unavailable."));
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
