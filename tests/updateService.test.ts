import { describe, expect, it } from 'vitest';

import {
  isNewerVersion,
  updateStatusFromRelease,
} from '../src/main/services/updateServiceCore';

const checkedAt = '2026-08-12T12:00:00.000Z';

describe('manual application updates', () => {
  it('compares stable semantic versions', () => {
    expect(isNewerVersion('v0.2.0', '0.1.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('v0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.0.9', '0.1.0')).toBe(false);
  });

  it('offers a DMG from the LastTodo GitHub release', () => {
    const status = updateStatusFromRelease(
      {
        tag_name: 'v0.2.0',
        assets: [
          {
            name: 'LastTodo-0.2.0.dmg',
            browser_download_url:
              'https://github.com/michael/last-todo-app/releases/download/v0.2.0/LastTodo-0.2.0.dmg',
          },
        ],
      },
      '0.1.0',
      checkedAt,
    );

    expect(status).toEqual({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      downloadUrl:
        'https://github.com/michael/last-todo-app/releases/download/v0.2.0/LastTodo-0.2.0.dmg',
      checkedAt,
      error: null,
    });
  });

  it('does not expose an untrusted download URL', () => {
    const status = updateStatusFromRelease(
      {
        tag_name: 'v0.2.0',
        assets: [
          {
            name: 'LastTodo-0.2.0.dmg',
            browser_download_url: 'file:///tmp/LastTodo-0.2.0.dmg',
          },
        ],
      },
      '0.1.0',
      checkedAt,
    );

    expect(status.updateAvailable).toBe(false);
    expect(status.downloadUrl).toBeNull();
    expect(status.error).toContain('download is not ready');
  });

  it('does not require a DMG when the installed version is current', () => {
    const status = updateStatusFromRelease(
      { tag_name: 'v0.1.0', assets: [] },
      '0.1.0',
      checkedAt,
    );

    expect(status.updateAvailable).toBe(false);
    expect(status.error).toBeNull();
  });
});
