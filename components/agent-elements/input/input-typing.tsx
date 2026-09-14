import { useEffect, useEffectEvent, useState } from "react";

export function useInputTyping(
  text: string,
  duration: number,
  isActive: boolean,
  onComplete: () => void,
) {
  const [visibleChars, setVisibleChars] = useState(0);
  const [showImage, setShowImage] = useState(false);
  const onCompleteEvent = useEffectEvent(onComplete);

  useEffect(() => {
    if (!isActive) return;

    const imageDelay = duration * 0.1;
    const typingStart = duration * 0.15;
    const typingDuration = duration * 0.7;
    const charInterval = typingDuration / text.length;
    const sendDelay = duration * 0.15;
    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(
      setTimeout(() => {
        setVisibleChars(0);
        setShowImage(false);
      }, 0),
    );
    timers.push(setTimeout(() => setShowImage(true), imageDelay));
    for (let i = 0; i < text.length; i++) {
      timers.push(
        setTimeout(
          () => setVisibleChars(i + 1),
          typingStart + charInterval * i,
        ),
      );
    }
    timers.push(
      setTimeout(
        () => onCompleteEvent(),
        typingStart + typingDuration + sendDelay,
      ),
    );

    return () => timers.forEach(clearTimeout);
  }, [duration, isActive, text]);

  return {
    displayedText: isActive ? text.slice(0, visibleChars) : "",
    showImage: isActive && showImage,
  };
}
