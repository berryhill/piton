import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { CadApplication } from "./application";
import { openProjectRepository } from "./storage/repository";
import { resolveStartup } from "./startup";
import { AgentCadAdapter } from "./agentAdapter";
import ProjectWorkspace from "./ProjectWorkspace";
import { WorkspaceApplication } from "./workspace";
import { SqliteOpfsProjectRepository } from "./storage/repository";

declare global {
  interface Window { pitonAgent: AgentCadAdapter; }
}

const root = createRoot(document.getElementById("root")!);

async function start(): Promise<void> {
  try {
    if (location.pathname !== "/demo" && !(location.pathname === "/" && ["import", "reopen"].includes(new URLSearchParams(location.search).get("mode") ?? ""))) {
      if (location.pathname === "/") history.replaceState(null, "", "/projects");
      const repository = await SqliteOpfsProjectRepository.open();
      root.render(<ProjectWorkspace application={new WorkspaceApplication(repository)} />);
      return;
    }
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