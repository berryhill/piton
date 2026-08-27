export type StartupMode = "open-or-seed" | "import-fresh" | "reopen-existing";

export interface StartupTarget {
  mode: StartupMode;
  namespace: string;
  persistentUrl?: string;
}

const IMPORT_NAMESPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveStartup(url: URL): StartupTarget {
  if (url.searchParams.get("mode") === "import") {
    const id = crypto.randomUUID();
    return {
      mode: "import-fresh",
      namespace: `piton-import-${id}`,
      persistentUrl: `?mode=reopen&ns=${id}`,
    };
  }
  if (url.searchParams.get("mode") === "reopen") {
    const id = url.searchParams.get("ns") ?? "";
    if (!IMPORT_NAMESPACE_ID.test(id)) throw new Error("invalid import namespace");
    return { mode: "reopen-existing", namespace: `piton-import-${id}` };
  }
  return { mode: "open-or-seed", namespace: "piton" };
}
