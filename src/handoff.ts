import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { Action, type Observation, type Checkpoint } from "./schema.js";
import type { BrowserSurface } from "./surface.js";
import type { Evidence } from "./evidence.js";
import { Fault } from "./policy.js";
import { operatorHtml } from "./operator-ui.js";
export type Intervention = {
  capabilityId: string;
  id: string;
  url: string;
  token: string;
  reason: string;
  step: string;
  sessionId: string;
  observation: Observation | null;
};
export type HandoffOptions = {
  timeoutMs?: number;
  onRequest?: (i: Intervention) => Promise<void> | void;
};
export class Handoff {
  constructor(
    readonly surface: BrowserSurface,
    readonly evidence: Evidence,
    readonly options: HandoffOptions,
    readonly onAction?: (
      action: Action,
      observation: Observation,
    ) => Promise<void>,
  ) {}
  async request(
    reason: string,
    step: string,
    observation: Observation | null,
    expected?: Checkpoint,
  ): Promise<boolean> {
    const id = randomUUID(),
      token = randomBytes(32).toString("hex");
    this.surface.owner = "paused";
    await this.evidence.snapshot(observation);
    await this.evidence.event("intervention_requested", {
      capabilityId: "member-savings-balance",
      id,
      reason,
      step,
      sessionId: this.surface.sessionId,
      observation,
    });
    let finish!: (ok: boolean) => void;
    const completed = new Promise<boolean>((resolve) => (finish = resolve));
    let manualActions = 0;
    let busy = false,
      settled = false;
    const complete = (ok: boolean) => {
      if (settled) return;
      settled = true;
      this.surface.owner = "paused";
      finish(ok);
    };
    const inspect = async () => {
      const current = await this.surface.observe().catch(() => null);
      const verified =
        !!current &&
        current.status === "ready" &&
        manualActions > 0 &&
        (!expected || (await this.surface.check(expected).catch(() => false)));
      const allowedControls = (current?.controls ?? []).filter((target) => {
        try {
          this.surface.policy.action({ kind: "click", target }, "human");
          return (
            target.name !== "Search" ||
            current!.filled.some((t) => t.name === "Member number")
          );
        } catch {
          return false;
        }
      });
      return {
        observation: current ?? observation,
        verified,
        allowedControls,
        canFill:
          current?.headings.some((t) => t.name === "Member search") ?? false,
      };
    };
    const server = http.createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Frame-Options", "DENY");
      const reply = (status: number, value: unknown) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(value));
      };
      const path = req.url?.split("?")[0];
      if (path === "/" && req.method === "GET") {
        res.setHeader("Content-Type", "text/html");
        res.end(operatorHtml);
        return;
      }
      if (req.headers.authorization !== "Bearer " + token) {
        reply(401, { code: "UNAUTHORIZED" });
        return;
      }
      if (
        req.headers.origin &&
        req.headers.origin !== "http://" + req.headers.host
      ) {
        reply(403, { code: "ORIGIN_DENIED" });
        return;
      }
      if (settled) {
        reply(409, { code: "INTERVENTION_CLOSED" });
        return;
      }
      if (path === "/state" && req.method === "GET") {
        const view = await inspect();
        reply(200, {
          capabilityId: "member-savings-balance",
          id,
          reason,
          step,
          sessionId: this.surface.sessionId,
          owner: this.surface.owner,
          observation: view.observation,
          canResume: this.surface.owner === "human" && !busy && view.verified,
          allowedControls: view.allowedControls,
          canFill: view.canFill,
        });
        return;
      }
      if (req.method !== "POST") {
        reply(405, { code: "METHOD_DENIED" });
        return;
      }
      if (busy) {
        reply(409, { code: "ACTION_IN_PROGRESS" });
        return;
      }
      busy = true;
      try {
        let raw = "";
        for await (const part of req) {
          raw += part;
          if (raw.length > 16384) throw new Fault("BODY_TOO_LARGE");
        }
        const body = JSON.parse(raw || "{}");
        if (path === "/claim") {
          if (this.surface.owner !== "paused")
            throw new Fault("ALREADY_CLAIMED");
          this.surface.owner = "human";
          await this.evidence.event("control_claimed", {
            id,
            actor: "human",
            sessionId: this.surface.sessionId,
          });
          reply(200, { owner: "human" });
        } else if (path === "/action") {
          if (this.surface.owner !== "human")
            throw new Fault("CONTROL_NOT_OWNED");
          const action = Action.parse(body.action);
          const params: Record<string, string> = {};
          if (action.kind === "fill") {
            if (
              typeof body.parameters?.memberId !== "string" ||
              !/^\d{5}$/.test(body.parameters.memberId)
            )
              throw new Fault("INVALID_INPUT");
            params.memberId = body.parameters.memberId;
          }
          await this.surface.perform(action, params, "human");
          await this.evidence.action(
            step,
            action,
            "human",
            "operator_intervention",
          );
          await this.onAction?.(action, await this.surface.observe());
          manualActions++;
          reply(200, { ok: true });
        } else if (path === "/resume" || path === "/abort") {
          if (this.surface.owner !== "human")
            throw new Fault("CONTROL_NOT_OWNED");
          if (path === "/resume" && !(await inspect()).verified)
            throw new Fault("RECOVERY_NOT_VERIFIED");
          await this.evidence.event(
            path === "/resume" ? "control_released" : "operator_aborted",
            { id, actor: "human", sessionId: this.surface.sessionId },
          );
          reply(200, { ok: true });
          complete(path === "/resume");
        } else reply(404, { code: "NOT_FOUND" });
      } catch (e) {
        reply(409, { code: e instanceof Fault ? e.code : "INVALID_REQUEST" });
      } finally {
        busy = false;
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const url = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    const timer = setTimeout(
      () => complete(false),
      this.options.timeoutMs ?? 120000,
    );
    try {
      const request = {
        capabilityId: "member-savings-balance",
        id,
        url,
        token,
        reason,
        step,
        sessionId: this.surface.sessionId,
        observation,
      };
      if (this.options.onRequest)
        void Promise.resolve(this.options.onRequest(request)).catch(() =>
          complete(false),
        );
      else
        console.log("Operator handoff (local, private): " + url + "/#" + token);
      const ok = await completed;
      await this.evidence.event("intervention_closed", { id, resumed: ok });
      if (ok) this.surface.owner = "automation";
      return ok;
    } finally {
      clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}
