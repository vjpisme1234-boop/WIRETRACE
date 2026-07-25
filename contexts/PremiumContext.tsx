import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Purchases, { CustomerInfo, PurchasesError, PURCHASES_ERROR_CODE, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import {
  PREMIUM_ENTITLEMENT_ID,
  PREMIUM_PRODUCTS,
  STORAGE_KEYS,
} from '@/constants/wiretrace';

interface PremiumProduct {
  identifier: string;
  title: string;
  description: string;
  priceString: string;
  packageType: string;
}

interface PremiumContextValue {
  isReady: boolean;
  isLoading: boolean;
  isPremium: boolean;
  error: string | null;
  products: PremiumProduct[];
  refresh: () => Promise<void>;
  purchase: (productIdentifier: string) => Promise<void>;
  restorePurchases: () => Promise<void>;
}

const PremiumContext = createContext<PremiumContextValue | undefined>(undefined);

function getRevenueCatApiKey(): string {
  const iosKey = process.env.EXPO_PUBLIC_RC_IOS_API_KEY ?? '';
  const androidKey = process.env.EXPO_PUBLIC_RC_ANDROID_API_KEY ?? '';
  return Platform.OS === 'ios' ? iosKey : androidKey;
}

function mapPackagesToProducts(offering?: PurchasesOffering | null): PremiumProduct[] {
  if (!offering) return [];
  return offering.availablePackages.map((pkg: PurchasesPackage) => ({
    identifier: pkg.product.identifier,
    title: pkg.product.title,
    description: pkg.product.description,
    priceString: pkg.product.priceString,
    packageType: pkg.packageType,
  }));
}

async function persistPremiumStatus(isPremium: boolean): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEYS.PREMIUM_STATUS, isPremium ? 'true' : 'false');
}

function hasPremiumEntitlement(customerInfo: CustomerInfo): boolean {
  const entitlement = customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID];
  return Boolean(entitlement);
}

export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [products, setProducts] = useState<PremiumProduct[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const apiKey = getRevenueCatApiKey();
    if (!apiKey) {
      setIsPremium(false);
      setProducts([]);
      setError('RevenueCat API keys are not configured.');
      await persistPremiumStatus(false);
      return;
    }

    try {
      setError(null);
      setIsLoading(true);

      await Purchases.configure({ apiKey });
      const [customerInfo, offerings] = await Promise.all([
        Purchases.getCustomerInfo(),
        Purchases.getOfferings(),
      ]);

      const premium = hasPremiumEntitlement(customerInfo);
      setIsPremium(premium);
      setProducts(mapPackagesToProducts(offerings.current));
      await persistPremiumStatus(premium);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to load purchases.';
      setError(message);
      setProducts([]);
      await persistPremiumStatus(false);
    } finally {
      setIsLoading(false);
      setIsReady(true);
    }
  }, []);

  const purchase = useCallback(async (productIdentifier: string) => {
    try {
      setError(null);
      setIsLoading(true);
      const offerings = await Purchases.getOfferings();
      const pkg = offerings.current?.availablePackages.find(
        (candidate) => candidate.product.identifier === productIdentifier
      );

      if (!pkg) {
        throw new Error('That subscription is currently unavailable.');
      }

      const result = await Purchases.purchasePackage(pkg);
      const premium = hasPremiumEntitlement(result.customerInfo);
      setIsPremium(premium);
      await persistPremiumStatus(premium);
    } catch (e) {
      const candidate = e as Partial<PurchasesError>;
      const isCancelled = candidate.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
      if (!isCancelled) {
        const message = e instanceof Error ? e.message : 'Purchase failed.';
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const restorePurchases = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);
      const restored = await Purchases.restorePurchases();
      const premium = hasPremiumEntitlement(restored);
      setIsPremium(premium);
      await persistPremiumStatus(premium);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Restore failed.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<PremiumContextValue>(
    () => ({
      isReady,
      isLoading,
      isPremium,
      error,
      products,
      refresh,
      purchase,
      restorePurchases,
    }),
    [error, isLoading, isPremium, isReady, products, purchase, refresh, restorePurchases]
  );

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export function usePremium(): PremiumContextValue {
  const context = useContext(PremiumContext);
  if (!context) {
    throw new Error('usePremium must be used within a PremiumProvider');
  }
  return context;
}

export const DEFAULT_PREMIUM_PRODUCT_IDS = [
  PREMIUM_PRODUCTS.monthly,
  PREMIUM_PRODUCTS.yearly,
];
