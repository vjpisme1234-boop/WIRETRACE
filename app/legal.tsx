import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { ArrowLeft, ExternalLink, FileText, Shield } from 'lucide-react-native';
import { PRIVACY_POLICY_URL, TERMS_URL, WT } from '@/constants/wiretrace';

function LinkCard({
  title,
  description,
  url,
  icon,
}: {
  title: string;
  description: string;
  url: string;
  icon: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={() => Linking.openURL(url)}
      style={styles.linkCard}
    >
      <View style={styles.linkIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.linkTitle}>{title}</Text>
        <Text style={styles.linkDescription}>{description}</Text>
      </View>
      <ExternalLink size={16} color={WT.textSecondary} />
    </Pressable>
  );
}

export default function LegalScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}> 
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={WT.blue} />
        </Pressable>
        <Text style={styles.headerTitle}>Legal</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={styles.subtitle}>
          Review WireTrace AI policies before purchasing or using premium features.
        </Text>

        <LinkCard
          title="Privacy Policy"
          description="How we collect, store, and process your data."
          url={PRIVACY_POLICY_URL}
          icon={<Shield size={18} color={WT.blue} />}
        />

        <LinkCard
          title="Terms of Service"
          description="Billing terms, subscriptions, and acceptable use."
          url={TERMS_URL}
          icon={<FileText size={18} color={WT.blue} />}
        />
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
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: WT.border,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: WT.textPrimary,
    fontSize: 17,
    fontWeight: '600',
  },
  content: {
    padding: 20,
    gap: 14,
  },
  subtitle: {
    color: WT.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.border,
    padding: 16,
  },
  linkIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WT.blueMuted,
  },
  linkTitle: {
    color: WT.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  linkDescription: {
    color: WT.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
});
