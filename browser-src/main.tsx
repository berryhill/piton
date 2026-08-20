import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { CadApplication } from "./application";
import { openProjectRepository } from "./storage/repository";
import { resolveStartup } from "./startup";
import { AgentCadAdapter } from "./agentAdapter";

declare global {
  interface Window { pitonAgent: AgentCadAdapter; }
}

const root = createRoot(document.getElementById("root")!);

async function start(): Promise<void> {
  try {
    const startup = resolveStartup(new URL(window.location.href));
    if (startup.persistentUrl) history.replaceState(null, "", startup.persistentUrl);
    const repository = await openProjectRepository(startup.namespace);
    const application = new CadApplication(repository);
    window.pitonAgent = new AgentCadAdapter(application);
    root.render(<StrictMode><App application={application} startupMode={startup.mode} /></StrictMode>);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    root.render(<main className="loading"><h1>Piton failed to open</h1><p>Persistence unavailable: {message}</p></main>);
  }
}

void start();