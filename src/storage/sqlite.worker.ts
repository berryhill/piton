import sqlite3InitModule, { type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import sqliteWasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";

// The package's default worker resolves an unhashed sqlite3.wasm relative to
// itself. Bundle our own entry and give Emscripten Vite's emitted asset URL.
// The bundler-friendly module also bundles its OPFS async proxy worker.
// This installed package supports locateFile but omits it from its init type.
const initialize = sqlite3InitModule as (options: {
  locateFile: (filename: string, prefix: string) => string;
}) => Promise<Sqlite3Static>;

initialize({
  locateFile: (filename, prefix) => filename === "sqlite3.wasm"
    ? sqliteWasmUrl
    : prefix + filename,
}).then((sqlite3) => sqlite3.initWorker1API()).catch((error: unknown) => {
  // Surface initialization failures to the parent's Worker error listener.
  setTimeout(() => { throw error; }, 0);
});
