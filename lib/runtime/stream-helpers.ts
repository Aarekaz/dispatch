/**
 * Consume an async generator until a promise resolves.
 * Yields events from the generator, stops when the promise settles.
 */
export async function* takeUntil<T>(
  stream: AsyncGenerator<T>,
  signal: Promise<unknown>,
): AsyncGenerator<T> {
  let done = false;
  signal.then(() => { done = true; }).catch(() => { done = true; });

  for await (const event of stream) {
    yield event;
    if (done) break;
  }
}
