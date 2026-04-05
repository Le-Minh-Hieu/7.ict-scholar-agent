import { Interrupt, ThreadState } from "../schema.cjs";

//#region src/ui/interrupts.d.ts
/**
 * Normalizes HITL interrupt payloads to expose camelCase fields plus deprecated
 * snake_case aliases for compatibility during migration.
 */
declare function normalizeInterruptForClient<T = unknown>(interrupt: Interrupt<T>): Interrupt<T>;
/**
 * Applies {@link normalizeInterruptForClient} to each interrupt.
 */
declare function normalizeInterruptsList<T = unknown>(interrupts: Interrupt<T>[]): Interrupt<T>[];
declare function extractInterrupts<InterruptType = unknown>(values: unknown, options?: {
  isLoading: boolean;
  threadState: ThreadState | undefined;
  error: unknown;
}): Interrupt<InterruptType> | undefined;
//#endregion
export { extractInterrupts, normalizeInterruptForClient, normalizeInterruptsList };
//# sourceMappingURL=interrupts.d.cts.map