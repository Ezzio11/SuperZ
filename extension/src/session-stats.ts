import * as vscode from "vscode";

const KEY = "promptCompressor.sessionStats.v1";

interface Snapshot {
  requests: number;
  totalOriginal: number;
  totalCompressed: number;
  totalSaved: number;
}

const DEFAULT: Snapshot = { requests: 0, totalOriginal: 0, totalCompressed: 0, totalSaved: 0 };

export class SessionStats {
  private snap: Snapshot;

  constructor(private readonly storage: vscode.Memento) {
    this.snap = storage.get<Snapshot>(KEY, DEFAULT);
  }

  record(originalTokens: number, compressedTokens: number): void {
    this.snap = {
      requests: this.snap.requests + 1,
      totalOriginal: this.snap.totalOriginal + originalTokens,
      totalCompressed: this.snap.totalCompressed + compressedTokens,
      totalSaved: this.snap.totalSaved + Math.max(0, originalTokens - compressedTokens),
    };
    void this.storage.update(KEY, this.snap);
  }

  totalTokensSaved(): number {
    return this.snap.totalSaved;
  }

  snapshot(): Snapshot {
    return { ...this.snap };
  }
}
