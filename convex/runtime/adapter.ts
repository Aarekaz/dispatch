/**
 * HarnessAdapter — abstraction layer for different agent harnesses.
 *
 * Each harness (OpenCode, OpenHands, Goose, etc.) implements this interface.
 * The persistence layer (DeltaStreamer) doesn't know or care which harness
 * generated the events — it just consumes the normalized UIMessageStream.
 */

export type HarnessEvent = {
  type: string;
  properties?: Record<string, unknown>;
};

export interface HarnessAdapter {
  /** Create a new session in the harness */
  createSession(): Promise<{ sessionId: string }>;

  /** Send a prompt and get back an async iterable of harness-specific events */
  sendAndSubscribe(
    sessionId: string,
    message: string,
  ): Promise<{ events: AsyncIterable<HarnessEvent> }>;

  /**
   * Transform harness-specific events into AI SDK UIMessageStream chunks.
   * Returns a ReadableStream that DeltaStreamer can consume.
   */
  normalizeToUIStream(
    events: AsyncIterable<HarnessEvent>,
  ): ReadableStream<unknown>;
}
