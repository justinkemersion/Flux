import { ProjectManager } from "@flux/core";
import { EngineV2 } from "@flux/engine-v2";

let manager: ProjectManager | null = null;
let engineV2: EngineV2 | null = null;

export function getProjectManager(): ProjectManager {
  if (!manager) {
    manager = new ProjectManager();
  }
  return manager;
}

export function getEngineV2(): EngineV2 {
  if (!engineV2) {
    engineV2 = new EngineV2();
  }
  return engineV2;
}
