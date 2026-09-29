import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Crown, Shield, Star, Mail, Phone, CheckCircle, Coins, Zap } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';

export default function PromoScreen() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && user) {
      router.replace('/(tabs)');
    }
  }, [isLoading, user, router]);

  const handleJoin = () => {
    router.replace('/auth');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <AnimatedBackground />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces
      >
        <FloatingCoins />

        <AnimatedCard>
          <CrownBadge />

          <ShimmerTitle text="暗標競標會" />

          <Text style={styles.subtitle}>密封出價・公平競標・真實交易</Text>

          <Badges />

          <HighlightBox />

          <FeatureList />

          <CTAButton onPress={handleJoin} />

          <View style={styles.footer}>
            <Text style={styles.footerText}>暗標競標會 · 測試版</Text>
            <FooterTag />
          </View>
        </AnimatedCard>
      </ScrollView>
    </SafeAreaView>
  );
}

// --- Animated background ---
function AnimatedBackground() {
  const glow = useSharedValue(0);

  useEffect(() => {
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 2000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(glow.value, [0, 1], [0.3, 0.8]),
    transform: [{ scale: interpolate(glow.value, [0, 1], [0.9, 1.2]) }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.bgBase} />
      <Animated.View style={[styles.bgGlow, glowStyle]} />
      {STARS.map((s, i) => (
        <View
          key={i}
          style={[styles.star, { left: s.x, top: s.y, width: s.size, height: s.size, opacity: s.opacity }]}
        />
      ))}
    </View>
  );
}

const STARS = [
  { x: '12%', y: '8%', size: 3, opacity: 0.6 },
  { x: '85%', y: '12%', size: 2, opacity: 0.5 },
  { x: '45%', y: '22%', size: 2, opacity: 0.4 },
  { x: '70%', y: '35%', size: 3, opacity: 0.5 },
  { x: '20%', y: '45%', size: 2, opacity: 0.3 },
  { x: '90%', y: '55%', size: 2, opacity: 0.4 },
  { x: '30%', y: '68%', size: 3, opacity: 0.5 },
  { x: '60%', y: '78%', size: 2, opacity: 0.3 },
  { x: '15%', y: '88%', size: 2, opacity: 0.4 },
  { x: '75%', y: '92%', size: 3, opacity: 0.5 },
];

// --- Floating coins ---
function FloatingCoins() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {COINS.map((c, i) => (
        <Coin key={i} {...c} />
      ))}
    </View>
  );
}

const COINS = [
  { x: '8%', y: '15%', size: 24, delay: 0 },
  { x: '85%', y: '20%', size: 18, delay: 300 },
  { x: '15%', y: '75%', size: 20, delay: 600 },
  { x: '78%', y: '70%', size: 24, delay: 400 },
  { x: '50%', y: '8%', size: 16, delay: 800 },
];

function Coin({ x, y, size, delay }: { x: string; y: string; size: number; delay: number }) {
  const float = useSharedValue(0);

  useEffect(() => {
    float.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 3000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      )
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(float.value, [0, 1], [0, -25]) },
      { rotate: `${interpolate(float.value, [0, 1], [0, 180])}deg` },
    ],
    opacity: interpolate(float.value, [0, 0.5, 1], [0.5, 0.9, 0.5]),
  }));

  return (
    <Animated.View
      style={[
        styles.coin,
        { left: x as any, top: y as any, width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    >
      <Coins size={size * 0.6} color="#FFD700" strokeWidth={1.5} />
    </Animated.View>
  );
}

// --- Card ---
function AnimatedCard({ children }: { children: React.ReactNode }) {
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: interpolate(enter.value, [0, 1], [30, 0]) },
      { scale: interpolate(enter.value, [0, 1], [0.96, 1]) },
    ],
  }));

  return <Animated.View style={[styles.card, style]}>{children}</Animated.View>;
}

// --- Crown badge ---
function CrownBadge() {
  const float = useSharedValue(0);

  useEffect(() => {
    float.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(float.value, [0, 1], [0, -6]) },
      { rotate: `${interpolate(float.value, [0, 1], [0, -3])}deg` },
    ],
  }));

  return (
    <Animated.View style={[styles.crownWrap, style]}>
      <Crown size={36} color="#fff" strokeWidth={2} />
    </Animated.View>
  );
}

// --- Shimmer title ---
function ShimmerTitle({ text }: { text: string }) {
  const shift = useSharedValue(0);

  useEffect(() => {
    shift.value = withRepeat(withTiming(1, { duration: 3000, easing: Easing.linear }), -1);
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(shift.value, [0, 0.5, 1], [0.85, 1, 0.85]),
  }));

  return (
    <Animated.Text style={[styles.title, style]} allowFontScaling>
      {text}
    </Animated.Text>
  );
}

// --- Badges ---
function Badges() {
  return (
    <View style={styles.badges}>
      <Badge color="#00D4AA" label="測試中" icon={<Zap size={10} color="#00D4AA" strokeWidth={2.5} />} />
      <Badge color="#FFD700" label="免費加入" icon={<Star size={10} color="#FFD700" strokeWidth={2.5} />} />
      <Badge color="#3B82F6" label="安全加密" icon={<Shield size={10} color="#3B82F6" strokeWidth={2.5} />} />
    </View>
  );
}

