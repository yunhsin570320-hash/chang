import React, { useState, useEffect, useRef } from 'react';
import { Text, StyleSheet } from 'react-native';

interface CountdownTimerProps {
  endTime: string;
  onEnd?: () => void;
  size?: 'small' | 'medium' | 'large';
  isEnded?: boolean;
}

export function CountdownTimer({ endTime, onEnd, size = 'medium', isEnded }: CountdownTimerProps) {
  const [ended, setEnded] = useState(isEnded || false);
  const [displayTime, setDisplayTime] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const onEndRef = useRef(onEnd);

  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  useEffect(() => {
    if (ended || isEnded) return;

    const updateTimer = () => {
      const end = new Date(endTime).getTime();
      const diff = Math.max(0, end - Date.now());

      if (diff <= 0) {
        setDisplayTime({ hours: 0, minutes: 0, seconds: 0 });
        setEnded(true);
        onEndRef.current?.();
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setDisplayTime({ hours, minutes, seconds });
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [endTime, isEnded, ended]);

  if (ended || isEnded) {
    return <Text style={[styles.timer, styles[size], styles.ended]}>已結標</Text>;
  }

  const format = (n: number) => n.toString().padStart(2, '0');

  return (
    <Text style={[styles.timer, styles[size]]}>
      {format(displayTime.hours)}:{format(displayTime.minutes)}:{format(displayTime.seconds)}
    </Text>
  );
}

const styles = StyleSheet.create({
  timer: {
    color: '#00D4AA',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  small: { fontSize: 14 },
  medium: { fontSize: 18, fontWeight: '600' },
  large: { fontSize: 32, fontWeight: '700' },
  ended: { color: '#FF6B6B' },
});
