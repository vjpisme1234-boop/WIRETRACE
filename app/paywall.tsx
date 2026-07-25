import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, Crown, X } from 'lucide-react-native';
import { DEFAULT_PREMIUM_PRODUCT_IDS, usePremium } from '@/contexts/PremiumContext';
import { FREE_SCAN_LIMIT, WT } from '@/constants/wiretrace';

function FeatureRow({ text }: { text: string }) {
  return (
    <View style={styles.featureRow}>
      <Check size={16} color={WT.blue} />
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

export default function PaywallScreen() {
  const insets = useSafeAreaInsets();
  const { isPremium, isLoading, products, error, purchase, restorePurchases } = usePremium();

  const fallbackPlanTitles: Record<string, string> = {
    wiretrace_pro_monthly: 'WireTrace Pro Monthly',
    wiretrace_pro_yearly: 'WireTrace Pro Yearly',
  };

  const plans = DEFAULT_PREMIUM_PRODUCT_IDS.map((id) => {
    const product = products.find((candidate) => candidate.identifier === id);
    return {
      id,
      title: product?.title ?? fallbackPlanTitles[id] ?? 'WireTrace Pro',
      description: product?.description ?? 'Unlock all premium features',
      price: product?.priceString ?? 'Configured in store',
    };
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}> 
      <View style={styles.header}>
        <View style={{ width: 44 }} />
        <Text style={styles.title}>WireTrace Pro</Text>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <X size={20} color={WT.textPrimary} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
      >
        <View style={styles.heroCard}>
          <Crown size={30} color={WT.yellow} />
          <Text style={styles.heroTitle}>Upgrade to Premium</Text>
          <Text style={styles.heroSubtitle}>
            Free tier includes {FREE_SCAN_LIMIT} total scans. Go Pro for unlimited scans and advanced AI.
          </Text>
        </View>

        <View style={styles.featuresCard}>
          <FeatureRow text="Unlimited schematic scans" />
          <FeatureRow text="Premium AI model (Gemini Pro)" />
          <FeatureRow text="All voice options in reader mode" />
          <FeatureRow text="Priority support and future export tools" />
        </View>

        {plans.map((plan) => (
          <Pressable
            key={plan.id}
            style={[styles.planCard, isLoading && styles.planCardDisabled]}
            disabled={isLoading}
            onPress={() => purchase(plan.id)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.planTitle}>{plan.title}</Text>
              <Text style={styles.planDesc}>{plan.description}</Text>
            </View>
            <Text style={styles.planPrice}>{plan.price}</Text>
          </Pressable>
        ))}

        <Pressable onPress={restorePurchases} style={styles.restoreBtn} disabled={isLoading}>
          {isLoading ? <ActivityIndicator color={WT.textPrimary} /> : <Text style={styles.restoreText}>Restore Purchases</Text>}
        </Pressable>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {isPremium ? <Text style={styles.successText}>Premium active on this device.</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: WT.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  title: {
    color: WT.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.border,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 14,
  },
  heroCard: {
    borderRadius: 16,
    padding: 20,
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.border,
    alignItems: 'flex-start',
    gap: 8,
  },
  heroTitle: {
    color: WT.textPrimary,
    fontSize: 21,
    fontWeight: '700',
  },
  heroSubtitle: {
    color: WT.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  featuresCard: {
    borderRadius: 14,
    padding: 16,
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.border,
    gap: 10,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureText: {
    color: WT.textPrimary,
    fontSize: 14,
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.border,
  },
  planCardDisabled: {
    opacity: 0.6,
  },
  planTitle: {
    color: WT.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  planDesc: {
    color: WT.textSecondary,
    marginTop: 2,
    fontSize: 12,
  },
  planPrice: {
    color: WT.blue,
    fontWeight: '700',
    fontSize: 15,
  },
  restoreBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: WT.border,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: WT.bgCardAlt,
  },
  restoreText: {
    color: WT.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    color: WT.red,
    fontSize: 12,
  },
  successText: {
    color: WT.green,
    fontSize: 13,
    textAlign: 'center',
  },
});