function Badge({ color, label, icon }: { color: string; label: string; icon: React.ReactNode }) {
  const blink = useSharedValue(0);

  useEffect(() => {
    blink.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 750, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 750, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: interpolate(blink.value, [0, 1], [1, 0.3]),
  }));

  return (
    <View style={styles.badge}>
      <Animated.View style={[styles.badgeDot, { backgroundColor: color }, dotStyle]} />
      {icon}
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

// --- Highlight ---
function HighlightBox() {
  const fade = useSharedValue(0);

  useEffect(() => {
    fade.value = withDelay(300, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: interpolate(fade.value, [0, 1], [12, 0]) }],
  }));

  return (
    <Animated.View style={[styles.highlight, style]}>
      <Text style={styles.highlightText}>誠邀測試會員加入</Text>
      <Text style={styles.highlightSub}>體驗全功能競標平台，您的意見將幫助我們更好</Text>
    </Animated.View>
  );
}

// --- Feature list ---
const FEATURES = [
  { icon: Shield, title: '密封暗標制', desc: '出價全程保密，最高者得標' },
  { icon: Star, title: '直接購買', desc: '部分商品可跳過競標直接入手' },
  { icon: Mail, title: '買賣私訊', desc: '得標後可直接與賣家聯繫交付' },
  { icon: Phone, title: '手機驗證', desc: '簡訊OTP認證，保障帳戶安全' },
  { icon: CheckCircle, title: '會員制度', desc: 'VIP享專屬權限與競標保障' },
];

function FeatureList() {
  return (
    <View style={styles.features}>
      {FEATURES.map((f, i) => (
        <FeatureRow key={i} {...f} index={i} />
      ))}
    </View>
  );
}

function FeatureRow({
  icon: Icon,
  title,
  desc,
  index,
}: {
  icon: typeof Shield;
  title: string;
  desc: string;
  index: number;
}) {
  const slide = useSharedValue(0);

  useEffect(() => {
    slide.value = withDelay(400 + index * 100, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: slide.value,
    transform: [{ translateX: interpolate(slide.value, [0, 1], [-20, 0]) }],
  }));

  return (
    <Animated.View style={[styles.feature, style]}>
      <View style={styles.featureIcon}>
        <Icon size={16} color="#00D4AA" strokeWidth={2} />
      </View>
      <Text style={styles.featureText}>
        <Text style={styles.featureBold}>{title}</Text>
        {' — '}
        {desc}
      </Text>
    </Animated.View>
  );
}

// --- CTA ---
function CTAButton({ onPress }: { onPress: () => void }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(pulse.value, [0, 1], [0.3, 0.55]),
    shadowRadius: interpolate(pulse.value, [0, 1], [15, 30]),
    transform: [{ scale: 1 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [pressed && { transform: [{ scale: 0.95 }] }]}
    >
      <Animated.View style={[styles.cta, style]}>
        <Text style={styles.ctaText}>立即加入測試</Text>
      </Animated.View>
    </Pressable>
  );
}

// --- Footer tag ---
function FooterTag() {
  const bounce = useSharedValue(0);

  useEffect(() => {
    bounce.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(bounce.value, [0, 1], [0, -3]) }],
  }));

  return (
    <Animated.View style={[styles.footerTag, style]}>
      <Text style={styles.footerTagText}>名額有限·即刻報名</Text>
    </Animated.View>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e17',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  bgBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0e17',
  },
  bgGlow: {
    position: 'absolute',
    top: '30%',
    left: '50%',
    width: 400,
    height: 400,
    marginLeft: -200,
    marginTop: -200,
    borderRadius: 200,
    backgroundColor: 'rgba(0,212,170,0.12)',
  },
  star: {
    position: 'absolute',
    borderRadius: 99,
    backgroundColor: '#00D4AA',
  },
  coin: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 500,
    backgroundColor: 'rgba(17,24,39,0.95)',
    borderRadius: 24,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,212,170,0.2)',
    shadowColor: '#00D4AA',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 40,
    elevation: 10,
  },
  crownWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#00D4AA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    shadowColor: '#00D4AA',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 8,
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    color: '#00D4AA',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#66778a',
    marginBottom: 24,
    letterSpacing: 1,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  highlight: {
    width: '100%',
    backgroundColor: 'rgba(0,212,170,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,212,170,0.15)',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    marginBottom: 24,
  },
  highlightText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#00D4AA',
    lineHeight: 24,
  },
  highlightSub: {
    fontSize: 13,
    color: '#8895a6',
    marginTop: 6,
  },
  features: {
    width: '100%',
    marginBottom: 28,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  featureIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(0,212,170,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
    fontSize: 14,
    color: '#c8d3e0',
    lineHeight: 20,
  },
  featureBold: {
    color: '#fff',
    fontWeight: '700',
  },
  cta: {
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#00D4AA',
    shadowColor: '#00D4AA',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 6,
  },
  ctaText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0a0e17',
  },
  footer: {
    marginTop: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: '#445566',
  },
  footerTag: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(255,215,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.2)',
  },
  footerTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFD700',
  },
});
