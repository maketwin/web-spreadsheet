export type EventHandler<T = unknown> = (payload: T) => void;
export type Unsubscribe = () => void;

interface ListenerRecord {
  readonly original: EventHandler<unknown>;
  readonly wrapped: EventHandler<unknown>;
}

export interface WildcardPayload<T = unknown> {
  readonly event: string;
  readonly payload: T | undefined;
}

export class EventBus {
  private listeners = new Map<string, Set<ListenerRecord>>();

  public on<T = unknown>(event: string, fn: EventHandler<T>): Unsubscribe {
    const records = this.getOrCreateListeners(event);
    const record: ListenerRecord = {
      // Store handlers erased to unknown so different event payload types share one map.
      original: fn as EventHandler<unknown>,
      // Rehydrate the caller's event-specific payload type before invoking it.
      wrapped: (payload) => fn(payload as T),
    };

    records.add(record);
    return () => this.off(event, fn);
  }

  public off<T = unknown>(event: string, fn: EventHandler<T>): void {
    const records = this.listeners.get(event);
    if (records === undefined) return;

    records.forEach((record) => {
      if (record.original === fn) {
        records.delete(record);
      }
    });
  }

  public emit<T = unknown>(event: string, payload?: T): void {
    this.listeners.get(event)?.forEach((record) => record.wrapped(payload));
    this.listeners.get('*')?.forEach((record) => record.wrapped({ event, payload }));
  }

  private getOrCreateListeners(event: string): Set<ListenerRecord> {
    const current = this.listeners.get(event);
    if (current !== undefined) return current;

    const next = new Set<ListenerRecord>();
    this.listeners.set(event, next);
    return next;
  }
}
