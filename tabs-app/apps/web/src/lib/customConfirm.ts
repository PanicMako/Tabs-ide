export interface ConfirmRequest {
  id: string;
  message: string;
  resolve: (value: boolean) => void;
}

let activeRequest: ConfirmRequest | null = null;
const listeners = new Set<(req: ConfirmRequest | null) => void>();

export function subscribeToConfirm(listener: (req: ConfirmRequest | null) => void) {
  listeners.add(listener);
  // Emit initial value
  listener(activeRequest);
  return () => {
    listeners.delete(listener);
  };
}

export function showCustomConfirm(message: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // If there is an active confirm request, auto-reject it to prevent deadlock
    if (activeRequest) {
      activeRequest.resolve(false);
    }

    const req: ConfirmRequest = {
      id: Math.random().toString(),
      message,
      resolve: (val) => {
        if (activeRequest?.id === req.id) {
          activeRequest = null;
          emit(null);
        }
        resolve(val);
      },
    };

    activeRequest = req;
    emit(req);
  });
}

function emit(req: ConfirmRequest | null) {
  for (const listener of listeners) {
    try {
      listener(req);
    } catch (e) {
      console.error("Error in confirm listener:", e);
    }
  }
}
