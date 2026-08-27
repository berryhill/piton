import type { CadApplication } from "./application";
import type { CadCommandReceipt } from "./domain";

/** Untrusted automation adapter. CadApplication remains the only consequence boundary. */
export class AgentCadAdapter {
  constructor(private readonly application: Pick<CadApplication, "executeCommand">) {}

  execute(input: unknown): Promise<CadCommandReceipt> {
    return this.application.executeCommand(input);
  }
}
