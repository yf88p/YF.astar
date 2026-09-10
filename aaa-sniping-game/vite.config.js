import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'three-core': ['three'],
          'three-effects': [
            'three/addons/postprocessing/EffectComposer.js',
            'three/addons/postprocessing/UnrealBloomPass.js',
            'three/addons/postprocessing/OutputPass.js',
            'three/addons/environments/RoomEnvironment.js',
          ],
          collision: ['three-mesh-bvh'],
        },
      },
    },
  },
});
