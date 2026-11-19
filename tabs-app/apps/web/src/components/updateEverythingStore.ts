import { create } from "zustand";

interface UpdateEverythingState {
  readonly open: boolean;
  setOpen: (open: boolean) => void;
}

/** Whether the "Update everything" dialog is showing. Opened from the update toast and About. */
export const useUpdateEverythingStore = create<UpdateEverythingState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
