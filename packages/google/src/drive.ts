import { randomUUID } from "node:crypto";
import { createGoogleRequest, listGooglePages } from "./request.ts";
import { parseFile, parseFolder } from "./responses.ts";
import type { DriveClient, DriveClientOptions, DriveFile } from "./types.ts";

const API_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

function quote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function filesUrl(baseUrl: string, fields: string): URL {
  const url = new URL(baseUrl);
  url.search = new URLSearchParams({ supportsAllDrives: "true", fields }).toString();
  return url;
}

export function createDriveClient(options: DriveClientOptions): DriveClient {
  const request = createGoogleRequest(options);

  function listUrl(q: string, fields: string): URL {
    // The token must be selected explicitly when using a fields mask.
    const url = filesUrl(API_URL, `nextPageToken,files(${fields})`);
    url.searchParams.set("includeItemsFromAllDrives", "true");
    url.searchParams.set("corpora", "drive");
    url.searchParams.set("driveId", options.driveId);
    url.searchParams.set("q", q);
    return url;
  }

  return {
    async ensureFolder({ parentId, name }) {
      const q = `name = ${quote(name)} and ${quote(parentId)} in parents and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`;
      for await (const page of listGooglePages(request, listUrl(q, "id,name"), "files", parseFolder)) {
        if (page[0]) return page[0];
      }
      return request(filesUrl(API_URL, "id,name"), parseFolder, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME_TYPE, parents: [parentId] }),
      });
    },

    async uploadFile({ folderId, name, mimeType, data }) {
      if (!mimeType || /[\r\n]/.test(mimeType)) throw new RangeError("mimeType must be a non-empty single line");
      const boundary = `fpm-${randomUUID()}`;
      const metadata = JSON.stringify({ name, mimeType, parents: [folderId] });
      // Keep the file as bytes; decoding arbitrary PDF/binary data as text would corrupt it.
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
        Uint8Array.from(data),
        `\r\n--${boundary}--\r\n`,
      ]);
      const url = filesUrl(UPLOAD_URL, "id,name,webViewLink");
      url.searchParams.set("uploadType", "multipart");
      return request(url, parseFile, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      });
    },

    async listFiles(folderId) {
      const url = listUrl(`${quote(folderId)} in parents and trashed = false`, "id,name,mimeType,webViewLink");
      const files: DriveFile[] = [];
      for await (const page of listGooglePages(request, url, "files", parseFile)) files.push(...page);
      return files;
    },
  };
}
