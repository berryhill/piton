export interface GeometryWorkerSurface {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

let nextWorkerGeneration = 0;
const workerGenerations = new WeakMap<object, number>();

export function geometryWorkerGeneration(worker: GeometryWorkerSurface): number {
  const generation = workerGenerations.get(worker);
  if (!generation) throw new Error("Geometry worker was not constructed by the guarded client");
  return generation;
}

export function postGeometryWorkerMessage(
  worker: GeometryWorkerSurface,
  message: unknown,
  onFailure: (message: string) => void,
): boolean {
  try {
    worker.postMessage(message);
    return true;
  } catch (error) {
    onFailure(`Geometry worker postMessage failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export function constructGeometryWorker<T extends GeometryWorkerSurface>(
  factory: () => T,
  onFailure: (message: string) => void,
): T | null {
  let worker: T;
  try {
    worker = factory();
  } catch (error) {
    onFailure(`Geometry worker bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  worker.onerror = (event) => {
    event.preventDefault();
    onFailure(`Geometry worker runtime failed: ${event.message || "unknown worker error"}`);
  };
  worker.onmessageerror = () => onFailure("Geometry worker message decoding failed");
  nextWorkerGeneration += 1;
  workerGenerations.set(worker, nextWorkerGeneration);
  return worker;
}
