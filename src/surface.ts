import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Frame,
  type Locator,
} from "playwright";
import { Policy, Fault, targets } from "./policy.js";
import type {
  Action,
  Target,
  Observation,
  Checkpoint,
  Status,
} from "./schema.js";
import type { Evidence } from "./evidence.js";
import { pause, type Presentation } from "./presentation.js";
import { physicalName, type Variant } from "./bindings.js";
export interface Surface {
  readonly sessionId: string;
  observe(): Promise<Observation>;
  perform(
    action: Action,
    parameters: Record<string, string>,
    actor: "automation" | "human",
  ): Promise<void>;
  check(checkpoint: Checkpoint): Promise<boolean>;
  extract(target: Target, type: "number" | "string"): Promise<string | number>;
}
const statusNames: Record<string, Status> = {
  "Member not found": "not_found",
  "Validation error": "validation",
  "Permission denied": "permission",
  "Session expired": "session_expired",
  "Temporarily unavailable": "transient",
  "Application error": "app_error",
  "Service notice": "notice",
  "Unexpected confirmation": "unknown_dialog",
  Loading: "loading",
};
export class BrowserSurface implements Surface {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  sessionId: string;
  owner: "automation" | "paused" | "human" | "closed" = "automation";
  networkViolation = false;
  dialog = false;
  constructor(
    readonly policy: Policy,
    readonly evidence: Evidence,
    readonly presentation: Presentation = { actionDelayMs: 0, finalHoldMs: 0 },
    readonly variant: Variant = "classic",
    readonly delayMs = 0,
  ) {
    this.sessionId = evidence.runId;
  }
  async open(entry: string, scenario = "normal", headless = true) {
    this.policy.url(entry);
    this.browser = await chromium.launch({ headless });
    this.context = await this.browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
      viewport: { width: 1280, height: 840 },
    });
    this.context.setDefaultTimeout(this.policy.config.stepTimeoutMs);
    await this.context.addCookies([
      { name: "variant", value: this.variant, url: this.policy.origin },
      { name: "delay", value: String(this.delayMs), url: this.policy.origin },
      {
        name: "scenario",
        value: scenario,
        url: this.policy.origin,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    await this.context.route("**/*", async (route) => {
      try {
        this.policy.url(route.request().url());
        if (route.request().method() !== "GET")
          throw new Fault("METHOD_DENIED");
        await route.continue();
      } catch {
        this.networkViolation = true;
        await route.abort("blockedbyclient");
      }
    });
    await this.context.routeWebSocket("**/*", (ws) => {
      this.networkViolation = true;
      ws.close();
    });
    this.context.on("page", (page) => {
      if (this.page && page !== this.page) {
        this.networkViolation = true;
        void page.close();
      }
    });
    this.page = await this.context.newPage();
    this.page.on("dialog", (dialog) => {
      this.dialog = true;
      void dialog.dismiss();
    });
    this.page.on("download", (download) => {
      this.networkViolation = true;
      void download.cancel();
    });
    await this.page.goto(entry, { waitUntil: "domcontentloaded" });
    await this.frameReady();
    await this.preflight();
  }
  async frameReady(): Promise<Frame> {
    for (let i = 0; i < 40; i++) {
      const f = this.page.frame({ name: "workspace" });
      if (f && f.url() !== "about:blank") {
        this.policy.url(f.url());
        await f.waitForLoadState("domcontentloaded");
        return f;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Fault("FRAME_MISSING");
  }
  async locator(t: Target): Promise<Locator> {
    this.policy.target(t);
    const f = await this.frameReady();
    if (t.strategy === "role")
      return f.getByRole(t.role!, {
        name: physicalName(t.name, this.variant),
        exact: true,
      });
    if (this.variant === "cards")
      return f
        .locator(".record-field")
        .filter({
          has: f
            .locator("dt")
            .getByText(physicalName(t.name, this.variant), { exact: true }),
        })
        .locator("dd");
    // Legacy table relationship: the first cell is the field label; exactly one
    // matching row is required. No generated IDs, coordinates, or nth-match fallback.
    return f
      .locator("tr")
      .filter({
        has: f.locator("td:first-child").getByText(t.name, { exact: true }),
      })
      .locator("td:nth-child(2)");
  }
  async preflight() {
    const f = await this.frameReady();
    if (
      (await f
        .locator('meta[name="ledger-layout"]')
        .getAttribute("content")) !== this.variant
    )
      throw new Fault("UI_DRIFT");
    const obs = await this.observe();
    const stage = obs.headings.find((t) =>
      ["Member search", "Member details", "Balance summary"].includes(t.name),
    )?.name;
    if (!stage) {
      if (obs.status === "unknown") throw new Fault("UI_DRIFT");
      return;
    }
    const required =
      stage === "Member search"
        ? ["Member number", "Search"]
        : stage === "Member details"
          ? ["Member number", "Balance summary"]
          : ["Member number", "Savings balance", "Currency"];
    for (const name of required) {
      const target = targets.find(
        (t) => t.name === name && t.role !== "heading",
      )!;
      const locator = await this.locator(target);
      const count = await locator.count();
      if (count > 1) throw new Fault("AMBIGUOUS_TARGET");
      if (count !== 1 || !(await locator.isVisible()))
        throw new Fault("UI_DRIFT");
    }
    await this.evidence.event("preflight", {
      variant: this.variant,
      stage,
      passed: true,
    });
  }
  async unique(t: Target): Promise<Locator> {
    const l = await this.locator(t);
    await l.first().waitFor({ state: "visible" });
    if ((await l.count()) !== 1) throw new Fault("AMBIGUOUS_TARGET");
    return l;
  }
  async observe(): Promise<Observation> {
    if (this.networkViolation) throw new Fault("NETWORK_DENIED");
    // One synchronous DOM evaluation prevents mixing old and new documents during navigation.
    const f = await this.frameReady();
    const obs = (await f.evaluate(
      ({ catalog, names, dialog, variant, labels }) => {
        const result: any = {
          route: location.pathname,
          status: dialog ? "unknown_dialog" : "unknown",
          controls: [],
          fields: [],
          headings: [],
          filled: [],
        };
        for (const t of catalog) {
          const label = labels[t.name] ?? t.name;
          let nodes: Element[] = [];
          if (t.strategy === "table-label")
            nodes = [
              ...document.querySelectorAll(
                variant === "cards" ? ".record-field" : "tr",
              ),
            ]
              .filter((row) => row.children[0]?.textContent?.trim() === label)
              .map((row) => row.children[1]!)
              .filter(Boolean);
          else
            nodes = [
              ...document.querySelectorAll(
                t.role === "heading"
                  ? "h1,h2,h3,h4,h5,h6"
                  : t.role === "button"
                    ? "button"
                    : "a[href]",
              ),
            ].filter((el) => el.textContent?.trim() === label);
          if (
            !nodes.some(
              (el) =>
                !!(el as HTMLElement).offsetWidth &&
                !!(el as HTMLElement).offsetHeight,
            )
          )
            continue;
          if (t.role === "heading") {
            result.headings.push(t);
            if (names[t.name]) result.status = names[t.name];
            else if (result.status === "unknown") result.status = "ready";
          } else if (t.strategy === "table-label") {
            result.fields.push(t);
            if (
              nodes.some(
                (el) => (el.querySelector("input")?.value || "").length > 0,
              )
            )
              result.filled.push(t);
          } else result.controls.push(t);
        }
        return result;
      },
      {
        catalog: targets,
        names: statusNames,
        dialog: this.dialog,
        variant: this.variant,
        labels: Object.fromEntries(
          targets.map((t) => [t.name, physicalName(t.name, this.variant)]),
        ),
      },
    )) as Observation;
    return obs;
  }
  async perform(
    a: Action,
    params: Record<string, string>,
    actor: "automation" | "human",
  ) {
    if (this.owner !== actor) throw new Fault("CONTROL_NOT_OWNED");
    this.policy.action(a, actor);
    this.policy.url(this.page.url());
    if (this.networkViolation) throw new Fault("NETWORK_DENIED");
    await this.preflight();
    const l = await this.unique(a.target);
    if (actor === "automation" && this.presentation.actionDelayMs > 0) {
      await this.presentStatus(
        (a.kind === "fill" ? "Entering " : "Next action: ") + a.target.name,
      );
      await l.evaluate((el) => el.setAttribute("data-active-action", ""));
      await pause(this.presentation.actionDelayMs);
      await l.evaluate((el) => el.removeAttribute("data-active-action"));
      if (this.owner !== actor) throw new Fault("CONTROL_NOT_OWNED");
    }
    if (a.kind === "fill") {
      const value = params[a.parameter];
      if (value === undefined) throw new Fault("MISSING_PARAMETER");
      const input = l.locator("input");
      if ((await input.count()) !== 1) throw new Fault("AMBIGUOUS_TARGET");
      await input.fill(value);
    } else {
      const href = await l.getAttribute("href");
      if (href)
        this.policy.url(new URL(href, (await this.frameReady()).url()).href);
      if (a.target.name === "Search") {
        const form = l.locator("xpath=ancestor::form");
        const action = await form.getAttribute("action");
        if (!action) throw new Fault("FORM_DENIED");
        this.policy.url(new URL(action, (await this.frameReady()).url()).href);
      }
      const frame = await this.frameReady();
      const navigation = this.page.waitForEvent("framenavigated", {
        predicate: (f) => f === frame,
      });
      // All permitted click controls in this profile navigate. Attach before clicking.
      await Promise.all([navigation, l.click()]);
      await frame.waitForLoadState("domcontentloaded");
    }
    if (this.networkViolation) throw new Fault("NETWORK_DENIED");
  }
  async check(c: Checkpoint) {
    const l = await this.locator(c.target);
    return (await l.count()) === 1 && (await l.isVisible());
  }
  async extract(t: Target, type: "number" | "string") {
    const text = (await (await this.unique(t)).innerText()).trim();
    if (type === "number") {
      if (!/^-?\d+(\.\d{1,2})?$/.test(text))
        throw new Fault("OUTPUT_TYPE_MISMATCH");
      return Number(text);
    }
    if (t.name === "Currency" && !/^[A-Z]{3}$/.test(text))
      throw new Fault("OUTPUT_TYPE_MISMATCH");
    return text;
  }
  async presentStatus(message: string) {
    if (!this.page || this.page.isClosed()) return;
    const label = this.page.locator("[data-run-status]");
    if (await label.count())
      await label
        .evaluate((el, text) => {
          el.textContent = text;
        }, message)
        .catch(() => {});
  }
  async close() {
    this.owner = "closed";
    if (this.page && !this.page.isClosed())
      await pause(this.presentation.finalHoldMs);
    await this.browser?.close();
  }
}
