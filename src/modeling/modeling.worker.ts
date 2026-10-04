/// <reference lib="webworker" />
import Module from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { evaluateFeatureSource } from "./evaluator";
import { readFeatures, type FeatureSource } from "./source";

self.onmessage = async (event: MessageEvent<FeatureSource>) => {
  try {
    readFeatures(event.data);
    const kernel = await Module({ locateFile: () => wasmUrl });
    kernel.setup();
    self.postMessage({ ok: true, result: evaluateFeatureSource(event.data, kernel) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "Feature evaluation failed" });
  }
};
