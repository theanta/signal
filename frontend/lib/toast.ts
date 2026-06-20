import { toast as sonnerToast } from 'sonner';

export const toast = {
  success: (message: string, description?: string) =>
    sonnerToast.success(message, { description }),

  error: (message: string, description?: string) =>
    sonnerToast.error(message, { description }),

  /** Shows a persistent loading toast. Returns an ID you can pass to resolve(). */
  loading: (message: string): string | number =>
    sonnerToast.loading(message),

  /** Resolves a loading toast (started with toast.loading) to success or error. */
  resolve: (
    id: string | number,
    type: 'success' | 'error',
    message: string,
    description?: string,
  ) => {
    if (type === 'success') sonnerToast.success(message, { id, description });
    else sonnerToast.error(message, { id, description });
  },

  dismiss: (id?: string | number) =>
    sonnerToast.dismiss(id),

  promise: <T>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error: string },
  ) => sonnerToast.promise(promise, messages),
};
