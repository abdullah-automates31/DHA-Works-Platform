import { SettingsView } from '@/features/settings/SettingsView';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return <SettingsView tab={(await searchParams).tab} />;
}
