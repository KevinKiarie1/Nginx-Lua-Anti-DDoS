import { BadRequestException } from '@nestjs/common';
import { Platform, TaskType } from '@prisma/client';

const platformTaskCapabilities: Record<Platform, ReadonlySet<TaskType>> = {
  TELEGRAM: new Set([
    TaskType.SEND_MESSAGE,
    TaskType.POST_CONTENT,
    TaskType.SEND_DM,
  ]),
  TIKTOK: new Set([
    TaskType.POST_CONTENT,
    TaskType.LIKE_POST,
    TaskType.COMMENT,
    TaskType.FOLLOW_USER,
    TaskType.SEND_DM,
  ]),
  INSTAGRAM: new Set([
    TaskType.POST_CONTENT,
    TaskType.LIKE_POST,
    TaskType.COMMENT,
    TaskType.FOLLOW_USER,
    TaskType.SEND_DM,
  ]),
  FACEBOOK: new Set([
    TaskType.POST_CONTENT,
    TaskType.LIKE_POST,
    TaskType.COMMENT,
    TaskType.SEND_DM,
  ]),
};

const accountRequiredPlatforms = new Set<Platform>([
  Platform.TIKTOK,
  Platform.INSTAGRAM,
  Platform.FACEBOOK,
]);

export function isTaskSupported(
  platform: Platform,
  taskType: TaskType,
): boolean {
  return platformTaskCapabilities[platform]?.has(taskType) ?? false;
}

export function getSupportedTasksForPlatform(
  platform: Platform,
): TaskType[] {
  return Array.from(platformTaskCapabilities[platform] ?? []);
}

export function requiresAccount(
  platform: Platform,
  _taskType: TaskType,
): boolean {
  return accountRequiredPlatforms.has(platform);
}

export function validateTaskRequest(input: {
  platform: Platform;
  type: TaskType;
  accountId?: string;
}): void {
  if (!isTaskSupported(input.platform, input.type)) {
    const supported = getSupportedTasksForPlatform(input.platform).join(', ');
    throw new BadRequestException(
      `Task type ${input.type} is not supported on platform ${input.platform}. Supported task types: ${supported}`,
    );
  }

  if (requiresAccount(input.platform, input.type) && !input.accountId) {
    throw new BadRequestException(
      `Task type ${input.type} on platform ${input.platform} requires accountId`,
    );
  }
}
