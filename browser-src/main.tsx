import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { CadApplication } from "./application";
import { openProjectRepository } from "./storage/repository";
import { AgentCadAdapter } from "./agentAdapter";

declare global {
  interface Window { pitonAgent: AgentCadAdapter; }
}

const root = createRoot(document.getElementById("root")!);

void openProjectRepository()
  .then((repository) => {
    const application = new CadApplication(repository);
    window.pitonAgent = new AgentCadAdapter(application);
    root.render(<StrictMode><App application={application} /></StrictMode>);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    root.render(<main className="loading"><h1>Piton</h1><p>Persistence unavailable: {message}</p></main>);
  });