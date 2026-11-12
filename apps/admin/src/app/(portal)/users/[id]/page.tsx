import { UserView } from '@/features/users/UserView';

export const metadata = { title: 'User' };

export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; page?: string }> }) {
  return <UserView id={(await params).id} params={await searchParams} />;
}
