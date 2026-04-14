import { ProjectManager } from "@flux/core";

let manager: ProjectManager | null = null;

export function getProjectManager(): ProjectManager {
  if (!manager) {
    manager = new ProjectManager();
  }
  return manager;
}
