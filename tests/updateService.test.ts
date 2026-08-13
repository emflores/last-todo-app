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

  it('offers the native Apple Silicon DMG from the LastTodo GitHub release', () => {
    const status = updateStatusFromRelease(
      {
        tag_name: 'v0.2.0',
        assets: [
          {
            name: 'LastTodo-0.2.0-mac-x64.dmg',
            browser_download_url:
              'https://github.com/emflores/last-todo-app/releases/download/v0.2.0/LastTodo-0.2.0-mac-x64.dmg',
          },
          {
            name: 'LastTodo-0.2.0-mac-arm64.dmg',
            browser_download_url:
              'https://github.com/emflores/last-todo-app/releases/download/v0.2.0/LastTodo-0.2.0-mac-arm64.dmg',
          },
        ],
      },
      '0.1.0',
      checkedAt,
      'darwin',
      'arm64',
    );

    expect(status).toEqual({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      downloadUrl:
        'https://github.com/emflores/last-todo-app/releases/download/v0.2.0/LastTodo-0.2.0-mac-arm64.dmg',
      downloadLabel: 'Apple Silicon DMG',
      checkedAt,
      error: null,
    });
  });

  it('offers the Intel DMG to an Intel Mac', () => {
    const status = updateStatusFromRelease(
      {
        tag_name: 'v0.2.0',
        assets: [
          {
            name: 'LastTodo-0.2.0-mac-arm64.dmg',
            browser_download_url:
              'https://github.com/emflores/last-todo-app/releases/download/v0.2.0/LastTodo-0.2.0-mac-arm64.dmg',
          },
          {
            name: 'LastTodo-0.2.0-mac-x64.dmg',
            browser_download_url:
              'https://github.com/emflores/last-todo-app/releases/download/v0.2.0/LastTodo-0.2.0-mac-x64.dmg',
          },
        ],
      },
      '0.1.0',
      checkedAt,
      'darwin',
      'x64',
    );

    expect(status.downloadLabel).toBe('Intel DMG');
    expect(status.downloadUrl).toMatch(/-x64\.dmg$/);
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
      'darwin',
      'x64',
    );

    expect(status.updateAvailable).toBe(false);
    expect(status.downloadUrl).toBeNull();
    expect(status.error).toContain('download is not ready');
  });

  it('selects a DEB on Linux instead of the macOS asset', () => {
    const status = updateStatusFromRelease(
      {
        tag_name: 'v0.2.0',
        assets: [
          {
            name: 'LastTodo-0.2.0.dmg',
            browser_download_url:
              'https://github.com/emflores/last-todo-app/releases/download/v0.2.0/LastTodo-0.2.0.dmg',
          },
          {
            name: 'last-todo_0.2.0_amd64.deb',
            browser_download_url:
              'https://github.com/emflores/last-todo-app/releases/download/v0.2.0/last-todo_0.2.0_amd64.deb',
          },
        ],
      },
      '0.1.0',
      checkedAt,
      'linux',
      'x64',
    );

    expect(status.updateAvailable).toBe(true);
    expect(status.downloadLabel).toBe('DEB');
    expect(status.downloadUrl).toMatch(/\.deb$/);
  });

  it('selects the installer EXE on Windows', () => {
    const status = updateStatusFromRelease(
      {
        tag_name: 'v0.2.0',
        assets: [
          {
            name: 'LastTodo Setup 0.2.0.exe',
            browser_download_url:
              'https://github.com/emflores/last-todo-app/releases/download/v0.2.0/LastTodo.Setup.0.2.0.exe',
          },
        ],
      },
      '0.1.0',
      checkedAt,
      'win32',
      'x64',
    );

    expect(status.updateAvailable).toBe(true);
    expect(status.downloadLabel).toBe('Windows installer');
    expect(status.downloadUrl).toMatch(/\.exe$/);
  });

  it('does not require an installer when the installed version is current', () => {
    const status = updateStatusFromRelease(
      { tag_name: 'v0.1.0', assets: [] },
      '0.1.0',
      checkedAt,
      'linux',
      'x64',
    );

    expect(status.updateAvailable).toBe(false);
    expect(status.error).toBeNull();
  });
});
