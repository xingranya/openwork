import {
  MICROSOFT_365_DEFAULT_FEATURES,
  type Microsoft365Feature,
} from "@openwork/types/den/microsoft-365";

export { MICROSOFT_365_DEFAULT_FEATURES };

export type Microsoft365Permission = {
  key: Microsoft365Feature;
  label: string;
  scope: string;
  detail?: string;
};

export type Microsoft365PermissionGroup = {
  name: string;
  permissions: readonly Microsoft365Permission[];
};

export const MICROSOFT_365_PERMISSION_GROUPS: readonly Microsoft365PermissionGroup[] = [
  {
    name: "日历",
    permissions: [
      { key: "calendarRead", label: "读取 Outlook 日历", scope: "Calendars.Read" },
      {
        key: "calendarWrite",
        label: "创建和管理日历事件",
        scope: "Calendars.ReadWrite",
        detail: "Microsoft 会授予该员工日历的完整访问权限。",
      },
    ],
  },
  {
    name: "Outlook",
    permissions: [
      {
        key: "mailDraft",
        label: "创建和管理邮件草稿",
        scope: "Mail.ReadWrite",
        detail: "Microsoft 会授予邮箱读写权限，但此选项不会发送邮件。",
      },
      { key: "mailRead", label: "读取 Outlook 邮件", scope: "Mail.Read" },
    ],
  },
  {
    name: "OneDrive",
    permissions: [
      { key: "filesRead", label: "读取 OneDrive 文件", scope: "Files.Read" },
      { key: "filesWrite", label: "创建和更新 OneDrive 文件", scope: "Files.ReadWrite" },
      { key: "filesReadAll", label: "读取员工有权访问的全部文件", scope: "Files.Read.All" },
      { key: "filesFull", label: "完整管理员工有权访问的文件", scope: "Files.ReadWrite.All" },
    ],
  },
  {
    name: "Teams",
    permissions: [
      { key: "teamsChatRead", label: "读取 Teams 聊天", scope: "Chat.Read" },
      {
        key: "teamsChatSend",
        label: "发送 Teams 聊天消息",
        scope: "Chat.Read + ChatMessage.Send",
        detail: "同时包含聊天读取权限，以便 SeeWayWork 查找现有聊天；SeeWayWork 不能创建新聊天。",
      },
    ],
  },
];

export const MICROSOFT_365_DISPLAY_SCOPES = new Set(
  MICROSOFT_365_PERMISSION_GROUPS.flatMap((group) =>
    group.permissions.flatMap((permission) => permission.scope.split(" + ")),
  ),
);
