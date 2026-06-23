import type { ProjectLifecycleState } from "./types.ts";

export {
  gatewayBlocksLifecycleState,
  lifecycleGatewayErrorMessage,
} from "./types.ts";

/** Default for legacy cache rows and pre-migration catalog rows. */
export function normalizeGatewayLifecycleState(
  value: string | null | undefined,
): ProjectLifecycleState {
  if (value === "dormant" || value === "archived") return value;
  return "active";
}
