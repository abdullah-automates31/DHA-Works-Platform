// Pure rules for push notifications (unit tested): where a tapped push opens. The push itself is written by the
// send-push Edge Function; it carries the notification type, the job id and the notification id as data.
import type { Href } from 'expo-router';

import { statusHref } from '../job/routes.ts';
import { describe } from '../notifications/rules.ts';

export type PushData = Record<string, unknown> | null | undefined;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * New jobs open the Open jobs tab. Any other push opens the job when the same notification in W15 would (a
 * cancelled or lost job is hidden from the worker, so those open the notification list instead).
 */
export function pushHref(data: PushData): Href {
  const type = text(data?.type);
  const jobId = text(data?.job_id);
  if (type === 'new_job') return '/open-jobs' as Href;
  if (type && jobId) {
    const notice = { id: text(data?.notification_id), type, jobId, payload: null, readAt: null, createdAt: new Date().toISOString() };
    if (describe(notice).opensJob) return statusHref(jobId);
  }
  return '/notifications' as Href;
}

/**
 * The data of a tapped push. Notifications drawn by Android while the app was closed carry it in content.data;
 * ones shown by the app itself may only have it on the Firebase message.
 */
export function pushDataOf(response: {
  notification: { request: { content: { data?: unknown }; trigger?: unknown } };
}): PushData {
  const { content, trigger } = response.notification.request;
  const data = content.data;
  if (data && typeof data === 'object' && 'type' in data) return data as Record<string, unknown>;
  const remote = (trigger as { remoteMessage?: { data?: unknown } } | null | undefined)?.remoteMessage?.data;
  return remote && typeof remote === 'object' ? (remote as Record<string, unknown>) : null;
}
