import type { BrowserProject, CandidateCommand } from "./domain";
import type { BuildStatus, ProjectRepository } from "./storage/repository";

export type { BuildStatus } from "./storage/repository";

export interface CadApplicationSnapshot {
  project: BrowserProject;
  buildStatus: BuildStatus | null;
  persistenceLabel: string;
}

/**
 * The sole browser application boundary for authored revision custody and
 * durable preview-status consequences. UI and geometry adapters receive this
 * service, never the writable repository port.
 */
export class CadApplication {
  constructor(private readonly repository: ProjectRepository) {}

  async open(): Promise<CadApplicationSnapshot> {
    const project = await this.repository.initialize();
    return {
      project,
      buildStatus: await this.repository.loadBuildStatus(project.id),
      persistenceLabel: this.repository.persistenceLabel,
    };
  }

  async loadProject(): Promise<BrowserProject> {
    const project = await this.repository.load();
    if (!project) throw new Error("initialized project disappeared");
    return project;
  }

  commitCandidate(expectedCurrentRevisionId: string, command: CandidateCommand): Promise<BrowserProject> {
    return this.repository.commitCandidate(expectedCurrentRevisionId, command);
  }

  async recordBuildStatus(status: BuildStatus): Promise<BuildStatus> {
    await this.repository.saveBuildStatus(status);
    return status;
  }
}
