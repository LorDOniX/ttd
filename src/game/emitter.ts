type Handler<Args extends unknown[]> = (...args: Args) => void;

// Jednoduchý typovaný event emitter
export class Emitter<Events extends { [K in keyof Events]: unknown[] }> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    for (const handler of this.handlers.get(event) ?? []) (handler as Handler<Events[K]>)(...args);
  }
}
