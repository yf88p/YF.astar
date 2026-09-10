import type { Document } from './core/model';
import type { SketchStore } from './core/store';
import type { solve } from './core/solver';
import type { View } from './ui/Canvas';

declare global {
  interface Window {
    __datum: {
      store: SketchStore;
      getDocument: () => Document;
      getResult: () => SketchStore['result'];
      getView: () => View;
      load: (d: unknown) => boolean;
      fit: () => void;
      solve: typeof solve;
      performanceSketch: () => Document;
    };
  }
}
