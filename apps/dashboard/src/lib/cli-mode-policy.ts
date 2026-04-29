export type UserPlan = "hobby" | "pro";
export type ProjectMode = "v1_dedicated" | "v2_shared";

export function defaultModeForPlan(plan: UserPlan): ProjectMode {
  return plan === "pro" ? "v1_dedicated" : "v2_shared";
}

export function resolveCreateModeForPlan(input: {
  requestedMode?: ProjectMode;
  plan: UserPlan;
}): { ok: true; mode: ProjectMode } | { ok: false; message: string } {
  if (input.requestedMode === "v1_dedicated" && input.plan !== "pro") {
    return {
      ok: false,
      message: "Isolated dedicated stacks require a Pro subscription.",
    };
  }
  return {
    ok: true,
    mode: input.requestedMode ?? defaultModeForPlan(input.plan),
  };
}
