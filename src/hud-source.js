import { TranscriptReader } from './transcript.js';
import { findSession } from './sessions.js';
import { getGitStatus } from './git.js';
import { renderHud, renderWaiting } from './render.js';
import { truncateText } from './terminal.js';

/** Incremental, read-only HUD data source for the embedded display. */
export class HudSource {
  constructor(settings) {
    this.settings = settings;
    this.reader = new TranscriptReader();
    this.selected = null;
    this.lastSearch = 0;
    this.lastGit = 0;
    this.gitCwd = null;
    this.git = null;
    this.currentState = null;
    this.missingFile = false;
  }

  async poll() {
    const now = Date.now();
    let state = null;
    let missingFile = false;
    try {
      if ((!this.selected || this.settings.follow) && now - this.lastSearch >= 1000) {
        const match = await findSession(this.settings);
        if (match) this.selected = match;
        this.lastSearch = now;
      }
      if (this.selected) {
        state = await this.reader.read(this.selected);
        const cwd = state.session.cwd ?? this.settings.cwd;
        if (this.settings.git && (cwd !== this.gitCwd || now - this.lastGit >= 3000)) {
          this.git = await getGitStatus(cwd);
          this.gitCwd = cwd;
          this.lastGit = now;
        }
        state.git = this.git;
      }
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      if (this.settings.follow) this.selected = null;
      missingFile = true;
    }
    const catchingUp = Boolean(state && !this.reader.caughtUp);
    this.currentState = state;
    this.missingFile = missingFile;
    return { catchingUp };
  }

  /** Re-render cached metadata immediately, without waiting for another poll. */
  render(options) {
    let frame = this.currentState ? renderHud(this.currentState, options) : renderWaiting(options);
    if (this.missingFile) {
      const note = options.language === 'ko' ? '세션 파일을 기다리는 중' : 'Waiting for the session file';
      frame += `\n${truncateText(note, options.width)}`;
    }
    return frame;
  }
}
