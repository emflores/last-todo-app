import { app, shell } from 'electron';

import type { UpdateStatus } from '../../shared/contracts';
import { updateStatusFromRelease } from './updateServiceCore';

const LATEST_RELEASE_URL =
  'https://api.github.com/repos/emflores/last-todo-app/releases/latest';

export class UpdateService {
  private status: UpdateStatus | null = null;
  private pendingCheck: Promise<UpdateStatus> | null = null;

  check(): Promise<UpdateStatus> {
    if (this.pendingCheck) return this.pendingCheck;
    this.pendingCheck = this.fetchLatest().finally(() => {
      this.pendingCheck = null;
    });
    return this.pendingCheck;
  }

  async openDownload(): Promise<void> {
    const status =
      this.status?.updateAvailable && this.status.downloadUrl
        ? this.status
        : await this.check();
    if (!status.updateAvailable || !status.downloadUrl)
      throw new Error('No macOS update is currently available.');
    await shell.openExternal(status.downloadUrl);
  }

  private async fetchLatest(): Promise<UpdateStatus> {
    const checkedAt = new Date().toISOString();
    const currentVersion = app.getVersion();
    try {
      const response = await fetch(LATEST_RELEASE_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `LastTodo/${currentVersion}`,
          'X-GitHub-Api-Version': '2026-03-10',
        },
      });
      if (!response.ok)
        throw new Error(`GitHub returned HTTP ${response.status}.`);

      this.status = updateStatusFromRelease(
        await response.json(),
        currentVersion,
        checkedAt,
      );
    } catch (error) {
      console.error('Could not check for a LastTodo update:', error);
      this.status = {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        downloadUrl: null,
        checkedAt,
        error: 'Could not check GitHub for updates right now.',
      };
    }
    return this.status;
  }
}
