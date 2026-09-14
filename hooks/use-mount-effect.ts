import { useEffect, useEffectEvent, useRef } from "react";

/**
 * Run a side effect exactly once on mount.
 * The only place useEffect may appear directly — components must use this instead.
 */
export function useMountEffect(effect: () => void | (() => void)) {
  const onMount = useEffectEvent(effect);
  useEffect(() => onMount(), []);
}

/**
 * Like useMountEffect but safe against React strict mode double-mount.
 * Use for non-idempotent operations (sending messages, API mutations)
 * where running twice would cause real damage.
 */
export function useStrictMountEffect(effect: () => void) {
  const executed = useRef(false);
  const onMount = useEffectEvent(effect);
  useEffect(() => {
    if (executed.current) return;
    executed.current = true;
    onMount();
  }, []);
}
