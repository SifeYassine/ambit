import { create } from 'zustand';

interface PresetsViewState {
    matchWeights: boolean;
    setMatchWeights: (matchWeights: boolean) => void;
}

// Kept across visits so returning from a preset's gallery keeps the chosen grouping. Lives outside
// the lazily loaded page so the startup warm-up can read it without loading the page.
export const usePresetsViewStore = create<PresetsViewState>(set => ({
    matchWeights: true,
    setMatchWeights: matchWeights => set({ matchWeights }),
}));
