import type { Command } from '../commands/Command';
import type { CommandFailedPayload } from '../commands/CommandManager';

/**
 * The built-in event table of the spreadsheet bus. Subscribing to one of
 * these names types the handler's payload precisely; any other name is
 * allowed and its payload stays `unknown` (plugin-defined events).
 *
 * Type-only imports on purpose: the events layer must not depend on the
 * commands layer at runtime (kernel layering), while payload descriptions
 * need the shapes.
 */
export interface SpreadsheetEvents {
  /** A command is about to execute / was executed / undone / redone. */
  readonly 'command:executing': { readonly cmd: Command };
  readonly 'command:executed': { readonly cmd: Command };
  readonly 'command:undoing': { readonly cmd: Command };
  readonly 'command:undone': { readonly cmd: Command };
  readonly 'command:redoing': { readonly cmd: Command };
  readonly 'command:redone': { readonly cmd: Command };
  /** The command threw mid execute/undo/redo — replaces the matching `…ed` event. */
  readonly 'command:failed': CommandFailedPayload;
  /** The command was stopped before running: sheet protection rejected it. */
  readonly 'command:rejected': { readonly reason: 'protected' };
  /** Raw CSV text; emitted by the host, consumed by the built-in CsvImportPlugin. */
  readonly 'csv:import': string;
}
