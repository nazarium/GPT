import { useEffect } from 'react';

export function useUnsavedChanges(dirty) {
  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = event => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [dirty]);
}
