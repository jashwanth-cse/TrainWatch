import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

interface SplashScreenProps {
  readyToDismiss: boolean;
  onAnimationComplete: () => void;
}

const FULL_TITLE = 'TrainWatch';
const FULL_TAGLINE = 'Watch Shift Board.';
const TITLE_CHAR_DELAY = 60;
const TAGLINE_CHAR_DELAY = 45;
const INTER_PHASE_PAUSE = 160;

const isTestEnv = typeof setTimeout === 'undefined';

/**
 * Minimalist Editorial Typing Splash Screen
 *
 * Sequence:
 * 1. Clean, focused white canvas with dark status bar.
 * 2. "TrainWatch" types out in normal, crisp black typography.
 * 3. A rhythmic pause, then "Watch Shift Board." types out smoothly below.
 * 4. A subtle terminal-style cursor blinks during typing.
 * 5. Smooth animated fade transition into the app.
 */
export const SplashScreen: React.FC<SplashScreenProps> = ({
  readyToDismiss,
  onAnimationComplete,
}) => {
  const [entranceComplete, setEntranceComplete] = useState(false);
  const [typedTitleLength, setTypedTitleLength] = useState(() => (isTestEnv ? FULL_TITLE.length : 0));
  const [typedTaglineLength, setTypedTaglineLength] = useState(() => (isTestEnv ? FULL_TAGLINE.length : 0));

  const [cursorOpacity] = useState(() => new Animated.Value(1));
  const [containerOpacity] = useState(() => new Animated.Value(1));

  // 1. Subtle rhythmic cursor blink loop & coordinated entrance duration
  useEffect(() => {
    const cursorLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorOpacity, {
          toValue: 0.1,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(cursorOpacity, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
      ])
    );
    cursorLoop.start();

    // 2. Entrance sequence timing
    const entranceDuration =
      FULL_TITLE.length * TITLE_CHAR_DELAY +
      INTER_PHASE_PAUSE +
      FULL_TAGLINE.length * TAGLINE_CHAR_DELAY +
      450;

    const entrance = Animated.sequence([
      Animated.delay(entranceDuration),
    ]);

    entrance.start(({ finished }) => {
      if (finished) {
        setEntranceComplete(true);
      }
    });

    return () => {
      cursorLoop.stop();
      entrance.stop();
    };
  }, [cursorOpacity]);

  // 3. Typing animation character state progression
  useEffect(() => {
    if (typeof setTimeout === 'undefined') return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    if (typedTitleLength < FULL_TITLE.length) {
      timer = setTimeout(() => {
        setTypedTitleLength((prev) => prev + 1);
      }, TITLE_CHAR_DELAY);
    } else if (typedTaglineLength < FULL_TAGLINE.length) {
      const delay = typedTaglineLength === 0 ? INTER_PHASE_PAUSE : TAGLINE_CHAR_DELAY;
      timer = setTimeout(() => {
        setTypedTaglineLength((prev) => prev + 1);
      }, delay);
    }

    return () => {
      if (timer && typeof clearTimeout !== 'undefined') {
        clearTimeout(timer);
      }
    };
  }, [typedTitleLength, typedTaglineLength]);

  // 4. Smooth exit transition into the app
  useEffect(() => {
    if (!entranceComplete || !readyToDismiss) return;

    const exit = Animated.timing(containerOpacity, {
      toValue: 0,
      duration: 380,
      useNativeDriver: true,
    });
    exit.start(({ finished }) => {
      if (finished) onAnimationComplete();
    });
    return () => exit.stop();
  }, [containerOpacity, entranceComplete, onAnimationComplete, readyToDismiss]);

  const displayedTitle = entranceComplete
    ? FULL_TITLE
    : FULL_TITLE.slice(0, typedTitleLength);

  const displayedTagline = entranceComplete
    ? FULL_TAGLINE
    : FULL_TAGLINE.slice(0, typedTaglineLength);

  const isTypingTitle = typedTitleLength < FULL_TITLE.length;
  const isTypingTagline =
    !isTypingTitle && typedTaglineLength < FULL_TAGLINE.length;
  const isTypingFinished =
    typedTitleLength >= FULL_TITLE.length &&
    typedTaglineLength >= FULL_TAGLINE.length;

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity }]}>
      <StatusBar style="dark" />

      <View style={styles.contentWrap}>
        {/* Main Title Row with Typewriter Effect */}
        <View style={styles.titleRow}>
          <Text style={styles.brandTitle}>{displayedTitle}</Text>
          {isTypingTitle && (
            <Animated.View style={[styles.titleCursor, { opacity: cursorOpacity }]} />
          )}
        </View>

        {/* Tagline Row with Typewriter Effect */}
        <View style={styles.taglineRow}>
          <Text style={styles.taglineText}>
            {displayedTagline || (isTypingTitle ? '' : ' ')}
          </Text>
          {(isTypingTagline || (!isTypingTitle && !isTypingFinished)) && (
            <Animated.View style={[styles.taglineCursor, { opacity: cursorOpacity }]} />
          )}
        </View>

        {/* Minimal accent line anchor */}
        <View style={styles.accentAnchor} />
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  contentWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  brandTitle: {
    fontSize: 36,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.5,
  },
  titleCursor: {
    width: 3,
    height: 32,
    backgroundColor: '#000000',
    marginLeft: 3,
    borderRadius: 1,
  },
  taglineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 28,
  },
  taglineText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
    letterSpacing: 1.2,
  },
  taglineCursor: {
    width: 2,
    height: 18,
    backgroundColor: '#000000',
    marginLeft: 3,
    borderRadius: 1,
  },
  accentAnchor: {
    width: 32,
    height: 2,
    backgroundColor: '#000000',
    marginTop: 22,
    opacity: 0.12,
    borderRadius: 1,
  },
});
