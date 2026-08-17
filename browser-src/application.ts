import type { BrowserProject, CadCommandReceipt, CadCommandRequest, CandidateCommand } from "./domain";
import { sha256Hex } from "./domain";
import type { BuildStatus, ProjectRepository } from "./storage/repository";
import type { PortableCustodyPacket } from "./portable";
import { canonicalJson, exportPortableCustody, parsePortableCustody } from "./portable";

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
  private readonly pendingCommands = new Map<string, { digest: string; execution: Promise<CadCommandReceipt> }>();

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

  async executeCommand(input: unknown): Promise<CadCommandReceipt> {
    const request = parseCadCommandRequest(input);
    const project = await this.repository.load();
    if (!project) throw new Error("project is not initialized");
    if (request.projectId !== project.id) throw new Error("project identity mismatch");
    const digest = `sha256-${sha256Hex(canonicalJson({
      format: request.format,
      projectId: request.projectId,
      expectedCurrentRevisionId: request.expectedCurrentRevisionId,
      command: request.command,
    }))}`;
    const pending = this.pendingCommands.get(request.idempotencyKey);
    if (pending) {
      if (pending.digest !== digest) throw new Error("idempotency key conflicts with another request");
      return pending.execution;
    }
    const execution = this.repository.executeCommand(request, digest);
    this.pendingCommands.set(request.idempotencyKey, { digest, execution });
    try {
      return await execution;
    } finally {
      if (this.pendingCommands.get(request.idempotencyKey)?.execution === execution) {
        this.pendingCommands.delete(request.idempotencyKey);
      }
    }
  }

  async exportPortableCustody(): Promise<PortableCustodyPacket> {
    const project = await this.loadProject();
    return exportPortableCustody(project, await this.repository.loadLifecycleRecords(project.id));
  }

  async reopenPortableCustody(packet: unknown): Promise<BrowserProject> {
    const parsed = parsePortableCustody(packet);
    await this.repository.importFreshCustody(parsed.project, parsed.lifecycleRecords);
    return this.loadProject();
  }

  async recordBuildStatus(status: BuildStatus): Promise<BuildStatus> {
    await this.repository.saveBuildStatus(status);
    return status;
  }
}

function parseCadCommandRequest(input: unknown): CadCommandRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid command envelope");
  const value = input as Record<string, unknown>;
  if (!hasExactKeys(value, ["format", "projectId", "expectedCurrentRevisionId", "idempotencyKey", "command"])
    || value.format !== "piton-command/v1" || typeof value.projectId !== "string"
    || typeof value.expectedCurrentRevisionId !== "string" || typeof value.idempotencyKey !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.idempotencyKey)) throw new Error("invalid command envelope");
  if (!value.command || typeof value.command !== "object" || Array.isArray(value.command)) throw new Error("invalid command envelope");
  const command = value.command as Record<string, unknown>;
  if (!hasExactKeys(command, ["type", "quantity"]) || command.type !== "set-leg-length"
    || !command.quantity || typeof command.quantity !== "object" || Array.isArray(command.quantity)) throw new Error("invalid command envelope");
  const quantity = command.quantity as Record<string, unknown>;
  if (!hasExactKeys(quantity, ["value", "unit"]) || quantity.unit !== "mm" || typeof quantity.value !== "number"
    || !Number.isFinite(quantity.value) || quantity.value < 40 || quantity.value > 160) {
    throw new Error("leg_length_mm must be between 40 and 160 mm");
  }
  return input as CadCommandRequest;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
