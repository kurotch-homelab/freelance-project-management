import type { CalendarEvent } from "./absence.ts";

export type AccessTokenProvider = () => Promise<string>;

export interface GoogleClientOptions {
  readonly getAccessToken: AccessTokenProvider;
  readonly fetch?: typeof globalThis.fetch;
  /** Deadline for token acquisition and the complete HTTP response. Defaults to 30 seconds. */
  readonly timeoutMs?: number;
}

export interface CalendarClientOptions extends GoogleClientOptions {
  readonly calendarId: string;
}

export interface ListOutOfOfficeOptions {
  readonly timeMin: string;
  readonly timeMax: string;
}

export interface CalendarClient {
  listOutOfOffice(options: ListOutOfOfficeOptions): Promise<CalendarEvent[]>;
}

export interface DriveClientOptions extends GoogleClientOptions {
  readonly driveId: string;
}

export interface DriveFolder {
  readonly id: string;
  readonly name: string;
}

export interface DriveFile extends DriveFolder {
  readonly mimeType?: string;
  readonly webViewLink?: string;
}

export interface EnsureFolderOptions {
  readonly parentId: string;
  readonly name: string;
}

export interface UploadFileOptions {
  readonly folderId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly data: Uint8Array;
}

export interface DriveClient {
  ensureFolder(options: EnsureFolderOptions): Promise<DriveFolder>;
  uploadFile(options: UploadFileOptions): Promise<DriveFile>;
  listFiles(folderId: string): Promise<DriveFile[]>;
}
