import { useEffect, useEffectEvent } from "react";

export function useToolComplete(
  isAnimating: boolean,
  duration: number,
  onComplete: () => void,
) {
  const onCompleteEvent = useEffectEvent(onComplete);

  useEffect(() => {
    if (!isAnimating) return;
    const t = setTimeout(() => onCompleteEvent(), duration);
    return () => clearTimeout(t);
  }, [duration, isAnimating]);
}
