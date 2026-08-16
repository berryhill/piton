import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { CadApplication } from "./application";
import { openProjectRepository } from "./storage/repository";

const root = createRoot(document.getElementById("root")!);

void openProjectRepository()
  .then((repository) => {
    const application = new CadApplication(repository);
    root.render(<StrictMode><App application={application} /></StrictMode>);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    root.render(<main className="loading"><h1>Piton</h1><p>Persistence unavailable: {message}</p></main>);
  });