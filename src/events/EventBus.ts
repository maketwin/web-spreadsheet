import type { SpreadsheetEvents } from './events';

export type { SpreadsheetEvents } from './events';

export type EventHandler<T = unknown> = (payload: T) => void;
export type Unsubscribe = () => void;

/**
 * Payload type of event `K` in table `TEvents`; unknown names keep `unknown`.
 * Constrained to `object` (not `Record<string, unknown>`) so interface event
 * tables — which carry no index signature — qualify as event tables too.
 */
export type EventPayload<K extends string, TEvents extends object> = K extends keyof TEvents ? TEvents[K] : unknown;

interface ListenerRecord {
  readonly original: EventHandler<unknown>;
  readonly wrapped: EventHandler<unknown>;
}

export interface WildcardPayload<T = unknown> {
  readonly event: string;
  readonly payload: T | undefined;
}

export class EventBus<TEvents extends object = SpreadsheetEvents> {
  private listeners = new Map<string, Set<ListenerRecord>>();

  public on<K extends string>(event: K, fn: EventHandler<EventPayload<K, TEvents>>): Unsubscribe {
    const records = this.getOrCreateListeners(event);
    const record: ListenerRecord = {
      // Store handlers erased to unknown so different event payload types share one map.
      original: fn as EventHandler<unknown>,
      // Rehydrate the caller's event-specific payload type before invoking it.
      wrapped: (payload) => fn(payload as EventPayload<K, TEvents>),
    };

    records.add(record);
    // Retires exactly THIS subscription: subscribing the same function twice
    // yields two independent unsubs, each removing only its own record.
    return () => { records.delete(record); };
  }

  /**
   * Removes the EARLIEST surviving subscription matching `(event, fn)` —
   * calling `off` once after two `on`s leaves the second subscription live.
   * To retire a precise subscription, use the `Unsubscribe` returned by `on`.
   */
  public off<K extends string>(event: K, fn: EventHandler<EventPayload<K, TEvents>>): void {
    const records = this.listeners.get(event);
    if (records === undefined) return;

    for (const record of records) {
      if (record.original === fn) {
        records.delete(record);
        return;
      }
    }
  }

  // Emit stays loose on purpose: publishers may fan out any event name with
  // any payload (plugin events included) without touching this class.
  public emit<T = unknown>(event: string, payload?: T): void {
    this.emitTo(this.listeners.get(event), payload);
    this.emitTo(this.listeners.get('*'), { event, payload });
  }

  /**
   * One failing listener must not break the publisher or the other listeners:
   * each handler runs isolated, errors are logged and dispatch continues
   * (including the `*` listeners, which run in their own pass).
   */
  private emitTo(records: Set<ListenerRecord> | undefined, payload: unknown): void {
    if (records === undefined) return;
    for (const record of [...records]) {
      try {
        record.wrapped(payload);
      } catch (err) {
        console.error('EventBus listener threw:', err);
      }
    }
  }

  private getOrCreateListeners(event: string): Set<ListenerRecord> {
    const current = this.listeners.get(event);
    if (current !== undefined) return current;

    const next = new Set<ListenerRecord>();
    this.listeners.set(event, next);
    return next;
  }
}
