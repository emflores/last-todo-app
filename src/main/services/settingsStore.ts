import fs from 'node:fs';
import path from 'node:path';

interface SettingsData {
  backupFolder?: string;
  onboardingComplete?: boolean;
}

export class SettingsStore {
  private data: SettingsData;

  constructor(private readonly filePath: string) {
    try {
      this.data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SettingsData;
    } catch {
      this.data = {};
    }
  }

  get backupFolder(): string | null {
    return this.data.backupFolder ?? null;
  }

  setBackupFolder(folder: string | null): void {
    this.data.backupFolder = folder ?? undefined;
    this.save();
  }

  get onboardingComplete(): boolean {
    return this.data.onboardingComplete === true;
  }

  completeOnboarding(): void {
    this.setOnboardingComplete(true);
  }

  setOnboardingComplete(complete: boolean): void {
    this.data.onboardingComplete = complete;
    this.save();
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temporary, this.filePath);
  }
}
